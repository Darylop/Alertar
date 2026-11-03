// /api/publico — datos públicos para la página (precio, bot, radio). Sin datos de clientes.
import { json, manejar } from '../lib/http.js';
import { leerConfig } from '../lib/usuarios.js';
import { MARCA, RADIO_KM } from '../lib/config.js';
import { usuarioBot } from '../lib/telegram.js';

export const GET = manejar(async () => {
  const c = await leerConfig();
  return json({ ok: true, marca: MARCA, precio: c.precio, radioKm: RADIO_KM, bot: usuarioBot() ? `@${usuarioBot()}` : '' }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=300',
  });
});
