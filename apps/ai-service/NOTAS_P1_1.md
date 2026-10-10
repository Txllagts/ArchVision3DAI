# NOTAS P1.1 — Mejora de la medición de `_raster_geometry`

Tarea P1.1: mejorar la medición hecha en P1 (media ± desviación estándar por
nivel, tabla de ablación, desglose `line`/`polyline`, hoja de contacto, opción
`--preprocess` pendiente y reetiquetado de "Huecos R" como no fiable).

Todo el trabajo vive en `apps/ai-service`. **No se tocó `app/`, `apps/web` ni
`packages/*`.**

## Archivos tocados (solo los de esta tarea)

| Archivo | Cambio |
| --- | --- |
| `tools/synthetic_plans.py` | Refactor de degradación en operaciones aislables; `degrade_isolated`, `degrade_plan_isolated`, `_reproject_plan`; visualización `render_annotated_image` y `render_contact_sheet`. |
| `tools/evaluate_floorplan.py` | Opciones `--n`/`--seeds`/`--preprocess`; media ± desviación estándar; tabla de ablación; desglose por tipo de entidad; hoja de contacto. |
| `tests/test_synthetic_plans.py` | +6 pruebas (degradación aislada, visualización, hoja de contacto). |
| `NOTAS_P1_1.md` | Este reporte. |

> Nota: en `git status` aparecen cambios en `apps/ai-service/app/main.py`,
> `app/settings.py`, `app/services/local_storage.py` y `.env.example` que **no
> son de esta tarea**: son modificaciones preexistentes del árbol de trabajo.
> No las toqué ni las incluyo en el alcance.

## Cómo ejecutar

