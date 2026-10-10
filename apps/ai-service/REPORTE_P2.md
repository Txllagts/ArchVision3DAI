# REPORTE P2 — Aplanado de iluminación (P2a) y cobertura angular (P2c)

## 1. Resumen

- **P2a**: nuevo `app/services/plan_preprocess.py` (`flatten_illumination`: cierre morfológico + división) aplicado en `analyze_floorplan` tras `_read_raster` con `preprocess=False` por defecto (diff de `floorplan.py`: 15+/2−). Todos sus criterios pasan: regresión 10/10, limpio R=0.986, gradiente 0.986 hasta 0.90 y sombra 0.8 → 0.986 (+70 ms/imagen).
- **P2c**: la pasada direccional pasa de 4 a 12 ángulos (`DIRECTIONAL_ANGLES`, 15° de espaciado). Elimina las zonas muertas (antes 10–35° detectaban 0), pero **no** cumple los objetivos estrictos de recall (a) y (b), y **rompe un test existente** por artefactos diagonales en las esquinas.
- Los 2 tests de curvas siguen fallando igual; aparece **1 fallo nuevo** (orthogonal) → total 3 fallos.

## 2. Tabla de criterios

| Criterio | Meta | Resultado | PASS/FAIL |
| --- | --- | --- | --- |
| 1a. Regresión `preprocess=False` | entidades de planos limpios idénticas | 10/10 idénticas (0 discrepancias) | **PASS** |
| 1b. Limpio con `preprocess=True` | recall ≥ 0.98 | R=0.986 (P=0.995) | **PASS** |
| 1c. Gradiente de luz | recall ≥ 0.95 hasta 0.85 | 0.986 en todo 0.00–0.90 | **PASS** |
| 1d. Sombra de mano 0.8 | recall ≥ 0.95 | 0.986 | **PASS** |
| 1e. Tiempo extra por imagen | (reportar) | +70 ms (+~2x el detector) | informativo |
| 2a. Rotación 0–45° (paso 5°) | recall ≥0.95 y prec ≥0.98 en cada ángulo | falla en 9 de 10 ángulos | **FAIL** |
| 2b. Cizalla hasta 0.3 | recall ≥ 0.90 | 0.792 (0.12) y 0.897 (0.18) < 0.90 | **FAIL** |
| 2c. Plano limpio | P/R ±0.01, sin duplicados | P/R sin cambios, 0 duplicados | **PASS** |
| 2d. Tiempo por imagen | ≤ 3x | 2.51x | **PASS** |
| 2e. Tests de curvas | ni más ni menos fallos | 2 curvas igual, pero +1 fallo nuevo | **FAIL** |

## 3. Tablas antes/después (n = 10 semillas por celda)

### Plano limpio (n=10)

| Configuración | Muros P | Muros R |
| --- | ---: | ---: |
| 4 ángulos, preprocess=False | 0.995 | 0.986 |
| 12 ángulos, preprocess=False | 0.995 | 0.986 |
| 12 ángulos, preprocess=True | 0.995 | 0.986 |

### Gradiente de luz — recall (n=10)

| Intensidad | preprocess=False | preprocess=True |
| ---: | ---: | ---: |
| 0.00–0.45 | 0.986 | 0.986 |
| 0.50 | 0.715 | 0.986 |
| 0.55 | 0.495 | 0.986 |
| 0.60 | 0.489 | 0.986 |
| 0.65 | 0.479 | 0.986 |
| 0.70 | 0.477 | 0.986 |
| 0.75 | 0.446 | 0.986 |
| 0.80 | 0.446 | 0.986 |
| 0.85 | 0.446 | 0.986 |
| 0.90 | 0.429 | 0.986 |

### Sombra de mano — recall (n=10)

| Fuerza | preprocess=False | preprocess=True |
| ---: | ---: | ---: |
| 0.2 | 0.986 | 0.986 |
| 0.4 | 0.986 | 0.986 |
| 0.6 | 0.840 | 0.986 |
| 0.8 | 0.665 | 0.986 |

### Rotación — P / R (n=10)

| Ángulo | 4 áng. P | 4 áng. R | 12 áng. P | 12 áng. R |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0.994 | 0.984 | 0.994 | 0.984 |
| 5 | 0.993 | 0.789 | 0.990 | 0.789 |
| 10 | 0.100 | 0.004 | 0.997 | 0.605 |
| 15 | 0.000 | 0.000 | 0.998 | 0.942 |
| 20 | 0.000 | 0.000 | 0.996 | 0.480 |
| 25 | 0.000 | 0.000 | 0.898 | 0.415 |
| 30 | 0.000 | 0.000 | 0.999 | 0.874 |
| 35 | 0.000 | 0.000 | 0.697 | 0.202 |
| 40 | 0.894 | 0.412 | 0.894 | 0.412 |
| 45 | 0.999 | 0.871 | 0.999 | 0.871 |

