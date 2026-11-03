// /api/cuenta?accion=... — registro, ingreso, datos del cliente, dirección y contraseña.
import { db, K } from '../lib/db.js';
import { json, error, cuerpo, parametro, desdeLaWeb, ipDe, manejar } from '../lib/http.js';
import { hashPassword, verificarPassword, cookieSesion, cookieSalir, usuarioDeSesion, demasiadosIntentos, tokenAleatorio } from '../lib/auth.js';
import { nuevoId, normalizarEmail, idPorEmail, leerUsuario, guardarUsuario, agregarHistorial, fichaPublica, leerConfig, leerNotificaciones, marcarLeidas, notificar } from '../lib/usuarios.js';
import { enviarCorreo } from '../lib/email.js';
import { MARCA, RADIO_KM, urlSitio } from '../lib/config.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const limpiar = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

// Rectángulo que contiene a la Argentina continental (el SMN solo publica alertas del país).
const enArgentina = (lat, lon) => lat > -56 && lat < -21 && lon > -74 && lon < -53;

export const GET = manejar(async (req) => {
  if (parametro(req, 'accion') !== 'yo') return error('Acción desconocida', 404);
  const u = await usuarioDeSesion(req);
  if (!u) return json({ ok: true, usuario: null });
  const [config, notificaciones] = await Promise.all([leerConfig(), leerNotificaciones(u.id)]);
  return json({ ok: true, usuario: fichaPublica(u, config), notificaciones, precio: config.precio, radioKm: RADIO_KM });
});

