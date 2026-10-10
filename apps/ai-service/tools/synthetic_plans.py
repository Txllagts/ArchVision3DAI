"""Planos sintéticos deterministas para medir la detección de muros raster.

Esta utilería vive fuera del runtime de la aplicación: nada de ``tools`` se
importa desde ``app``. Genera planos con geometría conocida (muros, puertas y
ventanas), los puede degradar como si fueran croquis escaneados y expone la
verdad de referencia para compararla contra ``analyze_floorplan``.

Transformaciones de degradación:

* Geométricas (se aplican también a las etiquetas y al ground truth): rotación,
  escala uniforme, cizalladura y una leve perspectiva.
* Fotométricas (solo afectan a los píxeles): desenfoque, gradiente de
  iluminación, ruido gaussiano, reducción de contraste, compresión JPEG,
  manchas y tinte de papel.

La condición de consistencia se cumple porque todas las transformaciones
geométricas se componen en una homografía 3x3 que ``degrade`` devuelve; quien
orqueste la degradación (``degrade_plan``) la aplica exactamente igual a muros,
aberturas y etiquetas.
"""

from __future__ import annotations

import io
import json
import math
import random
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Point = tuple[float, float]
Matrix = np.ndarray

# Clases YOLO-seg usadas por las etiquetas de aberturas.
CLASS_DOOR = 0
CLASS_WINDOW = 1

DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 768
MARGIN = 64.0
WALL_THICKNESS_RANGE = (12.0, 20.0)
DOOR_WIDTH_RANGE = (80.0, 100.0)
WINDOW_WIDTH_RANGE = (110.0, 170.0)
MIN_END_MARGIN = 40.0
STROKE_COLOR = (35, 35, 35)
PAPER_COLOR = (255, 255, 255)
THIN_STROKE = 2

# Nombres de las transformaciones, útiles para el reporte y para tests.
GEO_TRANSFORMS = ("rotate", "scale", "shear", "perspective")
PHOTO_TRANSFORMS = (
    "blur",
    "illumination_gradient",
    "gaussian_noise",
    "contrast",
    "jpeg",
    "smudge",
    "paper_tint",
)

__all__ = [
    "CLASS_DOOR",
    "CLASS_WINDOW",
    "DEFAULT_HEIGHT",
    "DEFAULT_WIDTH",
    "GEO_TRANSFORMS",
    "PHOTO_TRANSFORMS",
    "DegradedImage",
    "Opening",
    "SyntheticPlan",
    "Wall",
    "apply_homography",
    "degrade",
    "degrade_isolated",
    "degrade_plan",
    "degrade_plan_isolated",
    "hand_shadow",
    "illumination_gradient",
    "illuminate_plan",
    "rotate_plan",
    "shear_plan",
    "generate_dataset",
    "generate_plan",
    "plan_ground_truth",
    "plan_yolo_lines",
    "render_annotated_image",
    "render_contact_sheet",
    "write_plan",
]


# ---------------------------------------------------------------------------
# Geometría de referencia
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Wall:
    """Muro como segmento de línea central con espesor constante."""

    index: int
    start: Point
    end: Point
    thickness: float
    external: bool

    @property
    def length(self) -> float:
        return _distance(self.start, self.end)

    @property
    def direction(self) -> Point:
        return _unit(self.start, self.end)

    def point_at(self, offset: float) -> Point:
        """Punto sobre la línea central a ``offset`` px desde el inicio."""

        return _point_along(self, offset)


@dataclass(frozen=True)
class Opening:
    """Abertura conocida sobre un muro (índice, offset y ancho)."""

    index: int
    kind: str  # "door" | "window"
    wall_index: int
    offset: float
    width: float
    start: Point
    end: Point
    # Solo para dibujar la hoja de la puerta; no forma parte del contrato.
    hinge_at_start: bool = True
    side: int = 1


@dataclass
class SyntheticPlan:
    """Plano sintético: imagen más su geometría de referencia."""

    name: str
    image: Image.Image
    width: int
    height: int
    walls: list[Wall]
    openings: list[Opening]


@dataclass
class DegradedImage:
    """Resultado de ``degrade``: imagen degradada y su homografía."""

    image: Image.Image
    matrix: Matrix

    def apply_points(
        self, points: Iterable[Point]
    ) -> list[Point]:
        return apply_homography(points, self.matrix)


# ---------------------------------------------------------------------------
# Utilidades vectoriales y homográficas
# ---------------------------------------------------------------------------


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _unit(a: Point, b: Point) -> Point:
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = math.hypot(dx, dy)
    if norm <= 1e-9:
        return (0.0, 0.0)
    return (dx / norm, dy / norm)


