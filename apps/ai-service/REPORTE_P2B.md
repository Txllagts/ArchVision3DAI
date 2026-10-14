# REPORTE P2B — Estimación y corrección de inclinación antes de detectar muros

## 1. Resumen

- Se añade a `plan_preprocess.py`: `estimate_skew` (Hough, ±0.17°), `rotate_with_matrix` (lienzo ampliado + matriz), `map_entities_to_original` y `trim_canvas`.
- Comparados los dos estimadores, **Hough gana con claridad** (error máx 0.17° frente a 1.28° de gradientes).
- Gancho `deskew: bool = False` en `analyze_floorplan` (orden flatten → deskew → `_raster_geometry` → vuelta al espacio original), `image_size` original.
- **(a) PASS** (0–45°: R 0.984–0.990, P ≥ 0.982) y **(b) PASS** (limpio idéntico).
- Clave: el lienzo ampliado infla los umbrales relativos del detector y filtra muros finos; `trim_canvas` recorta **solo el borde blanco** y lo resuelve.
- (c) el plano no ortogonal (30/60) **no se rota** (confianza 0.66 < 0.70); (d) la cizalla empeora en varios puntos; (e) +~70 ms.
- `tools/sensitivity.py` y `tools/evaluate_floorplan.py` tienen `--deskew` real. No hay fotos en `tools/_real/`.

## 2. Tabla de criterios

| Criterio | Meta | Resultado | PASS/FAIL |
| --- | --- | --- | --- |
| (a) Rotación 0–45° (paso 5°) deskew=True | R ≥ 0.95 y P ≥ 0.98 en cada ángulo | R 0.984–0.990, P 0.982–0.987 en los 10 ángulos | **PASS** |
| (b) Limpio 0° deskew=True | entidades idénticas a deskew=False | 10/10 idénticas | **PASS** |
| (c) Plano 30°/60° (no ortogonal) | reportar si mejora o empeora | conf 0.66 < 0.70 → no rota; R=0.000 igual que sin deskew | N/A (reportado) |
| (d) Cizalla 0–0.3 | reportar y comparar | mejora 0.12 (0.79→0.91); empeora 0.06/0.24/0.30 | N/A (reportado) |
| (e) Tiempo y lienzo | reportar | +~72 ms/caso; lienzo ampliado máx ~1814×1814 (45°), recortado ~922×668 | N/A (reportado) |
| (f) Tests | ángulo ±1°, ida/vuelta ±1 px, blanco/ruido sin rotar, 2 curvas igual | 4/4 tests OK; 96 tests, 2 fallos (solo curvas) | **PASS** |

## 3. Tablas antes/después (n = 10 semillas por celda)

### Estimadores (error frente al ángulo real, módulo 90°)

| Estimador | Error medio | Error máximo |
| --- | ---: | ---: |
| gradientes (a) | 0.58° | 1.28° |
| HoughLinesP (b) | **0.03°** | **0.17°** |

### (a) Rotación — P/R (deskew=False | deskew=True)

| Ángulo | P false | R false | P true | R true |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0.994 | 0.984 | 0.994 | 0.984 |
| 5 | 0.993 | 0.789 | 0.985 | 0.990 |
| 10 | 0.100 | 0.004 | 0.987 | 0.989 |
| 15 | 0.000 | 0.000 | 0.986 | 0.990 |
| 20 | 0.000 | 0.000 | 0.983 | 0.990 |
| 25 | 0.000 | 0.000 | 0.984 | 0.990 |
| 30 | 0.000 | 0.000 | 0.985 | 0.989 |
| 35 | 0.000 | 0.000 | 0.982 | 0.990 |
| 40 | 0.894 | 0.412 | 0.984 | 0.989 |
| 45 | 0.999 | 0.871 | 0.983 | 0.990 |

### (d) Cizalla — recall (deskew=False | deskew=True)

