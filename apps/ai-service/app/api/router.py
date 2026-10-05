from fastapi import APIRouter
from app.api.health import router as health_router
from app.api.floorplan import router as floorplan_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(floorplan_router, tags=["Floorplan AI"])