def _point_along(wall: Wall, offset: float) -> Point:
    ux, uy = wall.direction
    return (wall.start[0] + ux * offset, wall.start[1] + uy * offset)


def apply_homography(points: Iterable[Point], matrix: Matrix) -> list[Point]:
    """Aplica una homografía 3x3 a puntos 2D (con división homogénea)."""

    result: list[Point] = []
    for x, y in points:
        vector = matrix @ np.array([x, y, 1.0], dtype=np.float64)
        w = float(vector[2])
        if abs(w) <= 1e-12:
            w = 1.0
        result.append((float(vector[0] / w), float(vector[1] / w)))
    return result


def _homography_from_quad(source: Sequence[Point], target: Sequence[Point]) -> Matrix:
    """Homografía que mapea los 4 puntos de ``source`` a los de ``target``."""

    rows: list[list[float]] = []
    values: list[float] = []
    for (x, y), (u, v) in zip(source, target):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        values.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values.append(v)
    system = np.asarray(rows, dtype=np.float64)
    solution = np.linalg.solve(system, np.asarray(values, dtype=np.float64))
    matrix = np.identity(3, dtype=np.float64)
    matrix[0, 0], matrix[0, 1], matrix[0, 2] = solution[0], solution[1], solution[2]
    matrix[1, 0], matrix[1, 1], matrix[1, 2] = solution[3], solution[4], solution[5]
    matrix[2, 0], matrix[2, 1] = solution[6], solution[7]
    return matrix


def _corner_bounds(corners: Iterable[Point]) -> tuple[float, float, float, float]:
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------------------
# Generación del plano
# ---------------------------------------------------------------------------


def _grid_lines(start: float, end: float, divisions: int) -> list[float]:
    step = (end - start) / divisions
    return [start + step * index for index in range(divisions + 1)]


def _build_walls(
    xs: Sequence[float],
    ys: Sequence[float],
    rng: random.Random,
) -> list[Wall]:
    """Muros sobre una retícula: verticales (i) y horizontales (j)."""

    walls: list[Wall] = []
    cols = len(xs) - 1
    rows = len(ys) - 1
    index = 0
    for i in range(cols + 1):
        external = i in (0, cols)
        thickness = round(rng.uniform(*WALL_THICKNESS_RANGE), 2)
        walls.append(
            Wall(
                index=index,
                start=(xs[i], ys[0]),
                end=(xs[i], ys[-1]),
                thickness=thickness,
                external=external,
            )
        )
        index += 1
    for j in range(rows + 1):
        external = j in (0, rows)
        thickness = round(rng.uniform(*WALL_THICKNESS_RANGE), 2)
        walls.append(
            Wall(
                index=index,
                start=(xs[0], ys[j]),
                end=(xs[-1], ys[j]),
                thickness=thickness,
                external=external,
            )
        )
        index += 1
    return walls


def _place_openings(
    walls: Sequence[Wall], rng: random.Random
) -> list[Opening]:
    """Reparte puertas (interiores) y ventanas (exteriores) sin solaparse."""

    openings: list[Opening] = []
    index = 0
    for wall in walls:
        length = wall.length
        smallest = min(DOOR_WIDTH_RANGE[0], WINDOW_WIDTH_RANGE[0])
        if length < 2 * MIN_END_MARGIN + smallest:
            continue
        count = rng.choices([0, 1, 2], weights=[0.20, 0.62, 0.18])[0]
        placed: list[tuple[float, float, str]] = []
        attempts = 0
        while len(placed) < count and attempts < 24:
            attempts += 1
            if wall.external and rng.random() >= 0.12:
                kind = "window"
            elif wall.external:
                kind = "door"  # puerta de entrada ocasional
            else:
                kind = "door"
            low, high = (
                WINDOW_WIDTH_RANGE if kind == "window" else DOOR_WIDTH_RANGE
            )
            width = rng.uniform(low, high)
            if length < 2 * MIN_END_MARGIN + width:
                continue
            center = rng.uniform(
                MIN_END_MARGIN + width / 2,
                length - MIN_END_MARGIN - width / 2,
            )
            too_close = any(
                abs(center - other_center) < (width + other_width) / 2 + 24
                for other_center, other_width, _ in placed
            )
            if too_close:
                continue
            placed.append((center, width, kind))
        placed.sort()
        for center, width, kind in placed:
            start_offset = center - width / 2
            end_offset = center + width / 2
            openings.append(
                Opening(
                    index=index,
                    kind=kind,
                    wall_index=wall.index,
                    offset=round(start_offset, 2),
                    width=round(width, 2),
                    start=_point_along(wall, start_offset),
                    end=_point_along(wall, end_offset),
                    hinge_at_start=rng.random() < 0.5,
                    side=1,
                )
            )
            index += 1
    return openings


