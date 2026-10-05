import logging
from pathlib import Path

import numpy as np
import trimesh

logger = logging.getLogger("archvision.ai.geometry")


def _end_surface_areas(mesh: trimesh.Trimesh, band_fraction: float = 0.05) -> tuple[float, float]:
    """Estimate how much surface geometry occupies each end of the up axis."""
    y_min, y_max = mesh.bounds[:, 1]
    band = max((y_max - y_min) * band_fraction, 1e-8)
    face_y = mesh.triangles_center[:, 1]
    face_areas = mesh.area_faces
    lower_area = float(face_areas[face_y <= y_min + band].sum())
    upper_area = float(face_areas[face_y >= y_max - band].sum())
    return lower_area, upper_area


def _correct_upside_down(mesh: trimesh.Trimesh) -> bool:
    lower_area, upper_area = _end_surface_areas(mesh)
    if lower_area <= upper_area * 1.1:
        return False

    correction = np.diag([1.0, -1.0, -1.0, 1.0])
    mesh.apply_transform(correction)
    logger.info(
        "Corrected inverted object orientation from end surface density "
        "(lower=%.6f, upper=%.6f)",
        lower_area,
        upper_area,
    )
    return True


def canonicalize_glb(path: Path) -> None:
    """Align a flat object's principal axes to the Y-up glTF convention."""
    scene = trimesh.load(path, file_type="glb", force="scene", process=False)
    if not isinstance(scene, trimesh.Scene) or not scene.geometry:
        raise ValueError("El GLB generado no contiene una escena con geometría.")

    mesh = scene.to_geometry()
    if not isinstance(mesh, trimesh.Trimesh) or mesh.is_empty or not len(mesh.vertices):
        raise ValueError("El GLB generado no contiene una malla triangular utilizable.")

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    if not np.isfinite(vertices).all():
        raise ValueError("La malla GLB contiene coordenadas no finitas.")

    centered_vertices = vertices - vertices.mean(axis=0)
    covariance = centered_vertices.T @ centered_vertices / len(centered_vertices)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues = eigenvalues[order]
    principal_axes = eigenvectors[:, order]

    # PCA axis signs are ambiguous; skewness provides a rotation-invariant
    # preference when the shape is asymmetric. Symmetric axes use a stable tie-break.
    for index in range(3):
        projections = centered_vertices @ principal_axes[:, index]
        skew = float(np.mean(projections**3))
        scale = max(float(np.max(np.abs(projections))), 1.0)
        if abs(skew) > 1e-12 * scale**3:
            if skew < 0:
                principal_axes[:, index] *= -1
        else:
            pivot = int(np.argmax(np.abs(principal_axes[:, index])))
            if principal_axes[pivot, index] < 0:
                principal_axes[:, index] *= -1

    projected = centered_vertices @ principal_axes
    projected_extents = np.ptp(projected, axis=0)
    up_index = int(np.argmin(projected_extents))
    horizontal_indices = [
        index for index in range(3) if index != up_index
    ]
    length_index = max(
        horizontal_indices, key=lambda index: projected_extents[index]
    )
    width_index = next(
        index for index in horizontal_indices if index != length_index
    )

    # glTF viewers such as Three.js use +Y as up. Place the thinnest PCA
    # dimension on Y and the longest horizontal dimension on X.
    canonical_axes = principal_axes[:, [length_index, up_index, width_index]]
    if np.linalg.det(canonical_axes) < 0:
        canonical_axes[:, 2] *= -1

    transform = np.eye(4, dtype=np.float64)
    transform[:3, :3] = canonical_axes.T
    mesh.apply_transform(transform)

    if not _correct_upside_down(mesh):
        lower_area, upper_area = _end_surface_areas(mesh)
        logger.info(
            "Kept PCA orientation from end surface density "
            "(lower=%.6f, upper=%.6f)",
            lower_area,
            upper_area,
        )

    bounds = mesh.bounds
    translation = np.array(
        [
            -(bounds[0, 0] + bounds[1, 0]) / 2,
            -bounds[0, 1],
            -(bounds[0, 2] + bounds[1, 2]) / 2,
        ]
    )
    mesh.apply_translation(translation)
    if not np.isclose(mesh.bounds[0, 1], 0.0, atol=1e-8):
        raise RuntimeError("No se pudo apoyar la geometría sobre el plano Y=0.")

    path.write_bytes(mesh.export(file_type="glb"))

    dimensions = mesh.extents
    if dimensions[1] > min(dimensions[0], dimensions[2]) + 1e-8:
        raise RuntimeError(
            "La dimensión vertical estimada supera una dimensión horizontal; "
            "no se puede garantizar la orientación de un objeto plano."
        )
    logger.info(
        "Canonicalized generated GLB (+Y up): dimensions_xyz=%s, "
        "pca_variances=%s",
        np.round(dimensions, 4).tolist(),
        np.round(eigenvalues, 6).tolist(),
    )
