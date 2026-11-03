// Lectura del feed CAP (Common Alerting Protocol) 1.2 del SMN.
import { XMLParser } from 'fast-xml-parser';
import { FEED_URL, USER_AGENT } from './config.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['info', 'area', 'polygon'].includes(name),
});

async function fetchTexto(url, { timeoutMs = 15000, intentos = 2 } = {}) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
      return await r.text();
    } catch (e) {
      ultimoError = e;
    }
  }
  throw ultimoError;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', deg: '°', hellip: '…', mdash: '—', ndash: '–' };

/**
 * Algunos archivos del SMN llegan con las tildes escritas como código (&#xE1;),
 * a veces doblemente escapadas. Esto las convierte en letras normales.
 */
export function decodificarEntidades(texto, pasadas = 3) {
  let t = String(texto ?? '');
  for (let i = 0; i < pasadas; i++) {
    const antes = t;
    t = t
      .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d{1,7});/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : m));
    if (t === antes) break;
  }
  return t;
}

/** Devuelve la lista de URL de archivos XML CAP que publica el feed. */
/**
 * El SMN publica onset/expires con los valores en UTC pero etiquetados "-03:00",
 * así que la hora queda 3 horas adelantada. Esto lo corrige (se puede desactivar
 * con CORREGIR_HORA_SMN=0 si el SMN arregla el origen).
 */
export function corregirHoraSMN(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || '');
  if (process.env.CORREGIR_HORA_SMN === '0') return String(iso);
  if (!/-03:?00$/.test(String(iso).trim())) return String(iso);
  return new Date(t - 3 * 60 * 60 * 1000).toISOString();
}

export function extraerEnlaces(textoFeed, base = FEED_URL) {
  const re = /(?:https?:\/\/[^\s"'<>]+|[^\s"'<>]*)CAP_[^\s"'<>]+?\.xml/gi;
  const set = new Set();
  for (const m of textoFeed.match(re) || []) {
    try {
      set.add(new URL(m.replace(/&amp;/g, '&'), base).href);
    } catch {}
  }
  return [...set];
}

/** Convierte "lat,lon lat,lon ..." en un anillo GeoJSON [[lon,lat], ...] cerrado. */
export function parsePoligono(texto) {
  const pts = String(texto)
    .trim()
    .split(/\s+/)
    .map((par) => par.split(',').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([lat, lon]) => [lon, lat]);
  if (pts.length < 3) return null;
  const [a, z] = [pts[0], pts[pts.length - 1]];
  if (a[0] !== z[0] || a[1] !== z[1]) pts.push([...a]);
  return pts.length >= 4 ? pts : null;
}

/** Parsea un XML CAP y devuelve una lista de alertas (una por bloque info). */
export function parseCap(xml, origen = '') {
  const doc = parser.parse(xml);
  const alert = doc.alert;
  if (!alert) throw new Error(`XML sin elemento <alert>: ${origen}`);
  const salida = [];
  for (const info of alert.info || []) {
    const poligonos = [];
    for (const area of info.area || []) {
      for (const p of area.polygon || []) {
        const anillo = parsePoligono(typeof p === 'string' ? p : p?.['#text'] ?? '');
        if (anillo) poligonos.push(anillo);
      }
    }
    salida.push({
      identifier: String(alert.identifier || ''),
      msgType: String(alert.msgType || 'Alert'),
      sent: String(alert.sent || ''),
      references: String(alert.references || ''),
      event: decodificarEntidades(info.event || info.headline || 'Alerta'),
      severity: String(info.severity || ''),
      onset: corregirHoraSMN(info.onset || info.effective || alert.sent || ''),
      expires: corregirHoraSMN(info.expires || ''),
      onsetXml: String(info.onset || info.effective || alert.sent || ''),
      expiresXml: String(info.expires || ''),
      description: decodificarEntidades(info.description || '').trim(),
      instruction: decodificarEntidades(info.instruction || '').trim(),
      poligonos,
      origen,
    });
  }
  return salida;
}

/** Clave estable de agrupación: evento + severidad + inicio + fin. */
export function claveGrupo(a) {
  const norm = (s) => String(s).trim().toLowerCase();
  const t = (s) => {
    const d = Date.parse(s);
    return Number.isFinite(d) ? new Date(d).toISOString() : norm(s);
  };
  // La clave usa los valores tal como vienen del XML, para que no cambie si se ajusta la hora.
  return [norm(a.event), norm(a.severity), t(a.onsetXml || a.onset), t(a.expiresXml || a.expires)].join('|');
}

/** Une los XML de una misma alerta (alertas_1, alertas_2, ...) en un solo grupo. */
export function agrupar(alertas) {
  const grupos = new Map();
  for (const a of alertas) {
    const clave = claveGrupo(a);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, ...a, poligonos: [], identifiers: [], origenes: [], partes: [], msgTypes: new Set() };
      grupos.set(clave, g);
    }
    g.poligonos.push(...a.poligonos);
    g.identifiers.push(a.identifier);
    if (a.origen && !g.origenes.includes(a.origen)) g.origenes.push(a.origen);
    if (a.poligonos.length) g.partes.push({ origen: a.origen, poligonos: a.poligonos });
    g.msgTypes.add(a.msgType);
    if (a.description.length > g.description.length) g.description = a.description;
    if ((a.instruction || '').length > (g.instruction || '').length) g.instruction = a.instruction;
  }
  for (const g of grupos.values()) {
    // Si alguna parte es Cancel, el grupo es Cancel; si alguna es Update, es Update.
    g.msgType = g.msgTypes.has('Cancel') ? 'Cancel' : g.msgTypes.has('Update') ? 'Update' : 'Alert';
    g.msgTypes = [...g.msgTypes];
  }
  return [...grupos.values()];
}

/**
 * Descarga el feed y todos sus XML. Usa una caché opcional (los archivos del SMN
 * no cambian una vez publicados porque el nombre lleva la fecha).
 * Devuelve { grupos, completo } — completo=false si algún XML no se pudo leer.
 */
export async function leerFeed({ cache } = {}) {
  const textoFeed = await fetchTexto(FEED_URL);
  const enlaces = extraerEnlaces(textoFeed);
  if (enlaces.length === 0 && !/<(rss|feed|channel)\b/i.test(textoFeed)) {
    throw new Error('La respuesta del SMN no parece un feed válido');
  }
  const enCache = cache ? await cache.leerVarios(enlaces) : {};
  const nuevos = {};
  let errores = 0;
  const resultados = await Promise.all(
    enlaces.map(async (url) => {
      if (enCache[url]) return enCache[url];
      try {
        const xml = await fetchTexto(url);
        const alertas = parseCap(xml, url);
        nuevos[url] = alertas;
        return alertas;
      } catch (e) {
        errores++;
        console.error('No se pudo leer', url, e.message);
        return [];
      }
    })
  );
  if (cache && Object.keys(nuevos).length) await cache.guardarVarios(nuevos);
  return { grupos: agrupar(resultados.flat()), completo: errores === 0, archivos: enlaces.length, errores };
}
