# Instrucción para Gemini — migrar sizigialab.cl de Netlify a Cloudflare Pages

Pegá esto completo en Gemini como primer mensaje. Le da todo el contexto que necesita para guiarte paso a paso sin que tengas que explicar nada de nuevo.

---

Sos mi asistente para migrar el hosting de mi sitio web de Netlify a Cloudflare Pages, guiándome paso a paso mientras lo hago yo mismo en el navegador (no tenés acceso directo a mis cuentas, así que decime exactamente qué click hacer y en qué pantalla, y confirmá conmigo antes de cualquier paso que pueda romper algo).

## Contexto del proyecto

- Sitio: **sizigialab.cl** — landing comercial de un programa de salud (Sizigia Lab / Medicina Humana).
- Repo de GitHub: `github.com/ddiegodiaz-sizigia/sobi-sizigialab-web`, rama `main`. Es el único repo conectado al dominio.
- El sitio es **100% HTML/CSS/JS estático** — verificado: no hay `netlify.toml`, no hay `_redirects`, no hay funciones serverless de Netlify en el repo. Ningún build command, ningún paso de compilación.
- Archivos principales en el repo: `index.html` (landing pública) y `rueda_final.html` (portal de pacientes "Mi Ritmo", con login y datos vía Supabase, llamado 100% desde el cliente vía JS — no depende de Netlify para nada del backend).
- Todo el backend real (autenticación de pacientes, futuro webhook de WhatsApp) vive en **Supabase Edge Functions**, totalmente independiente del hosting. La migración de hosting no toca nada de esto.
- Deploy actual: edito el archivo local en mi PC (`C:\Mis Documentos - Nuevo\Medicina Humana\Página web`) → GitHub Desktop → commit → push a `main` → Netlify lo detecta y publica solo.

## Por qué migro

Netlify cambió a un sistema de créditos: el plan gratis da 300 créditos/mes y cada deploy de producción cuesta 15 créditos — o sea, solo 20 deploys gratis por mes. Ya los gasté todos este ciclo (14-ago a 13-sep) y el sitio dejó de actualizarse: tengo un commit pusheado (`43108fd`, con copy nuevo de la landing) que Netlify marcó como **"Skipped due to account credit usage exceeded"** y nunca construyó — la web sigue mostrando el contenido viejo.

Decidí no pagar los $9/mes de Netlify Personal porque el sitio no usa nada específico de Netlify (nada de sus funciones, formularios, ni edge — es puro hosting estático), y **Cloudflare Pages da 500 builds/mes gratis, sin sistema de créditos que me pueda trabar a mitad de mes**. Además mi dominio ya está administrado en Cloudflare (nameservers `beth.ns.cloudflare.com` / `brodie.ns.cloudflare.com`, confirmado), así que no hay transferencia de dominio de por medio — solo conectar el repo a un proyecto nuevo de Cloudflare Pages y después cambiar a qué apunta el DNS.

## Estado actual del DNS (dato importante)

El registro A de `sizigialab.cl` hoy apunta a las IPs de Netlify (`75.2.60.5` y `99.83.231.61`). Necesito cambiar ESE registro para que apunte a Cloudflare Pages en vez de a Netlify.

**Antes de tocar nada del DNS**, quiero que me ayudes a listar TODOS los registros DNS actuales de la zona `sizigialab.cl` en el dashboard de Cloudflare (Cloudflare → mi dominio → DNS → Records) y me los muestres. Puede haber registros MX (correo) u otros subdominios que no tienen nada que ver con el hosting del sitio — esos NO se tocan. Solo vamos a cambiar el/los registro(s) que apuntan a Netlify para el hosting web (típicamente el registro raíz `@` y quizás `www`).

## Lo que quiero lograr, en orden

1. Entrar a Cloudflare Pages (dentro del mismo dashboard donde ya administro el DNS) y crear un proyecto nuevo conectado al repo `github.com/ddiegodiaz-sizigia/sobi-sizigialab-web`, rama `main`.
2. Configurar el build: **sin build command**, directorio de publicación = raíz del repo (`/`). Es estático, no hay que compilar nada.
3. Lanzar el primer deploy y verificar en la URL de prueba que da Cloudflare (algo como `sobi-sizigialab-web.pages.dev`) que el sitio se ve bien y que trae el commit más reciente (`43108fd`).
   - Cómo confirmar que es la versión correcta: en la sección "Cómo empezar" de la landing, la tarjeta de la Asesoría NO debe decir "Con el doctor Manuel" ni "3 o 6 meses" — debe decir "45 minutos de evaluación clínica con Manuel: tu historia, tu demanda real y tu objetivo, revisados en profundidad." Y cerca del footer debe haber una sección con el título "¿POR QUÉ SIZIGIA?" (no el manifiesto viejo que empezaba con "SIZIGIA cree que vivir mejor...").
4. Recién cuando esa verificación esté OK: mostrarme los registros DNS actuales (paso de arriba) y ahí guiarme para agregar el dominio personalizado `sizigialab.cl` (y `www.sizigialab.cl` si existe) al proyecto de Cloudflare Pages, y actualizar solo el registro DNS correspondiente para que apunte a Cloudflare Pages en vez de a Netlify.
5. Verificar que `sizigialab.cl` en el navegador (refrescando fuerte, Ctrl+Shift+R, por las dudas de caché) muestra el sitio nuevo, servido ya desde Cloudflare Pages.
6. No hace falta cancelar ni tocar nada en Netlify todavía — eso lo dejo para después, sin apuro, una vez que Cloudflare esté confirmado funcionando.

Guiame click a click, una pantalla a la vez, y avisame explícitamente antes de cualquier paso que modifique DNS en producción.
