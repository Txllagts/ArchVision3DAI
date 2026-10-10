# NOTAS P6 — Herramienta de depuración visual `tools/run_local.py`

Tarea P6: herramienta de depuración que ejecuta `analyze_floorplan` y
`extrude_floorplan_to_3d` en local (sin Supabase ni servidor) y vuelca
`result.json`, `model.glb` y `overlay.png`.

Todo en `apps/ai-service`. **No se modificó `app/`.**

## Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `tools/run_local.py` | Nuevo: CLI de depuración visual. |
| `tests/test_run_local.py` | Nuevo: 2 pruebas mínimas. |
| `NOTAS_P6.md` | Este reporte. |

> `tools/` ya está versionado (commit de P1) y `tools/.gitignore` ignora
> `_output/`, por lo que la salida queda fuera de git. En `git status` siguen
> apareciendo cambios ajenos a esta tarea (`app/main.py`, `app/settings.py`,
> `app/services/local_storage.py`, `.env.example`) que no toqué.

## Uso

```powershell
cd apps/ai-service
# Sobre un plano sintético generado por tools/synthetic_plans.py
.\.venv\Scripts\python.exe tools\run_local.py tools\_output\plan_000.png --out tools\_output\run_local

# Con la bandera pendiente de preprocesado
.\.venv\Scripts\python.exe tools\run_local.py tools\_output\plan_000.png --out tools\_output\run_local --preprocess
```

Ejemplo de salida en consola:

```
Entidades: 8
  por role: wall_candidate=8
  por type: line=8
Imagen: original=1024x768, reducida=1024x768
Tiempo: análisis=0.03s, extrusión=0.35s, total=0.39s
Salida: tools\_output\run_local
```

## Archivos de salida (en `<carpeta>`)

* `result.json` — resultado completo de `analyze_floorplan` (entities, source,
  bounds, statistics).
* `model.glb` — malla GLB de `extrude_floorplan_to_3d(result)`.
* `overlay.png` — la imagen en el espacio reducido (`source.image_size`) con:
  * muros en azul, puertas en verde, ventanas en naranja;
  * entidades `line` como segmentos y `polyline` como curvas;
  * entidades cerradas marcadas con un círculo magenta en el centroide;
  * la confianza (`0.40`, `0.35`, …) escrita junto a cada entidad;
  * si existe `<imagen>.ground_truth.json` junto a la imagen, la verdad en rojo
    y los puntos de discrepancia (amarillo = GT no cubierto, magenta =
    detección sin GT), con tolerancia de 6 px.

## Comportamientos requeridos

1. Llama a `analyze_floorplan` y `extrude_floorplan_to_3d` con
   `Settings(_env_file=None)`; no toca Supabase ni red.
2. Guarda los tres archivos (verificado con `test_generates_three_artifacts`).
3. Overlay con colores por role y marcado de cerradas + confianza (verificado
   por inspección de píxeles: muros azul, GT rojo, FP magenta).
4. Imprime conteo por role y por type, tamaño original/reducido y segundos.
5. Dibuja ground truth en rojo y marca discrepancias cuando hay un
   `ground_truth.json` vecino.
6. Imagen > 4 megapíxeles: imprime `Error 422: la imagen supera el límite de
   4000000 píxeles (...)` y devuelve código 1 **sin traceback** (verificado con
   `test_oversize_prints_422_without_traceback`). Es el mismo comportamiento del
   servicio: `InvalidFloorplanError` → HTTP 422 (`app/main.py:449`).
7. `--preprocess`: como `Settings` no tiene `plan_preprocess_enabled`, imprime
   `AVISO: --preprocess: Settings aún no tiene 'plan_preprocess_enabled'; se
   continúa sin preprocesado.` y sigue sin aplicarlo.

## Tests

`python -m unittest discover -s tests -v` → **66 tests, 2 fallos** (los 2
preexistentes de curvas, sin cambios).

* `tests/test_run_local.py`: **2 pruebas OK**.
* `tests/test_synthetic_plans.py`: 14 pruebas OK (de P1 y P1.1).

## Supuestos y anotaciones

* La imagen reducida se reconstruye replicando el criterio de `_read_raster`
  (EXIF-transpose + `thumbnail` a 2048 px; PDF con `fitz`). Para CAD (DWG/DXF)
  no hay imagen, así que no se genera `overlay.png` y se avisa en consola.
* La "discrepancia" se mide por cobertura de puntos con tolerancia 6 px sobre
  los tramos reales de muro del GT (línea central sin huecos); los huecos de
  puerta/ventana no se cuentan como error.
* `extrude_floorplan_to_3d` puede fallar si no hay muros suficientes; en ese
  caso se guardan igualmente `result.json` y `overlay.png`, se imprime el error
  y se devuelve código 1 sin traceback.
* La confianza se escribe con la fuente por defecto de PIL (sin dependencias
  nuevas).

## Dependencias

Ninguna nueva. Se usa el `.venv` existente (Pillow, numpy, PyMuPDF, trimesh…).
