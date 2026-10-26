// Configuración general. Los secretos se leen SIEMPRE de variables de entorno.
export const MARCA = 'AlertAR';
export const FEED_URL = process.env.SMN_FEED_URL || 'https://ssl.smn.gob.ar/CAP/AR.php';
export const TIMEZONE = 'America/Argentina/Buenos_Aires';
export const USER_AGENT = 'AlertAR/1.0 (avisos por Telegram de alertas del SMN; +https://www.smn.gob.ar/alertas)';

// Radio alrededor del punto de cada cliente (km).
export const RADIO_KM = Number(process.env.RADIO_KM || 4);

// Valores por defecto que el administrador puede cambiar desde el panel.
export const CONFIG_DEFECTO = {
  precio: Number(process.env.PRECIO_MENSUAL || 4990), // ARS por mes
  graciaDias: 3, // días que sigue recibiendo alertas después de un pago fallido
};

// Severidad CAP (Common Alerting Protocol) -> nivel del SMN.
export const NIVELES = {
  Minor: { nombre: 'verde', color: '#2E9E44' },
  Moderate: { nombre: 'amarilla', color: '#F2C200' },
  Severe: { nombre: 'naranja', color: '#F57C00' },
  Extreme: { nombre: 'roja', color: '#D32F2F' },
};
export function nivelDe(severity) {
  return NIVELES[severity] || { nombre: String(severity || 'sin nivel').toLowerCase(), color: '#7E57C2' };
}

// Cantidad de fallas seguidas antes de avisar al administrador.
export const UMBRAL_FALLAS = Number(process.env.UMBRAL_FALLAS || 3);
// Ejecuciones seguidas sin ver una alerta antes de avisar que se levantó.
export const RONDAS_PARA_LEVANTAR = 2;

export function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** Dirección pública del sitio, sin barra final. */
export function urlSitio(request) {
  if (process.env.SITIO_URL) return process.env.SITIO_URL.replace(/\/+$/, '');
  if (request) {
    const u = new URL(request.url);
    return `${u.protocol}//${u.host}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}

export const esAdmin = (email) =>
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(email || '').toLowerCase());
