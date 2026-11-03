// Fichas de clientes y reglas de quién recibe alertas.
import crypto from 'node:crypto';
import { db, K } from './db.js';
import { CONFIG_DEFECTO, esAdmin } from './config.js';

const DIA = 24 * 60 * 60 * 1000;

export const nuevoId = () => 'u' + crypto.randomBytes(9).toString('base64url');
export const normalizarEmail = (e) => String(e || '').trim().toLowerCase();

export async function leerConfig() {
  const c = await db().get(K.config);
  return { ...CONFIG_DEFECTO, ...(c || {}) };
}

export async function guardarConfig(cambios) {
  const c = { ...(await leerConfig()), ...cambios };
  await db().set(K.config, c);
  return c;
}

export async function leerUsuario(id) {
  if (!id) return null;
  return db().hget(K.usuarios, String(id));
}

export async function idPorEmail(email) {
  return db().hget(K.email, normalizarEmail(email));
}

/** Datos mínimos para cruzar con alertas (se guardan aparte para leerlos rápido). */
function datosGeo(u) {
  if (!u.direccion || !u.telegram?.chatId) return null;
  return {
    lat: u.direccion.lat,
    lon: u.direccion.lon,
    chat: String(u.telegram.chatId),
    dir: u.direccion.corta || u.direccion.texto,
    pago: u.pago?.estado || 'sin_suscripcion',
    morosoDesde: u.pago?.morosoDesde || null,
    cortesia: !!u.cortesia,
    bloqueado: !!u.bloqueado,
  };
}

export async function guardarUsuario(u) {
  u.actualizado = new Date().toISOString();
  const r = db();
  const geo = datosGeo(u);
  await Promise.all([
    r.hset(K.usuarios, { [u.id]: u }),
    geo ? r.hset(K.geo, { [u.id]: geo }) : r.hdel(K.geo, u.id),
  ]);
  return u;
}

/** Lee, modifica y guarda (para cambios desde procesos automáticos). */
export async function actualizarUsuario(id, fn) {
  const u = await leerUsuario(id);
  if (!u) return null;
  await fn(u);
  return guardarUsuario(u);
}

export function agregarHistorial(u, evento) {
  u.historial = [{ fecha: new Date().toISOString(), evento }, ...(u.historial || [])].slice(0, 30);
}

/**
 * ¿Recibe alertas? Necesita dirección, Telegram vinculado y estar al día
 * (o en los días de gracia después de un pago fallido, o con cortesía del administrador).
 */
export function recibeAlertas(g, config, ahora = Date.now()) {
  if (!g || g.bloqueado || !g.chat || !Number.isFinite(g.lat) || !Number.isFinite(g.lon)) return false;
  if (g.cortesia) return true;
  if (g.pago === 'activo') return true;
  if (g.pago === 'moroso') {
    const desde = Date.parse(g.morosoDesde || '');
    return Number.isFinite(desde) && ahora - desde < (config.graciaDias ?? CONFIG_DEFECTO.graciaDias) * DIA;
  }
  return false;
}

/** Estado del servicio para mostrar al cliente y al administrador. */
export function estadoServicio(u, config, ahora = Date.now()) {
  const faltan = [];
  if (!u.direccion) faltan.push('direccion');
  if (!u.telegram?.chatId) faltan.push('telegram');
  const pago = u.pago?.estado || 'sin_suscripcion';
  const alDia = u.cortesia || pago === 'activo';
  if (!alDia && pago !== 'moroso') faltan.push('pago');
  const g = datosGeo(u);
  const recibe = recibeAlertas(g, config, ahora);
  let graciaHasta = null;
  if (pago === 'moroso' && u.pago?.morosoDesde) {
    graciaHasta = new Date(Date.parse(u.pago.morosoDesde) + config.graciaDias * DIA).toISOString();
  }
  return { recibe, faltan, pago, cortesia: !!u.cortesia, bloqueado: !!u.bloqueado, graciaHasta };
}

/** Ficha sin datos internos, para el propio cliente. */
export function fichaPublica(u, config) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    telefono: u.telefono || '',
    creado: u.creado,
    direccion: u.direccion || null,
    telegram: u.telegram ? { chatId: u.telegram.chatId, usuario: u.telegram.usuario || '', nombre: u.telegram.nombre || '', vinculado: u.telegram.vinculado, bloqueado: !!u.telegram.bloqueado } : null,
    pago: {
      estado: u.pago?.estado || 'sin_suscripcion',
      monto: u.pago?.monto || null,
      proximoCobro: u.pago?.proximoCobro || null,
      ultimoCobro: u.pago?.ultimoCobro || null,
      mpEmail: u.pago?.mpEmail || '',
    },
    servicio: estadoServicio(u, config),
    admin: esAdmin(u.email),
  };
}

// ---------- Notificaciones dentro de la web ----------
export async function notificar(id, tipo, texto) {
  const r = db();
  const item = { id: crypto.randomBytes(5).toString('hex'), tipo, texto, fecha: new Date().toISOString() };
  await r.lpush(K.notif(id), item);
  await r.ltrim(K.notif(id), 0, 19);
  return item;
}

export async function leerNotificaciones(id) {
  const r = db();
  const [lista, leido] = await Promise.all([r.lrange(K.notif(id), 0, 19), r.hget(K.notifLeido, id)]);
  const t = Date.parse(leido || 0) || 0;
  return (lista || []).map((n) => ({ ...n, leida: Date.parse(n.fecha) <= t }));
}

export async function marcarLeidas(id) {
  await db().hset(K.notifLeido, { [id]: new Date().toISOString() });
}

/** Todas las fichas (panel de administración). */
export async function todosLosUsuarios() {
  return Object.values((await db().hgetall(K.usuarios)) || {});
}
