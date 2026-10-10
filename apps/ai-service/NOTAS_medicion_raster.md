# NOTAS — Medición de `_raster_geometry` y datos sintéticos

Tarea: medir qué tan bien funciona hoy `_raster_geometry` (detección de muros
en planos raster) y preparar un generador de datos con verdad de referencia.
Todo el trabajo vive en `apps/ai-service`; **no se modificó nada de `app/`**.

## Archivos tocados (todos dentro de `apps/ai-service`)

| Archivo | Estado | Descripción |
| --- | --- | --- |
| `tools/__init__.py` | nuevo | Paquete de utilería fuera del runtime. |
| `tools/synthetic_plans.py` | nuevo | Generador determinista, ground truth, etiquetas YOLO-seg y degradación. |
| `tools/evaluate_floorplan.py` | nuevo | Evaluador con tabla markdown y métricas. |
| `tools/.gitignore` | nuevo | Ignora `_output/` y `__pycache__/` (directorio de salida). |
| `tests/test_synthetic_plans.py` | nuevo | 8 pruebas del generador y de la degradación. |
| `NOTAS_medicion_raster.md` | nuevo | Este reporte. |

No se tocó `apps/web`, `packages/*`, `requirements.txt` ni ningún archivo de
`app/`. No se crearon las carpetas de `docs/AI_PIPELINE.md`.

## Cómo ejecutar

```powershell
cd apps/ai-service
# Generador + evaluación (escribe en tools/_output, ignorado por git)
.\.venv\Scripts\python.exe -m tools.evaluate_floorplan --count 8 --seed 20260101
# Pruebas
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Resultados de tests

`python -m unittest discover -s tests -v` → **58 tests, 2 fallos**.

* Las **8** pruebas nuevas de `tests/test_synthetic_plans.py` pasan (determinismo
  del generador y de la degradación, etiquetas normalizadas en `[0,1]`, ground
  truth coherente, artefactos escritos, consistencia geométrica).
* Los **2 fallos son preexistentes y ajenos a este cambio**:
  `test_detects_bay_window_curve_without_flattening` y
  `test_detects_circular_wall_as_closed_ring`, ambos en la pasada de curvas de
  `_raster_geometry`. Se reproducen aislados (`-p test_floorplan.py`) y no hay
  cambios en `app/` en `git status`, por lo que no los introduce esta tarea.
  Quedan fuera de alcance; conviene abordarlos en una tarea aparte.

## Medición (N=8 planos, semilla 20260101, tolerancia 6 px)

| Nivel | Muros P | Muros R | Muros F1 | Puertas R | Ventanas R | Huecos R* | s/imagen | Fallos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| limpio | 0.995 | 0.992 | 0.993 | 0.000 | 0.000 | 0.982 | 0.035 | 0/8 |
| leve | 0.897 | 0.883 | 0.890 | 0.000 | 0.000 | 0.982 | 0.065 | 0/8 |
| medio | 0.892 | 0.807 | 0.840 | 0.000 | 0.000 | 1.000 | 0.132 | 0/8 |
| fuerte | 0.881 | 0.734 | 0.792 | 0.000 | 0.000 | 1.000 | 0.142 | 0/8 |

\* `Huecos R` es una **métrica extra** que no pidió el enunciado: fracción de
aberturas cuyo muro anfitrión fue detectado y que quedan sin puentear. `limpio`
es una fila de referencia, no un nivel de degradación; los 3 niveles pedidos son
`leve`, `medio`, `fuerte`.

Lectura: en limpio la detección de muros es casi perfecta (F1 0.993). La
degradación golpea sobre todo el recall (0.992 → 0.734) mientras la precisión se
mantiene; el costo por imagen sube de 35 a 142 ms. Ninguna variante falla (0/8).

## Hallazgo principal (contradicción del enunciado, anotada, no adivinada)

El enunciado pide **recall de puertas y ventanas**, pero `_raster_geometry`
(linea 588 en adelante) **solo emite entidades con `role = "wall_candidate"`**.
Para raster no existen `door_candidate` ni `window_candidate` (solo el parseo CAD
los produce). Por eso ambas columnas son **0.000 por construcción**, no por un
fallo del evaluador. El recall de puertas/ventanas no es medible hoy en raster
sin antes añadir esa detección; el evaluador ya queda preparado para medirlo
cuando exista (busca candidatos por rol). Como proxy útil se añadió `Huecos R`.

### Sobre el recall de la fila `limpio`

La primera versión medía el recall contra el muro completo (incluyendo el hueco
de la abertura). Daba 0.855 en limpio. El diagnóstico mostró que **1555 de 1564
puntos no cubiertos (99.4 %) estaban a <40 px de una abertura**: el detector
acierta al no dibujar muro donde hay hueco. La verdad de referencia se corrigió
para usar los tramos reales de muro (línea central recortada por las aberturas),
y el recall limpio sube a 0.992. Con esa referencia, los tramos cortos que dejaría
fuera el umbral `line_length = min_dim // 10` sí serían penalizados correctamente.

