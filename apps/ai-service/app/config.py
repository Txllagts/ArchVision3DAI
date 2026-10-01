from pydantic_settings import BaseSettings
import os

class Settings(BaseSettings):
    APP_NAME: str = "ArchVision AI Service"
    DEBUG: bool = True
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    
    # Model storage path
    MODEL_CACHE_DIR: str = os.path.join(os.path.dirname(__file__), "..", "weights")
    
    # AI Execution modes
    AI_MODE: str = "local"  # "mock" | "local" | "serverless"
    
    # PyTorch device
    DEVICE: str = "cuda"  # "cuda" | "cpu"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
