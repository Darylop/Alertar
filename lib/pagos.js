// Aplica a la ficha del cliente el estado de su suscripción y avisa los cambios
// (por correo, por Telegram y con una notificación en la web).
import { db, K } from './db.js';
import { leerSuscripcion, estadoDesdeMP, buscarPorReferencia } from './mp.js';
import { leerUsuario, guardarUsuario, agregarHistorial, notificar, leerConfig } from './usuarios.js';
import { enviarCorreo } from './email.js';
import { sendMessage } from './telegram.js';
import { MARCA, urlSitio } from './config.js';

const DIA = 864e5;
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '');

async function porTelegram(u, texto) {
  if (!u.telegram?.chatId || u.telegram.bloqueado) return false;
  try {
    await sendMessage(u.telegram.chatId, texto);
    return true;
  } catch {
    return false;
  }
}

/** Aviso de falta de pago por los tres canales. */
export async function avisarFaltaDePago(u, config) {
  const panel = `${urlSitio()}/panel`;
  const dias = config.graciaDias;
  const texto = `No pudimos cobrar tu suscripción de ${MARCA}. Tus alertas siguen activas ${dias} día${dias === 1 ? '' : 's'} más; después se pausan hasta que se regularice el pago.`;
  await notificar(u.id, 'pago', `${texto} Revisá tu medio de pago en Mercado Pago.`);
  await Promise.all([
    enviarCorreo(u.email, {
      asunto: `${MARCA}: no pudimos cobrar tu suscripción`,
      titulo: 'Tu pago no se pudo procesar',
      parrafos: [`Hola ${u.nombre || ''},`, texto, 'Revisá que tu tarjeta o tu medio de pago en Mercado Pago tenga saldo y esté vigente. Mercado Pago vuelve a intentar el cobro automáticamente.'],
      boton: { texto: 'Ver mi cuenta', url: panel },
    }),
    porTelegram(u, `💳 <b>No pudimos cobrar tu suscripción.</b>\n${texto}\n\nRevisalo en ${panel}`),
  ]);
  u.pago.ultimoAviso = new Date().toISOString();
}

async function avisarPagoOk(u) {
  await notificar(u.id, 'ok', '¡Listo! Tu suscripción está activa. Ya podés recibir alertas.');
  await porTelegram(u, '✅ <b>Tu suscripción está activa.</b> Te avisamos apenas haya una alerta para tu zona.');
}

async function avisarSuspendido(u) {
  const panel = `${urlSitio()}/panel`;
  await notificar(u.id, 'pago', 'Tus alertas están pausadas por falta de pago. Regularizá tu suscripción para volver a recibirlas.');
  await Promise.all([
    enviarCorreo(u.email, {
      asunto: `${MARCA}: tus alertas están pausadas`,
      titulo: 'Tus alertas están pausadas',
      parrafos: [`Hola ${u.nombre || ''},`, 'Como no pudimos cobrar la suscripción, dejamos de enviarte alertas. Apenas se acredite el pago, se reactivan solas.'],
      boton: { texto: 'Regularizar mi suscripción', url: panel },
    }),
    porTelegram(u, `⏸️ <b>Tus alertas están pausadas</b> por falta de pago.\nRegularizalo en ${panel} y se reactivan solas.`),
  ]);
}

/**
 * Consulta la suscripción en Mercado Pago y actualiza la ficha.
 * Devuelve la ficha actualizada (o null si no existe el usuario).
 */
