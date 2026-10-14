# Importación de planos

Fase 5. Convierte un plano en papel o PDF exportado a imagen en el punto de
partida de un modelo 3D.

El principio de la plataforma se aplica aquí sin excepción: **la detección
propone, la persona decide**. Ningún muro entra en el documento sin que el
usuario lo acepte.

## Recorrido

```
Subir imagen → Colocar y girar → Fijar la escala → Detectar muros
             → Revisar la propuesta → Crear los aceptados → Corregir a mano
```

Los pasos van en ese orden porque cada uno necesita el anterior: sin escala no
hay medidas reales, y sin medidas reales la detección no puede distinguir un
muro de una línea de cota.

## 1. Archivo

`POST /api/projects/:id/files` con `kind=floorplan`. Se aceptan PNG, JPEG,
WebP y PDF hasta el límite del plan.

El tipo se determina leyendo la cabecera del archivo, no el `Content-Type` que
declara el navegador. Las dimensiones se leen del propio encabezado (IHDR de
PNG, marcadores SOF de JPEG, VP8/VP8L/VP8X de WebP) para no arrastrar una
librería de imagen al servidor.

El PDF se almacena, pero todavía no se rasteriza: para calcarlo hay que
exportarlo a PNG. La conversión llega con el servicio de la fase 6.

## 2. Colocación

El plano se guarda en el documento de escena como `underlay`:

| Campo | Significado |
| --- | --- |
| `fileId` | Referencia al archivo; la imagen nunca se guarda en la escena |
| `pixelsPerMeter` | Escala, resultado de la calibración |
| `offset` | Posición en metros del píxel (0,0) |
| `rotationDeg` | Giro, para enderezar un escaneado torcido |
| `opacity`, `visible` | Presentación en la planta |

La conversión entre imagen y modelo es una sola fórmula:

```
mundo = offset + R(rotación) · (píxel / pixelsPerMeter)
```

En la vista de planta se aplica como transformación afín del SVG, de modo que
el navegador escala y gira la imagen en la GPU y el desplazamiento sigue siendo
fluido con planos grandes.

## 3. Escala

El usuario traza una línea sobre una medida que conoce (una cota, una fachada,
la puerta) y escribe cuánto mide en la realidad. Es el único dato que la imagen
no puede aportar por sí sola.

Al recalibrar, el primer punto marcado queda anclado: el plano no salta por la
pantalla justo cuando se acaba de situar.

## 4. Detección de muros

Vive en `packages/vision`, no depende del DOM ni de Three.js y es
**determinista**: el mismo plano da siempre el mismo resultado. Es visión
clásica, no un modelo entrenado.

| Paso | Qué hace | Por qué |
| --- | --- | --- |
| Escala de grises | Luminancia ponderada; lo transparente cuenta como papel | Un PNG recortado no debe leerse como una mancha de tinta |
| Reducción | Lado mayor a 1200 px, promediando bloques | Hough crece con los píxeles; promediar evita perder trazos finos |
| Umbral de Otsu | Corte calculado del histograma de cada imagen | Un escaneado no tiene blanco uniforme |
| Componentes conexas | Descarta las manchas de poca extensión | Cotas, textos y símbolos son pequeños; los muros, largos |
| Hough | Acumula **todos** los píxeles de tinta | Un muro relleno da un máximo en su eje; acumulando solo bordes daría dos rectas por muro |
| Ángulo dominante | Orientación con más energía y su perpendicular | Los planos vienen girados unos grados; solo se aceptan rectas de esas dos direcciones |
| Trazado | Recorre cada recta buscando tinta en una banda | Hough da rectas infinitas; aquí aparecen principio, fin y grosor |
| Alineación | Agrupa ejes, alarga hasta la perpendicular, funde solapes | Es lo que cierra las esquinas; sin ello no se detecta ninguna habitación |

Cada muro propuesto trae grosor estimado, longitud y una confianza derivada de
la continuidad del trazo. Los de confianza igual o superior a 0.6 llegan
marcados; el resto exige un clic.

La propuesta se dibuja en ámbar sobre la planta y no toca el documento. Al
aceptar, se emite un `CREATE_WALL` por muro con `origin: "import"`, de modo que
toda la operación se deshace con `Ctrl+Z` como cualquier otra edición.

### Qué no hace

- No reconoce puertas ni ventanas: son huecos en el muro y quedan como tramos
  separados que el usuario une o completa.
- No lee texto ni cotas.
- No interpreta símbolos de mobiliario ni sombreados.
- No trabaja con muros curvos.

Todo eso corresponde al servicio de visión de la fase 6, que consumirá esta
misma interfaz (`DetectedWall[]`) desde un modelo entrenado.

## Análisis automático (fastapi `/api/v1/floorplan/analyze`)

Además del detector del navegador, el panel de importación lanza el análisis
del microservicio en cuanto el archivo está guardado. El recorrido completo es:

1. `useFileImport` sube el archivo a `/api/projects/:id/files` y, si es una
   imagen, coloca el `underlay` en la escena.
2. Vuelve a enviar **el archivo** (multipart) a
   `/api/projects/:id/ai/floorplan`, que hace de proxy autenticado contra
   `/api/v1/floorplan/analyze`. Enviar un JSON con el `fileId` aquí era el
   fallo original: el proxy esperaba el binario y el análisis nunca se
   ejecutaba, así que la escena se quedaba vacía con el plano guardado.
3. `POST /api/projects/:id/ai/floorplan/apply` traduce la respuesta a comandos
   de creación (`CREATE_WALL`, `CREATE_DOOR`, `CREATE_WINDOW`, todos con
   `origin: "ai"`). La conversión de unidades vive en
   `packages/shared/src/floorplan-import.ts`:
   - **CAD**: unidades declaradas (`$INSUNITS`) a metros;
   - **raster**: píxeles a metros. Si el análisis se hizo sobre el mismo
     archivo que el `underlay` visible, se usa la calibración del usuario
     (`pixelToWorld`) y los muros caen dentro de la imagen; si no, la
     aproximación del servicio de 100 px/m.
4. El cliente emite los comandos en un único lote (`dispatchBatch`): un solo
   Ctrl+Z deshace toda la estructura. Las aperturas se resuelven contra los
   muros recién creados, porque un vano cuelga del id de su muro.
5. El reductor recalcula los recintos (`withRecomputedRooms`), así que las
   habitaciones aparecen solas en la planta 2D y en 3D.

## Precisión

Sobre un plano limpio y bien calibrado, el error típico está en torno al 1 % de
la longitud del muro. Un escaneado con ruido, tramas o texto pegado al muro
empeora el resultado.

**Verifique siempre las medidas importantes antes de usarlas para
construcción, presupuesto o trámites.**