### Cizalla — recall (n=10)

| Cizalla | 4 áng. | 12 áng. |
| ---: | ---: | ---: |
| 0.00 | 0.984 | 0.984 |
| 0.06 | 0.980 | 0.980 |
| 0.12 | 0.789 | 0.792 |
| 0.18 | 0.640 | 0.897 |
| 0.24 | 0.593 | 0.984 |
| 0.30 | 0.589 | 0.984 |

## 4. Diff completo de `app/services/floorplan.py`

```diff
diff --git a/apps/ai-service/app/services/floorplan.py b/apps/ai-service/app/services/floorplan.py
index ec58356..d56e1ca 100644
--- a/apps/ai-service/app/services/floorplan.py
+++ b/apps/ai-service/app/services/floorplan.py
@@ -16,6 +16,7 @@ import numpy as np
 from PIL import Image, ImageOps
 
 from app.services.input_preprocessor import convert_dwg_to_dxf
+from app.services.plan_preprocess import flatten_illumination
 from app.settings import Settings
 
 SUPPORTED_EXTENSIONS = {".pdf", ".dwg", ".dxf", ".png", ".webp", ".jpg", ".jpeg"}
@@ -24,6 +25,16 @@ MAX_RASTER_ENTITIES = 5_000
 MAX_GEOMETRY_POINTS = 200_000
 MAX_IMAGE_SIDE = 2_048
 MAX_IMAGE_PIXELS = 4_000_000
+
+# Orientaciones de la pasada direccional. Un kernel solo detecta bien (±0.95)
+# muros dentro de ~1°, pero llega a detectar trazos hasta ~9°; con espaciado de
+# 15° las coberturas se solapan y no quedan orientaciones muertas. Son 12 ángulos
+# (~2.5x de coste), dentro del presupuesto de 3x. Se deja como constante con
+# nombre para poder ajustar la cobertura sin tocar la lógica del detector.
+DIRECTIONAL_ANGLES: tuple[float, ...] = (
+    0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165,
+)
+
 WALL_LAYER_PATTERN = re.compile(r"(wall|walls|muro|muros|pared|paredes|partition)", re.IGNORECASE)
 DOOR_LAYER_PATTERN = re.compile(r"(door|doors|puerta|puertas)", re.IGNORECASE)
 WINDOW_LAYER_PATTERN = re.compile(r"(window|windows|ventana|ventanas)", re.IGNORECASE)
@@ -737,7 +748,7 @@ def _raster_geometry(image: Image.Image) -> list[dict[str, Any]]:
     directional_segments: list[
         tuple[np.ndarray, np.ndarray, np.ndarray]
     ] = []
-    for angle in (0, 45, 90, 135):
+    for angle in DIRECTIONAL_ANGLES:
         mask = cv2.morphologyEx(
             working, cv2.MORPH_OPEN, _rotated_kernel(kernel_length, line_thickness, angle)
         )
@@ -849,7 +860,7 @@ def _parse_cad_upload(
 
 
 def analyze_floorplan(
-    filename: str, data: bytes, settings: Settings
+    filename: str, data: bytes, settings: Settings, *, preprocess: bool = False
 ) -> dict[str, Any]:
     extension = Path(filename).suffix.lower()
     if extension not in SUPPORTED_EXTENSIONS:
@@ -869,6 +880,8 @@ def analyze_floorplan(
         image_size = None
     else:
         image = _read_raster(extension, data)
+        if preprocess:
+            image = flatten_illumination(image)
         entities = _raster_geometry(image)
         units = "pixels"
         coordinate_system = "image_pixels_top_left_origin"
```

## 5. Decisiones

- **Tamaño del kernel de cierre (`BACKGROUND_KERNEL_RATIO = 0.12` de la dimensión mínima)**.
  Opciones: kernel pequeño (≈0.05, poco coste pero no elimina la sombra de mano), mediano
  (0.10–0.15) o grande (≈0.25+, lento). Elegí 0.12 porque el trazo de muro es ~15 px y
  la sombra de mano abarca hasta ~200 px, y porque con ese valor se cumplen los tres
  criterios de P2a (limpio 0.986, gradiente 0.986 a 0.90, sombra 0.986). Es una decisión
  de diseño; no hice un barrido exhaustivo del ratio.
- **Morfología del kernel: `MORPH_ELLIPSE`** (vs `MORPH_RECT`). Preferí elipse por estimar
  mejor un fondo suave sin las esquinas duras del rectángulo; el coste medido (+70 ms) es
  aceptable.
- **`preprocess` keyword-only con `False` por defecto**: garantiza que el comportamiento
  previo no cambie (criterio 1a) y que ningún llamador existente se vea afectado.
