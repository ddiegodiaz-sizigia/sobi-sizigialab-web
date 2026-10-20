# Arquitectura: cómo crece la plataforma sin un archivo gigante

Producto: bitácora/hoja de vida de cada persona, con su equipo (coach, nutricionista, médico, psicólogo) y permisos por tipo de dato. Escala de 1 paciente de Manuel a miles de clientes de coaches.

## Reglas
1. **Se trabaja desde este repo (`C:\Dev`), no desde OneDrive.** OneDrive truncó archivos grandes en septiembre.
2. **Ningún archivo nuevo nace dentro de `rueda_final.html` ni `admin.html`.** Todo módulo nuevo es un archivo en `assets/` (ES module o script global) con su prueba en `tests/`.
3. **Los datos y los permisos viven en Supabase, no en el navegador.** Cada tabla nueva trae RLS en su migración y una prueba.
4. **Una migración por cambio**, en `supabase/migrations/`, idempotente. La base real y el repo nunca divergen.
5. **Estrangulamiento:** se extrae de los archivos grandes solo lo que se toca. No se reescribe lo que funciona.

## Estructura objetivo
```
assets/
  semaforo.js        reglas + explicación (existe)
  trend-chart.js     gráficos con ventana y franja (nuevo)
  js/                módulos que salen de rueda_final.html: api.js (Supabase), ui.js, checkin.js, bitacora.js
app/                 aplicación del coach/profesional (nueva, cuando haya más de 3 pantallas)
supabase/migrations/ SQL versionado
tests/               node --test, sin dependencias
```

## Cuándo pasar a build (Vite + TypeScript)
Cuando se cumpla cualquiera: (a) la app del coach supere ~3 pantallas, (b) entre un segundo desarrollador, (c) haga falta una librería de npm en el navegador. Hasta entonces, sin build: menos piezas que romper. El paso es mecánico porque los módulos ya están separados.

## Flujo de trabajo con Claude Code
Rama por tema (`feat/...`), pruebas con `node tests/*.test.mjs`, PR a `main`. Cloudflare despliega cada push a `main`. Lo que no se puede probar en Node (pantallas) se prueba con Playwright sobre la copia local.
