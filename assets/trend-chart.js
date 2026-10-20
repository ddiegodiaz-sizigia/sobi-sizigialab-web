// Gráficos de tendencia con ventanas 7/14/30/60 días. Sin dependencias, sin build.
// Principio: el eje se ajusta a los datos (no 0-100) pero con un rango mínimo por métrica,
// para no convertir ruido en drama. La franja muestra el rango habitual de la persona.
(function (root) {
  'use strict';
  var DAY = 86400000;
  function t(iso) { return Date.parse(iso + 'T00:00:00Z'); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function fmt(isoStr) { return isoStr.slice(8, 10) + '-' + isoStr.slice(5, 7); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Mínimo de variación que merece ocuparse el alto del gráfico, por métrica.
  var PRESETS = {
    hrv:       { unit: 'ms',  decimals: 0, minSpan: 15, clampMin: 0 },
    rhr:       { unit: 'lpm', decimals: 0, minSpan: 10, clampMin: 25 },
    sleep:     { unit: 'h',   decimals: 1, minSpan: 3,  clampMin: 0, clampMax: 14 },
    recovery:  { unit: '%',   decimals: 0, minSpan: 25, clampMin: 0, clampMax: 100 },
    fatigue:   { unit: '/10', decimals: 0, minSpan: 4,  clampMin: 0, clampMax: 10 },
    pain:      { unit: '/10', decimals: 0, minSpan: 4,  clampMin: 0, clampMax: 10 },
    mood:      { unit: '/10', decimals: 0, minSpan: 4,  clampMin: 0, clampMax: 10 },
    load:      { unit: 'u.a.', decimals: 0, minSpan: 200, clampMin: 0 },
    weight:    { unit: 'kg',  decimals: 1, minSpan: 2,  clampMin: 0 }
  };

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  // Devuelve { lo, hi, ticks } ajustado a los datos y a la franja, con rango mínimo y topes.
  function domain(values, o) {
    o = o || {};
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (o.band) { lo = Math.min(lo, o.band.lo); hi = Math.max(hi, o.band.hi); }
    var minSpan = o.minSpan || 1;
    if (hi - lo < minSpan) { var mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (o.clampMin != null && lo < o.clampMin) lo = o.clampMin;
    if (o.clampMax != null && hi > o.clampMax) hi = o.clampMax;
    var ticks = []; for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { lo: lo, hi: hi, ticks: ticks };
  }

  // Rango habitual: media ± 1 DE de los 28 días previos a la ventana. Exige 7 puntos mínimo.
  function baseline(points, windowStartIso) {
    var from = t(windowStartIso) - 28 * DAY, to = t(windowStartIso);
    var v = points.filter(function (p) { var x = t(p.iso); return x >= from && x < to; }).map(function (p) { return p.value; });
    if (v.length < 7) return null;
    var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / v.length);
    return { mean: m, lo: m - sd, hi: m + sd, n: v.length };
  }

  function windowed(points, days, todayIso) {
    var end = t(todayIso), start = end - (days - 1) * DAY;
    return {
      startIso: iso(start), endIso: todayIso,
      pts: points.filter(function (p) { var x = t(p.iso); return x >= start && x <= end; }).sort(function (a, b) { return a.iso < b.iso ? -1 : 1; })
    };
  }

  // opts: { metric, days, today, label, color, w, h, unit, decimals, minSpan, clampMin, clampMax }
  function build(points, opts) {
    opts = opts || {};
    var P = Object.assign({}, PRESETS[opts.metric] || {}, opts);
    var days = P.days || 14, today = P.today || iso(Date.now());
    var w = P.w || 360, h = P.h || 200, padL = 40, padR = 14, padT = 14, padB = 26;
    var W = windowed(points, days, today);
    if (W.pts.length < 2) return '<div class="tc-empty">Con menos de 2 registros en ' + days + ' días no hay tendencia que mostrar todavía.</div>';
    var band = baseline(points, W.startIso);
    var dom = domain(W.pts.map(function (p) { return p.value; }), { band: band, minSpan: P.minSpan, clampMin: P.clampMin, clampMax: P.clampMax });
    var plotW = w - padL - padR, plotH = h - padT - padB, span = Math.max(1, t(W.endIso) - t(W.startIso));
    function X(i) { return padL + (t(i) - t(W.startIso)) / span * plotW; }
    function Y(v) { return padT + plotH - (v - dom.lo) / (dom.hi - dom.lo) * plotH; }
    var color = P.color || '#B86B4B', s = '<svg class="tc" width="100%" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc((P.label || 'Tendencia') + ', últimos ' + days + ' días') + '">';
    dom.ticks.forEach(function (v) {
      s += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#e5ded0"/>' +
           '<text x="' + (padL - 6) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#6b6558">' + (+v.toFixed(P.decimals || 0)) + '</text>';
    });
    if (band) s += '<rect x="' + padL + '" width="' + plotW + '" y="' + Y(band.hi).toFixed(1) + '" height="' + Math.max(1, Y(band.lo) - Y(band.hi)).toFixed(1) + '" fill="' + color + '" opacity=".12"><title>Tu rango habitual (28 días previos): ' + band.lo.toFixed(P.decimals || 0) + ' a ' + band.hi.toFixed(P.decimals || 0) + ' ' + esc(P.unit || '') + '</title></rect>';
    s += '<path d="' + W.pts.map(function (p, k) { return (k ? 'L' : 'M') + X(p.iso).toFixed(1) + ' ' + Y(p.value).toFixed(1); }).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round"/>';
    W.pts.forEach(function (p) { s += '<circle cx="' + X(p.iso).toFixed(1) + '" cy="' + Y(p.value).toFixed(1) + '" r="3" fill="' + color + '"><title>' + fmt(p.iso) + ': ' + p.value.toFixed(P.decimals || 0) + ' ' + esc(P.unit || '') + '</title></circle>'; });
    var last = W.pts[W.pts.length - 1];
    s += '<text x="' + Math.min(X(last.iso), w - padR).toFixed(1) + '" y="' + (Y(last.value) - 8).toFixed(1) + '" text-anchor="end" font-size="11" font-weight="600" fill="#2a2620">' + last.value.toFixed(P.decimals || 0) + ' ' + esc(P.unit || '') + '</text>';
    s += '<text x="' + padL + '" y="' + (h - 8) + '" font-size="10" fill="#6b6558">' + fmt(W.startIso) + '</text><text x="' + (w - padR) + '" y="' + (h - 8) + '" text-anchor="end" font-size="10" fill="#6b6558">' + fmt(W.endIso) + '</text></svg>';
    var note = band ? 'Franja: tu rango habitual (media ± 1 desviación de los 28 días previos, ' + band.n + ' registros).' : 'Sin franja: faltan registros previos para calcular tu rango habitual (mínimo 7).';
    return s + '<div class="tc-note">' + esc((P.label ? P.label + '. ' : '')) + 'Eje ajustado a tus datos. ' + note + '</div>';
  }

  // Monta el gráfico con selector de ventana en un elemento. points: [{iso, value}]
  function mount(el, points, opts) {
    var days = (opts && opts.days) || 14;
    function draw() {
      el.innerHTML = '<div class="tc-tabs" role="tablist">' + [7, 14, 30, 60].map(function (d) {
        return '<button type="button" role="tab" data-d="' + d + '" aria-selected="' + (d === days) + '" class="tc-tab' + (d === days ? ' on' : '') + '">' + d + ' días</button>';
      }).join('') + '</div>' + build(points, Object.assign({}, opts, { days: days }));
      Array.prototype.forEach.call(el.querySelectorAll('.tc-tab'), function (b) { b.onclick = function () { days = +b.getAttribute('data-d'); draw(); }; });
    }
    draw();
  }

  var api = { PRESETS: PRESETS, domain: domain, baseline: baseline, windowed: windowed, build: build, mount: mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SizigiaCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);
