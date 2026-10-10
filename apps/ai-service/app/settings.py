from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            Path(__file__).resolve().parents[3] / ".env",
            Path(__file__).resolve().parents[1] / ".env",
        ),
        extra="ignore",
        populate_by_name=True,
    )

    ai_service_api_key: str = ""
    max_upload_bytes: int = 20 * 1024 * 1024
    triposr_repo_dir: Path = Path("vendor/TripoSR")
    triposr_model_id: str = "stabilityai/TripoSR"
    triposr_chunk_size: int = 4096
    triposr_mc_resolution: int = 128
    cuda_memory_fraction: float = 0.88
    instantmesh_repo_dir: Path | None = None
    instantmesh_python: Path | None = None
    instantmesh_config: str = "configs/instant-mesh-large.yaml"
    instantmesh_timeout_seconds: int = Field(default=900, gt=0)
    rembg_model_path: Path = Path("models/rmbg-1.4.onnx")
    rembg_model_repo: str = "briaai/RMBG-1.4"
    rembg_model_repo_file: str = "onnx/model.onnx"
    rembg_auto_download: bool = True
    oda_file_converter: str | None = None
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(
        default="", validation_alias="SUPABASE_SERVICE_ROLE_KEY"
    )
    supabase_bucket: str = "models-3d"
    signed_url_ttl_seconds: int = 3600
    yolo_segmentation_weights: Path | None = None
    yolo_device: str = "cpu"


@lru_cache
def get_settings() -> Settings:
    return Settings()