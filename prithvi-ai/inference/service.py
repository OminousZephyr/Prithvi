from datetime import datetime, timezone
import math

from inference.preprocess import preprocess_image


def analyze_image(image_bytes: bytes, predictor, timestamp: str | None = None) -> dict:
    """Validate/preprocess an upload and produce a conservative API response."""
    timestamp = timestamp or datetime.now(timezone.utc).isoformat()
    prepared = preprocess_image(image_bytes)
    if prepared.status != "acceptable" or prepared.image is None:
        return {
            "status": "unavailable",
            "reason": "Image quality too low",
            "crop": "unknown",
            "condition": "unknown",
            "confidence": None,
            "observation": None,
            "model_version": None,
            "source": "esp32_cam_rgb",
            "image_quality": {"status": "low", "reason": prepared.reason},
            "timestamp": timestamp,
        }

    prediction = predictor.predict(prepared.image)
    quality = {"status": "acceptable", "reason": None}
    # An installed model must explicitly provide a recognized result, a
    # bounded confidence, a version and farmer-readable observation text.
    confidence = prediction.confidence
    actionable = (
        prediction.status in ("healthy_looking", "possible_issue")
        and isinstance(confidence, (int, float))
        and math.isfinite(confidence)
        and 0 <= confidence <= 1
        and isinstance(prediction.model_version, str)
        and bool(prediction.model_version.strip())
        and isinstance(prediction.observation, str)
        and bool(prediction.observation.strip())
    )
    if not actionable:
        reason = prediction.reason or "No trained model installed"
        return {
            "status": "unavailable", "reason": reason, "crop": "unknown",
            "condition": "unknown", "confidence": None, "observation": None,
            "model_version": None, "source": "esp32_cam_rgb",
            "image_quality": quality, "timestamp": timestamp,
        }

    return {
        "status": prediction.status,
        "reason": None,
        "crop": prediction.crop or "unknown",
        "condition": prediction.condition or "unknown",
        "confidence": confidence,
        "observation": prediction.observation,
        "model_version": prediction.model_version,
        "source": "esp32_cam_rgb",
        "image_quality": quality,
        "timestamp": timestamp,
    }
