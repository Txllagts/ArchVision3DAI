"""Pruebas del aplanado de iluminación previo a la detección de muros (P2a).

Cubren: conservación de tamaño y modo, regresión (preprocess=False idéntico al
comportamiento previo) y recuperación bajo un gradiente fuerte donde el Otsu
global falla.
"""

from __future__ import annotations

import io
import unittest

from app.services.floorplan import analyze_floorplan
from app.services.plan_preprocess import flatten_illumination
from app.settings import Settings
from tools.evaluate_floorplan import (
    _entity_segments,
    _png_bytes,
    _wall_metrics,
    _wall_runs,
)
from tools.synthetic_plans import generate_plan, illuminate_plan


def _recall(plan, settings: Settings, preprocess: bool, tolerance: float = 6.0) -> float:
    ground_truth = _wall_runs(plan)
    data = _png_bytes(plan.image)
    try:
        result = analyze_floorplan(
            f"{plan.name}.png", data, settings, preprocess=preprocess
        )
    except Exception:
        return 0.0
    detected = [
        segment
        for entity in result["entities"]
        if entity.get("role") == "wall_candidate"
        for segment in _entity_segments(entity)
    ]
    _, recall, _ = _wall_metrics(ground_truth, detected, tolerance, tolerance / 2)
    return recall


class FlattenIlluminationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(_env_file=None)

    def test_preserves_size_and_mode(self) -> None:
        for seed in (1, 20260101, 20260105):
            image = generate_plan(seed).image.convert("RGB")
            flattened = flatten_illumination(image)
            self.assertEqual(flattened.size, image.size)
            self.assertEqual(flattened.mode, "RGB")

    def test_regression_without_preprocess_is_unchanged(self) -> None:
        # preprocess=False (y el valor por defecto) deben dar exactamente lo mismo.
        for seed in (20260101, 20260102, 20260103, 20260104):
            plan = generate_plan(seed)
            data = _png_bytes(plan.image)
            default = analyze_floorplan(f"{plan.name}.png", data, self.settings)
            explicit = analyze_floorplan(
                f"{plan.name}.png", data, self.settings, preprocess=False
            )
            self.assertEqual(default["entities"], explicit["entities"])

    def test_preprocess_recovers_strong_gradient(self) -> None:
        # A intensidad 0.85 el Otsu global falla (~0.44); con preprocess debe
        # recuperar el recall de muros por encima de 0.95.
        for seed in (20260101, 20260102, 20260103):
            plan = generate_plan(seed)
            degraded = illuminate_plan(plan, 0.85)
            recall_without = _recall(degraded, self.settings, False)
            recall_with = _recall(degraded, self.settings, True)
            self.assertGreater(recall_with, recall_without)
            self.assertGreaterEqual(recall_with, 0.95)


if __name__ == "__main__":
    unittest.main()
