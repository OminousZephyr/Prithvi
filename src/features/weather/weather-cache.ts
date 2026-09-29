import type { FieldWeather } from './weather-types.ts';
import { validCoordinates } from './weather-provider.ts';

export interface WeatherCacheStore { get<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
export interface CachedWeather extends FieldWeather { id: string }

export class WeatherCache {
  private readonly store: WeatherCacheStore;
  constructor(store: WeatherCacheStore) { this.store = store; }
  async get(fieldId: string) {
    const value = await this.store.get<CachedWeather>('weather-cache', fieldId);
    return isCachedWeather(value) ? value : undefined;
  }
  async save(data: FieldWeather) { return this.store.save('weather-cache', { ...data, id: data.fieldId }); }
}

export function isCachedWeather(value: unknown): value is CachedWeather {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<CachedWeather>;
  return row.id === row.fieldId && typeof row.fieldId === 'string' && validCoordinates(row.latitude, row.longitude) &&
    typeof row.fetchedAt === 'string' && Number.isFinite(Date.parse(row.fetchedAt)) && !!row.current && Array.isArray(row.days) &&
    typeof row.current.condition === 'string' && row.days.every((day) => !!day && typeof day.date === 'string' && Number.isFinite(Date.parse(day.date)));
}
