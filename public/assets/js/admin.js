// AlertAR — panel de administración.
(() => {
  const { api, toast, esc, pesos, fecha, hace, ocupado, ESTADOS } = window.AR;
  const $ = (s) => document.querySelector(s);
  let clientes = [], config = {}, mapa;
  const NIVEL = { Moderate: 'amarilla', Severe: 'naranja', Extreme: 'roja', Minor: 'verde' };

  async function cargar() {
    let d;
    try {
      d = await api('/api/admin?accion=clientes');
    } catch (e) {
      if (e.status === 403 || e.status === 401) return location.replace('/cuenta?volver=admin');
      return toast(e.message, 'error');
    }
    clientes = d.clientes;
    config = d.config;
    pintarMetricas(d.metricas);
    pintarClientes();
    $('#cPrecio').value = config.precio;
    $('#cGracia').value = config.graciaDias;
  }

  function pintarMetricas(m) {
    const items = [
      ['Clientes', m.total], ['Recibiendo alertas', m.recibiendo], ['Al día', m.activos], ['Pago fallido', m.morosos],
      ['Ingreso mensual', pesos(m.ingresoMensual)], ['Nuevos (7 días)', m.nuevos7d], ['Pago pendiente', m.pendientes],
      ['Sin suscripción', m.sinSuscripcion], ['Sin Telegram', m.sinTelegram], ['Sin dirección', m.sinDireccion], ['Cortesía', m.cortesia], ['Cancelados', m.cancelados],
    ];
    $('#metricas').innerHTML = items.map(([t, v]) => `<div class="metrica"><span>${t}</span><b>${esc(v)}</b></div>`).join('');
  }

  const chipPago = (c) => `<span class="estado ${esc(c.pago)}">${esc(ESTADOS[c.pago] || c.pago)}</span>${c.cortesia ? ' <span class="estado cortesia">Cortesía</span>' : ''}${c.bloqueado ? ' <span class="estado moroso">Suspendido</span>' : ''}`;

  function filtrados() {
    const q = $('#buscar').value.trim().toLowerCase();
    const f = $('#filtro').value;
    return clientes.filter((c) => {
      if (q && ![c.nombre, c.email, c.direccion, c.telefono, c.telegram?.usuario].join(' ').toLowerCase().includes(q)) return false;
      if (!f) return true;
      if (f === 'recibe') return c.recibe;
      if (f === 'cortesia') return c.cortesia;
      if (f === 'incompleto') return c.faltan.includes('direccion') || c.faltan.includes('telegram');
      return c.pago === f;
    });
  }

  function pintarClientes() {
    const lista = filtrados();
    $('#conteo').textContent = `${lista.length} de ${clientes.length} clientes`;
    $('#filas').innerHTML = lista.map((c) => `
      <tr data-id="${esc(c.id)}">
        <td><b>${esc(c.nombre)}</b> ${c.recibe ? '🟢' : ''}<br><small>${esc(c.email)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</small></td>
        <td>${c.direccion ? esc(c.direccion) : '<small>— sin dirección</small>'}</td>
        <td>${c.telegram ? `${esc(c.telegram.usuario || 'Conectado')}${c.telegram.bloqueado ? ' 🔕' : ''}<br><small>${esc(c.telegram.chatId)}</small>` : '<small>— no vinculado</small>'}</td>
        <td>${chipPago(c)}</td>
        <td>${esc(fecha(c.proximoCobro))}</td>
        <td><small>${c.ultimaAlerta ? esc(hace(c.ultimaAlerta)) : '—'}</small></td>
        <td><small>${esc(fecha(c.creado))}</small></td>
      </tr>`).join('') || '<tr><td colspan="7">No hay clientes con ese filtro.</td></tr>';
    $('#tarjetas').innerHTML = lista.map((c) => `
      <article class="tarjeta tarjeta-cliente" data-id="${esc(c.id)}">
        <div class="fila"><b>${esc(c.nombre)} ${c.recibe ? '🟢' : ''}</b>${chipPago(c)}</div>
        <small>${esc(c.email)}</small>
        <small>${c.direccion ? '📍 ' + esc(c.direccion) : '📍 sin dirección'}</small>
        <small>${c.telegram ? '📲 ' + esc(c.telegram.usuario || c.telegram.chatId) : '📲 sin Telegram'} · alta ${esc(fecha(c.creado))}</small>
      </article>`).join('');
    document.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => abrirCliente(el.dataset.id)));
  }
  $('#buscar').oninput = pintarClientes;
  $('#filtro').onchange = pintarClientes;

  // ---------- Ficha del cliente ----------
  async function abrirCliente(id) {
    let c;
    try {
      c = (await api(`/api/admin?accion=cliente&id=${encodeURIComponent(id)}`)).cliente;
    } catch (e) {
      return toast(e.message, 'error');
    }
    const r = c.resumen;
    const mapsLink = r.lat != null ? `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=16/${r.lat}/${r.lon}` : null;
    $('#cajonCuerpo').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h2 id="cajonTitulo" style="margin:0">${esc(c.nombre)}</h2>
        <button class="btn btn-sec btn-chico" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <p>${chipPago(r)} ${r.recibe ? '<span class="estado activo">Recibe alertas</span>' : `<span class="estado pendiente">No recibe: falta ${esc(r.faltan.join(', ') || 'pago')}</span>`}</p>
      <dl class="ficha">
        <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
        <dt>Celular</dt><dd>${c.telefono ? `<a href="https://wa.me/${esc(String(c.telefono).replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(c.telefono)}</a>` : '—'}</dd>
        <dt>Alta</dt><dd>${esc(fecha(c.creado, true))}</dd>
        <dt>Dirección</dt><dd>${c.direccion ? `${esc(c.direccion.texto)}<br><small>${r.lat}, ${r.lon}</small> · <a href="${mapsLink}" target="_blank" rel="noopener">ver en mapa</a>` : '—'}</dd>
        <dt>Telegram</dt><dd>${c.telegram ? `${esc(c.telegram.usuario || c.telegram.nombre || '')} <code>${esc(c.telegram.chatId)}</code>${c.telegram.bloqueado ? ' 🔕 bloqueó al bot' : ''}<br><small>vinculado ${esc(fecha(c.telegram.vinculado, true))}</small>` : '—'}</dd>
        <dt>Suscripción</dt><dd>${esc(ESTADOS[r.pago] || r.pago)}${r.monto ? ` · ${pesos(r.monto)}/mes` : ''}${c.pago?.preapprovalId ? `<br><small>MP: ${esc(c.pago.preapprovalId)} (${esc(c.pago.mpEstado || '')})</small>` : ''}</dd>
        <dt>Cuenta MP</dt><dd>${esc(r.mpEmail || '—')}</dd>
        <dt>Próximo cobro</dt><dd>${esc(fecha(r.proximoCobro))}</dd>
        <dt>Último cobro</dt><dd>${esc(fecha(r.ultimoCobro))}</dd>
        ${r.morosoDesde ? `<dt>Pago fallido desde</dt><dd>${esc(fecha(r.morosoDesde, true))}</dd>` : ''}
        <dt>Última alerta</dt><dd>${r.ultimaAlerta ? esc(fecha(r.ultimaAlerta, true)) : '—'}</dd>
      </dl>
      <div class="acciones">
        <button class="btn btn-sec btn-chico" data-op="sincronizar">↻ Consultar Mercado Pago</button>
        <button class="btn btn-sec btn-chico" data-op="recordatorio">💳 Enviar aviso de pago</button>
        <button class="btn btn-sec btn-chico" data-op="cortesia">${r.cortesia ? 'Quitar cortesía' : '🎁 Dar cortesía (gratis)'}</button>
        <button class="btn btn-peligro btn-chico" data-op="bloquear">${r.bloqueado ? 'Reactivar cuenta' : 'Suspender cuenta'}</button>
      </div>
      <div class="campo" style="margin-top:20px"><label for="msjTexto">Mensaje por Telegram</label><textarea class="entrada" id="msjTexto" rows="3" maxlength="1500" placeholder="Hola, …"></textarea></div>
      <button class="btn btn-azul btn-chico" data-op="mensaje" ${c.telegram ? '' : 'disabled'}>Enviar mensaje</button>
      <div class="campo" style="margin-top:20px"><label for="notaTexto">Nota interna</label><textarea class="entrada" id="notaTexto" rows="2" maxlength="500">${esc(c.nota || '')}</textarea></div>
      <button class="btn btn-sec btn-chico" data-op="nota">Guardar nota</button>
      <h3 style="margin-top:24px">Historial</h3>
      <ul class="historial">${(c.historial || []).map((h) => `<li><time>${esc(fecha(h.fecha, true))}</time>${esc(h.evento)}</li>`).join('') || '<li>—</li>'}</ul>`;
    $('#cajon').classList.remove('oculto');
    $('#cajonCuerpo').querySelector('[data-cerrar]').onclick = cerrar;
    $('#cajonCuerpo').querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => operar(c.id, b)));
  }
  function cerrar() { $('#cajon').classList.add('oculto'); }
  $('#cajon').onclick = (e) => { if (e.target.id === 'cajon') cerrar(); };
  addEventListener('keydown', (e) => e.key === 'Escape' && cerrar());

  function operar(id, boton) {
    const operacion = boton.dataset.op;
    if (operacion === 'bloquear' && !confirm('¿Confirmás el cambio de estado de la cuenta?')) return;
    const datos = { id, operacion };
    if (operacion === 'mensaje') datos.texto = $('#msjTexto').value;
    if (operacion === 'nota') datos.nota = $('#notaTexto').value;
    ocupado(boton, async () => {
      try {
        await api('/api/admin?accion=cliente', { metodo: 'POST', datos });
        toast('Hecho ✅');
        await cargar();
        if (operacion !== 'mensaje') abrirCliente(id);
        else $('#msjTexto').value = '';
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- Pestañas ----------
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('oculto', p.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === 'mapa') pintarMapa();
    if (b.dataset.tab === 'sistema') cargarSistema();
  }));

  function pintarMapa() {
    if (!window.L) return setTimeout(pintarMapa, 200);
    if (!mapa) {
      mapa = L.map('mapaClientes').setView([-34.6, -58.45], 10);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    }
    setTimeout(() => mapa.invalidateSize(), 50);
    mapa.eachLayer((l) => l instanceof L.Path && mapa.removeLayer(l));
    const puntos = [];
    for (const c of clientes) {
      if (c.lat == null) continue;
      const color = c.recibe ? '#2ee59d' : c.pago === 'moroso' ? '#ff8a00' : c.faltan.length && c.pago === 'activo' ? '#ffd23f' : '#9aa8c2';
      L.circle([c.lat, c.lon], { radius: 4000, color, weight: 1, fillOpacity: 0.05 }).addTo(mapa);
      L.circleMarker([c.lat, c.lon], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
        .addTo(mapa)
        .bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(c.direccion)}<br>${esc(ESTADOS[c.pago] || c.pago)}`);
      puntos.push([c.lat, c.lon]);
    }
    if (puntos.length) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 14 });
  }

  // ---------- Sistema ----------
  async function cargarSistema() {
    let s;
    try {
      s = await api('/api/admin?accion=sistema');
    } catch (e) { return toast(e.message, 'error'); }
    const u = s.ultima;
    $('#ultima').innerHTML = u
      ? `<dl class="ficha"><dt>Cuándo</dt><dd>${esc(fecha(u.fecha, true))} (${esc(hace(u.fecha))})</dd><dt>Archivos SMN</dt><dd>${esc(u.archivos ?? '—')} ${u.completo === false ? '⚠️ lectura incompleta' : ''}</dd><dt>Clientes activos</dt><dd>${esc(u.clientesActivos ?? '—')}</dd><dt>Enviadas</dt><dd>${u.enviadas} nuevas · ${u.actualizaciones} actualizaciones · ${u.levantadas} levantadas</dd><dt>Pendientes</dt><dd>${u.pendientes}</dd><dt>Duración</dt><dd>${esc(u.duracionMs)} ms</dd>${u.errores?.length ? `<dt>Errores</dt><dd><small>${u.errores.map(esc).join('<br>')}</small></dd>` : ''}</dl>`
      : '<p class="mensaje info">Todavía no corrió ninguna revisión. Revisá que cron-job.org esté configurado.</p>';
    if (s.fallas.smn >= 3 || s.fallas.telegram >= 3) $('#ultima').insertAdjacentHTML('afterbegin', `<p class="mensaje error">Fallas seguidas — SMN: ${s.fallas.smn} · Telegram: ${s.fallas.telegram}</p>`);
    const t = s.telegram;
    $('#tgInfo').innerHTML = `<dl class="ficha"><dt>Bot</dt><dd>${esc(t.bot || '—')}</dd><dt>Webhook</dt><dd>${t.webhook ? '✅ ' + esc(t.webhook) : '❌ sin conectar'}</dd>${t.ultimoError ? `<dt>Último error</dt><dd>${esc(t.ultimoError)}</dd>` : ''}</dl>`;
    $('#activas').innerHTML = s.alertas.length
      ? `<ul class="historial">${s.alertas.map((a) => `<li><b>${esc(NIVEL[a.severity] || a.severity)} · ${esc(a.event)}</b> — ${a.enviados} enviados${a.levantada ? ' (levantándose)' : ''}<br><small>${esc(fecha(a.onset, true))} → ${esc(fecha(a.expires, true))}</small></li>`).join('')}</ul>`
      : '<p style="color:var(--suave)">No hay alertas vigentes en zonas de clientes.</p>';
    $('#variables').innerHTML = `<ul class="historial">${Object.entries(s.variables).map(([k, v]) => `<li>${v ? '✅' : '⬜'} <code>${k}</code></li>`).join('')}</ul>`;
    const d = s.diario;
    $('#diario').innerHTML = d ? `<p style="color:var(--suave)">${esc(fecha(d.fecha, true))}: ${d.revisados} revisados, ${d.morosos} con pago fallido, ${d.avisos} avisos, ${d.recordatorios} recordatorios.</p>` : '<p style="color:var(--suave)">Todavía no corrió.</p>';
    $('#historial').innerHTML = s.historial.map((h) => `<tr><td>${esc(NIVEL[h.severity] || h.severity)} · ${esc(h.event)}</td><td><small>${esc(fecha(h.onset, true))} → ${esc(fecha(h.expires, true))}</small></td><td>${esc(h.enviados)}</td><td>${esc(h.fin)} <small>${esc(fecha(h.cerrada, true))}</small></td></tr>`).join('') || '<tr><td colspan="4">Sin historial todavía.</td></tr>';
  }

  $('#revisarAhora').onclick = (e) => ocupado(e.currentTarget, async () => {
    try {
      await api('/api/admin?accion=revisar-ahora', { metodo: 'POST' });
      toast('Revisión iniciada. Actualizá en unos segundos.');
      setTimeout(cargarSistema, 8000);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#conectarWebhook').onclick = (e) => ocupado(e.currentTarget, async () => {
    try {
      const d = await api('/api/admin?accion=webhook-telegram', { metodo: 'POST' });
      toast('Bot conectado ✅');
      cargarSistema();
      return d;
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#formConfig').onsubmit = (e) => {
    e.preventDefault();
    ocupado(e.target.querySelector('button'), async () => {
      try {
        config = (await api('/api/admin?accion=config', { metodo: 'POST', datos: { precio: $('#cPrecio').value, graciaDias: $('#cGracia').value } })).config;
        toast('Guardado ✅');
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  $('#salir').onclick = async () => {
    await api('/api/cuenta?accion=salir', { metodo: 'POST' }).catch(() => {});
    location.replace('/');
  };

  cargar();
})();
