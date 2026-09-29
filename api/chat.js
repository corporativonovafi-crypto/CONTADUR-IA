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

/* Qué variante de búsqueda funcionó la última vez. Vive en la memoria del proceso: con
   una instancia tibia, las siguientes peticiones no vuelven a probar variantes que ese
   servicio ya rechazó. Importa porque en la capa gratuita la búsqueda NO está disponible
   por API (rechaza la herramienta) y cada intento fallido consume cuota igual.
   Se olvida cada 30 minutos para que, si activas la facturación, la búsqueda vuelva sola. */
let variantePreferida = 0;
let varianteDesde = 0;
let motivoSinBusqueda = "";   // por qué se está contestando sin búsqueda

/* Traduce el rechazo de Google a algo que el usuario pueda entender y, sobre todo, que le
   diga qué hacer. El texto original queda en los registros de Vercel. */
function resumirMotivoBusqueda(t) {
  if (/free tier|billing|quota|permission|not available/i.test(t)) {
    return "tu proyecto no tiene la búsqueda habilitada: la capa gratuita de la API no la incluye";
  }
  if (/not supported|unsupported/i.test(t)) return "este modelo no acepta la búsqueda";
  return String(t).replace(/\s+/g, " ").slice(0, 140);
}

function varianteInicial() {
  if (Date.now() - varianteDesde > 30 * 60 * 1000) return 0;   // se vuelve a probar
  return variantePreferida;
}

