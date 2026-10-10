"""Evalúa ``_raster_geometry`` sobre planos sintéticos degradados.

Corre ``analyze_floorplan`` sobre N planos en tres niveles de degradación y
publica una tabla markdown con precisión/recall de muros (tolerancia en px),
recall de puertas y ventanas, y segundos por imagen.

Se ejecuta como módulo desde ``apps/ai-service``::

    python -m tools.evaluate_floorplan --count 5

El directorio de salida (por defecto ``tools/_output``) está ignorado por git.
Este script no modifica nada de ``app``: solo lo invoca.
"""

from __future__ import annotations

import argparse
import io
import math
import random
import sys
import time
from pathlib import Path
from statistics import mean
from typing import Any, Iterable, Sequence

from PIL import Image

# Permite ``python tools/evaluate_floorplan.py`` además de ``-m``.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.floorplan import analyze_floorplan, InvalidFloorplanError
from app.settings import Settings
from tools.synthetic_plans import (
    SyntheticPlan,
    degrade_plan,
    generate_dataset,
)

Point = tuple[float, float]
Segment = tuple[Point, Point]

# Tres niveles pedidos: leve, medio y fuerte. El "limpio" no es un nivel de
# degradación; sirve de referencia de techo y se calcula aparte.
DEGRADATION_LEVELS: tuple[tuple[str, float], ...] = (
    ("leve", 0.35),
    ("medio", 0.70),
    ("fuerte", 1.00),
)
CLEAN_LEVEL: tuple[str, float] = ("limpio", 0.0)
DEFAULT_TOLERANCE = 6.0
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "_output"


# ---------------------------------------------------------------------------
# Métricas geométricas
# ---------------------------------------------------------------------------


def _point_segment_distance(point: Point, start: Point, end: Point) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-9:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _min_distance_to_points(point: Point, segments: Sequence[Segment]) -> float:
    if not segments:
        return math.inf
    return min(_point_segment_distance(point, a, b) for a, b in segments)


def _sample_segment(segment: Segment, step: float) -> list[Point]:
    (x0, y0), (x1, y1) = segment
    length = math.hypot(x1 - x0, y1 - y0)
    count = max(1, int(math.ceil(length / step)))
    return [
        (x0 + (x1 - x0) * index / count, y0 + (y1 - y0) * index / count)
        for index in range(count + 1)
    ]


def _entity_segments(entity: dict[str, Any]) -> list[Segment]:
    points = [(float(p[0]), float(p[1])) for p in entity.get("points", [])]
    segments: list[Segment] = list(zip(points, points[1:]))
    if entity.get("closed") and len(points) > 2:
        segments.append((points[-1], points[0]))
    return segments


def _wall_segments(entities: Iterable[dict[str, Any]], role: str) -> list[Segment]:
    return [
        segment
        for entity in entities
        if entity.get("role") == role
        for segment in _entity_segments(entity)
    ]


def _wall_runs(plan: SyntheticPlan) -> list[Segment]:
    """Muros reales: la línea central recortada por los huecos de abertura.

    En un plano, una puerta o ventana es un hueco: ahí no hay muro. Comparar el
    recall contra la línea completa (incluyendo el hueco) castigaría al detector
    por acertar al no dibujar muro en la abertura.
    """

    openings_by_wall: dict[int, list[tuple[float, float]]] = {}
    for opening in plan.openings:
        openings_by_wall.setdefault(opening.wall_index, []).append(
            (opening.offset, opening.offset + opening.width)
        )

    runs: list[Segment] = []
    for wall in plan.walls:
        cursor = 0.0
        for gap_start, gap_end in sorted(openings_by_wall.get(wall.index, [])):
            if gap_start - cursor > 1.0:
                runs.append((wall.point_at(cursor), wall.point_at(gap_start)))
            cursor = max(cursor, gap_end)
        if wall.length - cursor > 1.0:
            runs.append((wall.point_at(cursor), wall.point_at(wall.length)))
    return runs


