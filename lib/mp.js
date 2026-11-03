// Mercado Pago: suscripciones mensuales (preapproval "sin plan asociado").
// Documentación: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
import crypto from 'node:crypto';
import { envOrThrow, MARCA } from './config.js';

const API = 'https://api.mercadopago.com';

async function llamar(metodo, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${envOrThrow('MP_ACCESS_TOKEN').trim()}`,
      'Content-Type': 'application/json',
      ...(metodo === 'POST' ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Mercado Pago ${metodo} ${ruta}: ${data.message || r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

/**
 * Crea la suscripción y devuelve { id, init_point }. El cliente entra a init_point,
 * inicia sesión en Mercado Pago (con el mismo email) y autoriza el cobro mensual.
 */
export function crearSuscripcion({ usuarioId, email, monto, volverA }) {
  return llamar('POST', '/preapproval', {
    reason: `${MARCA} – alertas meteorológicas (mensual)`,
    external_reference: usuarioId,
    payer_email: email,
    back_url: volverA,
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: monto, currency_id: 'ARS' },
    status: 'pending',
  });
}

export const leerSuscripcion = (id) => llamar('GET', `/preapproval/${encodeURIComponent(id)}`);
export const leerCobro = (id) => llamar('GET', `/authorized_payments/${encodeURIComponent(id)}`);
export const cancelarSuscripcion = (id) => llamar('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });

/** Busca suscripciones por la referencia (id del cliente), por si se perdió la notificación. */
export async function buscarPorReferencia(usuarioId) {
  const d = await llamar('GET', `/preapproval/search?external_reference=${encodeURIComponent(usuarioId)}&limit=10`);
  return (d.results || []).sort((a, b) => Date.parse(b.date_created) - Date.parse(a.date_created));
}

/**
 * Traduce el estado de Mercado Pago al nuestro:
 *   activo     → autorizada y sin cobros rechazados
 *   moroso     → pausada o con cobro rechazado (semáforo rojo/amarillo vencido)
 *   pendiente  → todavía no autorizó
 *   cancelado  → la canceló
 */
export function estadoDesdeMP(s, ahora = Date.now()) {
  const st = s?.status;
  if (st === 'cancelled') return 'cancelado';
  if (st === 'pending') return 'pendiente';
  if (st === 'paused') return 'moroso';
  if (st === 'authorized') {
    const sem = s.summarized?.semaphore;
    if (sem === 'red') return 'moroso';
    // Si la fecha de cobro pasó hace más de 2 días y no hay cobro nuevo, está atrasado.
    const prox = Date.parse(s.next_payment_date || '');
    const ultimo = Date.parse(s.summarized?.last_charged_date || '');
    if (Number.isFinite(prox) && ahora - prox > 2 * 864e5 && !(ultimo >= prox)) return 'moroso';
    if (!Number.isFinite(ultimo) && s.summarized?.pending_charge_quantity > 0 && sem === 'yellow') return 'pendiente';
    return 'activo';
  }
  return 'pendiente';
}

/**
 * Verifica la firma de la notificación (cabecera x-signature) si se configuró MP_WEBHOOK_SECRET.
 * Igual, el estado real siempre se vuelve a consultar a la API: no se confía en el contenido.
 */
export function firmaValida(req, dataId) {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) return true;
  const firma = req.headers.get('x-signature') || '';
  const reqId = req.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifiesto = `id:${id};request-id:${reqId};ts:${partes.ts};`;
  const calc = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(partes.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