function recordarVariante(i) {
  variantePreferida = i;
  varianteDesde = Date.now();
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
TIENES BÚSQUEDA EN INTERNET: USARLA ES TU TRABAJO
═══════════════════════════════════════════
Tienes activada la búsqueda de Google. Eso cambia tu responsabilidad: consultar la ley,
confirmar la vigencia y verificar las cifras oficiales LO HACES TÚ, no el usuario. Es
justamente para lo que te está usando.

Reglas de la búsqueda:
- Antes de afirmar cualquier dato que cambie con el tiempo (tarifas, UMA, topes, recargos,
  INPC, plazos, reformas), BÚSCALO y respóndelo con la cifra correcta. Ya puedes hacerlo.
- NUNCA le digas al usuario que consulte la ley, que revise el DOF, que entre al portal del
  SAT ni nada parecido. Él te está pagando para no tener que hacer eso. Consúltala tú.
- PROHIBIDO escribir "nota de vigencia", "te sugiero confirmar el texto exacto",
  "consúltala directamente en diputados.gob.mx" o cualquier variante que le pase la tarea.
- Fundamenta siempre: di el ordenamiento y el artículo del que sale lo que afirmas (por
  ejemplo "Artículo 57 de la Ley del Impuesto sobre la Renta"). Cuando el dato venga de una
  búsqueda, la fuente queda registrada sola; tú solo cuida que lo que afirmes corresponda a
  lo que dice esa fuente.
- Si después de buscar no encuentras el dato, dilo como una limitación TUYA y da la mejor
  respuesta posible con lo que sí sabes. Nunca lo conviertas en una tarea para él.
- No busques por buscar: la búsqueda es para verificar y fundamentar, no para cada frase.

═══════════════════════════════════════════
LO QUE SÍ RESPONDES SIN DUDAR (es la mayoría de las preguntas)
═══════════════════════════════════════════
Y no confundas esto con negarte: la mayoría de las consultas de un despacho no necesita
búsqueda. Todo esto es tuyo y lo contestas completo, con seguridad y sin advertencias:
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

Cuando te pregunten por alguno de estos, en este orden:
1. BÚSCALO. Son datos verificables y tienes búsqueda: búscalos en la fuente oficial y
   contesta con la cifra correcta, fundamentada.
2. Si la búsqueda no lo confirma (o el dato todavía no existe, por ejemplo un ejercicio
   futuro), explica el CRITERIO y el CÓMO —eso sí lo dominas— y di que no lo pudiste
   confirmar TÚ. Sin pedirle al usuario que lo haga.
3. Si el usuario te da la cifra o el documento, úsalo TAL CUAL y dile que trabajas con el
   dato que él te dio, además de lo que hayas encontrado.

Regla de origen: distingue siempre de dónde sale lo que afirmas —
(a) "según tu documento", cuando viene del archivo que te compartieron,
(b) "criterio general", cuando es estructura, método o criterio de la ley,
(c) "no lo pude confirmar", cuando es un dato de la lista negra que la búsqueda no aclaró,
(d) "según lo que encontré", cuando viene de la búsqueda que hiciste.
No los mezcles sin decirlo. Y cuando el dato venga de una búsqueda, dilo con naturalidad:
"lo verifiqué y…", "acorde al texto vigente del artículo…".

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

Obligatorio al usarlos: di que son datos de 2026. Si el asunto del usuario es de otro
ejercicio, NO los apliques: búscalos de ese año. Nunca inventes el equivalente.

Lo que NO viene aquí (subsidio para el empleo, INPC, recargos, topes de IMSS e INFONAVIT,
montos de estímulos, fechas de obligaciones) también lo puedes usar, pero búscalo primero:
no lo des de memoria.

═══════════════════════════════════════════
REGLAS DE FUENTES OFICIALES (para citar con precisión y decir al usuario dónde confirmar)
═══════════════════════════════════════════
Antes de responder algo jurídico, fiscal, laboral, mercantil o de otra materia legal,
identifica: (1) jurisdicción — federal, estatal o municipal, (2) entidad federativa si aplica,
(3) materia, (4) tipo de ordenamiento (ley, código, reglamento, NOM, etc.), (5) vigencia,
(6) si hay reformas recientes. Nunca asumas que una norma federal aplica cuando el asunto
es estatal o municipal, ni al revés.

Fuentes oficiales, en este orden de autoridad. Ya puedes consultarlas con la búsqueda:
úsalas, y cita el ordenamiento con su artículo cuando fundamentes.
1. Diario Oficial de la Federación (dof.gob.mx) o Periódico Oficial estatal — para confirmar
   publicación, reformas, fecha de entrada en vigor.
2. Cámara de Diputados (diputados.gob.mx/LeyesBiblio) — leyes y códigos federales vigentes
   (CFF, LISR, LIVA, LFT, LSS, Constitución).
3. Congreso del estado correspondiente (p. ej. Jalisco: congresojal.gob.mx y su Biblioteca
   Virtual congresoweb.congresojal.gob.mx/bibliotecavirtual) para legislación estatal.
4. Ayuntamiento correspondiente + Congreso estatal + Periódico Oficial, para normativa
   municipal.
5. Orden Jurídico Nacional (ordenjuridico.gob.mx) como fuente institucional complementaria.

Nunca presentes una disposición como vigente sin haberla verificado, ni finjas haber
consultado algo que no consultaste. Distingue entre texto original, reformado, vigente,
abrogado o derogado. Si el usuario pregunta con palabras como "¿actualmente?", "¿está
vigente?", "¿ya cambió?", "¿con la reforma de 2026?" — BÚSCALO en el DOF o en el portal
del congreso, y contéstale con la vigencia correcta y la fecha de la reforma. Si la
búsqueda no lo aclara, dilo como tu limitación, sin mandarlo a consultar.

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
dato verificado, búscalo y respóndelo; si no lo encuentras, dilo como tu limitación.
Mantén siempre congruencia entre lo que respondes y las fuentes que citas.

Nota: la vigencia de las normas ahora la verificas TÚ con la búsqueda. Búscala, cita la
reforma con su fecha y contesta. Lo único prohibido es afirmar una vigencia sin haberla
consultado.

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
   límites por régimen), NO lo des de memoria: BÚSCALO y contesta con la cifra correcta.
   Si no lo encuentras, dilo tú, sin pedirle al usuario que lo busque.
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
/* Orden pensado para que el primero que responda SEPA BUSCAR: la documentación de Google
   lista con grounding a los Gemini 3.5 en adelante, y no lista a 3.1 Flash-Lite. Si algún
   modelo de la lista rechaza la herramienta, el código reintenta sin ella en vez de fallar. */
const MODELOS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
];
/* Un 429 significa dos cosas muy distintas: cuota DIARIA agotada (hay que esperar al día
   siguiente) o demasiadas peticiones por MINUTO (se recupera en segundos). El cuerpo del
   error dice cuál es, así que se le dice al usuario exactamente qué pasó. */
function explicar429(errText) {
  const t = String(errText || "");
  const porMinuto = /PerMinute|per minute|RPM/i.test(t) && !/PerDay|per day/i.test(t);
  const seg = (t.match(/retryDelay"?\s*:\s*"?(\d+)(?:\.\d+)?s/i) || [])[1];
  if (porMinuto) {
    return "Se hicieron demasiadas preguntas en muy poco tiempo" +
      (seg ? " (Google pide esperar " + seg + " segundos)" : "") +
      ". Espera " + (seg ? seg + " segundos" : "un minuto") + " y vuelve a intentar.";
  }
  return "Se agotó la cuota gratuita de Gemini. El contador se reinicia a la medianoche " +
         "del Pacífico, que en México es entre la 1 y las 2 de la madrugada. " +
         "Si esto pasa durante el piloto, conviene activar la facturación de la API.";
}

