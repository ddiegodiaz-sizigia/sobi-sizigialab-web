# Sizigia Lab / SOBI — sitio web

Sitio en producción (`sizigialab.cl`), antes desplegado a mano vía Netlify Drop.

## Archivos
- `index.html` — landing de marca (Sizigia Lab / SOBI). Copy FITPM aprobado 24-08-2026: sección "Para quién es", fases del programa, "Mi Rueda" -> "Mi Ritmo" en nav y footer.
- `rueda_final.html` — app de pacientes ("Mi Ritmo"). Bloque de resumen semanal renombrado a "Sprint Semanal SOBI" (24-08-2026), sin cambios de lógica.

## Deploy
Netlify, sitio `rueda-sobi-adherencia`. Hasta ahora: Netlify Drop manual — riesgo confirmado el 24-08-2026 (subir un solo archivo pisó el sitio completo).

Pendiente: conectar este repo a Netlify (Site settings -> Build & deploy -> Link repository) para que cada push haga deploy automático del sitio completo.
