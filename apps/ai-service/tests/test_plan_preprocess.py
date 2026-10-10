"""Pruebas del aplanado de iluminación previo a la detección de muros (P2a).

Cubren: conservación de tamaño y modo, regresión (preprocess=False idéntico al
comportamiento previo) y recuperación bajo un gradiente fuerte donde el Otsu
global falla.
"""

from __future__ import annotations

import io
import math
import unittest

import numpy as np
from PIL import Image

from app.services.floorplan import analyze_floorplan
from app.services.plan_preprocess import (
    SKEW_CONFIDENCE_THRESHOLD,
    estimate_skew,
    flatten_illumination,
    map_entities_to_original,
    rotate_with_matrix,
)
from app.settings import Settings
from tools.evaluate_floorplan import (
    _entity_segments,
    _png_bytes,
    _wall_metrics,
    _wall_runs,
)
from tools.synthetic_plans import generate_plan, illuminate_plan, rotate_plan


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


class DeskewTest(unittest.TestCase):
    """Estimación y corrección de inclinación (P2b)."""

    def setUp(self) -> None:
        self.settings = Settings(_env_file=None)

    def test_estimate_skew_accuracy_within_one_degree(self) -> None:
        plan = generate_plan(20260101)
        for angle in (0, 5, 13, 20, 30, 45):
            rotated = rotate_plan(plan, angle)
            estimated, confidence = estimate_skew(rotated.image)
            expected = angle % 90
            if expected >= 45:
                expected -= 90
            difference = (estimated - expected + 45.0) % 90.0 - 45.0
            self.assertGreater(confidence, SKEW_CONFIDENCE_THRESHOLD)
            self.assertLessEqual(abs(difference), 1.0)

    def test_point_round_trip_within_one_pixel(self) -> None:
        _, matrix = rotate_with_matrix(generate_plan(1).image, 17.0)
        point = (123.0, 456.0)
        rotated = matrix @ np.array([point[0], point[1], 1.0])
        entity = {"type": "line", "points": [[rotated[0], rotated[1]]], "closed": False}
        back = map_entities_to_original([entity], matrix)[0]["points"][0]
        self.assertLessEqual(math.hypot(back[0] - point[0], back[1] - point[1]), 1.0)

    def test_blank_and_noise_are_not_rotated(self) -> None:
        rng = np.random.default_rng(0)
        blank = Image.new("RGB", (800, 600), "white")
        noise = Image.fromarray(
            rng.integers(0, 256, (600, 800, 3), dtype=np.uint8), "RGB"
        )
        for image in (blank, noise):
            _, confidence = estimate_skew(image)
            self.assertLess(confidence, SKEW_CONFIDENCE_THRESHOLD)

    def test_clean_plan_identical_with_and_without_deskew(self) -> None:
        for seed in (20260101, 20260102, 20260103):
            plan = generate_plan(seed)
            data = _png_bytes(plan.image)
            without = analyze_floorplan(f"{plan.name}.png", data, self.settings)
            with_deskew = analyze_floorplan(
                f"{plan.name}.png", data, self.settings, deskew=True
            )
            self.assertEqual(without["entities"], with_deskew["entities"])


if __name__ == "__main__":
    unittest.main()