| Cizalla | false | true |
| ---: | ---: | ---: |
| 0.00 | 0.984 | 0.984 |
| 0.06 | 0.980 | 0.679 |
| 0.12 | 0.789 | 0.909 |
| 0.18 | 0.640 | 0.793 |
| 0.24 | 0.593 | 0.602 |
| 0.30 | 0.589 | 0.335 |

### (c) Plano no ortogonal (30/60)

| Config | Estimación | Muros P | Muros R |
| --- | --- | ---: | ---: |
| deskew=False | — | 0.000 | 0.000 |
| deskew=True | 34.93° (conf 0.66) | 0.000 | 0.000 |

## 4. Diff de `app/services/floorplan.py`

```diff
diff --git a/apps/ai-service/app/services/floorplan.py b/apps/ai-service/app/services/floorplan.py
index 256d1b2..0b5b5f1 100644
--- a/apps/ai-service/app/services/floorplan.py
+++ b/apps/ai-service/app/services/floorplan.py
@@ -16,7 +16,15 @@ import numpy as np
 from PIL import Image, ImageOps
 
 from app.services.input_preprocessor import convert_dwg_to_dxf
-from app.services.plan_preprocess import flatten_illumination
+from app.services.plan_preprocess import (
+    MIN_DESKEW_ANGLE,
+    SKEW_CONFIDENCE_THRESHOLD,
+    estimate_skew,
+    flatten_illumination,
+    map_entities_to_original,
+    rotate_with_matrix,
+    trim_canvas,
+)
 from app.settings import Settings
 
 SUPPORTED_EXTENSIONS = {".pdf", ".dwg", ".dxf", ".png", ".webp", ".jpg", ".jpeg"}
@@ -858,7 +866,12 @@ def _parse_cad_upload(
 
 
 def analyze_floorplan(
-    filename: str, data: bytes, settings: Settings, *, preprocess: bool = False
+    filename: str,
+    data: bytes,
+    settings: Settings,
+    *,
+    preprocess: bool = False,
+    deskew: bool = False,
 ) -> dict[str, Any]:
     extension = Path(filename).suffix.lower()
     if extension not in SUPPORTED_EXTENSIONS:
@@ -880,11 +893,23 @@ def analyze_floorplan(
         image = _read_raster(extension, data)
         if preprocess:
             image = flatten_illumination(image)
+        # El tamaño de la imagen es el de la original, antes de cualquier rotación.
+        image_size = {"width": image.width, "height": image.height}
+        deskew_matrix: np.ndarray | None = None
+        if deskew:
+            angle, confidence = estimate_skew(image)
+            if confidence >= SKEW_CONFIDENCE_THRESHOLD and abs(angle) >= MIN_DESKEW_ANGLE:
+                image, deskew_matrix = rotate_with_matrix(image, angle)
+                # La rotación amplía el lienzo; se recorta el borde blanco para
+                # que los umbrales relativos del detector no filtren muros finos.
+                image, deskew_matrix = trim_canvas(image, deskew_matrix)
         entities = _raster_geometry(image)
+        if deskew_matrix is not None:
+            # Devuelve los puntos al espacio original antes de bounds/statistics.
+            entities = map_entities_to_original(entities, deskew_matrix)
         units = "pixels"
         coordinate_system = "image_pixels_top_left_origin"
         source_kind = "raster"
-        image_size = {"width": image.width, "height": image.height}
 
     return {
         "format_version": "1.0",
```

(`git diff --stat`: 28 insertions, 3 deletions.)

## 5. Decisiones

