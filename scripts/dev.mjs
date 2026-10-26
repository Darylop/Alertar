// Servidor local para probar la web sin Vercel: `npm run dev` → http://localhost:3000
// Sirve /public (con URLs limpias, como Vercel) y ejecuta las funciones de /api.
// Sin variables de Upstash usa una base local en .datos-locales/db.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PUERTO = Number(process.env.PORT || 3000);

// Variables de .env.local (opcional; nunca se sube).
const envLocal = path.join(RAIZ, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const linea of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.SESSION_SECRET ||= 'secreto-solo-para-desarrollo-local-0123456789';
process.env.ADMIN_EMAILS ||= 'admin@local.test';
process.env.CRON_SECRET ||= 'cron-local';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };

async function api(req, res, nombre) {
  const archivo = path.join(RAIZ, 'api', `${nombre}.js`);
  if (!/^[a-z-]+$/.test(nombre) || !fs.existsSync(archivo)) return enviar(res, 404, 'No existe');
  const mod = await import(pathToFileURL(archivo).href);
  const fn = mod[req.method];
  if (!fn) return enviar(res, 405, 'Método no permitido');
  const partes = [];
  for await (const c of req) partes.push(c);
  const cuerpo = Buffer.concat(partes);
  const request = new Request(`http://localhost:${PUERTO}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo,
  });
  const r = await fn(request);
  const headers = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

function enviar(res, status, texto) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const m = url.pathname.match(/^\/api\/([^/]+)\/?$/);
      if (m) return await api(req, res, m[1]);
      let ruta = path.normalize(path.join(RAIZ, 'public', decodeURIComponent(url.pathname)));
      if (!ruta.startsWith(path.join(RAIZ, 'public'))) return enviar(res, 403, 'No');
      if (fs.existsSync(ruta) && fs.statSync(ruta).isDirectory()) ruta = path.join(ruta, 'index.html');
      if (!fs.existsSync(ruta) && fs.existsSync(ruta + '.html')) ruta += '.html';
      if (!fs.existsSync(ruta)) {
        res.writeHead(404, { 'Content-Type': TIPOS['.html'] });
        return res.end(fs.readFileSync(path.join(RAIZ, 'public', '404.html')));
      }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(ruta).pipe(res);
    } catch (e) {
      console.error(e);
      enviar(res, 500, 'Error: ' + e.message);
    }
  })
  .listen(PUERTO, () => console.log(`AlertAR local en http://localhost:${PUERTO}  (admin: ${process.env.ADMIN_EMAILS})`));
