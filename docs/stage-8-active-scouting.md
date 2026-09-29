# Stage 8 — Active Scouting Intelligence

## Evidence lifecycle

A successfully saved, real on-device crop observation is retained unchanged. `ScoutingEvidenceService` may group it with observations only when they are from the same field, have real valid GPS, the same crop and raw model condition, remain unverified, have acceptable image quality, are possible-issue results above the configured confidence minimum, and fall within the configured geographic radius and time window. Defaults are 50 m, 24 hours, and 0.65 confidence; these are service options, not scattered UI rules.

Distance uses Haversine meters. Confidence is never averaged: the evidence record retains each observation ID and a min/max range, while the UI displays each reading separately. Evidence levels are single observation, repeated observations, or corroborated observations from distinct timestamps. None means disease is confirmed. Missing GPS, stale/out-of-window observations, low confidence, poor image quality, other crops/conditions/fields, simulated data, and unavailable outputs do not strengthen evidence.

Evidence and tasks are stored as local entities in the existing local store; this requires no cloud or network service. Rescan comparison is a description of model outputs (`issue_repeated`, `issue_not_reproduced`, `result_changed`, `still_uncertain`, `rescan_unusable`), not a biological conclusion.

## Rescan state machine

The local workflow uses `surveying → issue_detected → inspection_suggested → rescan_requested → rescan_in_progress → rescan_completed → evidence_updated → needs_verification → verified|dismissed` as applicable. The app advances to `rescan_in_progress` when a real scan is started and records a completed result only after valid inference and acceptable image quality are saved. An unusable attempt records `rescan_unusable` and returns the task to `rescan_requested`.

Requesting a targeted rescan creates a local task only. It does not arm, take off, land, return-to-launch, change flight mode, upload a mission/waypoint, or control motors. Aircraft integration is outside this stage.

## Verification and alerts

Farmer verification is saved separately on observations and evidence. It never edits the original model label or confidence. Inspection reminders are informational and zone-aware: an active reminder for the same zone prevents a duplicate. Verified or dismissed zones no longer qualify for that active reminder; later eligible observations can start a new inspection cycle.

## UI and offline behavior

Monitor includes a Scouting view with locally stored zones, evidence levels, pending/completed requests, and real observation history. Zone details show each observation’s own confidence and explicit farmer verification controls. Existing field maps remain the visualization source; zones without real coordinates cannot be mapped. All evidence/task workflows function offline. Map tiles may be unavailable offline, but this does not prevent local evidence review.
