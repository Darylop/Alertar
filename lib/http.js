// Utilidades para las funciones de /api.
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export const error = (mensaje, status = 400) => json({ ok: false, error: mensaje }, status);

export const parametro = (req, nombre) => new URL(req.url).searchParams.get(nombre);

export async function cuerpo(req) {
  try {
    const t = await req.text();
    if (t.length > 20000) return {};
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

/**
 * Protección contra envíos desde otros sitios (CSRF): los POST de la web
 * mandan siempre esta cabecera y la cookie de sesión es SameSite=Lax.
 */
export const desdeLaWeb = (req) => req.headers.get('x-alertar') === '1';

export const ipDe = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';

/** Envuelve un manejador: errores inesperados → 500 sin detalles internos. */
export const manejar = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (e) {
    console.error(e);
    return error('Ocurrió un error inesperado. Probá de nuevo en unos minutos.', 500);
  }
};
