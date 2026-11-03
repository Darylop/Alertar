// /api/telegram
//   POST sin "accion"           → webhook: Telegram avisa acá cada mensaje que recibe el bot.
//   POST ?accion=vincular       → código QR / enlace para conectar la cuenta con Telegram.
//   POST ?accion=desvincular    → desconecta Telegram.
//   POST ?accion=prueba         → manda una alerta de ejemplo con el mapa del cliente.
//   GET                         → estado de la vinculación (la web lo consulta mientras muestra el QR).
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { db, K } from '../lib/db.js';
import { json, error, parametro, desdeLaWeb, manejar } from '../lib/http.js';
import { usuarioDeSesion, tokenAleatorio, demasiadosIntentos } from '../lib/auth.js';
import { leerUsuario, guardarUsuario, agregarHistorial, fichaPublica, leerConfig, estadoServicio, notificar } from '../lib/usuarios.js';
import { sendMessage, sendPhoto, secretoWebhook, usuarioBot } from '../lib/telegram.js';
import { mensajeBienvenida, armarMensajes, escapeHtml } from '../lib/texto.js';
import { generarMapa, circulo } from '../lib/mapa.js';
import { MARCA, RADIO_KM, urlSitio } from '../lib/config.js';

const igual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

const textoEstado = (u, config) => {
  const s = estadoServicio(u, config);
  if (s.recibe) return `✅ Tus alertas están <b>activas</b> para ${escapeHtml(u.direccion?.corta || 'tu dirección')} (radio de ${RADIO_KM} km).`;
  const que = { direccion: 'marcar tu dirección', telegram: 'vincular Telegram', pago: 'activar la suscripción' };
  const faltan = s.faltan.map((f) => que[f]).filter(Boolean);
  if (s.pago === 'moroso') return '⏸️ Tus alertas están <b>pausadas por falta de pago</b>. Regularizalo desde tu panel.';
  return `⏳ Tus alertas todavía no están activas. Te falta: ${faltan.join(', ') || 'completar tu cuenta'}.`;
};

/** Conecta el chat con la cuenta del código. */
async function vincular(chat, from, token) {
  const id = await db().get(K.link(token));
  const u = await leerUsuario(id);
  if (!u) {
    await sendMessage(chat.id, `⚠️ El código venció o ya se usó. Generá uno nuevo desde tu panel en ${urlSitio()}/panel`);
    return;
  }
  await db().del(K.link(token));
  const chatId = String(chat.id);
  // Si este chat estaba conectado a otra cuenta, se la desconecta.
  const otro = await db().hget(K.tg, chatId);
  if (otro && otro !== u.id) {
    const o = await leerUsuario(otro);
    if (o) {
      o.telegram = null;
      agregarHistorial(o, 'Telegram pasó a otra cuenta');
      await guardarUsuario(o);
    }
  }
  if (u.telegram?.chatId && String(u.telegram.chatId) !== chatId) await db().hdel(K.tg, String(u.telegram.chatId));
  u.telegram = {
    chatId,
    usuario: from?.username ? `@${from.username}` : '',
    nombre: [from?.first_name, from?.last_name].filter(Boolean).join(' '),
    vinculado: new Date().toISOString(),
  };
  agregarHistorial(u, `Vinculó Telegram (${chatId})`);
  await db().hset(K.tg, { [chatId]: u.id });
  await guardarUsuario(u);
  await notificar(u.id, 'ok', 'Telegram quedó vinculado. Ya te podemos enviar las alertas.');
  const config = await leerConfig();
  await sendMessage(chat.id, `${mensajeBienvenida(u.nombre?.split(' ')[0])}\n\nTu ID de Telegram: <code>${chatId}</code>\n\n${textoEstado(u, config)}`);
}

