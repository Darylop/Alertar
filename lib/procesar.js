// Lógica principal: lee el SMN, cruza cada alerta con el punto de cada cliente
// (radio de 4 km) y le avisa por Telegram privado.
//
// Escala: los clientes se indexan por cuadrícula, así que cada alerta solo se compara
// con los que están cerca. Los envíos respetan el límite de Telegram (~30 por segundo) y
// si el tiempo de la función se termina, lo pendiente se retoma en la siguiente pasada:
// cada registro de alerta guarda a quién ya se le envió, así nadie la recibe dos veces.
import { leerFeed } from './cap.js';
import { db, K } from './db.js';
import { RADIO_KM, UMBRAL_FALLAS, RONDAS_PARA_LEVANTAR } from './config.js';
import { distanciaKm, prepararPoligonos, indiceCuadricula, zonaMapa, bboxDe } from './geo.js';
import { generarMapa } from './mapa.js';
import { armarMensajes, mensajeLevantada, escapeHtml } from './texto.js';
import { sendPhoto, sendMessage, avisarAdmin, enviarEnTanda } from './telegram.js';
import { leerConfig, recibeAlertas, actualizarUsuario } from './usuarios.js';

// Con hasta esta cantidad de clientes en una zona de ~25 km, cada uno recibe su mapa
// personal (su punto y su radio). Con más, la zona comparte una imagen que se sube una vez.
const MAPA_PERSONAL_MAX = Number(process.env.MAPA_PERSONAL_MAX || 15);

const vencida = (iso, ahora) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < ahora;
};
const mismoEvento = (a, b) => String(a.event).toLowerCase() === String(b.event).toLowerCase();

/** Caché de XML ya leídos (el SMN no modifica un archivo publicado). */
const cacheXml = {
  async leerVarios(urls) {
    if (!urls.length) return {};
    const vals = await db().mget(...urls.map(K.xml));
    const out = {};
    urls.forEach((u, i) => {
      if (vals[i]) out[u] = vals[i];
    });
    return out;
  },
  async guardarVarios(mapa) {
    await Promise.all(Object.entries(mapa).map(([u, v]) => db().set(K.xml(u), v, { ex: 60 * 60 * 24 * 4 })));
  },
};

async function registrarFalla(tipo, detalle) {
  const n = await db().incr(K.fallas(tipo));
  if (n === UMBRAL_FALLAS) {
    const que = tipo === 'smn' ? 'leer las alertas del SMN' : 'enviar mensajes por Telegram';
    await avisarAdmin(`⚠️ Van ${n} intentos seguidos sin poder ${que}.\nÚltimo error: <code>${escapeHtml(String(detalle).slice(0, 500))}</code>`);
  }
}

async function registrarExito(tipo) {
  const n = Number((await db().get(K.fallas(tipo))) || 0);
  if (n > 0) {
    await db().del(K.fallas(tipo));
    if (n >= UMBRAL_FALLAS) await avisarAdmin(`✅ ${tipo === 'smn' ? 'La lectura del SMN' : 'El envío por Telegram'} volvió a funcionar.`);
  }
}

/** Envía una alerta a un cliente. `foto` es un PNG, un file_id o null (solo texto). */
async function enviarAlerta(chat, grupo, opciones, foto) {
  const { caption, extra } = armarMensajes(grupo, opciones);
  let fileId = null;
  if (foto) {
    ({ fileId } = await sendPhoto(chat, foto, caption));
    if (extra) await sendMessage(chat, extra);
  } else {
    await sendMessage(chat, extra || caption);
  }
  return fileId;
}

async function guardarHistorial(reg, fin) {
  const r = db();
  await r.lpush(K.historial, {
    event: reg.event,
    severity: reg.severity,
    onset: reg.onset,
    expires: reg.expires,
    creada: reg.creada,
    enviados: reg.enviados || 0,
    fin,
    cerrada: new Date().toISOString(),
  });
  await r.ltrim(K.historial, 0, 299);
}

