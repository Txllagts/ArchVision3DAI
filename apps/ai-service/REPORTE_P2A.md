# REPORTE P2A — Aplanado de iluminación con 4 ángulos (revert de P2c)

Se revierte `DIRECTIONAL_ANGLES` a los 4 ángulos originales (se conserva la
constante y se actualiza su comentario) porque los 12 ángulos de P2c rompían
`test_raster_keeps_full_orthogonal_walls_and_filters_small_marks` (diagonales
falsas en esquinas de muros gruesos) y costaban ~2.5x. Se confirma que el
aplanado de iluminación de P2a mantiene su resultado. No se tocó nada más de
`floorplan.py` ni ningún archivo prohibido. Sin dependencias nuevas.

## Criterios (4 ángulos, 10 semillas, `preprocess=True`)

| Criterio | Meta | Resultado | PASS/FAIL |
| --- | --- | --- | --- |
| Regresión `preprocess=False` | entidades de planos limpios idénticas | 10/10 idénticas (0 discrepancias) | **PASS** |
| Plano limpio | recall ≥ 0.98 | R=0.986 (P=0.995) | **PASS** |
| Gradiente de luz 0.85 | recall ≥ 0.95 | R=0.986 | **PASS** |
| Sombra de mano 0.8 | recall ≥ 0.95 | R=0.986 | **PASS** |

Contexto de la referencia (sin `preprocess`): gradiente 0.85 → R=0.446; sombra
0.8 → R=0.665. Con `preprocess=True` ambos suben a 0.986.

## Diff final de `app/services/floorplan.py`

```diff
diff --git a/apps/ai-service/app/services/floorplan.py b/apps/ai-service/app/services/floorplan.py
index ec58356..256d1b2 100644
--- a/apps/ai-service/app/services/floorplan.py
+++ b/apps/ai-service/app/services/floorplan.py
@@ -16,6 +16,7 @@ import numpy as np
 from PIL import Image, ImageOps
 
 from app.services.input_preprocessor import convert_dwg_to_dxf
+from app.services.plan_preprocess import flatten_illumination
 from app.settings import Settings
 
 SUPPORTED_EXTENSIONS = {".pdf", ".dwg", ".dxf", ".png", ".webp", ".jpg", ".jpeg"}
@@ -24,6 +25,14 @@ MAX_RASTER_ENTITIES = 5_000
 MAX_GEOMETRY_POINTS = 200_000
 MAX_IMAGE_SIDE = 2_048
 MAX_IMAGE_PIXELS = 4_000_000
+
+# Orientaciones de la pasada direccional. Se probó con 12 ángulos (0..165 cada
+# 15°) para cubrir cualquier orientación, pero rompió
+# test_raster_keeps_full_orthogonal_walls_and_filters_small_marks: en las
+# esquinas de muros gruesos aparecen diagonales falsas que la fusión no une.
+# Además costaba ~2.5x de tiempo. Se vuelve a los 4 ángulos originales.
+DIRECTIONAL_ANGLES: tuple[float, ...] = (0, 45, 90, 135)
+
 WALL_LAYER_PATTERN = re.compile(r"(wall|walls|muro|muros|pared|paredes|partition)", re.IGNORECASE)
 DOOR_LAYER_PATTERN = re.compile(r"(door|doors|puerta|puertas)", re.IGNORECASE)
 WINDOW_LAYER_PATTERN = re.compile(r"(window|windows|ventana|ventanas)", re.IGNORECASE)
@@ -737,7 +746,7 @@ def _raster_geometry(image: Image.Image) -> list[dict[str, Any]]:
     directional_segments: list[
         tuple[np.ndarray, np.ndarray, np.ndarray]
     ] = []
-    for angle in (0, 45, 90, 135):
+    for angle in DIRECTIONAL_ANGLES:
         mask = cv2.morphologyEx(
             working, cv2.MORPH_OPEN, _rotated_kernel(kernel_length, line_thickness, angle)
         )
@@ -849,7 +858,7 @@ def _parse_cad_upload(
 
 
 def analyze_floorplan(
-    filename: str, data: bytes, settings: Settings
+    filename: str, data: bytes, settings: Settings, *, preprocess: bool = False
 ) -> dict[str, Any]:
     extension = Path(filename).suffix.lower()
     if extension not in SUPPORTED_EXTENSIONS:
@@ -869,6 +878,8 @@ def analyze_floorplan(
         image_size = None
     else:
         image = _read_raster(extension, data)
+        if preprocess:
+            image = flatten_illumination(image)
         entities = _raster_geometry(image)
         units = "pixels"
         coordinate_system = "image_pixels_top_left_origin"
```

(`git diff --stat`: 13 insertions, 2 deletions.)

## Resultado de `python -m unittest discover -s tests -v`

**92 tests, 2 fallos** (solo los 2 de curvas conocidos):

- `test_detects_bay_window_curve_without_flattening`
- `test_detects_circular_wall_as_closed_ring`

`test_raster_keeps_full_orthogonal_walls_and_filters_small_marks` vuelve a
pasar tras el revert.

## `git status --short`

```
 M .gitignore
 M apps/ai-service/.env.example
 M apps/ai-service/app/main.py
 M apps/ai-service/app/services/floorplan.py
 M apps/ai-service/app/settings.py
 M apps/ai-service/tools/evaluate_floorplan.py
 M apps/ai-service/tools/sensitivity.py
?? "GUIA_ARRANQUE (1).md"
?? apps/ai-service/REPORTE_P2.md
?? apps/ai-service/app/services/local_storage.py
?? apps/ai-service/app/services/plan_preprocess.py
?? apps/ai-service/tests/test_plan_preprocess.py
?? apps/ai-service/tools/measure_p2.py
?? apps/web/src/lib/storage/diseno-arquitectonico-edificios-modernos-gran-altura_632498-25655.avif
?? cambios_sin_identificar.patch
```
