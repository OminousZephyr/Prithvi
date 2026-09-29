# PRITHVI ESP32-CAM → FastAPI → Expo test guide

## Data flow and current limits

**AI Thinker ESP32-CAM (GC2145, PID 0x2145; RGB565 240 × 240)** → existing CameraWebServer `/capture` → software RGB565-to-JPEG conversion → local FastAPI `/analyze` → real model adapter when one is installed → structured result → Expo crop-health scan. Today there is no trained model, so FastAPI correctly returns `unavailable` / `No trained model installed`. Expo shows the image and unavailable result but does not save it as a crop-health observation. The pipeline does not use cloud AI or produce fake predictions.

Phone, ESP32-CAM and Windows laptop must be connected to the same Wi-Fi network or phone hotspot. Internet is not needed for communication once Python requirements and the app are installed. The camera and laptop addresses can change when reconnecting; neither is hardcoded in the app.

## Arduino IDE upload

1. Install Arduino IDE and the Espressif ESP32 board package. Open `firmware/esp32-cam/CameraWebServer/CameraWebServer.ino` and make sure the adjacent `app_httpd.cpp`, `camera_index.h`, and `board_config.h` are included by the same sketch build.
2. Put the Wi-Fi network name/password in the sketch's `ssid` and `password` variables. For a phone hotspot, configure the hotspot first and use those credentials.
3. Tools → Board → **AI Thinker ESP32-CAM**. Select the USB-to-UART COM port; set Upload Speed **115200**, Flash Frequency **40 MHz**, and Partition Scheme **Huge APP (3 MB No OTA / 1 MB SPIFFS)** where those menu entries are available. Enable PSRAM if offered. Menu labels vary by ESP32 board package release. Keep `CAMERA_MODEL_AI_THINKER`, 20 MHz XCLK, RGB565, 240 × 240, and latest-frame grab mode in the source.
4. Connect USB-to-UART TX → U0R, RX → U0T, and GND → GND. Power the board from a stable 5 V supply. Connect GPIO0 to GND, reset/power-cycle, then click Upload. If upload stalls, use the adapter's reset/boot buttons and retry.
5. When upload finishes, disconnect GPIO0 from GND and reset the board. Open Serial Monitor at **115200 baud**. Confirm `CAMERA INITIALIZED SUCCESSFULLY`, sensor PID `0x2145`, and Wi-Fi connection. Copy the current IP printed after `Camera Ready! Use 'http://…'`.

## Start FastAPI on Windows

In PowerShell from the repository root:

```powershell
cd .\prithvi-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

If Windows Firewall prompts, allow Python on Private networks. Find the laptop's local address for the connected Wi-Fi/hotspot adapter in a second PowerShell window:

```powershell
ipconfig
```

Use that adapter's IPv4 address; do not select an unrelated VPN or disconnected adapter. Check FastAPI on the laptop:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/health' | ConvertTo-Json
```

Expected current health: `status` is `ok`, `model_available` is `false`, reason is `No trained model installed`.

## Test ESP32 endpoints and send an image to FastAPI

Set variables to the current addresses from Serial Monitor and `ipconfig`:

```powershell
$CameraBaseUrl = 'http://<ESP32-CAM-IP>'
$AiBaseUrl = 'http://<LAPTOP-IP>:8000'
Invoke-RestMethod "$CameraBaseUrl/camera-status" | ConvertTo-Json -Depth 5
$response = Invoke-WebRequest "$CameraBaseUrl/capture" -OutFile .\capture.jpg -PassThru
$response.Headers['Content-Type']
Get-Item .\capture.jpg | Select-Object Name, Length
curl.exe -F 'file=@capture.jpg;type=image/jpeg' "$AiBaseUrl/analyze"
```

The camera status should derive and report the active sensor/PID, pixel format, width/height and Wi-Fi/IP. The capture response should be `image/jpeg`, and the file should be non-empty. Current valid image analyze result should be `unavailable` with null confidence and reason `No trained model installed`. An unreadable or too-small image returns unavailable with low image quality.

The optional one-command utility performs these checks with configurable parameters (no IPs are embedded):

```powershell
& .\firmware\esp32-cam\test-capture.ps1 -CameraBaseUrl $CameraBaseUrl -AiBaseUrl $AiBaseUrl -OutputPath .\capture.jpg
```

## Configure and test the Expo app

1. Start PRITHVI as usual with `npm run start` (or `npm run web` for the web preview). For an Android phone use the Expo Go QR flow; the camera and FastAPI URLs must be reachable from the phone on the same Wi-Fi/hotspot.
2. Open **More → Settings**. Set **ESP32-CAM** to `http://<ESP32-CAM-IP>` and **Local AI service** to `http://<LAPTOP-IP>:8000`; save both. These values are stored locally. Recheck them after the hotspot assigns new addresses.
3. Open **Monitor → Crop Health Scan**. Check camera connection, press **Capture & Analyze**, and verify the real image preview and image-quality status. With no trained model installed, expect “No trained model installed” / unavailable, no confidence, and no saved crop-health observation. A real model-backed result must still be treated as an observation requiring field verification.

## Manual validation scope

Use the Windows `/camera-status`, `/capture`, and `/analyze` checks to validate network endpoints. `npm run typecheck`, `npm run lint`, Node tests, Python unit tests, and Python syntax checks validate repository code. This development environment cannot upload firmware to the physical camera, so a successful Arduino compile/upload and physical endpoint check must be performed on the target hardware; no physical test is claimed here.
