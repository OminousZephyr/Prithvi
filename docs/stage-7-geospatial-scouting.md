# Stage 7 — Geospatial field scouting

## Field geometry

Fields can carry an ordered latitude/longitude boundary, optional center, and area. Existing fields without geometry remain valid. Geometry is checked for finite coordinates, coordinate bounds, at least three points, and non-zero polygon area. A missing center and area are derived in memory from a valid boundary; the area estimate is stored/displayed in acres. A previously entered area is kept. The app does not create boundaries itself.

## Map architecture

`ScoutingMapData` separates map-ready field geometry, observation markers, drone position, tracks, and scouting zones from the raw observation and telemetry models. `ScoutingMap` is platform-resolved; Android/iOS use the OpenStreetMap adapter and renderer, while web explains that its map preview is unavailable and reports the local record counts. The native renderer uses OpenStreetMap raster tiles, with attribution, no key, and no paid provider. Basemap tiles need network access. When tiles fail or the device is offline, locally stored geometry and markers remain drawn on the neutral canvas and the UI says tiles are unavailable. No tiles or points are fabricated.

The field detail screen fits the viewport around its real boundary or mapped points. Observation markers open the existing Observation Details route. Marker categories are healthy-looking, possible issue, uncertain, and needs verification. Records with missing/invalid coordinates are listed in history but omitted from the map.

## Drone location and tracks

The existing read-only Wi-Fi telemetry provider remains the sole source. A position marker is shown only while the latest telemetry is connected and fresh (30 seconds) with valid coordinates and explicit GPS fix. Heading and altitude are included only when received. Stale, disconnected, unavailable, and no-fix states are called out without leaving an old location looking live.

Track points come from the local `drone-track-point` entity records for a flight session linked by an observation to the field. Only real stored GPS fixes are rendered; there is no interpolation. With no saved points, no line is drawn. Field-associated session information is shown only when an observation links that session to the field.

## Observation markers and field summary

Map-ready markers are built from persisted crop observations and preserve their observation IDs, crop, condition, confidence, timestamp, source, and verification state. The field health summary counts actual records and inspection zones. It does not calculate a health score or average confidence.

## Scouting zones

Zones are created locally from groups of at least two nearby observations (within 50 m of a group seed) matching the same field, crop, and condition. Eligible records must have valid coordinates, be possible-issue observations awaiting verification, and meet the current confidence threshold of 0.65. Uncertain, unavailable, unlocated, low-confidence, verified, dismissed, or simulated records cannot form a zone. Zone severity is always `inspection_suggested`; it is not a disease severity assessment. Zone IDs and farmer workflow state are persisted locally.

## Targeted rescan state

“Request targeted rescan” creates a local `ScoutingTask` with state `targeted_rescan_requested` and updates that local zone state. It is a note for a later workflow only. It does not contact the drone or telemetry bridge. Other lifecycle states (`broad_survey`, `possible_issue`, `inspection_suggested`, `verification_pending`, `verified`, `dismissed`) are represented in the task type for local workflow evolution.

## Offline behavior

Field geometry, observations, zones, tasks, flight sessions, and tracks use the existing local SQLite entity store. No cloud service, FastAPI service, API key, or internet connection is needed to inspect saved data. Without internet, OSM tiles can be unavailable; the map still shows saved vectors and markers when present and states that the basemap is unavailable. Web preview shows a truthful platform limitation and data counts.

## Flight-control boundary

This layer only visualizes persisted observations and read-only telemetry. It contains no arm, disarm, takeoff, landing, RTL, mode-switching, waypoint/mission upload, or motor-control implementation. A targeted rescan request remains local; physical flight continues to be managed through the existing ArduPilot/Mission Planner workflow.
