import asyncio
import gc
import hmac
import json
import logging
import re
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import torch
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image

from app.services.input_preprocessor import UnsupportedInputError, prepare_image
from app.services.floorplan import (
    InvalidFloorplanError,
    analyze_floorplan,
    extrude_floorplan_to_3d,
)
from app.services.geometry_utils import canonicalize_glb
from app.services.glb_validation import validate_generated_glb
from app.services.instantmesh_pipeline import InstantMeshPipeline
from app.services.mesh_completion import complete_mesh
from app.services.supabase_storage import SupabaseModelStorage
from app.services.triposr_pipeline import TriposrPipeline
from app.settings import Settings, get_settings

logger = logging.getLogger("archvision.ai")
inference_slots = asyncio.Semaphore(1)
floorplan_slots = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pipeline = None
    app.state.instantmesh_pipeline = None
    app.state.instantmesh_unavailable_reason = None
    app.state.storage = None
    app.state.storage_startup_failed = False
    app.state.rembg_session = None
    app.state.startup_error = None
    startup_errors: list[str] = []
    try:
        logger.info("Inicializando microservicio ArchVision AI")
        settings = get_settings()
        logger.info("Configuracion cargada")
    except Exception as error:
        startup_errors.append(f"configuration: {error}")
        logger.exception(
            "Fallo durante startup en la fase de configuracion: %s", error
        )
        settings = None

    if settings is not None:
        try:
            logger.info(
                "Conectando Supabase Storage (bucket=%s)", settings.supabase_bucket
            )
            app.state.storage = SupabaseModelStorage(settings)
        except Exception as error:
            app.state.storage_startup_failed = True
            startup_errors.append(f"Supabase Storage: {error}")
            logger.exception("Fallo durante startup en Supabase Storage: %s", error)

        try:
            logger.info("Cargando TripoSR desde %s", settings.triposr_repo_dir)
            app.state.pipeline = TriposrPipeline(settings)
        except Exception as error:
            startup_errors.append(f"TripoSR pipeline / CUDA: {error}")
            logger.exception(
                "Fallo durante startup en TripoSR pipeline / CUDA: %s", error
            )

        try:
            app.state.instantmesh_pipeline = InstantMeshPipeline(settings)
            logger.info("InstantMesh CLI configurado desde %s", settings.instantmesh_repo_dir)
        except Exception as error:
            app.state.instantmesh_unavailable_reason = str(error)
            logger.warning(
                "InstantMesh no está habilitado: %s. El endpoint HQ responderá 503.",
                error,
            )

        try:
            if not settings.rembg_model_path.is_file():
                raise RuntimeError(
                    f"RMBG_MODEL_PATH={settings.rembg_model_path} "
                    "no existe o no es un archivo."
                )
            logger.info("Cargando modelo RMBG desde %s", settings.rembg_model_path)
            app.state.rembg_session = _new_rembg_session(settings.rembg_model_path)
        except Exception as error:
            startup_errors.append(f"RMBG ONNX Runtime: {error}")
            logger.exception(
                "Fallo durante startup en RMBG ONNX Runtime: %s", error
            )

    if startup_errors:
        app.state.startup_error = "; ".join(startup_errors)
        logger.error(
            "Startup incompleto: %s. Las capacidades que sí inicializaron "
            "permanecerán disponibles.",
            app.state.startup_error,
        )
    else:
        logger.info("Inicializacion completa; servicio listo")

    try:
        yield
    finally:
        logger.info("Lifespan shutdown solicitado; liberando recursos del servicio")


