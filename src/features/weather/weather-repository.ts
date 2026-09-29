import type { Field } from '@/domain/models';
import { isWeatherCacheFresh, validCoordinates } from './weather-provider.ts';
import { WeatherCache } from './weather-cache.ts';
import type { FieldWeather, WeatherProvider, WeatherView } from './weather-types.ts';

export class WeatherRepository {
  private readonly provider: WeatherProvider;
  private readonly cache: WeatherCache;
  private readonly now: () => number;
  constructor(provider: WeatherProvider, cache: WeatherCache, now: () => number = Date.now) { this.provider = provider; this.cache = cache; this.now = now; }

  async forField(field: Field | undefined, forceRefresh = false): Promise<WeatherView> {
    if (!field || !field.center || !validCoordinates(field.center.latitude, field.center.longitude)) return { status: 'unavailable', reason: 'no_field_location' };
    const cached = await this.cache.get(field.id).catch(() => undefined);
    const coordinatesMatch = cached?.latitude === field.center.latitude && cached?.longitude === field.center.longitude;
    const usableCache = coordinatesMatch ? cached : undefined;
    if (!forceRefresh && usableCache && isWeatherCacheFresh(usableCache.fetchedAt, this.now())) return { status: 'available', data: usableCache };
    try {
      const data = await this.provider.fetchForCoordinates(field.center.latitude, field.center.longitude, field.id);
      await this.cache.save(data);
      return { status: 'available', data };
    } catch (error) {
      return usableCache ? { status: 'cached', data: usableCache, reason: 'network' } : { status: 'unavailable', reason: error instanceof Error && /valid|coordinates/i.test(error.message) ? 'invalid_response' : 'network' };
    }
  }
}

export function isWeatherViewCached(view: WeatherView) { return view.status === 'cached'; }
export type { FieldWeather };
