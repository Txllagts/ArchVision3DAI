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


def _sample_circle(center: Any, radius: float, steps: int = 64) -> list[list[float]]:
    return [
        _xy(
            (
                center[0] + radius * math.cos(2 * math.pi * i / steps),
                center[1] + radius * math.sin(2 * math.pi * i / steps),
            )
        )
        for i in range(steps + 1)
    ]


def _sample_arc(entity: Any, max_steps: int = 128) -> list[list[float]]:
    center = entity.dxf.center
    radius = abs(float(entity.dxf.radius))
    if radius < 1e-9:
        raise InvalidFloorplanError("El CAD contiene un arco de radio cero.")
    start = math.radians(float(entity.dxf.start_angle))
    end = math.radians(float(entity.dxf.end_angle))
    sweep = (end - start) % (2 * math.pi)
    if sweep < 1e-9:
        sweep = 2 * math.pi
    steps = max(8, min(max_steps, int(sweep / (math.pi / 36)) + 2))
    return [
        _xy(
            (
                center[0] + radius * math.cos(start + sweep * i / steps),
                center[1] + radius * math.sin(start + sweep * i / steps),
            )
        )
        for i in range(steps + 1)
    ]


def _sample_ellipse(entity: Any, max_steps: int = 160) -> list[list[float]]:
    center = entity.dxf.center
    major = entity.dxf.major_axis
    major_len = math.hypot(major[0], major[1])
    ratio = float(entity.dxf.ratio)
    if major_len < 1e-9 or ratio < 1e-9:
        raise InvalidFloorplanError("El CAD contiene una elipse degenerada.")
    unit_x, unit_y = major[0] / major_len, major[1] / major_len
    minor_x, minor_y = -unit_y, unit_x
    minor_len = major_len * ratio
    start_param = float(entity.dxf.start_param)
    end_param = float(entity.dxf.end_param)
    sweep = (end_param - start_param) % (2 * math.pi)
    if sweep < 1e-9:
        sweep = 2 * math.pi
    steps = max(16, min(max_steps, int(sweep / (math.pi / 36)) + 2))
    points: list[list[float]] = []
    for index in range(steps + 1):
        param = start_param + sweep * index / steps
        cosine, sine = math.cos(param), math.sin(param)
        points.append(
            _xy(
                (
                    center[0] + major_len * cosine * unit_x
                    + minor_len * sine * minor_x,
                    center[1] + major_len * cosine * unit_y
                    + minor_len * sine * minor_y,
                )
            )
        )
    return points


def _sample_spline(entity: Any, max_steps: int = 160) -> list[list[float]]:
    raw: list[Any] = []
    try:
        tool = entity.construction_tool()
        raw = list(tool.approximate(max_steps))
    except Exception:
        raw = []
    if not raw:
        raw = list(entity.fit_points or [])
    if not raw:
        raw = list(entity.control_points or [])
    if len(raw) < 2:
        raise InvalidFloorplanError(
            "El CAD contiene una SPLINE sin puntos de control ni ajuste."
        )
    return [_xy(point) for point in raw]


def _entity_points(entity: Any) -> tuple[str, list[list[float]], bool] | None:
    kind = entity.dxftype()
    if kind == "LINE":
        return "line", [_xy(entity.dxf.start), _xy(entity.dxf.end)], False
    if kind == "ARC":
        return "polyline", _sample_arc(entity), False
    if kind == "CIRCLE":
        return "polyline", _sample_circle(entity.dxf.center, float(entity.dxf.radius)), True
    if kind == "ELLIPSE":
        return "polyline", _sample_ellipse(entity), False
    if kind == "SPLINE":
        closed = bool(getattr(entity, "is_closed", False))
        return "polyline", _sample_spline(entity), closed
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


def _rotated_kernel(length: int, thickness: int, angle_deg: float) -> np.ndarray:
    kernel = np.zeros((length, length), dtype=np.uint8)
    center = (length - 1) / 2.0
    radians = math.radians(angle_deg)
    dx = math.cos(radians) * center
    dy = math.sin(radians) * center
    cv2.line(
        kernel,
        (int(round(center - dx)), int(round(center + dy))),
        (int(round(center + dx)), int(round(center - dy))),
        255,
        thickness,
    )
    return kernel


