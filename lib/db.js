// Base de datos: Upstash Redis (plan gratuito, por REST).
// Sin variables de Upstash (desarrollo local y pruebas) usa una imitación en memoria
// que se guarda en .datos-locales/db.json.
import { Redis } from '@upstash/redis';
import fs from 'node:fs';
import path from 'node:path';

// Busca la variable exacta o una con prefijo (p. ej. alertar_KV_REST_API_URL, que crea Vercel).
function variable(...nombres) {
  for (const n of nombres) if (process.env[n]) return process.env[n];
  for (const n of nombres) {
    const k = Object.keys(process.env).find((x) => x.endsWith('_' + n) && !x.includes('READ_ONLY'));
    if (k && process.env[k]) return process.env[k];
  }
  return undefined;
}

let instancia;
export function db() {
  if (instancia) return instancia;
  const url = variable('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL');
  const token = variable('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN');
  if (url && token) {
    instancia = new Redis({ url, token, automaticDeserialization: true });
  } else {
    if (process.env.VERCEL_ENV === 'production') throw new Error('Faltan las variables de Upstash Redis (KV_REST_API_URL y KV_REST_API_TOKEN)');
    instancia = new RedisLocal(process.env.DB_LOCAL_ARCHIVO ?? path.resolve('.datos-locales/db.json'));
  }
  return instancia;
}

/** Solo para pruebas: reemplaza la base. */
export function usarDb(d) {
  instancia = d;
}

/** Imitación mínima de Redis para desarrollo local (no usar en producción). */
export class RedisLocal {
  constructor(archivo) {
    this.archivo = archivo || null;
    this.d = new Map();
    this.exp = new Map();
    if (this.archivo && fs.existsSync(this.archivo)) {
      try {
        const j = JSON.parse(fs.readFileSync(this.archivo, 'utf8'));
        this.d = new Map(Object.entries(j.d || {}).map(([k, v]) => [k, revivir(v)]));
        this.exp = new Map(Object.entries(j.exp || {}));
      } catch {}
    }
  }
  _guardar() {
    if (!this.archivo) return;
    fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
    const d = Object.fromEntries([...this.d].map(([k, v]) => [k, v instanceof Map ? { __hash: Object.fromEntries(v) } : v]));
    fs.writeFileSync(this.archivo, JSON.stringify({ d, exp: Object.fromEntries(this.exp) }));
  }
  _vivo(k) {
    const e = this.exp.get(k);
    if (e && e < Date.now()) {
      this.d.delete(k);
      this.exp.delete(k);
    }
    return this.d.has(k);
  }
  _hash(k, crear = false) {
    this._vivo(k);
    let h = this.d.get(k);
    if (!(h instanceof Map)) {
      if (!crear) return new Map();
      h = new Map();
      this.d.set(k, h);
    }
    return h;
  }
  async get(k) {
    return this._vivo(k) ? clonar(this.d.get(k)) : null;
  }
  async set(k, v, op = {}) {
    if (op.nx && this._vivo(k)) return null;
    this.d.set(k, clonar(v));
    if (op.ex) this.exp.set(k, Date.now() + op.ex * 1000);
    else this.exp.delete(k);
    this._guardar();
    return 'OK';
  }
  async del(...ks) {
    let n = 0;
    for (const k of ks) if (this.d.delete(k)) n++;
    this._guardar();
    return n;
  }
  async mget(...ks) {
    return Promise.all(ks.flat().map((k) => this.get(k)));
  }
  async incr(k) {
    const v = Number((await this.get(k)) || 0) + 1;
    this.d.set(k, v);
    this._guardar();
    return v;
  }
  async expire(k, s) {
    if (!this._vivo(k)) return 0;
    this.exp.set(k, Date.now() + s * 1000);
    this._guardar();
    return 1;
  }
  async hget(k, f) {
    const v = this._hash(k).get(String(f));
    return v === undefined ? null : clonar(v);
  }
  async hset(k, obj) {
    const h = this._hash(k, true);
    for (const [f, v] of Object.entries(obj)) h.set(String(f), clonar(v));
    this._guardar();
    return Object.keys(obj).length;
  }
  async hgetall(k) {
    const h = this._hash(k);
    return h.size ? Object.fromEntries([...h].map(([f, v]) => [f, clonar(v)])) : null;
  }
  async hdel(k, ...fs_) {
    const h = this._hash(k);
    let n = 0;
    for (const f of fs_) if (h.delete(String(f))) n++;
    this._guardar();
    return n;
  }
  async hlen(k) {
    return this._hash(k).size;
  }
  async hincrby(k, f, n) {
    const h = this._hash(k, true);
    const v = Number(h.get(String(f)) || 0) + n;
    h.set(String(f), v);
    this._guardar();
    return v;
  }
  async lpush(k, ...vs) {
    this._vivo(k);
    const l = Array.isArray(this.d.get(k)) ? this.d.get(k) : [];
    for (const v of vs) l.unshift(clonar(v));
    this.d.set(k, l);
    this._guardar();
    return l.length;
  }
  async lrange(k, a, b) {
    const l = this._vivo(k) && Array.isArray(this.d.get(k)) ? this.d.get(k) : [];
    return clonar(l.slice(a, b === -1 ? undefined : b + 1));
  }
  async ltrim(k, a, b) {
    const l = Array.isArray(this.d.get(k)) ? this.d.get(k) : [];
    this.d.set(k, l.slice(a, b === -1 ? undefined : b + 1));
    this._guardar();
    return 'OK';
  }
}

const clonar = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const revivir = (v) => (v && typeof v === 'object' && v.__hash ? new Map(Object.entries(v.__hash)) : v);

// ---------- Claves ----------
export const K = {
  usuarios: 'ar:u', // hash id -> ficha completa
  geo: 'ar:geo', // hash id -> datos mínimos para cruzar con alertas
  email: 'ar:email', // hash email -> id
  tg: 'ar:tg', // hash chatId de Telegram -> id
  mp: 'ar:mp', // hash id de suscripción de Mercado Pago -> id
  link: (t) => `ar:link:${t}`, // código de vinculación con Telegram -> id
  reset: (t) => `ar:reset:${t}`, // código para cambiar la contraseña -> id
  intentos: (h) => `ar:intentos:${h}`,
  config: 'ar:cfg',
  alertas: 'ar:alertas', // hash clave de alerta -> registro de envíos
  xml: (u) => `ar:xml:${u}`,
  lock: 'ar:lock',
  fallas: (t) => `ar:fallas:${t}`,
  ultima: 'ar:ultima',
  historial: 'ar:hist',
  foto: (h) => `ar:foto:${h}`, // file_id de Telegram del mapa ya subido
  recibidasN: 'ar:rec:n',
  recibidasU: 'ar:rec:u',
  notif: (id) => `ar:notif:${id}`,
  notifLeido: 'ar:notif:leido',
};
