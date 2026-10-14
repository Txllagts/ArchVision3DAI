import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.services import rmbg_model
from app.services.rmbg_model import (
    RmbgModelError,
    ensure_rmbg_model,
    inspect_rmbg_model,
)
from app.settings import Settings

# Cabecera real de un ONNX exportado con torch.onnx.export: producer_name
# es "pytorch", pero el archivo ES un ONNX valido (regression test).
ONNX_TORCH_HEADER = b"\x08\x06\x12\x07pytorch\x1a\x052.1.0\x3a\xf0\xc5\xff\x53"
ZIP_CHECKPOINT_HEADER = b"PK\x03\x04\x14\x00\x00\x00"
PICKLE_CHECKPOINT_HEADER = b"\x80\x02}q\x00X\x08\x00\x00\x00pytorch"
LFS_POINTER_HEADER = b"version https://git-lfs.github.com/spec/v1\noid sha256:abc"


def _write(path: Path, header: bytes, size: int) -> Path:
    path.write_bytes(header + b"\x00" * max(0, size - len(header)))
    return path


class _TmpDirTestCase(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

        # Los tests usan archivos pequenos: se rebaja el umbral de tamano.
        original_min = rmbg_model.MIN_MODEL_BYTES
        rmbg_model.MIN_MODEL_BYTES = 64
        self.addCleanup(
            setattr, rmbg_model, "MIN_MODEL_BYTES", original_min
        )

    def _settings(self, **overrides) -> Settings:
        values = {
            "rembg_model_path": self.dir / "rmbg-1.4.onnx",
            "rembg_auto_download": False,
        }
        values.update(overrides)
        return Settings(**values)


class InspectRmbgModelTests(_TmpDirTestCase):
    def test_reports_missing_file(self) -> None:
        self.assertEqual(
            inspect_rmbg_model(self.dir / "no-existe.onnx"), "missing"
        )

    def test_rejects_file_smaller_than_the_model(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", ONNX_TORCH_HEADER, 32)
        self.assertTrue(inspect_rmbg_model(path).startswith("too-small"))

    def test_rejects_html_error_page(self) -> None:
        path = _write(
            self.dir / "rmbg-1.4.onnx", b"<!DOCTYPE html><html>", 128
        )
        self.assertEqual(inspect_rmbg_model(path), "html-error-page")

    def test_rejects_git_lfs_pointer(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", LFS_POINTER_HEADER, 128)
        self.assertEqual(inspect_rmbg_model(path), "git-lfs-pointer")

    def test_rejects_torch_save_zip_checkpoint(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", ZIP_CHECKPOINT_HEADER, 256)
        self.assertIn("pytorch-zip-checkpoint", inspect_rmbg_model(path))

    def test_rejects_legacy_pickle_checkpoint(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", PICKLE_CHECKPOINT_HEADER, 256)
        self.assertIn("pickle-checkpoint", inspect_rmbg_model(path))

    def test_accepts_onnx_exported_by_pytorch(self) -> None:
        # producer_name="pytorch" NO marca un checkpoint: es la cabecera
        # normal de un ONNX exportado con torch.onnx.export.
        path = _write(self.dir / "rmbg-1.4.onnx", ONNX_TORCH_HEADER, 256)
        self.assertEqual(inspect_rmbg_model(path), "valid")


class EnsureRmbgModelTests(_TmpDirTestCase):
    def test_returns_valid_file_untouched(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", ONNX_TORCH_HEADER, 256)

        resolved = ensure_rmbg_model(self._settings())

        self.assertEqual(resolved, path)
        self.assertEqual(inspect_rmbg_model(path), "valid")
        self.assertFalse(
            (self.dir / "rmbg-1.4.onnx.invalid-checkpoint").exists()
        )

    def test_raises_without_download_when_disabled(self) -> None:
        path = _write(self.dir / "rmbg-1.4.onnx", ZIP_CHECKPOINT_HEADER, 256)

        with self.assertRaisesRegex(RmbgModelError, "REMBG_AUTO_DOWNLOAD"):
            ensure_rmbg_model(self._settings(rembg_auto_download=False))

        # Sin descarga no se toca el archivo original.
        self.assertIn("pytorch-zip", inspect_rmbg_model(path))

    def test_quarantines_invalid_file_and_installs_download(self) -> None:
        bad = _write(self.dir / "rmbg-1.4.onnx", ZIP_CHECKPOINT_HEADER, 256)
        bad_bytes = bad.read_bytes()
        good = _write(self.dir / "descarga.onnx", ONNX_TORCH_HEADER, 256)

        def fake_download(settings, target):
            os.replace(good, target)
            return target

        with mock.patch.object(
            rmbg_model, "_download_official_model", side_effect=fake_download
        ) as download:
            resolved = ensure_rmbg_model(
                self._settings(rembg_auto_download=True)
            )

        download.assert_called_once()
        self.assertEqual(resolved, self.dir / "rmbg-1.4.onnx")
        self.assertEqual(inspect_rmbg_model(resolved), "valid")
        quarantine = self.dir / "rmbg-1.4.onnx.invalid-checkpoint"
        self.assertEqual(quarantine.read_bytes(), bad_bytes)

    def test_force_reinstalls_even_a_file_that_looks_valid(self) -> None:
        # Caso real: ONNX con cabecera correcta pero corrupto a mitad de
        # stream (re-encoded como UTF-8); solo el reintento lo repara.
        _write(self.dir / "rmbg-1.4.onnx", ONNX_TORCH_HEADER, 256)
        good = _write(self.dir / "descarga.onnx", ONNX_TORCH_HEADER, 512)

        def fake_download(settings, target):
            os.replace(good, target)
            return target

        with mock.patch.object(
            rmbg_model, "_download_official_model", side_effect=fake_download
        ) as download:
            resolved = ensure_rmbg_model(
                self._settings(rembg_auto_download=True), force=True
            )

        download.assert_called_once()
        self.assertEqual(resolved.stat().st_size, 512)
        self.assertTrue(
            (self.dir / "rmbg-1.4.onnx.invalid-checkpoint").exists()
        )

    def test_force_requires_auto_download(self) -> None:
        with self.assertRaisesRegex(RmbgModelError, "REMBG_AUTO_DOWNLOAD"):
            ensure_rmbg_model(
                self._settings(rembg_auto_download=False), force=True
            )

    def test_quarantine_replaces_stale_checkpoint_copy(self) -> None:
        quarantine = self.dir / "rmbg-1.4.onnx.invalid-checkpoint"
        quarantine.write_bytes(b"intento-anterior")
        bad = _write(self.dir / "rmbg-1.4.onnx", ZIP_CHECKPOINT_HEADER, 256)
        bad_bytes = bad.read_bytes()
        good = _write(self.dir / "descarga.onnx", ONNX_TORCH_HEADER, 256)

        def fake_download(settings, target):
            os.replace(good, target)
            return target

        with mock.patch.object(
            rmbg_model, "_download_official_model", side_effect=fake_download
        ):
            ensure_rmbg_model(self._settings(rembg_auto_download=True))

        self.assertEqual(quarantine.read_bytes(), bad_bytes)

    def test_download_failure_raises_clear_error(self) -> None:
        _write(self.dir / "rmbg-1.4.onnx", ZIP_CHECKPOINT_HEADER, 256)

        with mock.patch.object(
            rmbg_model,
            "_download_official_model",
            side_effect=RuntimeError("sin red"),
        ):
            with self.assertRaisesRegex(RmbgModelError, "briaai/RMBG-1.4"):
                ensure_rmbg_model(self._settings(rembg_auto_download=True))

    def test_reports_missing_file_without_download(self) -> None:
        with self.assertRaisesRegex(RmbgModelError, "missing"):
            ensure_rmbg_model(self._settings(rembg_auto_download=False))


class DownloadOfficialModelTests(_TmpDirTestCase):
    def test_installs_valid_download_atomically(self) -> None:
        target = self.dir / "rmbg-1.4.onnx"
        settings = self._settings()

        def fake_hub_download(**kwargs):
            staging = Path(kwargs["local_dir"])
            return str(_write(staging / "model.onnx", ONNX_TORCH_HEADER, 256))

        with mock.patch("huggingface_hub.hf_hub_download", fake_hub_download):
            resolved = rmbg_model._download_official_model(settings, target)

        self.assertEqual(resolved, target)
        self.assertEqual(inspect_rmbg_model(target), "valid")
        self.assertFalse((self.dir / ".rmbg-download").exists())

    def test_rejects_download_that_is_not_a_valid_onnx(self) -> None:
        target = self.dir / "rmbg-1.4.onnx"
        settings = self._settings()

        def fake_hub_download(**kwargs):
            staging = Path(kwargs["local_dir"])
            return str(_write(staging / "model.onnx", ZIP_CHECKPOINT_HEADER, 256))

        with mock.patch("huggingface_hub.hf_hub_download", fake_hub_download):
            with self.assertRaisesRegex(RmbgModelError, "no es un ONNX valido"):
                rmbg_model._download_official_model(settings, target)

        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