def _wall_metrics(
    ground_truth: Sequence[Segment],
    detected: Sequence[Segment],
    tolerance: float,
    step: float,
) -> tuple[float, float, float]:
    """Precisión, recall y F1 de muros por cobertura de puntos.

    Se mide cobertura (no identidad 1-a-1) porque el detector parte y fusiona
    segmentos; cada punto de un muro se considera cubierto si cae a menos de
    ``tolerance`` px de algún segmento detectado, y viceversa para precisión.
    """

    if not ground_truth and not detected:
        return 1.0, 1.0, 1.0

    recall = 0.0
    if ground_truth:
        total = covered = 0
        for segment in ground_truth:
            for point in _sample_segment(segment, step):
                total += 1
                if _min_distance_to_points(point, detected) <= tolerance:
                    covered += 1
        recall = covered / total if total else 0.0

    precision = 0.0
    if detected:
        total = covered = 0
        for segment in detected:
            for point in _sample_segment(segment, step):
                total += 1
                if _min_distance_to_points(point, ground_truth) <= tolerance:
                    covered += 1
        precision = covered / total if total else 0.0

    if precision + recall <= 0.0:
        f1 = 0.0
    else:
        f1 = 2 * precision * recall / (precision + recall)
    return precision, recall, f1


def _opening_recall(
    plan: SyntheticPlan,
    detected_openings: Sequence[Segment],
    tolerance: float,
    kind: str,
) -> tuple[float | None, int, int]:
    """Recall de aberturas: centro del GT a menos de ``tolerance`` de un candidato."""

    total = matched = 0
    for opening in plan.openings:
        if opening.kind != kind:
            continue
        total += 1
        center = (
            (opening.start[0] + opening.end[0]) / 2,
            (opening.start[1] + opening.end[1]) / 2,
        )
        if _min_distance_to_points(center, detected_openings) <= tolerance:
            matched += 1
    if total == 0:
        return None, 0, 0
    return matched / total, matched, total


def _gap_preserved(
    plan: SyntheticPlan, detected: Sequence[Segment], tolerance: float
) -> tuple[float | None, int, int]:
    """Fracción de huecos respetados por los muros detectados.

    Extra: el raster no clasifica puertas/ventanas, pero sí podemos medir si
    la detección deja un hueco donde hay una abertura (no la puentea). Solo se
    consideran aberturas cuyo muro anfitrión fue detectado en algún extremo,
    para no contar como "respetado" un plano sin detección.
    """

    if not detected:
        return None, 0, 0
    walls = {wall.index: wall for wall in plan.walls}
    considered = preserved = 0
    for opening in plan.openings:
        wall = walls[opening.wall_index]
        host_detected = min(
            _min_distance_to_points(wall.start, detected),
            _min_distance_to_points(wall.end, detected),
        ) <= tolerance
        if not host_detected:
            continue
        considered += 1
        center = (
            (opening.start[0] + opening.end[0]) / 2,
            (opening.start[1] + opening.end[1]) / 2,
        )
        if _min_distance_to_points(center, detected) > tolerance:
            preserved += 1
    if considered == 0:
        return None, 0, 0
    return preserved / considered, preserved, considered


# ---------------------------------------------------------------------------
# Ejecución
# ---------------------------------------------------------------------------


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _evaluate_variant(
    plan: SyntheticPlan,
    strength: float,
    seed: int,
    index: int,
    tolerance: float,
    settings: Settings,
    step: float,
) -> dict[str, Any]:
    if strength <= 0.0:
        degraded = plan
    else:
        rng = random.Random(seed * 100_003 + index * 17 + int(round(strength * 100)))
        degraded = degrade_plan(plan, rng, strength)

    gt_walls = _wall_runs(degraded)

    data = _png_bytes(degraded.image)
    start = time.perf_counter()
    error: str | None = None
    entities: list[dict[str, Any]] = []
    try:
        result = analyze_floorplan(f"{degraded.name}.png", data, settings)
        entities = list(result.get("entities", []))
    except InvalidFloorplanError as exc:
        error = type(exc).__name__
    except Exception as exc:  # pragma: no cover - salvaguarda de la medición
        error = type(exc).__name__
    elapsed = time.perf_counter() - start

    detected_walls = _wall_segments(entities, "wall_candidate")
    detected_doors = _wall_segments(entities, "door_candidate")
    detected_windows = _wall_segments(entities, "window_candidate")

    precision, recall, f1 = _wall_metrics(gt_walls, detected_walls, tolerance, step)
    door_recall, _, _ = _opening_recall(degraded, detected_doors, tolerance, "door")
    window_recall, _, _ = _opening_recall(
        degraded, detected_windows, tolerance, "window"
    )
    gap_recall, _, _ = _gap_preserved(degraded, detected_walls, tolerance)

    return {
        "wall_precision": precision,
        "wall_recall": recall,
        "wall_f1": f1,
        "door_recall": door_recall,
        "window_recall": window_recall,
        "gap_recall": gap_recall,
        "seconds": elapsed,
        "error": error,
        "detected_walls": len(detected_walls),
    }


