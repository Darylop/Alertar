// /api/geo — busca direcciones (Georef del Estado argentino y, si no alcanza, OpenStreetMap)
// y hace la búsqueda inversa cuando el cliente mueve el pin en el mapa.
import { json, error, parametro, manejar } from '../lib/http.js';
import { usuarioDeSesion, demasiadosIntentos } from '../lib/auth.js';
import { USER_AGENT } from '../lib/config.js';

const GEOREF = 'https://apis.datos.gob.ar/georef/api/direcciones';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

async function pedir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const corta = (a = {}) => [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
const lugar = (a = {}) => a.suburb || a.city_district || a.city || a.town || a.village || a.municipality || '';

async function buscarGeoref(q) {
  const d = await pedir(`${GEOREF}?direccion=${encodeURIComponent(q)}&max=5&aplanar=true`);
  return (d.direcciones || [])
    .filter((x) => Number.isFinite(x.ubicacion_lat) && Number.isFinite(x.ubicacion_lon))
    .map((x) => ({
      texto: [x.nomenclatura].filter(Boolean).join(', '),
      corta: [x.calle_nombre, x.altura_valor].filter(Boolean).join(' '),
      lat: x.ubicacion_lat,
      lon: x.ubicacion_lon,
      fuente: 'Georef',
    }));
}

async function buscarNominatim(q) {
  const d = await pedir(`${NOMINATIM}/search?format=jsonv2&countrycodes=ar&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`);
  return (d || []).map((x) => ({
    texto: x.display_name,
    corta: corta(x.address) || x.name || x.display_name.split(',')[0],
    lat: Number(x.lat),
    lon: Number(x.lon),
    fuente: 'OpenStreetMap',
  }));
}

export const GET = manejar(async (req) => {
  const u = await usuarioDeSesion(req);
  if (!u) return error('Ingresá para buscar direcciones.', 401);
  if (await demasiadosIntentos(`geo:${u.id}`, 60, 600)) return error('Demasiadas búsquedas seguidas. Esperá unos minutos.', 429);

  const lat = Number(parametro(req, 'lat'));
  const lon = Number(parametro(req, 'lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon) && parametro(req, 'lat') !== null) {
    try {
      const d = await pedir(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`);
      const c = corta(d.address);
      return json({ ok: true, texto: [c, lugar(d.address), d.address?.state].filter(Boolean).join(', ') || d.display_name || '', corta: c });
    } catch {
      return json({ ok: true, texto: '', corta: '' });
    }
  }

  const q = String(parametro(req, 'q') || '').trim().slice(0, 150);
  if (q.length < 4) return error('Escribí la calle y la altura.');
  let resultados = [];
  try {
    resultados = await buscarGeoref(q);
  } catch {}
  if (resultados.length < 2) {
    try {
      const vistos = new Set(resultados.map((r) => `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`));
      for (const r of await buscarNominatim(q)) {
        const k = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
        if (!vistos.has(k)) resultados.push(r);
      }
    } catch {}
  }
  return json({ ok: true, resultados: resultados.slice(0, 6) });
});
