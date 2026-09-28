# Documentación de ArchVision 3D AI

Documentación funcional y técnica del proyecto, tomada del estado de la rama `Develop` al **27 de septiembre de 2026**, commit `a395906`.

| # | Documento | Para quién | Contenido |
|---|-----------|------------|-----------|
| 1 | [Últimos cambios](01-ultimos-cambios.md) | Todo el equipo | Qué cambió en los últimos commits, quién lo hizo y qué impacto tiene |
| 2 | [Guía de uso](02-guia-de-uso.md) | Usuarios finales, QA y producto | Recorrido por la aplicación con capturas de pantalla |
| 3 | [Guía de desarrollo](03-guia-de-desarrollo.md) | Desarrolladores | Instalación, arquitectura, flujo de trabajo en Git, pruebas y cómo extender el editor |
| 4 | [Problemas conocidos](04-problemas-conocidos.md) | Desarrolladores y QA | Errores y desajustes encontrados al preparar esta documentación |

También hay una versión en PDF que reúne los cuatro documentos: [`ArchVision3DAI-Documentacion.pdf`](ArchVision3DAI-Documentacion.pdf).

Las capturas de pantalla están en [`img/`](img/). Se tomaron con la aplicación en local, la base de datos de demostración (`pnpm db:seed`) y el proyecto **Casa Los Robles**.

## Documentación técnica existente

Esta guía complementa los documentos de referencia que ya existían en `docs/`:

| Documento | Tema |
|-----------|------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Arquitectura general y decisiones de diseño |
| [`DATABASE.md`](../DATABASE.md) | Modelo de datos |
| [`API.md`](../API.md) | API REST |
| [`EDITOR.md`](../EDITOR.md) | Motor 3D, estado del editor y atajos |
| [`SELECTION_AND_TRANSFORMS.md`](../SELECTION_AND_TRANSFORMS.md) | Selección múltiple, mover y girar |
| [`PLAN_IMPORT.md`](../PLAN_IMPORT.md) | Importación de planos y detección de muros |
| [`ASSISTANT.md`](../ASSISTANT.md) | Asistente, revisión del modelo y tutorial |
| [`BILLING.md`](../BILLING.md) | Planes, suscripciones y cobros |
| [`AI_PIPELINE.md`](../AI_PIPELINE.md) | Servicio de visión por computador (pendiente) |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Entornos y despliegue |
