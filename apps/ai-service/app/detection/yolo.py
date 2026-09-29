import os
from typing import List, Dict, Any
import numpy as np

class YOLOArchitectureDetector:
    def __init__(self, model_name: str = "yolo11n.pt"):
        self.model_name = model_name
        self.model = None
        self.is_loaded = False

    def load_model(self):
        try:
            from ultralytics import YOLO
            # Initializes model (downloads pre-trained weights if not local)
            self.model = YOLO(self.model_name)
            self.is_loaded = True
            print(f"[YOLO] Model {self.model_name} initialized successfully.")
        except Exception as e:
            print(f"[YOLO] Warning: Failed to load YOLO model: {e}")
            self.is_loaded = False

    def detect(self, image_np: np.ndarray, confidence_threshold: float = 0.25) -> List[Dict[str, Any]]:
        if not self.is_loaded or self.model is None:
            self.load_model()
            
        if not self.is_loaded:
            return []

        try:
            results = self.model(image_np, conf=confidence_threshold, verbose=False)
            detections = []
            
            for r in results:
                boxes = r.boxes
                for box in boxes:
                    cls_id = int(box.cls[0])
                    label = self.model.names[cls_id] if hasattr(self.model, "names") else str(cls_id)
                    conf = float(box.conf[0])
                    xywhn = box.xywhn[0].tolist()  # normalized x_center, y_center, width, height
                    
                    detections.append({
                        "class": label,
                        "confidence": round(conf, 3),
                        "box": {
                            "x": round(xywhn[0] - xywhn[2] / 2, 4),
                            "y": round(xywhn[1] - xywhn[3] / 2, 4),
                            "width": round(xywhn[2], 4),
                            "height": round(xywhn[3], 4)
                        }
                    })
            return detections
        except Exception as e:
            print(f"[YOLO] Detection error: {e}")
            return []

yolo_detector = YOLOArchitectureDetector()
