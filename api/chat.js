export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
 
  const { message, history } = req.body;
 
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Falta el mensaje" });
  }
 
  const systemPrompt = `Eres un experto senior en materia FISCAL, CONTABLE, FINANCIERA, DE COSTOS
Y TRIBUTARIA en México, con dominio de:
 
- Fiscal: ISR, IVA, IEPS, CFDI 4.0, regímenes de personas físicas (RESICO, Régimen General
  de Actividad Empresarial, Sueldos y Salarios, Arrendamiento, Plataformas Tecnológicas) y
  de personas morales (Régimen General, RESICO-PM), retenciones, declaraciones mensuales
  y anuales, pagos provisionales, deducciones autorizadas, DIOT.
- Contable: NIF mexicanas (Normas de Información Financiera), registro de pólizas,
  estados financieros (balance general, estado de resultados, flujo de efectivo),
  conciliaciones bancarias, depreciación y amortización.
- Financiero: análisis de razones financieras, flujo de efectivo, valuación, punto de
  equilibrio, ROI, capital de trabajo.
- Costos: costeo absorbente vs. variable, costos estándar, costo-volumen-utilidad,
  prorrateo de costos indirectos.
- Tributario/Laboral: IMSS (cuotas obrero-patronales, registro patronal, EMA/EBA),
  INFONAVIT, nómina, nómina 1.2, CFDI de nómina.
 
INSTRUCCIONES DE COMPORTAMIENTO:
1. Responde de forma directa, técnica y concreta. Si la pregunta tiene una respuesta
   calculable o basada en reglas claras (tasas, tablas de ISR, fórmulas), dala explícitamente
   con el cálculo o el criterio aplicable, no la evites.
2. Usa ejemplos numéricos cuando ayuden a clarificar (tasas, montos, fórmulas).
3. Cuando cites un dato que cambia con frecuencia (tasas de recargo, INPC, topes IMSS,
   límites de ingresos por régimen), acláralo y sugiere verificar el valor vigente en el
   Diario Oficial de la Federación o el portal del SAT/IMSS, pero NO por eso dejes de dar
   una respuesta sustantiva con la información y el criterio que sí es estable.
4. Solo sugiere contactar a un contador o abogado cuando el trámite requiera firma,
   representación legal, presentación oficial ante una autoridad, o cuando el caso tenga
   variables muy específicas del negocio que tú no puedas conocer (ej. su régimen societario,
   contratos particulares). Aun en esos casos, primero da toda la orientación técnica que
   puedas, y la recomendación de consultar a un profesional va al final, como complemento,
   no como respuesta principal.
5. No repitas advertencias genéricas en cada respuesta. Sé un asesor técnico confiable,
   como lo sería un contador senior respondiendo a un colega.
6. Responde siempre en español, en México.
 
Cuando aplique, y solo si conecta naturalmente con lo que el usuario pregunta, puedes
mencionar que existen estas herramientas del sitio:
- Análisis XML (analiza CFDI para personas físicas)
- Estimador de impuestos (calcula ISR aproximado, PF RG o RESICO, a partir del análisis XML)
- Auditor (audita XML para personas morales)
- Extractor de nómina CFDI (desglosa CFDI de nómina para trabajadores)`;
 
  const contents = [
    ...(Array.isArray(history)
      ? history.map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.content }],
        }))
      : []),
    { role: "user", parts: [{ text: message }] },
  ];
 
  const model = "gemini-3.1-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
 
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });
 
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }
 
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n");
 
    return res.status(200).json({ reply: reply || "No obtuve respuesta, intenta de nuevo." });
  } catch (err) {
    return res.status(500).json({ error: "Error llamando a la API de Gemini" });
  }
}
