import logging
import subprocess
import tempfile
from pathlib import Path

import trimesh
from PIL import Image

from app.settings import Settings

logger = logging.getLogger("archvision.ai.instantmesh")


class InstantMeshPipeline:
    def __init__(self, settings: Settings) -> None:
        if settings.instantmesh_repo_dir is None or settings.instantmesh_python is None:
            raise RuntimeError(
                "Configura INSTANTMESH_REPO_DIR e INSTANTMESH_PYTHON para habilitar InstantMesh."
            )
        self._repository = settings.instantmesh_repo_dir.resolve()
        self._python = settings.instantmesh_python.resolve()
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
            try:
                completed = subprocess.run(
                    command,
                    cwd=self._repository,
                    check=False,
                    capture_output=True,
                    text=True,
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