export const POST = manejar(async (req) => {
  if (!desdeLaWeb(req)) return error('Solicitud no válida', 403);
  const accion = parametro(req, 'accion');
  const b = await cuerpo(req);

  if (accion === 'registro') {
    const nombre = limpiar(b.nombre, 80);
    const email = normalizarEmail(b.email);
    const telefono = limpiar(b.telefono, 30);
    const password = String(b.password || '');
    if (nombre.length < 2) return error('Ingresá tu nombre.');
    if (!EMAIL_RE.test(email)) return error('El email no es válido.');
    if (password.length < 8 || password.length > 200) return error('La contraseña debe tener al menos 8 caracteres.');
    if (!b.acepta) return error('Tenés que aceptar los términos y la política de privacidad.');
    if (await demasiadosIntentos(`registro:${ipDe(req)}`, 10, 3600)) return error('Demasiados registros desde esta conexión. Probá más tarde.', 429);
    if (await idPorEmail(email)) return error('Ya existe una cuenta con ese email. Ingresá o recuperá tu contraseña.', 409);
    const u = {
      id: nuevoId(),
      nombre,
      email,
      telefono,
      passHash: hashPassword(password),
      passVer: 1,
      creado: new Date().toISOString(),
      direccion: null,
      telegram: null,
      pago: { estado: 'sin_suscripcion' },
      cortesia: false,
      bloqueado: false,
      historial: [],
      aceptoTerminos: new Date().toISOString(),
    };
    agregarHistorial(u, 'Se registró');
    await db().hset(K.email, { [email]: u.id });
    await guardarUsuario(u);
    await notificar(u.id, 'info', '¡Bienvenido/a! Completá los 3 pasos para activar tus alertas.');
    await enviarCorreo(email, {
      asunto: `Bienvenido/a a ${MARCA}`,
      titulo: `¡Hola ${nombre}! Ya tenés tu cuenta`,
      parrafos: ['Para empezar a recibir alertas, completá estos pasos desde tu panel:', `1) Marcá tu dirección en el mapa (te avisamos en un radio de ${RADIO_KM} km).`, '2) Conectá Telegram escaneando el código QR.', '3) Activá tu suscripción mensual con Mercado Pago.'],
      boton: { texto: 'Ir a mi panel', url: `${urlSitio(req)}/panel` },
    });
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion(u, req) });
  }

  if (accion === 'ingresar') {
    const email = normalizarEmail(b.email);
    if (await demasiadosIntentos(`login:${email}`)) return error('Demasiados intentos. Esperá 15 minutos y probá de nuevo.', 429);
    const u = await leerUsuario(await idPorEmail(email));
    if (!u || !verificarPassword(b.password, u.passHash)) return error('Email o contraseña incorrectos.', 401);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion(u, req) });
  }

  if (accion === 'salir') return json({ ok: true }, 200, { 'Set-Cookie': cookieSalir() });

  if (accion === 'recuperar') {
    const email = normalizarEmail(b.email);
    if (await demasiadosIntentos(`recuperar:${ipDe(req)}`, 5, 3600)) return error('Demasiados pedidos. Probá más tarde.', 429);
    const id = await idPorEmail(email);
    if (id) {
      const token = tokenAleatorio(24);
      await db().set(K.reset(token), id, { ex: 3600 });
      await enviarCorreo(email, {
        asunto: `${MARCA}: cambiá tu contraseña`,
        titulo: 'Cambiar contraseña',
        parrafos: ['Recibimos un pedido para cambiar tu contraseña. El enlace vence en 1 hora.', 'Si no lo pediste, ignorá este correo.'],
        boton: { texto: 'Elegir una contraseña nueva', url: `${urlSitio(req)}/cuenta?restablecer=${token}` },
      });
    }
    // Misma respuesta exista o no la cuenta (no revela qué emails están registrados).
    return json({ ok: true });
  }

  if (accion === 'restablecer') {
    const token = String(b.token || '');
    const password = String(b.password || '');
    if (password.length < 8) return error('La contraseña debe tener al menos 8 caracteres.');
    const id = /^[\w-]{20,64}$/.test(token) ? await db().get(K.reset(token)) : null;
    const u = await leerUsuario(id);
    if (!u) return error('El enlace venció o ya se usó. Pedí uno nuevo.', 400);
    await db().del(K.reset(token));
    u.passHash = hashPassword(password);
    u.passVer = (u.passVer || 1) + 1;
    agregarHistorial(u, 'Cambió la contraseña (recuperación)');
    await guardarUsuario(u);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion(u, req) });
  }

  // ----- A partir de acá, con sesión -----
  const u = await usuarioDeSesion(req);
  if (!u) return error('Tu sesión venció. Ingresá de nuevo.', 401);

  if (accion === 'direccion') {
    const lat = Number(b.lat), lon = Number(b.lon);
    const texto = limpiar(b.texto, 200);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !enArgentina(lat, lon)) return error('Marcá un punto dentro de la Argentina.');
    if (texto.length < 5) return error('Escribí tu dirección completa.');
    u.direccion = {
      texto,
      corta: limpiar(b.corta, 80) || texto.split(',')[0],
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      actualizada: new Date().toISOString(),
    };
    agregarHistorial(u, `Dirección: ${texto}`);
    await guardarUsuario(u);
    return json({ ok: true, usuario: fichaPublica(u, await leerConfig()) });
  }

  if (accion === 'perfil') {
    const nombre = limpiar(b.nombre, 80);
    if (nombre.length < 2) return error('Ingresá tu nombre.');
    u.nombre = nombre;
    u.telefono = limpiar(b.telefono, 30);
    await guardarUsuario(u);
    return json({ ok: true, usuario: fichaPublica(u, await leerConfig()) });
  }

  if (accion === 'password') {
    if (!verificarPassword(b.actual, u.passHash)) return error('La contraseña actual no es correcta.', 401);
    if (String(b.nueva || '').length < 8) return error('La contraseña nueva debe tener al menos 8 caracteres.');
    u.passHash = hashPassword(b.nueva);
    u.passVer = (u.passVer || 1) + 1;
    agregarHistorial(u, 'Cambió la contraseña');
    await guardarUsuario(u);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieSesion(u, req) });
  }

  if (accion === 'notificaciones-leidas') {
    await marcarLeidas(u.id);
    return json({ ok: true });
  }

  return error('Acción desconocida', 404);
});
