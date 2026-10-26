// /api/admin?accion=... — panel de administración. Solo para los emails de ADMIN_EMAILS.
import { waitUntil } from '@vercel/functions';
import { db, K } from '../lib/db.js';
import { json, error, cuerpo, parametro, desdeLaWeb, manejar } from '../lib/http.js';
import { adminDeSesion } from '../lib/auth.js';
import { todosLosUsuarios, leerUsuario, guardarUsuario, agregarHistorial, estadoServicio, leerConfig, guardarConfig, notificar } from '../lib/usuarios.js';
import { sincronizarPago, avisarFaltaDePago } from '../lib/pagos.js';
import { sendMessage, setWebhook, getWebhookInfo, setMyCommands, secretoWebhook, getMe } from '../lib/telegram.js';
import { escapeHtml } from '../lib/texto.js';
import { urlSitio, MARCA } from '../lib/config.js';

/** Fila resumida de un cliente para la tabla. */
function fila(u, config, recibidas) {
  const s = estadoServicio(u, config);
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    telefono: u.telefono || '',
    creado: u.creado,
    direccion: u.direccion?.texto || '',
    lat: u.direccion?.lat ?? null,
    lon: u.direccion?.lon ?? null,
    telegram: u.telegram?.chatId ? { chatId: u.telegram.chatId, usuario: u.telegram.usuario || '', bloqueado: !!u.telegram.bloqueado } : null,
    pago: u.pago?.estado || 'sin_suscripcion',
    monto: u.pago?.monto || null,
    mpEmail: u.pago?.mpEmail || '',
    proximoCobro: u.pago?.proximoCobro || null,
    ultimoCobro: u.pago?.ultimoCobro || null,
    morosoDesde: u.pago?.morosoDesde || null,
    cortesia: !!u.cortesia,
    bloqueado: !!u.bloqueado,
    recibe: s.recibe,
    faltan: s.faltan,
    ultimaAlerta: recibidas[u.id] || null,
    nota: u.nota || '',
  };
}

const csvCelda = (v) => {
  const t = String(v ?? '');
  return /[",\n;]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t;
};

export const GET = manejar(async (req) => {
  const admin = await adminDeSesion(req);
  if (!admin) return error('Solo para administradores.', 403);
  const accion = parametro(req, 'accion');
  const config = await leerConfig();

  if (accion === 'clientes' || accion === 'csv') {
    const [usuarios, recibidas] = await Promise.all([todosLosUsuarios(), db().hgetall(K.recibidasU)]);
    const filas = usuarios.map((u) => fila(u, config, recibidas || {})).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    if (accion === 'csv') {
      const cols = ['nombre', 'email', 'telefono', 'creado', 'direccion', 'lat', 'lon', 'pago', 'monto', 'mpEmail', 'proximoCobro', 'ultimoCobro', 'recibe', 'cortesia', 'bloqueado', 'ultimaAlerta'];
      const lineas = [cols.join(','), ...filas.map((f) => cols.map((c) => csvCelda(f[c])).join(',')), ''];
      return new Response('﻿' + lineas.join('\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' },
      });
    }
    // Métricas
    const m = { total: filas.length, recibiendo: 0, activos: 0, morosos: 0, pendientes: 0, sinSuscripcion: 0, cancelados: 0, cortesia: 0, sinTelegram: 0, sinDireccion: 0, ingresoMensual: 0, nuevos7d: 0 };
    const hace7 = Date.now() - 7 * 864e5;
    for (const f of filas) {
      if (f.recibe) m.recibiendo++;
      if (f.pago === 'activo') { m.activos++; m.ingresoMensual += Number(f.monto || 0); }
      if (f.pago === 'moroso') m.morosos++;
      if (f.pago === 'pendiente') m.pendientes++;
      if (f.pago === 'sin_suscripcion') m.sinSuscripcion++;
      if (f.pago === 'cancelado') m.cancelados++;
      if (f.cortesia) m.cortesia++;
      if (!f.telegram) m.sinTelegram++;
      if (f.lat == null) m.sinDireccion++;
      if (Date.parse(f.creado) > hace7) m.nuevos7d++;
    }
    return json({ ok: true, clientes: filas, metricas: m, config });
  }

  if (accion === 'cliente') {
    const u = await leerUsuario(parametro(req, 'id'));
    if (!u) return error('No existe ese cliente.', 404);
    const recibidas = (await db().hgetall(K.recibidasU)) || {};
    const { passHash, ...resto } = u;
    return json({ ok: true, cliente: { ...resto, resumen: fila(u, config, recibidas) } });
  }

  if (accion === 'sistema') {
    const r = db();
    const [ultima, diario, activas, historial, fallasSmn, fallasTg] = await Promise.all([
      r.get(K.ultima),
      r.get('ar:ultimo-diario'),
      r.hgetall(K.alertas),
      r.lrange(K.historial, 0, 49),
      r.get(K.fallas('smn')),
      r.get(K.fallas('telegram')),
    ]);
    let webhook = null;
    let bot = null;
    try {
      [webhook, bot] = await Promise.all([getWebhookInfo(), getMe()]);
    } catch (e) {
      webhook = { error: e.message };
    }
    const alertas = Object.values(activas || {}).map((a) => ({ event: a.event, severity: a.severity, onset: a.onset, expires: a.expires, enviados: a.enviados || 0, levantada: !!a.levantada, creada: a.creada }));
    return json({
      ok: true,
      ultima,
      diario,
      alertas,
      historial: historial || [],
      fallas: { smn: Number(fallasSmn || 0), telegram: Number(fallasTg || 0) },
      telegram: { bot: bot ? `@${bot.username}` : null, webhook: webhook?.url || null, pendientes: webhook?.pending_update_count ?? null, ultimoError: webhook?.last_error_message || webhook?.error || null },
      variables: {
        TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_BOT_USERNAME: !!process.env.TELEGRAM_BOT_USERNAME,
        MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
        MP_WEBHOOK_SECRET: !!process.env.MP_WEBHOOK_SECRET,
        SMTP_USER: !!process.env.SMTP_USER,
        SMTP_PASS: !!process.env.SMTP_PASS,
        CRON_SECRET: !!process.env.CRON_SECRET,
        TELEGRAM_CHAT_ADMIN: !!process.env.TELEGRAM_CHAT_ADMIN,
      },
    });
  }

  return error('Acción desconocida', 404);
});

