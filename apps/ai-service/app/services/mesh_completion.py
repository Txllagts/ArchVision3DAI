import logging
from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from scipy.spatial import cKDTree

logger = logging.getLogger("archvision.ai.geometry")
SMALL_HOLE_MAX_AREA_RATIO = 0.02


def _clean_mesh(mesh: trimesh.Trimesh) -> None:
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()


def _fill_small_holes(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    candidate = mesh.copy()
    original_area = float(candidate.area)
    if not np.isfinite(original_area) or original_area <= 0:
        return mesh

    trimesh.repair.fill_holes(candidate)
    _clean_mesh(candidate)
    if len(candidate.faces) <= len(mesh.faces):
        return mesh

    added_face_area = float(candidate.area) - original_area
    if (
        not np.isfinite(added_face_area)
        or added_face_area > original_area * SMALL_HOLE_MAX_AREA_RATIO
    ):
        return mesh
    trimesh.repair.fix_normals(candidate, multibody=True)
    return candidate


def _is_valid_solid(mesh: trimesh.Trimesh) -> bool:
    if mesh.is_empty or not mesh.is_watertight or not mesh.is_volume:
        return False
    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    extents = bounds[1] - bounds[0]
    scale_volume = float(np.prod(np.maximum(extents, 0.0)))
    volume_tolerance = max(
        np.finfo(np.float64).tiny,
        scale_volume * 1e-12,
    )
    return np.isfinite(mesh.volume) and mesh.volume > volume_tolerance


def _transfer_colors(
    mesh: trimesh.Trimesh,
    source_vertices: np.ndarray,
    source_colors: np.ndarray,
) -> None:
    nearest = cKDTree(source_vertices).query(
        np.asarray(mesh.vertices), k=1, workers=1
    )[1]
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh,
        vertex_colors=source_colors[nearest],
    )


def complete_mesh(path: Path) -> None:
    """Reconstruct a closed surface from the oriented mesh using Poisson."""
    scene = trimesh.load(path, file_type="glb", force="scene", process=False)
    if not isinstance(scene, trimesh.Scene) or not scene.geometry:
        raise ValueError("El GLB no contiene geometría para completar.")

    mesh = scene.to_geometry()
    if not isinstance(mesh, trimesh.Trimesh) or mesh.is_empty:
        raise ValueError("El GLB no contiene una malla triangular válida.")

    _clean_mesh(mesh)
    if not np.isfinite(mesh.vertices).all():
        raise ValueError("La malla GLB contiene coordenadas no finitas.")

    original_vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
    original_colors = np.asarray(mesh.visual.vertex_colors, dtype=np.uint8).copy()
    if original_colors.shape != (len(original_vertices), 4):
        raise ValueError("La malla original no contiene colores por vértice válidos.")

    trimesh.repair.fix_normals(mesh, multibody=True)
    repair_candidate = _fill_small_holes(mesh)
    if repair_candidate is not mesh:
        _transfer_colors(repair_candidate, original_vertices, original_colors)
        logger.info(
            "Filled small mesh openings before Poisson: added_faces=%s",
            len(repair_candidate.faces) - len(mesh.faces),
        )
    fallback_mesh = repair_candidate
    source = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(
            np.asarray(fallback_mesh.vertices, dtype=np.float64)
        ),
        o3d.utility.Vector3iVector(
            np.asarray(fallback_mesh.faces, dtype=np.int32)
        ),
    )
    source.compute_vertex_normals()
    if not source.has_vertex_normals():
        raise ValueError("No se pudieron calcular normales para Poisson.")

    point_count = min(max(len(fallback_mesh.vertices) * 2, 20_000), 60_000)
    point_cloud = source.sample_points_uniformly(
        number_of_points=point_count,
        use_triangle_normal=True,
    )
    reconstructed = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        point_cloud,
        depth=8,
        scale=1.1,
        linear_fit=False,
    )[0]
    if reconstructed.is_empty():
        raise ValueError("Poisson no produjo una superficie.")
    reconstructed.remove_unreferenced_vertices()
    reconstructed.remove_degenerate_triangles()
    reconstructed.remove_duplicated_triangles()
    reconstructed.remove_duplicated_vertices()
    reconstructed.remove_non_manifold_edges()

    result = trimesh.Trimesh(
        vertices=np.asarray(reconstructed.vertices),
        faces=np.asarray(reconstructed.triangles),
        process=True,
    )
    _clean_mesh(result)
    trimesh.repair.fix_normals(result, multibody=True)
    result = _fill_small_holes(result)
    _transfer_colors(result, original_vertices, original_colors)

    if not _is_valid_solid(result):
        if _is_valid_solid(fallback_mesh):
            logger.warning(
                "Poisson output remained open or invalid after bounded hole repair; "
                "using the cleaned watertight source mesh instead."
            )
            result = fallback_mesh
            _transfer_colors(result, original_vertices, original_colors)
        else:
            raise ValueError(
                "Poisson y la reparación de huecos pequeños no produjeron una "
                "malla watertight con volumen positivo; no se subirá una "
                "geometría incompleta."
            )

    reconstructed_glb = result.export(file_type="glb")
    if not reconstructed_glb or len(reconstructed_glb) > 50 * 1024 * 1024:
        raise ValueError(
            "El GLB reconstruido está vacío o supera el límite de 50 MiB."
        )
    if result.visual.vertex_colors.shape != (len(result.vertices), 4):
        raise ValueError("La malla reconstruida perdió sus colores por vértice.")
    path.write_bytes(reconstructed_glb)
    logger.info(
        "Poisson mesh reconstruction validated: input_watertight=%s, "
        "points=%s, depth=%s, watertight=%s, is_volume=%s, volume=%.6f, "
        "colored_vertices=%s, glb_bytes=%s",
        fallback_mesh.is_watertight,
        point_count,
        8,
        result.is_watertight,
        result.is_volume,
        result.volume,
        len(result.visual.vertex_colors),
        len(reconstructed_glb),
    )
