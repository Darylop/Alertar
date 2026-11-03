// /api/pago?accion=...
//   suscribir    → crea la suscripción mensual en Mercado Pago y devuelve el enlace para pagar.
//   sincronizar  → vuelve a consultar el estado (al volver de Mercado Pago).
//   cancelar     → cancela la suscripción.
//   webhook      → notificaciones de Mercado Pago (configurar esta URL en el panel de MP).
import { db, K } from '../lib/db.js';
import { json, error, cuerpo, parametro, desdeLaWeb, manejar } from '../lib/http.js';
import { usuarioDeSesion } from '../lib/auth.js';
import { guardarUsuario, agregarHistorial, fichaPublica, leerConfig, normalizarEmail } from '../lib/usuarios.js';
import { crearSuscripcion, cancelarSuscripcion, leerSuscripcion, leerCobro, firmaValida } from '../lib/mp.js';
import { sincronizarPago } from '../lib/pagos.js';
import { urlSitio } from '../lib/config.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function webhook(req) {
  const url = new URL(req.url);
  const b = await cuerpo(req);
  const tipo = b.type || b.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const dataId = b.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (!dataId) return json({ ok: true });
  if (!firmaValida(req, dataId)) return error('Firma inválida', 401);
  try {
    let preapprovalId = null;
    if (tipo === 'subscription_preapproval' || tipo === 'preapproval') preapprovalId = dataId;
    else if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') preapprovalId = (await leerCobro(dataId)).preapproval_id;
    if (preapprovalId) {
      // Nunca se confía en el contenido de la notificación: se consulta a Mercado Pago.
      const s = await leerSuscripcion(preapprovalId);
      const usuarioId = s.external_reference || (await db().hget(K.mp, String(preapprovalId)));
      if (usuarioId) await sincronizarPago(String(usuarioId), { preapprovalId });
    }
  } catch (e) {
    console.error('Error procesando notificación de Mercado Pago', e.message);
    return error('Error temporal', 500); // Mercado Pago reintenta
  }
  return json({ ok: true });
}

export const POST = manejar(async (req) => {
  const accion = parametro(req, 'accion');
  if (accion === 'webhook') return webhook(req);
  if (!desdeLaWeb(req)) return error('Solicitud no válida', 403);
  const u = await usuarioDeSesion(req);
  if (!u) return error('Tu sesión venció. Ingresá de nuevo.', 401);
  const config = await leerConfig();

  if (accion === 'suscribir') {
    if (['activo', 'moroso'].includes(u.pago?.estado) && u.pago?.preapprovalId) {
      return error('Ya tenés una suscripción. Si tu pago falló, actualizá el medio de pago desde tu cuenta de Mercado Pago.');
    }
    const b = await cuerpo(req);
    const mpEmail = normalizarEmail(b.mpEmail || u.email);
    if (!EMAIL_RE.test(mpEmail)) return error('El email de Mercado Pago no es válido.');
    const s = await crearSuscripcion({ usuarioId: u.id, email: mpEmail, monto: config.precio, volverA: `${urlSitio(req)}/panel?pago=volvio` });
    u.pago = { ...(u.pago || {}), estado: 'pendiente', preapprovalId: s.id, mpEmail, monto: config.precio, creado: new Date().toISOString() };
    agregarHistorial(u, `Inició la suscripción (ARS ${config.precio})`);
    await db().hset(K.mp, { [s.id]: u.id });
    await guardarUsuario(u);
    return json({ ok: true, url: s.init_point });
  }

  if (accion === 'sincronizar') {
    const b = await cuerpo(req);
    const pid = /^[\w-]{6,64}$/.test(String(b.preapprovalId || '')) ? String(b.preapprovalId) : undefined;
    try {
      const nu = await sincronizarPago(u.id, { preapprovalId: pid });
      return json({ ok: true, usuario: fichaPublica(nu, config) });
    } catch (e) {
      console.error('No se pudo sincronizar el pago', e.message);
      return error('No pudimos consultar Mercado Pago en este momento. Probá en unos minutos.', 502);
    }
  }

  if (accion === 'cancelar') {
    if (!u.pago?.preapprovalId) return error('No tenés una suscripción activa.');
    await cancelarSuscripcion(u.pago.preapprovalId);
    const nu = await sincronizarPago(u.id);
    return json({ ok: true, usuario: fichaPublica(nu, config) });
  }

  return error('Acción desconocida', 404);
});

// Mercado Pago a veces valida la URL con un GET.
export const GET = () => json({ ok: true });
