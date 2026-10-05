from __future__ import annotations

import io
import itertools
import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import cv2
import ezdxf
import fitz
import numpy as np
from PIL import Image, ImageOps

from app.services.input_preprocessor import convert_dwg_to_dxf
from app.settings import Settings

SUPPORTED_EXTENSIONS = {".pdf", ".dwg", ".dxf", ".png", ".webp", ".jpg", ".jpeg"}
MAX_CAD_ENTITIES = 20_000
MAX_RASTER_ENTITIES = 5_000
MAX_GEOMETRY_POINTS = 200_000
MAX_IMAGE_SIDE = 2_048
MAX_IMAGE_PIXELS = 4_000_000
WALL_LAYER_PATTERN = re.compile(r"(wall|walls|muro|muros|pared|paredes|partition)", re.IGNORECASE)
DOOR_LAYER_PATTERN = re.compile(r"(door|doors|puerta|puertas)", re.IGNORECASE)
WINDOW_LAYER_PATTERN = re.compile(r"(window|windows|ventana|ventanas)", re.IGNORECASE)

DXF_UNITS: dict[int, str] = {
    0: "unitless",
    1: "inches",
    2: "feet",
    4: "millimeters",
    5: "centimeters",
    6: "meters",
    8: "microinches",
    9: "mils",
    10: "yards",
    14: "decimeters",
    15: "decameters",
    16: "hectometers",
    17: "kilometers",
}

METERS_PER_UNIT: dict[str, float] = {
    "inches": 0.0254,
    "feet": 0.3048,
    "millimeters": 0.001,
    "centimeters": 0.01,
    "meters": 1.0,
    "microinches": 0.0000000254,
    "mils": 0.0000254,
    "yards": 0.9144,
    "decimeters": 0.1,
    "decameters": 10.0,
    "hectometers": 100.0,
    "kilometers": 1000.0,
}


class InvalidFloorplanError(ValueError):
    """Input is corrupt, unsupported, or contains no usable plan geometry."""


def _safe_filename(filename: str) -> str:
    basename = Path(filename.replace("\\", "/")).name
    return "".join(char for char in basename if char.isprintable())[:200] or "floorplan"


def _xy(point: Any) -> list[float]:
    x, y = float(point[0]), float(point[1])
    if not math.isfinite(x) or not math.isfinite(y):
        raise InvalidFloorplanError("El archivo CAD contiene coordenadas no válidas.")
    return [round(x, 6), round(y, 6)]


def _layer_role(layer: str) -> str:
    if DOOR_LAYER_PATTERN.search(layer):
        return "door_candidate"
    if WINDOW_LAYER_PATTERN.search(layer):
        return "window_candidate"
    if WALL_LAYER_PATTERN.search(layer):
        return "wall_candidate"
    return "geometry"


def _entity_points(entity: Any) -> tuple[str, list[list[float]], bool] | None:
    kind = entity.dxftype()
    if kind == "LINE":
        return "line", [_xy(entity.dxf.start), _xy(entity.dxf.end)], False
    if kind == "LWPOLYLINE":
        points = [_xy(point) for point in entity.get_points("xy")]
        return "polyline", points, bool(entity.closed)
    if kind == "POLYLINE":
        points = [_xy(vertex.dxf.location) for vertex in entity.vertices]
        return "polyline", points, bool(entity.is_closed)
    return None


def _cad_units(document: ezdxf.document.Drawing) -> str:
    unit_code = int(document.header.get("$INSUNITS", 0))
    return DXF_UNITS.get(unit_code, "unitless")


