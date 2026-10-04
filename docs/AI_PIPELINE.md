# Pipeline de visión por computador

Documento de diseño de las fases 6 y 7. Los contratos de datos ya existen en
`packages/types/src/ai.ts`, de modo que el resto del sistema compila contra
ellos mientras el servicio devuelve respuestas simuladas (`AI_MODE=mock`).

## Regla de producto

La IA **propone**, el usuario **dispone**. Ninguna reconstrucción automática se
considera correcta por sí misma: pasa siempre por revisión humana antes de
convertirse en geometría paramétrica.

## Servicio

```
apps/ai-service/
  app/
    api/             endpoints FastAPI
    models/          carga y ciclo de vida de modelos
    pipelines/       orquestación de etapas
    detection/       detección de elementos arquitectónicos
    segmentation/    segmentación semántica de materiales
    depth/           estimación de profundidad monocular
    reconstruction/  SfM, MVS, nubes de puntos, malla
    calibration/     escalado con medidas reales
    utils/           imagen, geometría, logging
```

| Endpoint | Descripción |
| --- | --- |
| `POST /analyze-image` | Análisis completo de una fotografía |
| `POST /analyze-floorplan` | Vectorización de un plano |
| `POST /estimate-depth` | Mapa de profundidad |
| `POST /detect-architecture` | Solo detección de elementos |
| `POST /reconstruct` | Reconstrucción multivista |
| `GET /jobs/:id` | Estado y progreso |

Los adaptadores de modelo están detrás de una interfaz común: cambiar de
proveedor o de modelo local no debe tocar el resto del sistema.

## Etapas

1. **Normalización** — redimensionado, corrección de perspectiva, normalización
   de color, reducción de ruido opcional.
2. **Detección** — paredes, ventanas, puertas, techos, balcones, columnas,
   escaleras, con caja normalizada y confianza.
3. **Segmentación semántica** — pared, vidrio, madera, techo, piso, cielo,
   vegetación, mobiliario.
4. **Profundidad** — mapa monocular por imagen.
5. **Geometría** — planos dominantes, esquinas, líneas de fuga, proporciones.
6. **Reconstrucción** — emparejamiento de características, estimación de pose,
   structure from motion, multi-view stereo, nube de puntos y malla preliminar.

Cada etapa reporta progreso; el frontend muestra el desglose
(`Detectando arquitectura 84%`, `Estimando profundidad 62%`, …).

## De malla a entidades

Paso crítico y no negociable: la malla reconstruida se analiza para extraer
planos verticales candidatos a pared, huecos candidatos a vano y planos
horizontales candidatos a losa o cubierta. El resultado son entidades
`Wall`, `WindowEntity`, `Door`, `Slab` y `Roof` editables.

La casa nunca se guarda únicamente como malla estática.

## Calibración

La escala absoluta no se puede deducir de una sola fotografía. El asistente
pide al menos una medida real conocida —por ejemplo, el ancho de una puerta—,
el usuario marca dos puntos sobre la imagen e introduce la longitud. Con varias
referencias se ajusta la escala y se estima el error.

La interfaz muestra la precisión estimada del modelo como **Alta**, **Media** o
**Baja**, junto con las razones (número de imágenes, cobertura, referencias de
calibración, consistencia entre vistas).

## Procesamiento asíncrono

```
Subida → Crear Job → Cola (BullMQ) → Worker → ai-service
      → Guardar AIAnalysis → Progreso por WebSocket o sondeo
      → Visor de detecciones → Confirmación del usuario → SceneDocument
```

El frontend nunca se bloquea. Las operaciones costosas no se lanzan de forma
automática sin control: se muestra la acción, su estado y el consumo previsto
de créditos.

## Visor de detecciones

Antes de generar geometría, la imagen se muestra con superposiciones. El usuario
puede confirmar, corregir la caja, eliminar una detección falsa o añadir un
elemento que el modelo no vio. Solo entonces se construye la escena.

## Integración de generación de imagen a 3D

La vista de detalle del proyecto ofrece una primera integración síncrona con
TripoSR. Acepta JPG, PNG y WebP de hasta 20 MB, muestra una previsualización de
la imagen y el GLB resultante, y deja la inferencia en el microservicio local.

El navegador envía el archivo a `POST /api/projects/{id}/ai/generate`. Next.js
requiere sesión y acceso al proyecto, limita las solicitudes y reenvía el
archivo a `AI_SERVICE_URL` con `X-AI-Service-Key`. `AI_SERVICE_TOKEN` debe
coincidir con `AI_SERVICE_API_KEY` del microservicio y solo se usa en el
servidor. El resultado registra la ejecución en `AIAnalysis` y el objeto
generado en `ExportJob`; el GLB queda en el bucket privado `models-3d`, que el
servicio crea durante el startup si no existe.

Esta primera ruta espera la inferencia completa y no usa la cola ni el sondeo
de progreso descritos arriba. La URL firmada se usa para la previsualización
inmediata; la ruta persistente del modelo se conserva en `ExportJob`.