## Qué simula `degrade` y cómo se garantiza la consistencia

`degrade(image, rng, strength)` devuelve `(imagen_degradada, homografía_3x3)`.
Se devuelve la homografía **precisamente** para que las transformaciones
geométricas puedan aplicarse de forma idéntica a etiquetas y ground truth; el
envoltorio `degrade_plan` es quien la aplica. Transformaciones:

* Geométricas (afectan a imagen **y** geometría): `rotate`, `scale`, `shear`,
  `perspective`.
* Fotométricas (solo píxeles): `blur`, `illumination_gradient`,
  `gaussian_noise`, `contrast`, `jpeg`, `smudge`, `paper_tint`.

`strength` va de 0 (identidad) a 1; los 3 niveles usan 0.35 / 0.70 / 1.00.

## Formato de salida por plano

* `<name>.png` — plano en escala de grises/simulado a 1024×768 px.
* `<name>.ground_truth.json` — muros en px (índice, extremos, espesor, largo,
  exterior) y aberturas (tipo, `wall_index`, `offset`, ancho, centro, extremos y
  polígono).
* `<name>.txt` — etiquetas YOLO-seg: `0 door`, `1 window`, con polígono
  normalizado a `[0,1]`.

El generador es determinista: cada plano deriva de `random.Random(seed)` y una
semilla por plano; la degradación deriva su aleatoriedad del `rng` recibido.

## Método de las métricas de muros

Precisión/recall por **cobertura de puntos con tolerancia en px** (paso
`tolerancia/2`), no emparejamiento 1-a-1: el detector parte y fusiona segmentos,
y el emparejamiento rígido castigaría cortes/union. Cada punto del muro GT se
considera cubierto si cae a <`tolerancia` de algún segmento detectado; la
precisión hace lo simétrico sobre los segmentos detectados. F1 = media armónica.

## Supuestos y limitaciones

* Rejilla de 1–4 habitaciones rectangulares (`cols×rows`), muros de 12–20 px,
  puertas de 80–100 px y ventanas de 110–170 px; puertas en muros interiores,
  ventanas (y una puerta de entrada ocasional) en exteriores.
* La degradación puede recortar geometría contra el borde; no se recorta el
  ground truth, de modo que parte del recall perdido en niveles altos es
  frontera recortada, no fallo del detector.
* El evaluador agrega por media macro entre planos.
* No se usan binarios, pesos ni `ultralytics` en las pruebas.

## Dependencias

No se agregó ninguna dependencia nueva ni se editó `requirements.txt`. Para poder
ejecutar se completó el `.venv` existente con versiones ya fijadas en
`requirements.txt` (`matplotlib==3.10.3`, `pydantic-settings==2.8.1`; el resto
del subconjunto necesario —`numpy`, `Pillow`, `opencv-python-headless`,
`PyMuPDF`, `ezdxf`, `trimesh`— ya estaba presente en el entorno).
