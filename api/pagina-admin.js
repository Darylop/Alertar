// /admin (vercel.json lo redirige acá) — entrega el panel solo a los emails de ADMIN_EMAILS.
// A cualquier otra persona (con o sin sesión) le responde la página 404, como si /admin no existiera.
import { usuarioDeSesion } from '../lib/auth.js';
import { esAdmin } from '../lib/config.js';
import { HTML_ADMIN } from '../lib/paginas/admin.js';
import { HTML_404 } from '../lib/paginas/no-encontrada.js';

const html = (cuerpo, status) =>
  new Response(cuerpo, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

export async function GET(req) {
  let u = null;
  try {
    u = await usuarioDeSesion(req);
  } catch (e) {
    console.error(e);
  }
  return u && esAdmin(u.email) ? html(HTML_ADMIN, 200) : html(HTML_404, 404);
}
