from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError


@dataclass
class PreprocessResult:
    status: str
    reason: str | None
    image: Image.Image | None


def preprocess_image(image_bytes: bytes, minimum_dimension: int = 96) -> PreprocessResult:
    """Decode and normalize a real image; only reject unreadable/tiny inputs.

    This is an input-quality gate, not a crop-health classifier. No visual
    quality or plant condition is inferred by this preprocessing function.
    """
    if not image_bytes:
        return PreprocessResult("low", "Image is empty.", None)
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            source.load()
            if source.width < minimum_dimension or source.height < minimum_dimension:
                return PreprocessResult("low", f"Image must be at least {minimum_dimension} × {minimum_dimension} pixels.", None)
            normalized = source.convert("RGB")
            normalized.thumbnail((512, 512))
            return PreprocessResult("acceptable", None, normalized.copy())
    except (UnidentifiedImageError, OSError, ValueError):
        return PreprocessResult("low", "Image could not be decoded.", None)