def _opening_side(wall: Wall, center: Point, rng: random.Random) -> int:
    """Elige hacia dónde abre una puerta.

    En muros exteriores empuja la hoja hacia el centro del plano (evita que el
    arco se recorte contra el borde); en interiores elige un lado al azar.
    """

    if not wall.external:
        return 1 if rng.random() < 0.5 else -1
    ux, uy = wall.direction
    normal = (-uy, ux)
    midpoint = (
        (wall.start[0] + wall.end[0]) / 2,
        (wall.start[1] + wall.end[1]) / 2,
    )
    toward = (center[0] - midpoint[0], center[1] - midpoint[1])
    dot = normal[0] * toward[0] + normal[1] * toward[1]
    return 1 if dot >= 0 else -1


def _draw_arc(
    draw: ImageDraw.ImageDraw,
    center: Point,
    radius: float,
    start_angle: float,
    end_angle: float,
    color: tuple[int, int, int],
    width: int,
    steps: int = 18,
) -> None:
    delta = (end_angle - start_angle + math.pi) % (2 * math.pi) - math.pi
    points = [
        (
            center[0] + radius * math.cos(start_angle + delta * t / steps),
            center[1] + radius * math.sin(start_angle + delta * t / steps),
        )
        for t in range(steps + 1)
    ]
    draw.line(points, fill=color, width=width)


def _render_image(
    width: int,
    height: int,
    walls: Sequence[Wall],
    openings: Sequence[Opening],
) -> Image.Image:
    """Dibuja muros (con huecos), puertas (hueco + arco) y ventanas (doble línea)."""

    image = Image.new("RGB", (width, height), PAPER_COLOR)
    draw = ImageDraw.Draw(image)

    openings_by_wall: dict[int, list[Opening]] = {}
    for opening in openings:
        openings_by_wall.setdefault(opening.wall_index, []).append(opening)

    for wall in walls:
        ux, uy = wall.direction
        thickness = int(round(wall.thickness))
        wall_openings = sorted(
            openings_by_wall.get(wall.index, []), key=lambda item: item.offset
        )
        cursor = 0.0
        for opening in wall_openings:
            gap_start = opening.offset
            gap_end = opening.offset + opening.width
            if gap_start - cursor > 1.0:
                draw.line(
                    [_point_along(wall, cursor), _point_along(wall, gap_start)],
                    fill=STROKE_COLOR,
                    width=thickness,
                )
            cursor = max(cursor, gap_end)
        if wall.length - cursor > 1.0:
            draw.line(
                [_point_along(wall, cursor), _point_along(wall, wall.length)],
                fill=STROKE_COLOR,
                width=thickness,
            )

        normal = (-uy, ux)
        for opening in wall_openings:
            if opening.kind == "window":
                gap = wall.thickness * 0.25
                for sign in (1.0, -1.0):
                    offset = (normal[0] * gap * sign, normal[1] * gap * sign)
                    draw.line(
                        [
                            (opening.start[0] + offset[0], opening.start[1] + offset[1]),
                            (opening.end[0] + offset[0], opening.end[1] + offset[1]),
                        ],
                        fill=STROKE_COLOR,
                        width=THIN_STROKE,
                    )
            else:
                _draw_door(draw, wall, opening, normal)

    return image


def _draw_door(
    draw: ImageDraw.ImageDraw,
    wall: Wall,
    opening: Opening,
    normal: Point,
) -> None:
    """Hoja de puerta: línea recta más arco de barrido de 90 grados."""

    side = opening.side if opening.side != 0 else 1
    direction = (normal[0] * side, normal[1] * side)
    hinge = opening.start if opening.hinge_at_start else opening.end
    latch = opening.end if opening.hinge_at_start else opening.start
    leaf_end = (
        hinge[0] + direction[0] * opening.width,
        hinge[1] + direction[1] * opening.width,
    )
    draw.line([hinge, leaf_end], fill=STROKE_COLOR, width=THIN_STROKE)
    start_angle = math.atan2(latch[1] - hinge[1], latch[0] - hinge[0])
    end_angle = math.atan2(leaf_end[1] - hinge[1], leaf_end[0] - hinge[0])
    _draw_arc(
        draw,
        hinge,
        opening.width,
        start_angle,
        end_angle,
        STROKE_COLOR,
        THIN_STROKE,
    )


