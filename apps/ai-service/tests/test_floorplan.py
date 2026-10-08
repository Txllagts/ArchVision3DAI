import io
import math
import unittest

import ezdxf
import fitz
import trimesh
from PIL import Image, ImageDraw

from app.services.floorplan import (
    InvalidFloorplanError,
    analyze_floorplan,
    extrude_floorplan_to_3d,
)
from app.settings import Settings


class FloorplanAnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(_env_file=None)

    @staticmethod
    def _curved_dxf_bytes() -> bytes:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 6
        document.layers.new("A-WALL")
        modelspace = document.modelspace()
        modelspace.add_arc(
            (0, 0), 5, 0, 270, dxfattribs={"layer": "A-WALL"}
        )
        modelspace.add_circle((10, 10), 2, dxfattribs={"layer": "A-WALL"})
        modelspace.add_ellipse(
            (20, 0), major_axis=(4, 0), ratio=0.5, dxfattribs={"layer": "A-WALL"}
        )
        modelspace.add_spline(
            [(30, 0), (32, 3), (34, 0)], dxfattribs={"layer": "A-WALL"}
        )
        buffer = io.StringIO()
        document.write(buffer)
        return buffer.getvalue().encode("utf-8")

    @staticmethod
    def _diagonal_png_bytes() -> bytes:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 360, 360), outline="black", width=12)
        draw.line((60, 340, 340, 60), fill="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    @staticmethod
    def _bay_window_png_bytes() -> bytes:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 360, 328), outline="black", width=12)
        draw.arc((100, 200, 300, 380), start=25, end=155, fill="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    @staticmethod
    def _circular_wall_png_bytes() -> bytes:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((80, 80, 320, 320), outline="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    @staticmethod
    def _dxf_bytes() -> bytes:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 4
        document.layers.new("A-WALL")
        modelspace = document.modelspace()
        modelspace.add_line(
            (0, 0), (5000, 0), dxfattribs={"layer": "A-WALL"}
        )
        modelspace.add_lwpolyline(
            [(0, 0), (0, 4000), (5000, 4000)],
            dxfattribs={"layer": "A-WALL"},
        )
        buffer = io.StringIO()
        document.write(buffer)
        return buffer.getvalue().encode("utf-8")

    @staticmethod
    def _png_bytes() -> bytes:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 360, 360), outline="black", width=12)
        draw.line((200, 40, 200, 360), fill="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    @staticmethod
    def _pdf_bytes() -> bytes:
        document = fitz.open()
        page = document.new_page(width=400, height=400)
        shape = page.new_shape()
        shape.draw_rect(fitz.Rect(40, 40, 360, 360))
        shape.draw_line(fitz.Point(200, 40), fitz.Point(200, 360))
        shape.finish(color=(0, 0, 0), width=6)
        shape.commit()
        return document.tobytes()

    def test_extracts_dxf_linework_layers_and_units(self) -> None:
        result = analyze_floorplan("plan.dxf", self._dxf_bytes(), self.settings)

        self.assertEqual(result["source"]["kind"], "cad")
        self.assertEqual(result["source"]["units"], "millimeters")
        self.assertEqual(result["statistics"]["entity_count"], 2)
        self.assertTrue(
            all(entity["role"] == "wall_candidate" for entity in result["entities"])
        )
        self.assertEqual(result["bounds"]["max"], [5000.0, 4000.0])

    def test_extracts_raster_wall_candidates_in_pixel_coordinates(self) -> None:
        result = analyze_floorplan("plan.png", self._png_bytes(), self.settings)

        self.assertEqual(result["source"]["kind"], "raster")
        self.assertEqual(
            result["source"]["coordinate_system"],
            "image_pixels_top_left_origin",
        )
        self.assertGreater(result["statistics"]["wall_candidate_count"], 0)
        self.assertEqual(result["source"]["image_size"], {"width": 400, "height": 400})

    def test_raster_keeps_full_orthogonal_walls_and_filters_small_marks(self) -> None:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 360, 360), outline="black", width=12)
        draw.line((200, 40, 200, 360), fill="black", width=12)
        draw.rectangle((90, 110, 180, 175), outline="black", width=1)
        draw.line((230, 120, 300, 180), fill="black", width=1)
        draw.line((300, 120, 230, 180), fill="black", width=1)
        draw.line((95, 200, 150, 200), fill="black", width=1)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")

        result = analyze_floorplan("noisy-plan.png", buffer.getvalue(), self.settings)
        segments = [
            (entity["points"][0], entity["points"][1])
            for entity in result["entities"]
        ]

        self.assertTrue(segments)
        for start, end in segments:
            self.assertTrue(start[0] == end[0] or start[1] == end[1])
            self.assertGreaterEqual(
                abs(end[0] - start[0]) + abs(end[1] - start[1]), 40
            )
        self.assertLessEqual(result["bounds"]["min"][0], 45)
        self.assertGreaterEqual(result["bounds"]["max"][0], 355)
        self.assertLessEqual(result["bounds"]["min"][1], 45)
        self.assertGreaterEqual(result["bounds"]["max"][1], 355)

    def test_raster_keeps_structural_walls_in_disconnected_plan_sections(self) -> None:
        image = Image.new("RGB", (400, 400), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 155, 360, 360), outline="black", width=12)
        draw.rectangle((100, 40, 300, 140), outline="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")

        geometry = analyze_floorplan(
            "disconnected-sections.png", buffer.getvalue(), self.settings
        )
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")

        self.assertLess(geometry["bounds"]["min"][1], 50)
        self.assertGreater(geometry["bounds"]["max"][1], 350)
        self.assertLess(float(mesh.bounds[0][2]), 0.5)
        self.assertGreater(float(mesh.bounds[1][2]), 3.5)

    def test_renders_and_analyzes_pdf_first_page(self) -> None:
        result = analyze_floorplan("plan.pdf", self._pdf_bytes(), self.settings)

        self.assertEqual(result["source"]["extension"], "pdf")
        self.assertGreater(result["statistics"]["entity_count"], 0)
        self.assertEqual(result["source"]["units"], "pixels")

    def test_rejects_corrupt_cad_with_actionable_error(self) -> None:
        with self.assertRaisesRegex(InvalidFloorplanError, "DXF válido"):
            analyze_floorplan("broken.dxf", b"not a dxf", self.settings)

    def test_rejects_valid_cad_without_supported_modelspace_geometry(self) -> None:
        document = ezdxf.new("R2010")
        buffer = io.StringIO()
        document.write(buffer)

        with self.assertRaisesRegex(InvalidFloorplanError, "no contiene líneas"):
            analyze_floorplan(
                "empty.dxf", buffer.getvalue().encode("utf-8"), self.settings
            )

    def test_rejects_raster_without_detectable_walls(self) -> None:
        blank = Image.new("RGB", (200, 200), "white")
        buffer = io.BytesIO()
        blank.save(buffer, format="PNG")

        with self.assertRaisesRegex(InvalidFloorplanError, "No se detectaron"):
            analyze_floorplan("blank.png", buffer.getvalue(), self.settings)

    def test_rejects_dwg_without_oda_converter(self) -> None:
        with self.assertRaisesRegex(InvalidFloorplanError, "ODA File Converter"):
            analyze_floorplan("plan.dwg", b"dwg content", self.settings)

    def test_rejects_unitless_cad_before_extrusion(self) -> None:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 0
        document.layers.new("A-WALL")
        document.modelspace().add_line(
            (0, 0), (500, 0), dxfattribs={"layer": "A-WALL"}
        )
        buffer = io.StringIO()
        document.write(buffer)

        geometry = analyze_floorplan(
            "unitless.dxf", buffer.getvalue().encode("utf-8"), self.settings
        )
        with self.assertRaisesRegex(InvalidFloorplanError, "sin unidades declaradas"):
            extrude_floorplan_to_3d(geometry)

    def test_extrudes_cad_walls_and_explicit_door_without_guessing_raster_openings(self) -> None:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 6
        document.layers.new("A-WALL")
        document.layers.new("A-DOOR")
        modelspace = document.modelspace()
        modelspace.add_line((0, 0), (5, 0), dxfattribs={"layer": "A-WALL"})
        modelspace.add_line((2, 0), (3, 0), dxfattribs={"layer": "A-DOOR"})
        buffer = io.StringIO()
        document.write(buffer)

        geometry = analyze_floorplan(
            "door-plan.dxf", buffer.getvalue().encode("utf-8"), self.settings
        )
        self.assertEqual(geometry["statistics"]["door_candidate_count"], 1)
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")

        lower_wall_faces_in_door = [
            center
            for center in mesh.triangles_center
            if 2.1 < center[0] < 2.9 and 0.1 < center[1] < 2.0
        ]
        lintel_faces_in_door = [
            center
            for center in mesh.triangles_center
            if 2.1 < center[0] < 2.9 and 2.2 < center[1] < 2.5
        ]
        self.assertEqual(lower_wall_faces_in_door, [])
        self.assertTrue(lintel_faces_in_door)
        self.assertAlmostEqual(float(mesh.bounds[1][1]), 2.6, places=5)

    def test_raster_extrusion_keeps_wall_continuous(self) -> None:
        geometry = analyze_floorplan("plan.png", self._png_bytes(), self.settings)
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")

        self.assertAlmostEqual(float(mesh.bounds[1][1]), 2.6, places=5)
        self.assertEqual(geometry["statistics"]["door_candidate_count"], 0)
        self.assertEqual(geometry["statistics"]["window_candidate_count"], 0)

    def test_explicit_window_keeps_sill_and_lintel(self) -> None:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 6
        document.layers.new("A-WALL")
        document.layers.new("A-WINDOW")
        modelspace = document.modelspace()
        modelspace.add_line((0, 0), (5, 0), dxfattribs={"layer": "A-WALL"})
        modelspace.add_line((2, 0), (3, 0), dxfattribs={"layer": "A-WINDOW"})
        buffer = io.StringIO()
        document.write(buffer)

        geometry = analyze_floorplan(
            "window-plan.dxf", buffer.getvalue().encode("utf-8"), self.settings
        )
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")
        centers = mesh.triangles_center

        self.assertFalse(
            any(
                2.1 < center[0] < 2.9 and 1.0 < center[1] < 2.0
                for center in centers
            )
        )
        self.assertTrue(
            any(
                2.1 < center[0] < 2.9 and 0.1 < center[1] < 0.8
                for center in centers
            )
        )
        self.assertTrue(
            any(
                2.1 < center[0] < 2.9 and 2.2 < center[1] < 2.5
                for center in centers
            )
        )

    def test_extracts_cad_arcs_circles_ellipses_and_splines(self) -> None:
        result = analyze_floorplan(
            "curved.dxf", self._curved_dxf_bytes(), self.settings
        )

        self.assertEqual(result["source"]["kind"], "cad")
        self.assertEqual(result["statistics"]["entity_count"], 4)
        self.assertEqual(
            result["statistics"]["wall_candidate_count"], 4
        )
        for entity in result["entities"]:
            self.assertEqual(entity["type"], "polyline")
            self.assertGreaterEqual(len(entity["points"]), 3)
        bounds = result["bounds"]
        self.assertLessEqual(bounds["min"][0], -4.99)
        self.assertGreaterEqual(bounds["max"][0], 34.0)

    def test_detects_diagonal_raster_wall(self) -> None:
        result = analyze_floorplan(
            "diagonal.png", self._diagonal_png_bytes(), self.settings
        )
        segments = [
            (entity["points"][0], entity["points"][1])
            for entity in result["entities"]
            if entity["type"] == "line"
        ]
        diagonal = [
            (start, end)
            for start, end in segments
            if abs(end[0] - start[0]) > 40
            and abs(end[1] - start[1]) > 40
        ]
        self.assertTrue(diagonal)

    def test_detects_bay_window_curve_without_flattening(self) -> None:
        result = analyze_floorplan(
            "bay-window.png",
            self._bay_window_png_bytes(),
            self.settings,
        )
        curves = [
            entity
            for entity in result["entities"]
            if entity["type"] == "polyline"
        ]
        self.assertTrue(curves)
        curve = max(curves, key=lambda entity: len(entity["points"]))
        self.assertGreaterEqual(len(curve["points"]), 3)
        points = curve["points"]
        chord = math.hypot(
            points[-1][0] - points[0][0], points[-1][1] - points[0][1]
        )
        farthest = max(
            math.dist(point, points[0]) for point in points
        )
        # La curva se aparta sensiblemente de su cuerda:
        # no fue aplastada a un bloque recto.
        self.assertGreater(farthest, chord * 0.2)

    def test_detects_circular_wall_as_closed_ring(self) -> None:
        result = analyze_floorplan(
            "circular-wall.png",
            self._circular_wall_png_bytes(),
            self.settings,
        )
        rings = [
            entity
            for entity in result["entities"]
            if entity["type"] == "polyline" and entity["closed"]
        ]
        self.assertTrue(rings)
        ring = rings[0]
        self.assertGreaterEqual(len(ring["points"]), 12)
        first, last = ring["points"][0], ring["points"][-1]
        self.assertLessEqual(math.dist(first, last), 20.0)

    def test_extrudes_closed_polyline_as_single_fused_solid(self) -> None:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 6
        document.layers.new("A-WALL")
        document.modelspace().add_lwpolyline(
            [(0, 0), (5, 0), (5, 4), (0, 4)],
            close=True,
            dxfattribs={"layer": "A-WALL"},
        )
        buffer = io.StringIO()
        document.write(buffer)

        geometry = analyze_floorplan(
            "closed-loop.dxf",
            buffer.getvalue().encode("utf-8"),
            self.settings,
        )
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")

        self.assertTrue(mesh.is_watertight)
        self.assertEqual(len(mesh.split(only_watertight=False)), 1)
        self.assertAlmostEqual(float(mesh.bounds[1][1]), 2.6, places=5)

    def test_extrudes_curved_polyline_as_connected_solid(self) -> None:
        points = [
            [
                3.0 + 2.0 * math.cos(math.pi * index / 32),
                2.0 * math.sin(math.pi * index / 32),
            ]
            for index in range(33)
        ]
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 6
        document.layers.new("A-WALL")
        document.modelspace().add_lwpolyline(
            points, dxfattribs={"layer": "A-WALL"}
        )
        buffer = io.StringIO()
        document.write(buffer)

        geometry = analyze_floorplan(
            "curved-wall.dxf",
            buffer.getvalue().encode("utf-8"),
            self.settings,
        )
        glb = extrude_floorplan_to_3d(geometry)
        mesh = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")

        self.assertTrue(mesh.is_watertight)
        self.assertEqual(len(mesh.split(only_watertight=False)), 1)
        self.assertAlmostEqual(float(mesh.bounds[1][1]), 2.6, places=5)


if __name__ == "__main__":
    unittest.main()