export const POST = manejar(async (req) => {
  if (!desdeLaWeb(req)) return error('Solicitud no válida', 403);
  const admin = await adminDeSesion(req);
  if (!admin) return error('Solo para administradores.', 403);
  const accion = parametro(req, 'accion');
  const b = await cuerpo(req);

  if (accion === 'config') {
    const cambios = {};
    if (b.precio !== undefined) {
      const p = Math.round(Number(b.precio));
      if (!(p >= 100 && p <= 1e7)) return error('Precio no válido.');
      cambios.precio = p;
    }
    if (b.graciaDias !== undefined) {
      const g = Math.round(Number(b.graciaDias));
      if (!(g >= 0 && g <= 30)) return error('Los días de gracia van de 0 a 30.');
      cambios.graciaDias = g;
    }
    return json({ ok: true, config: await guardarConfig(cambios) });
  }

  if (accion === 'webhook-telegram') {
    const url = `${urlSitio(req)}/api/telegram`;
    await setWebhook(url, secretoWebhook());
    await setMyCommands().catch(() => {});
    const info = await getWebhookInfo();
    return json({ ok: true, webhook: info.url });
  }

  if (accion === 'revisar-ahora') {
    if (!process.env.CRON_SECRET) return error('Falta CRON_SECRET.');
    waitUntil(fetch(`${urlSitio(req)}/api/revisar`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {}));
    return json({ ok: true });
  }

  if (accion === 'cliente') {
    const u = await leerUsuario(b.id);
    if (!u) return error('No existe ese cliente.', 404);
    const config = await leerConfig();
    switch (b.operacion) {
      case 'cortesia':
        u.cortesia = !u.cortesia;
        agregarHistorial(u, u.cortesia ? 'Admin: activó cortesía (gratis)' : 'Admin: quitó cortesía');
        break;
      case 'bloquear':
        u.bloqueado = !u.bloqueado;
        agregarHistorial(u, u.bloqueado ? 'Admin: suspendió la cuenta' : 'Admin: reactivó la cuenta');
        break;
      case 'nota':
        u.nota = String(b.nota || '').slice(0, 500);
        break;
      case 'sincronizar':
        try {
          await sincronizarPago(u.id);
        } catch (e) {
          return error(`Mercado Pago: ${e.message}`, 502);
        }
        return json({ ok: true });
      case 'recordatorio':
        if (!u.pago) u.pago = { estado: 'sin_suscripcion' };
        await avisarFaltaDePago(u, config);
        agregarHistorial(u, 'Admin: envió recordatorio de pago');
        break;
      case 'mensaje': {
        const texto = String(b.texto || '').trim().slice(0, 1500);
        if (!texto) return error('Escribí el mensaje.');
        if (!u.telegram?.chatId) return error('El cliente no tiene Telegram vinculado.');
        await sendMessage(u.telegram.chatId, `💬 <b>Mensaje de ${MARCA}</b>\n${escapeHtml(texto)}`);
        await notificar(u.id, 'info', texto);
        agregarHistorial(u, 'Admin: envió un mensaje');
        break;
      }
      default:
        return error('Operación desconocida.');
    }
    await guardarUsuario(u);
    return json({ ok: true });
  }

  return error('Acción desconocida', 404);
});
