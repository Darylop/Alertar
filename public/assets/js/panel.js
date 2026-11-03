// AlertAR — panel del cliente.
(() => {
  const { api, toast, esc, pesos, fecha, hace, ocupado, ESTADOS } = window.AR;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  let yo = null, radioKm = 4, precio = 4990;

  // ---------- Carga ----------
  async function cargar() {
    let d;
    try {
      d = await api('/api/cuenta?accion=yo');
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    if (!d.usuario) return location.replace('/cuenta');
    yo = d.usuario;
    radioKm = d.radioKm || 4;
    precio = d.precio;
    pintar();
    pintarNotificaciones(d.notificaciones || []);
  }

  // ---------- Estado general ----------
  function pintar() {
    const s = yo.servicio;
    const hechos = [!!yo.direccion, !!yo.telegram, ['activo', 'moroso'].includes(yo.pago.estado) || s.cortesia];
    document.querySelectorAll('#progreso i').forEach((i, n) => i.classList.toggle('ok', hechos[n]));
    $('#linkAdmin').classList.toggle('oculto', !yo.admin);
    document.querySelectorAll('[data-radio]').forEach((e) => (e.textContent = radioKm));

    const hero = $('#estadoHero');
    hero.classList.remove('activo', 'falta', 'moroso');
    const primerNombre = esc((yo.nombre || '').split(' ')[0]);
    if (s.recibe && yo.pago.estado === 'moroso') {
      hero.classList.add('moroso');
      $('#estadoIcono').textContent = '⚠️';
      $('#estadoTitulo').textContent = 'Tus alertas siguen activas, pero falló tu pago';
      $('#estadoTexto').textContent = `Regularizalo antes del ${fecha(s.graciaHasta)} para no perder el servicio.`;
    } else if (s.recibe) {
      hero.classList.add('activo');
      $('#estadoIcono').textContent = '🛡️';
      $('#estadoTitulo').innerHTML = `${primerNombre ? primerNombre + ', tus' : 'Tus'} alertas están <span style="color:var(--verde)">activas</span>`;
      $('#estadoTexto').textContent = `Vigilamos ${radioKm} km alrededor de ${yo.direccion.corta || 'tu dirección'} las 24 horas.`;
    } else if (yo.pago.estado === 'moroso' || s.bloqueado) {
      hero.classList.add('moroso');
      $('#estadoIcono').textContent = '⏸️';
      $('#estadoTitulo').textContent = s.bloqueado ? 'Tu cuenta está suspendida' : 'Tus alertas están pausadas';
      $('#estadoTexto').textContent = s.bloqueado ? 'Escribinos para revisar tu caso.' : 'No pudimos cobrar tu suscripción. Actualizá tu medio de pago en Mercado Pago y se reactivan solas.';
    } else {
      hero.classList.add('falta');
      const n = hechos.filter((h) => !h).length;
      $('#estadoIcono').textContent = '⏳';
      $('#estadoTitulo').innerHTML = `${primerNombre ? primerNombre + ', te' : 'Te'} ${n === 1 ? 'falta 1 paso' : `faltan ${n} pasos`}`;
      $('#estadoTexto').textContent = 'Completalos y empezás a recibir las alertas de tu zona por Telegram.';
    }

    // Banners
    const banners = [];
    if (yo.pago.estado === 'moroso') {
      banners.push(`<div class="banner rojo" role="alert"><span class="ico">💳</span><div><b>No pudimos cobrar tu suscripción</b><p>${s.recibe ? `Seguís recibiendo alertas hasta el ${esc(fecha(s.graciaHasta))}.` : 'Tus alertas están pausadas.'} Revisá tu tarjeta o saldo en Mercado Pago; el cobro se reintenta solo. <a href="https://www.mercadopago.com.ar/subscriptions" target="_blank" rel="noopener">Ir a Mercado Pago</a></p></div></div>`);
    }
    if (yo.telegram?.bloqueado) banners.push('<div class="banner amarillo"><span class="ico">🔕</span><div><b>No te podemos escribir por Telegram</b><p>Desbloqueá al bot o volvé a conectarlo desde el paso 2.</p></div></div>');
    if (yo.pago.estado === 'pendiente') banners.push('<div class="banner amarillo"><span class="ico">⏳</span><div><b>Tu pago está pendiente</b><p>Si ya lo autorizaste en Mercado Pago, tocá “Actualizar estado” en el paso 3.</p></div></div>');
    $('#banners').innerHTML = banners.join('');

    pintarDireccion();
    pintarTelegram();
    pintarPago();
    $('#pNombre').value = yo.nombre || '';
    $('#pTel').value = yo.telefono || '';
    $('#pEmail').value = yo.email;

    // Abrir el primer paso pendiente.
    const primero = !hechos[0] ? 'paso1' : !hechos[1] ? 'paso2' : !hechos[2] ? 'paso3' : null;
    document.querySelectorAll('.paso-app').forEach((p, i) => {
      if (i >= 3) return;
      // Un paso recién completado se cierra para dejar lugar al siguiente.
      if (hechos[i] && !p.classList.contains('hecho') && p.classList.contains('abierto')) abrir(p.id, false);
      p.classList.toggle('hecho', hechos[i]);
    });
    if (!document.querySelector('.paso-app.abierto') && primero) abrir(primero);
  }

  function abrir(id, forzar) {
    const p = document.getElementById(id);
    const abierto = forzar ?? !p.classList.contains('abierto');
    p.classList.toggle('abierto', abierto);
    p.querySelector('.cuerpo').classList.toggle('oculto', !abierto);
    if (abierto && id === 'paso1') setTimeout(iniciarMapa, 50);
  }
  document.querySelectorAll('.paso-app').forEach((p) => {
    p.querySelector('.cuerpo').classList.add('oculto');
    p.querySelector('[data-alternar]').addEventListener('click', () => abrir(p.id));
  });

  // ---------- Paso 1: dirección y mapa ----------
  let mapa, pin, circulo, elegido = null;
  function iniciarMapa() {
    if (!window.L) return setTimeout(iniciarMapa, 150);
    if (mapa) return mapa.invalidateSize();
    const ini = yo.direccion ? [yo.direccion.lat, yo.direccion.lon] : [-34.6037, -58.3816];
    mapa = L.map('mapa', { zoomControl: true, attributionControl: true }).setView(ini, yo.direccion ? 14 : 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    const icono = L.divIcon({ className: '', html: '<div class="pin-alertar"></div>', iconSize: [34, 34], iconAnchor: [17, 34] });
    pin = L.marker(ini, { draggable: true, icon: icono, keyboard: true, title: 'Tu casa' });
    circulo = L.circle(ini, { radius: radioKm * 1000, color: '#4cc9ff', weight: 2, dashArray: '8 6', fillColor: '#4cc9ff', fillOpacity: 0.08 });
    if (yo.direccion) { pin.addTo(mapa); circulo.addTo(mapa); }
    pin.on('dragend', () => moverA(pin.getLatLng(), true));
    mapa.on('click', (e) => moverA(e.latlng, true));
  }

  async function moverA(latlng, buscarTexto, texto, corta) {
    if (!mapa) iniciarMapa();
    pin.setLatLng(latlng).addTo(mapa);
    circulo.setLatLng(latlng).addTo(mapa);
    elegido = { lat: latlng.lat, lon: latlng.lng, corta: corta || '' };
    $('#dirOk').checked = false;
    if (texto) $('#dirTexto').value = texto;
    if (buscarTexto) {
      try {
        const d = await api(`/api/geo?lat=${latlng.lat.toFixed(6)}&lon=${latlng.lng.toFixed(6)}`);
        if (d.texto) { $('#dirTexto').value = d.texto; elegido.corta = d.corta; }
      } catch {}
    }
  }

  function pintarDireccion() {
    if (yo.direccion) {
      $('#res1').textContent = yo.direccion.texto;
      $('#dirTexto').value ||= yo.direccion.texto;
    }
  }

  $('#formBuscar').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#qDir').value.trim();
    const ul = $('#resultados');
    ocupado(e.target.querySelector('button'), async () => {
      try {
        const d = await api(`/api/geo?q=${encodeURIComponent(q)}`);
        if (!d.resultados.length) {
          ul.innerHTML = '<li class="mensaje info">No encontramos esa dirección. Probá agregando la localidad, o marcá el punto directamente en el mapa.</li>';
          return;
        }
        ul.innerHTML = d.resultados.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.texto)}<br><small>${esc(r.fuente)}</small></button></li>`).join('');
        ul.querySelectorAll('button').forEach((b) => (b.onclick = () => {
          const r = d.resultados[b.dataset.i];
          ul.innerHTML = '';
          moverA({ lat: r.lat, lng: r.lon }, false, r.texto, r.corta);
          mapa.setView([r.lat, r.lon], 16);
          toast('Revisá que el pin esté sobre tu casa');
        }));
      } catch (err) {
        ul.innerHTML = `<li class="mensaje error">${esc(err.message)}</li>`;
      }
    });
  };

  $('#miUbicacion').onclick = () => {
    if (!navigator.geolocation) return toast('Tu navegador no permite ubicarte', 'error');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        moverA({ lat: p.coords.latitude, lng: p.coords.longitude }, true);
        mapa.setView([p.coords.latitude, p.coords.longitude], 16);
      },
      () => toast('No pudimos obtener tu ubicación', 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  $('#guardarDir').onclick = (e) => {
    const p = elegido || (yo.direccion && { lat: yo.direccion.lat, lon: yo.direccion.lon, corta: yo.direccion.corta });
    if (!p) return toast('Primero buscá tu dirección o tocá el mapa', 'error');
    if (!$('#dirOk').checked) return toast('Confirmá que el pin está sobre tu casa', 'error');
    ocupado(e.currentTarget, async () => {
      try {
        const d = await api('/api/cuenta?accion=direccion', { metodo: 'POST', datos: { ...p, texto: $('#dirTexto').value } });
        yo = d.usuario;
        elegido = null;
        toast('¡Dirección guardada! ✅');
        abrir('paso1', false);
        pintar();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };

  // ---------- Paso 2: Telegram ----------
  let espera;
  function pintarTelegram() {
    const v = !!yo.telegram;
    $('#tgSinVincular').classList.toggle('oculto', v);
    $('#tgVinculado').classList.toggle('oculto', !v);
    if (v) {
      clearInterval(espera);
      $('#res2').textContent = `Conectado${yo.telegram.usuario ? ' como ' + yo.telegram.usuario : ''}`;
      $('#tgUsuario').textContent = yo.telegram.usuario || yo.telegram.nombre || 'Conectada';
      $('#tgId').textContent = yo.telegram.chatId;
      $('#tgBloqueado').classList.toggle('oculto', !yo.telegram.bloqueado);
    } else $('#res2').textContent = 'Para recibir las alertas en privado';
  }

  $('#generarQR').onclick = (e) => ocupado(e.currentTarget, async () => {
    try {
      const d = await api('/api/telegram?accion=vincular', { metodo: 'POST' });
      $('#qr').innerHTML = d.qr; // SVG generado por nuestro servidor
      $('#abrirTg').href = d.link;
      $('#botNombre').textContent = d.bot;
      $('#qrZona').classList.remove('oculto');
      clearInterval(espera);
      const hasta = Date.now() + 15 * 60 * 1000;
      espera = setInterval(async () => {
        if (Date.now() > hasta) return clearInterval(espera);
        try {
          const s = await api('/api/telegram');
          if (s.vinculado) {
            clearInterval(espera);
            toast('¡Telegram conectado! 🎉');
            await cargar();
          }
        } catch {}
      }, 3000);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#desvincular').onclick = (e) => {
    if (!confirm('¿Desconectar Telegram? Dejarás de recibir alertas hasta que lo vuelvas a conectar.')) return;
    ocupado(e.currentTarget, async () => {
      try {
        yo = (await api('/api/telegram?accion=desvincular', { metodo: 'POST' })).usuario;
        pintar();
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  $('#enviarPrueba').onclick = (e) => ocupado(e.currentTarget, async () => {
    try {
      await api('/api/telegram?accion=prueba', { metodo: 'POST' });
      toast('¡Listo! Mirá tu Telegram 📲');
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Paso 3: suscripción ----------
  function pintarPago() {
    const p = yo.pago;
    const tiene = ['activo', 'moroso', 'pendiente'].includes(p.estado) && !!p.monto;
    $('#pagoSin').classList.toggle('oculto', tiene && p.estado !== 'pendiente');
    $('#pagoCon').classList.toggle('oculto', !tiene);
    $('#precio').textContent = pesos(precio);
    $('#mpEmail').value ||= p.mpEmail || yo.email;
    $('#suscribir').textContent = p.estado === 'pendiente' ? 'Reintentar el pago en Mercado Pago' : 'Pagar con Mercado Pago';
    const cortesia = yo.servicio.cortesia ? ' · cortesía' : '';
    $('#res3').textContent = (ESTADOS[p.estado] || p.estado) + cortesia;
    $('#pagoEstado').innerHTML = `<span class="estado ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span>`;
    $('#pagoMonto').textContent = p.monto ? `${pesos(p.monto)} / mes` : '—';
    $('#pagoProx').textContent = fecha(p.proximoCobro);
    $('#pagoUlt').textContent = fecha(p.ultimoCobro);
    $('#pagoMail').textContent = p.mpEmail || '—';
    $('#cancelar').classList.toggle('oculto', !['activo', 'moroso'].includes(p.estado));
  }

  $('#suscribir').onclick = (e) => ocupado(e.currentTarget, async () => {
    try {
      const d = await api('/api/pago?accion=suscribir', { metodo: 'POST', datos: { mpEmail: $('#mpEmail').value } });
      location.href = d.url;
    } catch (err) { toast(err.message, 'error'); }
  });

  async function sincronizar(boton, preapprovalId) {
    const fn = async () => {
      try {
        yo = (await api('/api/pago?accion=sincronizar', { metodo: 'POST', datos: { preapprovalId } })).usuario;
        pintar();
        if (yo.pago.estado === 'activo') toast('¡Suscripción activa! ✅');
        else toast(`Estado: ${ESTADOS[yo.pago.estado] || yo.pago.estado}`);
      } catch (err) { toast(err.message, 'error'); }
    };
    return boton ? ocupado(boton, fn) : fn();
  }
  $('#sincronizar').onclick = (e) => sincronizar(e.currentTarget);

  $('#cancelar').onclick = (e) => {
    if (!confirm('¿Seguro que querés cancelar? Dejarás de recibir alertas.')) return;
    ocupado(e.currentTarget, async () => {
      try {
        yo = (await api('/api/pago?accion=cancelar', { metodo: 'POST' })).usuario;
        pintar();
        toast('Suscripción cancelada');
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  // ---------- Datos ----------
  $('#formPerfil').onsubmit = (e) => {
    e.preventDefault();
    ocupado(e.target.querySelector('button'), async () => {
      try {
        yo = (await api('/api/cuenta?accion=perfil', { metodo: 'POST', datos: { nombre: $('#pNombre').value, telefono: $('#pTel').value } })).usuario;
        toast('Datos guardados');
        pintar();
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  $('#formPass').onsubmit = (e) => {
    e.preventDefault();
    ocupado(e.target.querySelector('button'), async () => {
      try {
        await api('/api/cuenta?accion=password', { metodo: 'POST', datos: { actual: $('#pActual').value, nueva: $('#pNueva').value } });
        e.target.reset();
        toast('Contraseña actualizada');
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  // ---------- Notificaciones ----------
  function pintarNotificaciones(lista) {
    const nuevas = lista.filter((n) => !n.leida).length;
    $('#cuentaNotif').textContent = nuevas;
    $('#cuentaNotif').classList.toggle('oculto', !nuevas);
    const ico = { pago: '💳', ok: '✅', info: 'ℹ️' };
    $('#listaNotif').innerHTML = lista.length
      ? lista.map((n) => `<div class="notif-item ${n.leida ? '' : 'nueva'}">${ico[n.tipo] || 'ℹ️'} ${esc(n.texto)}<time>${esc(hace(n.fecha))}</time></div>`).join('')
      : '<div class="notif-item">No tenés notificaciones.</div>';
  }
  $('#campana').onclick = async (e) => {
    e.stopPropagation();
    const lista = $('#listaNotif');
    const abrirla = lista.classList.contains('oculto');
    lista.classList.toggle('oculto', !abrirla);
    $('#campana').setAttribute('aria-expanded', String(abrirla));
    if (abrirla && !$('#cuentaNotif').classList.contains('oculto')) {
      api('/api/cuenta?accion=notificaciones-leidas', { metodo: 'POST' }).catch(() => {});
      $('#cuentaNotif').classList.add('oculto');
    }
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#listaNotif')) $('#listaNotif').classList.add('oculto');
  });

  $('#salir').onclick = async () => {
    await api('/api/cuenta?accion=salir', { metodo: 'POST' }).catch(() => {});
    location.replace('/');
  };

  // ---------- Inicio ----------
  cargar().then(() => {
    if (params.get('pago') === 'volvio') {
      history.replaceState(null, '', '/panel');
      sincronizar(null, params.get('preapproval_id') || undefined);
    }
    if (params.get('bienvenida')) {
      history.replaceState(null, '', '/panel');
      toast('¡Cuenta creada! Empezá por tu dirección 📍');
    }
  });
})();
