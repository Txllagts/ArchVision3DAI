import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import trimesh

from app.services.geometry_utils import (
    _correct_upside_down,
    _end_surface_areas,
    canonicalize_glb,
)


class GeometryCanonicalizationTests(unittest.TestCase):
    def test_rotated_bed_is_y_up_centered_and_grounded_for_gltf(self) -> None:
        mattress = trimesh.creation.box(extents=[2.0, 1.2, 0.2])
        headboard = trimesh.creation.box(extents=[1.2, 0.12, 0.5])
        headboard.apply_translation([0, -0.92, 0.34])
        bed = trimesh.util.concatenate([mattress, headboard])
        rotation = trimesh.transformations.euler_matrix(0.31, -0.22, 0.73)[:3, :3]
        transform = np.eye(4)
        transform[:3, :3] = rotation
        transform[:3, 3] = [4.5, -2.0, 7.25]
        bed.apply_transform(transform)

        with tempfile.TemporaryDirectory() as directory:
            glb_path = Path(directory) / "rotated-bed.glb"
            bed.export(glb_path, file_type="glb")

            canonicalize_glb(glb_path)

            result = trimesh.load(
                glb_path, file_type="glb", force="scene", process=False
            ).to_geometry()

        bounds = result.bounds
        extents = result.extents
        covariance = np.cov(np.asarray(result.vertices).T, bias=True)

        self.assertAlmostEqual((bounds[0, 0] + bounds[1, 0]) / 2, 0.0, places=5)
        self.assertAlmostEqual(bounds[0, 1], 0.0, places=5)
        self.assertAlmostEqual((bounds[0, 2] + bounds[1, 2]) / 2, 0.0, places=5)
        self.assertGreater(extents[0], extents[2])
        self.assertLess(extents[1], min(extents[0], extents[2]))
        off_diagonal = covariance - np.diag(np.diag(covariance))
        self.assertLess(float(np.max(np.abs(off_diagonal))), 1e-5)

    def test_flipped_bed_uses_denser_end_as_up(self) -> None:
        parts = [
            trimesh.creation.box(extents=[2.0, 0.2, 1.2]),
            trimesh.creation.box(extents=[0.1, 0.3, 0.1]),
            trimesh.creation.box(extents=[0.1, 0.3, 0.1]),
            trimesh.creation.box(extents=[0.1, 0.3, 0.1]),
            trimesh.creation.box(extents=[0.1, 0.3, 0.1]),
            trimesh.creation.box(extents=[1.2, 0.55, 0.12]),
        ]
        parts[0].apply_translation([0, 0.4, 0])
        parts[1].apply_translation([-0.8, 0.15, -0.45])
        parts[2].apply_translation([0.8, 0.15, -0.45])
        parts[3].apply_translation([-0.8, 0.15, 0.45])
        parts[4].apply_translation([0.8, 0.15, 0.45])
        parts[5].apply_translation([0, 0.58, -0.54])
        bed = trimesh.util.concatenate(parts)

        upside_down = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])
        bed.apply_transform(upside_down)
        arbitrary_rotation = trimesh.transformations.euler_matrix(0.27, 0.61, -0.38)
        bed.apply_transform(arbitrary_rotation)

        with tempfile.TemporaryDirectory() as directory:
            glb_path = Path(directory) / "upside-down-bed.glb"
            bed.export(glb_path, file_type="glb")
            canonicalize_glb(glb_path)
            result = trimesh.load(
                glb_path, file_type="glb", force="scene", process=False
            ).to_geometry()

        lower_area, upper_area = _end_surface_areas(result)
        self.assertAlmostEqual(result.bounds[0, 1], 0.0, places=5)
        self.assertGreater(upper_area, lower_area * 1.1)
        self.assertLess(result.extents[1], min(result.extents[0], result.extents[2]))

    def test_density_heuristic_flips_inverted_bed(self) -> None:
        mattress = trimesh.creation.box(extents=[2.0, 0.2, 1.2])
        mattress.apply_translation([0, 0.4, 0])
        legs = []
        for x in (-0.8, 0.8):
            for z in (-0.45, 0.45):
                leg = trimesh.creation.box(extents=[0.1, 0.3, 0.1])
                leg.apply_translation([x, 0.15, z])
                legs.append(leg)
        inverted = trimesh.util.concatenate([mattress, *legs])
        inverted.apply_transform(
            trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])
        )

        lower_before, upper_before = _end_surface_areas(inverted)
        corrected = _correct_upside_down(inverted)
        lower_after, upper_after = _end_surface_areas(inverted)

        self.assertGreater(lower_before, upper_before * 1.1)
        self.assertTrue(corrected)
        self.assertGreater(upper_after, lower_after * 1.1)

    def test_rejects_glb_without_mesh_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            glb_path = Path(directory) / "empty.glb"
            glb_path.touch()

            with (
                patch(
                    "app.services.geometry_utils.trimesh.load",
                    return_value=trimesh.Scene(),
                ),
                self.assertRaisesRegex(ValueError, "no contiene una escena"),
            ):
                canonicalize_glb(glb_path)


if __name__ == "__main__":
    unittest.main()
