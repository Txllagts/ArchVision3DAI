import cv2
import numpy as np
import math
from typing import List, Dict, Any, Tuple

def analyze_floorplan_opencv(
    image_np: np.ndarray,
    pixels_per_meter: float = 50.0,
    min_wall_length_m: float = 0.5,
    max_wall_thickness_m: float = 0.5
) -> Tuple[List[Dict[str, Any]], float]:
    """
    Pipeline híbrido OpenCV para extracción vectorial de muros:
    1. Grayscale & Otsu Thresholding
    2. Filtrado morfologico de componentes conexas pequeñas (cotas/textos)
    3. Hough Lines Probabilístico para detectar ejes de muros
    4. Agrupamiento de líneas paralelas y fusion de segmentos
    5. Conversión a metros con pixels_per_meter
    """
    h, w = image_np.shape[:2]
    
    # 1. Convert to grayscale if RGB
    if len(image_np.shape) == 3:
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
    else:
        gray = image_np.copy()
        
    # Blur reduction
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Otsu thresholding
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Morphological cleaning to remove small noise (text, dimensions)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # 2. Canny Edge Detection & Hough Lines P
    edges = cv2.Canny(cleaned, 50, 150, apertureSize=3)
    
    min_line_length_px = int(min_wall_length_m * pixels_per_meter)
    max_line_gap_px = int(0.3 * pixels_per_meter)
    
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=40,
        minLineLength=max(15, min_line_length_px),
        maxLineGap=max(5, max_line_gap_px)
    )
    
    walls = []
    angles = []
    
    if lines is not None:
        raw_segments = []
        for line in lines:
            coords = line.ravel()
            x1, y1, x2, y2 = int(coords[0]), int(coords[1]), int(coords[2]), int(coords[3])
            dx = x2 - x1
            dy = y2 - y1
            length_px = math.hypot(dx, dy)
            if length_px < 5:
                continue
                
            angle_rad = math.atan2(dy, dx)
            angle_deg = math.degrees(angle_rad) % 180
            angles.append(angle_deg)
            raw_segments.append((x1, y1, x2, y2, length_px, angle_deg))
            
        # Group collinear segments
        processed_walls = _merge_collinear_segments(raw_segments, pixels_per_meter, w, h)
        walls = processed_walls

    # Calculate dominant angle
    dominant_angle_deg = 0.0
    if angles:
        hist, bin_edges = np.histogram(angles, bins=36, range=(0, 180))
        max_bin = np.argmax(hist)
        dominant_angle_deg = round(float((bin_edges[max_bin] + bin_edges[max_bin + 1]) / 2), 2)

    return walls, dominant_angle_deg

def _merge_collinear_segments(
    segments: List[Tuple[int, int, int, int, float, float]],
    pixels_per_meter: float,
    img_w: int,
    img_h: int
) -> List[Dict[str, Any]]:
    walls = []
    used = [False] * len(segments)
    
    for i in range(len(segments)):
        if used[i]:
            continue
        x1, y1, x2, y2, length_px, angle_deg = segments[i]
        
        # Snap horizontal or vertical
        if abs(angle_deg - 0) < 10 or abs(angle_deg - 180) < 10:
            y_avg = (y1 + y2) / 2
            x_min = min(x1, x2)
            x_max = max(x1, x2)
            
            # Look for collinear
            for j in range(i + 1, len(segments)):
                if used[j]:
                    continue
                nx1, ny1, nx2, ny2, _, nangle = segments[j]
                if abs(nangle - 0) < 10 or abs(nangle - 180) < 10:
                    if abs((ny1 + ny2) / 2 - y_avg) < pixels_per_meter * 0.15:
                        x_min = min(x_min, nx1, nx2)
                        x_max = max(x_max, nx1, nx2)
                        used[j] = True
                        
            wall_len_px = x_max - x_min
            wall_len_m = round(wall_len_px / pixels_per_meter, 2)
            if wall_len_m >= 0.4:
                walls.append({
                    "start": {"x": round(x_min / pixels_per_meter, 3), "y": round(y_avg / pixels_per_meter, 3)},
                    "end": {"x": round(x_max / pixels_per_meter, 3), "y": round(y_avg / pixels_per_meter, 3)},
                    "thickness": 0.15,
                    "length": wall_len_m,
                    "confidence": 0.85
                })
            used[i] = True
            
        elif abs(angle_deg - 90) < 10:
            x_avg = (x1 + x2) / 2
            y_min = min(y1, y2)
            y_max = max(y1, y2)
            
            for j in range(i + 1, len(segments)):
                if used[j]:
                    continue
                nx1, ny1, nx2, ny2, _, nangle = segments[j]
                if abs(nangle - 90) < 10:
                    if abs((nx1 + nx2) / 2 - x_avg) < pixels_per_meter * 0.15:
                        y_min = min(y_min, ny1, ny2)
                        y_max = max(y_max, ny1, ny2)
                        used[j] = True
                        
            wall_len_px = y_max - y_min
            wall_len_m = round(wall_len_px / pixels_per_meter, 2)
            if wall_len_m >= 0.4:
                walls.append({
                    "start": {"x": round(x_avg / pixels_per_meter, 3), "y": round(y_min / pixels_per_meter, 3)},
                    "end": {"x": round(x_avg / pixels_per_meter, 3), "y": round(y_max / pixels_per_meter, 3)},
                    "thickness": 0.15,
                    "length": wall_len_m,
                    "confidence": 0.85
                })
            used[i] = True

    return walls
