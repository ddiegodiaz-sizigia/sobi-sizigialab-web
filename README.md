# Sizigia Lab — plataforma web

Sitio estático en producción (`sizigialab.cl`), desplegado en Cloudflare (`wrangler.jsonc`). Sin build. Backend: Supabase.

## Archivos
- `index.html`, `medicina-humana.html`, `empresas.html`, `guia-sueno.html`: sitio público.
- `rueda_final.html`: app del paciente o atleta (check-ins, medidas, historial, sesiones, registro deportivo).
- `admin.html`: panel del equipo clínico (pacientes, plantillas, ficha, Estado, semáforo de disponibilidad). Acceso solo con `is_admin()`.
- `supabase/migrations/`: SQL versionado. Aplicar a mano en Supabase > SQL Editor, en orden de fecha.
- `supabase/seed_demo_atletas.sql`: 3 atletas 100 % sintéticos para demo y video.
- `config.js`: URL y clave pública de Supabase (la clave publishable va en el navegador por diseño; la seguridad la dan las políticas RLS).

## Demo sin base de datos
`rueda_final.html?demo=1` carga una paciente sintética con 8 semanas de datos.

## Reglas de copy
No usar la palabra "SOBI" en nada visible al público. Usar Sizigia Lab o Medicina Humana.

## Pendiente conocido
- Las políticas RLS de las tablas anteriores a octubre 2026 no están versionadas en este repo. Exportarlas y agregarlas a `supabase/migrations/`.
- Permisos por rol de profesional (hoy solo `is_admin`), consentimiento y registro de accesos.
- Integración con wearables y check-ins por WhatsApp.
