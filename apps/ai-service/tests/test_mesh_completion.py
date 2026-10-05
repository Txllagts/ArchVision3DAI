import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import open3d as o3d
import trimesh

from app.services.mesh_completion import complete_mesh
from app.services.mesh_completion import _fill_small_holes


class MeshCompletionTests(unittest.TestCase):
    def test_poisson_reconstructs_closed_mesh_and_transfers_vertex_colors(self) -> None:
        o3d.utility.random.seed(0)
        source = trimesh.creation.box(extents=[2.0, 1.0, 0.5])
        source.visual.vertex_colors = np.column_stack(
            (
                np.linspace(20, 220, len(source.vertices), dtype=np.uint8),
                np.linspace(230, 30, len(source.vertices), dtype=np.uint8),
                np.full(len(source.vertices), 90, dtype=np.uint8),
                np.full(len(source.vertices), 255, dtype=np.uint8),
            )
        )
        source_colors = source.visual.vertex_colors.copy()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "box.glb"
            source.export(path, file_type="glb")

            complete_mesh(path)

            result = trimesh.load(
                path, file_type="glb", force="scene", process=False
            ).to_geometry()

        self.assertTrue(result.is_watertight)
        self.assertTrue(result.is_volume)
        self.assertGreater(result.volume, 0)
        colors = result.visual.vertex_colors
        self.assertEqual(colors.shape, (len(result.vertices), 4))
        self.assertTrue(np.all(colors[:, 3] == 255))
        self.assertGreater(len(np.unique(colors[:, :3], axis=0)), 1)
        self.assertTrue(set(map(tuple, colors)).issubset(set(map(tuple, source_colors))))

    def test_falls_back_to_clean_source_when_poisson_output_is_invalid(self) -> None:
        source = trimesh.creation.box()
        source.visual.vertex_colors = [120, 160, 200, 255]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fallback.glb"
            original = source.export(file_type="glb")
            path.write_bytes(original)
            open_output = o3d.geometry.TriangleMesh(
                o3d.utility.Vector3dVector(np.asarray(source.vertices)),
                o3d.utility.Vector3iVector(np.asarray(source.faces[:-2])),
            )
            with (
                patch(
                    "app.services.mesh_completion.o3d.geometry.TriangleMesh."
                    "create_from_point_cloud_poisson",
                    return_value=(open_output, np.ones(len(source.vertices))),
                ),
            ):
                complete_mesh(path)

            result = trimesh.load(
                path, file_type="glb", force="scene", process=False
            ).to_geometry()
            completed = path.read_bytes()

        self.assertNotEqual(completed, original)
        self.assertTrue(result.is_watertight)
        self.assertTrue(result.is_volume)
        self.assertGreater(result.volume, 0)
        self.assertEqual(
            result.visual.vertex_colors.shape,
            (len(result.vertices), 4),
        )

    def test_fills_small_boundary_hole_but_does_not_close_large_opening(self) -> None:
        source = trimesh.creation.box()
        vertices, faces = trimesh.remesh.subdivide(source.vertices, source.faces)
        vertices, faces = trimesh.remesh.subdivide(vertices, faces)
        small_opening = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        small_opening.update_faces(np.arange(len(small_opening.faces) - 1))
        small_opening.remove_unreferenced_vertices()

        repaired = _fill_small_holes(small_opening)

        self.assertTrue(repaired.is_watertight)

        large_opening = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        top_faces = np.flatnonzero(
            np.asarray(large_opening.face_normals)[:, 2] > 0.9
        )
        large_opening.update_faces(
            ~np.isin(np.arange(len(large_opening.faces)), top_faces)
        )
        large_opening.remove_unreferenced_vertices()

        refused = _fill_small_holes(large_opening)

        self.assertFalse(refused.is_watertight)

    def test_does_not_rewrite_glb_if_source_and_poisson_are_invalid(self) -> None:
        source = trimesh.creation.box()
        source.update_faces(np.arange(len(source.faces) - 4))
        source.remove_unreferenced_vertices()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.glb"
            original = source.export(file_type="glb")
            path.write_bytes(original)
            open_output = o3d.geometry.TriangleMesh(
                o3d.utility.Vector3dVector(np.asarray(source.vertices)),
                o3d.utility.Vector3iVector(np.asarray(source.faces)),
            )
            with (
                patch(
                    "app.services.mesh_completion.o3d.geometry.TriangleMesh."
                    "create_from_point_cloud_poisson",
                    return_value=(open_output, np.ones(len(source.vertices))),
                ),
                self.assertRaisesRegex(ValueError, "no se subirá"),
            ):
                complete_mesh(path)

            self.assertEqual(path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
