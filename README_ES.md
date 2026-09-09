<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a> | <strong>Español</strong> | <a href="README_FR.md">Français</a> | <a href="README_DE.md">Deutsch</a> | <a href="README_PT_BR.md">Português (Brasil)</a> | <a href="README_RU.md">Русский</a></p>
  <p><strong>Conecta la IA con tu código.</strong></p>
</div>

Adnify reúne edición de código, ejecución con IA, generación de recursos y verificación en el navegador en un entorno de desarrollo de escritorio. Usa Agent Mode para implementar directamente o Plan Mode para revisar requisitos y dependencias antes de ejecutar.

> Esta versión en español presenta el producto y los pasos iniciales. Consulta la versión [inglesa](README.md) o [china](README_CN.md) para conocer todos los detalles, la arquitectura y los colaboradores y patrocinadores. La traducción del README no implica que la interfaz de la aplicación esté disponible en este idioma.

![Demostración de Adnify](images/main.gif)

## Funciones principales

- **Agent Mode**: pregunta, investiga el código, edita archivos, ejecuta comandos y verifica resultados en una misma tarea. Los permisos, las diferencias y los puntos de control permiten revisar los cambios.
- **Plan Mode**: revisión de requisitos → revisión del plan → centro de ejecución → revisión de resultados. Incluye dependencias, modelos por tarea, ejecución paralela e hilos de trabajo aislados.
- **Edición de código**: Monaco Editor, LSP para varios lenguajes, autocompletado con IA, edición en línea, depurador e integración con Git.
- **Generación de recursos**: conecta API HTTP JSON de imágenes, vídeo, audio y archivos; genera recursos durante una tarea y reutilízalos desde la biblioteca.
- **Verificación en el navegador**: interactúa con páginas, inspecciona DOM, estilos, consola y red, captura pantallas y comprueba vistas de teléfonos y tabletas.
- **Gestión de ejecución**: administra comandos y servicios en segundo plano de varias ventanas, registros, colas y límites de recursos.
- **Notificaciones y extensiones**: notificaciones del sistema, webhooks, Skills, MCP y memoria del proyecto.
- **Temas**: Adnify Dark, Midnight, Cyberpunk y Dawn.

## Inicio rápido

Necesitas Node.js **24.x a partir de 24.19.0** (`^24.19.0`), pnpm **11.22.0** y Git. Node 22 y las versiones 25 o posteriores quedan fuera del rango admitido. Python solo es necesario para compilar módulos nativos desde el código fuente.

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

Después de clonar el repositorio, selecciona la versión de Node indicada mediante `nvm use`, `fnm use` o `mise install`. A continuación, ejecuta:

```bash
corepack enable
pnpm install
pnpm dev
```

Ejecuta `pnpm dist` para generar los instaladores en `release/`. Si Electron muestra `failed to install correctly`, elimina `node_modules/electron` y vuelve a ejecutar `pnpm install` con una versión de Node compatible.

## Configurar modelos de IA

1. Abre la configuración con `Ctrl+,` y selecciona la pestaña Provider.
2. Elige un proveedor e introduce la clave API necesaria.
3. Selecciona un modelo y guarda los cambios.

Admite OpenAI, Anthropic, Google, DeepSeek, Ollama y API compatibles con OpenAI. Usa `@` para añadir archivos o `@codebase`, `@git`, `@terminal`, `@symbols` y `@web` al contexto. Selecciona código y pulsa `Ctrl+K` para solicitar una edición en línea.

## Usar Plan Mode

1. Describe el objetivo y confirma los requisitos y criterios de aceptación.
2. Revisa las dependencias, los entregables, el paralelismo y los roles y modelos de cada tarea.
3. Aprueba el plan y sigue el progreso y las solicitudes de autorización en TaskBoard. Pausa o reanuda cuando sea necesario.
4. Revisa el resultado y acéptalo o solicita cambios.

![Plan Mode](images/orchestrator.png)

## Arquitectura y tecnologías

Utiliza Electron, React, TypeScript y Vite. `src/renderer` contiene la interfaz y la ejecución de Agent; `src/main`, las capacidades privilegiadas y los servicios; `src/shared`, los tipos y la configuración comunes. La indexación, el almacenamiento de sesiones y recursos y el procesamiento de contenido se ejecutan en procesos de servicio aislados.

## Documentación

Los siguientes documentos técnicos se ofrecen en su idioma original.

- [Historial de cambios](CHANGELOG.md)
- [Aislamiento de procesos](docs/process-isolation.md)
- [API de generación de recursos](docs/asset-capabilities.md)
- [Vista previa del navegador](docs/browser-preview.md)
- [Notificaciones](docs/notifications.md)
- [Tareas en segundo plano](docs/background-tasks.md)
- [Diagnóstico de rendimiento](docs/performance-diagnostics.md)
- [Ejecución paralela con worktrees](docs/worktree-lane-architecture.md)
- [Recursos de marca](public/brand/README.md)

## Comunidad y contribuciones

Envía errores y sugerencias a [GitHub Issues](https://github.com/ad-naan/adnify/issues) o [Gitee Issues](https://gitee.com/adnaan/adnify/issues). Las mejoras de código y traducción son bienvenidas: consulta la [guía de contribución](CONTRIBUTING.md) y el [código de conducta](CODE_OF_CONDUCT.md). Para problemas de seguridad, sigue [SECURITY.md](SECURITY.md).

## Licencia

Adnify utiliza una licencia personalizada. Consulta las condiciones en [LICENSE](LICENSE). El uso comercial requiere autorización previa por escrito del autor. Contacto: adnaan.worker@gmail.com.

