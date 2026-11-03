// AlertAR — animaciones de la landing (lluvia, relámpagos, teléfono, radar) y precio.
(() => {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);

  // ---------- Precio desde el servidor ----------
  const pesos = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  fetch('/api/publico')
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) return;
      document.querySelectorAll('[data-precio]').forEach((e) => (e.textContent = pesos(d.precio)));
      document.querySelectorAll('[data-por-dia]').forEach((e) => (e.textContent = pesos(Math.ceil(d.precio / 30 / 10) * 10)));
    })
    .catch(() => {});

  // ---------- Barra de navegación y botón fijo en celulares ----------
  const nav = $('#nav');
  const cta = $('#ctaMovil');
  const alScroll = () => {
    const y = scrollY;
    nav.classList.toggle('con-fondo', y > 20);
    const alto = innerHeight * 0.9;
    const finPagina = y + innerHeight > document.body.scrollHeight - 500;
    cta.classList.toggle('ver', y > alto && !finPagina);
  };
  addEventListener('scroll', alScroll, { passive: true });
  alScroll();

  // ---------- Aparición al hacer scroll ----------
  const obs = new IntersectionObserver(
    (entradas) => entradas.forEach((e) => e.isIntersecting && (e.target.classList.add('visto'), obs.unobserve(e.target))),
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  document.querySelectorAll('.revelar').forEach((el) => obs.observe(el));

  // ---------- Cinta de fenómenos ----------
  const fen = [['Tormentas', '#ff8a00'], ['Lluvias', '#ffd23f'], ['Vientos', '#ffd23f'], ['Granizo', '#ff4d4d'], ['Nevadas', '#4cc9ff'], ['Viento Zonda', '#ff8a00'], ['Temperaturas extremas', '#ff4d4d'], ['Tormentas fuertes', '#ff4d4d']];
  const html = fen.map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  $('#cinta').innerHTML = html + html + html + html;

  // ---------- Lluvia y relámpagos ----------
  const canvas = $('#lluvia');
  const ctx = canvas.getContext('2d');
  let gotas = [], W = 0, H = 0, activo = true;
  function medir() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(260, Math.round((W * H) / 6500));
    gotas = Array.from({ length: n }, () => nuevaGota(true));
  }
  function nuevaGota(inicio) {
    const z = Math.random();
    return { x: Math.random() * (W + 200) - 100, y: inicio ? Math.random() * H : -30, l: 10 + z * 22, v: 7 + z * 13, a: 0.08 + z * 0.32 };
  }
  function cuadro() {
    if (!activo) return;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (const g of gotas) {
      ctx.strokeStyle = `rgba(170, 200, 255, ${g.a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x - g.l * 0.25, g.y + g.l);
      ctx.stroke();
      g.y += g.v; g.x -= g.v * 0.25;
      if (g.y > H + 20) Object.assign(g, nuevaGota(false));
    }
    requestAnimationFrame(cuadro);
  }
  // Pausar la lluvia cuando el hero no se ve (ahorra batería).
  new IntersectionObserver(([e]) => {
    const antes = activo;
    activo = e.isIntersecting;
    if (activo && !antes && !reducido) requestAnimationFrame(cuadro);
  }).observe($('.hero'));
  if (!reducido) {
    medir();
    addEventListener('resize', medir);
    requestAnimationFrame(cuadro);
    const destello = $('#destello');
    const relampago = () => {
      if (activo && !document.hidden) {
        destello.classList.remove('on');
        void destello.offsetWidth;
        destello.classList.add('on');
      }
      setTimeout(relampago, 5000 + Math.random() * 7000);
    };
    setTimeout(relampago, 1800);
  }

  // ---------- Teléfono: llega la alerta ----------
  const b1 = $('#b1'), b2 = $('#b2'), escr = $('#escribiendo'), notif = $('#notif');
  const t = (ms) => new Promise((r) => setTimeout(r, ms));
  async function secuencia() {
    if (reducido) { b1.classList.add('ver'); b2.classList.add('ver'); return; }
    for (;;) {
      b1.classList.add('ver');
      await t(1400);
      notif.classList.add('ver');
      await t(900);
      escr.classList.add('ver');
      await t(1500);
      escr.classList.remove('ver');
      escr.classList.add('oculto');
      b2.classList.add('ver');
      await t(2200);
      notif.classList.remove('ver');
      await t(6500);
      b2.classList.remove('ver');
      b1.classList.remove('ver');
      escr.classList.remove('oculto');
      await t(900);
    }
  }
  secuencia();

  // ---------- Radar: una tormenta cruza el radio ----------
  const radar = $('#radar');
  const tormenta = $('#tormenta');
  if (radar && tormenta) {
    // Forma irregular de la tormenta (relativa a su centro).
    const forma = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const r = 70 + Math.sin(i * 1.7) * 18 + Math.cos(i * 2.3) * 12;
      return [Math.cos(a) * r * 1.35, Math.sin(a) * r];
    });
    let inicio = null, visible = false;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(radar);
    const R = 72, C = 250;
    function paso(ts) {
      if (inicio === null) inicio = ts;
      const ciclo = 9000;
      const p = ((ts - inicio) % ciclo) / ciclo;
      const cx = -120 + p * 740, cy = 120 + p * 230;
      const pts = forma.map(([x, y]) => [cx + x, cy + y]);
      tormenta.setAttribute('d', 'M' + pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join('L') + 'Z');
      // ¿Algún punto del borde o el centro del radio quedan cerca? (aproximación visual)
      const dentro = pts.some(([x, y]) => Math.hypot(x - C, y - C) < R) || Math.hypot(cx - C, cy - C) < 95;
      radar.classList.toggle('alerta', dentro);
      if (visible || inicio === ts) requestAnimationFrame(paso);
      else setTimeout(() => requestAnimationFrame(paso), 400);
    }
    if (reducido) {
      tormenta.setAttribute('d', 'M' + forma.map(([x, y]) => `${(220 + x).toFixed(1)},${(220 + y).toFixed(1)}`).join('L') + 'Z');
      radar.classList.add('alerta');
    } else requestAnimationFrame(paso);
  }
})();
