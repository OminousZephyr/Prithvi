# PRITHVI ESP32 local Wi-Fi sensor example

This sketch serves the **actual** DHT11, soil sensor, and rain sensor readings over a local HTTP endpoint. The ESP32 and Android phone must join the same Wi-Fi network. Internet access is not required.

```text
ESP32 → Wi-Fi / phone hotspot → Android phone running PRITHVI
```

## Hardware and wiring

| Part | ESP32 DevKit V1 | Notes |
| --- | --- | --- |
| DHT11 DATA | GPIO 4 | Some bare DHT11 sensors need a pull-up resistor; modules may include one. |
| Soil module AO | GPIO 34 | Analog input only. |
| Rain module AO | GPIO 35 | Analog input only. |
| Sensor power / ground | 3V3 / GND | Use a common ground; keep analog output at or below 3.3 V. |

Check each module's supply requirements. Do not connect a 5 V analog output to an ESP32 input. GPIO 34 and 35 are input-only ADC1 pins on the common DevKit V1. Board and module revisions can differ.

## Configure and upload

1. In `esp32-prithvi.ino`, replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with the local router or phone-hotspot credentials. Do not publish personal credentials in a shared copy of the sketch.
2. Install the free Arduino IDE, the Espressif ESP32 board support, and Adafruit **DHT sensor library** (including Adafruit Unified Sensor) through Arduino's Library Manager.
3. Select the matching ESP32 board and serial port, then upload the sketch over USB.
4. Open Serial Monitor at **115200 baud**. The sketch prints JSONL debug readings and, after joining Wi-Fi, the current address, for example `Wi-Fi connected. ESP32 IP: http://192.168.1.50`.
5. In PRITHVI → Sensors, enter that address and tap **Connect**. The app polls `GET http://<ESP32-IP>/sensors` every 2 seconds.

If the IP line does not appear, verify the SSID/password and that the hotspot/router allows local devices to communicate. Keep the phone on the same network and do not use cellular data as the only active route. The phone and ESP32 should be on the same local network; no public server, paid service, or Internet connection is used. The hotspot may assign a different IP after reconnecting or rebooting. Read the new address from Serial Monitor and update it in PRITHVI → More → Settings; the app does not assume the address is permanent.

## HTTP endpoints

- `GET /health` returns `{"device_id":"PRITHVI-ESP32-01","status":"ok"}`.
- `GET /sensors` returns `device_id`, `temperature`, `humidity`, `soil_raw`, `rain_raw`, and `uptime_ms` (ESP32 uptime in milliseconds, **not** wall-clock time).

DHT11 read failure is JSON `null`. Sensor readings are sampled about every 2 seconds and the same current sample is available until the next sample. HTTP uses unencrypted local-network traffic for this prototype; it is not production-grade secure communication. The open CORS header is only for local development/browser preview.

PRITHVI timestamps receipt on the phone and stores the ESP32 uptime value separately. `soil_raw` and `rain_raw` are raw ADC counts. They are **not** moisture percentages, and a rain count does **not** mean rain is detected. Soil dry/wet calibration and rain threshold/polarity configuration are future work. Basic analog reads cannot identify a physically detached sensor; inspect wiring and treat implausible readings as a data-quality issue.
