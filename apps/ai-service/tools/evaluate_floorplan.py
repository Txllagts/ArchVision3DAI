"""Evalúa ``_raster_geometry`` sobre planos sintéticos degradados.

Mide (media ± desviación estándar por nivel) precisión/recall de muros, recall
de puertas y ventanas, y segundos por imagen; desglosa las entidades detectadas
por tipo (``line`` / ``polyline``); genera una tabla de ablación de cada
transformación de degradación por separado y una hoja de contacto con el overlay
de ground truth + etiquetas YOLO.

Se ejecuta como módulo desde ``apps/ai-service``::

    python -m tools.evaluate_floorplan --n 40 --seeds 3

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
from statistics import mean, pstdev
from typing import Any, Iterable, Sequence

from PIL import Image

# Permite ``python tools/evaluate_floorplan.py`` además de ``-m``.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.floorplan import analyze_floorplan, InvalidFloorplanError
from app.settings import Settings
from tools.synthetic_plans import (
    GEO_TRANSFORMS,
    PHOTO_TRANSFORMS,
    SyntheticPlan,
    degrade_plan,
    degrade_plan_isolated,
    generate_dataset,
    render_contact_sheet,
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
ABLATION_STRENGTH = 1.0  # intensidad fija para la tabla de ablación
DEFAULT_N = 40
DEFAULT_SEEDS = 3
DEFAULT_TOLERANCE = 6.0
CONTACT_SHEET_PLANS = 12
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "_output"

# Métricas numéricas agregadas con media ± desviación estándar.
METRIC_KEYS: tuple[str, ...] = (
    "wall_precision",
    "wall_recall",
    "wall_f1",
    "line_precision",
    "line_recall",
    "polyline_precision",
    "polyline_recall",
    "door_recall",
    "window_recall",
    "gap_recall",
    "seconds",
)
COUNT_KEYS: tuple[str, ...] = ("line_count", "polyline_count")


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


def _wall_entities_by_type(
    entities: Iterable[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separa las entidades de muro en ``line`` (rectas) y ``polyline`` (curvas)."""

    lines: list[dict[str, Any]] = []
    polylines: list[dict[str, Any]] = []
    for entity in entities:
        if entity.get("role") != "wall_candidate":
            continue
        if entity.get("type") == "polyline":
            polylines.append(entity)
        else:
            lines.append(entity)
    return lines, polylines


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

    NO ES FIABLE como métrica de huecos: premia no detectar (un plano sin
    detección "respeta" todos los huecos). Se conserva solo con fines de
    referencia y se marca como tal en la tabla.
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


def _measure(
    degraded: SyntheticPlan,
    tolerance: float,
    settings: Settings,
    step: float,
) -> dict[str, Any]:
    """Corre ``analyze_floorplan`` sobre un plano degradado y calcula métricas."""

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

    line_entities, polyline_entities = _wall_entities_by_type(entities)
    detected_lines = [seg for entity in line_entities for seg in _entity_segments(entity)]
    detected_polylines = [
        seg for entity in polyline_entities for seg in _entity_segments(entity)
    ]
    detected_walls = detected_lines + detected_polylines
    detected_doors = _wall_segments(entities, "door_candidate")
    detected_windows = _wall_segments(entities, "window_candidate")

    wall_precision, wall_recall, wall_f1 = _wall_metrics(
        gt_walls, detected_walls, tolerance, step
    )
    line_precision, line_recall, _ = _wall_metrics(
        gt_walls, detected_lines, tolerance, step
    )
    polyline_precision, polyline_recall, _ = _wall_metrics(
        gt_walls, detected_polylines, tolerance, step
    )
    door_recall, _, _ = _opening_recall(degraded, detected_doors, tolerance, "door")
    window_recall, _, _ = _opening_recall(
        degraded, detected_windows, tolerance, "window"
    )
    gap_recall, _, _ = _gap_preserved(degraded, detected_walls, tolerance)

    return {
        "wall_precision": wall_precision,
        "wall_recall": wall_recall,
        "wall_f1": wall_f1,
        "line_count": len(line_entities),
        "line_precision": line_precision,
        "line_recall": line_recall,
        "polyline_count": len(polyline_entities),
        "polyline_precision": polyline_precision,
        "polyline_recall": polyline_recall,
        "door_recall": door_recall,
        "window_recall": window_recall,
        "gap_recall": gap_recall,
        "seconds": elapsed,
        "error": error,
    }


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
    return _measure(degraded, tolerance, settings, step)


