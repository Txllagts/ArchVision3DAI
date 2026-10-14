"""Medición de los criterios de P2 (aplanado de iluminación y cobertura angular).

Genera tablas markdown con el antes (``preprocess=False``) y el después
(``preprocess=True``) de: fondo limpio, gradiente de luz, sombra de mano,
rotación, cizalla, tiempos y muros duplicados.

Uso::

    python -m tools.measure_p2 --seeds 10

Solo lee; no modifica ``app``. Salida de artefactos en ``tools/_output/p2``.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from PIL import Image

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.floorplan import InvalidFloorplanError, analyze_floorplan
from app.settings import Settings
from tools.evaluate_floorplan import (
    _entity_segments,
    _png_bytes,
    _wall_metrics,
    _wall_runs,
)
from tools.synthetic_plans import (
    SyntheticPlan,
    generate_plan,
    illuminate_plan,
    rotate_plan,
    shear_plan,
)

DEFAULT_SEED = 20260101
DEFAULT_SEEDS = 10
DEFAULT_TOLERANCE = 6.0
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "_output" / "p2"

GRADIENT_INTENSITIES = [round(0.05 * index, 2) for index in range(19)]  # 0..0.90
SHADOW_STRENGTHS = [0.2, 0.4, 0.6, 0.8]
ROTATION_ANGLES = list(range(0, 46, 5))
SHEAR_VALUES = [0.0, 0.06, 0.12, 0.18, 0.24, 0.30]
CLEAN_CASE = ("limpio", None)

Segment = tuple[tuple[float, float], tuple[float, float]]


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _analyze(plan: SyntheticPlan, settings: Settings, preprocess: bool) -> dict[str, Any] | None:
    try:
        return analyze_floorplan(
            f"{plan.name}.png", _png_bytes(plan.image), settings, preprocess=preprocess
        )
    except InvalidFloorplanError:
        return None


def _measure(
    plan: SyntheticPlan,
    settings: Settings,
    preprocess: bool,
    tolerance: float,
    step: float,
) -> tuple[float, float, float, list[Segment]]:
    ground_truth = _wall_runs(plan)
    result = _analyze(plan, settings, preprocess)
    if result is None:
        return 0.0, 0.0, 0.0, []
    detected = [
        segment
        for entity in result.get("entities", [])
        if entity.get("role") == "wall_candidate"
        for segment in _entity_segments(entity)
    ]
    precision, recall, f1 = _wall_metrics(ground_truth, detected, tolerance, step)
    return precision, recall, f1, detected


# ---------------------------------------------------------------------------
# Criterios
# ---------------------------------------------------------------------------


def regression_check(baseline_path: Path, seeds: Sequence[int], settings: Settings) -> tuple[int, int]:
    """Compara entidades con preprocess=False contra la línea base guardada."""

    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    mismatches = 0
    compared = 0
    for seed in seeds:
        plan = generate_plan(seed)
        result = _analyze(plan, settings, preprocess=False)
        expected = baseline.get(str(seed))
        compared += 1
        if result is None or result["entities"] != expected:
            mismatches += 1
    return mismatches, compared


def _case_metrics(
    plans: Sequence[SyntheticPlan],
    settings: Settings,
    preprocess: bool,
    tolerance: float,
    step: float,
    transform,
) -> list[tuple[float, float]]:
    results = []
    for plan in plans:
        transformed = transform(plan)
        precision, recall, _, _ = _measure(transformed, settings, preprocess, tolerance, step)
        results.append((precision, recall))
    return results


def measure_clean(plans, settings, preprocess, tolerance, step):
    return _case_metrics(plans, settings, preprocess, tolerance, step, lambda p: p)


def measure_gradient(plans, settings, preprocess, tolerance, step):
    return [
        (intensity, _case_metrics(plans, settings, preprocess, tolerance, step,
                                  lambda p, i=intensity: illuminate_plan(p, i)))
        for intensity in GRADIENT_INTENSITIES
    ]


def measure_shadow(plans, settings, preprocess, tolerance, step):
    return [
        (strength, _case_metrics(plans, settings, preprocess, tolerance, step,
                                 lambda p, s=strength: illuminate_plan(p, 0.0, shadow=s, rng=random.Random(0))))
        for strength in SHADOW_STRENGTHS
    ]


def measure_rotation(plans, settings, preprocess, tolerance, step):
    return [
        (angle, _case_metrics(plans, settings, preprocess, tolerance, step,
                              lambda p, a=angle: rotate_plan(p, a)))
        for angle in ROTATION_ANGLES
    ]


def measure_shear(plans, settings, preprocess, tolerance, step):
    return [
        (value, _case_metrics(plans, settings, preprocess, tolerance, step,
                              lambda p, v=value: shear_plan(p, v)))
        for value in SHEAR_VALUES
    ]


def measure_timing(plans, settings, preprocess, tolerance, step) -> float:
    # Calienta y mide el coste medio por imagen (análisis completo).
    start = time.perf_counter()
    for plan in plans:
        _measure(plan, settings, preprocess, tolerance, step)
    return (time.perf_counter() - start) / max(len(plans), 1)


def count_duplicates(plans, settings, preprocess, tolerance, step) -> tuple[int, int]:
    """Cuenta pares de muros detectados que representan el mismo muro físico."""

    duplicates = 0
    total = 0
    for plan in plans:
        _, _, _, detected = _measure(plan, settings, preprocess, tolerance, step)
        total += len(detected)
        for index, first in enumerate(detected):
            for second in detected[index + 1:]:
                if _is_duplicate(first, second):
                    duplicates += 1
    return duplicates, total


def _is_duplicate(first: Segment, second: Segment) -> bool:
    (ax0, ay0), (ax1, ay1) = first
    (bx0, by0), (bx1, by1) = second
    dir_a = (ax1 - ax0, ay1 - ay0)
    dir_b = (bx1 - bx0, by1 - by0)
    len_a = math.hypot(*dir_a)
    len_b = math.hypot(*dir_b)
    if len_a < 1e-6 or len_b < 1e-6:
        return False
    # Ángulo entre direcciones (módulo 180°).
    cos_angle = (dir_a[0] * dir_b[0] + dir_a[1] * dir_b[1]) / (len_a * len_b)
    angle = math.degrees(math.acos(max(-1.0, min(1.0, abs(cos_angle)))))
    if angle > 12.0:
        return False
    # Distancia del punto medio de uno a la recta del otro.
    mid_b = ((bx0 + bx1) / 2, (by0 + by1) / 2)
    mid_a = ((ax0 + ax1) / 2, (ay0 + ay1) / 2)
    if _point_line_distance(mid_b, first) > 6.0 or _point_line_distance(mid_a, second) > 6.0:
        return False
    # Solapamiento de proyecciones.
    return _projection_overlap(first, second) > 0.5


def _point_line_distance(point, segment) -> float:
    (x0, y0), (x1, y1) = segment
    px, py = point
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return math.hypot(px - x0, py - y0)
    return abs(dy * (px - x0) - dx * (py - y0)) / length


def _projection_overlap(first: Segment, second: Segment) -> float:
    (ax0, ay0), (ax1, ay1) = first
    dir_x, dir_y = ax1 - ax0, ay1 - ay0
    length = math.hypot(dir_x, dir_y)
    if length < 1e-6:
        return 0.0
    unit = (dir_x / length, dir_y / length)

    def project(point):
        return point[0] * unit[0] + point[1] * unit[1]

    a0, a1 = sorted((project((ax0, ay0)), project((ax1, ay1))))
    b0, b1 = sorted((project(second[0]), project(second[1])))
    overlap = max(0.0, min(a1, b1) - max(a0, b0))
    shorter = min(length, math.hypot(second[1][0] - second[0][0], second[1][1] - second[0][1]))
    return overlap / shorter if shorter > 1e-6 else 0.0


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------


def _fmt_list(records: Sequence[tuple[float, float]]) -> tuple[float, float]:
    return _mean([r[0] for r in records]), _mean([r[1] for r in records])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)
    settings = Settings(_env_file=None)
    tolerance = args.tolerance
    step = max(2.0, tolerance / 2.0)
    seeds = [args.seed + index for index in range(args.seeds)]
    plans = [generate_plan(seed) for seed in seeds]

    baseline_path = output_dir / "baseline_entities.json"
    if baseline_path.exists():
        mismatches, compared = regression_check(baseline_path, seeds, settings)
        print(f"REGRESION preprocess=False: {compared - mismatches}/{compared} identicos "
              f"({mismatches} discrepancias)")

    for preprocess in (False, True):
        tag = "preprocess=True" if preprocess else "preprocess=False"
        print(f"\n##### {tag}")
        p, r = _fmt_list(measure_clean(plans, settings, preprocess, tolerance, step))
        print(f"- LIMPIO: P={p:.3f} R={r:.3f}")
        seconds = measure_timing(plans, settings, preprocess, tolerance, step)
        print(f"- TIEMPO/imagen: {seconds*1000:.1f} ms")
        duplicates, total = count_duplicates(plans, settings, preprocess, tolerance, step)
        print(f"- MUROS: {total} segmentos, {duplicates} pares duplicados")

    print("\n### Gradiente (R false | R true)")
    grad_false = measure_gradient(plans, settings, False, tolerance, step)
    grad_true = measure_gradient(plans, settings, True, tolerance, step)
    for (intensity, records_false), (_, records_true) in zip(grad_false, grad_true):
        _, r_false = _fmt_list(records_false)
        _, r_true = _fmt_list(records_true)
        print(f"| {intensity:.2f} | {r_false:.3f} | {r_true:.3f} |")

    print("\n### Sombra (R false | R true)")
    shadow_false = measure_shadow(plans, settings, False, tolerance, step)
    shadow_true = measure_shadow(plans, settings, True, tolerance, step)
    for (strength, records_false), (_, records_true) in zip(shadow_false, shadow_true):
        _, r_false = _fmt_list(records_false)
        _, r_true = _fmt_list(records_true)
        print(f"| {strength:.1f} | {r_false:.3f} | {r_true:.3f} |")

    print("\n### Rotación (P/R false | P/R true)")
    rot_false = measure_rotation(plans, settings, False, tolerance, step)
    rot_true = measure_rotation(plans, settings, True, tolerance, step)
    for (angle, records_false), (_, records_true) in zip(rot_false, rot_true):
        p_false, r_false = _fmt_list(records_false)
        p_true, r_true = _fmt_list(records_true)
        print(f"| {angle} | {p_false:.3f} | {r_false:.3f} | {p_true:.3f} | {r_true:.3f} |")

    print("\n### Cizalla (R false | R true)")
    shear_false = measure_shear(plans, settings, False, tolerance, step)
    shear_true = measure_shear(plans, settings, True, tolerance, step)
    for (value, records_false), (_, records_true) in zip(shear_false, shear_true):
        _, r_false = _fmt_list(records_false)
        _, r_true = _fmt_list(records_true)
        print(f"| {value:.2f} | {r_false:.3f} | {r_true:.3f} |")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