def generate_plan(
    seed: int,
    name: str | None = None,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    margin: float = MARGIN,
) -> SyntheticPlan:
    """Genera un plano determinista a partir de una semilla entera."""

    rng = random.Random(seed)
    cols, rows = rng.choice([(1, 1), (2, 1), (1, 2), (2, 2), (3, 1)])
    x0, x1 = margin, width - margin
    y0, y1 = margin, height - margin
    xs = _grid_lines(x0, x1, cols)
    ys = _grid_lines(y0, y1, rows)
    walls = _build_walls(xs, ys, rng)
    openings = _place_openings(walls, rng)
    # Decide el lado de cada puerta con el mismo rng para reproducibilidad.
    resolved: list[Opening] = []
    plan_center = (width / 2, height / 2)
    for opening in openings:
        wall = walls[opening.wall_index]
        resolved.append(replace(opening, side=_opening_side(wall, plan_center, rng)))
    image = _render_image(width, height, walls, resolved)
    plan_name = name if name is not None else f"plan_{seed:06d}"
    return SyntheticPlan(
        name=plan_name,
        image=image,
        width=width,
        height=height,
        walls=walls,
        openings=resolved,
    )


# ---------------------------------------------------------------------------
# Verdad de referencia y etiquetas
# ---------------------------------------------------------------------------


def _opening_polygon(opening: Opening, wall: Wall) -> list[Point]:
    ux, uy = wall.direction
    nx, ny = -uy, ux
    half = wall.thickness / 2
    return [
        (opening.start[0] + nx * half, opening.start[1] + ny * half),
        (opening.end[0] + nx * half, opening.end[1] + ny * half),
        (opening.end[0] - nx * half, opening.end[1] - ny * half),
        (opening.start[0] - nx * half, opening.start[1] - ny * half),
    ]


def plan_ground_truth(plan: SyntheticPlan) -> dict[str, Any]:
    """Ground truth serializable: muros en px y aberturas con offset/ancho."""

    walls = [
        {
            "index": wall.index,
            "start": [round(wall.start[0], 2), round(wall.start[1], 2)],
            "end": [round(wall.end[0], 2), round(wall.end[1], 2)],
            "thickness": round(wall.thickness, 2),
            "length": round(wall.length, 2),
            "external": wall.external,
        }
        for wall in plan.walls
    ]
    by_index = {wall.index: wall for wall in plan.walls}
    openings = []
    for opening in plan.openings:
        wall = by_index[opening.wall_index]
        polygon = _opening_polygon(opening, wall)
        center = (
            (opening.start[0] + opening.end[0]) / 2,
            (opening.start[1] + opening.end[1]) / 2,
        )
        openings.append(
            {
                "index": opening.index,
                "type": opening.kind,
                "wall_index": opening.wall_index,
                "offset": round(opening.offset, 2),
                "width": round(opening.width, 2),
                "center": [round(center[0], 2), round(center[1], 2)],
                "start": [round(opening.start[0], 2), round(opening.start[1], 2)],
                "end": [round(opening.end[0], 2), round(opening.end[1], 2)],
                "polygon": [
                    [round(point[0], 2), round(point[1], 2)] for point in polygon
                ],
            }
        )
    return {
        "image_size": {"width": plan.width, "height": plan.height},
        "walls": walls,
        "openings": openings,
    }


def plan_yolo_lines(plan: SyntheticPlan) -> list[str]:
    """Etiquetas YOLO-seg: clase + polígono normalizado [0, 1]."""

    by_index = {wall.index: wall for wall in plan.walls}
    lines: list[str] = []
    for opening in plan.openings:
        wall = by_index[opening.wall_index]
        label = CLASS_DOOR if opening.kind == "door" else CLASS_WINDOW
        polygon = _opening_polygon(opening, wall)
        coordinates = " ".join(
            f"{value:.6f}"
            for point in polygon
            for value in (point[0] / plan.width, point[1] / plan.height)
        )
        lines.append(f"{label} {coordinates}")
    return lines