def _evaluate_isolated(
    plan: SyntheticPlan,
    transform: str,
    strength: float,
    seed: int,
    index: int,
    tolerance: float,
    settings: Settings,
    step: float,
) -> dict[str, Any]:
    """Aplica una única transformación de degradación y mide (ablación)."""

    if strength <= 0.0:
        degraded = plan
    else:
        rng = random.Random(seed * 100_003 + index * 17)
        degraded = degrade_plan_isolated(plan, rng, transform, strength)
    return _measure(degraded, tolerance, settings, step)


def _aggregate(records: Sequence[dict[str, Any]]) -> dict[str, Any]:
    aggregate: dict[str, Any] = {}
    for key in METRIC_KEYS:
        values = [record[key] for record in records if record.get(key) is not None]
        if values:
            aggregate[key] = (mean(values), pstdev(values) if len(values) > 1 else 0.0)
        else:
            aggregate[key] = (None, None)
    for key in COUNT_KEYS:
        values = [record[key] for record in records if record.get(key) is not None]
        aggregate[key] = (mean(values) if values else None, None)
    aggregate["failures"] = sum(1 for record in records if record["error"])
    aggregate["count"] = len(records)
    return aggregate


# ---------------------------------------------------------------------------
# Render de tablas
# ---------------------------------------------------------------------------


def _fmt(aggregate: dict[str, Any], key: str, digits: int = 3) -> str:
    mean_value, std_value = aggregate[key]
    if mean_value is None:
        return "n/d"
    return f"{mean_value:.{digits}f} ± {std_value:.{digits}f}"


def _fmt_count(aggregate: dict[str, Any], key: str) -> str:
    mean_value, _ = aggregate[key]
    return "n/d" if mean_value is None else f"{mean_value:.0f}"


def _render_level_table(rows: Sequence[tuple[str, dict[str, Any]]]) -> str:
    header = (
        "| Nivel | Muros P | Muros R | Muros F1 | Puertas R | Ventanas R | "
        "Huecos R† | s/imagen | Fallos |"
    )
    separator = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    lines = [header, separator]
    for name, aggregate in rows:
        lines.append(
            "| {name} | {p} | {r} | {f1} | {door} | {window} | {gap} | {sec} | "
            "{fail} |".format(
                name=name,
                p=_fmt(aggregate, "wall_precision"),
                r=_fmt(aggregate, "wall_recall"),
                f1=_fmt(aggregate, "wall_f1"),
                door=_fmt(aggregate, "door_recall"),
                window=_fmt(aggregate, "window_recall"),
                gap=_fmt(aggregate, "gap_recall"),
                sec=_fmt(aggregate, "seconds", 2),
                fail=f"{aggregate['failures']}/{aggregate['count']}",
            )
        )
    return "\n".join(lines)


def _render_entity_table(rows: Sequence[tuple[str, dict[str, Any]]]) -> str:
    header = (
        "| Nivel | Línea (n) | Línea P | Línea R | Polilínea (n) | "
        "Polilínea P | Polilínea R |"
    )
    separator = "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
    lines = [header, separator]
    for name, aggregate in rows:
        lines.append(
            "| {name} | {lc} | {lp} | {lr} | {pc} | {pp} | {pr} |".format(
                name=name,
                lc=_fmt_count(aggregate, "line_count"),
                lp=_fmt(aggregate, "line_precision"),
                lr=_fmt(aggregate, "line_recall"),
                pc=_fmt_count(aggregate, "polyline_count"),
                pp=_fmt(aggregate, "polyline_precision"),
                pr=_fmt(aggregate, "polyline_recall"),
            )
        )
    return "\n".join(lines)


