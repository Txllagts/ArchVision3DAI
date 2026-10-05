import base64
import json
import logging
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from app.services.supabase_storage import SupabaseModelStorage
from app.settings import Settings


def _jwt_with_role(role: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"role": role}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"header.{payload}.signature"


class SupabaseStorageConfigurationTests(unittest.TestCase):
    def test_settings_load_supabase_variables_from_local_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "SUPABASE_URL=https://storage.example.supabase.co\n"
                f"SUPABASE_SERVICE_ROLE_KEY={_jwt_with_role('service_role')}\n",
                encoding="utf-8",
            )

            settings = Settings(_env_file=env_path)

        self.assertEqual(settings.supabase_url, "https://storage.example.supabase.co")
        self.assertEqual(
            SupabaseModelStorage._jwt_role(settings.supabase_service_role_key),
            "service_role",
        )

    def test_client_is_initialized_with_service_role_key(self) -> None:
        service_role_key = _jwt_with_role("service_role")
        settings = Settings(
            _env_file=None,
            supabase_url="https://storage.example.supabase.co",
            supabase_service_role_key=service_role_key,
        )

        with (
            patch("app.services.supabase_storage.create_client") as create_client,
            patch.object(SupabaseModelStorage, "_ensure_private_bucket"),
        ):
            SupabaseModelStorage(settings)

        args, kwargs = create_client.call_args
        self.assertEqual(args, ("https://storage.example.supabase.co", service_role_key))
        self.assertEqual(kwargs["options"].storage_client_timeout, 20)

    def test_rejects_anon_key_before_client_initialization(self) -> None:
        settings = Settings(
            _env_file=None,
            supabase_url="https://storage.example.supabase.co",
            supabase_service_role_key=_jwt_with_role("anon"),
        )

        with patch("app.services.supabase_storage.create_client") as create_client:
            with self.assertRaisesRegex(RuntimeError, "role=service_role"):
                SupabaseModelStorage(settings)

        create_client.assert_not_called()

    def test_rejects_non_https_supabase_url(self) -> None:
        settings = Settings(
            _env_file=None,
            supabase_url="http://storage.example.supabase.co",
            supabase_service_role_key=_jwt_with_role("service_role"),
        )

        with patch("app.services.supabase_storage.create_client") as create_client:
            with self.assertRaisesRegex(RuntimeError, "HTTPS"):
                SupabaseModelStorage(settings)

        create_client.assert_not_called()

    def test_reports_client_initialization_error_without_exposing_key(self) -> None:
        service_role_key = _jwt_with_role("service_role")
        settings = Settings(
            _env_file=None,
            supabase_url="https://storage.example.supabase.co",
            supabase_service_role_key=service_role_key,
        )

        with (
            patch(
                "app.services.supabase_storage.create_client",
                side_effect=RuntimeError(service_role_key),
            ),
            patch.object(SupabaseModelStorage, "_ensure_private_bucket"),
            self.assertRaisesRegex(RuntimeError, "No se pudo inicializar") as raised,
        ):
            SupabaseModelStorage(settings)
        self.assertNotIn(service_role_key, str(raised.exception))


class SupabaseStorageUploadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = object.__new__(SupabaseModelStorage)
        self.storage._bucket = "models-3d"
        self.storage._ttl = 3600
        self.storage._client = MagicMock()
        self.storage._client.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.example/signed"
        }

    def test_upload_methods_use_expected_bucket_path_and_content_type(self) -> None:
        cases = (
            (self.storage.upload_glb, "generated/", "model/gltf-binary"),
            (self.storage.upload_floorplan_glb, "floorplans/", "model/gltf-binary"),
            (self.storage.upload_floorplan_json, "floorplans/", "application/json"),
        )

        for upload_method, expected_prefix, expected_content_type in cases:
            with self.subTest(content_type=expected_content_type):
                self.storage._client.reset_mock()
                result = upload_method(b"asset-bytes")

                self.assertEqual(
                    self.storage._client.storage.from_.call_args_list,
                    [call("models-3d")] * 2,
                )
                bucket = self.storage._client.storage.from_.return_value
                bucket.upload.assert_called_once()
                path, contents = bucket.upload.call_args.args
                self.assertTrue(path.startswith(expected_prefix))
                self.assertEqual(contents, b"asset-bytes")
                self.assertEqual(
                    bucket.upload.call_args.kwargs,
                    {"file_options": {"content-type": expected_content_type}},
                )
                bucket.create_signed_url.assert_called_once_with(path, 3600)
                self.assertEqual(result.path, path)
                self.assertEqual(result.signed_url, "https://storage.example/signed")

    def test_upload_logs_full_storage_error_details_and_reraises(self) -> None:
        class StorageFailure(Exception):
            status = 403
            code = "AccessDenied"

        failure = StorageFailure("bucket policy rejected upload")
        bucket = self.storage._client.storage.from_.return_value
        bucket.upload.side_effect = failure

        with self.assertLogs("archvision.ai.storage", level=logging.ERROR) as captured:
            with self.assertRaises(StorageFailure) as raised:
                self.storage.upload_glb(b"asset-bytes")

        self.assertIs(raised.exception, failure)
        log_output = "\n".join(captured.output)
        self.assertIn("http_status=403", log_output)
        self.assertIn("error_code=AccessDenied", log_output)
        self.assertIn("bucket policy rejected upload", log_output)
        self.assertIn("Traceback (most recent call last)", log_output)
        self.assertNotIn("service_role", log_output)


if __name__ == "__main__":
    unittest.main()
