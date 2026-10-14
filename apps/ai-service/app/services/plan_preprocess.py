"""Preproceso de planos raster: aplanado de iluminación y corrección de inclinación.

``_raster_geometry`` umbraliza con Otsu asumiendo papel claro y tinta oscura, y su
pasada direccional usa unos pocos ángulos fijos. Dos problemas lo degradan:

* Un gradiente de luz o una sombra desplazan el umbral global → ``flatten_illumination``
  estima el fondo con un cierre morfológico y divide.
* Un plano girado saca los muros del eje de los kernels → ``estimate_skew`` +
  ``rotate_with_matrix`` estiman la inclinación (módulo 90°, muros ortogonales) y
  la corrigen antes de detectar, devolviendo luego los puntos al espacio original.

Funciones puras: no usan estado global ni escriben nada.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image

# Lado del kernel de cierre como fracción de la dimensión mínima de la imagen.
# Suficientemente grande para rellenar la tinta (trazo ~15 px) y las sombras
# suaves, y suficientemente pequeño para seguir la iluminación de fondo.
BACKGROUND_KERNEL_RATIO = 0.12

# Confianza mínima (resultante circular en [0, 1]) para aceptar la estimación de
# inclinación; por debajo se considera plano no ortogonal, vacío o ruidoso.
SKEW_CONFIDENCE_THRESHOLD = 0.70

# Densidad de bordes admisible (fracción de píxeles Canny). Fuera de este rango
# la imagen se considera vacía (casi sin bordes) o demasiado ruidosa.
MIN_EDGE_DENSITY = 0.001
MAX_EDGE_DENSITY = 0.25

# No merece la pena rotar por inclinaciones por debajo de 1°.
MIN_DESKEW_ANGLE = 1.0

# Estimador elegido tras comparar "gradient" (histograma de orientación de
# gradientes ponderado) y "hough" (HoughLinesP). Hough gana con claridad sobre
# los datos (error máximo 0.17° frente a 1.29°), porque ajusta segmentos exactos
# mientras la orientación de gradiente se sesga con trazos gruesos y esquinas.
# Ver REPORTE_P2B.md.
SKEW_ESTIMATOR = "hough"


def _closing_kernel_size(height: int, width: int) -> int:
    """Tamaño impar del kernel de cierre, relativo a la dimensión mínima."""

    minimum_dimension = min(height, width)
    size = max(3, int(round(minimum_dimension * BACKGROUND_KERNEL_RATIO)))
    if size % 2 == 0:
        size += 1
    return size


def flatten_illumination(image: Image.Image) -> Image.Image:
    """Devuelve una copia RGB del mismo tamaño con el fondo de papel aplanado.

    Estima el fondo con un cierre morfológico (rellena la tinta oscura) y divide
    la imagen por él. El resultado es tinta oscura sobre papel claro uniforme,
    con independencia del gradiente de luz o de las sombras suaves.
    """

    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape[:2]
    kernel_size = _closing_kernel_size(height, width)
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
    )
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    background = np.maximum(background, 1)  # evita dividir por cero
    normalized = cv2.divide(gray, background, scale=255.0)
    return Image.fromarray(normalized, mode="L").convert("RGB")


# ---------------------------------------------------------------------------
# Estimación de inclinación
# ---------------------------------------------------------------------------


def _angles_mod_90(angles_deg: np.ndarray) -> np.ndarray:
    """Lleva ángulos al rango [-45, 45), aprovechando que los muros son ortogonales."""

    modulo = np.mod(angles_deg, 90.0)
    return np.where(modulo >= 45.0, modulo - 90.0, modulo)


def _circular_skew(
    angles_deg: np.ndarray, weights: np.ndarray
) -> tuple[float, float]:
    """Media circular módulo 90° y confianza (resultante) en [0, 1].

    Multiplicar el ángulo por 4 lo vuelve periódico en 360° y permite usar
    estadística circular. La resultante mide la concentración: cerca de 1 para
    un histograma con un pico dominante, cerca de 0 para ruido.
    """

    if angles_deg.size == 0:
        return 0.0, 0.0
    total = float(weights.sum())
    if total <= 0.0:
        return 0.0, 0.0
    phi = np.deg2rad(angles_deg * 4.0)
    cos_sum = float(np.sum(weights * np.cos(phi)))
    sin_sum = float(np.sum(weights * np.sin(phi)))
    resultant = math.hypot(cos_sum, sin_sum) / total
    skew = math.degrees(math.atan2(sin_sum, cos_sum)) / 4.0
    return skew, resultant


def _estimate_skew_gradient(gray: np.ndarray) -> tuple[float, float]:
    """Histograma de orientación de gradientes, ponderado por magnitud."""

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    orientation = np.rad2deg(np.arctan2(gy, gx))
    angles = _angles_mod_90(orientation)
    # Descarta gradientes débiles (ruido, antialiasing) para que pese el trazo.
    threshold = max(10.0, 0.15 * float(magnitude.max()))
    mask = magnitude >= threshold
    return _circular_skew(angles[mask], magnitude[mask])


def _estimate_skew_hough(gray: np.ndarray) -> tuple[float, float]:
    """Histograma de orientación de segmentos de HoughLinesP, ponderado por longitud.

    Se descarta si la densidad de bordes es anómala (imagen vacía o ruido), para
    que una nube de ruido no devuelva una orientación con alta confianza.
    """

    edges = cv2.Canny(gray, 50, 150)
    density = float((edges > 0).mean())
    if density < MIN_EDGE_DENSITY or density > MAX_EDGE_DENSITY:
        return 0.0, 0.0
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180.0,
        threshold=60,
        minLineLength=40,
        maxLineGap=10,
    )
    if lines is None or len(lines) == 0:
        return 0.0, 0.0
    angles: list[float] = []
    weights: list[float] = []
    for x1, y1, x2, y2 in lines[:, 0, :]:
        angles.append(math.degrees(math.atan2(y2 - y1, x2 - x1)))
        weights.append(math.hypot(x2 - x1, y2 - y1))
    return _circular_skew(
        _angles_mod_90(np.asarray(angles, dtype=np.float64)),
        np.asarray(weights, dtype=np.float64),
    )


def estimate_skew(image: Image.Image) -> tuple[float, float]:
    """Estima la inclinación del plano y su confianza.

    Devuelve ``(ángulo_en_grados, confianza)`` con el ángulo normalizado a
    [-45, 45] (módulo 90°: los muros son ortogonales) y la confianza en [0, 1].
    """

    gray = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
    if SKEW_ESTIMATOR == "hough":
        return _estimate_skew_hough(gray)
    return _estimate_skew_gradient(gray)


# ---------------------------------------------------------------------------
# Rotación y vuelta al espacio original
# ---------------------------------------------------------------------------


def rotate_with_matrix(
    image: Image.Image, angle_deg: float
) -> tuple[Image.Image, np.ndarray]:
    """Rota ``image`` ``angle_deg`` (sentido antihorario) con lienzo ampliado.

    Devuelve la imagen rotada y la matriz afín 2x3 que mapea puntos del espacio
    original al espacio rotado (la que usa ``cv2.warpAffine``).
    """

    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    center = (width / 2.0, height / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])
    new_width = int(round(height * sin + width * cos))
    new_height = int(round(height * cos + width * sin))
    matrix[0, 2] += new_width / 2.0 - center[0]
    matrix[1, 2] += new_height / 2.0 - center[1]
    rotated = cv2.warpAffine(
        rgb,
        matrix,
        (new_width, new_height),
        flags=cv2.INTER_LINEAR,
        borderValue=(255, 255, 255),
    )
    return Image.fromarray(rotated, mode="RGB"), matrix


def map_entities_to_original(
    entities: list[dict], matrix: np.ndarray
) -> list[dict]:
    """Devuelve los puntos de las entidades al espacio original (rotación inversa).

    Aplica la inversa de ``matrix`` a cada punto de las entidades ``line`` y
    ``polyline``, redondeando a enteros y conservando el resto de claves
    (``type``, ``role``, ``closed``, ``confidence``).
    """

    inverse = cv2.invertAffineTransform(matrix)
    mapped: list[dict] = []
    for entity in entities:
        points = entity.get("points", [])
        new_points: list[list[int]] = []
        for x, y in points:
            original_x = inverse[0, 0] * x + inverse[0, 1] * y + inverse[0, 2]
            original_y = inverse[1, 0] * x + inverse[1, 1] * y + inverse[1, 2]
            new_points.append([int(round(original_x)), int(round(original_y))])
        new_entity = dict(entity)
        new_entity["points"] = new_points
        mapped.append(new_entity)
    return mapped


def trim_canvas(
    image: Image.Image, matrix: np.ndarray, margin: int = 8
) -> tuple[Image.Image, np.ndarray]:
    """Recorta el borde blanco que deja la rotación, ajustando la matriz.

    La rotación amplía el lienzo para no perder contenido, pero ese borde blanco
    agranda la dimensión mínima y con ella los umbrales relativos de
    ``_raster_geometry`` (que filtrarían muros finos). Se recorta al contorno de
    la tinta (Otsu) más un margen, sin perder contenido, y se compensa la matriz.
    """

    gray = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
    )
    ys, xs = np.where(binary > 0)
    if ys.size == 0:
        return image, matrix
    left = max(0, int(xs.min()) - margin)
    top = max(0, int(ys.min()) - margin)
    right = min(image.width, int(xs.max()) + margin + 1)
    bottom = min(image.height, int(ys.max()) + margin + 1)
    cropped = image.crop((left, top, right, bottom))
    adjusted = matrix.copy()
    adjusted[0, 2] -= left
    adjusted[1, 2] -= top
    return cropped, adjusted
