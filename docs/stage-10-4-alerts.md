# Stage 10.4 — Local Alert Center

PRITHVI alerts are explainable, in-app attention records. They are persisted in the existing local entity store (`alert`) and are available offline. This stage adds no notification permission prompt, push service, cloud job, or new backend.

## Sources and rules

- **Crop inspection:** a saved, non-simulated possible-issue observation can create a medium-priority alert when confidence is at least 0.65 and farmer verification is still required. A saved qualifying scouting zone groups the concern into one zone alert; an active inspection/scouting advisory is linked when present. The alert describes an inspection suggestion, never a confirmed diagnosis.
- **Sensor:** sensor alerts are evaluated only after an ESP32 URL has been configured. A node's latest valid reading or last-seen time must be older than the configurable `sensorStaleAfterMs` (default five minutes). A disconnected configured ESP32 also requires a known last receive time older than that threshold. These alerts are low priority. Missing optional sensor configuration creates no alert.
- **Drone:** telemetry alerts are considered only when a drone URL is configured and a locally persisted flight session is active. Disconnected/stale telemetry or a missing GPS fix is a low-priority information item. No active flight, no configured URL, and unknown conditions create no alert.
- **Geofence:** while the same configured active flight has a real, fresh GPS fix and an active local inspection task identifies a field boundary, a position outside that boundary creates a medium-priority informational alert. Unknown GPS or an absent boundary does not.
- **System:** the model supports this alert type, but no broad system alert is emitted without a concrete detectable source. Storage errors are surfaced by the relevant screen; this stage does not manufacture a system alert.

High priority is reserved; no agricultural rule currently emits it. Priority expresses attention needed, not disease severity.

## Dedupe and lifecycle

Stable keys identify the event: crop inspection uses `field + zone` (or `field + observation` if unzoned), sensor uses `device + sensor kind` (or configured device connection), and geofence uses `flight session + field`. Refresh updates an active record instead of adding a duplicate. Alerts are retained as history and may be `active`, `acknowledged`, `resolved`, `dismissed`, or `expired`.

Acknowledgement means the farmer has seen an item. Dismissal is an explicit choice to remove it from attention. Resolution is used when the underlying condition or inspection workflow is actually resolved. The alert lifecycle does not modify an observation or its AI result. Alerts expire after seven days by default; the expiry duration can be configured in `AlertService`.

## Advisory relationship and offline behavior

Inspection alerts reference the existing advisory when available and keep source observation/evidence separate. Alert details expose related local observation, advisory, and scouting evidence. The existing SQLite entity store persists each alert; the web preview uses its existing local storage adapter. On app restart the alert list is loaded from that store and evaluated against current local records.

## Notification and flight boundaries

This is an in-app Alert Center only. Android local notifications and remote push are intentionally deferred; there are no notification permission prompts or cloud notification dependencies. Geofence and telemetry alerts are read-only. No arming, disarming, takeoff, landing, RTL, mode changes, mission uploads, waypoint uploads, or motor commands are implemented.
