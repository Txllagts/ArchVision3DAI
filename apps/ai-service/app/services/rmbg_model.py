"""Gestion del modelo ONNX RMBG-1.4: validacion previa y descarga automatica.

El archivo local llego corrupto: un ONNX real re-encoded como texto UTF-8
(secuencias ``EF BF BD`` = U+FFFD en mitad del stream), que ONNX Runtime
rechaza con ``InvalidProtobuf``. Ojo con la trampa de cabecera: un ONNX
exportado con ``torch.onnx.export`` lleva ``producer_name="pytorch"``
dentro de los primeros bytes, igual que un checkpoint; la marca "pytorch"
por si sola no distingue nada. Los formatos de checkpoint se reconocen por
sus propios magics (``PK`` del zip de ``torch.save``, ``\\x80`` del pickle
legacy) y un puntero de Git LFS por su cabecera textual.

Antes de montar la sesion se inspecciona cabecera y tamano; si el archivo
no es un ONNX plausible se pone en cuarentena y se descarga el oficial de
Hugging Face (``briaai/RMBG-1.4``, ``onnx/model.onnx``). Si aun asi la
sesion de ONNX Runtime lo rechaza, el caller puede forzar una reinstalacion
con :func:`ensure_rmbg_model` (``force=True``). Cualquier fallo se comunica
con :class:`RmbgModelError` y el lifespan degrada sin tumbar el servicio.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from app.settings import Settings

logger = logging.getLogger("archvision.ai.rmbg")

# Cabeceras de los formatos de checkpoint de PyTorch: ``PK`` es el zip de
# ``torch.save`` moderno y ``\\x80`` el pickle del formato legado.
_PYTORCH_ZIP_MAGIC = b"PK"
_PYTORCH_PICKLE_MAGIC = b"\x80"
# Puntero de Git LFS: el "archivo" descargado sin smudge es texto de ~130 B.
_LFS_POINTER_MAGIC = b"version https://git-lfs"
# El ModelProto de ONNX serializa primero el campo ir_version (tag 0x08).
_ONNX_FIRST_BYTE = 0x08
# El ONNX oficial de RMBG-1.4 pesa ~176 MB; por debajo de 10 MB no puede
# ser el modelo (una pagina de error de HTML ronda los KB).
MIN_MODEL_BYTES = 10 * 1024 * 1024
_HEADER_BYTES = 64
_QUARANTINE_SUFFIX = ".invalid-checkpoint"


class RmbgModelError(RuntimeError):
    """El modelo RMBG no esta disponible y no pudo obtenerse."""


def inspect_rmbg_model(path: Path) -> str:
    """Clasifica el archivo: ``"valid"`` o un motivo legible para el log."""
    if not path.is_file():
        return "missing"

    size = path.stat().st_size
    if size < MIN_MODEL_BYTES:
        return f"too-small ({size} bytes)"

    with path.open("rb") as handle:
        header = handle.read(_HEADER_BYTES)

    lowered = header.lstrip().lower()
    if lowered.startswith((b"<!doctype", b"<html")):
        return "html-error-page"
    if lowered.startswith(_LFS_POINTER_MAGIC):
        return "git-lfs-pointer"
    if header.startswith(_PYTORCH_ZIP_MAGIC):
        return "pytorch-zip-checkpoint (no es un ONNX)"
    if header.startswith(_PYTORCH_PICKLE_MAGIC):
        return "pickle-checkpoint (no es un ONNX)"
    if header[0] != _ONNX_FIRST_BYTE:
        return f"unknown-header (0x{header[0]:02x})"
    return "valid"


def _quarantine(path: Path) -> None:
    """Aparta el archivo invalido para liberar la ruta canonica."""
    quarantine = path.with_name(path.name + _QUARANTINE_SUFFIX)
    try:
        os.replace(path, quarantine)
        logger.warning("Modelo RMBG invalido movido a %s", quarantine)
    except OSError as error:
        logger.warning("No se pudo apartar el modelo invalido %s: %s", path, error)


def _download_official_model(settings: Settings, target: Path) -> Path:
    """Descarga el ONNX oficial y lo instala atomicamente en ``target``."""
    from huggingface_hub import hf_hub_download

    staging = target.parent / ".rmbg-download"
    staging.mkdir(parents=True, exist_ok=True)
    logger.info(
        "Descargando RMBG-1.4 desde %s/%s",
        settings.rembg_model_repo,
        settings.rembg_model_repo_file,
    )
    downloaded = Path(
        hf_hub_download(
            repo_id=settings.rembg_model_repo,
            filename=settings.rembg_model_repo_file,
            local_dir=staging,
        )
    )

    status = inspect_rmbg_model(downloaded)
    if status != "valid":
        raise RmbgModelError(f"El archivo descargado no es un ONNX valido ({status}).")

    os.replace(downloaded, target)
    shutil.rmtree(staging, ignore_errors=True)
    return target


def ensure_rmbg_model(settings: Settings, *, force: bool = False) -> Path:
    """Garantiza un ONNX plausible en ``settings.rembg_model_path``.

    - Si el archivo ya es un ONNX valido, se devuelve tal cual.
    - Si falta o es invalido (checkpoint .pth/.pt, HTML de error, puntero
      LFS, truncado) se pone en cuarentena y se descarga el modelo oficial.
    - ``force=True`` obvia la validacion y reinstala el oficial: sirve para
      reintentar cuando ONNX Runtime rechazo un archivo que parecia valido
      (p. ej. corrupto a mitad de stream).
    - Si la descarga falla se lanza :class:`RmbgModelError` con un mensaje
      accionable.
    """
    target = settings.rembg_model_path

    if force:
        if not settings.rembg_auto_download:
            raise RmbgModelError(
                "La reinstalacion del modelo RMBG requiere "
                "REMBG_AUTO_DOWNLOAD=1."
            )
        if target.exists():
            _quarantine(target)
        logger.warning(
            "Reinstalando el modelo RMBG oficial en %s a peticion del caller.",
            target,
        )
    else:
        status = inspect_rmbg_model(target)
        if status == "valid":
            return target

        if not settings.rembg_auto_download:
            raise RmbgModelError(
                f"RMBG en {target} no es un ONNX valido ({status}) y la descarga "
                "automatica esta desactivada (REMBG_AUTO_DOWNLOAD=0). Descarga "
                f"{settings.rembg_model_repo}/{settings.rembg_model_repo_file} "
                "manualmente en esa ruta."
            )

        logger.warning(
            "Modelo RMBG ausente o invalido en %s (%s); se descargara el oficial "
            "de Hugging Face.",
            target,
            status,
        )
        if target.exists():
            _quarantine(target)

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        return _download_official_model(settings, target)
    except RmbgModelError:
        raise
    except Exception as error:
        raise RmbgModelError(
            f"No se pudo descargar RMBG-1.4 desde "
            f"{settings.rembg_model_repo}/{settings.rembg_model_repo_file}: {error}"
        ) from error
