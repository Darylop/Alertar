import test from 'node:test';
import assert from 'node:assert/strict';
import { distanciaKm, indiceCuadricula, prepararPoligonos, bboxDe } from '../lib/geo.js';

// Cuadrado de ~11 km de lado sobre CABA.
const cuadrado = [[-58.50, -34.65], [-58.40, -34.65], [-58.40, -34.55], [-58.50, -34.55], [-58.50, -34.65]];

test('punto dentro del área: distancia 0', () => {
  assert.equal(distanciaKm(-58.45, -34.60, [cuadrado], 4), 0);
});

test('punto a ~2,7 km del borde: dentro del radio de 4 km', () => {
  const d = distanciaKm(-58.37, -34.60, [cuadrado], 4); // 0,03° de longitud ≈ 2,75 km
  assert.ok(d > 2.5 && d < 3, `distancia ${d}`);
});

test('punto a ~10 km: fuera del radio', () => {
  assert.equal(distanciaKm(-58.29, -34.60, [cuadrado], 4), Infinity);
});

test('índice por cuadrícula devuelve solo los cercanos', () => {
  const puntos = [{ id: 'a', lon: -58.45, lat: -34.6 }, { id: 'b', lon: -64.18, lat: -31.42 }];
  const idx = indiceCuadricula(puntos);
  const cerca = idx.cerca(bboxDe(prepararPoligonos([cuadrado])), 4).map((p) => p.id);
  assert.deepEqual(cerca, ['a']);
});

test('rendimiento: 50.000 clientes contra una alerta en menos de 1 s', () => {
  const puntos = Array.from({ length: 50000 }, (_, i) => ({ id: 'u' + i, lon: -65 + Math.random() * 10, lat: -38 + Math.random() * 8 }));
  const t = Date.now();
  const idx = indiceCuadricula(puntos);
  const pol = prepararPoligonos([cuadrado]);
  const n = idx.cerca(bboxDe(pol), 4).filter((p) => Number.isFinite(distanciaKm(p.lon, p.lat, pol, 4))).length;
  assert.ok(Date.now() - t < 1000, `tardó ${Date.now() - t} ms`);
  assert.ok(n >= 0);
});
