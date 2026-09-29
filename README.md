# PRITHVI

PRITHVI is an offline-first field assistant for Indian agriculture. It is built with Expo SDK 57, React Native, TypeScript, and Expo Router. A local profile and the core field workflow work without a SIM or a backend on a laptop.

## Current capabilities

- Field-first Home, field map, live sensor readings, crop screening, drone inspection status, alerts, advisories, and history.
- Local SQLite records on Android/iOS and browser storage on web. Existing Farm/Field records stay readable for compatibility.
- Local-network readings from a configured field sensor hub, on-device MobileNetV3/TFLite crop screening, and read-only drone telemetry.
- English and Hindi farmer-facing language, with technical connection details under Developer Diagnostics.
- Empty, stale, and unavailable states instead of fabricated weather, sensor readings, locations, or observations.

PRITHVI does not require FastAPI, Uvicorn, or a local AI server for field storage, on-device crop screening, and direct local-network sensor/camera use. Weather uses its configured provider when online and displays cached data when available. The app does not send flight-control commands. Recommendations are advisory and leave decisions to the farmer.

## Project layout

```text
src/
  app/                 Expo Router layouts, tabs, and detail routes
  components/          Shared product UI
  data/                Provider composition and local storage
  domain/              Farm entities and repository contracts
  features/            Capability screens and dashboard
  hooks/               Shared hooks
  localization/        English/Hindi-ready strings
  services/             AI, fusion, maps, and localization contracts
  theme/               PRITHVI colors and spacing
```

## Development

Install dependencies and start the development client:

```bash
npm install
npx expo run:android
npx expo start --dev-client
```

The Android development build requires Android SDK tooling. Subsequent Metro sessions can use `npx expo start --dev-client`. Type-check with `npm run typecheck` and lint with `npm run lint`.

## Hardware and sensor calibration

For live field readings, use an ESP32 field sensor hub with the PRITHVI firmware in `firmware/esp32-prithvi`, connected to the phone on the same local network. Configure the hub connection once in Developer Diagnostics; normal field screens show the friendly sensor-hub name. Attach only the sensor types actually installed. Soil and rain plates report raw 0–4095 ADC values. PRITHVI retains those values and uses a starter interpretation profile (soil dry/wet references and rain detection threshold); treat soil labels and estimated rain intensity as provisional until thresholds are calibrated for the probe and installation. Rain intensity is a sensor response estimate, not rainfall volume.

Crop screening runs with the bundled on-device TFLite model and labels. AI results are possible screening observations, not confirmed diagnoses. A phone camera works without an external camera server; ESP32-CAM use is optional and configured under Developer Diagnostics. Drone telemetry is read-only and optional.

Copy `.env.example` to `.env` only if configuring optional hosted account services. The app uses local/offline mode without these values. Keep private keys, service-role keys, SMS credentials, and Wi-Fi passwords out of the repository.

## Data provenance

Field sensor values show their zone and field sensor hub source. Soil/rain raw counts remain available alongside interpretations. Crop observations identify their screening source and confidence where available. Weather shows provider and update time. Local field data remains on the device whether hosted sign-in or synchronization is configured or not.
