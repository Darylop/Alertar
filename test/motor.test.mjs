// Simulación completa del motor: SMN, Telegram y mapas falsos (no sale nada a Internet).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { usarDb, RedisLocal, K, db } from '../lib/db.js';

const llamadas = [];
let servidor, tile;

before(async () => {
  tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#dfe7ec' } }).png().toBuffer();
  servidor = http.createServer((req, res) => {
    if (req.url.startsWith('/tiles/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(tile);
    }
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => {
      const metodo = req.url.split('/').pop();
      const multipart = String(req.headers['content-type']).includes('multipart');
      let cuerpo = {};
      if (!multipart) try { cuerpo = JSON.parse(Buffer.concat(partes).toString()); } catch {}
      else {
        const t = Buffer.concat(partes).toString('latin1');
        cuerpo.chat_id = (t.match(/name="chat_id"\r\n\r\n([^\r]+)/) || [])[1];
        cuerpo.subida = true;
      }
      llamadas.push({ metodo, ...cuerpo });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (cuerpo.chat_id === '666') return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
      const result = metodo === 'sendPhoto' ? { photo: [{ file_id: 'chico' }, { file_id: 'FOTO-' + llamadas.length }] } : {};
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address();
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
  process.env.TILE_URL = `http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png`;
  process.env.TELEGRAM_BOT_TOKEN = 'prueba';
  process.env.SESSION_SECRET = 'x'.repeat(40);
});
after(() => servidor.close());

const cuadrado = [[-58.50, -34.65], [-58.40, -34.65], [-58.40, -34.55], [-58.50, -34.55], [-58.50, -34.65]];
const alerta = (extra = {}) => ({
  clave: 'tormentas|severe|a|b', event: 'Tormentas', severity: 'Severe', msgType: 'Alert',
  onset: new Date(Date.now() - 3600e3).toISOString(), expires: new Date(Date.now() + 6 * 3600e3).toISOString(),
  description: 'Área de cobertura afectada por tormentas fuertes.', instruction: '1- Evitá salir. 2- Desconectá los artefactos.',
  poligonos: [cuadrado], ...extra,
});
const feed = (grupos) => async () => ({ grupos, completo: true, archivos: grupos.length, errores: 0 });

function cliente(id, lon, lat, extra = {}) {
  return { id, nombre: id, email: `${id}@x.com`, creado: new Date().toISOString(), direccion: { texto: `Calle ${id}`, corta: `Calle ${id}`, lat, lon }, telegram: { chatId: extra.chat || id.replace(/\D/g, '') || '1' }, pago: { estado: extra.pago || 'activo' }, ...extra.otros };
}

async function cargar(clientes) {
  const { guardarUsuario } = await import('../lib/usuarios.js');
  for (const c of clientes) await guardarUsuario(c);
}

test('envía solo a quienes están dentro del radio y al día, sin repetir', async () => {
  usarDb(new RedisLocal(null));
  llamadas.length = 0;
  await cargar([
    cliente('u1', -58.45, -34.60), // dentro
    cliente('u2', -58.37, -34.60), // a ~2,7 km
    cliente('u3', -58.29, -34.60), // a ~10 km
    cliente('u4', -58.46, -34.61, { pago: 'sin_suscripcion' }), // no pagó
    cliente('u5', -58.47, -34.62, { pago: 'moroso', otros: {} }), // moroso sin fecha → fuera de gracia
  ]);
  const { procesar } = await import('../lib/procesar.js');
  const r1 = await procesar({ leer: feed([alerta()]) });
  assert.equal(r1.enviadas, 2, JSON.stringify(r1));
  const chats = llamadas.filter((l) => l.metodo === 'sendPhoto').map((l) => l.chat_id).sort();
  assert.deepEqual(chats, ['1', '2']);

  llamadas.length = 0;
  const r2 = await procesar({ leer: feed([alerta()]) });
  assert.equal(r2.enviadas, 0);
  assert.equal(llamadas.length, 0, 'no debe repetir');
});

test('cuando la alerta desaparece dos veces seguidas, avisa que se levantó', async () => {
  const { procesar } = await import('../lib/procesar.js');
  llamadas.length = 0;
  await procesar({ leer: feed([]) });
  assert.equal(llamadas.length, 0, 'la primera ausencia no concluye nada');
  const r = await procesar({ leer: feed([]) });
  assert.equal(r.levantadas, 2);
  assert.ok(llamadas.every((l) => l.metodo === 'sendMessage' && /Se levantó/.test(l.text)));
  assert.equal(Object.keys((await db().hgetall(K.alertas)) || {}).length, 0);
});

test('zona con muchos clientes: la imagen se sube una vez y se reutiliza', async () => {
  usarDb(new RedisLocal(null));
  process.env.MAPA_PERSONAL_MAX = '2';
  // Se vuelve a importar con la variable nueva.
  const { procesar } = await import('../lib/procesar.js?compartido');
  llamadas.length = 0;
  const muchos = Array.from({ length: 8 }, (_, i) => cliente('c' + (10 + i), -58.45 + i * 0.001, -34.60));
  await cargar(muchos);
  const r = await procesar({ leer: feed([alerta({ clave: 'otra' })]) });
  assert.equal(r.enviadas, 8);
  const fotos = llamadas.filter((l) => l.metodo === 'sendPhoto');
  assert.equal(fotos.filter((l) => l.subida).length, 1, 'una sola subida');
  assert.equal(fotos.filter((l) => typeof l.photo === 'string' && l.photo.startsWith('FOTO-')).length, 7);
  delete process.env.MAPA_PERSONAL_MAX;
});

test('quien bloqueó al bot queda marcado y no se reintenta', async () => {
  usarDb(new RedisLocal(null));
  const { procesar } = await import('../lib/procesar.js');
  await cargar([cliente('b1', -58.45, -34.60, { chat: '666' })]);
  const r = await procesar({ leer: feed([alerta({ clave: 'bloq' })]) });
  assert.equal(r.bloquearonBot, 1);
  const { leerUsuario } = await import('../lib/usuarios.js');
  assert.equal((await leerUsuario('b1')).telegram.bloqueado, true);
  llamadas.length = 0;
  await procesar({ leer: feed([alerta({ clave: 'bloq' })]) });
  assert.equal(llamadas.length, 0);
});

test('mapa personal: genera un PNG de 800×800', async () => {
  const { generarMapa } = await import('../lib/mapa.js');
  const png = await generarMapa(alerta(), { punto: { lon: -58.37, lat: -34.60 } });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 800);
});
