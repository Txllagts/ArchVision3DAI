"""Medición de P2b: estimación/corrección de inclinación antes de detectar muros.

Uso::

    python -m tools.measure_p2b --seeds 10

Solo lee; no modifica ``app``. Artefactos en ``tools/_output/p2b``.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np
from PIL import Image, ImageDraw

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import plan_preprocess as pp
from app.services.floorplan import InvalidFloorplanError, analyze_floorplan
from app.settings import Settings
from tools.evaluate_floorplan import (
    _entity_segments,
    _png_bytes,
    _wall_metrics,
    _wall_runs,
)
from tools.synthetic_plans import (
    Opening,
    SyntheticPlan,
    Wall,
    generate_plan,
    rotate_plan,
    shear_plan,
)

DEFAULT_SEED = 20260101
DEFAULT_SEEDS = 10
DEFAULT_TOLERANCE = 6.0
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "_output" / "p2b"
ROTATION_ANGLES = list(range(0, 46, 5))
SHEAR_VALUES = [0.0, 0.06, 0.12, 0.18, 0.24, 0.30]


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _analyze(plan, settings, preprocess, deskew):
    try:
        return analyze_floorplan(
            f"{plan.name}.png", _png_bytes(plan.image), settings,
            preprocess=preprocess, deskew=deskew,
        )
    except InvalidFloorplanError:
        return None


def _measure(plan, settings, preprocess, deskew, tolerance, step):
    ground_truth = _wall_runs(plan)
    result = _analyze(plan, settings, preprocess, deskew)
    if result is None:
        return 0.0, 0.0, None
    detected = [
        seg for e in result["entities"]
        if e.get("role") == "wall_candidate"
        for seg in _entity_segments(e)
    ]
    precision, recall, _ = _wall_metrics(ground_truth, detected, tolerance, step)
    return precision, recall, result


def _non_orthogonal_plan() -> SyntheticPlan:
    """Paralelogramo con lados a 30° y 60° (no ortogonal) y su GT."""

    width, height = 900, 700
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    length_a, length_b = 320, 200
    a1, a2 = math.radians(30), math.radians(60)
    ax = (width - (length_a * math.cos(a1) + length_b * math.cos(a2))) / 2
    ay = (height - (length_a * math.sin(a1) + length_b * math.sin(a2))) / 2
    a = (ax, ay)
    b = (a[0] + length_a * math.cos(a1), a[1] + length_a * math.sin(a1))
    c = (b[0] + length_b * math.cos(a2), b[1] + length_b * math.sin(a2))
    d = (a[0] + length_b * math.cos(a2), a[1] + length_b * math.sin(a2))
    for p, q in ((a, b), (b, c), (c, d), (d, a)):
        draw.line([p, q], fill=(35, 35, 35), width=16)
    walls = [
        Wall(index=i, start=p, end=q, thickness=16.0, external=True)
        for i, (p, q) in enumerate(((a, b), (b, c), (c, d), (d, a)))
    ]
    return SyntheticPlan(
        name="non_orthogonal", image=image, width=width, height=height,
        walls=walls, openings=[],
    )


def _blank() -> Image.Image:
    return Image.new("RGB", (800, 600), "white")


def _noise() -> Image.Image:
    rng = np.random.default_rng(0)
    return Image.fromarray(rng.integers(0, 256, (600, 800, 3), dtype=np.uint8), "RGB")


def _gray(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)


def _estimator_accuracy(plans) -> None:
    angles = [0, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 100]

    def norm90(a):
        m = a % 90.0
        return m - 90.0 if m >= 45.0 else m

    for name, fn in (("gradient", pp._estimate_skew_gradient), ("hough", pp._estimate_skew_hough)):
        errors = []
        for base in plans:
            for angle in angles:
                rotated = rotate_plan(base, angle)
                est, conf = fn(_gray(rotated.image))
                diff = (est - norm90(angle) + 45.0) % 90.0 - 45.0
                errors.append(abs(diff))
        print(f"estimador {name:9s}: error medio={_mean(errors):.2f}° max={max(errors):.2f}°")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    Path(args.out).mkdir(parents=True, exist_ok=True)

    settings = Settings(_env_file=None)
    tolerance = args.tolerance
    step = max(2.0, tolerance / 2.0)
    seeds = [args.seed + i for i in range(args.seeds)]
    plans = [generate_plan(s) for s in seeds]

    _estimator_accuracy(plans)

    # (a) rotación
    print("\n### (a) Rotación: P/R con deskew=False | deskew=True (n=10)")
    for angle in ROTATION_ANGLES:
        pf, rf = [], []
        pt, rt = [], []
        for plan in plans:
            rotated = rotate_plan(plan, angle)
            p, r, _ = _measure(rotated, settings, False, False, tolerance, step)
            pf.append(p); rf.append(r)
            p, r, _ = _measure(rotated, settings, False, True, tolerance, step)
            pt.append(p); rt.append(r)
        print(f"| {angle} | {_mean(pf):.3f} | {_mean(rf):.3f} | {_mean(pt):.3f} | {_mean(rt):.3f} |")

    # (b) limpio: entidades identicas con/sin deskew
    identical = 0
    for plan in plans:
        a = _analyze(plan, settings, False, False)
        b = _analyze(plan, settings, False, True)
        if a is not None and b is not None and a["entities"] == b["entities"]:
            identical += 1
    print(f"\n### (b) Limpio 0°: entidades idénticas deskew True/False = {identical}/{len(plans)}")

    # (c) no ortogonal
    print("\n### (c) Plano no ortogonal (30/60)")
    non_ortho = _non_orthogonal_plan()
    for deskew in (False, True):
        p, r, res = _measure(non_ortho, settings, False, deskew, tolerance, step)
        angle, conf = pp.estimate_skew(non_ortho.image)
        print(f"| deskew={deskew} | est={angle:.2f}° conf={conf:.2f} | P={p:.3f} R={r:.3f} |")

    # (d) cizalla
    print("\n### (d) Cizalla: R(deskew=False) | R(deskew=True)")
    for value in SHEAR_VALUES:
        rf, rt = [], []
        for plan in plans:
            sheared = shear_plan(plan, value)
            rf.append(_measure(sheared, settings, False, False, tolerance, step)[1])
            rt.append(_measure(sheared, settings, False, True, tolerance, step)[1])
        print(f"| {value:.2f} | {_mean(rf):.3f} | {_mean(rt):.3f} |")

    # (e) tiempo y tamaño de lienzo
    start = time.perf_counter()
    for plan in plans:
        _measure(plan, settings, False, False, tolerance, step)
    base = (time.perf_counter() - start) / len(plans)
    start = time.perf_counter()
    sizes = []
    for plan in plans:
        rotated = rotate_plan(plan, 20)
        angle, conf = pp.estimate_skew(rotated.image)
        _, m = pp.rotate_with_matrix(rotated.image, angle)
        sizes.append((rotated.width, rotated.height))
        _measure(rotated, settings, False, True, tolerance, step)
    with_desk = (time.perf_counter() - start) / len(plans)
    print(f"\n### (e) Tiempo: base={base*1000:.1f} ms  con deskew+rot20={with_desk*1000:.1f} ms")
    print(f"lienzo rotado máx (entrada 20°): {sizes[0]}")

    # (f) ida y vuelta de un punto y no-rotación de blanco/ruido
    p0 = (123.0, 456.0)
    _, matrix = pp.rotate_with_matrix(generate_plan(1).image, 17.0)
    rotated_point = matrix @ np.array([p0[0], p0[1], 1.0])
    inverse = cv2.invertAffineTransform(matrix)
    back = inverse @ np.array([rotated_point[0], rotated_point[1], 1.0])
    error = math.hypot(back[0] - p0[0], back[1] - p0[1])
    print(f"\n### (f) ida y vuelta: error={error:.3f} px")
    for name, image in (("blanco", _blank()), ("ruido", _noise())):
        est, conf = pp.estimate_skew(image)
        print(f"| {name}: est={est:.2f}° conf={conf:.2f} |")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
