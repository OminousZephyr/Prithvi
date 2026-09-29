# PRITHVI ESP32-CAM firmware

This sketch is for the verified **AI Thinker ESP32-CAM** board fitted with the **RHYX M21-45 / GC2145 (PID 0x2145)** camera. It keeps the camera in **RGB565 at 240 × 240**. The ESP32 camera conversion library encodes the captured RGB565 frame to JPEG in software for the HTTP capture response.

## Routes

- `GET /camera-status` reports initialized state, MAC-derived device ID, detected sensor/PID, active format and frame dimensions, and actual Wi-Fi connection/IP state.
- `GET /capture` captures the current frame. JPEG frames pass through; other formats use `frame2jpg()` from `img_converters.h`. A successful response is `image/jpeg`. Capture or conversion failure returns HTTP 500. The converted JPEG buffer and camera framebuffer are released after the response.

Both routes are registered once on the existing `camera_httpd`; the original CameraWebServer routes and stream server remain in place.

## Arduino IDE upload

1. Use Arduino IDE with the Espressif **esp32** board package and open `CameraWebServer/CameraWebServer.ino` from this repository. Keep `app_httpd.cpp`, `camera_index.h`, and `board_config.h` in the same CameraWebServer sketch folder/build.
2. In Tools → Board select **AI Thinker ESP32-CAM**. Select the USB-to-UART adapter's COM port. Set **Upload Speed: 115200**, **Flash Frequency: 40 MHz**, and **Partition Scheme: Huge APP (3 MB No OTA / 1 MB SPIFFS)** where those menus are exposed. Leave the camera model selection in `board_config.h` as `CAMERA_MODEL_AI_THINKER`.
3. Enable **PSRAM** in Tools if the installed board package exposes that option. The sketch checks `psramFound()` and uses two PSRAM framebuffers when present, otherwise one DRAM framebuffer. Menu wording varies by ESP32 board package release; keep the board target as AI Thinker ESP32-CAM.
4. Wire a 3.3 V USB-to-UART adapter: adapter TX → ESP32 U0R, RX → U0T, GND → GND; provide stable 5 V to the board's 5V pin. To flash, connect GPIO0 to GND and reset/power-cycle the board.
5. In the sketch, enter the local Wi-Fi/hotspot name and password in `ssid` and `password`. Upload. After upload, disconnect GPIO0 from GND and reset the board.
6. Open Serial Monitor at **115200 baud**. Confirm `CAMERA INITIALIZED SUCCESSFULLY`, `Sensor PID: 0x2145`, Wi-Fi connected, and note the printed `Camera Ready! Use 'http://…'` address. Do not assume this IP is permanent.

## Windows endpoint checks

In PowerShell, set the URL to the current address printed in Serial Monitor (replace the placeholder):

```powershell
$CameraBaseUrl = 'http://<ESP32-CAM-IP>'
Invoke-RestMethod "$CameraBaseUrl/camera-status" | ConvertTo-Json -Depth 5
$capture = Invoke-WebRequest "$CameraBaseUrl/capture" -OutFile .\capture.jpg -PassThru
$capture.Headers['Content-Type']
Get-Item .\capture.jpg | Select-Object Name, Length
```

The status should report sensor `GC2145`, PID `0x2145`, format `RGB565`, and dimensions 240 × 240 when that is the active camera frame. The capture response should be `image/jpeg` and a non-empty file. This repository cannot verify the physical board or compile/upload firmware from the current development environment.

For FastAPI setup and the end-to-end local-network flow, see [`../../docs/prithvi-cam-ai-e2e.md`](../../docs/prithvi-cam-ai-e2e.md).

HTTP is used on the local network for this prototype; it is not production-grade secure communication. This firmware reports camera data and images only. It does not classify crop health.
