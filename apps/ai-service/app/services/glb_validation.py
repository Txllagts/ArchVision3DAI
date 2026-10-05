import io

import numpy as np
import trimesh

MAX_GLB_BYTES = 50 * 1024 * 1024


def validate_generated_glb(contents: bytes) -> trimesh.Trimesh:
    if not contents or len(contents) > MAX_GLB_BYTES:
        raise ValueError("El GLB está vacío o supera el límite de 50 MiB.")
    if contents[:4] != b"glTF":
        raise ValueError("El archivo generado no tiene una cabecera GLB válida.")

    scene = trimesh.load(
        io.BytesIO(contents),
        file_type="glb",
        force="scene",
        process=False,
    )
    if not isinstance(scene, trimesh.Scene) or not scene.geometry:
        raise ValueError("El GLB no contiene geometría.")
    mesh = scene.to_geometry()
    if (
        not isinstance(mesh, trimesh.Trimesh)
        or mesh.is_empty
        or not mesh.is_watertight
        or not mesh.is_volume
        or mesh.volume <= 0
    ):
        raise ValueError("El GLB no es watertight ni un volumen positivo.")
    colors = np.asarray(mesh.visual.vertex_colors)
    if colors.shape != (len(mesh.vertices), 4) or not np.isfinite(colors).all():
        raise ValueError("El GLB no contiene colores RGBA válidos por vértice.")
    return mesh
