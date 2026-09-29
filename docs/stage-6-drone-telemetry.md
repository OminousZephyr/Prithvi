# Stage 6 — Drone telemetry and geospatial observation foundation

This stage adds a read-only local telemetry consumer. It does not control the drone, and does not make a flight-readiness claim. Physical flight remains under the existing ArduPilot/Mission Planner workflow.

## Architecture

`ArduPilot MAVLink → ESP32 telemetry bridge → local HTTP GET /telemetry → LocalWifiDroneProvider → DroneRepository → local SQLite entity store → Drone screen / observation enrichment`

The application has no configured drone address by default. Save a local bridge base URL under **Settings → Drone telemetry · optional**, for example `http://192.168.1.50`. The provider requests `/telemetry` every two seconds, allows one request at a time, times out after five seconds, and aborts/ignores work when stopped. HTTP is local-network only; no cloud service is used.

## Bridge contract

The bridge may return a JSON object with `drone_id`, `timestamp`, `latitude`, `longitude`, `altitude`, `relative_altitude`, `ground_speed`, `heading`, `battery_voltage`, `battery_percent`, `satellites`, `armed`, `flight_mode`, `gps_fix`, and `connection`. Unavailable measurements should be JSON `null` (or omitted); the app preserves them as unavailable. `timestamp` is retained as a device timestamp, while the app records `receivedAt` locally and uses that for freshness. Coordinates outside latitude/longitude bounds are rejected. Soil or crop readings are not inferred from flight telemetry.

The app reports GPS fix from explicit `gps_fix`: 0/1 no fix, 2 2D, 3 3D, 4 DGPS, 5 RTK float, 6 RTK fixed, otherwise unknown. Satellite count is displayed independently and never used to infer fix quality.

## MAVLink field mapping

The transport-neutral parser accepts already-decoded messages. It does not implement a MAVLink serial decoder or sender.

| MAVLink message | PRITHVI fields |
| --- | --- |
| `HEARTBEAT` | `armed` from `base_mode` armed bit; `flightMode` only from an explicit decoded mode name |
| `GLOBAL_POSITION_INT` | latitude/longitude ÷ 1e7; altitude and relative altitude mm → m; horizontal velocity cm/s → ground speed m/s; heading centidegrees → degrees |
| `GPS_RAW_INT` | coordinates, `fix_type`, `satellites_visible` |
| `SYS_STATUS` | battery millivolts → volts; valid remaining battery percent |
| `VFR_HUD` | ground speed, heading, altitude |
| `ATTITUDE` | accepted but no displayed field is currently derived |

Unknown/sentinel values stay unavailable. `custom_mode` is not guessed into a flight mode name; the ESP32 bridge should send the decoded mode string.

## Persistence and sessions

Telemetry, flight sessions, and track points use the existing local entity store, with entity types `drone-telemetry`, `flight-session`, and `drone-track-point`; no SQLite schema migration is needed. A session starts only after real `armed: true`, completes after real `armed: false`, and becomes interrupted when the bridge disconnects during an active session. Track points are stored only for valid coordinates with a valid GPS fix during an active session. Nothing is interpolated. Observation counts change only when an observation is attached to the matching active session.

## Observation association and freshness

The observation capture path considers only a real connected telemetry record received at or before capture and no more than 30 seconds old. Location requires valid coordinates and an explicit GPS fix. It prefers fresh drone GPS; phone or manual location is used only if a future caller explicitly supplies such a provider. The app never substitutes phone position as aircraft position. If there is no active session or fresh telemetry, those links remain absent. AI provenance remains `on_device_ai`; attached flight context is represented separately and may add `drone_telemetry` provenance.

## Map-ready records

`MapLocation` is a typed future marker shape; no map provider or sample points are included. `DroneRepository.getTrack(sessionId)` returns only persisted real GPS track points.

## Future scouting

Later work can add camera-time snapshots, explicit image/telemetry matching, free map rendering, and verification workflows around real flight data. This foundation does not upload missions or implement arm, disarm, takeoff, land, RTL, mode switching, waypoint upload, or motor control.
