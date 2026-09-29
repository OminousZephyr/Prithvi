# Stage 9 — Advisory and Risk Intelligence

## Data flow

`Observation → Evidence → Risk signal → Advisory → Farmer action → Verification`

These are separate local records. Observations retain the model output; evidence references eligible observations; risk signals state which measured/observed condition was supported; advisories explain what triggered the guidance and what the farmer may consider. A farmer's verification is stored as a separate state and never changes the raw AI label or confidence.

All evaluation reads local SQLite-backed entity records. No cloud service, FastAPI service, Internet connection, or external database is required. `AdvisoryRepository.saveRule()` stores per-field/crop/growth-stage rule configuration. No default agricultural thresholds are applied.

## Current deterministic rules

| Rule | Required source | Advisory / signal |
|---|---|---|
| Possible crop-health issue | Real, acceptable-quality, unverified on-device observation with confidence at or above the configured minimum (default 0.65) | Medium-priority “Inspect affected area”; `possible_crop_health_issue` signal; references observation ID |
| Repeated possible issue | Scouting evidence includes 2+ qualifying observations | Medium-priority “Inspect this zone”; references each source observation and evidence record; no confidence averaging |
| Uncertain/low confidence | Saved uncertain observation or possible issue below configured minimum | Low-priority clearer-image/rescan suggestion |
| Low image quality | Actual captured image quality check fails | Low-priority clearer-image suggestion; no crop observation is created |
| Farmer verified | Observation verification state is `verified` | Resolve linked inspection suggestion and offer low-priority monitoring guidance; original result stays intact |
| Farmer dismissed | Linked observations are dismissed | Resolve associated inspection advisory; do not emit new guidance for the same dismissed record |
| Stale sensor reading | A real reading is older than configured freshness duration (default 15 min) | Low-priority “Sensor reading is outdated”; raw value is not used as current evidence |
| Soil raw reference | Current valid soil ADC reading, crop context, and an explicitly enabled field rule with `soilRawBelow` and irrigation-check enabled | Low-priority “Check soil moisture before irrigation”; displays ADC counts and cites the configured raw threshold |
| Humidity / temperature reference | Current valid reading and explicitly configured `humidityAbovePct` or `temperatureAboveC` field rule | Low-priority monitoring guidance; no universal crop threshold |
| Rain sensor raw reference | Current valid raw reading and explicitly configured `rainRawThreshold` plus active direction | Low-priority sensor-check guidance; explicitly states the raw count is not rainfall amount |

Sensor rules resolve sensor-to-field association through the locally configured sensor and node records. Stale readings never trigger threshold comparisons. Soil and rain ADC values are never converted to percentages, volume, or irrigation/rain conclusions without explicit configuration.

Risk signals currently include possible crop-health issue, high humidity, high temperature, configured soil raw threshold, configured rain raw threshold, stale sensor data, and low image quality. Signals include references and validity times; they are not combined into a score.

## Advisory lifecycle and deduplication

Statuses are `active`, `acknowledged`, `resolved`, `dismissed`, and `expired`. Acknowledging means seen. Observation verification resolves an inspection advisory when its linked observations have been verified/dismissed. Farmer dismissal suppresses that same rule/observation advisory. Time expiry marks records expired but retains them for history.

The stable deduplication key includes field, zone or observation/sensor scope, category, and rule. Re-evaluation updates an active advisory instead of creating another card. A dismissed/resolved/expired record is retained and not recreated for that same cause. New observations/evidence produce their own cause references.

## Decisions that remain with the farmer

PRITHVI does not confirm a disease, predict crop failure, prescribe pesticides or fertilizer, issue irrigation commands, or perform crop treatment. It does not infer rain amount from ADC counts or apply generic humidity/temperature thresholds. “High” priority is reserved; current rules create only low/medium action priorities. The farmer decides what to inspect and what action, if any, to take.
