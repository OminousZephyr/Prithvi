# PRITHVI local crop-health service

This is a local FastAPI service for the Expo crop-health scan flow. It accepts JPEG/PNG/WebP uploads, validates and decodes the image, applies a conservative minimum-size image-quality gate, and passes acceptable images to the predictor interface. **No trained model is installed**, so the current service correctly returns `status: unavailable` and `reason: No trained model installed`; it never generates a prediction, confidence, or diagnosis. Low-quality/unreadable images also abstain and include an image-quality reason.

## Windows setup

From PowerShell at the repository root:

```powershell
cd .\prithvi-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

If Windows Firewall asks, allow Python on **Private networks**. The service is intended for the local Wi-Fi/hotspot only; do not expose it to the public Internet. It requires no API keys, cloud service, or internet after dependencies have been installed.

In another PowerShell window, find the laptop IPv4 address for the Wi-Fi adapter on the same network as the ESP32-CAM and phone:

```powershell
ipconfig
```

Use the laptop's address when configuring PRITHVI. Port `8000` is the documented default and can be changed when starting Uvicorn.

## Manual endpoint checks

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/health' | ConvertTo-Json
```

Expected health response has `status: ok`, `model_available: false`, and reason `No trained model installed`.

Camera checks (set the current IP read from the camera Serial Monitor):

```powershell
$CameraBaseUrl = 'http://<ESP32-CAM-IP>'
Invoke-RestMethod "$CameraBaseUrl/camera-status" | ConvertTo-Json -Depth 5
$capture = Invoke-WebRequest "$CameraBaseUrl/capture" -OutFile .\capture.jpg -PassThru
$capture.Headers['Content-Type']
```

Post that real JPEG to the local service (replace the laptop IP with the Wi-Fi adapter address):

```powershell
$AiBaseUrl = 'http://<LAPTOP-IP>:8000'
curl.exe -F 'file=@capture.jpg;type=image/jpeg' "$AiBaseUrl/analyze"
```

With the current no-model installation, `/analyze` reports unavailable with null confidence. That result is not stored as a crop-health observation in PRITHVI. A decoded/size-accepted image only means it passed input validation, not that it is diagnostically suitable.

## Predictor interface

`inference/predictor.py` defines the future model adapter seam and `inference/preprocess.py` decodes, normalizes, and bounds image size; neither preprocessing nor image heuristics classify crop health. A future reviewed model adapter must return a recognized status, bounded confidence, model version, and observation before the service returns a prediction. The app stores an observation only for a valid real prediction. A model file's mere presence is not treated as proof of a usable model.

Run Python tests from this directory:

```powershell
python -m unittest discover -s tests -v
```

For Arduino setup, camera endpoints, Expo settings, and an end-to-end procedure, see [`../docs/prithvi-cam-ai-e2e.md`](../docs/prithvi-cam-ai-e2e.md).
