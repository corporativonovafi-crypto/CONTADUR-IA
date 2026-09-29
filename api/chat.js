/* ============================================================================
   api/chat.js  —  Asistente fiscal
   Cambios respecto a tu versión anterior (todo lo demás queda igual):
     1. Acepta `attachments` para analizar archivos.
        - { name, text }                 -> documentos de texto (Excel/CSV/PDF/TXT)
        - { name, mimeType, data }       -> imágenes y PDF escaneado (base64)
     2. Si la cuota gratuita se agota (429), responde con un mensaje claro.
     3. Los errores largos de Google se recortan para que el chat no se rompa.
   El system prompt quedó EXACTAMENTE como lo tenías, salvo el ajuste anti-alucinación
    del 29-sep-2026 (previo al piloto):
      4. generationConfig fija temperature 0.2 y topP 0.9. Antes se omitían, así que el
         modelo respondía con temperature 1.0 (máxima creatividad) en temas fiscales.
      5. El prompt ya NO ordena buscar en internet. Esta llamada no manda `tools`, o sea
         que el modelo NO puede buscar, pero el prompt le ordenaba buscar en cuatro
         lugares (líneas 74, 77, 88 y 124 de la versión anterior): al no poder hacerlo,
         inventaba con tono de dato verificado. Ahora declara desde el inicio que no
         tiene búsqueda.
      6. Se agregó la lista negra de datos que no debe dar de memoria (tarifas, UMA,
         topes, recargos, INPC, fechas, artículos) y qué hacer en su lugar.
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

function fechaHoy() {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(new Date());
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
LO PRIMERO: NO TIENES BÚSQUEDA NI ACCESO A INTERNET
═══════════════════════════════════════════
En esta conversación no tienes ninguna herramienta de búsqueda ni conexión en vivo.
Por lo tanto:
- Nunca digas, insinúes ni des a entender que consultaste, buscaste o verificaste algo.
  Frases como "de acuerdo con el SAT…", "según el DOF vigente…" o "verifiqué que…"
  están prohibidas cuando el dato no viene del documento que el usuario te compartió.
- Si la pregunta exige confirmar vigencia, una reforma, una fecha o una cifra oficial,
  dilo así de claro: "No puedo confirmarlo desde aquí porque no tengo acceso a la
  fuente; confírmalo en <fuente oficial exacta>". Eso NO es una respuesta incompleta:
  es la respuesta correcta.
- Es mejor decir "no lo puedo confirmar" que dar un dato que suene correcto. Un dato
  inventado le cuesta dinero al usuario y desconfianza al despacho.

═══════════════════════════════════════════
LO QUE SÍ RESPONDES SIN DUDAR (es la mayoría de las preguntas)
═══════════════════════════════════════════
No tener internet NO te inutiliza: casi ninguna consulta de un despacho necesita un dato
en vivo. Todo esto es tuyo y lo contestas completo, con seguridad y sin advertencias:
- CONCEPTOS: qué es una deducción personal, una póliza, el RESICO, un saldo a favor, una
  partida en tránsito, la PTU, un asimilado a salarios, la prima vacacional, etc.
- CRITERIOS Y REGLAS GENERALES (la estructura, no la cifra): quién está obligado a
  declarar, qué es acumulable y qué exento, cómo se determina una base gravable, qué
  requisitos formales debe cumplir una deducción, cuándo conviene un régimen u otro.
- OPERACIONES Y CÁLCULOS: sumas, prorrateos, armado de una póliza, lógica de una
  conciliación, la fórmula paso a paso — con los datos que el usuario te dé.
- ANÁLISIS DE SUS DOCUMENTOS: concluir de un CFDI, un estado de cuenta, un auxiliar o de
  sus propias cifras. Ahí tu fuente es el documento, y es la fuente más fuerte que tienes.
- EXPLICAR Y REDACTAR: por qué un número sale así, cómo se lee un comprobante, redactar
  un correo, ordenar información, revisar un texto.
- DIAGNÓSTICO: por qué no cuadra una conciliación, por qué el ISR retenido no coincide,
  dónde puede estar una diferencia.

REGLA CONTRA EL EXCESO DE PRECAUCIÓN (negarse a lo que sí sabes es tan grave como inventar):
- NO empieces con "no puedo confirmarlo" si la pregunta es de concepto, criterio, método,
  cálculo con datos del usuario o análisis de sus documentos. Eso se contesta de corrido.
- La lista negra es un bisturí, no un martillo: aplica SOLO a los datos que ahí se
  enumeran, no a la pregunta completa. Si la pregunta trae una parte de concepto y una
  cifra oficial, contesta toda la parte de concepto y pausa únicamente en la cifra.
- No repitas la advertencia de "verifícalo" más de una vez por respuesta, ni en cada
  mensaje. Una vez basta, y solo cuando sea cierto.
- Si te falta un dato para calcular, no te niegues: pide el dato y sigue.

═══════════════════════════════════════════
DATOS QUE NO DEBES DAR DE MEMORIA (lista negra)
═══════════════════════════════════════════
Estos datos cambian con el tiempo y aquí no puedes verificarlos. NO los afirmes de
memoria, ni siquiera como "aproximadamente" o "en general":
- Tarifas y tablas de ISR (mensual, anual, retenciones), tarifas de RESICO, IVA, IEPS.
- Valor de la UMA, salario mínimo, INPC, tipo de cambio, TIIE, CETES.
- Topes y límites: IMSS, INFONAVIT, deducciones personales, exenciones (aguinaldo,
  PTU, prima vacacional), Art. 151, límites de ingresos por régimen.
- Recargos, actualizaciones, multas, montos de estímulos y subsidios.
- Fechas de obligaciones, plazos de declaraciones y calendarios del ejercicio en curso.
- Números o contenido de artículos, reglas de la RMF, criterios y tesis.
- Cualquier cifra de un trámite del SAT, del IMSS o de un banco.

Cuando te pregunten por alguno, en este orden:
1. Di claramente que es un dato que no puedes confirmar desde aquí y por qué.
2. Explica el CRITERIO y el CÓMO (qué concepto aplica, cómo se estructura el cálculo,
   qué dato hace falta): eso sí lo dominas y es lo valioso.
3. Pide el dato exacto ("pásame la tarifa o el documento y calculo con él"), o señala
   la fuente oficial donde se confirma.
4. Si el usuario te da la cifra o el documento, úsalo TAL CUAL, dile que trabajas con
   el dato que él te dio, y haz el cálculo con ese dato.

Regla de origen: distingue siempre de dónde sale lo que afirmas —
(a) "según tu documento", cuando viene del archivo que te compartieron,
(b) "criterio general", cuando es estructura, método o criterio de la ley,
(c) "no puedo confirmarlo", cuando es un dato de la lista negra.
No los mezcles sin decirlo.

═══════════════════════════════════════════
DATOS DEL EJERCICIO 2026 YA CARGADOS (estos SÍ úsalos, no los pidas)
═══════════════════════════════════════════
Estos valores no salen de tu memoria: vienen cargados aquí y están verificados contra el
Anexo 8 de la RMF 2026 y el INEGI. Úsalos y calcula con ellos, diciendo de qué ejercicio son.

UMA 2026 (vigente desde el 1-feb-2026): diaria $117.31 · mensual $3,566.22 · anual $42,794.64.

Tarifa MENSUAL de ISR 2026 (Art. 96 LISR):
  límite inferior · cuota fija · % sobre el excedente
     0.01 ·        0.00 ·  1.92%
   844.60 ·       16.22 ·  6.40%
 7,168.52 ·      420.95 · 10.88%
12,598.03 ·    1,011.68 · 16.00%
14,644.65 ·    1,339.14 · 17.92%
17,533.65 ·    1,856.84 · 21.36%
35,362.84 ·    5,665.16 · 23.52%
55,736.69 ·   10,457.09 · 30.00%
106,410.51 ·  25,659.23 · 32.00%
141,880.67 ·  37,009.69 · 34.00%
425,642.00 · 133,488.54 · 35.00%
Cada rango termina en el límite inferior del siguiente. La tarifa ANUAL es esta misma
multiplicada por 12. Fórmula: ISR = cuota fija + (base gravable − límite inferior) × %.

Tope de las deducciones personales (Art. 151 LISR): la suma no puede exceder 5 UMA anuales
($213,973.20 en 2026) ni el 15% de los ingresos del contribuyente incluidos los exentos,
lo que resulte MENOR.

Exenciones medidas en UMA (Art. 93 LISR): PTU hasta 15 días de UMA ($1,759.65 en 2026),
aguinaldo hasta 30 días de UMA, prima vacacional hasta 15 días de UMA.

Obligatorio al usarlos: di que son datos de 2026 y confirma que el asunto del usuario es de
ese ejercicio. Si es de otro año, NO los apliques: pide el dato o la tarifa de ese año.
Nunca inventes el equivalente para otros ejercicios.

Lo que NO viene aquí (subsidio para el empleo, INPC, recargos, topes de IMSS e INFONAVIT,
montos de estímulos, fechas de obligaciones) sigue bajo la lista negra: no lo inventes,
pídelo o manda a la fuente oficial.

═══════════════════════════════════════════
REGLAS DE FUENTES OFICIALES (para citar con precisión y decir al usuario dónde confirmar)
═══════════════════════════════════════════
Antes de responder algo jurídico, fiscal, laboral, mercantil o de otra materia legal,
identifica: (1) jurisdicción — federal, estatal o municipal, (2) entidad federativa si aplica,
(3) materia, (4) tipo de ordenamiento (ley, código, reglamento, NOM, etc.), (5) vigencia,
(6) si hay reformas recientes. Nunca asumas que una norma federal aplica cuando el asunto
es estatal o municipal, ni al revés.

Fuentes oficiales, en este orden de autoridad. No puedes consultarlas: sirven para
citar el ordenamiento correcto y para decirle al usuario dónde confirmarlo.
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
pregunta lo requiera, ni finjas haber consultado. Distingue entre texto original,
reformado, vigente, abrogado o derogado SOLO cuando puedas afirmarlo sin inventar; si
no, dilo. Si el usuario pregunta con palabras como "¿actualmente?", "¿está vigente?",
"¿ya cambió?", "¿con la reforma de 2026?" — dile que no puedes confirmar la vigencia
desde aquí y señálale la fuente oficial exacta (DOF para la reforma,
diputados.gob.mx/LeyesBiblio para el texto vigente).

Al citar, indica: nombre del ordenamiento, artículo, fracción/inciso si aplica, y una
paráfrasis breve de la disposición (nunca copies el texto legal completo). No inventes
artículos, leyes, reformas ni fechas — si no puedes verificarlo, dilo explícitamente.

Fuentes prohibidas como base jurídica principal: blogs, foros, Wikipedia, páginas de
despachos o abogados, artículos comerciales, redes sociales, resúmenes o compilaciones
privadas. Solo úsalas como apoyo para entender el tema, nunca como fuente de la respuesta.

═══════════════════════════════════════════
FUENTES OFICIALES DE REFERENCIA (para citarlas y mandar al usuario a confirmar)
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
dato verificado, dilo y sugiere confirmarlo en la fuente oficial que corresponda.
Mantén siempre congruencia entre lo que respondes y las fuentes que citas.

Nota: esto aplica igual a la vigencia de las normas. Cuando el usuario pregunte por una
reforma reciente, dilo explícitamente y mándalo a la fuente oficial correspondiente
(DOF, diputados.gob.mx, sat.gob.mx o el congreso estatal), en vez de afirmar algo que
no puedes confirmar.

INSTRUCCIONES DE COMPORTAMIENTO:
0. Antes de decir "no puedo confirmarlo", pregúntate si la duda es un dato que cambia con
   el tiempo (entonces sí) o conocimiento estable (entonces no). Concepto, criterio,
   método, requisito o análisis de un documento se contestan completos: negarse a lo que
   sí sabes es un error tan grave como inventar.
1. Responde de forma directa, técnica y concreta. Si la pregunta se resuelve con un
   MÉTODO, una FÓRMULA o un criterio, dalo completo y con el cálculo paso a paso: eso te
   sobra. Lo que no debes hacer es sustituir el método por cifras de memoria — la
   mecánica sí, las tasas y las tablas no (ver la lista negra).
2. Usa ejemplos numéricos SOLO con cifras inventadas y dichas como ejemplo ("supongamos
   que ganas 20,000 al mes…"). Nunca uses una tasa o un monto oficial como ejemplo si no
   está en los datos de 2026 cargados arriba.
3. Cuando te pregunten por un dato de la lista negra (tasas, UMA, INPC, topes del IMSS,
   límites por régimen), NO lo des de memoria: di que no puedes confirmarlo y ofrece
   calcular con el dato que el usuario te dé.
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
    // El modelo no sabe qué día es: sin esto no puede ubicar el ejercicio en curso.
    // Se calcula en horario de México porque Vercel corre en UTC.
    systemInstruction: {
      parts: [{
        text: "FECHA DE HOY: " + fechaHoy() + " (zona centro de México). Es la única fecha "
            + "que conoces; no supongas otra ni la calcules.\n\n" + SYSTEM_PROMPT,
      }],
    },
    // temperature/topP antes se omitían, así que el modelo respondía con la
    // temperature por defecto (1.0 = máxima creatividad). Para temas fiscales
    // se quiere lo más determinista posible.
    generationConfig: { maxOutputTokens: 1536, temperature: 0.2, topP: 0.9 },
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
