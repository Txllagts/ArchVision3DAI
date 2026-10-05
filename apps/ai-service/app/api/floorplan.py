from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import io
import time
import numpy as np
from PIL import Image

from app.detection.opencv_pipeline import analyze_floorplan_opencv
from app.detection.yolo import yolo_detector

router = APIRouter()

class Vector2D(BaseModel):
    x: float
    y: float

class DetectedWallModel(BaseModel):
    start: Vector2D
    end: Vector2D
    thickness: float
    length: float
    confidence: float

class FloorplanAnalysisResponse(BaseModel):
    width: int
    height: int
    walls_detected: int
    openings_detected: int
    dominant_angle_deg: float
    pixels_per_meter: float
    walls: List[DetectedWallModel]
    detections: List[Dict[str, Any]]
    processing_time_ms: float
    message: str

@router.post("/analyze-floorplan", response_model=FloorplanAnalysisResponse)
async def analyze_floorplan(
    file: UploadFile = File(...),
    pixels_per_meter: Optional[float] = Form(50.0),
    confidence_threshold: Optional[float] = Form(0.25)
):
    start_time = time.time()
    try:
        contents = await file.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        width, height = pil_image.size
        
        image_np = np.array(pil_image)
        
        # 1. OpenCV Vectorization Pipeline (Walls)
        walls_raw, dominant_angle = analyze_floorplan_opencv(
            image_np=image_np,
            pixels_per_meter=pixels_per_meter if pixels_per_meter else 50.0
        )
        
        # 2. YOLO Architecture Object Detection (Doors, Windows, Columns)
        object_detections = yolo_detector.detect(
            image_np=image_np,
            confidence_threshold=confidence_threshold if confidence_threshold else 0.25
        )
        
        walls_formatted = [
            DetectedWallModel(
                start=Vector2D(x=w["start"]["x"], y=w["start"]["y"]),
                end=Vector2D(x=w["end"]["x"], y=w["end"]["y"]),
                thickness=w["thickness"],
                length=w["length"],
                confidence=w["confidence"]
            )
            for w in walls_raw
        ]
        
        processing_time_ms = round((time.time() - start_time) * 1000, 2)
        
        openings_count = len([d for d in object_detections if d.get("class") in ["door", "window"]])
        
        return FloorplanAnalysisResponse(
            width=width,
            height=height,
            walls_detected=len(walls_formatted),
            openings_detected=openings_count,
            dominant_angle_deg=dominant_angle,
            pixels_per_meter=pixels_per_meter if pixels_per_meter else 50.0,
            walls=walls_formatted,
            detections=object_detections,
            processing_time_ms=processing_time_ms,
            message="Plano analizado con éxito utilizando el pipeline híbrido OpenCV + YOLO."
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error analizando el plano: {str(e)}")