def _chain_length(points: np.ndarray) -> float:
    if len(points) < 2:
        return 0.0
    deltas = np.diff(points, axis=0)
    return float(np.hypot(deltas[:, 0], deltas[:, 1]).sum())


def _resample_chain(points: np.ndarray, step: float) -> np.ndarray:
    if len(points) < 2:
        return points
    total = _chain_length(points)
    if total < 1e-6:
        return points[:1]
    count = max(2, int(round(total / step)) + 1)
    target = total / (count - 1)
    output: list[np.ndarray] = [points[0]]
    next_distance = target
    traveled = 0.0
    for index in range(len(points) - 1):
        start = points[index]
        end = points[index + 1]
        segment = math.dist(start, end)
        if segment < 1e-9:
            continue
        while traveled + segment >= next_distance:
            fraction = (next_distance - traveled) / segment
            output.append(start + (end - start) * fraction)
            next_distance += target
            if len(output) >= count:
                break
        traveled += segment
        if len(output) >= count:
            break
    output.append(points[-1])
    return np.asarray(output)


def _chord_deviation(points: np.ndarray) -> float:
    start = points[0]
    end = points[-1]
    chord = end - start
    norm = math.hypot(float(chord[0]), float(chord[1]))
    if norm < 1e-6:
        return float("inf")
    normal = np.array([-chord[1], chord[0]]) / norm
    return float(np.max(np.abs((points - start) @ normal)))


def _split_at_sharp_turns(
    points: np.ndarray, max_angle: float
) -> list[np.ndarray]:
    if len(points) < 3:
        return [points]
    chains: list[np.ndarray] = []
    start = 0
    for index in range(1, len(points) - 1):
        v1 = points[index] - points[index - 1]
        v2 = points[index + 1] - points[index]
        n1 = math.hypot(float(v1[0]), float(v1[1]))
        n2 = math.hypot(float(v2[0]), float(v2[1]))
        if n1 < 1e-9 or n2 < 1e-9:
            continue
        cosine = float(np.dot(v1, v2) / (n1 * n2))
        if math.acos(max(-1.0, min(1.0, cosine))) > max_angle:
            chains.append(points[start : index + 1])
            start = index
    chains.append(points[start:])
    return [chain for chain in chains if len(chain) >= 2]


