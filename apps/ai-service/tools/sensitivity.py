"""Curvas de sensibilidad de ``_raster_geometry``.

Barridos controlados sobre planos sintéticos:

* Rotación: 0..45° en pasos de 5°, solo rotación.
* Cizalla: 0..0.3 en 6 pasos, solo cizalla.
* Iluminación: gradiente lineal creciente hasta que el papel más oscuro cruce
  el umbral de Otsu del plano limpio; más una "sombra de mano" localizada.

Genera tablas markdown por consola, una hoja de contacto en alta resolución
(mínimo 2400 px de ancho) y 3 ``overlay.png`` de los ángulos con peor recall.

Uso::

    python -m tools.sensitivity --seed 20260101 --seeds 3

El directorio de salida (por defecto ``tools/_output/sensitivity``) está
ignorado por git. No modifica nada de ``app``.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np
from PIL import Image, ImageDraw

# Permite ``python tools/sensitivity.py ...`` además de ``-m``.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.floorplan import analyze_floorplan, InvalidFloorplanError
from app.settings import Settings
from tools.evaluate_floorplan import (
    _png_bytes,
    _wall_metrics,
    _wall_runs,
    _wall_segments,
)
from tools.run_local import build_overlay
from tools.synthetic_plans import (
    SyntheticPlan,
    generate_plan,
    illuminate_plan,
    plan_ground_truth,
    rotate_plan,
    shear_plan,
)

DEFAULT_SEED = 20260101
DEFAULT_SEEDS = 3
DEFAULT_TOLERANCE = 6.0
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "_output" / "sensitivity"

ROTATION_ANGLES = list(range(0, 46, 5))  # 0, 5, ..., 45
SHEAR_VALUES = [0.0, 0.06, 0.12, 0.18, 0.24, 0.30]
ILLUMINATION_INTENSITIES = [round(0.05 * index, 2) for index in range(19)]  # 0..0.90
SHADOW_STRENGTHS = [0.2, 0.4, 0.6, 0.8]
CONTACT_COLUMNS = 5
CONTACT_CELL = (480, 360)  # 5 * 480 = 2400 px de ancho


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def _evaluate(
    plan: SyntheticPlan,
    tolerance: float,
    step: float,
    settings: Settings,
) -> tuple[float, float, float, dict[str, Any] | None, list[tuple[tuple[float, float], tuple[float, float]]]]:
    """Corre el análisis sobre un plano y devuelve métricas + resultado."""

    ground_truth = _wall_runs(plan)
    data = _png_bytes(plan.image)
    try:
        result = analyze_floorplan(f"{plan.name}.png", data, settings)
        entities = list(result.get("entities", []))
    except InvalidFloorplanError:
        return 0.0, 0.0, 0.0, None, []
    detected = _wall_segments(entities, "wall_candidate")
    precision, recall, f1 = _wall_metrics(ground_truth, detected, tolerance, step)
    return precision, recall, f1, result, detected


def _mean_std(values: Sequence[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return mean_value, math.sqrt(variance) if len(values) > 1 else 0.0


def _fmt(value: float | None, digits: int = 3) -> str:
    return "n/d" if value is None else f"{value:.{digits}f}"


def _otsu_threshold(plan: SyntheticPlan) -> float:
    """Umbral de Otsu del plano limpio (mismo criterio de ``_raster_geometry``)."""

    gray = np.asarray(plan.image.convert("L"), dtype=np.uint8)
    threshold, _ = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
    )
    return float(threshold)


def _layout_signature(plan: SyntheticPlan) -> tuple[int, int]:
    """Reconstruye (columnas, filas) a partir de los muros axis-alineados."""

    vertical_x = sorted(
        {
            round(wall.start[0], 1)
            for wall in plan.walls
            if abs(wall.start[0] - wall.end[0]) < 1e-6
        }
    )
    horizontal_y = sorted(
        {
            round(wall.start[1], 1)
            for wall in plan.walls
            if abs(wall.start[1] - wall.end[1]) < 1e-6
        }
    )
    return max(0, len(vertical_x) - 1), max(0, len(horizontal_y) - 1)


# ---------------------------------------------------------------------------
# Barridos
# ---------------------------------------------------------------------------


def _sweep_rotation(
    plans: Sequence[SyntheticPlan],
    angles: Sequence[float],
    tolerance: float,
    step: float,
    settings: Settings,
) -> tuple[
    dict[float, list[tuple[float, float, float]]],
    dict[float, tuple[SyntheticPlan, dict[str, Any] | None]],
]:
    """Barrido de rotación. Devuelve métricas por ángulo y casos del 1er seed."""

    per_angle: dict[float, list[tuple[float, float, float]]] = {angle: [] for angle in angles}
    first_seed_cases: dict[float, tuple[SyntheticPlan, dict[str, Any] | None]] = {}
    for index, plan in enumerate(plans):
        for angle in angles:
            rotated = rotate_plan(plan, angle)
            precision, recall, f1, result, _ = _evaluate(
                rotated, tolerance, step, settings
            )
            per_angle[angle].append((precision, recall, f1))
            if index == 0:
                first_seed_cases[angle] = (rotated, result)
    return per_angle, first_seed_cases


def _sweep_shear(
    plans: Sequence[SyntheticPlan],
    values: Sequence[float],
    tolerance: float,
    step: float,
    settings: Settings,
) -> dict[float, list[tuple[float, float, float]]]:
    per_value: dict[float, list[tuple[float, float, float]]] = {value: [] for value in values}
    for plan in plans:
        for value in values:
            sheared = shear_plan(plan, value)
            precision, recall, f1, _, _ = _evaluate(sheared, tolerance, step, settings)
            per_value[value].append((precision, recall, f1))
    return per_value


def _sweep_illumination(
    plans: Sequence[SyntheticPlan],
    intensities: Sequence[float],
    otsu_threshold: float,
    tolerance: float,
    step: float,
    settings: Settings,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for intensity in intensities:
        precisions: list[float] = []
        recalls: list[float] = []
        f1s: list[float] = []
        wall_counts: list[int] = []
        for plan in plans:
            illuminated = illuminate_plan(plan, intensity)
            precision, recall, f1, result, detected = _evaluate(
                illuminated, tolerance, step, settings
            )
            precisions.append(precision)
            recalls.append(recall)
            f1s.append(f1)
            wall_counts.append(
                len(result["entities"]) if result is not None else 0
            )
        darkest_paper = 255.0 * (1.0 - intensity)
        rows.append(
            {
                "intensity": intensity,
                "darkest_paper": darkest_paper,
                "below_otsu": darkest_paper < otsu_threshold,
                "precision": _mean_std(precisions),
                "recall": _mean_std(recalls),
                "f1": _mean_std(f1s),
                "walls_mean": sum(wall_counts) / len(wall_counts),
            }
        )
    return rows


def _sweep_shadow(
    plans: Sequence[SyntheticPlan],
    strengths: Sequence[float],
    tolerance: float,
    step: float,
    settings: Settings,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for strength in strengths:
        precisions: list[float] = []
        recalls: list[float] = []
        f1s: list[float] = []
        wall_counts: list[int] = []
        for plan in plans:
            rng = random.Random(0)  # banda fija para reproducibilidad
            shadowed = illuminate_plan(plan, 0.0, shadow=strength, rng=rng)
            precision, recall, f1, result, detected = _evaluate(
                shadowed, tolerance, step, settings
            )
            precisions.append(precision)
            recalls.append(recall)
            f1s.append(f1)
            wall_counts.append(len(result["entities"]) if result is not None else 0)
        rows.append(
            {
                "strength": strength,
                "precision": _mean_std(precisions),
                "recall": _mean_std(recalls),
                "f1": _mean_std(f1s),
                "walls_mean": sum(wall_counts) / len(wall_counts),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Tablas
# ---------------------------------------------------------------------------


def _render_rotation_table(per_angle: dict[float, list[tuple[float, float, float]]]) -> str:
    lines = ["| Ángulo (°) | Muros P | Muros R | Muros F1 |", "| --- | ---: | ---: | ---: |"]
    for angle in sorted(per_angle):
        records = per_angle[angle]
        p, p_std = _mean_std([r[0] for r in records])
        r, r_std = _mean_std([r[1] for r in records])
        f1, f1_std = _mean_std([r[2] for r in records])
        lines.append(
            f"| {angle} | {p:.3f} ± {p_std:.3f} | {r:.3f} ± {r_std:.3f} | "
            f"{f1:.3f} ± {f1_std:.3f} |"
        )
    return "\n".join(lines)


def _render_shear_table(per_value: dict[float, list[tuple[float, float, float]]]) -> str:
    lines = ["| Cizalla | Muros P | Muros R | Muros F1 |", "| --- | ---: | ---: | ---: |"]
    for value in sorted(per_value):
        records = per_value[value]
        p, p_std = _mean_std([r[0] for r in records])
        r, r_std = _mean_std([r[1] for r in records])
        f1, f1_std = _mean_std([r[2] for r in records])
        lines.append(
            f"| {value:.2f} | {p:.3f} ± {p_std:.3f} | {r:.3f} ± {r_std:.3f} | "
            f"{f1:.3f} ± {f1_std:.3f} |"
        )
    return "\n".join(lines)


def _render_illumination_table(rows: Sequence[dict[str, Any]]) -> str:
    lines = [
        "| Intensidad | Papel más oscuro | Bajo Otsu | Muros P | Muros R | Muros F1 | n muros |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        p, p_std = row["precision"]
        r, r_std = row["recall"]
        f1, f1_std = row["f1"]
        lines.append(
            f"| {row['intensity']:.2f} | {row['darkest_paper']:.0f} | "
            f"{'sí' if row['below_otsu'] else 'no'} | "
            f"{p:.3f} ± {p_std:.3f} | {r:.3f} ± {r_std:.3f} | "
            f"{f1:.3f} ± {f1_std:.3f} | {row['walls_mean']:.1f} |"
        )
    return "\n".join(lines)


def _render_shadow_table(rows: Sequence[dict[str, Any]]) -> str:
    lines = [
        "| Sombra (fuerza) | Muros P | Muros R | Muros F1 | n muros |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        p, p_std = row["precision"]
        r, r_std = row["recall"]
        f1, f1_std = row["f1"]
        lines.append(
            f"| {row['strength']:.1f} | {p:.3f} ± {p_std:.3f} | "
            f"{r:.3f} ± {r_std:.3f} | {f1:.3f} ± {f1_std:.3f} | "
            f"{row['walls_mean']:.1f} |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Overlays y hoja de contacto
# ---------------------------------------------------------------------------


def _save_overlay(
    plan: SyntheticPlan,
    result: dict[str, Any] | None,
    output_dir: Path,
    label: str,
) -> Image.Image | None:
    """Guarda el overlay de detección de un caso (reutiliza ``run_local``)."""

    if result is None:
        # El análisis no detectó muros: overlay vacío (solo GT + discrepancias).
        result = {
            "entities": [],
            "source": {"image_size": {"width": plan.width, "height": plan.height}},
        }
    image_path = output_dir / f"{label}.png"
    plan.image.save(image_path)
    (output_dir / f"{label}.ground_truth.json").write_text(
        json.dumps(plan_ground_truth(plan), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    overlay = build_overlay(image_path, result)
    if overlay is not None:
        overlay.save(output_dir / f"{label}.overlay.png")
    return overlay


def _tile_contact_sheet(
    images: Sequence[Image.Image],
    labels: Sequence[str],
    columns: int,
    cell_size: tuple[int, int],
) -> Image.Image:
    cell_width, cell_height = cell_size
    rows = math.ceil(len(images) / columns)
    canvas = Image.new("RGB", (columns * cell_width, rows * cell_height), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (image, label) in enumerate(zip(images, labels)):
        row, col = divmod(index, columns)
        thumbnail = image.copy()
        thumbnail.thumbnail((cell_width - 10, cell_height - 10))
        left = col * cell_width + (cell_width - thumbnail.width) // 2
        top = row * cell_height + (cell_height - thumbnail.height) // 2
        canvas.paste(thumbnail, (left, top))
        draw.text((col * cell_width + 5, row * cell_height + 5), label, fill=(255, 0, 0))
    return canvas


def _build_rotation_visuals(
    cases: dict[float, tuple[SyntheticPlan, dict[str, Any] | None]],
    per_angle: dict[float, list[tuple[float, float, float]]],
    output_dir: Path,
) -> None:
    """Hoja de contacto (≥2400 px) y 3 overlays de los peores ángulos."""

    overlays: list[Image.Image] = []
    labels: list[str] = []
    for angle in sorted(cases):
        plan, result = cases[angle]
        overlay = _save_overlay(plan, result, output_dir, f"rot_{angle:02d}")
        if overlay is not None:
            overlays.append(overlay)
            labels.append(f"{angle}°")

    if overlays:
        sheet = _tile_contact_sheet(overlays, labels, CONTACT_COLUMNS, CONTACT_CELL)
        sheet.save(output_dir / "contact_sheet_rotation.png")

    # 3 peores ángulos por recall (media sobre semillas).
    ranked = sorted(
        per_angle,
        key=lambda angle: _mean_std([record[1] for record in per_angle[angle]])[0],
    )
    for angle in ranked[:3]:
        plan, result = cases.get(angle, (None, None))  # type: ignore[assignment]
        if plan is not None:
            _save_overlay(plan, result, output_dir, f"worst_recall_{angle:02d}")


# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------


def _report_layouts(plans: Sequence[SyntheticPlan], seeds: Sequence[int]) -> None:
    print("### Layouts por semilla")
    signatures = []
    for seed, plan in zip(seeds, plans):
        cols, rows = _layout_signature(plan)
        doors = sum(1 for opening in plan.openings if opening.kind == "door")
        windows = sum(1 for opening in plan.openings if opening.kind == "window")
        signatures.append((cols, rows))
        print(
            f"- semilla {seed}: {cols}x{rows} habitaciones, {len(plan.walls)} muros, "
            f"{doors} puertas, {windows} ventanas"
        )
    same = all(signature == signatures[0] for signature in signatures)
    print(
        f"- ¿layouts distintos? {'no, son el mismo' if same else 'sí, difieren'}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Semilla base.")
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS, help="Número de semillas.")
    parser.add_argument(
        "--tolerance", type=float, default=DEFAULT_TOLERANCE, help="Tolerancia en px."
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT, help="Carpeta de salida.")
    args = parser.parse_args(argv)

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)

    settings = Settings(_env_file=None)
    tolerance = args.tolerance
    step = max(2.0, tolerance / 2.0)
    seeds = [args.seed + index for index in range(args.seeds)]
    plans = [generate_plan(seed) for seed in seeds]

    _report_layouts(plans, seeds)

    otsu = _otsu_threshold(plans[0])
    print(f"\nUmbral de Otsu del plano limpio: {otsu:.1f}")

    print("\n### Barrido de rotación (0..45°, paso 5°)")
    per_angle, rotation_cases = _sweep_rotation(
        plans, ROTATION_ANGLES, tolerance, step, settings
    )
    print(_render_rotation_table(per_angle))

    print("\n### Barrido de cizalla (0..0.3, 6 pasos)")
    per_shear = _sweep_shear(plans, SHEAR_VALUES, tolerance, step, settings)
    print(_render_shear_table(per_shear))

    print("\n### Barrido de iluminación (gradiente lineal)")
    illumination_rows = _sweep_illumination(
        plans, ILLUMINATION_INTENSITIES, otsu, tolerance, step, settings
    )
    print(_render_illumination_table(illumination_rows))

    print("\n### Sombra de mano (banda oscura localizada)")
    shadow_rows = _sweep_shadow(plans, SHADOW_STRENGTHS, tolerance, step, settings)
    print(_render_shadow_table(shadow_rows))

    _build_rotation_visuals(rotation_cases, per_angle, output_dir)
    print(f"\nArtefactos: {output_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
