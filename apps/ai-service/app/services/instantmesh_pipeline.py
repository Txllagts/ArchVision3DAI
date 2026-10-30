import logging
import os
import subprocess
import tempfile
from pathlib import Path

import trimesh
from PIL import Image

from app.settings import Settings

logger = logging.getLogger("archvision.ai.instantmesh")


def _abspath_no_symlink(path: Path) -> Path:
    """Convierte a ruta absoluta normalizando '..' sin resolver symlinks (clave para venv en Linux)."""
    return Path(os.path.abspath(path.expanduser()))


def _resolve_python_executable(configured_path: Path) -> Path:
    """Resuelve el ejecutable de Python de forma compatible entre Windows y Linux.

    Soporta:
    - Ruta directa al binario (`.../bin/python` en Linux o `.../Scripts/python.exe` en Windows).
    - Ruta al directorio raíz del entorno virtual (ej. `.venv`).
    - Rutas cruzadas entre sistemas operativos (ej. `.venv/Scripts/python.exe` usado en Linux
      o `.venv/bin/python` usado en Windows).
    """
    normalized_raw = str(configured_path).replace("\\", "/")
    candidate = _abspath_no_symlink(Path(normalized_raw))
    if candidate.is_file():
        return candidate

    venv_roots: list[Path] = []
    if candidate.is_dir():
        venv_roots.append(candidate)
    if candidate.parent.name.lower() in {"scripts", "bin"}:
        venv_roots.append(candidate.parent.parent)

    rel_candidates = (
        ("Scripts/python.exe", "Scripts/python", "bin/python", "bin/python3")
        if os.name == "nt"
        else ("bin/python", "bin/python3", "Scripts/python.exe", "Scripts/python")
    )

    for root in venv_roots:
        for rel in rel_candidates:
            option = _abspath_no_symlink(root / rel)
            if option.is_file():
                return option

    return candidate


class InstantMeshPipeline:
    def __init__(self, settings: Settings) -> None:
        if settings.instantmesh_repo_dir is None or settings.instantmesh_python is None:
            raise RuntimeError(
                "Configura INSTANTMESH_REPO_DIR e INSTANTMESH_PYTHON para habilitar InstantMesh."
            )
        self._repository = settings.instantmesh_repo_dir.expanduser().resolve()
        self._python = _resolve_python_executable(settings.instantmesh_python)
        self._config = (self._repository / settings.instantmesh_config).resolve()
        self._timeout = settings.instantmesh_timeout_seconds
        if not (self._repository / "run.py").is_file():
            raise RuntimeError(
                f"No se encontró run.py en INSTANTMESH_REPO_DIR={self._repository}."
            )
        if not self._python.is_file():
            raise RuntimeError(
                f"No se encontró el intérprete configurado para InstantMesh: {self._python}."
            )
        if not self._config.is_file() or not self._config.is_relative_to(self._repository):
            raise RuntimeError(
                "La configuración de InstantMesh no existe o queda fuera del repositorio."
            )

    def generate(self, image: Image.Image, output_path: Path) -> None:
        with tempfile.TemporaryDirectory(prefix="archvision-instantmesh-") as directory:
            work = Path(directory)
            input_path = work / "input.png"
            output_dir = work / "outputs"
            image.convert("RGB").save(input_path, format="PNG")

            command = [
                str(self._python),
                str(self._repository / "run.py"),
                str(self._config),
                str(input_path),
                "--output_path",
                str(output_dir),
                "--view",
                "6",
            ]
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            try:
                completed = subprocess.run(
                    command,
                    cwd=self._repository,
                    env=env,
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=self._timeout,
                )
            except subprocess.TimeoutExpired as error:
                logger.exception(
                    "InstantMesh timed out after %s seconds",
                    self._timeout,
                )
                raise RuntimeError(
                    f"InstantMesh excedió el límite de {self._timeout} segundos."
                ) from error
            except OSError as error:
                logger.exception("No se pudo iniciar el proceso InstantMesh")
                raise RuntimeError(
                    "No se pudo iniciar InstantMesh con el intérprete configurado."
                ) from error

            if completed.returncode != 0:
                logger.error(
                    "InstantMesh failed (exit=%s). stdout_tail=%s stderr_tail=%s",
                    completed.returncode,
                    completed.stdout[-4000:],
                    completed.stderr[-8000:],
                )
                raise RuntimeError(
                    "InstantMesh falló durante la generación. Consulta stdout/stderr "
                    "del microservicio para el detalle del proceso."
                )

            mesh_path = (
                output_dir
                / self._config.stem
                / "meshes"
                / "input.obj"
            )
            if not mesh_path.is_file():
                raise RuntimeError(
                    "InstantMesh terminó sin producir el OBJ esperado en "
                    f"{mesh_path.relative_to(output_dir)}."
                )
            generated = trimesh.load(mesh_path, file_type="obj", force="scene")
            if not isinstance(generated, trimesh.Scene) or not generated.geometry:
                raise RuntimeError("InstantMesh produjo un OBJ sin geometría.")
            mesh = generated.to_geometry()
            if not isinstance(mesh, trimesh.Trimesh) or mesh.is_empty:
                raise RuntimeError("InstantMesh no produjo una malla triangular válida.")
            output_path.write_bytes(mesh.export(file_type="glb"))
