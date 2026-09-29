from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from inference.predictor import load_predictor
from inference.service import analyze_image

app = FastAPI(title="PRITHVI Local Crop Health Service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
predictor = load_predictor(Path(__file__).parent / "model" / "crop-health.onnx")
MAX_IMAGE_BYTES = 10 * 1024 * 1024


@app.get("/health")
def health():
    model_available = bool(getattr(predictor, "available", False))
    return {
        "status": "ok",
        "model_available": model_available,
        "reason": None if model_available else "No trained model installed",
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), metadata: str | None = Form(default=None)):
    del metadata  # Reserved for field/location context in a future real model pipeline.
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP image.")
    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 10 MB limit.")
    return analyze_image(image_bytes, predictor)
