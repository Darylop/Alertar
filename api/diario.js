// /api/diario — revisión diaria de pagos y recordatorios. La programa Vercel Cron (vercel.json),
// que manda "Authorization: Bearer CRON_SECRET" automáticamente.
import { db, K } from '../lib/db.js';
import { json, manejar } from '../lib/http.js';
import { esCron } from '../lib/auth.js';
import { revisionDiaria } from '../lib/pagos.js';
import { avisarAdmin } from '../lib/telegram.js';

export const GET = manejar(async (req) => {
  if (!esCron(req)) return json({ ok: false, error: 'No autorizado' }, 401);
  const resumen = await revisionDiaria();
  await db().set('ar:ultimo-diario', resumen);
  if (resumen.errores.length) await avisarAdmin(`⚠️ Revisión diaria de pagos con ${resumen.errores.length} error(es). Mirá el panel de administración.`);
  return json({ ok: true, ...resumen });
});
