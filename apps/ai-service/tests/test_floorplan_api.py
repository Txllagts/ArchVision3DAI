import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import ezdxf
import httpx
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.main import app, generate_model, require_api_key
from app.services.supabase_storage import StoredModel
from app.settings import Settings


class FakeStorage:
    def __init__(self) -> None:
        self.contents: bytes | None = None
        self.model_contents: bytes | None = None

    def upload_floorplan_glb(self, contents: bytes) -> StoredModel:
        self.model_contents = contents
        return StoredModel(
            path="floorplans/test-model.glb",
            signed_url="https://storage.example/signed-model",
        )

    def upload_floorplan_json(self, contents: bytes) -> StoredModel:
        self.contents = contents
        return StoredModel(
            path="floorplans/test-result.json",
            signed_url="https://storage.example/signed-result",
        )


class FloorplanEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.storage = FakeStorage()
        app.state.storage = self.storage
        app.state.storage_startup_failed = False
        app.dependency_overrides[require_api_key] = lambda: None

    async def asyncTearDown(self) -> None:
        app.dependency_overrides.clear()
        app.state.storage = None
        app.state.storage_startup_failed = False

    @staticmethod
    def _dxf_bytes() -> bytes:
        document = ezdxf.new("R2010")
        document.header["$INSUNITS"] = 4
        document.layers.new("A-WALL")
        document.modelspace().add_line(
            (0, 0), (1000, 0), dxfattribs={"layer": "A-WALL"}
        )
        buffer = io.StringIO()
        document.write(buffer)
        return buffer.getvalue().encode("utf-8")

    async def test_endpoint_returns_and_stores_structured_geometry(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/floorplan/analyze",
                files={
                    "file": (
                        "plan.dxf",
                        self._dxf_bytes(),
                        "application/dxf",
                    )
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["statistics"]["entity_count"], 1)
        self.assertEqual(payload["storage_path"], "floorplans/test-result.json")
        self.assertEqual(payload["model_storage_path"], "floorplans/test-model.glb")
        self.assertEqual(payload["model_url"], "https://storage.example/signed-model")
        self.assertIsNotNone(self.storage.contents)
        self.assertIsNotNone(self.storage.model_contents)
        stored = json.loads(self.storage.contents or b"{}")
        self.assertEqual(stored["entities"][0]["points"], [[0.0, 0.0], [1000.0, 0.0]])

    async def test_endpoint_returns_422_for_corrupt_dxf(self) -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/floorplan/analyze",
                files={"file": ("broken.dxf", b"not a dxf", "application/dxf")},
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("DXF válido", response.json()["detail"])

    async def test_endpoint_returns_502_when_storage_initialization_failed(self) -> None:
        app.state.storage = None
        app.state.storage_startup_failed = True

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/floorplan/analyze",
                files={
                    "file": (
                        "plan.dxf",
                        self._dxf_bytes(),
                        "application/dxf",
                    )
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertIn("service-role", response.json()["detail"])

    async def test_endpoint_reports_glb_storage_failure(self) -> None:
        with patch.object(
            self.storage,
            "upload_floorplan_glb",
            side_effect=RuntimeError("storage network error"),
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/v1/floorplan/analyze",
                    files={
                        "file": (
                            "plan.dxf",
                            self._dxf_bytes(),
                            "application/dxf",
                        )
                    },
                )

        self.assertEqual(response.status_code, 502)
        self.assertIn("modelo GLB", response.json()["detail"])

    async def test_endpoint_reports_geometry_json_storage_failure(self) -> None:
        with patch.object(
            self.storage,
            "upload_floorplan_json",
            side_effect=RuntimeError("storage credentials error"),
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/v1/floorplan/analyze",
                    files={
                        "file": (
                            "plan.dxf",
                            self._dxf_bytes(),
                            "application/dxf",
                        )
                    },
                )

        self.assertEqual(response.status_code, 502)
        self.assertIn("geometría JSON", response.json()["detail"])

    async def test_floorplan_storage_remains_available_when_triposr_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            rembg_path = Path(directory) / "rembg.onnx"
            rembg_path.touch()
            settings = Settings(_env_file=None, rembg_model_path=rembg_path)
            storage = FakeStorage()
            with (
                patch("app.main.get_settings", return_value=settings),
                patch("app.main.SupabaseModelStorage", return_value=storage),
                patch(
                    "app.main.TriposrPipeline",
                    side_effect=RuntimeError("CUDA unavailable"),
                ),
                patch("app.main._new_rembg_session", return_value=object()),
            ):
                async with app.router.lifespan_context(app):
                    self.assertIs(app.state.storage, storage)
                    self.assertIsNone(app.state.pipeline)
                    self.assertIn("CUDA unavailable", app.state.startup_error)


class ImageTo3DEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        app.state.startup_error = None
        app.state.pipeline = MagicMock()
        app.state.rembg_session = object()

    async def asyncTearDown(self) -> None:
        app.state.pipeline = None
        app.state.storage = None
        app.state.rembg_session = None
        app.state.instantmesh_pipeline = None
        app.state.instantmesh_unavailable_reason = None
        app.state.startup_error = None

    def _settings(self) -> Settings:
        return Settings(_env_file=None, max_upload_bytes=1024)

    async def test_capabilities_report_instantmesh_state(self) -> None:
        from app.main import service_capabilities

        app.state.instantmesh_pipeline = None
        self.assertEqual(
            await service_capabilities(),
            {"instantmesh_available": False},
        )

        app.state.instantmesh_pipeline = MagicMock()
        self.assertEqual(
            await service_capabilities(),
            {"instantmesh_available": True},
        )
        app.state.instantmesh_pipeline = None

    async def test_successful_generation_returns_stored_path(self) -> None:
        storage = MagicMock()
        storage.upload_glb.return_value = StoredModel(
            path="generated/model.glb",
            signed_url="https://storage.example/signed-model",
        )
        app.state.storage = storage

        def generate(_image: Image.Image, output_path: Path) -> None:
            output_path.write_bytes(b"glb-data")

        app.state.pipeline.generate.side_effect = generate
        with (
            patch("app.main.get_settings", return_value=self._settings()),
            patch("app.main.prepare_image", return_value=Image.new("RGB", (2, 2))),
            patch("rembg.remove", return_value=Image.new("RGB", (2, 2))),
            patch("app.main.canonicalize_glb"),
            patch("app.main.complete_mesh"),
            patch("app.main.validate_generated_glb"),
        ):
            response = await generate_model(
                UploadFile(filename="object.png", file=io.BytesIO(b"image-data"))
            )

        self.assertEqual(response["storage_path"], "generated/model.glb")
        self.assertEqual(response["model_url"], "https://storage.example/signed-model")

    async def test_storage_failure_returns_502(self) -> None:
        class StorageFailure(RuntimeError):
            status = 403
            code = "AccessDenied"

        storage = MagicMock()
        storage.upload_glb.side_effect = StorageFailure("storage network error")
        app.state.storage = storage

        def generate(_image: Image.Image, output_path: Path) -> None:
            output_path.write_bytes(b"glb-data")

        app.state.pipeline.generate.side_effect = generate
        with (
            patch("app.main.get_settings", return_value=self._settings()),
            patch("app.main.prepare_image", return_value=Image.new("RGB", (2, 2))),
            patch("rembg.remove", return_value=Image.new("RGB", (2, 2))),
            patch("app.main.canonicalize_glb"),
            patch("app.main.complete_mesh"),
            patch("app.main.validate_generated_glb"),
        ):
            with self.assertRaises(HTTPException) as raised:
                await generate_model(
                    UploadFile(filename="object.png", file=io.BytesIO(b"image-data"))
                )

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(
            raised.exception.detail["reason"],
            "storage network error",
        )
        self.assertEqual(raised.exception.detail["upstream_status"], 403)
        self.assertEqual(raised.exception.detail["upstream_code"], "AccessDenied")

    async def test_canonicalization_runs_before_upload(self) -> None:
        storage = MagicMock()
        uploaded_contents: list[bytes] = []

        def upload(contents: bytes) -> StoredModel:
            uploaded_contents.append(contents)
            return StoredModel("generated/model.glb", "https://storage.example/model")

        storage.upload_glb.side_effect = upload
        app.state.storage = storage

        def generate(_image: Image.Image, output_path: Path) -> None:
            output_path.write_bytes(b"generated")

        def canonicalize(output_path: Path) -> None:
            output_path.write_bytes(b"canonicalized")

        app.state.pipeline.generate.side_effect = generate
        with (
            patch("app.main.get_settings", return_value=self._settings()),
            patch("app.main.prepare_image", return_value=Image.new("RGB", (2, 2))),
            patch("rembg.remove", return_value=Image.new("RGB", (2, 2))),
            patch("app.main.canonicalize_glb", side_effect=canonicalize) as canonicalizer,
            patch("app.main.complete_mesh"),
            patch("app.main.validate_generated_glb"),
        ):
            await generate_model(
                UploadFile(filename="object.png", file=io.BytesIO(b"image-data"))
            )

        canonicalizer.assert_called_once()
        self.assertEqual(uploaded_contents, [b"canonicalized"])

    async def test_mesh_completion_runs_after_canonicalization_and_before_upload(self) -> None:
        storage = MagicMock()
        uploaded_contents: list[bytes] = []

        def upload(contents: bytes) -> StoredModel:
            uploaded_contents.append(contents)
            return StoredModel("generated/model.glb", "https://storage.example/model")

        storage.upload_glb.side_effect = upload
        app.state.storage = storage

        def generate(_image: Image.Image, output_path: Path) -> None:
            output_path.write_bytes(b"generated")

        def canonicalize(output_path: Path) -> None:
            output_path.write_bytes(b"canonicalized")

        def complete(output_path: Path) -> None:
            output_path.write_bytes(b"completed")

        app.state.pipeline.generate.side_effect = generate
        with (
            patch("app.main.get_settings", return_value=self._settings()),
            patch("app.main.prepare_image", return_value=Image.new("RGB", (2, 2))),
            patch("rembg.remove", return_value=Image.new("RGB", (2, 2))),
            patch("app.main.canonicalize_glb", side_effect=canonicalize) as canonicalizer,
            patch("app.main.complete_mesh", side_effect=complete) as completer,
            patch("app.main.validate_generated_glb"),
        ):
            await generate_model(
                UploadFile(filename="object.png", file=io.BytesIO(b"image-data"))
            )

        canonicalizer.assert_called_once()
        completer.assert_called_once()
        self.assertEqual(uploaded_contents, [b"completed"])

    async def test_hq_uses_instantmesh_and_suspends_triposr(self) -> None:
        from app.main import generate_hq_model

        storage = MagicMock()
        storage.upload_glb.return_value = StoredModel(
            "generated/model.glb",
            "https://storage.example/signed-model",
        )
        app.state.storage = storage
        app.state.instantmesh_pipeline = MagicMock()
        app.state.pipeline.release_cuda_memory = MagicMock()
        app.state.pipeline.restore_cuda_memory = MagicMock()
        app.state.instantmesh_pipeline.generate.side_effect = (
            lambda _image, path: path.write_bytes(b"instantmesh-glb")
        )
        with (
            patch("app.main.get_settings", return_value=self._settings()),
            patch("app.main.prepare_image", return_value=Image.new("RGB", (2, 2))),
            patch("app.main.canonicalize_glb"),
            patch("app.main.complete_mesh"),
            patch("app.main.validate_generated_glb"),
            patch("app.main._new_rembg_session", return_value=object()),
        ):
            result = await generate_hq_model(
                UploadFile(filename="object.png", file=io.BytesIO(b"image-data"))
            )

        self.assertEqual(result["engine"], "instantmesh")
        app.state.pipeline.release_cuda_memory.assert_called_once()
        app.state.pipeline.restore_cuda_memory.assert_called_once()
        app.state.instantmesh_pipeline.generate.assert_called_once()
        storage.upload_glb.assert_called_once_with(b"instantmesh-glb")
        app.state.instantmesh_pipeline = None


if __name__ == "__main__":
    unittest.main()
