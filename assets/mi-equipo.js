// Mi equipo y permisos: la persona invita a su coach, nutricionista, psicólogo o médico, elige qué tipo de dato ve cada uno,
// acepta un consentimiento versionado, retira el acceso cuando quiera y ve quién consultó sus datos.
// Backend: supabase/migrations/20261008_care_links.sql, 20261009_consent_texts.sql y 20261023_mi_equipo.sql.
// Núcleo puro exportado para Node (tests/mi-equipo.test.mjs). La pantalla usa los globals de rueda_final.html
// (state, supabaseClient, currentPatientId, isDemoMode, render, escapeHtml, fmtDate).
(function (root) {
  'use strict';
  var ROLES = { medico: 'Médico', entrenador: 'Entrenador', preparador: 'Preparador físico', psicologo: 'Psicólogo', nutricionista: 'Nutricionista', kinesiologo: 'Kinesiólogo', familia: 'Familia', otro: 'Otro' };
  // live: el profesional ya lo ve en su pantalla. Mantener al día cuando cada módulo tenga su vista del profesional.
  var SCOPES = [
    { key: 'semaforo', label: 'Semáforo y registro', desc: 'tu registro diario o semanal: sueño, fatiga, ánimo, dolor y carga si es deportivo; energía, sueño, estrés y hábitos si es general', live: true },
    { key: 'lesiones', label: 'Lesiones', desc: 'tus lesiones, su estado, tratante y tu dolor diario por lesión', live: true },
    { key: 'ciclo', label: 'Ciclo menstrual', desc: 'días de sangrado, flujo y síntomas', live: false, sensitive: true },
    { key: 'nutricion', label: 'Nutrición', desc: 'tu plan de alimentación, adherencia y composición corporal', live: true },
    { key: 'examenes', label: 'Exámenes y documentos', desc: 'exámenes de laboratorio e informes que subas (sus resultados; el archivo, solo tú)', live: true },
    { key: 'salud_mental', label: 'Salud mental', desc: 'registros y notas de salud mental', live: false, sensitive: true },
    { key: 'bitacora', label: 'Hoja de vida', desc: 'tu línea de tiempo: notas, objetivos, hitos y consultas', live: false },
    { key: 'equipo', label: 'Conversación del equipo', desc: 'escribirte y escribir sobre ti al resto de tu equipo, en hilos por tema. Solo lee los temas que también le compartes (por ejemplo, lesiones). De lo que tus profesionales hablan solo entre ellos ves que existe, no el contenido', live: true }
  ];
  var SCOPE_BY = {}; SCOPES.forEach(function (s) { SCOPE_BY[s.key] = s; });
  var LINK_EQUIPO = 'https://sizigialab.cl/equipo.html';

  // ---------- Núcleo puro ----------
  function normalizeScopes(list) {
    var set = {}; (list || []).forEach(function (k) { if (SCOPE_BY[k]) set[k] = true; });
    return SCOPES.filter(function (s) { return set[s.key]; }).map(function (s) { return s.key; });
  }
  function validateInvite(i) {
    var email = String(i.email || '').trim().toLowerCase(), name = String(i.name || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Escribe un correo válido.';
    if (name.length < 2 || name.length > 80) return 'Escribe el nombre del profesional.';
    if (!ROLES[i.role]) return 'Elige qué rol cumple.';
    if (!normalizeScopes(i.scopes).length) return 'Elige al menos un dato para compartir.';
    return null;
  }
  // Texto que la persona lee y acepta: el de la versión vigente con su profesional y la lista exacta de datos.
  function consentBody(template, pro, scopes) {
    var datos = normalizeScopes(scopes).map(function (k) { return '- ' + SCOPE_BY[k].label + ': ' + SCOPE_BY[k].desc + '.'; }).join('\n');
    return String(template || '').replace(/\{\{PROFESIONAL\}\}/g, pro.name).replace(/\{\{ROL\}\}/g, (ROLES[pro.role] || pro.role || '').toLowerCase()).replace(/\{\{DATOS\}\}/g, datos);
  }
  // Filas de my_care_team → un elemento por profesional: vínculo activo (si hay) e historial de cambios.
  function teamFromLinks(rows) {
    var by = {}, order = [];
    (rows || []).slice().sort(function (a, b) { return a.granted_at < b.granted_at ? 1 : -1; }).forEach(function (r) {
      if (!by[r.professional_id]) { by[r.professional_id] = { id: r.professional_id, name: r.name, role: r.role, email: r.email, hasAccount: !!r.has_account, active: null, history: [] }; order.push(r.professional_id); }
      var p = by[r.professional_id];
      if (!r.revoked_at && !p.active) p.active = r; else p.history.push(r);
    });
    return order.map(function (id) { return by[id]; }).sort(function (a, b) { return (a.active ? 0 : 1) - (b.active ? 0 : 1); });
  }
  // Cada llamada del profesional deja una fila; se agrupan por día, persona y tipo de dato para que se lea fácil.
  function groupAccessLog(rows, tz) {
    var out = [], idx = {};
    (rows || []).slice().sort(function (a, b) { return a.accessed_at < b.accessed_at ? 1 : -1; }).forEach(function (r) {
      var day = localDay(r.accessed_at, tz), key = day + '|' + r.name + '|' + r.scope;
      if (idx[key] == null) { idx[key] = out.length; out.push({ day: day, name: r.name, role: r.role, scope: r.scope, count: 0, last: r.accessed_at }); }
      out[idx[key]].count++;
    });
    return out;
  }
  function localDay(ts, tz) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)); }
    catch (e) { return String(ts).slice(0, 10); }
  }
  function waLink(proName, patientName) {
    var t = 'Hola ' + proName + ', te invité a mi equipo en Sizigia Lab para que veas los datos que elegí compartir. Entra con este correo en ' + LINK_EQUIPO + ' (te llega un link, sin contraseña).' + (patientName ? ' — ' + patientName : '');
    return 'https://wa.me/?text=' + encodeURIComponent(t);
  }

  var core = { ROLES: ROLES, SCOPES: SCOPES, normalizeScopes: normalizeScopes, validateInvite: validateInvite, consentBody: consentBody, teamFromLinks: teamFromLinks, groupAccessLog: groupAccessLog, waLink: waLink };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var data = { loaded: false, loading: false, team: [], log: [], consent: null, error: '' };
  // flow: { proId|null (invitación nueva), invite:{email,name,role}, scopes:[], step:'pick'|'consent', checked, busy, error }
  var flow = null;
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var css = '.eq-pro{padding:12px 0;border-top:1px solid var(--line)}.eq-pro:first-of-type{border-top:0}.eq-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start}' +
    '.eq-meta{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.5}.eq-scopes{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}' +
    '.eq-tag{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--gray-bg)}.eq-tag.soon{opacity:.7;font-style:italic}' +
    '.eq-box{margin-top:10px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff}.eq-opt{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px dashed var(--line);font-size:13px}' +
    '.eq-opt small{display:block;color:var(--muted);font-size:11.5px;line-height:1.4}.eq-soon{font-size:10.5px;padding:1px 6px;border-radius:999px;background:#fef3c7;color:#92400e;margin-left:4px;font-style:normal}' +
    '.eq-live{font-size:10.5px;padding:1px 6px;border-radius:999px;background:#dcfce7;color:#166534;margin-left:4px}.eq-warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px}' +
    '.eq-err{color:#b91c1c;font-size:12.5px;margin:6px 0}.eq-log{font-size:12.5px;padding:4px 0;border-top:1px solid var(--line)}.eq-form input,.eq-form select{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px}';

  function ensureCss() { if (document.getElementById('mi-equipo-css') == null) { var s = document.createElement('style'); s.id = 'mi-equipo-css'; s.textContent = css; document.head.appendChild(s); } }

  function demoData() {
    var now = Date.now(), h = 3600000, d = 24 * h, iso = function (ms) { return new Date(ms).toISOString(); };
    var rows = [
      { link_id: 'l3', professional_id: 'p3', name: 'Dr. Manuel Acuña', role: 'medico', email: 'manuel@ejemplo.cl', has_account: true, scopes: ['semaforo', 'lesiones', 'ciclo', 'nutricion', 'examenes', 'salud_mental', 'bitacora', 'equipo'], consent_version: 'v3-borrador', granted_at: iso(now - 30 * d), revoked_at: null },
      { link_id: 'l4', professional_id: 'p4', name: 'Valentina Mora', role: 'psicologo', email: 'valentina@ejemplo.cl', has_account: true, scopes: ['salud_mental', 'equipo'], consent_version: 'v3-borrador', granted_at: iso(now - 20 * d), revoked_at: null },
      { link_id: 'l1', professional_id: 'p1', name: 'Paula Rojas', role: 'kinesiologo', email: 'paula@ejemplo.cl', has_account: true, scopes: ['semaforo', 'lesiones', 'equipo'], consent_version: 'v3-borrador', granted_at: iso(now - 9 * d), revoked_at: null },
      { link_id: 'l0', professional_id: 'p1', name: 'Paula Rojas', role: 'kinesiologo', email: 'paula@ejemplo.cl', has_account: true, scopes: ['lesiones'], consent_version: 'v3-borrador', granted_at: iso(now - 12 * d), revoked_at: iso(now - 9 * d) },
      { link_id: 'l2', professional_id: 'p2', name: 'Tomás Fuentes', role: 'entrenador', email: 'tomas@ejemplo.cl', has_account: false, scopes: ['semaforo', 'lesiones', 'equipo'], consent_version: 'v3-borrador', granted_at: iso(now - 2 * d), revoked_at: null }
    ];
    var log = [];
    [0, 0.1, 0.2, 1, 2, 3].forEach(function (k) { log.push({ accessed_at: iso(now - k * d - 2 * h), name: 'Paula Rojas', role: 'kinesiologo', scope: 'semaforo' }); });
    log.push({ accessed_at: iso(now - 1 * d - 5 * h), name: 'Paula Rojas', role: 'kinesiologo', scope: 'lesiones' });
    return { loaded: true, loading: false, team: rows, log: log, consent: { version: 'demo', isFinal: false, body: '**Qué datos y para qué.** Autorizas a {{PROFESIONAL}} ({{ROL}}) a ver solo estos datos tuyos:\n{{DATOS}}\nNo ve ningún otro dato.\n\n**Cambiar o retirar el permiso.** Cuando quieras, en la pestaña Mi equipo. Se aplica al instante.' }, error: '' };
  }

  async function load() {
    if (data.loading) return;
    if (isDemoMode || !currentPatientId) { data = demoData(); return; }
    data.loading = true;
    try {
      var r = await Promise.all([supabaseClient.rpc('my_care_team'), supabaseClient.rpc('my_access_log', { p_limit: 200 }),
        supabaseClient.from('consent_texts').select('version, body, is_final').order('created_at', { ascending: false }).limit(1)]);
      var err = r[0].error || r[1].error || r[2].error;
      if (err) throw err;
      var c = (r[2].data || [])[0];
      data = { loaded: true, loading: false, team: r[0].data || [], log: r[1].data || [], consent: c ? { version: c.version, body: c.body, isFinal: !!c.is_final } : null, error: '' };
    } catch (e) {
      console.warn('mi equipo', e);
      data = { loaded: true, loading: false, team: [], log: [], consent: null, error: 'No se pudo cargar tu equipo. Intenta de nuevo en un momento.' };
    }
    render();
  }
  function reload() { data.loaded = false; data.loading = false; load(); }

  function scopeTags(scopes) {
    return '<div class="eq-scopes">' + normalizeScopes(scopes).map(function (k) { var s = SCOPE_BY[k]; return '<span class="eq-tag' + (s.live ? '' : ' soon') + '" title="' + (s.live ? 'Lo ve hoy en su pantalla' : 'Permiso guardado; su pantalla aún no lo muestra') + '">' + E(s.label) + '</span>'; }).join('') + '</div>';
  }
  function scopePicker(selected) {
    return SCOPES.map(function (s) {
      var on = selected.indexOf(s.key) >= 0;
      return '<label class="eq-opt"><input type="checkbox" class="eq-scope" value="' + s.key + '"' + (on ? ' checked' : '') + ' onchange="SizigiaEquipo.toggleScope(this)">' +
        '<span><b>' + E(s.label) + '</b>' + (s.live ? '<span class="eq-live">Visible hoy</span>' : '<span class="eq-soon">Próximamente</span>') + '<small>' + E(s.desc) + (s.sensitive ? '. Dato especialmente sensible: compártelo solo si es necesario.' : '') + '</small></span></label>';
    }).join('');
  }
  function mdLite(t) { return E(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
  function consentHTML(pro) {
    var c = data.consent, h = '';
    if (!c) return '<div class="eq-err">No hay texto de consentimiento disponible. Pide al equipo de Sizigia Lab que lo publique.</div>';
    if (!c.isFinal) h += '<div class="eq-warn"><strong>Texto en borrador, pendiente de revisión legal.</strong> No usar con personas reales hasta tener la versión final.</div>';
    var body = consentBody(c.body, pro, flow.scopes);
    if (c.body.indexOf('{{DATOS}}') < 0) body += '\n\n**Datos que compartes:**\n' + consentBody('{{DATOS}}', pro, flow.scopes);
    h += '<div style="font-size:13px;line-height:1.55;max-height:320px;overflow:auto">' + body.split('\n\n').map(function (p) { return '<p style="margin:0 0 9px">' + mdLite(p).replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
    h += '<div class="eq-meta" style="margin:6px 0 10px">Versión ' + E(c.version) + '. Se guarda con la fecha y hora en que aceptas y la lista de datos elegida.</div>';
    h += '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-bottom:10px"><input type="checkbox"' + (flow.checked ? ' checked' : '') + ' onchange="SizigiaEquipo.setChecked(this.checked)" style="margin-top:3px"> <span>Leí este texto y autorizo a ' + E(pro.name) + ' a ver los datos descritos, hasta que yo retire el permiso.</span></label>';
    return h;
  }
  function flowBox(pro) {
    var h = '<div class="eq-box">';
    if (flow.step === 'pick') {
      h += '<h4 style="margin:0 0 6px">' + (pro ? '¿Qué puede ver ' + E(pro.name) + '?' : 'Invitar a un profesional') + '</h4>';
      if (!pro) {
        var iv = flow.invite;
        h += '<div class="eq-form p-row"><input type="text" id="eq_name" placeholder="Nombre" value="' + E(iv.name) + '" oninput="SizigiaEquipo.setInvite(\'name\',this.value)" style="flex:1;min-width:150px">' +
          '<input type="email" id="eq_email" placeholder="correo@ejemplo.cl" value="' + E(iv.email) + '" oninput="SizigiaEquipo.setInvite(\'email\',this.value)" style="flex:1;min-width:180px">' +
          '<select id="eq_role" onchange="SizigiaEquipo.setInvite(\'role\',this.value)"><option value="">Rol…</option>' + Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (iv.role === k ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join('') + '</select></div>';
      }
      h += '<div class="eq-meta" style="margin:6px 0 2px">"Próximamente": el permiso queda guardado, pero la pantalla del profesional todavía no muestra ese dato.</div>';
      h += scopePicker(flow.scopes);
      h += '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn small primary" onclick="SizigiaEquipo.next()">Continuar</button><button class="btn small" onclick="SizigiaEquipo.cancel()">Cancelar</button></div>';
    } else {
      var p = pro || { name: flow.invite.name.trim(), role: flow.invite.role };
      h += '<h4 style="margin:0 0 8px">Permiso para ' + E(p.name) + '</h4>' + consentHTML(p);
      h += '<div style="display:flex;gap:8px"><button class="btn small primary"' + (flow.checked && data.consent && !flow.busy ? '' : ' disabled') + ' onclick="SizigiaEquipo.confirm()">' + (flow.busy ? 'Guardando…' : 'Confirmar permiso') + '</button><button class="btn small" onclick="SizigiaEquipo.back()">Volver</button></div>';
    }
    if (flow.error) h += '<div class="eq-err">' + E(flow.error) + '</div>';
    return h + '</div>';
  }

  function proRow(p) {
    var a = p.active, h = '<div class="eq-pro"><div class="eq-head"><div><strong>' + E(p.name) + '</strong> <span class="eq-meta">· ' + E(ROLES[p.role] || p.role) + '</span>';
    h += '<div class="eq-meta">' + (a ? 'Con acceso desde el ' + fmtDate(a.granted_at.slice(0, 10)) : 'Sin acceso' + (p.history[0] && p.history[0].revoked_at ? ' · retirado el ' + fmtDate(p.history[0].revoked_at.slice(0, 10)) : '')) +
      (p.hasAccount ? '' : ' · <span title="Aún no entra a equipo.html con su correo">todavía no activa su cuenta</span>') + '</div></div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    if (a) h += '<button class="btn small" onclick="SizigiaEquipo.edit(\'' + E(p.id) + '\')">Cambiar permisos</button><button class="btn small danger" onclick="SizigiaEquipo.revoke(\'' + E(p.id) + '\')">Retirar acceso</button>';
    else h += '<button class="btn small primary" onclick="SizigiaEquipo.edit(\'' + E(p.id) + '\')">Dar acceso</button>';
    h += '</div></div>';
    if (a) h += scopeTags(a.scopes);
    if (!p.hasAccount && a) h += '<div class="eq-meta" style="margin-top:6px">Para que vea tus datos, debe entrar a <b>sizigialab.cl/equipo.html</b> con ' + E(p.email) + '. <a href="' + E(waLink(p.name, state && state.patient ? state.patient.name : '')) + '" target="_blank" rel="noopener">Avisarle por WhatsApp</a></div>';
    if (p.history.length) h += '<details class="eq-meta" style="margin-top:6px"><summary>Historial de permisos (' + p.history.length + ')</summary>' + p.history.map(function (r) { return '<div>' + fmtDate(r.granted_at.slice(0, 10)) + ' → ' + (r.revoked_at ? fmtDate(r.revoked_at.slice(0, 10)) : 'hoy') + ': ' + normalizeScopes(r.scopes).map(function (k) { return SCOPE_BY[k].label; }).join(', ') + ' (consentimiento ' + E(r.consent_version) + ')</div>'; }).join('') + '</details>';
    if (flow && flow.proId === p.id) h += flowBox(p);
    return h + '</div>';
  }

  function tab() {
    ensureCss();
    if (!data.loaded) { load(); if (!data.loaded) return '<div class="card"><h3>Mi equipo</h3><div class="tc-empty">Cargando…</div></div>'; }
    var h = '<div class="card" style="margin-bottom:16px"><h3>Mi equipo y permisos</h3><div class="card-sub">Tu historia es tuya. Tú decides qué profesional ve qué dato, y puedes cambiarlo o retirarlo cuando quieras. Cada consulta queda registrada abajo. El equipo clínico de Sizigia Lab (Dr. Acuña) accede a tu ficha por su rol médico, aparte de estos permisos.</div>';
    if (isDemoMode) h += '<div class="eq-meta">Modo demo: los cambios no se guardan. <a href="equipo.html?demo=1">Ver lo que ve tu profesional →</a></div>';
    if (data.error) return h + '<div class="eq-err">' + E(data.error) + '</div><button class="btn small" onclick="SizigiaEquipo.reload()">Reintentar</button></div>';
    var team = teamFromLinks(data.team);
    if (!team.length) h += '<div class="tc-empty">Aún no has invitado a nadie. Invita a tu coach, kinesiólogo, nutricionista, psicólogo o médico.</div>';
    h += team.map(proRow).join('');
    if (flow && flow.proId == null) h += flowBox(null);
    else h += '<div style="margin-top:12px"><button class="btn small primary" onclick="SizigiaEquipo.invite()">Invitar a un profesional</button></div>';
    h += '</div>';
    // Conversación con el equipo (assets/caso.js, se dibuja sola dentro de su tarjeta).
    if (root.SizigiaCaso) h += root.SizigiaCaso.personaCard({ sb: supabaseClient, demo: isDemoMode || !currentPatientId, patientId: currentPatientId });
    var log = groupAccessLog(data.log);
    h += '<div class="card"><h3>Quién consultó tus datos</h3><div class="card-sub">Cada vez que alguien de tu equipo abre tus datos, queda aquí.</div>';
    if (!log.length) h += '<div class="tc-empty">Nadie ha consultado tus datos todavía.</div>';
    else h += log.slice(0, 40).map(function (g) {
      var t = new Date(g.last);
      return '<div class="eq-log"><b>' + E(g.name) + '</b> (' + E((ROLES[g.role] || g.role || '').toLowerCase()) + ') vio <b>' + E(SCOPE_BY[g.scope] ? SCOPE_BY[g.scope].label.toLowerCase() : g.scope) + '</b> · ' + fmtDate(g.day) + (g.count > 1 ? ', ' + g.count + ' veces' : '') + ' · última ' + t.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + '</div>';
    }).join('');
    return h + '</div>';
  }

  // ---------- Acciones ----------
  function find(id) { return teamFromLinks(data.team).filter(function (p) { return p.id === id; })[0]; }
  function invite() { flow = { proId: null, invite: { name: '', email: '', role: '' }, scopes: ['semaforo'], step: 'pick', checked: false, busy: false, error: '' }; render(); }
  function edit(id) { var p = find(id); flow = { proId: id, invite: null, scopes: p && p.active ? normalizeScopes(p.active.scopes) : ['semaforo'], step: 'pick', checked: false, busy: false, error: '' }; render(); }
  function toggleScope(el) { var k = el.value; flow.scopes = el.checked ? normalizeScopes(flow.scopes.concat([k])) : flow.scopes.filter(function (x) { return x !== k; }); }
  function next() {
    flow.error = flow.proId ? (normalizeScopes(flow.scopes).length ? null : 'Elige al menos un dato para compartir.') : validateInvite(Object.assign({ scopes: flow.scopes }, flow.invite));
    if (!flow.error) { flow.step = 'consent'; flow.checked = false; }
    render();
  }
  async function confirm() {
    if (!flow || !flow.checked || flow.busy || !data.consent) return;
    flow.busy = true; flow.error = ''; render();
    var scopes = normalizeScopes(flow.scopes);
    if (isDemoMode || !currentPatientId) {
      var pid = flow.proId || 'demo-' + Math.random().toString(36).slice(2, 8), now = new Date().toISOString(), prev = find(pid);
      data.team.forEach(function (r) { if (r.professional_id === pid && !r.revoked_at) r.revoked_at = now; });
      data.team.unshift({ link_id: 'l' + Date.now(), professional_id: pid, name: prev ? prev.name : flow.invite.name.trim(), role: prev ? prev.role : flow.invite.role, email: prev ? prev.email : flow.invite.email.trim().toLowerCase(), has_account: prev ? prev.hasAccount : false, scopes: scopes, consent_version: data.consent.version, granted_at: now, revoked_at: null });
      flow = null; return render();
    }
    try {
      var pid2 = flow.proId;
      if (!pid2) {
        var iv = await supabaseClient.rpc('invite_professional', { p_email: flow.invite.email.trim(), p_name: flow.invite.name.trim(), p_role: flow.invite.role });
        if (iv.error) throw iv.error;
        pid2 = iv.data;
      }
      var g = await supabaseClient.rpc('grant_care_link', { p_professional: pid2, p_scopes: scopes, p_consent_version: data.consent.version, p_accepted: true });
      if (g.error) throw g.error;
      flow = null; reload();
    } catch (e) {
      console.warn('grant', e);
      flow.busy = false; flow.error = 'No se pudo guardar el permiso. Revisa los datos e intenta de nuevo.'; render();
    }
  }
  async function revoke(id) {
    var p = find(id);
    if (!p || !window.confirm('¿Retirar el acceso de ' + p.name + '? Se aplica al instante.')) return;
    if (isDemoMode || !currentPatientId) { var now = new Date().toISOString(); data.team.forEach(function (r) { if (r.professional_id === id && !r.revoked_at) r.revoked_at = now; }); return render(); }
    var r = await supabaseClient.rpc('revoke_care_link', { p_professional: id });
    if (r.error) { alert('No se pudo retirar el permiso. Intenta de nuevo.'); return; }
    reload();
  }

  root.SizigiaEquipo = Object.assign({}, core, {
    tab: tab, reload: reload, invite: invite, edit: edit, toggleScope: toggleScope, next: next, confirm: confirm, revoke: revoke,
    cancel: function () { flow = null; render(); },
    back: function () { flow.step = 'pick'; flow.error = ''; render(); },
    setChecked: function (v) { flow.checked = v; render(); },
    setInvite: function (k, v) { flow.invite[k] = v; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