def _new_rembg_session(model_path: Path):
    import os

    import numpy as np
    import onnxruntime as ort
    from rembg.sessions.u2net_custom import U2netCustomSession

    class RmbgOnnxSession(U2netCustomSession):
        def __init__(self, model_name, session_options, *args, **kwargs):
            resolved_model_path = self.__class__.download_models(*args, **kwargs)
            if resolved_model_path is None:
                raise ValueError("model_path is required")

            self.model_name = model_name
            self.inner_session = ort.InferenceSession(
                str(resolved_model_path),
                sess_options=session_options,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
            if "CUDAExecutionProvider" not in self.inner_session.get_providers():
                logger.warning(
                    "ONNX Runtime no pudo activar CUDA; RMBG se ejecutara en CPU."
                )

        def predict(self, img: Image.Image, *args, **kwargs) -> list[Image.Image]:
            input_info = self.inner_session.get_inputs()[0]
            input_shape = input_info.shape
            if len(input_shape) != 4 or input_shape[1] not in (3, "3"):
                raise ValueError(
                    f"Forma de entrada ONNX no compatible: {input_shape!r}"
                )

            height = input_shape[2]
            width = input_shape[3]
            height = height if isinstance(height, int) and height > 0 else 1024
            width = width if isinstance(width, int) and width > 0 else 1024
            outputs = self.inner_session.run(
                None,
                self.normalize(
                    img,
                    (0.5, 0.5, 0.5),
                    (1.0, 1.0, 1.0),
                    (width, height),
                ),
            )
            prediction = outputs[0][:, 0, :, :]
            maximum = np.max(prediction)
            minimum = np.min(prediction)
            if maximum > minimum:
                prediction = (prediction - minimum) / (maximum - minimum)
            else:
                prediction = np.zeros_like(prediction)

            mask = Image.fromarray(
                (np.squeeze(prediction) * 255).astype("uint8"), mode="L"
            )
            return [mask.resize(img.size, Image.Resampling.LANCZOS)]

    session_options = ort.SessionOptions()
    if "OMP_NUM_THREADS" in os.environ:
        threads = int(os.environ["OMP_NUM_THREADS"])
        session_options.inter_op_num_threads = threads
        session_options.intra_op_num_threads = threads

    return RmbgOnnxSession(
        "u2net_custom", session_options, model_path=str(model_path)
    )


app = FastAPI(title="ArchVision AI Service", version="0.1.0", lifespan=lifespan)


async def require_api_key(x_ai_service_key: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().ai_service_api_key
    if not expected:
        raise HTTPException(status_code=503, detail="AI_SERVICE_API_KEY no está configurada.")
    if x_ai_service_key is None or not hmac.compare_digest(x_ai_service_key, expected):
        raise HTTPException(status_code=401, detail="Credencial de servicio inválida.")


@app.get("/health")
async def health() -> dict[str, str]:
    if app.state.startup_error:
        raise HTTPException(status_code=503, detail=app.state.startup_error)
    return {"status": "ok", "device": "cuda" if torch.cuda.is_available() else "unavailable"}


@app.get(
    "/api/v1/capabilities",
    dependencies=[Depends(require_api_key)],
)
async def service_capabilities() -> dict[str, bool]:
    return {
        "instantmesh_available": app.state.instantmesh_pipeline is not None,
    }


@app.post("/api/v1/image-to-3d/generate", dependencies=[Depends(require_api_key)])
async def generate_model(file: UploadFile = File(...)) -> dict[str, object]:
    return await _generate_model(file, engine="triposr")


@app.post("/api/v1/image-to-3d/generate-hq", dependencies=[Depends(require_api_key)])
async def generate_hq_model(file: UploadFile = File(...)) -> dict[str, object]:
    return await _generate_model(file, engine="instantmesh")


def _safe_error_message(error: Exception, settings: Settings) -> str:
    message = str(error)
    for secret in (settings.supabase_service_role_key, settings.ai_service_api_key):
        if secret:
            message = message.replace(secret, "[REDACTED]")
    return re.sub(
        r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}",
        "[REDACTED_TOKEN]",
        message,
    )[:1000]


async def _generate_model(
    file: UploadFile,
    engine: Literal["triposr", "instantmesh"],
) -> dict[str, object]:
    settings = get_settings()
    contents = await file.read(settings.max_upload_bytes + 1)
    if len(contents) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="El archivo supera el máximo de 20 MB.")
    if not contents:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if app.state.storage is None:
        storage_reason = app.state.startup_error
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Supabase Storage no está disponible.",
                "reason": (
                    _safe_error_message(RuntimeError(storage_reason), settings)
                    if storage_reason
                    else "No se inicializó el cliente de Storage."
                ),
            },
        )
    if engine == "triposr" and (
        app.state.pipeline is None or app.state.rembg_session is None
    ):
        startup_reason = app.state.startup_error
        raise HTTPException(
            status_code=503,
            detail={
                "message": "El motor estándar TripoSR no está disponible.",
                "reason": (
                    _safe_error_message(RuntimeError(startup_reason), settings)
                    if startup_reason
                    else "No se inicializaron TripoSR/RMBG."
                ),
            },
        )
    if engine == "instantmesh" and app.state.instantmesh_pipeline is None:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "El motor InstantMesh no está configurado.",
                "reason": app.state.instantmesh_unavailable_reason,
            },
        )

    try:
        source_image = await asyncio.to_thread(
            prepare_image, file.filename or "upload", contents, settings
        )
    except UnsupportedInputError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.info("Entrada de imagen no válida: %s", error)
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo de entrada.") from error

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="archvision-glb-") as directory:
            output_path = Path(directory) / "model.glb"
            async with inference_slots:
                if engine == "instantmesh":
                    pipeline = app.state.pipeline
                    rembg_session = app.state.rembg_session
                    app.state.rembg_session = None
                    del rembg_session
                    await asyncio.to_thread(gc.collect)
                    try:
                        if pipeline is not None:
                            await asyncio.to_thread(pipeline.release_cuda_memory)
                        await asyncio.to_thread(
                            app.state.instantmesh_pipeline.generate,
                            source_image,
                            output_path,
                        )
                    finally:
                        try:
                            if pipeline is not None:
                                await asyncio.to_thread(pipeline.restore_cuda_memory)
                        finally:
                            try:
                                app.state.rembg_session = await asyncio.to_thread(
                                    _new_rembg_session, settings.rembg_model_path
                                )
                            except Exception:
                                logger.exception(
                                    "No se pudo restaurar la sesión RMBG tras InstantMesh"
                                )
                else:
                    from rembg import remove

                    cutout = await asyncio.to_thread(
                        remove, source_image, session=app.state.rembg_session
                    )
                    if not isinstance(cutout, Image.Image):
                        cutout = Image.open(cutout)
                    await asyncio.to_thread(
                        app.state.pipeline.generate, cutout, output_path
                    )
            await asyncio.to_thread(canonicalize_glb, output_path)
            await asyncio.to_thread(complete_mesh, output_path)
            glb_contents = output_path.read_bytes()
            await asyncio.to_thread(validate_generated_glb, glb_contents)
    except Exception as error:
        logger.exception("Falló la generación del modelo 3D (engine=%s)", engine)
        raise HTTPException(
            status_code=500,
            detail={
                "message": f"No se pudo generar un GLB válido con {engine}.",
                "error_type": type(error).__name__,
                "reason": _safe_error_message(error, settings),
            },
        ) from error

    try:
        stored = await asyncio.to_thread(app.state.storage.upload_glb, glb_contents)
    except Exception as error:
        logger.exception(
            "Falló la subida del modelo a Supabase Storage "
            "(bucket=%s, prefijo=generated/)",
            settings.supabase_bucket,
        )
        response = getattr(error, "response", None)
        error_status = getattr(error, "status", None) or getattr(
            response, "status_code", None
        )
        error_code = getattr(error, "code", None)
        detail: dict[str, object] = {
            "message": (
                "El modelo se generó, pero no se pudo subir a Supabase Storage."
            ),
            "error_type": type(error).__name__,
            "reason": _safe_error_message(error, settings),
        }
        if isinstance(error_status, int):
            detail["upstream_status"] = error_status
        if isinstance(error_code, (str, int)):
            detail["upstream_code"] = str(error_code)[:100]
        raise HTTPException(status_code=502, detail=detail) from error

    return {
        "model_url": stored.signed_url,
        "storage_path": stored.path,
        "format": "glb",
        "engine": engine,
        "processing_seconds": round(time.perf_counter() - started, 3),
    }


