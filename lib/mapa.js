// Genera un PNG de 800 × 800 px con mosaicos (tiles) de OpenStreetMap,
// el área de la alerta semitransparente y, si es un mapa personal, el punto del
// cliente con su radio de 4 km.
import sharp from 'sharp';
import fs from 'node:fs';
import opentype from 'opentype.js';
import path from 'node:path';
import { createRequire } from 'node:module';
import { USER_AGENT, nivelDe, RADIO_KM } from './config.js';
import { bboxDe } from './geo.js';

const TAM = 800;
const TILE = 256;
const TILE_URL = process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ZOOM_MAX = 13;
const ZOOM_MIN = 8;

// ---------- Fuentes (el texto se convierte en trazos para no depender del sistema) ----------
let fuentes;
function cargarFuentes() {
  if (fuentes !== undefined) return fuentes;
  try {
    let dir;
    try {
      dir = path.join(path.dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')), 'ttf');
    } catch {
      dir = new URL('./fonts/', import.meta.url).pathname;
    }
    const leer = (n) => {
      const b = fs.readFileSync(path.join(dir, n));
      return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    };
    fuentes = { normal: leer('DejaVuSans.ttf'), negrita: leer('DejaVuSans-Bold.ttf') };
  } catch (e) {
    console.error('No se pudieron cargar las fuentes; el mapa saldrá sin textos', e.message);
    fuentes = null;
  }
  return fuentes;
}

function textoSvg(texto, x, y, tam, { negrita = false, color = '#111' } = {}) {
  const f = cargarFuentes();
  if (!f) return { svg: '', ancho: 0 };
  const font = negrita ? f.negrita : f.normal;
  return { svg: `<path d="${font.getPath(texto, x, y, tam).toPathData(2)}" fill="${color}"/>`, ancho: font.getAdvanceWidth(texto, tam) };
}

// ---------- Proyección Web Mercator ----------
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

/** Círculo de `km` alrededor de [lon, lat] como anillo de 72 puntos. */
export function circulo(lon, lat, km, n = 72) {
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    r.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return r;
}

function cercanos(anillos, [x1, y1, x2, y2], margen) {
  return anillos.filter((r) => {
    const [a, b, c, d] = bboxDe([r]);
    return !(c < x1 - margen || a > x2 + margen || d < y1 - margen || b > y2 + margen);
  });
}

/** Elige zoom y centro: encuadra el foco (radio del cliente o zona) y, si entra, el área de la alerta. */
export function calcularVista(anillosAlerta, foco, zoomMin = ZOOM_MIN) {
  const [fx1, fy1, fx2, fy2] = foco;
  const cerca = cercanos(anillosAlerta, foco, 0.4);
  const [ax1, ay1, ax2, ay2] = cerca.length ? bboxDe(cerca) : foco;
  const b = [Math.min(fx1, ax1), Math.min(fy1, ay1), Math.max(fx2, ax2), Math.max(fy2, ay2)];
  const margen = TAM * 0.82;
  const entra = (bb, z) => lon2x(bb[2], z) - lon2x(bb[0], z) <= margen && lat2y(bb[1], z) - lat2y(bb[3], z) <= margen;
  let z = ZOOM_MAX;
  while (z > zoomMin && !entra(b, z)) z--;
  // Si la alerta es enorme, se prioriza que el foco se vea grande.
  let centroBox = entra(b, z) ? b : foco;
  if (!entra(b, z)) {
    z = ZOOM_MAX;
    while (z > zoomMin && !entra(foco, z)) z--;
    z = Math.max(zoomMin, z - 2);
    centroBox = foco;
  }
  const cx = (lon2x(centroBox[0], z) + lon2x(centroBox[2], z)) / 2;
  const cy = (lat2y(centroBox[1], z) + lat2y(centroBox[3], z)) / 2;
  return { z, x0: cx - TAM / 2, y0: cy - TAM / 2 };
}

// Caché de mosaicos en memoria: entre clientes de una misma zona se reutilizan.
const cacheTiles = new Map();
function bajarTile(z, x, y) {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const clave = `${z}/${xx}/${y}`;
  if (cacheTiles.has(clave)) return cacheTiles.get(clave);
  const p = (async () => {
    const url = TILE_URL.replace('{z}', z).replace('{x}', xx).replace('{y}', y);
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
        if (r.ok) return Buffer.from(await r.arrayBuffer());
      } catch {}
    }
    cacheTiles.delete(clave);
    return null;
  })();
  cacheTiles.set(clave, p);
  if (cacheTiles.size > 400) cacheTiles.delete(cacheTiles.keys().next().value);
  return p;
}

function rutaSvg(anillos, v) {
  return anillos
    .map((r) => 'M' + r.map(([lon, lat]) => `${(lon2x(lon, v.z) - v.x0).toFixed(1)},${(lat2y(lat, v.z) - v.y0).toFixed(1)}`).join('L') + 'Z')
    .join(' ');
}

