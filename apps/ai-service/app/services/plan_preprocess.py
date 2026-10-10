"""Aplanado de iluminación para planos raster.

``_raster_geometry`` umbraliza con Otsu asumiendo papel claro y tinta oscura.
Un gradiente de luz o una sombra desplazan ese umbral global y el papel oscuro
termina clasificándose como tinta. Aquí se estima el fondo de papel con un
cierre morfológico grande (que rellena la tinta) y se divide la imagen por ese
fondo, dejando el papel uniformemente claro y la tinta oscura.

Función pura: no usa estado global ni escribe nada.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

# Lado del kernel de cierre como fracción de la dimensión mínima de la imagen.
# Suficientemente grande para rellenar la tinta (trazo ~15 px) y las sombras
# suaves, y suficientemente pequeño para seguir la iluminación de fondo.
BACKGROUND_KERNEL_RATIO = 0.12


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