@app.post("/api/v1/floorplan/analyze", dependencies=[Depends(require_api_key)])
async def analyze_floorplan_upload(file: UploadFile = File(...)) -> dict[str, object]:
    settings = get_settings()
    filename = file.filename or "floorplan"
    contents = await file.read(settings.max_upload_bytes + 1)
    if len(contents) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="El archivo supera el máximo de 20 MB.")
    if not contents:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if app.state.storage is None:
        if app.state.storage_startup_failed:
            raise HTTPException(
                status_code=502,
                detail=(
                    "No se pudo inicializar Supabase Storage. Revisa las "
                    "credenciales de service-role, los permisos y la conexión."
                ),
            )
        raise HTTPException(
            status_code=503,
            detail="El almacenamiento de planos no está disponible. Revisa la configuración de Supabase.",
        )

    started = time.perf_counter()
    try:
        async with floorplan_slots:
            result = await asyncio.to_thread(
                analyze_floorplan, filename, contents, settings
            )
            glb_contents = await asyncio.to_thread(
                extrude_floorplan_to_3d, result
            )
    except InvalidFloorplanError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Falló el análisis 2D del plano %s", filename)
        raise HTTPException(
            status_code=500, detail="No se pudo analizar el archivo del plano."
        ) from error

    result["processing_seconds"] = round(time.perf_counter() - started, 3)
    serialized = json.dumps(
        result,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    try:
        stored_model = await asyncio.to_thread(
            app.state.storage.upload_floorplan_glb, glb_contents
        )
    except Exception as error:
        logger.exception(
            "Falló la subida del GLB del plano a Supabase Storage "
            "(bucket=%s, prefijo=floorplans/); revisa credenciales, permisos y red",
            settings.supabase_bucket,
        )
        raise HTTPException(
            status_code=502,
            detail="No se pudo subir el modelo GLB del plano a Supabase Storage. Revisa credenciales, permisos y conectividad.",
        ) from error

    try:
        stored_geometry = await asyncio.to_thread(
            app.state.storage.upload_floorplan_json, serialized
        )
    except Exception as error:
        logger.exception(
            "Falló la subida del JSON del plano a Supabase Storage "
            "(bucket=%s, prefijo=floorplans/); revisa credenciales, permisos y red",
            settings.supabase_bucket,
        )
        raise HTTPException(
            status_code=502,
            detail="El modelo se guardó, pero no se pudo subir la geometría JSON a Supabase Storage. Revisa credenciales, permisos y conectividad.",
        ) from error

    return {
        **result,
        "storage_path": stored_geometry.path,
        "result_url": stored_geometry.signed_url,
        "model_storage_path": stored_model.path,
        "model_url": stored_model.signed_url,
        "artifact_size_bytes": len(serialized),
        "model_size_bytes": len(glb_contents),
    }