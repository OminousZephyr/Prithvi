# Sensor subsystem

## Data flow

`USB/Wi-Fi line transport → SerialSensorProvider → JSONL parser → SensorRepository → localStore → Screens`

`SensorLineTransport` only supplies UTF-8 chunks and connection state. `SerialSensorProvider` joins fragmented chunks into bounded lines, parses each independently, validates fields, assigns the app-side receive time, and persists the four configured sensor records. Malformed lines are ignored; a missing or invalid field is stored without a value and marked invalid. Device `timestamp` is never used as observation time.

The existing native `localStore` implementation stores nodes, sensor definitions, readings, health and calibrations in its SQLite `entities` table. `latestReadings` is derived per sensor from the append-only reading records; `history` returns prior records. The web fallback continues to use the existing localStorage adapter.

Soil and rain ADC values stay in `ADC count`. A soil calibration needs both `dryRaw` and `wetRaw`; rain interpretation needs a sensor-specific `rainThresholdRaw` and `rainActiveWhen`. No percent conversion or rain-detected label is produced until those values have been configured. Freshness is 10 seconds for stale and 60 seconds for offline, suitable for the example's approximately 2-second packet interval.

## Current transport limitation

`UnavailableUsbSerialTransport` is intentionally the default. Expo's installed SDK modules do not supply a USB-serial host connection, and this project has no native Android serial adapter or development build. The Expo web preview cannot open USB serial. Therefore this build cannot receive readings from the ESP32 yet; the firmware sketch only outputs to a serial monitor until a native adapter is integrated.

Implement an Android adapter behind `SensorLineTransport`, including USB-host device discovery, permission request, 115200 baud I/O, disconnect events, and line subscription. No UI, model, parser, or repository changes should be required. A future Wi-Fi transport can implement the same line contract when that stage is authorized.
