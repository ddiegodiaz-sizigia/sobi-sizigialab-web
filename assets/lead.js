/* SIZIGIA LAB — captura de datos para la guía gratuita */
var SIZIGIA_LEADS = {
  // Pega aquí la URL de tu Google Apps Script (ver instrucciones). Mientras esté vacía, la guía se descarga pero los datos NO se guardan.
  endpoint: '',
  pdf: 'assets/guia-sueno-sizigia.pdf'
};
(function () {
  var modal = document.getElementById('guide-modal');
  if (!modal) return;
  var form = document.getElementById('guide-form');
  var err = document.getElementById('gm-err');
  function open() { modal.hidden = false; document.body.style.overflow = 'hidden'; var i = form.querySelector('input'); if (i) i.focus(); }
  function close() { modal.hidden = true; document.body.style.overflow = ''; }
  document.querySelectorAll('[data-open-guide]').forEach(function (b) { b.addEventListener('click', open); });
  modal.addEventListener('click', function (e) { if (e.target === modal || e.target.hasAttribute('data-close')) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = new FormData(form), bad = '';
    ['nombre', 'apellido', 'celular', 'ubicacion'].forEach(function (k) { if (!String(d.get(k) || '').trim()) bad = 'Completa todos los campos.'; });
    var cel = String(d.get('celular') || '').replace(/\D/g, '');
    if (!bad && (cel.length < 8 || cel.length > 13)) bad = 'Revisa tu número de celular.';
    if (!bad && !form.elements.acepto.checked) bad = 'Debes aceptar el uso de tus datos para continuar.';
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    err.hidden = true;
    var payload = {
      fecha: new Date().toISOString(),
      nombre: d.get('nombre').trim(), apellido: d.get('apellido').trim(),
      celular: d.get('celular').trim(), ubicacion: d.get('ubicacion').trim(),
      origen: 'guia-sueno', pagina: location.pathname
    };
    if (SIZIGIA_LEADS.endpoint) {
      try {
        fetch(SIZIGIA_LEADS.endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
      } catch (e) {}
    }
    document.getElementById('gm-form').hidden = true;
    document.getElementById('gm-ok').hidden = false;
    var a = document.createElement('a');
    a.href = SIZIGIA_LEADS.pdf; a.download = 'Guia-de-sueno-Sizigia-Lab.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  });
})();
