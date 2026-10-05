import io
import subprocess
import tempfile
from pathlib import Path

import ezdxf
import fitz
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from PIL import Image

from app.settings import Settings


class UnsupportedInputError(ValueError):
    pass


def _render_dxf(path: Path) -> Image.Image:
    document = ezdxf.readfile(path)
    layout = document.modelspace()
    backend = MatplotlibBackend()
    Frontend(RenderContext(document), backend).draw_layout(layout, finalize=True)
    image_bytes = io.BytesIO()
    backend.get_figure().savefig(image_bytes, format="png", bbox_inches="tight", dpi=160)
    return Image.open(image_bytes).convert("RGB")


def convert_dwg_to_dxf(path: Path, converter: str) -> Path:
    output_dir = path.parent / "converted"
    output_dir.mkdir()
    subprocess.run(
        [converter, str(path.parent), str(output_dir), "ACAD2018", "DXF", "0", "1"],
        check=True,
        timeout=90,
        capture_output=True,
        text=True,
    )
    converted = output_dir / f"{path.stem}.dxf"
    if not converted.is_file():
        raise UnsupportedInputError("ODA File Converter no produjo un DXF válido.")
    return converted


def prepare_image(filename: str, data: bytes, settings: Settings) -> Image.Image:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".dwg", ".dxf"}:
        raise UnsupportedInputError("Formato no admitido.")

    with tempfile.TemporaryDirectory(prefix="archvision-input-") as directory:
        source = Path(directory) / f"upload{suffix}"
        source.write_bytes(data)
        if suffix == ".pdf":
            with fitz.open(source) as pdf:
                if not pdf.page_count:
                    raise UnsupportedInputError("El PDF no contiene páginas.")
                pixmap = pdf[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
        elif suffix in {".jpg", ".jpeg", ".png", ".webp"}:
            with Image.open(source) as image_file:
                image_file.verify()
            with Image.open(source) as image_file:
                image = image_file.convert("RGB")
        elif suffix == ".dxf":
            image = _render_dxf(source)
        else:
            if not settings.oda_file_converter:
                raise UnsupportedInputError(
                    "DWG requiere ODA File Converter configurado en ODA_FILE_CONVERTER."
                )
            image = _render_dxf(convert_dwg_to_dxf(source, settings.oda_file_converter))

    image.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
    return image