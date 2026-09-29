# Stage 10.6 — Drone Inspection

## Workflow and lifecycle

The Drone area is an operator-assisted inspection screen. The operator selects a field already stored locally and explicitly starts an inspection. Starting creates a local `FlightSession` with `sessionType: inspection`, the selected `fieldId`, the real drone ID last reported by the configured telemetry bridge, and a local start timestamp. No inspection session is created by simply opening the screen.

The operator ends the session explicitly. End saves `completed`; the repository also supports `interrupted` for an explicitly interrupted workflow. An inspection remains active across telemetry disconnects and disarmed reports so temporary link loss does not silently end operator work. Session summary counts use saved session values: duration, captured images, observations, and inspection zones.

## Capture pipeline

`DroneInspectionCaptureService` runs the local flow:

1. Check ESP32-CAM status.
2. Request the camera's real `/capture` JPEG.
3. Count the captured image in the local inspection session.
4. Read the latest persisted drone telemetry.
5. Attach only connected, real, fresh telemetry received no later than the image capture (30 second freshness window).
6. Run the existing on-device MobileNetV3 provider.
7. Save only a validated on-device result with acceptable image quality through the existing AI observation repository.
8. Associate the observation with the selected field and active session; then refresh the existing scouting/evidence and advisory/alert pipelines.

An unavailable camera leaves the session active. Low-quality images, unavailable AI, invalid model output, and malformed results do not create crop observations or trigger advisory/alert refresh. A real captured image is still counted as captured even when its quality check later rejects it.

## Telemetry, location, and geofence

The screen presents a compact subset of current read-only telemetry: connection, GPS fix, satellites, battery, flight mode, altitude, speed, and heading. The live map reuses the local field boundary, geotagged observations, scouting zones, valid track points, and current drone position. Only valid real coordinates are rendered. Geofence output is informational: inside, outside, or unavailable. Missing/stale/disconnected telemetry is not attached to a later image. If telemetry is fresh but has no valid GPS fix, the image can still be analyzed and the available non-location telemetry can be retained; the observation has no coordinates and no `locationSource`.

For located captures, `source` remains `esp32_cam_rgb` and `provenance` retains `on_device_ai`; `locationSource` is `drone` only when valid drone GPS is attached. The phone location is never substituted.

## Scouting requests and operator responsibilities

A qualifying existing zone can create a local `rescan_requested` ScoutingTask. This is a record for the operator; it does not dispatch work to the aircraft. Observations are shown with their original model result and need-verification state. Existing local services handle evidence, advisory, and alert updates, preserving their deduplication behavior.

The operator remains responsible for aircraft operation, safe flight, image framing, and field verification. No MAVLink flight-control commands, arming/disarming, takeoff/landing, RTL, mode changes, waypoint or mission upload, or motor control are implemented. Any future mission integration must be a separately reviewed stage and must consume operator-approved scouting requests explicitly.

## Offline behavior and requirements

Session, observation, track, field, zone, evidence, advisory, and alert records remain local. Core capture requires the phone and ESP32-CAM to share a reachable local network, the configured camera endpoint, and an available bundled on-device model. Drone location/context additionally requires a configured, reachable ESP32 telemetry bridge with fresh real telemetry. Internet, FastAPI, and cloud services are not required. Basemap tiles can be unavailable; locally stored geometry and scouting records remain available.

The screen currently requires a real drone ID to have been reported at least once by the local bridge before an inspection can start, because `FlightSession.droneId` is a required identity and the app does not invent one. Camera/AI capture may proceed without GPS after a session starts.
