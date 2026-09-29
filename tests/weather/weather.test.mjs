import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenMeteoProvider, parseOpenMeteoResponse } from '../../src/features/weather/open-meteo-provider.ts';
import { WeatherRepository } from '../../src/features/weather/weather-repository.ts';
import { WeatherCache, isCachedWeather } from '../../src/features/weather/weather-cache.ts';
import { translate } from '../../src/localization/resources.ts';

const field = { id: 'field-a', name: 'North Field', farmId: 'farm-a', center: { latitude: 28.6, longitude: 77.2 } };
function payload() { return { timezone: 'Asia/Kolkata', current: { temperature_2m: 28.4, apparent_temperature: 30, relative_humidity_2m: 64, precipitation: 0, weather_code: 2, wind_speed_10m: 12, wind_direction_10m: 180 }, daily: { time: ['2026-09-29'], temperature_2m_max: [30], temperature_2m_min: [22], precipitation_probability_max: [60], precipitation_sum: [2], weather_code: [2], sunrise: ['2026-09-29T06:00'], sunset: ['2026-09-29T18:00'] } }; }
function store() { const rows = new Map(); return { async get(type, id) { return rows.get(`${type}:${id}`); }, async save(type, value) { rows.set(`${type}:${value.id}`, value); return value; }, rows }; }

test('Open-Meteo response maps actual current and daily weather fields', () => {
  const data = parseOpenMeteoResponse(payload(), { ...field.center, fieldId: field.id, fetchedAt: '2026-09-29T00:00:00Z' });
  assert.equal(data.current.temperatureC, 28.4); assert.equal(data.current.humidityPct, 64); assert.equal(data.days[0].precipitationProbability, 60); assert.equal(data.days[0].sunrise, '2026-09-29T06:00');
  assert.throws(() => parseOpenMeteoResponse({}, { ...field.center, fieldId: field.id, fetchedAt: new Date().toISOString() }), /valid/i);
});

test('weather provider only requests saved field-center coordinates', async () => {
  let request = ''; const provider = new OpenMeteoProvider({ fetcher: async (url) => { request = String(url); return new Response(JSON.stringify(payload()), { status: 200 }); } });
  await provider.fetchForCoordinates(field.center.latitude, field.center.longitude, field.id);
  assert.match(request, /latitude=28\.6/); assert.match(request, /longitude=77\.2/);
});

test('no field center yields no request and offline fallback uses cached data', async () => {
  const raw = store(); const cache = new WeatherCache(raw); const data = parseOpenMeteoResponse(payload(), { ...field.center, fieldId: field.id, fetchedAt: '2026-09-28T22:00:00Z' }); await cache.save(data);
  let calls = 0; const repo = new WeatherRepository({ async fetchForCoordinates() { calls += 1; throw new Error('offline'); } }, cache, () => Date.parse('2026-09-29T00:00:00Z'));
  assert.deepEqual(await repo.forField(undefined), { status: 'unavailable', reason: 'no_field_location' });
  const result = await repo.forField(field); assert.equal(result.status, 'cached'); assert.equal(result.data.current.temperatureC, 28.4); assert.equal(calls, 1);
});

test('fresh cache avoids requests, bad coordinates and corrupt cache are unavailable', async () => {
  const raw = store(); const cache = new WeatherCache(raw); const data = parseOpenMeteoResponse(payload(), { ...field.center, fieldId: field.id, fetchedAt: '2026-09-29T00:00:00Z' }); await cache.save(data);
  let calls = 0; const repo = new WeatherRepository({ async fetchForCoordinates() { calls += 1; throw new Error('offline'); } }, cache, () => Date.parse('2026-09-29T00:10:00Z'));
  assert.equal((await repo.forField(field)).status, 'available'); assert.equal(calls, 0);
  assert.equal((await repo.forField({ ...field, center: { latitude: 100, longitude: 0 } })).reason, 'no_field_location');
  raw.rows.set('weather-cache:broken', { id: 'broken', fieldId: 'broken', latitude: 1, longitude: 2, fetchedAt: 'bad', current: {}, days: [] }); assert.equal(isCachedWeather(await cache.get('broken')), false);
});

test('weather interface text is localized in English and Hindi', () => {
  assert.equal(translate('en', 'weatherSelectField'), 'Select a field to view weather.'); assert.match(translate('hi', 'weatherSelectField'), /मौसम/); assert.match(translate('hi', 'weatherUnavailable'), /उपलब्ध नहीं/);
});
