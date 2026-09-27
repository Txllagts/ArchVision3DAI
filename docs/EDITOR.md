# Editor — arquitectura funcional

Fases 2, 3 y 4 implementadas. Este documento describe cómo funciona el editor y
qué queda pendiente.

| Implementado | Pendiente |
| --- | --- |
| Visor 3D (React Three Fiber), vista 2D en SVG y modo dividido | Gizmos de traslacion y escala en 3D |
| Paredes con vanos booleanos, losas, cubiertas, escaleras, columnas | Recorrido en primera persona y modo presentación |
| Marquee 2D/3D, selección múltiple, giro agrupado en 3D y snapping | Exportadores GLB/OBJ/STL (fase 8) |
| Comandos, undo/redo, autoguardado con control de revisión | Colaboración en tiempo real (fase 10) |
| Materiales PBR con textura procedural, arrastrar/soltar y pincel | Modelos GLB de mobiliario y texturas subidas por el usuario |

## Disposición

```
┌──────────────────────────────────────────────────────┐
│ Logo | Proyecto | Undo Redo | 2D 3D Split | Guardar  │
├──────┬───────────────────────────────────┬───────────┤
│      │                                   │ Outliner  │
│ Tools│            VIEWPORT               ├───────────┤
│      │                                   │ Inspector │
├──────┴───────────────────────────────────┴───────────┤
│ Estado | Unidad | Snap | FPS | Guardado              │
└──────────────────────────────────────────────────────┘
```

Tema oscuro por defecto. En móvil el editor es principalmente visualización.

## Ciclo de una edición

```
Interacción del usuario
   → Comando validado (sceneCommandSchema)
   → Reducción sobre SceneDocument (con su inverso para undo)
   → Reconciliación incremental de la escena Three.js
   → Autoguardado con debounce (PUT /scene con expectedRevision)
```

Nunca se recrea la escena completa: el reconciliador actúa solo sobre las
entidades cuyo hash de parámetros cambió.

## Comandos

Definidos en `packages/types/src/commands.ts` y validados en
`packages/validation/src/commands.ts`:

`CREATE_WALL`, `UPDATE_WALL`, `CREATE_DOOR`, `CREATE_WINDOW`, `UPDATE_OPENING`,
`CREATE_FLOOR`, `CREATE_ROOF`, `UPDATE_ROOF`, `CREATE_COLUMN`, `CREATE_STAIR`,
`ADD_FURNITURE`, `ASSIGN_MATERIAL`, `CREATE_MATERIAL`, `UPDATE_MATERIAL`,
`DELETE_MATERIAL`, `TRANSFORM_OBJECTS`, `DELETE_OBJECTS`, `SET_VISIBILITY`,
`SET_LOCK`, `RENAME_OBJECT`.

El asistente de IA traduce lenguaje natural a estos comandos. Si un comando no
valida, se descarta y se explica al usuario; nunca se aplica parcialmente.

## Motor de geometría

Funciones puras, sin estado y sin dependencia de la escena:

| Función | Entrada | Salida |
| --- | --- | --- |
| `createWallGeometry` | `Wall` + vanos asociados | Geometría extruida con huecos |
| `createDoorOpening` | `Door`, `Wall` | Volumen de sustracción y marco |
| `createWindowOpening` | `WindowEntity`, `Wall` | Hueco, marco y vidrio |
| `createRoofGeometry` | `Roof` | Faldones, aleros y espesor |
| `createFloorGeometry` | `Slab` | Losa extruida desde el contorno |
| `createStairGeometry` | `Stair` | Peldaños, descanso y baranda |

Las uniones de paredes se resuelven por intersección de ejes con el grosor de
cada tramo, de modo que las esquinas cierran sin solapes visibles.

## Snapping

Prioridad descendente: vértice de pared, extremo o punto medio de segmento,
eje ortogonal desde el último punto, cuadrícula. Umbral en píxeles de pantalla,
no en metros, para que sea estable a cualquier zoom.

## Sincronización 2D / 3D

