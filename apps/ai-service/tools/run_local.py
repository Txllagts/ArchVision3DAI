"""Herramienta de depuración visual del análisis de planos.

Ejecuta ``analyze_floorplan`` y ``extrude_floorplan_to_3d`` directamente (sin
Supabase ni servidor) y vuelca en una carpeta:

* ``result.json`` — resultado completo de ``analyze_floorplan``.
* ``model.glb`` — malla 3D extrudida.
* ``overlay.png`` — la imagen reducida (espacio de ``source.image_size``) con
  las entidades dibujadas: muros azul, puertas verde, ventanas naranja; los
  ``line`` como segmentos y las ``polyline`` como curvas, las cerradas marcadas
  y la confianza escrita junto a cada entidad. Si hay un ``ground_truth.json``
  de los planos sintéticos junto a la imagen, dibuja la verdad en rojo y marca
  los puntos de discrepancia.

Uso::

    python tools/run_local.py <imagen_o_plano> --out <carpeta> [--preprocess]

Este módulo no se importa desde ``app``; solo invoca sus funciones.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from PIL import Image, ImageDraw, ImageOps

# Permite ``python tools/run_local.py ...`` además de ``-m``.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.floorplan import (
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    InvalidFloorplanError,
    analyze_floorplan,
    extrude_floorplan_to_3d,
)
from app.settings import Settings

Point = tuple[float, float]
Segment = tuple[Point, Point]

SUPPORTED_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg", ".pdf", ".dwg", ".dxf"}
RASTER_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}

ROLE_COLORS: dict[str, tuple[int, int, int]] = {
    "wall_candidate": (0, 90, 255),  # azul
    "door_candidate": (0, 180, 0),  # verde
    "window_candidate": (255, 140, 0),  # naranja
}
DEFAULT_ROLE_COLOR = (128, 128, 128)
CLOSED_MARKER_COLOR = (200, 0, 200)
GT_WALL_COLOR = (255, 0, 0)  # rojo
GT_OPENING_COLOR = (255, 0, 0)
FN_COLOR = (255, 255, 0)  # amarillo: GT no cubierto por detección
FP_COLOR = (255, 0, 255)  # magenta: detección sin GT
DISCREPANCY_TOLERANCE = 6.0


# ---------------------------------------------------------------------------
# Geometría auxiliar (mínima, para no importar privados de app/)
# ---------------------------------------------------------------------------


def _entity_segments(entity: dict[str, Any]) -> list[Segment]:
    points = [(float(p[0]), float(p[1])) for p in entity.get("points", [])]
    segments: list[Segment] = list(zip(points, points[1:]))
    if entity.get("closed") and len(points) > 2:
        segments.append((points[-1], points[0]))
    return segments


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


def _min_distance(point: Point, segments: Sequence[Segment]) -> float:
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


# ---------------------------------------------------------------------------
# Imagen reducida (mismo criterio que ``_read_raster``)
# ---------------------------------------------------------------------------


def _render_pdf(path: Path) -> Image.Image:
    import fitz

    with fitz.open(str(path)) as document:
        if not document.page_count:
            raise InvalidFloorplanError("El PDF no contiene páginas.")
        page = document[0]
        width = max(float(page.rect.width), 1.0)
        height = max(float(page.rect.height), 1.0)
        scale = min(
            2.0,
            MAX_IMAGE_SIDE / max(width, height),
            math.sqrt(MAX_IMAGE_PIXELS / (width * height)),
        )
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(scale, scale), alpha=False, colorspace=fitz.csRGB
        )
        return Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")


def _reduced_image(path: Path) -> Image.Image | None:
    """Imagen en el espacio de ``source.image_size`` (la reducida)."""

    extension = path.suffix.lower()
    if extension == ".pdf":
        return _render_pdf(path)
    if extension in RASTER_EXTENSIONS:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        return image
    return None  # CAD: no hay imagen


# ---------------------------------------------------------------------------
# Overlay
# ---------------------------------------------------------------------------


def _gt_wall_runs(ground_truth: dict[str, Any]) -> list[Segment]:
    """Tramos reales de muro del ground truth (línea central sin huecos)."""

    runs: list[Segment] = []
    openings_by_wall: dict[int, list[tuple[float, float]]] = {}
    for opening in ground_truth.get("openings", []):
        openings_by_wall.setdefault(opening["wall_index"], []).append(
            (opening["offset"], opening["offset"] + opening["width"])
        )
    for wall in ground_truth.get("walls", []):
        x0, y0 = wall["start"]
        x1, y1 = wall["end"]
        length = math.hypot(x1 - x0, y1 - y0)
        if length < 1e-6:
            continue
        ux, uy = (x1 - x0) / length, (y1 - y0) / length

        def point_at(offset: float) -> Point:
            return (x0 + ux * offset, y0 + uy * offset)

        cursor = 0.0
        for gap_start, gap_end in sorted(openings_by_wall.get(wall["index"], [])):
            if gap_start - cursor > 1.0:
                runs.append((point_at(cursor), point_at(gap_start)))
            cursor = max(cursor, gap_end)
        if length - cursor > 1.0:
            runs.append((point_at(cursor), point_at(length)))
    return runs


def _draw_ground_truth(
    draw: ImageDraw.ImageDraw,
    ground_truth: dict[str, Any],
    detected_walls: Sequence[Segment],
    reduced_size: tuple[int, int],
) -> None:
    """Verdad en rojo + puntos de discrepancia (amarillo FN, magenta FP).

    El ground truth viene en el espacio de la imagen original; se reescala al
    espacio reducido (``source.image_size``). Para planos sintéticos (<=2048 px)
    la escala es 1.0, pero se generaliza por si la entrada se redujo.
    """

    gt_size = ground_truth.get("image_size")
    walls = ground_truth.get("walls", [])
    if not gt_size or not walls:
        return
    scale_x = reduced_size[0] / gt_size["width"]
    scale_y = reduced_size[1] / gt_size["height"]

    def scaled(point: Point) -> Point:
        return (point[0] * scale_x, point[1] * scale_y)

    # Dibuja la verdad (muros y aberturas) en rojo.
    for wall in walls:
        draw.line([scaled(tuple(wall["start"])), scaled(tuple(wall["end"]))], fill=GT_WALL_COLOR, width=2)
    for opening in ground_truth.get("openings", []):
        wall = next((w for w in walls if w["index"] == opening["wall_index"]), None)
        if wall is None:
            continue
        x0, y0 = wall["start"]
        x1, y1 = wall["end"]
        length = math.hypot(x1 - x0, y1 - y0)
        if length < 1e-6:
            continue
        ux, uy = (x1 - x0) / length, (y1 - y0) / length
        nx, ny = -uy, ux
        half = wall["thickness"] / 2
        start_offset = opening["offset"]
        end_offset = opening["offset"] + opening["width"]
        sx0, sy0 = x0 + start_offset * ux, y0 + start_offset * uy
        ex0, ey0 = x0 + end_offset * ux, y0 + end_offset * uy
        polygon = [
            (sx0 + nx * half, sy0 + ny * half),
            (ex0 + nx * half, ey0 + ny * half),
            (ex0 - nx * half, ey0 - ny * half),
            (sx0 - nx * half, sy0 - ny * half),
        ]
        draw.polygon([scaled(point) for point in polygon], outline=GT_OPENING_COLOR)

    # Tramos reales de muro (sin huecos) en el espacio del GT.
    runs = [
        (scaled(start), scaled(end)) for start, end in _gt_wall_runs(ground_truth)
    ]

    step = max(2.0, DISCREPANCY_TOLERANCE / 2)
    # Falsos negativos: puntos del GT no cubiertos por ningún muro detectado.
    for start, end in runs:
        for point in _sample_segment((start, end), step):
            if _min_distance(point, detected_walls) > DISCREPANCY_TOLERANCE:
                draw.ellipse(
                    [point[0] - 2, point[1] - 2, point[0] + 2, point[1] + 2],
                    fill=FN_COLOR,
                )
    # Falsos positivos: puntos detectados sin GT cercano.
    for segment in detected_walls:
        for point in _sample_segment(segment, step):
            if _min_distance(point, runs) > DISCREPANCY_TOLERANCE:
                draw.ellipse(
                    [point[0] - 2, point[1] - 2, point[0] + 2, point[1] + 2],
                    fill=FP_COLOR,
                )


def build_overlay(path: Path, result: dict[str, Any]) -> Image.Image | None:
    """Dibuja entidades (y verdad si existe) sobre la imagen reducida."""

    image = _reduced_image(path)
    if image is None:
        return None
    image_size = result.get("source", {}).get("image_size")
    if not image_size:
        return None
    draw = ImageDraw.Draw(image)

    detected_walls: list[Segment] = []
    for entity in result.get("entities", []):
        role = entity.get("role", "")
        entity_type = entity.get("type", "line")
        color = ROLE_COLORS.get(role, DEFAULT_ROLE_COLOR)
        points = [(float(p[0]), float(p[1])) for p in entity.get("points", [])]
        if not points:
            continue
        if entity_type == "polyline":
            draw.line(points, fill=color, width=2)
        else:
            for start, end in zip(points, points[1:]):
                draw.line([start, end], fill=color, width=2)
        if role == "wall_candidate":
            detected_walls.extend(_entity_segments(entity))
        if entity.get("closed"):
            centroid_x = sum(p[0] for p in points) / len(points)
            centroid_y = sum(p[1] for p in points) / len(points)
            radius = 4
            draw.ellipse(
                [
                    centroid_x - radius,
                    centroid_y - radius,
                    centroid_x + radius,
                    centroid_y + radius,
                ],
                outline=CLOSED_MARKER_COLOR,
                width=2,
            )
        confidence = entity.get("confidence")
        if confidence is not None:
            x0, y0 = points[0]
            draw.text((x0 + 3, y0 - 3), f"{confidence:.2f}", fill=color)

    # Verdad de referencia (rojo) y discrepancias, si hay ground_truth.json.
    ground_truth_path = path.with_name(path.stem + ".ground_truth.json")
    if not ground_truth_path.exists():
        ground_truth_path = path.with_name("ground_truth.json")
    if ground_truth_path.exists():
        try:
            ground_truth = json.loads(ground_truth_path.read_text(encoding="utf-8"))
            _draw_ground_truth(draw, ground_truth, detected_walls, image.size)
        except (OSError, ValueError):
            # Si el GT no se puede leer, se ignora sin romper la herramienta.
            pass

    return image.convert("RGB")


# ---------------------------------------------------------------------------
# Ejecución
# ---------------------------------------------------------------------------


def _print_summary(
    result: dict[str, Any],
    original_size: tuple[int, int] | None,
    analyze_seconds: float,
    extrude_seconds: float,
) -> None:
    entities = result.get("entities", [])
    role_counts = Counter(entity.get("role", "?") for entity in entities)
    type_counts = Counter(entity.get("type", "?") for entity in entities)
    print(f"Entidades: {len(entities)}")
    print("  por role: " + ", ".join(f"{k}={v}" for k, v in sorted(role_counts.items())))
    print("  por type: " + ", ".join(f"{k}={v}" for k, v in sorted(type_counts.items())))

    image_size = result.get("source", {}).get("image_size")
    original = f"{original_size[0]}x{original_size[1]}" if original_size else "n/d"
    reduced = (
        f"{image_size['width']}x{image_size['height']}"
        if image_size
        else "n/d"
    )
    print(f"Imagen: original={original}, reducida={reduced}")
    print(
        f"Tiempo: análisis={analyze_seconds:.2f}s, "
        f"extrusión={extrude_seconds:.2f}s, "
        f"total={analyze_seconds + extrude_seconds:.2f}s"
    )


def run(
    input_path: str | Path,
    output_dir: str | Path,
    preprocess: bool = False,
) -> int:
    path = Path(input_path)
    if not path.is_file():
        print(f"Error: no existe el archivo {path}")
        return 2

    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        print(
            f"Error: extensión no admitida {extension!r}. "
            f"Usa {', '.join(sorted(SUPPORTED_EXTENSIONS))}."
        )
        return 2

    settings = Settings(_env_file=None)

    if preprocess:
        if not hasattr(settings, "plan_preprocess_enabled"):
            print(
                "AVISO: --preprocess: Settings aún no tiene "
                "'plan_preprocess_enabled'; se continúa sin preprocesado."
            )

    # Comprobación de 4 megapíxeles (comportamiento del servicio: error 422).
    original_size: tuple[int, int] | None = None
    if extension in RASTER_EXTENSIONS:
        with Image.open(path) as source:
            original_size = (source.width, source.height)
            if source.width * source.height > MAX_IMAGE_PIXELS:
                print(
                    f"Error 422: la imagen supera el límite de "
                    f"{MAX_IMAGE_PIXELS} píxeles ({source.width}x{source.height})."
                )
                return 1

    data = path.read_bytes()

    analyze_start = time.perf_counter()
    try:
        result = analyze_floorplan(path.name, data, settings)
    except InvalidFloorplanError as error:
        print(f"Error 422: {error}")
        return 1
    analyze_seconds = time.perf_counter() - analyze_start

    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    overlay = build_overlay(path, result)
    if overlay is not None:
        overlay.save(directory / "overlay.png")
    else:
        print("AVISO: sin imagen raster/PDF; no se genera overlay.png.")

    extrude_seconds = 0.0
    try:
        extrude_start = time.perf_counter()
        glb = extrude_floorplan_to_3d(result)
        extrude_seconds = time.perf_counter() - extrude_start
        (directory / "model.glb").write_bytes(glb)
    except (InvalidFloorplanError, ValueError) as error:
        print(f"Error de extrusión: {error}")
        _print_summary(result, original_size, analyze_seconds, extrude_seconds)
        return 1

    _print_summary(result, original_size, analyze_seconds, extrude_seconds)
    print(f"Salida: {directory}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Imagen o plano (PNG, JPG, WebP, PDF, DWG, DXF).")
    parser.add_argument("--out", required=True, help="Carpeta de salida.")
    parser.add_argument(
        "--preprocess",
        action="store_true",
        help="Preprocesado previo (pendiente de implementar).",
    )
    args = parser.parse_args(argv)
    return run(args.input, args.out, preprocess=args.preprocess)


if __name__ == "__main__":
    raise SystemExit(main())
