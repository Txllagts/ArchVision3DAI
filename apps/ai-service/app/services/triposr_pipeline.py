import gc
import sys
import threading
from pathlib import Path

import numpy as np
import torch
import trimesh
from PIL import Image

from app.settings import Settings


class TriposrPipeline:
    def __init__(self, settings: Settings) -> None:
        if not torch.cuda.is_available():
            raise RuntimeError("TripoSR requiere CUDA; no se permite fallback a CPU.")
        # Reserva margen para el escritorio y otras asignaciones CUDA del sistema.
        torch.cuda.set_per_process_memory_fraction(settings.cuda_memory_fraction, device=0)

        repository = settings.triposr_repo_dir.resolve()
        if not (repository / "tsr" / "system.py").is_file():
            raise RuntimeError(f"No se encontró TripoSR en {repository}.")
        sys.path.insert(0, str(repository))
        from tsr.system import TSR
        from tsr.utils import resize_foreground

        self._torch = torch
        self._resize_foreground = resize_foreground
        self._model = TSR.from_pretrained(
            settings.triposr_model_id,
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        self._model.renderer.set_chunk_size(settings.triposr_chunk_size)
        self._model.to("cuda:0")
        self._resolution = settings.triposr_mc_resolution
        self._lock = threading.Lock()

    def generate(self, image: Image.Image, output_path: Path) -> trimesh.Trimesh:
        torch = self._torch
        try:
            foreground = self._resize_foreground(image.convert("RGBA"), 0.85)
            pixels = np.asarray(foreground).astype(np.float32) / 255.0
            rgb = pixels[:, :, :3] * pixels[:, :, 3:4] + (1.0 - pixels[:, :, 3:4]) * 0.5
            model_image = Image.fromarray((rgb * 255.0).astype(np.uint8))
            with self._lock, torch.inference_mode(), torch.autocast(
                device_type="cuda", dtype=torch.float16
            ):
                scene_codes = self._model([model_image], device="cuda:0")
                meshes = self._model.extract_mesh(
                    scene_codes, True, resolution=self._resolution
                )
                mesh = meshes[0]
                if not isinstance(mesh, trimesh.Trimesh):
                    raise RuntimeError("TripoSR no devolvió una malla trimesh.")
                mesh.remove_unreferenced_vertices()
                mesh.merge_vertices()
                trimesh.repair.fix_normals(mesh)
                if mesh.is_empty or len(mesh.faces) == 0:
                    raise RuntimeError("TripoSR generó una malla vacía.")
                mesh.export(output_path, file_type="glb")
                return mesh
        finally:
            # Libera temporales de inferencia; una RTX 2000 Ada dispone de solo 6 GB.
            try:
                if torch.cuda.is_available():
                    torch.cuda.synchronize()
            finally:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                gc.collect()

    def release_cuda_memory(self) -> None:
        with self._lock:
            self._model.to("cpu")
            if self._torch.cuda.is_available():
                self._torch.cuda.synchronize()
                self._torch.cuda.empty_cache()
            gc.collect()

    def restore_cuda_memory(self) -> None:
        with self._lock:
            self._model.to("cuda:0")
            if self._torch.cuda.is_available():
                self._torch.cuda.synchronize()
                self._torch.cuda.empty_cache()