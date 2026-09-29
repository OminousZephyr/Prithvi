# Stage 11 — Account and Offline-First Sync Foundation

## Offline-first behavior

SQLite remains the runtime source of truth. First launch offers **Continue offline** and **Sign in / Create account**; neither farms nor any other local feature is gated by authentication. Account failure, expired sessions, unavailable Supabase, or no network leave local records intact and usable. A stable `localUserId` is generated and stored locally; after authentication, the separate Supabase `remoteUserId` is saved as an account mapping. Farm and field data are not keyed by Supabase IDs.

The local Account screen is available from More. It supports offline mode, phone OTP request/verification, restoring a persisted auth session, sign-out, sync status, last sync, and a manual **Sync now** action. A signed-in app restores auth and attempts sync at startup and when it returns to the foreground. Signing in also attempts sync. No network-status package or background worker was added; if the network returns while the app remains open, the operator can press Sync now or resume the app.

## Authentication and OTP setup

The app uses the public `@supabase/supabase-js` client configuration from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Copy `.env.example` to a local `.env` and fill those public values. Do not use a service-role key. Supabase auth sessions are persisted in the local entity store. The sign-in service accepts E.164 phone numbers; the initial form uses `+91` as an example without requiring an Indian number.

Phone OTP requires an external SMS/WhatsApp delivery provider configured in the Supabase project. That provider's credentials stay in Supabase/provider configuration and are never included in the Expo app. The core PRITHVI experience does not require OTP or a SIM.

The Supabase project must enable phone authentication and configure an OTP delivery provider. Then apply `supabase/migrations/202609290001_prithvi_sync.sql` in the Supabase SQL editor. No service code or privileged endpoint is part of the app.

## Local and cloud architecture

```text
PRITHVI screens/features
        ↓
local repositories and sync-aware entity store
        ↓
Expo SQLite (source of truth) ── durable SyncQueue
        ↓ authenticated opt-in only
SyncService → CloudRepository → Supabase Auth + owner-scoped JSON records
```

Normal entity saves for the initial sync allow-list are stored locally and create/coalesce a durable SQLite queue item. Queue items retain create/update/delete operation, local user/entity identity, payload, attempt count, and last error. Queue updates survive process restarts. Sync runs on sign-in, app startup/resume, or manual request; there is no background sync job. If a cloud request fails, the entity and queue remain local and retryable; the UI says local data is safe.

## Synced and local-only data

The owner-scoped `prithvi_sync_records` table is a JSONB envelope contract with a checked `record_type` allow-list: Farm (`farm`), Field (`field`), Crop (`crop`), CropObservation (`crop-observation`), ScoutingEvidence (`scouting-evidence`), ScoutingZone (`scouting-zone`), ScoutingTask (`scouting-task`), Advisory (`advisory`), Alert (`alert`), and FlightSession (`flight-session`). Each row carries the authenticated `owner_id`, stable `local_user_id`, local ID, JSON object payload, update timestamp, and optional deletion timestamp; the table UUID is mapped back as the local record's `remoteId`. Local entities track `local_only`, `pending_upload`, `synced`, `pending_delete`, `conflict`, or `error`, plus `lastSyncedAt`, `remoteId`, `updatedAt`, and `deletedAt`. Legacy records with no status are discovered and queued at sync time.

High-frequency sensor readings and telemetry, raw MAVLink messages, camera frame buffers, developer diagnostics, and image files are not synchronized. Crop observation metadata can sync, but local `imageReference` is stripped from cloud payloads and `imageSyncStatus` remains `local_only`. No image upload is implemented or attempted.

## Ownership and security

Every cloud query includes the current Supabase auth user as owner. The SQL table enables row-level security and checks `auth.uid() = owner_id` for select/insert/update/delete; this independently prevents one signed-in user from reading another user's rows. The app only contains the Supabase URL and public anon key. SMS-provider credentials, service-role keys, and other privileged secrets must remain server-side. Future privileged operations may use a separately reviewed Netlify Function, but none are part of this stage.

## Conflict policy and history

The first policy uses the newest valid `updatedAt`; if timestamps tie or are invalid on both sides, the local record wins deterministically. Tombstones propagate as `deleted_at` and remain hidden from normal local reads. This is not a CRDT. Crop observations keep append-only verification history and a merged model-result history; the original raw model label and confidence are preserved instead of rewritten. Local image references remain available in SQLite but are stripped from cloud payloads. A retry does not clear or replace the SQLite source record.

## Not included

No mandatory login, weather, market prices, KisanMitra, image uploads, push notifications, background jobs, or aircraft-control behavior were added. The sync SQL must be applied and Supabase phone OTP/SMS delivery configured before online account sync can be exercised. Until then, the app works offline and marks cloud sync as unconfigured.
