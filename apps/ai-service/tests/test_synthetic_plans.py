"""Pruebas mínimas del generador de planos sintéticos.

Cubren lo pedido: determinismo del generador y de la degradación, etiquetas
dentro de rango y coherencia de la verdad de referencia. No usan binarios,
pesos ni ultralytics; solo PIL y numpy.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import random

from PIL import Image

from tools.synthetic_plans import (
    CLASS_DOOR,
    CLASS_WINDOW,
    GEO_TRANSFORMS,
    PHOTO_TRANSFORMS,
    apply_homography,
    degrade,
    degrade_isolated,
    degrade_plan,
    degrade_plan_isolated,
    generate_plan,
    plan_ground_truth,
    plan_yolo_lines,
    render_annotated_image,
    render_contact_sheet,
    write_plan,
)

SEEDS = (1, 2, 3, 20260101, 20260102)


def _image_digest(image) -> bytes:
    return image.tobytes()


class GeneratorDeterminismTest(unittest.TestCase):
    def test_same_seed_produces_identical_plan(self) -> None:
        for seed in SEEDS:
            first = generate_plan(seed)
            second = generate_plan(seed)
            self.assertEqual(_image_digest(first.image), _image_digest(second.image))
            self.assertEqual(plan_ground_truth(first), plan_ground_truth(second))

    def test_different_seeds_differ(self) -> None:
        self.assertNotEqual(
            _image_digest(generate_plan(1).image),
            _image_digest(generate_plan(2).image),
        )

    def test_degrade_same_seed_is_identical(self) -> None:
        plan = generate_plan(7)
        first = degrade_plan(plan, random.Random(99), 0.8)
        second = degrade_plan(plan, random.Random(99), 0.8)
        self.assertEqual(_image_digest(first.image), _image_digest(second.image))
        self.assertEqual(first.width, second.width)
        self.assertEqual(first.height, second.height)


class LabelsAndGroundTruthTest(unittest.TestCase):
    def test_labels_are_normalized_and_in_range(self) -> None:
        for seed in SEEDS:
            plan = generate_plan(seed)
            for line in plan_yolo_lines(plan):
                tokens = line.split()
                self.assertEqual(len(tokens), 9)  # clase + 4 puntos (x, y)
                self.assertIn(int(tokens[0]), {CLASS_DOOR, CLASS_WINDOW})
                for value in (float(token) for token in tokens[1:]):
                    self.assertGreaterEqual(value, 0.0)
                    self.assertLessEqual(value, 1.0)

    def test_ground_truth_openings_reference_valid_walls(self) -> None:
        for seed in SEEDS:
            plan = generate_plan(seed)
            truth = plan_ground_truth(plan)
            walls = {wall["index"]: wall for wall in truth["walls"]}
            for opening in truth["openings"]:
                self.assertIn(opening["wall_index"], walls)
                wall = walls[opening["wall_index"]]
                self.assertGreater(opening["width"], 0.0)
                self.assertGreaterEqual(opening["offset"], -1e-6)
                self.assertLessEqual(
                    opening["offset"] + opening["width"], wall["length"] + 1e-6
                )
                self.assertEqual(len(opening["polygon"]), 4)
                self.assertLessEqual(wall["thickness"], 20.0)
                self.assertGreaterEqual(wall["thickness"], 12.0)

    def test_write_plan_creates_all_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plan = generate_plan(20260102)
            paths = write_plan(plan, directory)
            for path in paths.values():
                self.assertTrue(Path(path).is_file())
            truth = json.loads(Path(paths["truth"]).read_text(encoding="utf-8"))
            self.assertEqual(truth["image_size"]["width"], plan.width)
            labels = [
                line
                for line in Path(paths["labels"]).read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(len(labels), len(plan.openings))


class DegradationConsistencyTest(unittest.TestCase):
    def test_strength_zero_is_identity(self) -> None:
        plan = generate_plan(11)
        result = degrade(plan.image, random.Random(0), 0.0)
        self.assertEqual(_image_digest(result.image), _image_digest(plan.image))
        mapped = apply_homography([plan.walls[0].start], result.matrix)
        self.assertAlmostEqual(mapped[0][0], plan.walls[0].start[0], places=6)
        self.assertAlmostEqual(mapped[0][1], plan.walls[0].start[1], places=6)

    def test_geometry_matches_homography(self) -> None:
        plan = generate_plan(5)
        rng = random.Random(321)
        degraded = degrade_plan(plan, rng, 0.6)
        # Reconstruimos la homografía con la misma semilla y comprobamos que la
        # geometría degradada es exactamente la transformación de la original.
        reference = degrade(plan.image, random.Random(321), 0.6)
        for wall, new_wall in zip(plan.walls, degraded.walls):
            mapped = apply_homography([wall.start, wall.end], reference.matrix)
            self.assertAlmostEqual(mapped[0][0], new_wall.start[0], places=6)
            self.assertAlmostEqual(mapped[0][1], new_wall.start[1], places=6)
            self.assertAlmostEqual(mapped[1][0], new_wall.end[0], places=6)
            self.assertAlmostEqual(mapped[1][1], new_wall.end[1], places=6)


class IsolatedDegradationTest(unittest.TestCase):
    """Degradación aislada (una transformación a la vez), usada en la ablación."""

    def test_isolated_is_deterministic(self) -> None:
        plan = generate_plan(9)
        for transform in (*GEO_TRANSFORMS, *PHOTO_TRANSFORMS):
            first = degrade_isolated(plan.image, random.Random(55), transform, 1.0)
            second = degrade_isolated(plan.image, random.Random(55), transform, 1.0)
            self.assertEqual(_image_digest(first.image), _image_digest(second.image))

    def test_isolated_photometric_keeps_geometry(self) -> None:
        plan = generate_plan(9)
        for transform in PHOTO_TRANSFORMS:
            result = degrade_isolated(plan.image, random.Random(2), transform, 1.0)
            self.assertEqual(result.image.size, plan.image.size)
            self.assertTrue(np.allclose(result.matrix, np.identity(3)))

    def test_isolated_geometric_changes_geometry(self) -> None:
        plan = generate_plan(9)
        for transform in GEO_TRANSFORMS:
            result = degrade_isolated(plan.image, random.Random(2), transform, 1.0)
            self.assertNotEqual(result.image.size, plan.image.size)
            self.assertFalse(np.allclose(result.matrix, np.identity(3)))

    def test_isolated_unknown_transform_raises(self) -> None:
        plan = generate_plan(9)
        with self.assertRaises(ValueError):
            degrade_isolated(plan.image, random.Random(0), "no_existe", 1.0)


class VisualizationTest(unittest.TestCase):
    def test_annotated_image_is_deterministic_and_has_expected_size(self) -> None:
        plan = generate_plan(13)
        first = render_annotated_image(plan)
        second = render_annotated_image(plan)
        self.assertEqual(first.size, plan.image.size)
        self.assertEqual(_image_digest(first), _image_digest(second))

    def test_contact_sheet_creates_image(self) -> None:
        plans = [generate_plan(seed) for seed in range(12)]
        with tempfile.TemporaryDirectory() as directory:
            path = render_contact_sheet(plans, Path(directory) / "sheet.png")
            self.assertTrue(path.is_file())
            with Image.open(path) as sheet:
                self.assertEqual(sheet.width, 4 * 280)
                self.assertEqual(sheet.height, 3 * 210)


if __name__ == "__main__":
    unittest.main()