export async function procesar({ ahora = Date.now(), leer = leerFeed, presupuestoMs = Number(process.env.PRESUPUESTO_MS || 22000) } = {}) {
  const inicio = Date.now();
  const hasta = inicio + presupuestoMs;
  const r = db();
  const resumen = { fecha: new Date(ahora).toISOString(), enviadas: 0, actualizaciones: 0, levantadas: 0, pendientes: 0, alertasEnZona: 0, errores: [] };

  let feed;
  try {
    feed = await leer({ cache: cacheXml });
  } catch (e) {
    resumen.errores.push(`SMN: ${e.message}`);
    await registrarFalla('smn', e.message);
    await r.set(K.ultima, resumen);
    return resumen;
  }
  if (feed.errores) await registrarFalla('smn', `${feed.errores} archivo(s) XML no se pudieron leer`);
  else await registrarExito('smn');
  Object.assign(resumen, { archivos: feed.archivos, grupos: feed.grupos.length, completo: feed.completo });

  const registros = (await r.hgetall(K.alertas)) || {};
  const actuales = feed.grupos
    .filter((g) => g.msgType !== 'Cancel' && !vencida(g.expires, ahora) && g.poligonos.length)
    .map((g) => ({ ...g, poligonos: prepararPoligonos(g.poligonos) }));
  const cancelados = feed.grupos.filter((g) => g.msgType === 'Cancel');

  let fallasTg = 0, enviosOk = 0, ultimoErrorTg = '';
  const bloqueados = new Set();
  const anotarError = (e) => {
    if (e?.bloqueado) return;
    fallasTg++;
    ultimoErrorTg = e?.message || String(e);
  };

  // ---------- 1) Clientes que pueden recibir alertas ----------
  let clientes = [];
  if (actuales.length) {
    const config = await leerConfig();
    const geo = (await r.hgetall(K.geo)) || {};
    clientes = Object.entries(geo)
      .map(([id, g]) => ({ id, ...g }))
      .filter((g) => recibeAlertas(g, config, ahora));
  }
  resumen.clientesActivos = clientes.length;
  const indice = indiceCuadricula(clientes);

  // ---------- 2) Alertas nuevas o actualizadas ----------
  const ultimaRecibida = {};
  for (const g of actuales) {
    const destinatarios = [];
    for (const c of indice.cerca(bboxDe(g.poligonos), RADIO_KM)) {
      const d = distanciaKm(c.lon, c.lat, g.poligonos, RADIO_KM);
      if (Number.isFinite(d)) destinatarios.push({ ...c, distancia: d });
    }
    let reg = registros[g.clave];
    if (!destinatarios.length && !reg) continue;
    resumen.alertasEnZona++;
    if (!reg) {
      reg = { clave: g.clave, event: g.event, severity: g.severity, onset: g.onset, expires: g.expires, msgType: g.msgType, creada: new Date(ahora).toISOString(), usuarios: {}, enviados: 0, faltas: 0 };
      registros[g.clave] = reg;
    }
    if (reg.faltas) reg.faltas = 0;
    const faltan = destinatarios.filter((d) => !reg.usuarios[d.id]);
    if (!faltan.length) continue;

    // ¿Para quién es una actualización? Para quien ya recibió el mismo fenómeno vigente.
    const previas = Object.values(registros).filter((o) => o.clave !== g.clave && mismoEvento(o, g) && !vencida(o.expires, ahora) && !o.levantada);
    const esActualizacionPara = (id) => previas.some((o) => o.usuarios[id]);

    // Agrupar por zona de ~25 km para decidir mapa personal o compartido.
    const porZona = new Map();
    for (const d of faltan) {
      const z = zonaMapa(d.lon, d.lat);
      if (!porZona.has(z)) porZona.set(z, []);
      porZona.get(z).push(d);
    }

    const tareas = [];
    const orden = []; // cliente de cada tarea, en el mismo orden
    const exito = (d, act) => {
      reg.usuarios[d.id] = d.chat;
      reg.enviados = (reg.enviados || 0) + 1;
      ultimaRecibida[d.id] = new Date().toISOString();
      enviosOk++;
      act ? resumen.actualizaciones++ : resumen.enviadas++;
    };

    for (const [zona, lista] of porZona) {
      const personal = lista.length <= MAPA_PERSONAL_MAX;
      // Mapa compartido: se genera una vez; el primer envío lo sube y el resto usa su file_id.
      let compartida = null;
      if (!personal) {
        const claveFoto = K.foto(`${g.clave}#${zona}`);
        compartida = (async () => {
          const guardado = await r.get(claveFoto);
          if (guardado) return { fileId: String(guardado) };
          const lat = lista.reduce((s, d) => s + d.lat, 0) / lista.length;
          const lon = lista.reduce((s, d) => s + d.lon, 0) / lista.length;
          try {
            return { png: await generarMapa(g, { centro: [lon, lat] }), claveFoto };
          } catch (e) {
            console.error('Falló el mapa compartido, se envía texto', e.message);
            return {};
          }
        })();
      }
      let subida = null; // promesa del primer envío con la imagen compartida

      for (const d of lista) {
        const act = esActualizacionPara(d.id);
        const opciones = { esActualizacion: act, distancia: d.distancia, direccion: d.dir };
        orden.push(d);
        tareas.push(async () => {
          if (personal) {
            let png = null;
            try {
              png = await generarMapa(g, { punto: { lon: d.lon, lat: d.lat } });
            } catch (e) {
              console.error('Falló el mapa personal, se envía texto', e.message);
            }
            await enviarAlerta(d.chat, g, opciones, png);
          } else {
            const foto = await compartida;
            if (foto.fileId || !foto.png) {
              await enviarAlerta(d.chat, g, opciones, foto.fileId || null);
            } else if (!subida) {
              subida = enviarAlerta(d.chat, g, opciones, foto.png).then(async (fileId) => {
                if (fileId) {
                  foto.fileId = fileId;
                  await r.set(foto.claveFoto, fileId, { ex: 60 * 60 * 24 * 3 });
                }
                return fileId;
              });
              await subida;
            } else {
              const fileId = await subida.catch(() => null);
              await enviarAlerta(d.chat, g, opciones, fileId || foto.png);
            }
          }
          exito(d, act);
        });
      }
    }

    const res = await enviarEnTanda(tareas, { hasta });
    res.forEach((x, i) => {
      if (!x) return;
      if (!x.ok) {
        anotarError(x.error);
        if (x.error?.bloqueado) {
          bloqueados.add(orden[i].id);
          reg.usuarios[orden[i].id] = orden[i].chat; // no reintentar con quien bloqueó al bot
        }
        resumen.errores.push(String(x.error?.message || x.error).slice(0, 200));
      }
    });
    resumen.pendientes += res.filter((x) => !x).length;
    await r.hset(K.alertas, { [g.clave]: reg });
  }

  // ---------- 3) Alertas que se levantaron ----------
  const claveActual = new Set(actuales.map((g) => g.clave));
  for (const [clave, reg] of Object.entries(registros)) {
    if (reg.levantada) continue;
    if (claveActual.has(clave)) continue;
    const cancelada = cancelados.some((c) => c.clave === clave || (mismoEvento(reg, c) && !actuales.some((g) => mismoEvento(g, reg))));
    if (!cancelada) {
      if (vencida(reg.expires, ahora)) {
        await r.hdel(K.alertas, clave); // terminó sola: no se avisa
        await guardarHistorial(reg, 'venció');
        delete registros[clave];
        continue;
      }
      if (!feed.completo) continue; // lectura parcial: no se saca ninguna conclusión
      if (actuales.some((g) => mismoEvento(g, reg))) {
        await r.hdel(K.alertas, clave); // reemplazada por una actualización
        await guardarHistorial(reg, 'actualizada');
        delete registros[clave];
        continue;
      }
      reg.faltas = (reg.faltas || 0) + 1;
      if (reg.faltas < RONDAS_PARA_LEVANTAR) {
        await r.hset(K.alertas, { [clave]: reg });
        continue;
      }
    }
    reg.levantada = true;
    reg.porAvisar = { ...reg.usuarios };
  }

  // Avisos de "se levantó" (también retoma los que quedaron pendientes de una pasada anterior).
  for (const [clave, reg] of Object.entries(registros)) {
    if (!reg.levantada) continue;
    const lista = Object.entries(reg.porAvisar || {}).filter(([id]) => !bloqueados.has(id));
    const res = await enviarEnTanda(
      lista.map(([, chat]) => () => sendMessage(chat, mensajeLevantada(reg))),
      { hasta }
    );
    res.forEach((x, i) => {
      if (!x) return;
      if (x.ok || x.error?.bloqueado) {
        delete reg.porAvisar[lista[i][0]];
        if (x.ok) {
          resumen.levantadas++;
          enviosOk++;
        }
      } else anotarError(x.error);
    });
    if (!Object.keys(reg.porAvisar).length) {
      await r.hdel(K.alertas, clave);
      await guardarHistorial(reg, 'levantada');
    } else {
      resumen.pendientes += Object.keys(reg.porAvisar).length;
      await r.hset(K.alertas, { [clave]: reg });
    }
  }

  // ---------- 4) Cierre ----------
  if (Object.keys(ultimaRecibida).length) await r.hset(K.recibidasU, ultimaRecibida);
  for (const id of bloqueados) {
    await actualizarUsuario(id, (u) => {
      if (u.telegram) u.telegram.bloqueado = true;
    });
  }
  if (bloqueados.size) resumen.bloquearonBot = bloqueados.size;
  if (fallasTg) await registrarFalla('telegram', ultimoErrorTg);
  else if (enviosOk) await registrarExito('telegram');

  resumen.errores = resumen.errores.slice(0, 20);
  resumen.duracionMs = Date.now() - inicio;
  await r.set(K.ultima, resumen);
  return resumen;
}
