"""Prueba mínima de la herramienta de depuración visual ``tools/run_local.py``.

Verifica que, sobre un plano sintético, se generan los tres artefactos
(result.json, model.glb y overlay.png) y que una imagen de más de 4 megapíxeles
se rechaza con un error 422 claro, sin traceback.
"""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image

from tools.run_local import run
from tools.synthetic_plans import generate_plan, write_plan


class RunLocalTest(unittest.TestCase):
    def test_generates_three_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plan = generate_plan(20260102)
            paths = write_plan(plan, directory)
            output_dir = Path(directory) / "out"

            code = run(paths["image"], output_dir)

            self.assertEqual(code, 0)
            for name in ("result.json", "model.glb", "overlay.png"):
                artifact = output_dir / name
                self.assertTrue(artifact.is_file(), f"falta {name}")
                self.assertGreater(artifact.stat().st_size, 0, f"{name} vacío")

    def test_oversize_prints_422_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            big = Path(directory) / "big.png"
            Image.new("RGB", (2500, 2000), "white").save(big)  # 5 MP
            output_dir = Path(directory) / "out"

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = run(big, output_dir)

            self.assertEqual(code, 1)
            self.assertIn("422", buffer.getvalue())
            self.assertFalse((output_dir / "result.json").exists())


if __name__ == "__main__":
    unittest.main()
