from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class Prediction:
    status: str
    reason: str | None = None
    crop: str = "unknown"
    condition: str = "unknown"
    confidence: float | None = None
    observation: str | None = None
    model_version: str | None = None


class CropHealthPredictor(Protocol):
    available: bool

    def predict(self, image) -> Prediction: ...


class UnavailablePredictor:
    available = False

    def predict(self, image) -> Prediction:
        return Prediction(status="unavailable", reason="No trained model installed")


def load_predictor(model_path: Path | None = None) -> CropHealthPredictor:
    """Model-loading seam for a future validated ONNX/PyTorch implementation."""
    if model_path is None or not model_path.is_file():
        return UnavailablePredictor()
    # Deliberately abstain until a real, versioned model adapter is implemented.
    # A file's presence alone is not sufficient evidence that it is usable.
    return UnavailablePredictor()