export async function sincronizarPago(usuarioId, { preapprovalId, ahora = Date.now() } = {}) {
  const u = await leerUsuario(usuarioId);
  if (!u) return null;
  const config = await leerConfig();
  let id = preapprovalId || u.pago?.preapprovalId;
  let s;
  if (id) s = await leerSuscripcion(id);
  else {
    // Sin id guardado: buscar por referencia (por si la notificación no llegó).
    const lista = await buscarPorReferencia(u.id);
    s = lista.find((x) => x.status === 'authorized') || lista[0];
    if (!s) return u;
    id = s.id;
  }
  if (String(s.external_reference || '') !== u.id) throw new Error('La suscripción no corresponde a este cliente');

  const anterior = u.pago?.estado || 'sin_suscripcion';
  const nuevo = estadoDesdeMP(s, ahora);
  u.pago = {
    ...(u.pago || {}),
    estado: nuevo,
    preapprovalId: id,
    monto: s.auto_recurring?.transaction_amount ?? u.pago?.monto,
    proximoCobro: s.next_payment_date || null,
    ultimoCobro: s.summarized?.last_charged_date || u.pago?.ultimoCobro || null,
    mpEstado: s.status,
    actualizado: new Date(ahora).toISOString(),
  };
  await db().hset(K.mp, { [id]: u.id });

  if (nuevo !== anterior) {
    agregarHistorial(u, `Pago: ${anterior} → ${nuevo}`);
    if (nuevo === 'moroso') {
      u.pago.morosoDesde = new Date(ahora).toISOString();
      await avisarFaltaDePago(u, config);
    } else {
      delete u.pago.morosoDesde;
      delete u.pago.suspendidoAvisado;
      if (nuevo === 'activo') await avisarPagoOk(u);
      if (nuevo === 'cancelado') await notificar(u.id, 'info', 'Tu suscripción quedó cancelada. Podés volver a suscribirte cuando quieras.');
    }
  }
  await guardarUsuario(u);
  return u;
}

/**
 * Revisión diaria: sincroniza a todos, repite el aviso de falta de pago cada 3 días,
 * avisa cuando se terminan los días de gracia y recuerda completar el registro.
 */
export async function revisionDiaria({ ahora = Date.now() } = {}) {
  const config = await leerConfig();
  const usuarios = Object.values((await db().hgetall(K.usuarios)) || {});
  const resumen = { revisados: 0, morosos: 0, avisos: 0, recordatorios: 0, errores: [] };
  for (const base of usuarios) {
    try {
      let u = base;
      if (u.pago?.preapprovalId && u.pago.estado !== 'cancelado') {
        u = (await sincronizarPago(u.id, { ahora })) || u;
        resumen.revisados++;
      }
      if (u.cortesia || u.bloqueado) continue;
      const p = u.pago || {};
      if (p.estado === 'moroso') {
        resumen.morosos++;
        const desde = Date.parse(p.morosoDesde || ahora);
        const finGracia = desde + config.graciaDias * DIA;
        if (ahora >= finGracia && !p.suspendidoAvisado) {
          await avisarSuspendido(u);
          u.pago.suspendidoAvisado = new Date(ahora).toISOString();
          await guardarUsuario(u);
          resumen.avisos++;
        } else if (ahora - Date.parse(p.ultimoAviso || 0) >= 3 * DIA) {
          await avisarFaltaDePago(u, config);
          await guardarUsuario(u);
          resumen.avisos++;
        }
      } else if (!p.estado || p.estado === 'sin_suscripcion' || p.estado === 'pendiente') {
        // Se registró pero no pagó: un recordatorio al día siguiente y otro a la semana.
        const edad = ahora - Date.parse(u.creado);
        const enviados = u.recordatorios || 0;
        if ((enviados === 0 && edad > DIA) || (enviados === 1 && edad > 7 * DIA)) {
          await enviarCorreo(u.email, {
            asunto: `${MARCA}: te falta un paso para activar tus alertas`,
            titulo: 'Tus alertas todavía no están activas',
            parrafos: [`Hola ${u.nombre || ''},`, 'Te registraste pero falta completar la suscripción. Activala y te avisamos por Telegram cada vez que el SMN emita una alerta para tu zona.'],
            boton: { texto: 'Activar mis alertas', url: `${urlSitio()}/panel` },
          });
          u.recordatorios = enviados + 1;
          await guardarUsuario(u);
          resumen.recordatorios++;
        }
      }
    } catch (e) {
      resumen.errores.push(`${base.email}: ${e.message}`.slice(0, 200));
    }
  }
  resumen.fecha = new Date(ahora).toISOString();
  return resumen;
}

export { fecha };