```powershell
cd apps/ai-service
# Medición completa (40 planos, 3 semillas) + ablación + hoja de contacto
.\.venv\Scripts\python.exe -m tools.evaluate_floorplan --n 40 --seeds 3
# Pruebas
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Resultados de tests

`python -m unittest discover -s tests -v` → **64 tests, 2 fallos** (los 2
preexistentes de curvas, sin cambios). Las 14 pruebas de
`tests/test_synthetic_plans.py` pasan (8 de P1 + 6 nuevas).

* Fallos preexistentes (ajenos, **no aumentan**):
  `test_detects_bay_window_curve_without_flattening` y
  `test_detects_circular_wall_as_closed_ring`. Se confirma que siguen siendo
  exactamente los mismos 2.

## Medición (N=40 planos, 3 semillas = 120 ejecuciones por nivel, tol 6 px)

### Niveles de degradación (media ± desviación estándar)

| Nivel | Muros P | Muros R | Muros F1 | Puertas R | Ventanas R | Huecos R† | s/imagen | Fallos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| limpio | 0.995 ± 0.003 | 0.987 ± 0.014 | 0.991 ± 0.007 | 0.000 | 0.000 | 0.993 ± 0.031 | 0.07 ± 0.02 | 0/120 |
| leve | 0.886 ± 0.117 | 0.869 ± 0.119 | 0.877 ± 0.117 | 0.000 | 0.000 | 0.991 ± 0.035 | 0.12 ± 0.01 | 0/120 |
| medio | 0.870 ± 0.117 | 0.808 ± 0.134 | 0.833 ± 0.118 | 0.000 | 0.000 | 0.992 ± 0.037 | 0.13 ± 0.02 | 0/120 |
| fuerte | 0.910 ± 0.098 | 0.752 ± 0.188 | 0.807 ± 0.148 | 0.000 | 0.000 | 0.992 ± 0.050 | 0.14 ± 0.03 | 0/120 |

† `Huecos R` **no es fiable**: premia no detectar (no es una métrica de huecos);
se conserva solo como referencia y así se marca en la salida.

La degradación castiga sobre todo el recall (0.987 → 0.752), mientras la
precisión se mantiene o sube ligeramente (el ruido "limpia" trazos débiles y solo
sobreviven los muros nítidos, mejor emparejados). Ninguna variante falla (0/120).

### Entidades detectadas por tipo

| Nivel | Línea (n) | Línea P | Línea R | Polilínea (n) | Polilínea P | Polilínea R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| limpio | 10 | 0.995 ± 0.003 | 0.987 ± 0.014 | 0 | 0.000 | 0.000 |
| leve | 10 | 0.886 ± 0.117 | 0.869 ± 0.119 | 0 | 0.000 | 0.000 |
| medio | 9 | 0.870 ± 0.117 | 0.808 ± 0.134 | 0 | 0.000 | 0.000 |
| fuerte | 8 | 0.910 ± 0.098 | 0.752 ± 0.188 | 0 | 0.000 | 0.000 |

El desglose funciona, pero en este dataset **no aparecen polilíneas**: los planos
sintéticos solo tienen muros rectos (habitaciones rectangulares) y los arcos de
puerta son trazos finos (2 px) que el detector descarta por debajo de
`line_thickness`. Medir la pasada de curvas requeriría fixtures con muros curvos,
fuera del alcance de esta tarea. Anotado, no adivinado.

### Ablación (intensidad fija 1.0, cada transformación sola)

| Transformación | Muros P | Muros R | Fallos |
| --- | ---: | ---: | ---: |
| rotate | 0.925 ± 0.129 | 0.860 ± 0.159 | 0/120 |
| scale | 0.994 ± 0.003 | 0.984 ± 0.017 | 0/120 |
| shear | 0.862 ± 0.129 | 0.851 ± 0.127 | 0/120 |
| perspective | 0.941 ± 0.064 | 0.931 ± 0.064 | 0/120 |
| blur | 0.995 ± 0.003 | 0.988 ± 0.013 | 0/120 |
| illumination_gradient | 0.995 ± 0.003 | 0.987 ± 0.014 | 0/120 |
| gaussian_noise | 0.995 ± 0.003 | 0.987 ± 0.014 | 0/120 |
| contrast | 0.995 ± 0.003 | 0.987 ± 0.014 | 0/120 |
| jpeg | 0.995 ± 0.003 | 0.987 ± 0.014 | 0/120 |
| smudge | 0.995 ± 0.003 | 0.974 ± 0.019 | 0/120 |
| paper_tint | 0.995 ± 0.003 | 0.987 ± 0.014 | 0/120 |

Lectura:

* Las transformaciones geométricas que **desalinean** los muros respecto de los
  4 ejes fijos del detector (0/45/90/135°) son las que más dañan: `shear`
  (P/R 0.862/0.851) y `rotate` (0.925/0.860). `scale` apenas afecta.
* Las fotométricas casi no afectan en estos planos de alto contraste (la
  umbralización de Otsu es robusta); solo `smudge` baja algo el recall (0.974).
  Se verificó que sí modifican píxeles (diferencia media 1.3–44 niveles), o sea
  que no es un no-op del generador.

## Hoja de contacto

`tools/_output/contact_sheet.png` (1120×630, 4×3 celdas de 12 planos) con overlay:
muros GT en rojo, aberturas GT en verde y etiquetas YOLO como relleno translúcido
(azul = puerta, naranja = ventana). Al coincidir GT y etiqueta, el relleno queda
exactamente sobre el contorno verde; sirve para revisar la alineación a ojo.

## `--preprocess`

Añadida como flag. No tiene efecto y avisa en consola:
`AVISO: --preprocess está pendiente de implementar; esta ejecución NO aplica
ningún preprocesado.`

## Supuestos y anotaciones

* **Puertas/Ventanas R = 0.000 por construcción**: `_raster_geometry` solo emite
  `wall_candidate`; los roles `door/window_candidate` no existen en raster.
  El evaluador queda preparado para medirlos cuando existan.
* **"Huecos R" marcado como no fiable** (premia no detectar); no se definió una
  métrica nueva de huecos, tal como se pidió.
* Ablación con **intensidad fija 1.0** (equivalente a "fuerte") para aislar el
  efecto de cada transformación; agregada por media macro entre planos y semillas.
* Métrica de muros por cobertura de puntos (tolerancia 6 px), sobre los tramos
  reales de muro (línea central recortada por los huecos), igual que en P1.
* La desviación estándar se calcula como desviación poblacional (`pstdev`) sobre
  los 120 registros por nivel.

## Dependencias

Ninguna nueva. No se modificó `requirements.txt`; se usa el `.venv` existente.
