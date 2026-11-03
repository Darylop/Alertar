// Cliente mínimo de la Bot API de Telegram.
import crypto from 'node:crypto';
import { envOrThrow, MARCA } from './config.js';

const API = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export class ErrorTelegram extends Error {
  constructor(metodo, data, status) {
    super(`Telegram ${metodo}: ${data.description || status}`);
    this.codigo = data.error_code || status;
    this.reintentarEn = data.parameters?.retry_after || 0;
    // 403: la persona bloqueó al bot o borró el chat.
    this.bloqueado = this.codigo === 403;
  }
}

async function llamar(metodo, cuerpo, intentos = 3) {
  const token = envOrThrow('TELEGRAM_BOT_TOKEN').trim();
  for (let i = 0; ; i++) {
    const esForm = cuerpo instanceof FormData;
    const r = await fetch(`${API}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: esForm ? undefined : { 'Content-Type': 'application/json' },
      body: esForm ? cuerpo : JSON.stringify(cuerpo ?? {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (data.ok) return data.result;
    const e = new ErrorTelegram(metodo, data, r.status);
    // 429: demasiados mensajes; Telegram dice cuánto esperar.
    if (e.codigo === 429 && i < intentos) {
      await espera((e.reintentarEn || 1) * 1000 + 250);
      continue;
    }
    throw e;
  }
}

export function sendMessage(chatId, text, extra = {}) {
  return llamar('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

/**
 * Envía una foto. `foto` puede ser un PNG (Buffer) o un file_id de Telegram
 * de una foto ya subida (así una misma imagen se manda a miles sin volver a subirla).
 * Devuelve { mensaje, fileId }.
 */
export async function sendPhoto(chatId, foto, caption) {
  let res;
  if (typeof foto === 'string') {
    res = await llamar('sendPhoto', { chat_id: chatId, photo: foto, caption, parse_mode: 'HTML' });
  } else {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('caption', caption);
    fd.append('parse_mode', 'HTML');
    fd.append('photo', new Blob([foto], { type: 'image/png' }), 'alerta.png');
    res = await llamar('sendPhoto', fd);
  }
  const fotos = res?.photo || [];
  return { mensaje: res, fileId: fotos.length ? fotos[fotos.length - 1].file_id : null };
}

export function setWebhook(url, secretToken) {
  return llamar('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message'] });
}

export function getWebhookInfo() {
  return llamar('getWebhookInfo', {});
}

export function getMe() {
  return llamar('getMe', {});
}

export function setMyCommands() {
  return llamar('setMyCommands', {
    commands: [
      { command: 'estado', description: 'Ver si mis alertas están activas' },
      { command: 'id', description: 'Ver mi ID de Telegram' },
      { command: 'ayuda', description: 'Cómo funciona' },
    ],
  });
}

/** Secreto que Telegram manda en cada llamada al webhook (derivado de SESSION_SECRET). */
export function secretoWebhook() {
  return crypto.createHash('sha256').update('tg-webhook:' + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 48);
}

/** Aviso al administrador; nunca lanza error. */
export async function avisarAdmin(texto) {
  const admin = process.env.TELEGRAM_CHAT_ADMIN;
  if (!admin) return;
  try {
    await sendMessage(admin, `🤖 <b>${MARCA}</b>\n${texto}`);
  } catch (e) {
    console.error('No se pudo avisar al administrador', e.message);
  }
}

export const usuarioBot = () => String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

/**
 * Limitador para no superar el máximo de Telegram (unos 30 mensajes por segundo).
 * Ejecuta las tareas con `paralelo` envíos simultáneos y al menos `intervaloMs` entre inicios.
 */
export async function enviarEnTanda(tareas, { paralelo = 12, intervaloMs = 40, hasta = Infinity } = {}) {
  let i = 0;
  let ultimo = 0;
  const resultados = new Array(tareas.length);
  async function trabajador() {
    while (i < tareas.length) {
      if (Date.now() > hasta) return;
      const n = i++;
      const ahora = Date.now();
      const esperar = Math.max(0, ultimo + intervaloMs - ahora);
      ultimo = ahora + esperar;
      if (esperar) await espera(esperar);
      try {
        resultados[n] = { ok: true, valor: await tareas[n]() };
      } catch (e) {
        resultados[n] = { ok: false, error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, tareas.length) }, trabajador));
  return resultados;
}
