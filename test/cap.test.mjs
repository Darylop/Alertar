import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCap, agrupar } from '../lib/cap.js';
import { armarMensajes, largoVisible, LIMITE_CAPTION } from '../lib/texto.js';

const xml = fs.readFileSync(new URL('./fixtures/CAP_20260916201842_Tormenta_Llanura_alertas_alertas_1.xml', import.meta.url), 'utf8');

test('lee un XML real del SMN', () => {
  const [a] = parseCap(xml, 'x');
  assert.equal(a.event, 'Tormentas');
  assert.equal(a.severity, 'Moderate');
  assert.ok(a.poligonos[0].length > 100);
});

test('el mensaje no lleva enlaces a archivos CAP y entra en el límite', () => {
  const [g] = agrupar(parseCap(xml, 'https://ssl.smn.gob.ar/CAP/x.xml'));
  for (const distancia of [0, 2.3]) {
    const { caption, extra } = armarMensajes(g, { distancia, direccion: 'Av. Corrientes 1234' });
    assert.ok(!/CAP/.test(caption + (extra || '')), 'no debe mencionar archivos CAP');
    assert.ok(largoVisible(caption) <= LIMITE_CAPTION);
    assert.match(caption, /Av\. Corrientes 1234/);
    assert.match(caption, /Fuente: SMN/);
  }
});
