// Cálculos geográficos simples y rápidos (sin dependencias).
// A escala de pocos kilómetros se usa una proyección plana local: el error es despreciable.

const KM_LAT = 110.574;
const kmLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** ¿El punto [lon, lat] está dentro del anillo? (ray casting) */
export function puntoEnAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Distancia en km desde el punto al segmento a-b. */
function distSegmentoKm(lon, lat, a, b) {
  const kx = kmLon(lat);
  const ax = (a[0] - lon) * kx, ay = (a[1] - lat) * KM_LAT;
  const bx = (b[0] - lon) * kx, by = (b[1] - lat) * KM_LAT;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(px, py);
}

/** Rectángulo envolvente [minLon, minLat, maxLon, maxLat] de uno o varios anillos. */
export function bboxDe(anillos) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of anillos) for (const [x, y] of r) {
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }
  return [a, b, c, d];
}

/**
 * Distancia en km desde el punto al área de la alerta (0 si está adentro).
 * Devuelve Infinity si está más lejos que `maxKm` (descarte rápido).
 */
export function distanciaKm(lon, lat, poligonos, maxKm = Infinity) {
  const mLat = maxKm / KM_LAT;
  const mLon = maxKm / Math.max(kmLon(lat), 1e-6);
  let mejor = Infinity;
  for (const anillo of poligonos) {
    const bb = anillo.bbox || bboxDe([anillo]);
    if (lon < bb[0] - mLon || lon > bb[2] + mLon || lat < bb[1] - mLat || lat > bb[3] + mLat) continue;
    if (puntoEnAnillo(lon, lat, anillo)) return 0;
    for (let i = 0; i < anillo.length - 1; i++) {
      const d = distSegmentoKm(lon, lat, anillo[i], anillo[i + 1]);
      if (d < mejor) mejor = d;
    }
  }
  return mejor <= maxKm ? mejor : Infinity;
}

/** Agrega el rectángulo envolvente a cada anillo (acelera los cruces con miles de clientes). */
export function prepararPoligonos(poligonos) {
  return poligonos.map((r) => {
    const copia = r.slice();
    Object.defineProperty(copia, 'bbox', { value: bboxDe([r]), enumerable: false });
    return copia;
  });
}

/**
 * Índice por cuadrícula para no comparar cada alerta con todos los clientes.
 * celda ≈ 0,1° (unos 10 km).
 */
export function indiceCuadricula(puntos, celda = 0.1) {
  const mapa = new Map();
  const clave = (lon, lat) => `${Math.floor(lon / celda)}:${Math.floor(lat / celda)}`;
  for (const p of puntos) {
    const k = clave(p.lon, p.lat);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(p);
  }
  return {
    /** Puntos dentro del rectángulo (ampliado en `margenKm`). */
    cerca([a, b, c, d], margenKm = 0) {
      const mLat = margenKm / KM_LAT;
      const mLon = margenKm / kmLon((b + d) / 2);
      const x0 = Math.floor((a - mLon) / celda), x1 = Math.floor((c + mLon) / celda);
      const y0 = Math.floor((b - mLat) / celda), y1 = Math.floor((d + mLat) / celda);
      const out = [];
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > mapa.size) {
        // Alerta enorme: más rápido recorrer las celdas existentes.
        for (const [k, lista] of mapa) {
          const [x, y] = k.split(':').map(Number);
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push(...lista);
        }
        return out;
      }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const l = mapa.get(`${x}:${y}`);
        if (l) out.push(...l);
      }
      return out;
    },
  };
}

/** Zona de ~25 km para agrupar clientes que comparten la misma imagen de mapa. */
export function zonaMapa(lon, lat, celda = 0.25) {
  return `${Math.floor(lon / celda)}:${Math.floor(lat / celda)}`;
}

export const formatoKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
