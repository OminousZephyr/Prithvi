# Stage 10 — Integrated Android edge-AI and hardware runtime

## A. Android development build

PRITHVI remains on Expo SDK `~57.0.24` and React Native `0.86.3`. `expo-dev-client` is already installed. The `react-native-fast-tflite` native module and `react-native-nitro-modules` are already dependencies; `react-native-fast-tflite` remains the only on-device model runtime. The Expo config plugin is in `app.json`. Expo Go cannot load this native runtime.

Build on a machine with Node, Android Studio/SDK (Android platform and build tools 36 for SDK 57), and a supported Java toolchain:

```powershell
npx expo prebuild --platform android --no-install --no-clean
npx expo run:android
npx expo start --dev-client
```

`--no-clean` applies app-config changes to the existing generated Android folder without regenerating it from scratch. Native configuration is maintained through Expo config and plugins; do not hand-edit generated native files. If the Android SDK or compatible JDK is unavailable, `prebuild` can still validate/generate config, but `run:android` cannot produce or install a build.

## B–C. TFLite runtime and bundled model

- Runtime: `react-native-fast-tflite`, CPU delegate only.
- Model: `assets/models/prithvi_mobilenetv3_plantvillage.tflite` (present, 3,317,048 bytes; TFLite FlatBuffer magic `TFL3`).
- Labels: `assets/models/plantvillage_labels.txt` (present; exactly 38 labels).
- The model and label files are static `require()` assets. Metro includes `.tflite` and `.txt` assets. The native runtime loads the labels from the packaged asset, loads the bundled model, and checks the model's runtime tensor metadata before inference.
- Required runtime contract: one input `float32 [1,224,224,3]`; one output `float32 [1,38]`. Output is interpreted as 38 softmax probabilities and rejected if invalid/not normalized. Label indices map to the 38 labels in file order.
- JPEG preprocessing decodes RGB, bilinearly resizes to 224×224, and supplies raw 0–255 float32 values. It does not add another normalization step because preprocessing is embedded in the selected model.
- Confidence threshold remains 0.65. Below it, the result abstains as uncertain. This is screening only; PlantVillage training classes may not represent unfamiliar crops or outdoor imagery.
- Android hardware metadata and actual inference still require a successful development build on a device; repository tests cannot load the native runtime.

## D–F. Hardware connections

- **ESP32 sensors:** Configure the base URL in Settings. The app checks `GET /health`, then polls `GET /sensors` every two seconds. Temperature and humidity retain physical units; soil and rain stay raw ADC counts. Invalid, missing, stale, or unreachable data stays unavailable.
- **ESP32-CAM:** Configure its base URL in Settings. The app checks `GET /camera-status`, requests a JPEG from `GET /capture`, previews it, then passes that same image to the on-device provider. A valid completed model result is required before an observation is persisted. Camera firmware remains the existing AI Thinker / GC2145 RGB565 240×240 server.
- **Drone telemetry:** Configure the ESP32 MAVLink bridge URL in Settings. The provider reads `/telemetry` and stores read-only telemetry. Location/context is attached only when valid and fresh. No flight commands are sent.

All local endpoints use HTTP for this prototype. `expo-build-properties` enables Android cleartext traffic so Android can reach the configured local-device endpoints. This is not production-grade secure transport; configure local device addresses only.

## G. Endpoint settings

Settings contains configurable ESP32 sensor, ESP32-CAM, and drone telemetry addresses. The FastAPI URL remains under Advanced / Developer and is optional; fallback is off by default. No IP address is baked into the app. Normal inference does not check or require FastAPI.

## H–I. Offline operation and diagnostics

Local TFLite inference, SQLite observations, stored field geometry, scouting evidence, and advisory evaluation do not require Internet or FastAPI. Map tiles can be unavailable offline while saved geometry and observation records remain accessible.

In a development build, open Settings → Advanced / Developer → Developer diagnostics to inspect AI/model readiness, camera and sensor health, drone status, SQLite availability, and configured endpoints. The diagnostics route is hidden from production navigation. It contains technical device/network details and is intended for developers.

## J. Physical validation sequence

1. Install and launch the Android development build; confirm the Crop Health Scan screen reports the on-device model ready.
2. A real bundled test JPEG is not currently present. The development “Analyze sample image” action reports “No test image installed”; sample inference cannot be physically validated until a real, correctly licensed leaf image is provided at `assets/test/plant-test.jpg`.
3. Connect the phone and ESP32 sensor board to the same Wi-Fi/hotspot. Configure the current ESP32 address in Settings. Confirm `/health` and live `/sensors` readings; verify raw soil/rain ADC values remain raw.
4. Connect the phone and verified ESP32-CAM to the same network. Configure its current address. Confirm camera status and capture preview.
5. Tap Capture & Analyze. Verify the captured JPEG is analyzed by on-device MobileNetV3 with FastAPI stopped. Confirm valid output creates one local observation with `source=esp32_cam_rgb`, `provenance=on_device_ai`, image reference, and capture timestamp.
6. If a drone bridge is actually connected and fresh, verify telemetry/GPS is shown and correctly associated. Otherwise confirm location remains unavailable; no phone location substitution is assumed.
7. Reopen Field Health/observation detail offline and confirm persistence, attached current sensor/telemetry context, advisory references, and scouting evidence where eligible.

## Completion checklist

- [ ] Android dev build launches
- [ ] MobileNetV3 sample image inference works (blocked until a real sample image is supplied)
- [ ] ESP32 sensor connected
- [ ] ESP32-CAM status works
- [ ] ESP32-CAM capture works
- [ ] Camera image reaches on-device model
- [ ] Drone telemetry connected
- [ ] GPS attached to observation
- [ ] Observation persisted
- [ ] Advisory generated
- [ ] Scouting zone updated

No physical hardware result is claimed by repository-side checks.
