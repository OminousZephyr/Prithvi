import type { WeatherProvider } from './weather-types';

export const WEATHER_CACHE_TTL_MS = 30 * 60_000;
export const WEATHER_REQUEST_TIMEOUT_MS = 8_000;

export function validCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function isWeatherCacheFresh(fetchedAt: string, now = Date.now(), ttlMs = WEATHER_CACHE_TTL_MS) {
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < ttlMs;
}

export type { WeatherProvider };
