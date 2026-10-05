from pathlib import Path
from typing import Any

import cv2
import numpy as np


class Vision2DPipeline:
    """YOLOv11-seg produce máscaras; OpenCV las vectoriza en coordenadas [x, y]."""

    def __init__(self, weights_path: Path | None, device: str = "cpu") -> None:
        self._model: Any = None
        self._device = device
        if weights_path:
            from ultralytics import YOLO

            self._model = YOLO(str(weights_path))

    def segment(self, image: np.ndarray) -> list[dict[str, Any]]:
        if self._model is None:
            raise RuntimeError("Configura YOLO_SEGMENTATION_WEIGHTS con pesos YOLOv11-seg.")

        result = self._model.predict(image, device=self._device, verbose=False)[0]
        if result.masks is None or result.boxes is None:
            return []

        height, width = image.shape[:2]
        detections: list[dict[str, Any]] = []
        for mask, class_id, confidence in zip(
            result.masks.data, result.boxes.cls, result.boxes.conf
        ):
            mask_array = mask.cpu().numpy()
            binary = cv2.resize(
                (mask_array > 0.5).astype(np.uint8),
                (width, height),
                interpolation=cv2.INTER_NEAREST,
            )
            contours, _ = cv2.findContours(
                binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            contour = max(contours, key=cv2.contourArea, default=None)
            if contour is None or cv2.contourArea(contour) < 8:
                continue
            simplified = cv2.approxPolyDP(
                contour, epsilon=max(1.0, cv2.arcLength(contour, True) * 0.005), closed=True
            )
            label = result.names[int(class_id)]
            detections.append(
                {
                    "label": label,
                    "confidence": float(confidence),
                    "polygon": simplified.reshape(-1, 2).astype(int).tolist(),
                }
            )
        return detections