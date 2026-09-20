export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Falta el mensaje" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  const systemPrompt = `Eres el asistente de "Mis Herramientas Fiscales"...`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: message }] }]
        })
      }
    );

    const data = await response.json();

    // --- MODO DIAGNÓSTICO: quitar esto después ---
    return res.status(200).json({
      debug_status: response.status,
      debug_keyPresent: !!apiKey,
      debug_raw: data
    });
    // ----------------------------------------------
  } catch (err) {
    return res.status(500).json({ error: "Error al contactar a Gemini", detail: String(err) });
  }
}
