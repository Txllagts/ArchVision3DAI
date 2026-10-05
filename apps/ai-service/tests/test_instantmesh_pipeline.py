import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import trimesh
from PIL import Image

from app.services.glb_validation import validate_generated_glb
from app.services.instantmesh_pipeline import InstantMeshPipeline
from app.settings import Settings


class InstantMeshPipelineTests(unittest.TestCase):
    def test_cli_obj_is_converted_to_colored_glb(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory) / "InstantMesh"
            (repository / "configs").mkdir(parents=True)
            (repository / "run.py").write_text("", encoding="utf-8")
            config_path = repository / "configs" / "instant-mesh-large.yaml"
            config_path.write_text("", encoding="utf-8")
            python_path = Path(directory) / "python.exe"
            python_path.write_text("", encoding="utf-8")
            settings = Settings(
                _env_file=None,
                instantmesh_repo_dir=repository,
                instantmesh_python=python_path,
            )
            pipeline = InstantMeshPipeline(settings)
            output_path = Path(directory) / "model.glb"

            def fake_run(command, **_kwargs):
                output_dir = Path(command[5])
                mesh_path = (
                    output_dir
                    / "instant-mesh-large"
                    / "meshes"
                    / "input.obj"
                )
                mesh_path.parent.mkdir(parents=True)
                mesh = trimesh.creation.box()
                mesh.visual.vertex_colors = [160, 110, 70, 255]
                mesh.export(mesh_path, file_type="obj")
                return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch("app.services.instantmesh_pipeline.subprocess.run", side_effect=fake_run):
                pipeline.generate(Image.new("RGB", (32, 32)), output_path)

            validated = validate_generated_glb(output_path.read_bytes())
            self.assertTrue(validated.is_watertight)
            self.assertEqual(
                validated.visual.vertex_colors.shape,
                (len(validated.vertices), 4),
            )

    def test_missing_cli_configuration_is_reported(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "INSTANTMESH_REPO_DIR"):
            InstantMeshPipeline(Settings(_env_file=None))


if __name__ == "__main__":
    unittest.main()
