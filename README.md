# Sizigia Lab — plataforma web

Sitio estático en producción (`sizigialab.cl`), desplegado en Cloudflare (`wrangler.jsonc`). Sin build. Backend: Supabase.

## Archivos
- `index.html`, `medicina-humana.html`, `empresas.html`, `guia-sueno.html`: sitio público.
- `rueda_final.html`: app del paciente o atleta (check-ins, medidas, historial, sesiones, registro deportivo).
- `admin.html`: panel del equipo clínico (pacientes, plantillas, ficha, Estado, semáforo, alta de profesionales). Acceso solo con `is_admin()`.
- `equipo.html`: vista de entrenadores y otros profesionales. Ven solo el semáforo de los atletas que les dieron permiso; cada consulta queda registrada.
- `assets/semaforo.js`: reglas del semáforo, compartidas por admin y equipo.
- `supabase/migrations/`: SQL versionado. Aplicar a mano en Supabase > SQL Editor, en orden de fecha.
- `supabase/seed_demo_atletas.sql`: 3 atletas 100 % sintéticos para demo y video.
- `config.js`: URL y clave pública de Supabase (la clave publishable va en el navegador por diseño; la seguridad la dan las políticas RLS).

## Demo sin base de datos
`rueda_final.html?demo=1` carga una paciente sintética con 8 semanas de datos.

## Reglas de copy
No usar la palabra "SOBI" en nada visible al público. Usar Sizigia Lab o Medicina Humana.

## Pruebas de permisos
`npm i --no-save @electric-sql/pglite && node supabase/tests/roles_rls.test.mjs` corre 43 pruebas sobre las políticas y funciones de roles en un Postgres en memoria. Supone que `patients` tiene RLS; verificar contra Supabase.

## Pendiente conocido
- Las políticas RLS de las tablas anteriores a octubre 2026 no están versionadas en este repo. Exportarlas y agregarlas a `supabase/migrations/`.
- Un solo permiso por profesional (`semaforo`). Faltan permisos por tipo de dato, familia, y organizaciones.
- El acceso de admins a los datos no queda en `access_log`.
- El texto de consentimiento (`consent_texts`, versión `v2-borrador`) tiene datos por completar entre corchetes y está pendiente de revisión legal. La app avisa que es borrador mientras `is_final` sea falso. Para publicar la final: insertar una versión nueva con `is_final = true`; nunca editar una versión existente.
- Integración con wearables y check-ins por WhatsApp.
