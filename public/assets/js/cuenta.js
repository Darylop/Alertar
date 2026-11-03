// AlertAR — ingreso, registro y recuperación de contraseña.
(() => {
  const { api, mensaje, ocupado, toast } = window.AR;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const vistas = { principal: $('#vistaPrincipal'), recuperar: $('#formRecuperar'), restablecer: $('#formRestablecer') };

  function mostrar(v) {
    Object.entries(vistas).forEach(([k, el]) => el.classList.toggle('oculto', k !== v));
  }
  function pestana(registro) {
    $('#tabIngresar').setAttribute('aria-selected', String(!registro));
    $('#tabRegistro').setAttribute('aria-selected', String(registro));
    $('#formIngresar').classList.toggle('oculto', registro);
    $('#formRegistro').classList.toggle('oculto', !registro);
    (registro ? $('#rNombre') : $('#iEmail')).focus({ preventScroll: true });
  }

  $('#tabIngresar').onclick = () => pestana(false);
  $('#tabRegistro').onclick = () => pestana(true);
  $('#linkRecuperar').onclick = (e) => { e.preventDefault(); mostrar('recuperar'); $('#recEmail').value = $('#iEmail').value; };
  document.querySelectorAll('[data-volver]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); mostrar('principal'); pestana(false); }));

  const irAlPanel = () => location.replace(params.get('volver') === 'admin' ? '/admin' : '/panel');

  // Si ya tiene sesión, directo al panel.
  if (!params.get('restablecer')) {
    api('/api/cuenta?accion=yo').then((d) => d.usuario && irAlPanel()).catch(() => {});
  }

  $('#formIngresar').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    mensaje(f, '');
    ocupado(f.querySelector('button[type=submit]'), async () => {
      try {
        await api('/api/cuenta?accion=ingresar', { metodo: 'POST', datos: { email: f.email.value, password: f.password.value } });
        irAlPanel();
      } catch (err) {
        mensaje(f, err.message);
      }
    });
  };

  $('#formRegistro').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    mensaje(f, '');
    if (f.password.value.length < 8) return mensaje(f, 'La contraseña debe tener al menos 8 caracteres.');
    if (!f.acepta.checked) return mensaje(f, 'Tenés que aceptar los términos y la política de privacidad.');
    ocupado(f.querySelector('button[type=submit]'), async () => {
      try {
        await api('/api/cuenta?accion=registro', {
          metodo: 'POST',
          datos: { nombre: f.nombre.value, email: f.email.value, telefono: f.telefono.value, password: f.password.value, acepta: f.acepta.checked },
        });
        location.replace('/panel?bienvenida=1');
      } catch (err) {
        mensaje(f, err.message);
      }
    });
  };

  $('#formRecuperar').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    ocupado(f.querySelector('button[type=submit]'), async () => {
      try {
        await api('/api/cuenta?accion=recuperar', { metodo: 'POST', datos: { email: $('#recEmail').value } });
        mensaje(f, 'Si el email está registrado, te llega un enlace en unos minutos. Revisá también la carpeta de spam.', 'ok');
      } catch (err) {
        mensaje(f, err.message);
      }
    });
  };

  $('#formRestablecer').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    ocupado(f.querySelector('button[type=submit]'), async () => {
      try {
        await api('/api/cuenta?accion=restablecer', { metodo: 'POST', datos: { token: params.get('restablecer'), password: $('#resPass').value } });
        toast('Contraseña actualizada');
        location.replace('/panel');
      } catch (err) {
        mensaje(f, err.message);
      }
    });
  };

  if (params.get('restablecer')) mostrar('restablecer');
  else pestana(params.get('modo') === 'registro');
})();