/* ¿El error es DE ESE MODELO (conviene probar el siguiente de la lista) o es de la
   llave/cuenta (insistir no sirve)? Antes, cualquier error raro tumbaba la petición
   completa: un modelo no disponible para la llave dejaba sin servicio a los demás. */
function esErrorDelModelo(status, errText) {
  const t = String(errText || "");
  if (/api[_ ]?key|billing|cuota del proyecto|PERMISSION_DENIED|expired|invalid key/i.test(t)) return false;
  if (status === 404) return true;                       // el modelo no existe o no está habilitado
  return /gemini-[0-9]|not supported|not found|does not exist|not available|unsupported|no such model/i.test(t);
}

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

  const cuerpoBase = {
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
  };

  /* Búsqueda real de Google. Los modelos Gemini 3 la soportan; si alguno de la lista no la
     acepta, se reintenta con la variante siguiente en vez de perder la respuesta.
     Se prueban dos nombres porque Google los ha ido cambiando entre versiones. */
  /* La documentación de Google dice: "los modelos viejos usan google_search_retrieval;
     para todos los modelos actuales usa google_search". Todos los de MODELOS son Gemini 3,
     así que la variante vieja sobra y solo gastaba llamadas. */
  const VARIANTES_BUSQUEDA = [
    { id: "google_search", tools: [{ google_search: {} }] },
    { id: "sin_busqueda", tools: null },
  ];
  const cuerpoCon = (variante) => {
    const c = {
      contents: cuerpoBase.contents,
      systemInstruction: cuerpoBase.systemInstruction,
      generationConfig: cuerpoBase.generationConfig,
    };
    if (variante.tools) c.tools = variante.tools;
    return JSON.stringify(c);
  };

  /* Saca de la respuesta las fuentes que Google devolvió, en cualquiera de los formatos
     que usa la API (groundingMetadata o annotations). */
  function rastroDeBusqueda(data) {
    const cand = (data && data.candidates && data.candidates[0]) || {};
    const gm = cand.groundingMetadata || {};
    const fuentes = [];
    const vistos = new Set();
    const agrega = (url, titulo) => {
      if (!url || vistos.has(url)) return;
      vistos.add(url);
      fuentes.push({
        url: String(url).slice(0, 500),
        titulo: String(titulo || String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0]).slice(0, 120),
      });
    };
    for (const ch of gm.groundingChunks || []) agrega(ch && ch.web && ch.web.uri, ch && ch.web && ch.web.title);
    for (const parte of cand.content && cand.content.parts ? cand.content.parts : []) {
      for (const a of parte.annotations || []) {
        agrega((a.url_citation && a.url_citation.url) || a.url, (a.url_citation && a.url_citation.title) || a.title);
      }
    }
    return { fuentes: fuentes.slice(0, 8), consultas: gm.webSearchQueries || [] };
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let ultimo = { status: 0, texto: "" };
  const probados = [];

  try {
    /* El orden de intentos importa: primero TODOS los modelos con búsqueda y, solo si
       ninguno la acepta, se contesta sin ella. Así el orden de MODELOS ya no decide si
       hay búsqueda: si cualquiera de la lista la soporta, se usa. */
    let iVar = varianteInicial();
    let algunRechazoDeHerramienta = false;

    buscar:
    for (; iVar < VARIANTES_BUSQUEDA.length; iVar++) {
      for (const modelo of MODELOS) {
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY1}`;

        for (let intento = 1; intento <= MAX_INTENTOS; intento++) {

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: cuerpoCon(VARIANTES_BUSQUEDA[iVar]),
        });

        if (response.ok) {
          const data = await response.json();
          const reply = data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            .filter(Boolean)
            .join("\n");
          const rastro = rastroDeBusqueda(data);
          recordarVariante(iVar);
          if (VARIANTES_BUSQUEDA[iVar].tools) motivoSinBusqueda = "";
          return res.status(200).json({
            reply: reply || "No obtuve respuesta, intenta de nuevo.",
            fuentes: rastro.fuentes,
            consultas: rastro.consultas,
            busqueda: !!VARIANTES_BUSQUEDA[iVar].tools,
            motivoBusqueda: VARIANTES_BUSQUEDA[iVar].tools ? null : resumirMotivoBusqueda(motivoSinBusqueda),
            modelo,
          });
        }

        const errText = await response.text();
        ultimo = { status: response.status, texto: String(errText), modelo };
        probados.push(`${modelo}: HTTP ${response.status}`);

        // El modelo no existe o lo retiraron: pasar al siguiente de la lista.
        if (response.status === 404) break;

        // Cuota agotada. NO se reintenta el mismo modelo: si la cuota es por modelo, el
        // siguiente sí responde; y si es un límite por minuto, se reintenta una sola vez
        // al final de la lista. Antes esto gastaba 10 llamadas por pregunta.
        if (response.status === 429) break;

        // Saturación o falla temporal de Google: reintentar con espera.
        if (response.status >= 500) {
          if (intento < MAX_INTENTOS) {
            await esperar(ESPERAS[Math.min(intento - 1, ESPERAS.length - 1)]);
            continue;
          }
          break;
        }

        // Este modelo no acepta la búsqueda: se prueba el SIGUIENTE modelo con búsqueda
        // (quizá sí la soporte). Solo si ninguno la acepta se contesta sin ella.
        // (va antes de la revisión de "modelo no disponible": el mensaje de rechazo de la
        //  herramienta también dice "not supported" y se confundiría con un modelo caído)
        if (response.status === 400 && /tool|google_search|grounding|search/i.test(errText)) {
          algunRechazoDeHerramienta = true;
          motivoSinBusqueda = String(errText);
          console.log("[chat] búsqueda rechazada por", modelo, ":", String(errText).slice(0, 300));
          probados.push(`${modelo}: no acepta búsqueda`);
          ultimo = { status: 400, texto: errText, modelo };
          break;
        }

        // Si el problema es de ESE modelo (no existe, no está habilitado para la llave),
        // se prueba el siguiente de la lista en vez de tirar la petición completa.
        if (esErrorDelModelo(response.status, errText) && MODELOS.indexOf(modelo) < MODELOS.length - 1) {
          probados.push(`${modelo}: HTTP ${response.status} (no disponible)`);
          ultimo = { status: response.status, texto: errText, modelo };
          break;
        }

        // Errores de la llave o de la cuenta (401, 403, 402) no se arreglan reintentando.
        return res.status(response.status).json({ error: String(errText).slice(0, 600) });
      }
    }

      // Se terminó la pasada de esta variante. Si nadie aceptó la búsqueda y queda la
      // variante sin ella, se intenta; si el problema fue otro (cuota, modelo), se corta.
      if (!algunRechazoDeHerramienta || iVar === VARIANTES_BUSQUEDA.length - 1) break buscar;
      algunRechazoDeHerramienta = false;
    }

    // Última oportunidad: si los 429 eran por límite POR MINUTO, ya se liberó.
    if (ultimo.status === 429) {
      await esperar(5000);
      const r2 = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELOS[0]}:generateContent?key=${process.env.GEMINI_API_KEY1}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: cuerpoCon(VARIANTES_BUSQUEDA[varianteInicial()]),
        }
      );
      if (r2.ok) {
        const data = await r2.json();
        const rastro = rastroDeBusqueda(data);
        recordarVariante(0);
        const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n");
        motivoSinBusqueda = "";
        return res.status(200).json({
          reply: reply || "No obtuve respuesta, intenta de nuevo.",
          fuentes: rastro.fuentes,
          consultas: rastro.consultas,
          busqueda: true,
          motivoBusqueda: null,
          modelo: MODELOS[0],
        });
      }
      ultimo = { status: r2.status, texto: await r2.text(), modelo: MODELOS[0] };
    }

    // El detalle completo queda en los registros de Vercel; al usuario se le da un
    // mensaje claro y corto (los nombres de los modelos no le dicen nada).
    console.log("[chat] falló todo:", probados.join(" | "));

    if (ultimo.status === 429) {
      return res.status(429).json({ error: explicar429(ultimo.texto) });
    }

    // Ningún modelo de la lista quedó disponible: hay que revisar la lista, no la llave.
    if ([400, 403, 404].includes(ultimo.status) && esErrorDelModelo(ultimo.status, ultimo.texto)) {
      return res.status(503).json({
        error: "Ninguno de los modelos configurados está disponible para esta llave. " +
               "Revisa la lista de MODELOS en api/chat.js o el acceso de tu proyecto en Google AI Studio.",
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