def _aggregate(records: Sequence[dict[str, Any]]) -> dict[str, Any]:
    def _mean(key: str) -> float | None:
        values = [record[key] for record in records if record[key] is not None]
        return mean(values) if values else None

    return {
        "wall_precision": _mean("wall_precision") or 0.0,
        "wall_recall": _mean("wall_recall") or 0.0,
        "wall_f1": _mean("wall_f1") or 0.0,
        "door_recall": _mean("door_recall"),
        "window_recall": _mean("window_recall"),
        "gap_recall": _mean("gap_recall"),
        "seconds": _mean("seconds") or 0.0,
        "failures": sum(1 for record in records if record["error"]),
        "count": len(records),
    }


def _format(value: float | None) -> str:
    return "n/d" if value is None else f"{value:.3f}"


def _render_table(rows: Sequence[tuple[str, dict[str, Any]]]) -> str:
    header = (
        "| Nivel | Muros P | Muros R | Muros F1 | Puertas R | Ventanas R | "
        "Huecos R* | s/imagen | Fallos |"
    )
    separator = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    lines = [header, separator]
    for name, aggregate in rows:
        lines.append(
            "| {name} | {p} | {r} | {f1} | {door} | {window} | {gap} | {sec} | "
            "{fail} |".format(
                name=name,
                p=_format(aggregate["wall_precision"]),
                r=_format(aggregate["wall_recall"]),
                f1=_format(aggregate["wall_f1"]),
                door=_format(aggregate["door_recall"]),
                window=_format(aggregate["window_recall"]),
                gap=_format(aggregate["gap_recall"]),
                sec=_format(aggregate["seconds"]),
                fail=f"{aggregate['failures']}/{aggregate['count']}",
            )
        )
    return "\n".join(lines)


def evaluate(
    count: int,
    output_dir: Path,
    tolerance: float,
    seed: int,
    include_clean: bool,
) -> list[tuple[str, dict[str, Any]]]:
    plans = generate_dataset(count, output_dir, base_seed=seed)
    settings = Settings(_env_file=None)
    step = max(2.0, tolerance / 2.0)

    levels = list(DEGRADATION_LEVELS)
    if include_clean:
        levels = [CLEAN_LEVEL, *levels]

    results: list[tuple[str, dict[str, Any]]] = []
    for name, strength in levels:
        records = [
            _evaluate_variant(
                plan, strength, seed, index, tolerance, settings, step
            )
            for index, plan in enumerate(plans)
        ]
        results.append((name, _aggregate(records)))
    return results


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=5, help="Número de planos.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Directorio de salida (ignorado por git).",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=DEFAULT_TOLERANCE,
        help="Tolerancia en px para emparejar muros.",
    )
    parser.add_argument("--seed", type=int, default=20260101, help="Semilla base.")
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Omite la fila de referencia sin degradación.",
    )
    args = parser.parse_args(argv)

    rows = evaluate(
        count=args.count,
        output_dir=args.output,
        tolerance=args.tolerance,
        seed=args.seed,
        include_clean=not args.no_clean,
    )
    print(f"\nPlanos: {args.count} · tolerancia: {args.tolerance} px "
          f"· salida: {args.output}")
    print(_render_table(rows))
    print("\n* Huecos R es una métrica extra: fracción de aberturas cuyo muro")
    print("  anfitrión fue detectado y que quedan sin puentear por un muro.")
    print("  Puertas/Ventanas R mide candidatos con rol door/window; el modo")
    print("  raster hoy no los produce (ver NOTAS).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