- **Estimador elegido: Hough (`SKEW_ESTIMATOR = "hough"`)**. Opciones: histograma de gradientes ponderado vs HoughLinesP. Hough gana en exactitud (0.03° medio / 0.17° máx frente a 0.58°/1.28°): ajusta segmentos exactos, mientras la orientación de gradiente se sesga con trazos gruesos, esquinas y arcos.
- **Umbral de confianza 0.70 + puerta de densidad de bordes [0.001, 0.25]**. El plano limpio/girado da confianza ~1.00 y densidad ~0.005–0.008; el ruido da densidad 0.37 (se descarta) y el no ortogonal confianza 0.66 (por debajo, no se rota).
- **`MIN_DESKEW_ANGLE = 1.0°`**: no rotar por inclinaciones despreciables (garantiza (b)).
- **Signo de la rotación**: se fija empíricamente; `rotate_with_matrix(image, +ángulo)` es lo que alinea los muros.
- **Lienzo ampliado + `trim_canvas`**: la rotación amplía el lienzo (no se pierde contenido, como pide el enunciado) pero eso agranda la dimensión mínima y con ella `line_thickness` de `_raster_geometry`, que filtraría muros finos. `trim_canvas` recorta **solo el borde blanco** (contorno de tinta por Otsu + margen), sin perder contenido, y compensa la matriz. Sin este recorte, el recall caía a 0.2–0.9.
- **`image_size` original**: se captura antes de rotar.
- **`map_entities_to_original`**: inversa de la afín, redondeo a entero, conserva `type`/`role`/`closed`/`confidence`.

## 6. Riesgos y cosas raras

- **`trim_canvas` es imprescindible**: los umbrales de `_raster_geometry` son relativos a la dimensión mínima; el lienzo ampliado (p. ej. 1538×1446 a 20°) sube `line_thickness` a 14 px y descarta muros de 12 px. El recorte lo evita. Es una decisión documentada, no un truco: elimina solo el relleno blanco de la rotación.
- **El estimador de Hough es sensible a parámetros** (umbral, longitud mínima). La puerta de densidad de bordes es una heurística que funciona en los casos sintéticos (blanco/ruido); en texturas reales podría necesitar ajuste.
- **No ortogonal no se corrige** (confianza 0.66 < 0.70): es lo deseado (dejarlo igual), pero recuerda que el detector tampoco detecta muros a 30/60°.
- **Cizalla**: el deskew no la corrige y a veces empeora (0.06: 0.98→0.68; 0.24/0.30 bajan). Mejora solo 0.12.
- **Tiempo**: ~+72 ms por caso (estimación + rotación + recorte + segunda pasada de detección).
- **`tools/_real/` existe pero está vacío**: no hay fotos/croquis reales que procesar.

## 7. Archivos tocados y unittest

**Tocados:**
- `app/services/plan_preprocess.py` (`estimate_skew`, `rotate_with_matrix`, `map_entities_to_original`, `trim_canvas` + constantes)
- `app/services/floorplan.py` (gancho `deskew`)
- `tools/sensitivity.py` y `tools/evaluate_floorplan.py` (`--deskew` real)
- `tests/test_plan_preprocess.py` (+4 pruebas de deskew)
- `tools/measure_p2b.py` (nuevo, medición)
- `REPORTE_P2B.md`
- `tools/_output/p2b/` (ignorado por git): `caso_20_con_deskew.overlay.png`, `caso_sigue_fallando_no_ortogonal.overlay.png`

**`python -m unittest discover -s tests -v`**: **96 tests, 2 fallos** (solo curvas conocidas):
- `test_detects_bay_window_curve_without_flattening`
- `test_detects_circular_wall_as_closed_ring`

## 8. `git status --short`

```
 M .gitignore
 M apps/ai-service/.env.example
 M apps/ai-service/app/main.py
 M apps/ai-service/app/services/floorplan.py
 M apps/ai-service/app/services/plan_preprocess.py
 M apps/ai-service/app/settings.py
 M apps/ai-service/tests/test_plan_preprocess.py
 M apps/ai-service/tools/evaluate_floorplan.py
 M apps/ai-service/tools/sensitivity.py
?? "GUIA_ARRANQUE (1).md"
?? apps/ai-service/REPORTE_P2B.md
?? apps/ai-service/app/services/local_storage.py
?? apps/ai-service/tools/measure_p2b.py
?? apps/web/src/lib/storage/diseno-arquitectonico-edificios-modernos-gran-altura_632498-25655.avif
?? cambios_sin_identificar.patch
```
