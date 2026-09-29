# Stage 5: field observations and context

## Storage

Crop observations continue to use the local store's existing `entities` table. SQLite stores each entity's typed payload as JSON, so adding optional fields to `CropObservation` does not require a table migration. Older rows are normalized on read: `timestamp` falls back to `observedAt`, `rawModelLabel` falls back to `rawLabel`, and `syncStatus` falls back to `syncState`. Sensor, farm, field, and settings entity types are unchanged.

## Observation provenance

An on-device camera scan keeps `source: esp32_cam_rgb` and `provenance: [on_device_ai]`. Context is attached as separate snapshots. When sensor or telemetry records are present, their provenance is appended and `fused` identifies that more than one evidence source contributed. No measurements are averaged or turned into risk statements.

Valid sensor values are copied with their original timestamp and unit. Values older than 10 seconds at the observation time are tagged `stale`; invalid/missing readings are omitted. Soil and rain values remain raw ADC counts. Latest recorded drone telemetry is retained with its timestamp and a `current`/`stale` marker using a 60-second freshness window. No autonomous flight is implied.

## Location and field assignment

The location-provider contract is available for a future real device/GPS adapter. Its current implementation returns unavailable. A scan remains unlocated and unassigned unless the user selected a known field or a real location fix is supplied. When a fix is available and no field was selected, recorded field polygons are checked; no match means the observation remains unassigned.

The app currently has no native phone GPS adapter and no live drone telemetry provider. The context path reads actual local sensor records and any locally persisted `drone-telemetry` records; if none exist, those fields remain empty. It creates no coordinates, telemetry, sensor values, alerts, or sample observations.

## Verification and filtering

Only a validated on-device inference with an accepted image, finite confidence, model version, and mapped raw class is saved. Low confidence is preserved as `uncertain` and requires verification. The observation detail screen offers explicit farmer actions to verify, dismiss, or return the observation to the verification queue. These actions retain the model's original screening status and append manual provenance; “verified” records the farmer's field check and does not mean “disease confirmed.”

The observation repository supports filtering by farm, field, inclusive date range, source, crop, and screening/verification status. Inspection reminders are limited to an information-level “Inspection suggested” result for an unverified, real, higher-confidence possible issue; uncertainty and lower-confidence results do not generate one.
