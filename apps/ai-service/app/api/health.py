from fastapi import APIRouter
from app.config import settings

router = APIRouter()

@router.get("/health")
def health_check():
    cuda_available = False
    gpu_name = "N/A"
    vram_gb = 0.0

    try:
        import torch
        cuda_available = torch.cuda.is_available()
        if cuda_available:
            gpu_name = torch.cuda.get_device_name(0)
            vram_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 2)
    except Exception as e:
        pass

    return {
        "status": "online",
        "service": settings.APP_NAME,
        "mode": settings.AI_MODE,
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "vram_gb": vram_gb
    }
