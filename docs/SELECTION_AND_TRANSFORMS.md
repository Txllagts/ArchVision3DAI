# Seleccion y transformaciones

Esta guia explica el flujo implementado para seleccionar objetos y girarlos en los visores 2D y 3D. La fuente de verdad sigue siendo `SceneDocument`; la seleccion de interfaz guarda IDs y toda modificacion persistente pasa por `TRANSFORM_OBJECTS`.

## Mapa de responsabilidades

| Archivo | Responsabilidad |
| --- | --- |
| `packages/shared/src/selectable-bounds.ts` | Registro tipado de bounds, intersecciones, pivote comun y dependencias de transformacion. |
| `packages/shared/src/command-reducer.ts` | Aplica traslacion, giro y escala al documento inmutable; vuelve a calcular habitaciones afectadas. |
| `packages/types/src/entities.ts` | Contrato persistible de las entidades; `Roof` incluye pose de planta opcional. |
| `packages/geometry/src/roof.ts` | Construye geometria de techo centrada en coordenadas locales; el giro no cambia sus dimensiones. |
| `apps/web/src/components/editor/viewport-2d.tsx` | Marquee 2D en coordenadas de planta y arrastre de entidades seleccionadas (muro, mobiliario, huella de modelo; el vano arrastrado expande a su muro anfitrion). |
| `apps/web/src/components/editor/viewport-3d.tsx` | Marquee por frustum, plano de trabajo, arrastre de objetos, orbita central y preview de transformaciones. |
| `apps/web/src/components/editor/scene-objects.tsx` | Mallas, picking y pose Three.js de entidades. |
| `apps/web/src/components/editor/inspector.tsx` | Angulo incremental compartido, botones de giro y propiedades. |
| `apps/web/src/lib/editor/rotation-preference.ts` | Lectura y escritura del incremento angular en `localStorage`. |
| `packages/shared/src/editor.test.ts` | Pruebas de reducer, pivote y dependencias. |
| `packages/geometry/src/geometry.test.ts` | Pruebas de que el tamaño local del techo se conserva al girar. |

## Seleccion multiple

El store del editor es la unica fuente de IDs seleccionados. El marquee no conserva una seleccion propia: al soltar el puntero llama a `select(ids, additive)`.

Los bounds viven en `selectable-bounds.ts`, en `boundsByKind`, tipado como un mapa de resolvers por entidad. Ambos visores llaman a `getSelectableBounds`; no deciden por separado la huella de un objeto.

En 2D, el rectangulo se convierte a mundo con `toWorld` y compara los ejes de planta X/Z de cada bounds. Arrastrar de izquierda a derecha selecciona objetos completamente contenidos; de derecha a izquierda selecciona los que cruzan el rectangulo.

En 3D, el rectangulo de pantalla se convierte en un frustum de camara. Se comprueba contra los bounds mundiales y se consideran todos los pisos visibles. La representacion del rectangulo no recibe eventos. El picking por clic usa raycasting de Three.js.

El registro incluye muros, puertas, ventanas, aberturas genericas, columnas, escaleras, techos, losas, habitaciones y mobiliario. Las aberturas dependen de su muro anfitrion; una habitacion depende de sus muros. `getTransformTargetIds` expresa estas dependencias en un solo lugar para movimiento y giro.

## Movimiento en 3D

- Boton izquierdo sobre una entidad: selecciona y permite arrastrarla.
- Si el objeto ya pertenece a una seleccion multiple, se conserva el grupo y se mueve junto.
- El cursor se proyecta al plano horizontal que pasa por el pivote comun. Se muestra un preview y al soltar se emite un solo `TRANSFORM_OBJECTS` con el delta X/Z.
- Puertas, ventanas y aberturas trasladan su muro anfitrion; una habitacion traslada sus muros asociados.
- `pointercancel` descarta el preview sin mutar la escena.
- Boton central + arrastre: orbita la camara alrededor de `OrbitControls.target`.
- Boton derecho + arrastre: panea la camara fuera de la herramienta Seleccion.

## Giro interactivo 3D

1. Selecciona una entidad o grupo con la herramienta Seleccion.
2. El inspector conserva el incremento angular elegido (1 a 360 grados) en `localStorage`, para reutilizarlo al seleccionar otros objetos y despues de recargar.
3. El tirador circular se coloca sobre `getSelectionPivot(scene, ids)`. El reducer utiliza la misma funcion, de modo que preview y resultado final comparten pivote.
4. Arrastra el tirador. Por defecto el giro es continuo; manteniendo `Shift` se ajusta al incremento guardado. La lectura angular acompana el cursor.
5. Mientras arrastras, `PreviewRotation` envuelve temporalmente las mallas afectadas. Todavia no muta `SceneDocument`.
6. Al soltar, se emite un solo `TRANSFORM_OBJECTS` con el delta final. Undo/redo y guardado registran una sola transformacion, no una por fotograma.

El incremento que se eligio en el inspector se persiste como preferencia de interfaz; la orientacion resultante se persiste en la entidad dentro de `SceneDocument` mediante el comando normal del editor.

## Por que el techo tiene pose separada

El techo se construye a partir de un contorno parametrico. Antes, girar transformaba cada punto de ese contorno; su caja envolvente cambiaba y el generador inferia de nuevo el ancho, fondo y direccion de cumbrera. Eso podia deformar el techo.

Ahora la forma se mantiene en `outline`; `position` y `rotationY` describen su pose en planta. Son opcionales para que escenas serializadas antes de este cambio sigan leyendose como posicion cero y giro cero. La geometria se centra respecto al contorno y Three.js aplica la pose como transformacion rigida. Los bounds y el encuadre de camara consultan la misma pose.

## Agregar una clase seleccionable

1. Define la entidad en `packages/types/src/entities.ts` y agregala a `SceneDocument` si corresponde.
2. Agrega su tipo a `SelectableEntities` y un resolver a `boundsByKind` en `selectable-bounds.ts`. El bounds debe usar coordenadas del mundo, considerar la pose y dimensiones persistidas, y no depender del viewport.
3. Agrega la coleccion al recorrido generico de `getSelectionPivot` y `getTransformTargetIds` cuando aplique. Los objetos vinculados deben declarar aqui la relacion con su anfitrion.
4. Registra la entidad en ambos marquees (2D y 3D), consumiendo `getSelectableBounds`; no copies formulas de bounds a los componentes.
5. Implementa su malla con picking en `scene-objects.tsx`. Para preview angular, envuelvela en `PreviewRotation` con su ID.
6. Extiende `TRANSFORM_OBJECTS` en `command-reducer.ts` para actualizar su pose persistida, respetar `locked` y conservar dimensiones. No alteres el comando si `ids[]` y `rotateY` bastan.
7. Agrega pruebas del bounds, del giro alrededor del pivote, de dimensiones invariantes y de dependencias.

Si una clase no tiene pose independiente (por ejemplo, un vano que pertenece a una pared), no inventes una transformacion separada: expande la seleccion al anfitrion mediante `getTransformTargetIds`.

## Validacion

```powershell
pnpm --filter @archvision/shared test
pnpm --filter @archvision/shared typecheck
pnpm --filter @archvision/geometry test
pnpm --filter @archvision/geometry typecheck
pnpm --filter @archvision/three-engine typecheck
pnpm --filter @archvision/web typecheck
```

El typecheck web tambien depende de los modulos `@/lib/storage` y `@/lib/storage/sniff` referenciados por `file-service.ts`. Si esos archivos no estan disponibles en el workspace, ese chequeo falla aparte de la seleccion y las transformaciones.