async function webhook(req) {
  if (!igual(req.headers.get('x-telegram-bot-api-secret-token'), secretoWebhook())) return new Response('No autorizado', { status: 401 });
  try {
    const upd = await req.json();
    const msg = upd.message;
    if (!msg?.chat || msg.chat.type !== 'private') return new Response('ok'); // solo chats privados
    const texto = String(msg.text || '').trim();
    const chatId = String(msg.chat.id);
    const m = texto.match(/^\/start(?:@\w+)?\s+([\w-]{10,64})$/);
    if (m) {
      await vincular(msg.chat, msg.from, m[1]);
      return new Response('ok');
    }
    const u = await leerUsuario(await db().hget(K.tg, chatId));
    if (/^\/id\b/i.test(texto)) {
      await sendMessage(chatId, `Tu ID de Telegram es: <code>${chatId}</code>`);
    } else if (/^\/estado\b/i.test(texto) || (/^\/start\b/i.test(texto) && u)) {
      await sendMessage(chatId, u ? textoEstado(u, await leerConfig()) : `Este chat no está vinculado a ninguna cuenta. Registrate en ${urlSitio()} y escaneá el código QR desde tu panel.`);
    } else {
      await sendMessage(
        chatId,
        `👋 Soy el bot de <b>${MARCA}</b>.\n\nTe aviso por acá cuando el Servicio Meteorológico Nacional emite una alerta que toca un radio de ${RADIO_KM} km de tu dirección, con el mapa del área.\n\n` +
          (u ? textoEstado(u, await leerConfig()) : `Para activarlo, registrate en ${urlSitio()} y escaneá el código QR desde tu panel.`) +
          `\n\nComandos: /estado · /id · /ayuda`
      );
    }
  } catch (e) {
    console.error('Error en el webhook de Telegram', e.message);
  }
  return new Response('ok'); // siempre 200 para que Telegram no reintente
}

export const POST = manejar(async (req) => {
  const accion = parametro(req, 'accion');
  if (!accion) return webhook(req);
  if (!desdeLaWeb(req)) return error('Solicitud no válida', 403);
  const u = await usuarioDeSesion(req);
  if (!u) return error('Tu sesión venció. Ingresá de nuevo.', 401);

  if (accion === 'vincular') {
    const bot = usuarioBot();
    if (!bot) return error('Falta configurar el bot (TELEGRAM_BOT_USERNAME).', 500);
    const token = tokenAleatorio(18);
    await db().set(K.link(token), u.id, { ex: 60 * 60 * 24 });
    const link = `https://t.me/${bot}?start=${token}`;
    const qr = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } });
    return json({ ok: true, link, qr, bot: `@${bot}` });
  }

  if (accion === 'desvincular') {
    if (u.telegram?.chatId) await db().hdel(K.tg, String(u.telegram.chatId));
    u.telegram = null;
    agregarHistorial(u, 'Desvinculó Telegram');
    await guardarUsuario(u);
    return json({ ok: true, usuario: fichaPublica(u, await leerConfig()) });
  }

  if (accion === 'prueba') {
    if (!u.telegram?.chatId) return error('Primero vinculá Telegram.');
    if (!u.direccion) return error('Primero marcá tu dirección.');
    if (await demasiadosIntentos(`prueba:${u.id}`, 3, 3600)) return error('Ya enviaste varias pruebas. Probá en un rato.', 429);
    const { lat, lon } = u.direccion;
    // Área de ejemplo: un óvalo que pasa sobre la dirección del cliente.
    const area = circulo(lon + 0.03, lat + 0.01, 6, 40);
    const alerta = {
      event: 'Tormentas',
      severity: 'Severe',
      onset: new Date().toISOString(),
      expires: new Date(Date.now() + 6 * 3600e3).toISOString(),
      description: 'Esto es un MENSAJE DE PRUEBA. Así se ve una alerta real: el mapa muestra el área afectada y tu zona.',
      instruction: '',
      poligonos: [area],
    };
    const { caption } = armarMensajes(alerta, { prefijo: '🧪 <b>PRUEBA</b>\n', distancia: 0, direccion: u.direccion.corta });
    try {
      let png = null;
      try {
        png = await generarMapa(alerta, { punto: { lon, lat } });
      } catch (e) {
        console.error('Falló el mapa de prueba', e.message);
      }
      if (png) await sendPhoto(u.telegram.chatId, png, caption);
      else await sendMessage(u.telegram.chatId, caption);
    } catch (e) {
      if (e.bloqueado) return error('No te pudimos escribir: parece que bloqueaste al bot. Desbloquealo en Telegram y probá de nuevo.');
      throw e;
    }
    if (u.telegram.bloqueado) {
      u.telegram.bloqueado = false;
      await guardarUsuario(u);
    }
    return json({ ok: true });
  }

  return error('Acción desconocida', 404);
});

export const GET = manejar(async (req) => {
  const u = await usuarioDeSesion(req);
  if (!u) return error('Tu sesión venció.', 401);
  return json({ ok: true, vinculado: !!u.telegram?.chatId, telegram: u.telegram ? { chatId: u.telegram.chatId, usuario: u.telegram.usuario } : null });
});
