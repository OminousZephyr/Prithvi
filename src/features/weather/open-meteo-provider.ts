import type { FieldWeather, WeatherCondition, WeatherDay, WeatherProvider } from './weather-types.ts';
import { WEATHER_REQUEST_TIMEOUT_MS, validCoordinates } from './weather-provider.ts';

const CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m'];
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'weather_code', 'sunrise', 'sunset'];

export class WeatherResponseError extends Error { constructor(message = 'Weather response was not valid.') { super(message); this.name = 'WeatherResponseError'; } }

export class OpenMeteoProvider implements WeatherProvider {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  constructor(options: { fetcher?: typeof fetch; now?: () => Date } = {}) { this.fetcher = options.fetcher ?? fetch; this.now = options.now ?? (() => new Date()); }

  async fetchForCoordinates(latitude: number, longitude: number, fieldId: string): Promise<FieldWeather> {
    if (!validCoordinates(latitude, longitude)) throw new WeatherResponseError('The saved field coordinates are invalid.');
    const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: CURRENT.join(','), daily: DAILY.join(','), forecast_days: '5', timezone: 'auto', wind_speed_unit: 'kmh' });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
      return parseOpenMeteoResponse(await response.json(), { latitude, longitude, fieldId, fetchedAt: this.now().toISOString() });
    } finally { clearTimeout(timer); }
  }
}

export function parseOpenMeteoResponse(value: unknown, source: { latitude: number; longitude: number; fieldId: string; fetchedAt: string }): FieldWeather {
  if (!validCoordinates(source.latitude, source.longitude) || !value || typeof value !== 'object') throw new WeatherResponseError();
  const root = value as Record<string, unknown>; const current = asObject(root.current); const daily = asObject(root.daily);
  const time = stringArray(daily?.time); if (!current || !daily || !time.length) throw new WeatherResponseError();
  const readCurrent = (key: string) => finiteNumber(current[key]);
  const days: WeatherDay[] = time.slice(0, 5).map((date, index) => ({
    date,
    minC: numericAt(daily.temperature_2m_min, index), maxC: numericAt(daily.temperature_2m_max, index),
    precipitationProbability: numericAt(daily.precipitation_probability_max, index), precipitationMm: numericAt(daily.precipitation_sum, index),
    condition: toWeatherCondition(numericAt(daily.weather_code, index)), sunrise: stringAt(daily.sunrise, index), sunset: stringAt(daily.sunset, index),
  }));
  if (!days.length || days.some((day) => !Number.isFinite(Date.parse(day.date)))) throw new WeatherResponseError();
  return {
    fieldId: source.fieldId, latitude: source.latitude, longitude: source.longitude, fetchedAt: source.fetchedAt,
    timezone: typeof root.timezone === 'string' ? root.timezone : 'UTC',
    current: { temperatureC: readCurrent('temperature_2m'), apparentC: readCurrent('apparent_temperature'), humidityPct: readCurrent('relative_humidity_2m'), precipitationMm: readCurrent('precipitation'), condition: toWeatherCondition(readCurrent('weather_code')), windKmh: readCurrent('wind_speed_10m'), windDirectionDegrees: readCurrent('wind_direction_10m') },
    days,
  };
}

export function toWeatherCondition(code: number | null): WeatherCondition {
  if (code === 0) return 'clear'; if (code === 1) return 'mostly_clear'; if (code === 2) return 'partly_cloudy'; if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog'; if ([51, 53, 55, 56, 57].includes(code ?? -1)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code ?? -1)) return 'rain'; if ([71, 73, 75, 77].includes(code ?? -1)) return 'snow';
  if ([80, 81, 82, 85, 86].includes(code ?? -1)) return 'showers'; if ([95, 96, 99].includes(code ?? -1)) return 'thunderstorm'; return 'unknown';
}

function asObject(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function finiteNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function numericAt(value: unknown, index: number) { return Array.isArray(value) ? finiteNumber(value[index]) : null; }
function stringAt(value: unknown, index: number) { return Array.isArray(value) && typeof value[index] === 'string' ? value[index] as string : undefined; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