def _read_cad(path: Path) -> tuple[list[dict[str, Any]], str]:
    try:
        document = ezdxf.readfile(path)
        entities: list[dict[str, Any]] = []
        point_count = 0
        for entity in document.modelspace():
            geometry = _entity_points(entity)
            if geometry is None:
                continue
            kind, points, closed = geometry
            if len(points) < 2:
                continue
            point_count += len(points)
            if point_count > MAX_GEOMETRY_POINTS:
                raise InvalidFloorplanError(
                    f"El plano supera el límite de {MAX_GEOMETRY_POINTS} vértices."
                )
            layer = str(entity.dxf.layer)
            role = _layer_role(layer)
            entities.append(
                {
                    "type": kind,
                    "role": role,
                    "layer": layer,
                    "points": points,
                    "closed": closed,
                    "confidence": 1.0,
                }
            )
            if len(entities) > MAX_CAD_ENTITIES:
                raise InvalidFloorplanError(
                    f"El plano supera el límite de {MAX_CAD_ENTITIES} entidades CAD."
                )
    except InvalidFloorplanError:
        raise
    except (ezdxf.DXFError, OSError, ValueError, TypeError, AttributeError) as error:
        raise InvalidFloorplanError(
            "No se pudo leer el CAD. Verifica que sea un DXF válido y que no esté vacío."
        ) from error

    if not entities:
        raise InvalidFloorplanError(
            "El CAD no contiene líneas o polilíneas 2D compatibles en el espacio modelo."
        )
    if not any(entity["role"] == "wall_candidate" for entity in entities):
        raise InvalidFloorplanError(
            "No se identificaron muros en el CAD. Nombra la capa con WALL, MURO, PARED o PARTITION."
        )
    return entities, _cad_units(document)


def _render_pdf(data: bytes) -> Image.Image:
    try:
        with fitz.open(stream=data, filetype="pdf") as document:
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
                matrix=fitz.Matrix(scale, scale),
                alpha=False,
                colorspace=fitz.csRGB,
            )
            return Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    except InvalidFloorplanError:
        raise
    except (fitz.FileDataError, RuntimeError, ValueError) as error:
        raise InvalidFloorplanError(
            "No se pudo abrir el PDF. Verifica que no esté corrupto o protegido."
        ) from error


def _read_raster(extension: str, data: bytes) -> Image.Image:
    try:
        if extension == ".pdf":
            image = _render_pdf(data)
        else:
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise InvalidFloorplanError(
                        f"La imagen supera el límite de {MAX_IMAGE_PIXELS} píxeles."
                    )
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
    except InvalidFloorplanError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise InvalidFloorplanError(
            "No se pudo leer la imagen. Verifica que el archivo esté completo y sea válido."
        ) from error

    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    return image