Ambos editores leen y escriben el mismo `SceneDocument`; no hay conversión ni
copia. Un cambio en planta se refleja en 3D en el siguiente fotograma, y una
modificación estructural en 3D actualiza la planta. El modo `Split` muestra
plano a la izquierda y modelo a la derecha.

La selección, los bounds compartidos y el giro interactivo se explican paso a
paso en [Selección y transformaciones](SELECTION_AND_TRANSFORMS.md).

## Atajos

| Tecla | Acción |
| --- | --- |
| `V` | Seleccionar |
| `W` | Mover |
| `E` | Rotar |
| `R` | Escalar |
| `Supr` | Eliminar |
| `Ctrl + Z` / `Ctrl + Shift + Z` | Deshacer / rehacer |
| `F` | Centrar selección |
| `1` / `2` / `3` | Vista frontal / lateral / superior |
| `G` | Pincel de material y biblioteca |
| `A` | Asistente, revisión del modelo y tutorial |
| `K` | Calibrar el plano importado |
| `Ctrl + K` | Paleta de comandos |

## Materiales y texturas

Un material es un registro serializable: color base, rugosidad, metalicidad,
opacidad, patrón de textura y tamaño de tesela en metros. No se guarda ninguna
imagen dentro de la escena.

Las texturas se **generan por procedimiento** en el cliente a partir del nombre
del patrón (`brick`, `wood-planks`, `ceramic-tile`, `marble`, `roof-shingle`,
`gravel`, `brushed-metal`…). De cada patrón salen tres mapas: color, normal
derivado del relieve por Sobel, y rugosidad. Consecuencias:

- la escena pesa unos pocos kilobytes de texto y no depende de ninguna CDN;
- el mismo patrón se comparte entre materiales y solo cambia el tinte, así que
  hay una textura en memoria por patrón, no por material;
- todos los patrones cierran sin costura en ambos ejes, propiedad verificada
  por pruebas (`patterns.test.ts` compara los bordes opuestos).

Las coordenadas UV de toda la geometría se proyectan **en metros** según la
normal dominante de cada cara (`applyBoxUv`). Por eso el tamaño de tesela del
material se expresa en metros y un ladrillo mide lo mismo en una fachada, en un
tabique y en un faldón de cubierta.

El catálogo de fábrica pertenece a la aplicación, no al proyecto: al abrir una
escena, los materiales cuyo identificador está en el catálogo se refrescan con
la definición vigente, de modo que una mejora del catálogo llega a los
proyectos existentes. Los materiales creados por el usuario nunca se tocan, y
los del catálogo no se pueden editar ni borrar: se duplican primero.

Tres formas de aplicar, todas por el mismo comando `ASSIGN_MATERIAL`:

| Vía | Cuándo |
| --- | --- |
| Arrastrar una muestra sobre el modelo 3D | Superficie suelta; el punto de caída se resuelve con un rayo |
| Pincel (`G`) y clic | Repetir el mismo material en varias caras, en 3D o en planta |
| «Aplicar a selección» | Muchos objetos ya seleccionados a la vez |

## Habitaciones y analítica

Las habitaciones se detectan buscando ciclos cerrados en el grafo de paredes de
cada nivel. Para cada una se calcula área, perímetro, altura y volumen; el panel
de analítica agrega superficie de paredes descontando vanos, superficie
acristalada y superficie de cubierta corregida por pendiente.

Estos cálculos son aproximados y sirven para estimación de cantidades, nunca
como cálculo estructural certificado.

## Detecciones de IA en el editor

Cada entidad puede llevar `source: "ai"` y `confidence` entre 0 y 1. La interfaz
las colorea: verde por encima de 0.8, ámbar por encima de 0.5, rojo por debajo.
Ninguna predicción queda bloqueada: siempre se puede mover, redimensionar,
eliminar o crear a mano.

## Rendimiento

Memoización de geometrías por hash de parámetros, mallas instanciadas para
mobiliario repetido, LOD por distancia, culling por frustum, fusión de
geometría estática al entrar en modo presentación, texturas comprimidas con
placeholder progresivo y Web Workers para operaciones geométricas pesadas.
