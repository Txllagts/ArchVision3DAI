import unittest

import trimesh

from app.services.glb_validation import validate_generated_glb


class GeneratedGlbValidationTests(unittest.TestCase):
    def test_accepts_colored_watertight_positive_volume_glb(self) -> None:
        mesh = trimesh.creation.box()
        mesh.visual.vertex_colors = [180, 120, 80, 255]
        contents = mesh.export(file_type="glb")

        validated = validate_generated_glb(contents)

        self.assertTrue(validated.is_watertight)
        self.assertGreater(validated.volume, 0)
        self.assertEqual(validated.visual.vertex_colors.shape, (len(validated.vertices), 4))

    def test_rejects_invalid_glb_header(self) -> None:
        with self.assertRaisesRegex(ValueError, "cabecera GLB"):
            validate_generated_glb(b"not-a-glb")


if __name__ == "__main__":
    unittest.main()
