/* ============================================================================
   api/chat.js  —  Asistente fiscal
   Cambios respecto a tu versión anterior (todo lo demás queda igual):
     1. Acepta `attachments` para analizar archivos.
        - { name, text }                 -> documentos de texto (Excel/CSV/PDF/TXT)
        - { name, mimeType, data }       -> imágenes y PDF escaneado (base64)
     2. Reintenta solo si Google está saturado y cambia de modelo.
     3. Si abres esta dirección en el navegador (GET), te dice qué modelos acepta
        tu llave. No expone la clave.
   El system prompt quedó EXACTAMENTE como lo tenías.
   ============================================================================ */

// Permite subir imágenes de hasta ~5 MB. Si tu API no es de Next.js, esta línea
// simplemente se ignora.
export const config = { api: { bodyParser: { sizeLimit: "6mb" } } };

/* Si quieres poder probar el chat desde otro sitio (por ejemplo el editor en
   línea), deja ["*"]. Si prefieres que SOLO tu dominio pueda usarlo, cambia la
   lista por tus direcciones, por ejemplo:
   const ORIGENES_PERMITIDOS = ["https://mi-sitio.vercel.app"];            */
const ORIGENES_PERMITIDOS = ["*"];

function aplicarCors(req, res) {
  const origen = (req.headers && req.headers.origin) || "";
  const ok = ORIGENES_PERMITIDOS.includes("*")
    ? origen || "*"
    : (ORIGENES_PERMITIDOS.includes(origen) ? origen : "");
  if (ok) {
    res.setHeader("Access-Control-Allow-Origin", ok);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

const SYSTEM_PROMPT = `Eres un experto senior en materia FISCAL, CONTABLE, FINANCIERA, DE COSTOS
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
  prorrateo de costos indirectos, desviaciones y precios por centro de costos.
- Tributario/Laboral: IMSS (cuotas obrero-patronales, registro patronal, EMA/EBA),
  INFONAVIT, nómina, nómina 1.2, CFDI de nómina.
- Legal básico relacionado (mercantil, laboral, civil) cuando se cruce con lo fiscal/contable.

═══════════════════════════════════════════
REGLAS DE FUENTES OFICIALES (obligatorio para temas legales/fiscales)
═══════════════════════════════════════════
Antes de responder algo jurídico, fiscal, laboral, mercantil o de otra materia legal,
identifica: (1) jurisdicción — federal, estatal o municipal, (2) entidad federativa si aplica,
(3) materia, (4) tipo de ordenamiento (ley, código, reglamento, NOM, etc.), (5) vigencia,
(6) si hay reformas recientes. Nunca asumas que una norma federal aplica cuando el asunto
es estatal o municipal, ni al revés.

Jerarquía de fuentes a verificar, en este orden:
1. Diario Oficial de la Federación (dof.gob.mx) o Periódico Oficial estatal — para confirmar
   publicación, reformas, fecha de entrada en vigor.
2. Cámara de Diputados (diputados.gob.mx/LeyesBiblio) — leyes y códigos federales vigentes
   (CFF, LISR, LIVA, LFT, LSS, Constitución).
3. Congreso del estado correspondiente (p. ej. Jalisco: congresojal.gob.mx y su Biblioteca
   Virtual congresoweb.congresojal.gob.mx/bibliotecavirtual) para legislación estatal.
4. Ayuntamiento correspondiente + Congreso estatal + Periódico Oficial, para normativa
   municipal.
5. Orden Jurídico Nacional (ordenjuridico.gob.mx) como fuente institucional complementaria.

Nunca presentes una disposición como vigente sin haber verificado su vigencia cuando la
pregunta lo requiera (usa la búsqueda para confirmarlo). Distingue entre texto original,
reformado, vigente, abrogado o derogado. Si el usuario pregunta algo con palabras como
"¿actualmente?", "¿está vigente?", "¿ya cambió?", "¿con la reforma de 2026?" — SIEMPRE
busca antes de responder, no respondas solo de memoria.

Al citar, indica: nombre del ordenamiento, artículo, fracción/inciso si aplica, y una
paráfrasis breve de la disposición (nunca copies el texto legal completo). No inventes
artículos, leyes, reformas ni fechas — si no puedes verificarlo, dilo explícitamente.

Fuentes prohibidas como base jurídica principal: blogs, foros, Wikipedia, páginas de
despachos o abogados, artículos comerciales, redes sociales, resúmenes o compilaciones
privadas. Solo úsalas como apoyo para entender el tema, nunca como fuente de la respuesta.

═══════════════════════════════════════════
DOMINIOS DE CONFIANZA POR ÁREA (usar la búsqueda con prioridad en estos)
═══════════════════════════════════════════
General (cualquier consulta):
- diputados.gob.mx/LeyesBiblio (LIVA, LISR, CFF, LSS, LFT)
- sat.gob.mx (Resolución Miscelánea Fiscal vigente)
- dof.gob.mx

Contabilidad (asientos y captura contable): priorizar NIF vigentes (fuentes tipo
imcp/gazhal, colegios de contadores públicos) y pensamiento contable estricto.

Fiscal (estrategias fiscales y legales): LIVA, LISR, RMF, CFF — combinar varias leyes
y criterios, priorizando siempre lo vigente.

Financiero (razones financieras y liquidez): pensar como experto en finanzas
corporativas con base en los estados financieros que te compartan; no hay fuente legal
fija, prioriza el análisis técnico correcto.

Costos (desviaciones y precios por centro de costos): prioriza los reportes de
presupuestos y costos que el usuario te comparta; no inventes cifras que no te dieron.

Regla transversal: NUNCA alucines cifras, artículos o cifras de tasas. Si no tienes el
dato verificado, dilo y ofrece buscarlo o sugiere confirmarlo en la fuente oficial.
Mantén siempre congruencia entre lo que respondes y las fuentes que citas.

Nota: no tienes acceso a búsqueda en vivo en este momento. Cuando el usuario pregunte
por vigencia actual de una norma o una reforma reciente que no puedas confirmar con
certeza, dilo explícitamente y sugiere verificarlo directamente en la fuente oficial
correspondiente (DOF, diputados.gob.mx, sat.gob.mx, o el congreso estatal), en vez de
afirmar algo que no puedes confirmar.

INSTRUCCIONES DE COMPORTAMIENTO:
1. Responde de forma directa, técnica y concreta. Si la pregunta tiene una respuesta
   calculable o basada en reglas claras (tasas, tablas de ISR, fórmulas), dala explícitamente
   con el cálculo o el criterio aplicable, no la evites.
2. Usa ejemplos numéricos cuando ayuden a clarificar (tasas, montos, fórmulas).
3. Cuando cites un dato que cambia con frecuencia (tasas de recargo, INPC, topes IMSS,
   límites de ingresos por régimen), verifícalo con la búsqueda antes de darlo como vigente.
4. Solo sugiere contactar a un contador o abogado cuando el trámite requiera firma,
   representación legal, presentación oficial ante una autoridad, o cuando el caso tenga
   variables muy específicas del negocio que tú no puedas conocer. Aun en esos casos,
   primero da toda la orientación técnica que puedas, y la recomendación de consultar a
   un profesional va al final, como complemento, no como respuesta principal.
5. No repitas advertencias genéricas en cada respuesta. Sé un asesor técnico confiable,
   como lo sería un contador senior respondiendo a un colega.
6. Responde siempre en español, en México.

Cuando aplique, y solo si conecta naturalmente con lo que el usuario pregunta, puedes
mencionar que existen estas herramientas del sitio:
- Análisis XML (analiza CFDI para personas físicas)
- Estimador de impuestos (calcula ISR aproximado, PF RG o RESICO, a partir del análisis XML)
- Auditor (audita XML para personas morales)
- Generador de pólizas (genera pólizas contables en formato genérico compatible con
  CONTPAQi, para empresas)
- Extractor de nómina CFDI (desglosa CFDI de nómina para trabajadores)
- Fedaria (asesoría de trámites ante corredores, fedatarios y notarios públicos, para empresas)
- Asesoría legal (formulario para plantear una duda directamente a un abogado, para
  trabajadores, personas físicas con negocio o empresas)
- Extractor de estado de cuenta (deja solo fecha, descripción, cargo, abono y póliza, y
  corre en el equipo del usuario sin enviar nada a internet)
- Conciliación bancaria (cruza el estado de cuenta contra el auxiliar de bancos)

Cuando te llegue un archivo adjunto, analízalo con base en lo que realmente contiene:
no supongas cifras que no aparezcan en el documento. Si el archivo está incompleto,
ilegible o no corresponde a lo que el usuario pide, dilo antes de responder.`;

/* Lista de modelos, en orden de preferencia. Si el primero esta saturado o ya
   no existe, se prueba el siguiente. Verificados contra la documentacion
   oficial el 24-sep-2026 (https://ai.google.dev/gemini-api/docs/models).
   Si algun dia Google retira uno, la respuesta de error te dira cual y podras
   cambiarlo aqui sin tocar nada mas. */
const MODELOS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];
const MAX_INTENTOS = 2;           // intentos por modelo antes de pasar al siguiente
const ESPERAS = [1500, 4000];     // espera entre reintentos (ms)

const recorte = (t) => String(t || "").replace(/\s+/g, " ").slice(0, 220);

const MAX_ADJUNTO_BYTES = 5 * 1024 * 1024;   // ~5 MB en base64
const MAX_TEXTO = 60000;                      // caracteres por archivo de texto
const MAX_ADJUNTOS = 6;

export default async function handler(req, res) {
  aplicarCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  // DIAGNÓSTICO: abre esta misma dirección en el navegador (sin nada más) y te
  // dice qué modelos acepta tu llave. No expone la clave.
  if (req.method === "GET") {
    if (!process.env.GEMINI_API_KEY1) {
      return res.status(500).json({ error: "Falta configurar GEMINI_API_KEY1 en Vercel" });
    }
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY1}&pageSize=200`
      );
      const texto = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: String(texto).slice(0, 600) });
      const data = JSON.parse(texto);
      const modelos = (data.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) &&
                       m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => String(m.name || "").replace("models/", ""));
      const faltantes = MODELOS.filter((m) => !modelos.includes(m));
      return res.status(200).json({
        resumen:
          "Tu llave puede usar estos modelos: " + modelos.join(", ") + ". " +
          (faltantes.length
            ? "OJO: de los que usa el asistente, NO están disponibles: " + faltantes.join(", ") +
              ". Quita esos de la lista MODELOS en api/chat.js."
            : "Los " + MODELOS.length + " modelos que usa el asistente SÍ están disponibles."),
        los_que_usa_el_asistente: MODELOS,
        disponibles_para_tu_llave: modelos,
        no_disponibles: faltantes,
      });
    } catch (e) {
      return res.status(500).json({
        error: "No se pudo consultar la lista de modelos: " + String((e && e.message) || e),
      });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { message, history, attachments } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Falta el mensaje" });
  }
  if (!process.env.GEMINI_API_KEY1) {
    return res.status(500).json({
      error: "Falta configurar GEMINI_API_KEY1 en las variables de entorno de Vercel",
    });
  }

  // Un turno = el texto del usuario más los archivos que adjuntó.
  const parts = [{ text: message }];
  let bytesBinarios = 0;

  const lista = Array.isArray(attachments) ? attachments.slice(0, MAX_ADJUNTOS) : [];
  for (const a of lista) {
    if (!a) continue;
    if (a.text) {
      parts.push({
        text: `\n\n--- Archivo adjunto: ${a.name || "documento"} ---\n${String(a.text).slice(0, MAX_TEXTO)}`,
      });
    } else if (a.data && a.mimeType) {
      bytesBinarios += String(a.data).length;
      if (bytesBinarios > MAX_ADJUNTO_BYTES) {
        return res.status(413).json({
          error: "Los archivos adjuntos pesan demasiado (máximo ~5 MB en total). Reduce la imagen o divídela.",
        });
      }
      parts.push({ inline_data: { mime_type: a.mimeType, data: a.data } });
    }
  }

  const contents = [
    ...(Array.isArray(history)
      ? history.map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: String(h.content || "") }],
        }))
      : []),
    { role: "user", parts },
  ];

  const cuerpo = JSON.stringify({
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: 1536 },
  });

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let ultimo = { status: 0, texto: "" };
  const probados = [];

  try {
    for (const modelo of MODELOS) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY1}`;

      for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: cuerpo,
        });

        if (response.ok) {
          const data = await response.json();
          const reply = data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            .filter(Boolean)
            .join("\n");
          return res.status(200).json({ reply: reply || "No obtuve respuesta, intenta de nuevo." });
        }

        const errText = await response.text();
        ultimo = { status: response.status, texto: String(errText), modelo };
        probados.push(`${modelo}: HTTP ${response.status}`);

        // El modelo no existe o lo retiraron: pasar al siguiente de la lista.
        if (response.status === 404) break;

        // Cuota agotada: un reintento corto y luego el siguiente modelo.
        if (response.status === 429) {
          if (intento === 1) { await esperar(1500); continue; }
          break;
        }

        // Saturación o falla temporal de Google: reintentar con espera.
        if (response.status >= 500) {
          if (intento < MAX_INTENTOS) {
            await esperar(ESPERAS[Math.min(intento - 1, ESPERAS.length - 1)]);
            continue;
          }
          break;
        }

        // Cualquier otro error (400, 403...) no se arregla reintentando.
        return res.status(response.status).json({ error: String(errText).slice(0, 600) });
      }
    }

    const detalle = probados.join(", ");

    if (ultimo.status === 429) {
      return res.status(429).json({
        error: "Se agotó la cuota gratuita de Gemini por ahora. Espera unos minutos o vuelve mañana; el contador se reinicia a medianoche, hora del Pacífico. (" + detalle + ")",
      });
    }

    // 404: el modelo ya no existe o no está disponible para esta cuenta.
    if (ultimo.status === 404) {
      return res.status(503).json({
        error: "Ninguno de los modelos configurados sirve para tu cuenta (" + MODELOS.join(", ") +
          "). Google respondió: \"" + recorte(ultimo.texto) + "\". Solución: cambia la lista MODELOS " +
          "al principio de api/chat.js por un modelo vigente; la lista oficial está en " +
          "https://ai.google.dev/gemini-api/docs/models (probados: " + detalle + ")",
      });
    }

    // 5xx: los servidores de Google están saturados.
    if (ultimo.status >= 500 || ultimo.status === 0) {
      return res.status(503).json({
        error: "Los servidores de Google están saturados en este momento (HTTP " + (ultimo.status || "sin respuesta") +
          "). No es tu sitio ni tu código: es demanda temporal. Probé " + MODELOS.length +
          " modelos (" + detalle + "). Espera unos segundos y dale a \"Reintentar\".",
      });
    }

    return res.status(ultimo.status || 500).json({
      error: "Gemini rechazó la consulta: " + recorte(ultimo.texto) + " (probados: " + detalle + ")",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Error llamando a la API de Gemini: " + String((err && err.message) || err).slice(0, 200),
    });
  }
}