def write_plan(plan: SyntheticPlan, output_dir: str | Path) -> dict[str, Path]:
    """Escribe PNG, ground_truth.json y etiquetas YOLO-seg de un plano."""

    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    image_path = directory / f"{plan.name}.png"
    truth_path = directory / f"{plan.name}.ground_truth.json"
    label_path = directory / f"{plan.name}.txt"
    plan.image.save(image_path)
    truth_path.write_text(
        json.dumps(plan_ground_truth(plan), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    label_path.write_text("\n".join(plan_yolo_lines(plan)) + "\n", encoding="utf-8")
    return {"image": image_path, "truth": truth_path, "labels": label_path}


def generate_dataset(
    count: int,
    output_dir: str | Path,
    base_seed: int = 20260101,
) -> list[SyntheticPlan]:
    """Genera y escribe ``count`` planos deterministas (semillas consecutivas)."""

    plans: list[SyntheticPlan] = []
    for offset in range(count):
        plan = generate_plan(base_seed + offset, name=f"plan_{offset:03d}")
        write_plan(plan, output_dir)
        plans.append(plan)
    return plans


# ---------------------------------------------------------------------------
# Degradación
# ---------------------------------------------------------------------------


def _build_homography(
    rng: random.Random,
    width: int,
    height: int,
    strength: float,
    enabled: set[str] | None = None,
) -> tuple[Matrix, tuple[int, int]]:
    """Compone las transformaciones geométricas habilitadas y el lienzo destino.

    ``enabled`` permite aislar una sola transformación geométrica (ablación).
    Si es ``None`` se aplican todas las de ``GEO_TRANSFORMS``.
    """

    if enabled is None:
        enabled = set(GEO_TRANSFORMS)

    center_x, center_y = width / 2, height / 2
    to_center = np.array(
        [[1.0, 0.0, -center_x], [0.0, 1.0, -center_y], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    from_center = np.array(
        [[1.0, 0.0, center_x], [0.0, 1.0, center_y], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )

    angle = math.radians(rng.uniform(-1.0, 1.0) * 6.0 * strength) if "rotate" in enabled else 0.0
    scale = 1.0 + rng.uniform(-1.0, 1.0) * 0.05 * strength if "scale" in enabled else 1.0
    shear_x = rng.uniform(-1.0, 1.0) * 0.06 * strength if "shear" in enabled else 0.0
    shear_y = rng.uniform(-1.0, 1.0) * 0.06 * strength if "shear" in enabled else 0.0

    combined = np.identity(3, dtype=np.float64)
    if "scale" in enabled:
        combined = np.array(
            [[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64
        ) @ combined
    if "shear" in enabled:
        combined = np.array(
            [[1.0, shear_x, 0.0], [shear_y, 1.0, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64
        ) @ combined
    if "rotate" in enabled:
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        combined = np.array(
            [[cos_a, -sin_a, 0.0], [sin_a, cos_a, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64
        ) @ combined

    affine = from_center @ combined @ to_center

    corners: list[Point] = [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)]
    if "perspective" in enabled:
        warped = apply_homography(corners, affine)
        jitter = 0.03 * strength * min(width, height)
        perturbed = [
            (x + rng.uniform(-1.0, 1.0) * jitter, y + rng.uniform(-1.0, 1.0) * jitter)
            for x, y in warped
        ]
        affine = _homography_from_quad(warped, perturbed) @ affine

    projected = apply_homography(corners, affine)
    min_x, min_y, max_x, max_y = _corner_bounds(projected)
    padding = 8.0
    translate = np.array(
        [[1.0, 0.0, -min_x + padding], [0.0, 1.0, -min_y + padding], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    matrix = translate @ affine
    out_width = int(round(max_x - min_x + 2 * padding))
    out_height = int(round(max_y - min_y + 2 * padding))
    return matrix, (max(out_width, 1), max(out_height, 1))


def _warp_image(image: Image.Image, matrix: Matrix, size: tuple[int, int]) -> Image.Image:
    inverse = np.linalg.inv(matrix)
    inverse = inverse / inverse[2, 2]
    coefficients = (
        float(inverse[0, 0]),
        float(inverse[0, 1]),
        float(inverse[0, 2]),
        float(inverse[1, 0]),
        float(inverse[1, 1]),
        float(inverse[1, 2]),
        float(inverse[2, 0]),
        float(inverse[2, 1]),
    )
    return image.transform(
        size,
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BILINEAR,
        fillcolor=PAPER_COLOR,
    )


def _to_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image, dtype=np.float64)


def _from_array(array: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB")


def _op_blur(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    radius = rng.uniform(0.4, 1.8) * strength
    if radius <= 0.05:
        return image
    return image.filter(ImageFilter.GaussianBlur(radius=radius))


def _op_illumination(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    array = _to_array(image)
    height, width = array.shape[:2]
    ramp_x = np.linspace(1.0 - 0.25 * strength, 1.0 + 0.10 * strength, width)
    ramp_y = np.linspace(1.0 - 0.10 * strength, 1.0 + 0.15 * strength, height)
    field = np.outer(ramp_y, ramp_x)[:, :, None]
    return _from_array(array * field)


def _op_noise(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    sigma = rng.uniform(3.0, 14.0) * strength
    if sigma <= 0.5:
        return image
    rng_np = np.random.default_rng(rng.getrandbits(32))
    array = _to_array(image)
    return _from_array(array + rng_np.normal(0.0, sigma, array.shape))


def _op_contrast(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    array = _to_array(image)
    factor = 1.0 - 0.35 * strength
    return _from_array((array - 127.5) * factor + 127.5)


def _op_jpeg(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    quality = int(round(85 - 45 * strength))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=max(20, quality))
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def _op_smudge(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    draw = ImageDraw.Draw(image)
    width, height = image.size
    for _ in range(int(round(1 + 3 * strength))):
        box_w = rng.uniform(0.03, 0.10) * width
        box_h = rng.uniform(0.02, 0.06) * height
        left = rng.uniform(0, width - box_w)
        top = rng.uniform(0, height - box_h)
        light = rng.randint(200, 245)
        draw.rectangle(
            (left, top, left + box_w, top + box_h), fill=(light, light, light)
        )
    return image


def _op_tint(image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    array = _to_array(image)
    return _from_array(array + rng.uniform(-8.0, 8.0) * strength)


# Registro de transformaciones fotométricas: cada una aplicable por separado.
PHOTO_OPS: dict[str, Callable[[Image.Image, random.Random, float], Image.Image]] = {
    "blur": _op_blur,
    "illumination_gradient": _op_illumination,
    "gaussian_noise": _op_noise,
    "contrast": _op_contrast,
    "jpeg": _op_jpeg,
    "smudge": _op_smudge,
    "paper_tint": _op_tint,
}


def _apply_photometric(
    image: Image.Image, rng: random.Random, strength: float
) -> Image.Image:
    """Aplica todas las transformaciones fotométricas en orden fijo."""

    for name in PHOTO_TRANSFORMS:
        image = PHOTO_OPS[name](image, rng, strength)
    return image


def _apply_photometric_single(
    image: Image.Image, rng: random.Random, name: str, strength: float
) -> Image.Image:
    """Aplica una única transformación fotométrica (ablación)."""

    return PHOTO_OPS[name](image, rng, strength)


def degrade(
    image: Image.Image, rng: random.Random, strength: float
) -> DegradedImage:
    """Degrada un plano. Devuelve imagen y la homografía geométrica aplicada.

    La homografía es la pieza que garantiza la consistencia: ``degrade_plan``
    la usa para transformar muros, aberturas y etiquetas con exactamente la
    misma deformación que sufrió la imagen.
    """

    if strength <= 0.0:
        identity = np.identity(3, dtype=np.float64)
        return DegradedImage(image=image.copy(), matrix=identity)

    width, height = image.size
    matrix, size = _build_homography(rng, width, height, strength)
    warped = _warp_image(image, matrix, size)
    result = _apply_photometric(warped, rng, strength)
    return DegradedImage(image=result, matrix=matrix)


def degrade_isolated(
    image: Image.Image,
    rng: random.Random,
    transform: str,
    strength: float,
) -> DegradedImage:
    """Aplica una única transformación (geometría o fotometría) en aislamiento.

    Útil para la tabla de ablación: cada transformación de ``GEO_TRANSFORMS`` o
    ``PHOTO_TRANSFORMS`` se aplica sola con intensidad fija.
    """

    if strength <= 0.0:
        return DegradedImage(image=image.copy(), matrix=np.identity(3, dtype=np.float64))

    if transform in GEO_TRANSFORMS:
        matrix, size = _build_homography(
            rng, image.width, image.height, strength, enabled={transform}
        )
        warped = _warp_image(image, matrix, size)
        return DegradedImage(image=warped, matrix=matrix)

    if transform in PHOTO_TRANSFORMS:
        result = _apply_photometric_single(image.copy(), rng, transform, strength)
        return DegradedImage(image=result, matrix=np.identity(3, dtype=np.float64))

    raise ValueError(f"Transformación desconocida: {transform!r}")


def _reproject_plan(
    plan: SyntheticPlan, image: Image.Image, matrix: Matrix
) -> SyntheticPlan:
    """Reconstruye el plano con la geometría transformada por ``matrix``."""

    new_walls: list[Wall] = []
    for wall in plan.walls:
        start, end = apply_homography([wall.start, wall.end], matrix)
        original_length = wall.length
        new_length = _distance(start, end)
        factor = new_length / original_length if original_length > 1e-9 else 1.0
        new_walls.append(
            replace(wall, start=start, end=end, thickness=wall.thickness * factor)
        )

    by_index = {wall.index: wall for wall in new_walls}
    new_openings: list[Opening] = []
    for opening in plan.openings:
        start, end = apply_homography([opening.start, opening.end], matrix)
        wall = by_index[opening.wall_index]
        direction = wall.direction
        offset = (
            (start[0] - wall.start[0]) * direction[0]
            + (start[1] - wall.start[1]) * direction[1]
        )
        new_openings.append(
            replace(opening, start=start, end=end, offset=offset, width=_distance(start, end))
        )

    return SyntheticPlan(
        name=plan.name,
        image=image,
        width=image.width,
        height=image.height,
        walls=new_walls,
        openings=new_openings,
    )


def degrade_plan(
    plan: SyntheticPlan, rng: random.Random, strength: float
) -> SyntheticPlan:
    """Aplica ``degrade`` y arrastra la geometría con la misma homografía."""

    degraded = degrade(plan.image, rng, strength)
    return _reproject_plan(plan, degraded.image, degraded.matrix)


def degrade_plan_isolated(
    plan: SyntheticPlan,
    rng: random.Random,
    transform: str,
    strength: float,
) -> SyntheticPlan:
    """Aplica ``degrade_isolated`` y arrastra la geometría con la homografía."""

    degraded = degrade_isolated(plan.image, rng, transform, strength)
    return _reproject_plan(plan, degraded.image, degraded.matrix)


# ---------------------------------------------------------------------------
# Transformaciones fijas (barridos de sensibilidad)
# ---------------------------------------------------------------------------


def _fixed_homography(
    width: int,
    height: int,
    angle_deg: float = 0.0,
    scale: float = 1.0,
    shear_x: float = 0.0,
    shear_y: float = 0.0,
) -> tuple[Matrix, tuple[int, int]]:
    """Homografía determinista (sin aleatoriedad) alrededor del centro.

    A diferencia de ``_build_homography``, los parámetros son fijos; se usa en
    los barridos de sensibilidad donde se controla exactamente ángulo o cizalla.
    """

    center_x, center_y = width / 2, height / 2
    to_center = np.array(
        [[1.0, 0.0, -center_x], [0.0, 1.0, -center_y], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    from_center = np.array(
        [[1.0, 0.0, center_x], [0.0, 1.0, center_y], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )

    combined = np.identity(3, dtype=np.float64)
    if scale != 1.0:
        combined = np.array(
            [[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        ) @ combined
    if shear_x != 0.0 or shear_y != 0.0:
        combined = np.array(
            [[1.0, shear_x, 0.0], [shear_y, 1.0, 0.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        ) @ combined
    if angle_deg != 0.0:
        radians = math.radians(angle_deg)
        cos_a, sin_a = math.cos(radians), math.sin(radians)
        combined = np.array(
            [[cos_a, -sin_a, 0.0], [sin_a, cos_a, 0.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        ) @ combined

    affine = from_center @ combined @ to_center
    corners: list[Point] = [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)]
    projected = apply_homography(corners, affine)
    min_x, min_y, max_x, max_y = _corner_bounds(projected)
    padding = 8.0
    translate = np.array(
        [[1.0, 0.0, -min_x + padding], [0.0, 1.0, -min_y + padding], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    matrix = translate @ affine
    out_width = int(round(max_x - min_x + 2 * padding))
    out_height = int(round(max_y - min_y + 2 * padding))
    return matrix, (max(out_width, 1), max(out_height, 1))


def rotate_plan(plan: SyntheticPlan, angle_degrees: float) -> SyntheticPlan:
    """Rota el plano un ángulo fijo (en grados) alrededor del centro."""

    matrix, size = _fixed_homography(
        plan.width, plan.height, angle_deg=angle_degrees
    )
    warped = _warp_image(plan.image, matrix, size)
    return _reproject_plan(plan, warped, matrix)


def shear_plan(
    plan: SyntheticPlan, shear_x: float, shear_y: float = 0.0
) -> SyntheticPlan:
    """Aplica una cizalla fija (componentes x e y) alrededor del centro."""

    matrix, size = _fixed_homography(
        plan.width, plan.height, shear_x=shear_x, shear_y=shear_y
    )
    warped = _warp_image(plan.image, matrix, size)
    return _reproject_plan(plan, warped, matrix)


def illumination_gradient(image: Image.Image, intensity: float) -> Image.Image:
    """Gradiente lineal vertical: brillo pleno arriba, (1-intensidad) abajo.

    Con ``intensity=1`` el papel inferior se oscurece a negro; sirve para el
    barrido de iluminación hasta que el papel más oscuro cruce el umbral de Otsu.
    """

    array = _to_array(image)
    height = array.shape[0]
    ramp = np.linspace(1.0, 1.0 - intensity, height).reshape(-1, 1, 1)
    return _from_array(array * ramp)


def hand_shadow(
    image: Image.Image,
    strength: float,
    rng: random.Random | None = None,
) -> Image.Image:
    """Banda oscura localizada (sombra de mano) con bordes suaves.

    Simula la sombra que proyecta la mano al fotografiar un plano: una franja
    horizontal gaussiana, oscurecida hasta ``strength * 255`` en su centro.
    """

    if rng is None:
        rng = random.Random(0)
    array = _to_array(image)
    height, width = array.shape[:2]
    center_y = height * rng.uniform(0.30, 0.70)
    half_height = height * rng.uniform(0.06, 0.14)
    center_x = width * rng.uniform(0.35, 0.65)
    half_width = width * rng.uniform(0.35, 0.50)
    yy = np.arange(height, dtype=np.float64).reshape(-1, 1)
    xx = np.arange(width, dtype=np.float64).reshape(1, -1)
    falloff = np.exp(-0.5 * ((yy - center_y) / half_height) ** 2) * np.exp(
        -0.5 * ((xx - center_x) / half_width) ** 2
    )
    darkening = falloff * (strength * 255.0)
    return _from_array(array - darkening[..., None])


def illuminate_plan(
    plan: SyntheticPlan,
    intensity: float,
    shadow: float = 0.0,
    rng: random.Random | None = None,
) -> SyntheticPlan:
    """Gradiente de iluminación (y sombra de mano opcional) sobre el plano.

    No cambia la geometría: solo los píxeles, así que muros y aberturas se
    conservan igual.
    """

    image = illumination_gradient(plan.image, intensity)
    if shadow > 0.0:
        image = hand_shadow(image, shadow, rng)
    return replace(plan, image=image)


# ---------------------------------------------------------------------------
# Visualización: overlay de ground truth y etiquetas YOLO
# ---------------------------------------------------------------------------


def render_annotated_image(plan: SyntheticPlan) -> Image.Image:
    """Superpone al plano el ground truth (muros + aberturas) y las etiquetas YOLO.

    Permite revisar a ojo que las etiquetas estén alineadas con la geometría:
    los muros GT se dibujan en rojo, las aberturas GT en verde y las etiquetas
    YOLO como relleno translúcido (azul = puerta, naranja = ventana). Si GT y
    etiquetas coinciden, el relleno translúcido queda exactamente sobre el
    contorno verde.
    """

    by_index = {wall.index: wall for wall in plan.walls}
    base = plan.image.convert("RGBA")

    ground_truth_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gt_draw = ImageDraw.Draw(ground_truth_layer)
    for wall in plan.walls:
        gt_draw.line([wall.start, wall.end], fill=(255, 0, 0, 255), width=3)
    for opening in plan.openings:
        wall = by_index[opening.wall_index]
        gt_draw.polygon(_opening_polygon(opening, wall), outline=(0, 200, 0, 255))
    base = Image.alpha_composite(base, ground_truth_layer)

    yolo_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    yolo_draw = ImageDraw.Draw(yolo_layer)
    for opening in plan.openings:
        wall = by_index[opening.wall_index]
        polygon = _opening_polygon(opening, wall)
        if opening.kind == "door":
            fill, outline = (0, 90, 255, 80), (0, 90, 255, 255)
        else:
            fill, outline = (255, 150, 0, 80), (255, 150, 0, 255)
        yolo_draw.polygon(polygon, fill=fill, outline=outline)
    base = Image.alpha_composite(base, yolo_layer)

    return base.convert("RGB")


def render_contact_sheet(
    plans: Sequence[SyntheticPlan],
    output_path: str | Path,
    columns: int = 4,
    cell_size: tuple[int, int] = (280, 210),
) -> Path:
    """Compone una hoja de contacto con el overlay de GT + etiquetas por plano."""

    rows = math.ceil(len(plans) / columns)
    cell_width, cell_height = cell_size
    canvas = Image.new("RGB", (columns * cell_width, rows * cell_height), PAPER_COLOR)
    draw = ImageDraw.Draw(canvas)
    for index, plan in enumerate(plans):
        thumbnail = render_annotated_image(plan).resize((cell_width, cell_height))
        row, col = divmod(index, columns)
        left, top = col * cell_width, row * cell_height
        canvas.paste(thumbnail, (left, top))
        draw.text((left + 5, top + 5), plan.name, fill=(255, 0, 0))

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    return path