/**
 * @param alerta { poligonos, severity, event }
 * @param opciones { punto?: {lon, lat}, centro?: [lon, lat] }
 *   punto  → mapa personal: marca el punto y su radio.
 *   centro → mapa compartido de una zona (sin datos de nadie).
 */
export async function generarMapa(alerta, { punto, centro } = {}) {
  const radio = punto ? circulo(punto.lon, punto.lat, RADIO_KM) : null;
  const c = punto ? [punto.lon, punto.lat] : centro || bboxDe(alerta.poligonos).slice(0, 2);
  const foco = radio ? bboxDe([radio]) : bboxDe([circulo(c[0], c[1], 12)]);
  // En el mapa personal el radio tiene que verse siempre (zoom mínimo 10, ~100 km de ancho).
  const vista = calcularVista(alerta.poligonos, foco, radio ? 10 : ZOOM_MIN);

  const tx0 = Math.floor(vista.x0 / TILE), ty0 = Math.floor(vista.y0 / TILE);
  const tx1 = Math.floor((vista.x0 + TAM - 1) / TILE), ty1 = Math.floor((vista.y0 + TAM - 1) / TILE);
  const pedidos = [];
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) pedidos.push(bajarTile(vista.z, tx, ty).then((buf) => ({ tx, ty, buf })));
  const tiles = await Promise.all(pedidos);
  const faltantes = tiles.filter((t) => !t.buf).length;

  const W = (tx1 - tx0 + 1) * TILE, H = (ty1 - ty0 + 1) * TILE;
  const base = await sharp({ create: { width: W, height: H, channels: 4, background: '#e8e4dc' } })
    .composite(tiles.filter((t) => t.buf).map((t) => ({ input: t.buf, left: (t.tx - tx0) * TILE, top: (t.ty - ty0) * TILE })))
    .png()
    .toBuffer();
  const recorte = await sharp(base)
    .extract({ left: Math.round(vista.x0 - tx0 * TILE), top: Math.round(vista.y0 - ty0 * TILE), width: TAM, height: TAM })
    .png()
    .toBuffer();

  const nivel = nivelDe(alerta.severity);
  const alertaPath = rutaSvg(cercanos(alerta.poligonos, foco, 3), vista);

  let capaCliente = '';
  if (radio) {
    const rp = rutaSvg([radio], vista);
    const px = lon2x(punto.lon, vista.z) - vista.x0;
    const py = lat2y(punto.lat, vista.z) - vista.y0;
    const etiqueta = textoSvg(`Tu zona · ${RADIO_KM} km`, 0, 0, 22, { negrita: true });
    const ex = Math.max(8, Math.min(TAM - etiqueta.ancho - 24, px - etiqueta.ancho / 2 - 8));
    const ey = Math.max(80, py - 62);
    const et = textoSvg(`Tu zona · ${RADIO_KM} km`, ex + 8, ey + 25, 22, { negrita: true, color: '#0D47A1' });
    capaCliente = `
  <path d="${rp}" fill="#1565C0" fill-opacity="0.08" stroke="#ffffff" stroke-width="6"/>
  <path d="${rp}" fill="none" stroke="#0D47A1" stroke-width="3" stroke-dasharray="10 7"/>
  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="13" fill="#0D47A1" stroke="#fff" stroke-width="4"/>
  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="#fff"/>
  <rect x="${ex}" y="${ey}" width="${et.ancho + 16}" height="34" rx="6" fill="#ffffff" fill-opacity="0.92"/>
  ${et.svg}`;
  }

  const tit = textoSvg(`Alerta ${nivel.nombre} · ${alerta.event}`, 52, 48, 30, { negrita: true });
  const textoAttr = '© OpenStreetMap contributors · Alertas: SMN';
  const attr = textoSvg(textoAttr, 0, 0, 16);
  const ax = TAM - attr.ancho - 12;
  const attrTxt = textoSvg(textoAttr, ax, TAM - 11, 16, { color: '#222' });
  const aviso = faltantes ? textoSvg('(mapa base incompleto)', 12, TAM - 10, 13, { color: '#555' }) : { svg: '' };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TAM}" height="${TAM}">
  <path d="${alertaPath}" fill="${nivel.color}" fill-opacity="0.38" stroke="${nivel.color}" stroke-width="2.5"/>
  ${capaCliente}
  <rect x="10" y="10" width="${tit.ancho + 56}" height="54" rx="8" fill="#ffffff" fill-opacity="0.92"/>
  <rect x="22" y="25" width="22" height="22" rx="4" fill="${nivel.color}" stroke="#333" stroke-width="1"/>
  ${tit.svg}
  <rect x="${ax - 6}" y="${TAM - 32}" width="${attr.ancho + 12}" height="26" rx="4" fill="#ffffff" fill-opacity="0.85"/>
  ${attrTxt.svg}
  ${aviso.svg}
</svg>`;

  return sharp(recorte).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}
