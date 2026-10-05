/* SIZIGIA LAB — configuración y comportamiento compartido */
var SIZIGIA = {
  // CONFIRMAR antes de lanzar: canal donde llegan consultas de empresas y pedidos de producto
  whatsapp: '56958929093',
  agenda: 'https://encuadrado.com/p/manuel-acuna-medina',
  pacientes: 'rueda_final.html'
};

document.documentElement.classList.add('js');

// Menú móvil
(function () {
  var nav = document.querySelector('.nav');
  var btn = document.querySelector('.nav-toggle');
  if (!nav || !btn) return;
  btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () { nav.classList.remove('open'); });
  });
})();

// Aparición suave al hacer scroll
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  els.forEach(function (e) { io.observe(e); });
})();

// Enlaces a WhatsApp con mensaje predefinido: <a data-wa="texto">
document.querySelectorAll('[data-wa]').forEach(function (a) {
  a.href = 'https://wa.me/' + SIZIGIA.whatsapp + '?text=' + encodeURIComponent(a.getAttribute('data-wa'));
  a.target = '_blank'; a.rel = 'noopener';
});

// Formulario de empresas -> WhatsApp con los datos ordenados
var f = document.getElementById('form-empresas');
if (f) {
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = new FormData(f);
    var lines = [
      'Hola, quiero cotizar una actividad con Sizigia Lab.',
      'Empresa u organización: ' + (d.get('empresa') || ''),
      'Nombre y cargo: ' + (d.get('nombre') || ''),
      'Tipo de actividad: ' + (d.get('tipo') || ''),
      'Modalidad: ' + (d.get('modalidad') || ''),
      'Personas (aprox.): ' + (d.get('personas') || ''),
      'Ciudad / lugar: ' + (d.get('ciudad') || ''),
      'Fecha tentativa: ' + (d.get('fecha') || ''),
      'Email de contacto: ' + (d.get('email') || ''),
      'Detalle: ' + (d.get('mensaje') || '')
    ];
    window.open('https://wa.me/' + SIZIGIA.whatsapp + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  });
}

// Año del pie
document.querySelectorAll('[data-year]').forEach(function (e) { e.textContent = new Date().getFullYear(); });
