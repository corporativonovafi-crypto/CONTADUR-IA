export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Falta el mensaje" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  const systemPrompt = `Eres el asistente de "Mis Herramientas Fiscales", el sitio de Eliezer Doño Andrade, contador corporativo.
Ayudas a los visitantes a decidir cuál de estas 4 herramientas usar:
1. Análisis XML (mi-plataforma-fiscal.vercel.app) - analiza y valida XML de CFDI
2. Auditor (analizador-de-xml.vercel.app) - audita XML y detecta inconsistencias fiscales
3. Estimador de impuestos (estimador-de-impuestos.vercel.app) - calcula impuestos a pagar
4. Extractor de nómina CFDI (extractor-nomina-cfdi.vercel.app) - extrae y desglosa datos de nómina desde CFDI

Reglas importantes:
- NO cites artículos de leyes fiscales, tasas exactas ni fundamentos legales específicos.
- Si preguntan algo fiscal complejo, recomienda consultar a un contador.
- Sé breve y directo. Guía al visitante hacia la herramienta correcta.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "No pude generar una respuesta, intenta de nuevo.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al contactar a Gemini" });
  }
}
