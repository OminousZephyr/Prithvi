# PRITHVI online features, account, and branding

## Offline-first boundary

The local SQLite-backed farm remains the app's source of truth. Core farm screens, saved fields and observations, sensors over the local network, bundled MobileNetV3 screening, photo diagnostics, drone inspection over the local network, maps from stored geometry, scouting, advisories, alerts, and history do not depend on an account or internet.

Core PRITHVI usage does not require a SIM or account. Phone OTP is online-only and requires an external SMS delivery provider configured for Supabase Auth. If sign-in, sync, weather, or KisanMitra is unavailable, local farm data remains usable.

## Weather

`src/features/weather/` owns the Open-Meteo provider, response parsing, local cache, repository, and presentation helpers. UI screens do not call Open-Meteo directly. Weather is requested only for a selected field's saved center; the phone's location and drone position are never substituted. The Weather screen refreshes on focus and when the farmer requests it. A 30-minute local cache avoids frequent requests. If refresh fails, a coordinate-matched cached response is shown with its age; it is never labelled live. Without a saved field center, the app asks the farmer to select/configure a field location. Weather does not trigger irrigation or crop-health advice. Open-Meteo attribution is shown in the Weather screen.

Weather freshness depends on network availability. Fresh weather may be unavailable offline; previously cached weather remains visible with an “Updated … ago” label.

## KisanMitra

More → KisanMitra sends a bounded, structured context assembled from local farm, selected field, recent observations, scouting evidence, active advisories/alerts, valid sensor readings, optional cached/fresh weather, and app language. It excludes image files, local paths, high-frequency telemetry, database internals, credentials, and developer diagnostics. Market prices are not currently provided, so the context sends an empty price list rather than inventing prices.

The app calls `EXPO_PUBLIC_KISANMITRA_FUNCTION_URL` only when the farmer asks a question. The Netlify Function validates any supplied Supabase access token, sanitizes context, constructs a cautious prompt, requests JSON-shaped Gemini output, validates sources against supplied records, and returns a small response. All responses require farmer verification. The function does not receive images and cannot replace MobileNetV3 screening. If KisanMitra is not configured or the phone is offline, it explains that internet is needed; other app functions remain available.

## Account and profile

The welcome/account area offers offline use and optional sign-in. Phone numbers are entered in E.164 format, an OTP is requested through Supabase Auth, and the code is verified by the existing auth provider. SMS/WhatsApp delivery is not included in the app; a messaging provider must be configured in the Supabase project. The display name is stored locally and mirrored into the authenticated Supabase user's `display_name` metadata when possible. On Home, the signed-in name appears in the compact account control; signed-out use uses a neutral farmer initial. Account and sync are optional and do not gate local records.

## Environment variables and security

Mobile `.env` values are public client configuration only:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KISANMITRA_FUNCTION_URL` (optional endpoint URL)

Configure `GEMINI_API_KEY` only in Netlify Functions environment settings. Supabase SMS-provider credentials and service-role keys remain in their respective server-side dashboards and must never be added to the app. The Function may also use `SUPABASE_URL` and `SUPABASE_ANON_KEY` server-side to validate a supplied user access token. No privileged Supabase operation is implemented in this function.

## Branding and languages

Light, dark, and transparent SVG logo assets live under `assets/branding/`; PNG app icon, adaptive icon, splash, and compact mark assets are integrated through Expo app configuration and the shared PRITHVI page header. The existing typography and theme remain unchanged. New weather, KisanMitra, account, and profile strings are available in English and Hindi.

## Manual deployment and validation

1. In Supabase, configure Phone Auth, a supported external SMS provider, OTP policy, and allowed app redirect settings. Add the public project URL and anon key to the mobile environment before creating a new app build.
2. Deploy the repository's `netlify/functions/kisanmitra.mjs` from the project root. Set `GEMINI_API_KEY` in Netlify's server-side Functions environment. If authenticated calls should be checked, configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` there too.
3. Set `EXPO_PUBLIC_KISANMITRA_FUNCTION_URL` to the deployed `/.netlify/functions/kisanmitra` endpoint. It may be left blank; KisanMitra will then be unavailable and offline features continue working.
4. Configure a field's saved center before requesting its weather.

This implementation has not been verified against a live Supabase project, SMS provider, Netlify deployment, or Gemini key. Weather requests are handled by the provider but no claim is made that the service is reachable on a particular device/network.