def _render_ablation_table(rows: Sequence[tuple[str, dict[str, Any]]]) -> str:
    header = "| Transformación | Muros P | Muros R | Fallos |"
    separator = "| --- | ---: | ---: | ---: |"
    lines = [header, separator]
    for name, aggregate in rows:
        lines.append(
            "| {name} | {p} | {r} | {fail} |".format(
                name=name,
                p=_fmt(aggregate, "wall_precision"),
                r=_fmt(aggregate, "wall_recall"),
                fail=f"{aggregate['failures']}/{aggregate['count']}",
            )
        )
    return "\n".join(lines)


def evaluate(
    n: int,
    seeds: int,
    output_dir: Path,
    tolerance: float,
    base_seed: int,
    include_clean: bool,
    include_ablation: bool,
) -> dict[str, Any]:
    plans = generate_dataset(n, output_dir, base_seed=base_seed)
    settings = Settings(_env_file=None)
    step = max(2.0, tolerance / 2.0)

    levels = list(DEGRADATION_LEVELS)
    if include_clean:
        levels = [CLEAN_LEVEL, *levels]

    level_rows: list[tuple[str, dict[str, Any]]] = []
    for name, strength in levels:
        records: list[dict[str, Any]] = []
        for seed_index in range(seeds):
            seed = base_seed + seed_index
            for index, plan in enumerate(plans):
                records.append(
                    _evaluate_variant(plan, strength, seed, index, tolerance, settings, step)
                )
        level_rows.append((name, _aggregate(records)))

    ablation_rows: list[tuple[str, dict[str, Any]]] = []
    if include_ablation:
        for transform in (*GEO_TRANSFORMS, *PHOTO_TRANSFORMS):
            records = []
            for seed_index in range(seeds):
                seed = base_seed + seed_index
                for index, plan in enumerate(plans):
                    records.append(
                        _evaluate_isolated(
                            plan,
                            transform,
                            ABLATION_STRENGTH,
                            seed,
                            index,
                            tolerance,
                            settings,
                            step,
                        )
                    )
            ablation_rows.append((transform, _aggregate(records)))

    return {"levels": level_rows, "ablation": ablation_rows, "plans": plans}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=DEFAULT_N, help="Número de planos.")
    parser.add_argument(
        "--seeds", type=int, default=DEFAULT_SEEDS, help="Número de semillas."
    )
    parser.add_argument("--seed", type=int, default=20260101, help="Semilla base.")
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
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Omite la fila de referencia sin degradación.",
    )
    parser.add_argument(
        "--no-ablation",
        action="store_true",
        help="Omite la tabla de ablación.",
    )
    parser.add_argument(
        "--preprocess",
        action="store_true",
        help="Preprocesado previo (pendiente de implementar).",
    )
    args = parser.parse_args(argv)

    if args.preprocess:
        print(
            "AVISO: --preprocess está pendiente de implementar; esta ejecución "
            "NO aplica ningún preprocesado."
        )

    results = evaluate(
        n=args.n,
        seeds=args.seeds,
        output_dir=args.output,
        tolerance=args.tolerance,
        base_seed=args.seed,
        include_clean=not args.no_clean,
        include_ablation=not args.no_ablation,
    )

    print(
        f"\nPlanos: {args.n} · semillas: {args.seeds} · tolerancia: "
        f"{args.tolerance} px · salida: {args.output}"
    )
    print("\n### Niveles de degradación (media ± desviación estándar)")
    print(_render_level_table(results["levels"]))

    print("\n### Entidades detectadas por tipo")
    print(_render_entity_table(results["levels"]))

    if args.no_ablation is False:
        print(f"\n### Ablación (intensidad fija {ABLATION_STRENGTH})")
        print(_render_ablation_table(results["ablation"]))

    contact_path = render_contact_sheet(
        results["plans"][:CONTACT_SHEET_PLANS],
        args.output / "contact_sheet.png",
    )
    print(f"\nHoja de contacto: {contact_path}")

    print("\nNotas:")
    print("  † Huecos R NO ES FIABLE: premia no detectar (no es una métrica de huecos).")
    print("  Puertas/Ventanas R = candidatos con rol door/window; el modo raster")
    print("  hoy no los produce (0.000 esperado).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
