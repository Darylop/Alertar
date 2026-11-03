// Armado de los mensajes de Telegram (parse_mode HTML).
import { TIMEZONE, nivelDe, RADIO_KM, MARCA } from './config.js';
import { decodificarEntidades } from './cap.js';
import { recomendaciones } from './voseo.js';
import { formatoKm } from './geo.js';

export const LIMITE_CAPTION = 1024;
export const LIMITE_MENSAJE = 4096;

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const fmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fechaHora(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || 's/d');
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const dia = String(p.weekday || '').replace('.', '');
  return `${dia} ${p.day}/${p.month} ${p.hour}:${p.minute} h`;
}

const fenomeno = (g) => escapeHtml(decodificarEntidades(g.event).toLowerCase());

function titulo(grupo, esActualizacion) {
  const n = nivelDe(grupo.severity);
  const pre = esActualizacion ? '🔄 <b>Actualización</b>\n' : '';
  return `${pre}⚠️ <b>Alerta ${escapeHtml(n.nombre)} por ${fenomeno(grupo)}</b>`;
}

/** Línea personal: dónde queda la dirección del cliente respecto del área. */
export function lineaCliente(distancia, direccion) {
  const dir = direccion ? ` (${escapeHtml(direccion)})` : '';
  if (!Number.isFinite(distancia)) return `📍 La alerta alcanza tu zona${dir}.`;
  if (distancia === 0) return `📍 <b>Tu dirección${dir} está dentro del área de la alerta.</b>`;
  return `📍 El área de la alerta está a <b>${formatoKm(distancia)}</b> de tu dirección${dir}, dentro de tu radio de ${RADIO_KM} km.`;
}

export const PIE = `Fuente: SMN – <a href="https://www.smn.gob.ar/alertas">smn.gob.ar/alertas</a>`;

function bloqueRecomendaciones(grupo) {
  const lista = recomendaciones(grupo.instruction).slice(0, 8);
  if (!lista.length) return '';
  return `\n\n<b>Recomendaciones del SMN:</b>\n` + lista.map((r) => `• ${escapeHtml(r)}`).join('\n');
}

function vigencia(grupo) {
  return `<b>Vigencia:</b> desde ${fechaHora(grupo.onset)} hasta ${fechaHora(grupo.expires)} (hora de Argentina)`;
}

/**
 * Largo que cuenta Telegram: sin etiquetas HTML, entidades como un carácter.
 * Los saltos de línea cuentan doble porque el envío multipart los convierte en CRLF.
 */
export function largoVisible(html) {
  const t = String(html).replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#\d+);/g, '_');
  return t.length + (t.match(/\n/g) || []).length;
}

function recortar(texto, max) {
  if (texto.length <= max) return texto;
  let corte = texto.slice(0, max - 1);
  const punto = corte.lastIndexOf('. ');
  if (punto > max * 0.5) return corte.slice(0, punto + 1);
  const ult = corte.lastIndexOf(' ');
  if (ult > max * 0.6) corte = corte.slice(0, ult);
  return corte.replace(/&[a-z#0-9]*$/i, '') + '…';
}

/**
 * Devuelve { caption, extra }. Si el texto completo entra en 1024 caracteres,
 * extra es null. Si no, caption es un resumen y extra lleva el texto completo.
 */
export function armarMensajes(grupo, { esActualizacion = false, prefijo = '', distancia, direccion } = {}) {
  const cab = `${prefijo}${titulo(grupo, esActualizacion)}\n${lineaCliente(distancia, direccion)}\n${vigencia(grupo)}`;
  const desc = escapeHtml(decodificarEntidades(grupo.description));
  const reco = bloqueRecomendaciones(grupo);
  const completo = `${cab}\n\n${desc}${reco}\n\n${PIE}`;
  if (largoVisible(completo) <= LIMITE_CAPTION) return { caption: completo, extra: null };

  const nota = '\n\n<i>(Sigue el detalle en el próximo mensaje)</i>';
  const disponible = LIMITE_CAPTION - largoVisible(cab) - largoVisible(PIE) - largoVisible(nota) - 12;
  let resumen = '';
  if (disponible > 40) {
    let n = disponible;
    do {
      resumen = `\n\n${recortar(desc, n)}`;
      n -= 20;
    } while (largoVisible(resumen) > disponible && n > 40);
  }
  const caption = `${cab}${resumen}${nota}\n\n${PIE}`;

  const n = nivelDe(grupo.severity);
  const cabExtra = `📄 <b>Detalle – alerta ${escapeHtml(n.nombre)} por ${fenomeno(grupo)}</b>`;
  const margen = LIMITE_MENSAJE - largoVisible(cabExtra) - largoVisible(reco) - largoVisible(PIE) - 20;
  const extra = `${cabExtra}\n\n${recortar(desc, Math.max(200, margen))}${reco}\n\n${PIE}`;
  return { caption, extra };
}

export function mensajeLevantada(info) {
  const n = nivelDe(info.severity);
  return (
    `✅ <b>Se levantó la alerta ${escapeHtml(n.nombre)} por ${escapeHtml(String(info.event).toLowerCase())}</b>\n` +
    `El SMN ya no la informa para tu zona.\n\n${PIE}`
  );
}

export const mensajeBienvenida = (nombre) =>
  `👋 ¡Hola${nombre ? ' ' + escapeHtml(nombre) : ''}! Tu cuenta de <b>${MARCA}</b> quedó vinculada.\n\n` +
  `Desde ahora, cuando el SMN emita una alerta que toque un radio de ${RADIO_KM} km de tu dirección, te llega por acá, con el mapa.\n\n` +
  `Comandos: /estado · /id · /ayuda`;
