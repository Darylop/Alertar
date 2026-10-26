// AlertAR — utilidades compartidas por cuenta, panel y admin.
window.AR = (() => {
  async function api(ruta, { metodo = 'GET', datos } = {}) {
    const op = { method: metodo, headers: { 'X-Alertar': '1' }, credentials: 'same-origin' };
    if (datos !== undefined) {
      op.headers['Content-Type'] = 'application/json';
      op.body = JSON.stringify(datos);
    }
    let r;
    try {
      r = await fetch(ruta, op);
    } catch {
      throw new Error('Sin conexión. Revisá tu internet y probá de nuevo.');
    }
    const d = await r.json().catch(() => ({ ok: false, error: 'Respuesta inesperada del servidor.' }));
    if (!r.ok || d.ok === false) {
      const e = new Error(d.error || `Error ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return d;
  }

  let tt;
  function toast(texto, tipo = '') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.className = `toast ${tipo}`;
    requestAnimationFrame(() => el.classList.add('ver'));
    clearTimeout(tt);
    tt = setTimeout(() => el.classList.remove('ver'), 3800);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pesos = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));
  const fecha = (iso, conHora = false) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}) });
  };
  const hace = (iso) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 60) return 'recién';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
  };

  /** Muestra el error dentro de un formulario. */
  function mensaje(contenedor, texto, tipo = 'error') {
    let el = contenedor.querySelector('.mensaje');
    if (!texto) return el && el.remove();
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('role', 'alert');
      contenedor.prepend(el);
    }
    el.className = `mensaje ${tipo}`;
    el.textContent = texto;
  }

  /** Deshabilita el botón mientras corre la acción. */
  async function ocupado(boton, fn) {
    const txt = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<span class="girador" aria-hidden="true"></span> Un momento…';
    try {
      return await fn();
    } finally {
      boton.disabled = false;
      boton.innerHTML = txt;
    }
  }

  const ESTADOS = { activo: 'Al día', moroso: 'Pago fallido', pendiente: 'Pendiente', sin_suscripcion: 'Sin suscripción', cancelado: 'Cancelada' };

  return { api, toast, esc, pesos, fecha, hace, mensaje, ocupado, ESTADOS };
})();