- **Salida de `flatten_illumination`: misma talla y modo RGB** (se pasa a escala de grises
  para estimar el fondo y se replica a RGB), como pide el enunciado.
- **Ángulos direccionales: `DIRECTIONAL_ANGLES` cada 15° (12 ángulos)**. Medí la tolerancia
  real (ver abajo) y comparé 4/12/18/36/60 ángulos. El presupuesto de tiempo (≤3x) solo
  admite hasta ~12 ángulos (2.51x); 18 ángulos son 3.67x. 15° de espaciado solapa las
  coberturas (la detección llega hasta ~9°) y elimina las zonas muertas.
- **No cambié nada más de `_raster_geometry`** (curvas, umbrales, fusión, merge), solo el
  iterable de ángulos.

### Tolerancia angular medida (recall medio, 10 semillas, preprocess=False)

| Desviación del kernel | 0° | 1° | 2° | 5° | 8° | 9° | 10° |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recall | 0.984 | 0.955 | 0.744 | 0.789 | 0.210 | 0.121 | 0.004 |

Un kernel solo mantiene recall ≥0.95 dentro de ~1°, pero detecta hasta ~9°. Con espaciado
de 15° (12 ángulos) no hay orientaciones muertas; con 45° (4 ángulos) había una zona muerta
de ~30°.

## 6. Riesgos y cosas raras

- **Regresión (lo más grave)**: con los ángulos fuera de eje aparecen **segmentos diagonales
  en las esquinas** de muros gruesos axis-alineados (~50 px), que `_axis_aligned_segment` no
  imanta (ángulo ~14°) y el merge no fusiona. Esto **rompe `test_raster_keeps_full_orthogonal_walls_and_filters_small_marks`**
  (2 → 3 fallos). No puedo arreglarlo sin tocar merge/umbrales (prohibido).
- **Criterio 2a inalcanzable**: ni con 3° de espaciado (60 ángulos, 12.4x) se llega a
  recall ≥0.95 en todos los pasos de 5°. A 45° el recall se queda en ~0.87 (limitación de
  la detección diagonal, no del número de ángulos).
- **Cizalla no monótona**: 0.12 y 0.18 son peores que 0.24 y 0.30, porque la inclinación
  cae entre kernels. Mejora el extremo (0.24/0.30: 0.59 → 0.98) pero no el centro.
- **Tiempos**: 12 ángulos = 2.51x el detector de 4 ángulos (35.5 ms → 89.2 ms). `preprocess`
  añade ~70 ms. Con ambos: 159.5 ms/imagen.
- **Sin duplicados**: 0 pares (mismo muro detectado en 2 ángulos) en los 10 layout limpios.
- **Aviso de entorno**: apareció un cambio no intencionado en `app/__init__.py` (quitaba el
  salto de línea final); lo revertí con `git restore`.

## 7. Archivos tocados y tests

**Tocados por esta tarea:**
- `app/services/plan_preprocess.py` (nuevo)
- `app/services/floorplan.py` (import + `DIRECTIONAL_ANGLES` + `analyze_floorplan(...)`; 15+/2−)
- `tools/sensitivity.py` (`--preprocess` real)
- `tools/evaluate_floorplan.py` (`--preprocess` real, sin aviso)
- `tools/measure_p2.py` (nuevo, medición)
- `tests/test_plan_preprocess.py` (nuevo, 3 pruebas)
- `REPORTE_P2.md` (este informe)
- `tools/_output/p2/` (artefactos; ignorado por git): `baseline_entities.json`,
  `caso_antes_fallaba_ahora_pasa_gradiente085_preprocess.overlay.png`,
  `caso_sigue_fallando_rotacion20.overlay.png`.

**`python -m unittest discover -s tests -v`**: **92 tests, 3 fallos**:
- `test_detects_bay_window_curve_without_flattening` (conocido)
- `test_detects_circular_wall_as_closed_ring` (conocido)
- `test_raster_keeps_full_orthogonal_walls_and_filters_small_marks` (**nuevo**, por P2c)

## 8. `git status --short`

```
 M .gitignore
 M apps/ai-service/.env.example
 M apps/ai-service/app/main.py
 M apps/ai-service/app/services/floorplan.py
 M apps/ai-service/app/settings.py
 M apps/ai-service/tools/evaluate_floorplan.py
 M apps/ai-service/tools/sensitivity.py
?? "GUIA_ARRANQUE (1).md"
?? apps/ai-service/app/services/local_storage.py
?? apps/ai-service/app/services/plan_preprocess.py
?? apps/ai-service/tests/test_plan_preprocess.py
?? apps/ai-service/tools/measure_p2.py
?? apps/web/src/lib/storage/diseno-arquitectonico-edificios-modernos-gran-altura_632498-25655.avif
?? cambios_sin_identificar.patch
```
