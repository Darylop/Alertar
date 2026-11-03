// /api/revisar — revisa el SMN y envía las alertas. Lo llama cron-job.org cada 10 minutos
// con la cabecera "Authorization: Bearer CRON_SECRET".
// Si quedan envíos pendientes (muchos clientes a la vez), se vuelve a llamar sola al terminar.
import { waitUntil } from '@vercel/functions';
import { db, K } from '../lib/db.js';
import { json, manejar } from '../lib/http.js';
import { esCron } from '../lib/auth.js';
import { procesar } from '../lib/procesar.js';
import { avisarAdmin } from '../lib/telegram.js';
import { escapeHtml } from '../lib/texto.js';
import { urlSitio } from '../lib/config.js';

const MAX_CADENA = 30; // tope de llamadas encadenadas (≈ 30 × 1.000 mensajes)

export const GET = manejar(async (req) => {
  if (!esCron(req)) return json({ ok: false, error: 'No autorizado' }, 401);
  if (process.env.BOT_PAUSADO === '1') return json({ ok: true, pausado: true });

  const eslabon = Number(new URL(req.url).searchParams.get('eslabon') || 0);
  // Evita dos revisiones a la vez (el candado se libera solo a los 2 minutos).
  const candado = await db().set(K.lock, String(Date.now()), { nx: true, ex: 120 });
  if (!candado) return json({ ok: true, omitida: 'Ya hay una revisión en curso' });

  let resumen;
  try {
    resumen = await procesar();
  } catch (e) {
    console.error(e);
    await avisarAdmin(`❌ Error inesperado en /api/revisar: <code>${escapeHtml(String(e.message).slice(0, 300))}</code>`);
    // Se responde 200 para que el servicio de cron no desactive la tarea; el aviso va por Telegram.
    return json({ ok: false, error: e.message });
  } finally {
    await db().del(K.lock);
  }

  if (resumen.pendientes > 0 && eslabon < MAX_CADENA) {
    const sig = `${urlSitio(req)}/api/revisar?eslabon=${eslabon + 1}`;
    waitUntil(
      fetch(sig, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(5000) }).catch(() => {})
    );
    resumen.continua = true;
  }
  return json({ ok: resumen.errores.length === 0, ...resumen });
});
export const POST = GET;
