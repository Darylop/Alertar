// Contraseñas (scrypt) y sesiones con cookie firmada (HMAC).
import crypto from 'node:crypto';
import { db, K } from './db.js';
import { envOrThrow, esAdmin } from './config.js';
import { leerUsuario } from './usuarios.js';

const COOKIE = 'ar_sesion';
const DURACION_S = 60 * 60 * 24 * 30; // 30 días

export function hashPassword(pass) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pass), sal, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export function verificarPassword(pass, guardado) {
  const [v, sal, h] = String(guardado || '').split('$');
  if (v !== 's1' || !sal || !h) return false;
  const calc = crypto.scryptSync(String(pass), Buffer.from(sal, 'base64url'), 64, { N: 16384, r: 8, p: 1 });
  const esperado = Buffer.from(h, 'base64url');
  return esperado.length === calc.length && crypto.timingSafeEqual(esperado, calc);
}

const firmar = (datos) => crypto.createHmac('sha256', envOrThrow('SESSION_SECRET')).update(datos).digest('base64url');

export function cookieSesion(u, req) {
  const datos = Buffer.from(JSON.stringify({ id: u.id, v: u.passVer || 1, exp: Date.now() + DURACION_S * 1000 })).toString('base64url');
  const seguro = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${datos}.${firmar(datos)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION_S}${seguro}`;
}

export const cookieSalir = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function leerCookie(req) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

/** Devuelve el usuario de la sesión o null. */
export async function usuarioDeSesion(req) {
  const v = leerCookie(req);
  if (!v) return null;
  const [datos, firma] = v.split('.');
  if (!datos || !firma) return null;
  const esperado = Buffer.from(firmar(datos));
  const recibido = Buffer.from(firma);
  if (esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) return null;
  let s;
  try {
    s = JSON.parse(Buffer.from(datos, 'base64url').toString());
  } catch {
    return null;
  }
  if (!s.exp || s.exp < Date.now()) return null;
  const u = await leerUsuario(s.id);
  // Cambiar la contraseña invalida las sesiones anteriores.
  if (!u || (u.passVer || 1) !== s.v) return null;
  return u;
}

export async function adminDeSesion(req) {
  const u = await usuarioDeSesion(req);
  return u && esAdmin(u.email) ? u : null;
}

/** Límite de intentos (por ejemplo, 8 ingresos fallidos cada 15 minutos). */
export async function demasiadosIntentos(clave, max = 8, ventanaS = 900) {
  const h = crypto.createHash('sha256').update(clave).digest('hex').slice(0, 24);
  const n = await db().incr(K.intentos(h));
  if (n === 1) await db().expire(K.intentos(h), ventanaS);
  return n > max;
}

export const tokenAleatorio = (n = 18) => crypto.randomBytes(n).toString('base64url');

/** Secreto para las tareas programadas (Vercel Cron manda "Authorization: Bearer CRON_SECRET"). */
export function esCron(req) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;
  const auth = req.headers.get('authorization') || '';
  const recibido = auth.startsWith('Bearer ') ? auth.slice(7).trim() : new URL(req.url).searchParams.get('secret') || '';
  const a = Buffer.from(recibido), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