def _contour_of(points: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(points, dtype=np.int32).reshape(-1, 1, 2)


def _stroke_centerline(
    contour: np.ndarray, samples: int = 64
) -> np.ndarray | None:
    points = contour.reshape(-1, 2).astype(np.float64)
    if len(points) < 6:
        return None
    rectangle = cv2.minAreaRect(_contour_of(points))
    box = cv2.boxPoints(rectangle).astype(np.float64)
    edge_a = float(np.linalg.norm(box[1] - box[0]))
    edge_b = float(np.linalg.norm(box[2] - box[1]))
    axis = box[1] - box[0] if edge_a >= edge_b else box[2] - box[1]
    norm = float(np.linalg.norm(axis))
    if norm < 1e-6:
        return None
    axis = axis / norm
    projections = points @ axis
    start_index = int(np.argmin(projections))
    end_index = int(np.argmax(projections))
    if start_index == end_index:
        return None
    low, high = sorted((start_index, end_index))
    chain_a = points[low : high + 1]
    # La cadena B va de Q a P; se invierte para alinearla con la
    # cadena A por posicion de arco desde el mismo extremo.
    chain_b = np.vstack([points[high:], points[: low + 1]])[::-1]
    if len(chain_a) < 2 or len(chain_b) < 2:
        return None
    half_length = _chain_length(points) / 2.0
    step = max(1.0, half_length / max(samples - 1, 1))
    resampled_a = _resample_chain(chain_a, step)
    resampled_b = _resample_chain(chain_b, step)
    if len(resampled_a) < 3 or len(resampled_b) < 3:
        return None
    count = min(len(resampled_a), len(resampled_b))
    return (resampled_a[:count] + resampled_b[:count]) / 2.0


def _ring_centerline(
    crop: np.ndarray, ink_area: int, max_iterations: int = 40
) -> np.ndarray | None:
    work = crop.copy()
    target = max(8, int(ink_area * 0.3))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    previous: np.ndarray | None = None
    for _ in range(max_iterations):
        eroded = cv2.erode(work, kernel)
        remaining = cv2.countNonZero(eroded)
        if remaining < 8:
            break
        contours, _ = cv2.findContours(
            eroded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        significant = [
            candidate
            for candidate in contours
            if cv2.arcLength(candidate, True) >= 24.0
        ]
        if not significant:
            break
        if len(significant) > 1:
            # La erosion rompio el trazo en fragmentos:
            # el ultimo resto conectado es el centroide.
            break
        previous = eroded
        work = eroded
        if remaining <= target:
            break
    if previous is None:
        return None
    contours, _ = cv2.findContours(
        previous, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    centerline = max(
        contours, key=lambda candidate: cv2.arcLength(candidate, True)
    )
    if cv2.arcLength(centerline, True) < 1:
        return None
    return centerline.reshape(-1, 2).astype(np.float64)


def _axis_aligned_segment(
    contour: np.ndarray, rectangle: tuple
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    (center_x, center_y), (rect_width, rect_height), _ = rectangle
    box = cv2.boxPoints(rectangle).astype(np.float64)
    edge_a = float(np.linalg.norm(box[1] - box[0]))
    edge_b = float(np.linalg.norm(box[2] - box[1]))
    direction = box[1] - box[0] if edge_a >= edge_b else box[2] - box[1]
    norm = float(np.linalg.norm(direction))
    if norm < 1e-6:
        return None
    direction = direction / norm
    if direction[0] < 0:
        direction = -direction
    center = np.array([center_x, center_y])
    half = max(rect_width, rect_height) / 2.0
    start = center - direction * half
    end = center + direction * half
    angle = abs(math.degrees(math.atan2(direction[1], direction[0])))
    angle = min(angle, 180.0 - angle)
    if angle <= 3.0:
        axis_y = float(start[1] + end[1]) / 2
        xs = sorted((float(start[0]), float(end[0])))
        return (
            np.array([xs[0], axis_y]),
            np.array([xs[1], axis_y]),
            np.array([1.0, 0.0]),
        )
    if angle >= 87.0:
        axis_x = float(start[0] + end[0]) / 2
        ys = sorted((float(start[1]), float(end[1])))
        return (
            np.array([axis_x, ys[0]]),
            np.array([axis_x, ys[1]]),
            np.array([0.0, 1.0]),
        )
    return start, end, direction


def _merge_directional_segments(
    segments: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    collinear_tolerance: float,
    merge_gap: float,
) -> list[tuple[np.ndarray, np.ndarray]]:
    groups: list[dict[str, Any]] = []
    for start, end, direction in segments:
        group_direction = np.asarray(direction, dtype=np.float64)
        perpendicular = np.array([-group_direction[1], group_direction[0]])
        projection_start = float(np.dot(start, group_direction))
        projection_end = float(np.dot(end, group_direction))
        if projection_end < projection_start:
            projection_start, projection_end = projection_end, projection_start
        offset = float(np.dot(start, perpendicular))
        match = None
        for group in reversed(groups):
            group_direction_existing = np.asarray(
                group["direction"], dtype=np.float64
            )
            group_perpendicular = np.array(
                [
                    -group_direction_existing[1],
                    group_direction_existing[0],
                ]
            )
            group_offset = float(np.dot(start, group_perpendicular))
            group_projection_start = float(
                np.dot(start, group_direction_existing)
            )
            group_projection_end = float(np.dot(end, group_direction_existing))
            if group_projection_end < group_projection_start:
                group_projection_start, group_projection_end = (
                    group_projection_end,
                    group_projection_start,
                )
            gap = group_projection_start - group["projection_end"]
            alignment = float(np.dot(group_direction_existing, group_direction))
            if (
                alignment >= 0.999
                and -merge_gap <= gap <= merge_gap
                and abs(group_offset - group["offset"]) <= collinear_tolerance
            ):
                match = group
                break
        if match is not None:
            match["projection_end"] = max(
                match["projection_end"], group_projection_end
            )
            match["offset"] = (match["offset"] + group_offset) / 2
        else:
            groups.append(
                {
                    "direction": group_direction,
                    "offset": offset,
                    "projection_start": projection_start,
                    "projection_end": projection_end,
                }
            )
    merged: list[tuple[np.ndarray, np.ndarray]] = []
    for group in groups:
        direction = np.asarray(group["direction"], dtype=np.float64)
        perpendicular = np.array([-direction[1], direction[0]])
        start = (
            direction * group["projection_start"]
            + perpendicular * group["offset"]
        )
        end = (
            direction * group["projection_end"]
            + perpendicular * group["offset"]
        )
        merged.append((start, end))
    return merged


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

    entities: list[dict[str, Any]] = []
    curve_region = np.zeros_like(closed)

    # Curved pass: bay windows, arcs and circular/elliptical wall rings keep
    # their curvature instead of being crushed into axis-aligned boxes.
    contours, _ = cv2.findContours(
        closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        area = abs(float(cv2.contourArea(contour)))
        if area < min_contour_area:
            continue
        rectangle = cv2.minAreaRect(contour)
        rect_width, rect_height = rectangle[1]
        stroke_length = max(rect_width, rect_height)
        stroke_thickness = min(rect_width, rect_height)
        if stroke_length < line_length or stroke_thickness < line_thickness:
            continue
        aspect_ratio = stroke_length / max(stroke_thickness, 1)
        x, y, box_width, box_height = cv2.boundingRect(contour)
        crop = closed[y : y + box_height, x : x + box_width]
        centerline: np.ndarray | None = None
        is_closed_ring = False
        measured_thickness = stroke_thickness
        if aspect_ratio >= 2.0:
            if stroke_thickness > max_line_thickness:
                continue
            centerline = _stroke_centerline(contour)
        else:
            # La transformada de distancia mide el grosor
            # real del trazo: descarta solidos (mesas,
            # habitaciones rellenas) y conserva anillos
            # finos y arcos anchos.
            distances = cv2.distanceTransform(
                crop, cv2.DIST_L2, 3
            )
            local_thickness = 2.0 * float(distances.max())
            if local_thickness > max_line_thickness:
                continue
            measured_thickness = max(
                stroke_thickness, local_thickness
            )
            centerline = _ring_centerline(
                crop, cv2.countNonZero(crop)
            )
            if centerline is not None:
                remnant = cv2.minAreaRect(
                    _contour_of(centerline)
                )
                remnant_width, remnant_height = remnant[1]
                remnant_aspect = max(
                    remnant_width, remnant_height
                ) / max(min(remnant_width, remnant_height), 1.0)
                if remnant_aspect >= 1.8:
                    # Resto de arco abierto: centroide por cadenas.
                    centerline = _stroke_centerline(
                        _contour_of(centerline)
                    )
                else:
                    is_closed_ring = True
        if centerline is None:
            continue
        simplified = cv2.approxPolyDP(
            centerline.astype(np.float32),
            max(1.0, measured_thickness * 0.3),
            False,
        ).reshape(-1, 2)
        if len(simplified) < 3:
            continue
        # Una curva unida a muros rectos se parte en las
        # esquinas y uniones; solo se conservan los tramos
        # curvos y los rectos quedan a las pasadas
        # direccionales.
        chains = _split_at_sharp_turns(
            simplified.astype(np.float64), math.radians(40)
        )
        for chain in chains:
            if len(chain) < 3:
                continue
            if (
                _chord_deviation(chain)
                <= max(2.0, measured_thickness * 1.25)
            ):
                continue
            resampled = _resample_chain(
                chain, max(2.0, measured_thickness * 0.5)
            )
            if len(resampled) > 96:
                stride = math.ceil(len(resampled) / 96)
                resampled = np.vstack(
                    [resampled[::stride], resampled[-1:]]
                )
            if len(resampled) < 3:
                continue
            if len(entities) < MAX_RASTER_ENTITIES:
                entities.append(
                    {
                        "type": "polyline",
                        "role": "wall_candidate",
                        "layer": None,
                        "points": [
                            [round(float(point[0])), round(float(point[1]))]
                            for point in resampled
                        ],
                        "closed": is_closed_ring and len(chains) == 1,
                        "confidence": 0.35,
                    }
                )
            cv2.polylines(
                curve_region,
                [_contour_of(resampled)],
                False,
                255,
                max(3, int(measured_thickness)),
            )

    # Directional pass over the curve-free mask at four orientations so
    # diagonal walls survive instead of collapsing into square blocks.
    working = cv2.subtract(
        closed,
        cv2.dilate(
            curve_region, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        ),
    )
    directional_segments: list[
        tuple[np.ndarray, np.ndarray, np.ndarray]
    ] = []
    for angle in (0, 45, 90, 135):
        mask = cv2.morphologyEx(
            working, cv2.MORPH_OPEN, _rotated_kernel(kernel_length, line_thickness, angle)
        )
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            _rotated_kernel(max(3, kernel_length // 4), 1, angle),
        )
        mask_contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        for contour in mask_contours:
            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue
            area = abs(float(cv2.contourArea(contour)))
            if area < min_contour_area:
                continue
            rectangle = cv2.minAreaRect(contour)
            rect_width, rect_height = rectangle[1]
            segment_length = max(rect_width, rect_height)
            segment_thickness = min(rect_width, rect_height)
            if (
                segment_length < line_length
                or segment_thickness < line_thickness
                or segment_thickness > max_line_thickness
            ):
                continue
            if segment_length / max(segment_thickness, 1) < 3.5:
                continue
            segment = _axis_aligned_segment(contour, rectangle)
            if segment is not None:
                directional_segments.append(segment)

    merge_distance = max(4.0, kernel_length // 4)
    for start, end in _merge_directional_segments(
        directional_segments, 4.0, merge_distance
    ):
        if len(entities) >= MAX_RASTER_ENTITIES:
            break
        entities.append(
            {
                "type": "line",
                "role": "wall_candidate",
                "layer": None,
                "points": [
                    [round(float(start[0])), round(float(start[1]))],
                    [round(float(end[0])), round(float(end[1]))],
                ],
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


def _fuse_wall_pieces(pieces: list[Any]) -> Any:
    import trimesh

    if 1 < len(pieces) <= 8000:
        try:
            fused = trimesh.boolean.union(pieces)
            if (
                fused is not None
                and not fused.is_empty
                and np.isfinite(fused.vertices).all()
            ):
                reference = trimesh.util.concatenate(pieces)
                if np.allclose(
                    fused.bounds, reference.bounds, atol=1e-6
                ):
                    return fused
        except Exception:
            pass
    mesh = trimesh.util.concatenate(pieces)
    mesh.merge_vertices()
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
        segments = _entity_segments(wall)
        total_length = (
            sum(math.dist(start, end) for start, end in segments) * scale
        )
        if total_length < 0.25:
            continue
        for index, (raw_start, raw_end) in enumerate(segments):
            start = [raw_start[0] * scale, raw_start[1] * scale]
            end = [raw_end[0] * scale, raw_end[1] * scale]
            dx, dz = end[0] - start[0], end[1] - start[1]
            wall_length = math.hypot(dx, dz)
            if wall_length < 1e-3:
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
                    *(
                        value
                        for interval in intervals
                        for value in interval[:2]
                    ),
                }
            )
            # Las uniones interiores de una polilínea (muros
            # curvos, contornos cerrados o lazos) se solapan
            # para que los tramos se fusionen en una malla
            # continua, sin huecos ni bloques aislados.
            overlap = 0.0
            if len(segments) > 1:
                overlap = min(
                    wall_thickness_m * 0.5, wall_length * 0.2
                )
            is_loop = bool(wall.get("closed")) and len(segments) > 2
            lead = overlap if index > 0 or is_loop else 0.0
            trail = (
                overlap
                if index < len(segments) - 1 or is_loop
                else 0.0
            )
            piece_start = [
                start[0] - unit_x * lead,
                start[1] - unit_z * lead,
            ]
            if lead > 0:
                breakpoints[0] = breakpoints[0] - lead
            if trail > 0:
                breakpoints[-1] = breakpoints[-1] + trail
            for segment_start, segment_end in itertools.pairwise(breakpoints):
                segment_length = segment_end - segment_start
                if segment_length < 1e-4:
                    continue
                midpoint = (segment_start + segment_end) / 2
                unextended_midpoint = midpoint - lead
                opening_type = next(
                    (
                        role
                        for interval_start, interval_end, role in intervals
                        if interval_start <= unextended_midpoint <= interval_end
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
                            piece_start,
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
    mesh = _fuse_wall_pieces(pieces)
    if mesh.is_empty or not np.isfinite(mesh.vertices).all():
        raise InvalidFloorplanError("La extrusión del plano generó una malla no válida.")
    exported = trimesh.Scene(mesh).export(file_type="glb")
    if not isinstance(exported, bytes) or not exported:
        raise InvalidFloorplanError("No se pudo serializar el modelo 3D generado.")
    return exported