def _raster_geometry(image: Image.Image) -> list[dict[str, Any]]:
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
    )

    height, width = binary.shape
    minimum_dimension = min(height, width)
    line_length = max(25, minimum_dimension // 10)
    line_thickness = max(2, minimum_dimension // 100)
    max_line_thickness = max(line_thickness + 1, minimum_dimension // 7)
    min_contour_area = max(20.0, float(minimum_dimension) * 0.08)
    kernel_length = max(9, min(65, minimum_dimension // 12))

    # Close small scan gaps before directional filtering to keep wall joints connected.
    closed = cv2.morphologyEx(
        binary,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    )
    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (kernel_length, line_thickness)
    )
    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (line_thickness, kernel_length)
    )
    horizontal = cv2.morphologyEx(closed, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(closed, cv2.MORPH_OPEN, vertical_kernel)
    horizontal = cv2.morphologyEx(
        horizontal,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, kernel_length // 4), 1)),
    )
    vertical = cv2.morphologyEx(
        vertical,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, kernel_length // 4))),
    )

    entities: list[dict[str, Any]] = []
    horizontal_segments: list[tuple[float, float, float, float]] = []
    vertical_segments: list[tuple[float, float, float, float]] = []
    for mask, horizontal_orientation in (
        (horizontal, True),
        (vertical, False),
    ):
        contours, _ = cv2.findContours(
            mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        raw_segments = (
            horizontal_segments if horizontal_orientation else vertical_segments
        )
        for contour in contours:
            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue
            area = abs(float(cv2.contourArea(contour)))
            if area < min_contour_area:
                continue
            simplified = cv2.approxPolyDP(
                contour,
                epsilon=max(
                    1.0,
                    min(perimeter * 0.01, line_thickness * 0.5),
                ),
                closed=True,
            )
            if len(simplified) < 4:
                continue

            x, y, contour_width, contour_height = cv2.boundingRect(simplified)
            segment_length = contour_width if horizontal_orientation else contour_height
            segment_thickness = contour_height if horizontal_orientation else contour_width
            aspect_ratio = segment_length / max(segment_thickness, 1)
            if (
                segment_length < line_length
                or segment_thickness < line_thickness
                or segment_thickness > max_line_thickness
                or aspect_ratio < 3.5
            ):
                continue

            # Bounding-box centerlines snap accepted contours onto exact 0/90-degree axes.
            if horizontal_orientation:
                center_y = y + (contour_height - 1) / 2
                raw_segments.append(
                    (float(x), center_y, float(x + contour_width - 1), center_y)
                )
            else:
                center_x = x + (contour_width - 1) / 2
                raw_segments.append(
                    (center_x, float(y), center_x, float(y + contour_height - 1))
                )

    for raw_segments, horizontal_orientation in (
        (horizontal_segments, True),
        (vertical_segments, False),
    ):
        if horizontal_orientation:
            raw_segments.sort(key=lambda segment: (segment[1], segment[0]))
        else:
            raw_segments.sort(key=lambda segment: (segment[0], segment[1]))

        merged: list[list[float]] = []
        merge_distance = max(4.0, kernel_length // 4)
        for segment in raw_segments:
            if horizontal_orientation:
                match = next(
                    (
                        candidate
                        for candidate in reversed(merged)
                        if abs(candidate[1] - segment[1]) <= 4
                        and segment[0] - candidate[2] <= merge_distance
                        and segment[0] >= candidate[0]
                    ),
                    None,
                )
                if match is not None:
                    match[2] = max(match[2], segment[2])
                    match[1] = (match[1] + segment[1]) / 2
                    match[3] = match[1]
                    continue
            else:
                match = next(
                    (
                        candidate
                        for candidate in reversed(merged)
                        if abs(candidate[0] - segment[0]) <= 4
                        and segment[1] - candidate[3] <= merge_distance
                        and segment[1] >= candidate[1]
                    ),
                    None,
                )
                if match is not None:
                    match[3] = max(match[3], segment[3])
                    match[0] = (match[0] + segment[0]) / 2
                    match[2] = match[0]
                    continue
            merged.append(list(segment))

        for x1, y1, x2, y2 in merged:
            if len(entities) >= MAX_RASTER_ENTITIES:
                break
            entities.append(
                {
                    "type": "line",
                    "role": "wall_candidate",
                    "layer": None,
                    "points": [[round(x1), round(y1)], [round(x2), round(y2)]],
                    "closed": False,
                    "confidence": 0.4,
                }
            )

    if not entities:
        raise InvalidFloorplanError(
            "No se detectaron trazos largos compatibles con muros en el plano."
        )
    return entities


def _bounds(entities: list[dict[str, Any]]) -> dict[str, list[float]]:
    points = [point for entity in entities for point in entity["points"]]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {
        "min": [min(xs), min(ys)],
        "max": [max(xs), max(ys)],
    }


def _statistics(entities: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "entity_count": len(entities),
        "wall_candidate_count": sum(
            entity["role"] == "wall_candidate" for entity in entities
        ),
        "door_candidate_count": sum(
            entity["role"] == "door_candidate" for entity in entities
        ),
        "window_candidate_count": sum(
            entity["role"] == "window_candidate" for entity in entities
        ),
    }


def _parse_cad_upload(
    filename: str, data: bytes, settings: Settings
) -> tuple[list[dict[str, Any]], str]:
    extension = Path(filename).suffix.lower()
    with tempfile.TemporaryDirectory(prefix="archvision-floorplan-") as directory:
        source_path = Path(directory) / f"input{extension}"
        source_path.write_bytes(data)
        cad_path = source_path
        if extension == ".dwg":
            if not settings.oda_file_converter:
                raise InvalidFloorplanError(
                    "DWG requiere ODA File Converter configurado en ODA_FILE_CONVERTER."
                )
            try:
                cad_path = convert_dwg_to_dxf(
                    source_path, settings.oda_file_converter
                )
            except (OSError, subprocess.SubprocessError, InvalidFloorplanError) as error:
                raise InvalidFloorplanError(
                    "No se pudo convertir el DWG. Verifica ODA_FILE_CONVERTER y que el archivo sea válido."
                ) from error
        return _read_cad(cad_path)


def analyze_floorplan(
    filename: str, data: bytes, settings: Settings
) -> dict[str, Any]:
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise InvalidFloorplanError(
            "Formato no admitido. Usa PDF, DWG, DXF, PNG, WebP o JPG."
        )
    if not data:
        raise InvalidFloorplanError("El archivo está vacío.")
    if len(data) > settings.max_upload_bytes:
        raise InvalidFloorplanError("El archivo supera el límite de 20 MB.")

    safe_name = _safe_filename(filename)
    if extension in {".dwg", ".dxf"}:
        entities, units = _parse_cad_upload(safe_name, data, settings)
        coordinate_system = "drawing_units"
        source_kind = "cad"
        image_size = None
    else:
        image = _read_raster(extension, data)
        entities = _raster_geometry(image)
        units = "pixels"
        coordinate_system = "image_pixels_top_left_origin"
        source_kind = "raster"
        image_size = {"width": image.width, "height": image.height}

    return {
        "format_version": "1.0",
        "source": {
            "filename": safe_name,
            "extension": extension.lstrip("."),
            "kind": source_kind,
            "coordinate_system": coordinate_system,
            "units": units,
            "image_size": image_size,
        },
        "bounds": _bounds(entities),
        "statistics": _statistics(entities),
        "entities": entities,
    }


def _entity_segments(entity: dict[str, Any]) -> list[tuple[list[float], list[float]]]:
    points = entity["points"]
    segments = list(zip(points, points[1:]))
    if entity.get("closed") and len(points) > 2:
        segments.append((points[-1], points[0]))
    return [
        (start, end)
        for start, end in segments
        if math.dist(start, end) > 1e-6
    ]


def _meters_per_plan_unit(geometry: dict[str, Any]) -> tuple[float, str]:
    source = geometry["source"]
    units = source["units"]
    if units == "pixels":
        return 0.01, "approximate_100_pixels_per_meter"
    factor = METERS_PER_UNIT.get(units)
    if factor is None:
        raise InvalidFloorplanError(
            "No se puede extruir un CAD sin unidades declaradas. Configura $INSUNITS en metros, centímetros, milímetros, pies o pulgadas."
        )
    return factor, units


def _opening_intervals(
    wall_start: list[float],
    wall_end: list[float],
    openings: list[dict[str, Any]],
    scale: float,
    wall_thickness: float,
) -> list[tuple[float, float, str]]:
    wall_dx = (wall_end[0] - wall_start[0]) * scale
    wall_dy = (wall_end[1] - wall_start[1]) * scale
    wall_length = math.hypot(wall_dx, wall_dy)
    if wall_length <= 1e-6:
        return []

    unit_x, unit_y = wall_dx / wall_length, wall_dy / wall_length
    candidates: list[tuple[float, float, str]] = []
    for opening in openings:
        role = opening["role"].removesuffix("_candidate")
        for opening_start, opening_end in _entity_segments(opening):
            start_x = opening_start[0] * scale - wall_start[0] * scale
            start_y = opening_start[1] * scale - wall_start[1] * scale
            end_x = opening_end[0] * scale - wall_start[0] * scale
            end_y = opening_end[1] * scale - wall_start[1] * scale
            opening_dx, opening_dy = end_x - start_x, end_y - start_y
            opening_length = math.hypot(opening_dx, opening_dy)
            if opening_length < 0.45:
                continue
            parallel = abs(unit_x * opening_dx + unit_y * opening_dy) / opening_length
            if parallel < 0.95:
                continue
            cross_start = abs(unit_x * start_y - unit_y * start_x)
            cross_end = abs(unit_x * end_y - unit_y * end_x)
            if max(cross_start, cross_end) > max(0.3, wall_thickness * 2):
                continue
            projected_start = start_x * unit_x + start_y * unit_y
            projected_end = end_x * unit_x + end_y * unit_y
            interval_start = max(0.0, min(projected_start, projected_end))
            interval_end = min(wall_length, max(projected_start, projected_end))
            if interval_end - interval_start >= 0.45:
                candidates.append((interval_start, interval_end, role))
    return candidates


def _wall_piece(
    start: list[float],
    unit_x: float,
    unit_y: float,
    middle: float,
    length: float,
    bottom: float,
    top: float,
    thickness: float,
) -> Any:
    import trimesh

    mesh = trimesh.creation.box(
        extents=[length, top - bottom, thickness]
    )
    center_x = start[0] + unit_x * middle
    center_z = start[1] + unit_y * middle
    angle = -math.atan2(unit_y, unit_x)
    cosine, sine = math.cos(angle), math.sin(angle)
    transform = np.array(
        [
            [cosine, 0.0, sine, center_x],
            [0.0, 1.0, 0.0, (bottom + top) / 2],
            [-sine, 0.0, cosine, center_z],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=float,
    )
    mesh.apply_transform(transform)
    return mesh


def extrude_floorplan_to_3d(
    geometry: dict[str, Any],
    wall_height_m: float = 2.6,
    wall_thickness_m: float = 0.15,
    door_height_m: float = 2.1,
    window_sill_height_m: float = 0.9,
    window_head_height_m: float = 2.1,
) -> bytes:
    import trimesh

    if not 2.0 <= wall_height_m <= 6.0:
        raise ValueError("La altura de muro debe estar entre 2 y 6 metros.")
    if not 0.08 <= wall_thickness_m <= 0.6:
        raise ValueError("El espesor de muro debe estar entre 0.08 y 0.6 metros.")
    if not 0.5 <= door_height_m < wall_height_m:
        raise ValueError("La altura de puerta debe ser positiva y menor que el muro.")
    if not 0.2 <= window_sill_height_m < window_head_height_m < wall_height_m:
        raise ValueError("Las alturas de ventana deben estar dentro de la altura de muro.")

    scale, _ = _meters_per_plan_unit(geometry)
    wall_entities = [
        entity for entity in geometry["entities"]
        if entity["role"] == "wall_candidate"
    ]
    opening_entities = [
        entity
        for entity in geometry["entities"]
        if entity["role"] in {"door_candidate", "window_candidate"}
    ]
    pieces: list[Any] = []
    for wall in wall_entities:
        for raw_start, raw_end in _entity_segments(wall):
            start = [raw_start[0] * scale, raw_start[1] * scale]
            end = [raw_end[0] * scale, raw_end[1] * scale]
            dx, dz = end[0] - start[0], end[1] - start[1]
            wall_length = math.hypot(dx, dz)
            if wall_length < 0.25:
                continue
            unit_x, unit_z = dx / wall_length, dz / wall_length
            intervals = _opening_intervals(
                raw_start,
                raw_end,
                opening_entities,
                scale,
                wall_thickness_m,
            )
            breakpoints = sorted(
                {
                    0.0,
                    wall_length,
                    *(value for interval in intervals for value in interval[:2]),
                }
            )
            for segment_start, segment_end in itertools.pairwise(breakpoints):
                segment_length = segment_end - segment_start
                if segment_length < 1e-4:
                    continue
                midpoint = (segment_start + segment_end) / 2
                opening_type = next(
                    (
                        role
                        for interval_start, interval_end, role in intervals
                        if interval_start <= midpoint <= interval_end
                    ),
                    None,
                )
                vertical_spans = (
                    [(door_height_m, wall_height_m)]
                    if opening_type == "door"
                    else (
                        [
                            (0.0, window_sill_height_m),
                            (window_head_height_m, wall_height_m),
                        ]
                        if opening_type == "window"
                        else [(0.0, wall_height_m)]
                    )
                )
                for bottom, top in vertical_spans:
                    if top - bottom <= 1e-4:
                        continue
                    pieces.append(
                        _wall_piece(
                            start,
                            unit_x,
                            unit_z,
                            midpoint,
                            segment_length,
                            bottom,
                            top,
                            wall_thickness_m,
                        )
                    )

    if not pieces:
        raise InvalidFloorplanError(
            "No hay segmentos de muro suficientes para construir la malla 3D."
        )
    mesh = trimesh.util.concatenate(pieces)
    if mesh.is_empty or not np.isfinite(mesh.vertices).all():
        raise InvalidFloorplanError("La extrusión del plano generó una malla no válida.")
    exported = trimesh.Scene(mesh).export(file_type="glb")
    if not isinstance(exported, bytes) or not exported:
        raise InvalidFloorplanError("No se pudo serializar el modelo 3D generado.")
    return exported
