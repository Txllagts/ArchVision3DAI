# NOTAS P1.2 — Curvas de sensibilidad de `_raster_geometry`

Tarea P1.2: barridos de rotación, cizalla e iluminación (con sombra de mano)
sobre planos sintéticos, para medir dónde empieza a fallar la detección de muros.

Todo en `apps/ai-service`. **No se modificó `app/`.**

## Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `tools/synthetic_plans.py` | Añade transformaciones fijas: `rotate_plan`, `shear_plan`, `illumination_gradient`, `hand_shadow`, `illuminate_plan` (y `_fixed_homography`). |
| `tools/run_local.py` | Importa `_read_raster` del servicio en lugar de replicar su criterio (se eliminaron `_render_pdf`/`_reduced_image`). |
| `tools/sensitivity.py` | Nuevo: barridos + tablas + hoja de contacto + overlays. |
| `tests/test_synthetic_plans.py` | +6 pruebas de las transformaciones fijas. |
| `NOTAS_P1_2.md` | Este reporte. |

## Cómo ejecutar

```powershell
cd apps/ai-service
.\.venv\Scripts\python.exe -m tools.sensitivity --seed 20260101 --seeds 3
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Tests

`python -m unittest discover -s tests -v` → **72 tests, 2 fallos** (los 2
preexistentes de curvas, sin cambios). `test_synthetic_plans.py`: 20 pruebas OK.

## 4. ¿Las 3 semillas generan layouts distintos?

| Semilla | Layout | Muros | Puertas | Ventanas |
| --- | --- | ---: | ---: | ---: |
| 20260101 | 1×1 | 4 | 1 | 2 |
| 20260102 | 1×1 | 4 | 1 | 3 |
| 20260103 | 2×2 | 6 | 3 | 2 |

**No son todos distintos**: las semillas 20260101 y 20260102 comparten layout
1×1 (solo difieren en aberturas); 20260103 es 2×2. Hay **2 layouts entre 3
semillas**.

## 1. Barrido de rotación (0..45°, paso 5°, solo rotación)

| Ángulo (°) | Muros P | Muros R | Muros F1 |
| --- | ---: | ---: | ---: |
| 0 | 0.994 ± 0.001 | 0.990 ± 0.007 | 0.992 ± 0.003 |
| 5 | 0.995 ± 0.001 | 0.676 ± 0.149 | 0.795 ± 0.114 |
| 10 | 0.000 | 0.000 | 0.000 |
| 15 | 0.000 | 0.000 | 0.000 |
| 20 | 0.000 | 0.000 | 0.000 |
| 25 | 0.000 | 0.000 | 0.000 |
| 30 | 0.000 | 0.000 | 0.000 |
| 35 | 0.000 | 0.000 | 0.000 |
| 40 | 0.999 ± 0.001 | 0.501 ± 0.197 | 0.646 ± 0.168 |
| 45 | 0.999 ± 0.001 | 0.883 ± 0.120 | 0.933 ± 0.071 |

**Hallazgo**: el detector es extremadamente sensible a la orientación. Entre 10°
y 35° **no detecta ningún muro** (recall y precisión 0.000 → `InvalidFloorplanError`),
porque las pasadas direccionales solo usan kernels a 0/45/90/135°; a 40° y 45° los
muros vuelven a alinearse con el kernel de 45° y la detección se recupera (recall
0.50 → 0.88). Es una respuesta no monótona y con una "zona muerta" amplia.

## 2. Barrido de cizalla (0..0.3, 6 pasos, solo cizalla)

| Cizalla | Muros P | Muros R | Muros F1 |
| --- | ---: | ---: | ---: |
| 0.00 | 0.994 ± 0.001 | 0.990 ± 0.007 | 0.992 ± 0.003 |
| 0.06 | 0.995 ± 0.001 | 0.988 ± 0.010 | 0.991 ± 0.004 |
| 0.12 | 0.991 ± 0.003 | 0.804 ± 0.046 | 0.887 ± 0.030 |
| 0.18 | 0.987 ± 0.007 | 0.649 ± 0.066 | 0.781 ± 0.045 |
| 0.24 | 0.996 ± 0.001 | 0.577 ± 0.023 | 0.730 ± 0.018 |
| 0.30 | 0.997 ± 0.002 | 0.573 ± 0.023 | 0.728 ± 0.018 |

La cizalla degrada el recall de forma gradual y se satura en ~0.57 (la precisión
se mantiene: los muros que sobreviven siguen bien alineados).

## 3. Barrido de iluminación (gradiente lineal) + sombra de mano

Umbral de Otsu del plano limpio: **35.0**.

### Gradiente lineal

| Intensidad | Papel más oscuro | Bajo Otsu | Muros P | Muros R | Muros F1 | n muros |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00–0.45 | 255…140 | no | 0.994 ± 0.002 | 0.990 ± 0.007 | 0.992 ± 0.003 | 8.0 |
| 0.50 | 128 | no | 0.997 ± 0.002 | 0.580 ± 0.291 | 0.693 ± 0.216 | 5.3 |
| 0.55 | 115 | no | 0.997 ± 0.002 | 0.391 ± 0.049 | 0.560 ± 0.052 | 4.0 |
| 0.60–0.85 | 102…38 | no | 0.997 ± 0.002 | 0.391 ± 0.049 | 0.560 ± 0.052 | 4.0 |
| 0.90 | 25 | sí | 0.997 ± 0.002 | 0.391 ± 0.049 | 0.560 ± 0.052 | 4.0 |

**Empieza a fallar en intensidad 0.50** (recall 0.990 → 0.580).

**Qué ve el detector** (verificado): el umbral de Otsu se recalcula en cada
imagen. En limpio vale 35; a intensidad 0.45 sigue en 33; a **0.50 salta a 172**.
Con ese umbral, el papel inferior oscurecido (~128) cae por debajo y se clasifica
como "tinta": el detector ve una banda sólida abajo y pierde los muros inferiores
(n muros baja de 8 a 4; en el caso 1×1 el bounding box colapsa de `max_y=716` a
`max_y=162`). La precisión sube (los muros que quedan son limpios).

**Contradicción con el enunciado (anotada, no adivinada)**: el enunciado pide
barrer "hasta que el papel más oscuro quede por debajo del umbral de Otsu del
plano limpio". Con Otsu limpio = 35, eso ocurre a intensidad ≈ 0.86 (papel 25).
Pero el detector ya falla a 0.50, **antes** de que el papel cruce el umbral
limpio: el fallo lo provoca el re-umbralizado de Otsu por imagen, no el cruce del
papel. Se barrió hasta 0.90 para cubrir ambos puntos.

### Sombra de mano (banda oscura localizada)

| Fuerza | Muros P | Muros R | Muros F1 | n muros |
| --- | ---: | ---: | ---: | ---: |
| 0.2 | 0.994 ± 0.002 | 0.990 ± 0.007 | 0.992 ± 0.003 | 8.0 |
| 0.4 | 0.994 ± 0.002 | 0.990 ± 0.007 | 0.992 ± 0.003 | 8.0 |
| 0.6 | 0.994 ± 0.003 | 0.857 ± 0.078 | 0.918 ± 0.046 | 7.0 |
| 0.8 | 0.994 ± 0.003 | 0.607 ± 0.116 | 0.747 ± 0.088 | 5.0 |

La sombra empieza a afectar a fuerza 0.6 (recall 0.86) y a 0.8 cae a 0.61.

## 5. Hoja de contacto y overlays de casos que fallan

En `tools/_output/sensitivity/` (ignorado por git):

* `contact_sheet_rotation.png` — **2400×720** (5×2 celdas), los 10 ángulos del
  barrido con el overlay de detección (muros azul, GT rojo, discrepancias).
* 3 overlays individuales de los peores ángulos por recall:
  `worst_recall_10.overlay.png`, `worst_recall_15.overlay.png`,
  `worst_recall_20.overlay.png` (los tres son fallo total: el detector no
  encuentra muros, por eso el overlay muestra solo GT rojo + FN amarillos).

## 6. `run_local.py` usa `_read_raster`

Se eliminó la réplica local (`_render_pdf`/`_reduced_image`) y `build_overlay`
ahora obtiene la imagen reducida con `_read_raster(extension, data)` del propio
servicio. `tests/test_run_local.py` sigue pasando (2 OK).

## 7. Muros curvos (opcional)

**No implementado.** El generador sigue produciendo solo muros rectos, así que
las polilíneas detectadas siguen siendo 0 y no hay P/R de polilíneas que medir.
Se deja como pendiente opcional (requeriría añadir arcos/habitaciones curvas al
generador).

## Supuestos

* Intensidad de iluminación = factor lineal vertical: papel `255` arriba →
  `255·(1−I)` abajo; los muros se escalan igual (contraste relativo conservado).
* Sombra de mano = banda gaussiana localizada (franja horizontal con bordes
  suaves), posición fija con `random.Random(0)` para reproducibilidad.
* Métrica de muros por cobertura de puntos (tolerancia 6 px) sobre los tramos
  reales de muro, igual que en P1.1; media ± desviación estándar sobre 3 semillas.
* `--seed 20260101`, 3 semillas consecutivas.

## Dependencias

Ninguna nueva. Se usa el `.venv` existente (cv2 ya presente para el cálculo de Otsu).
