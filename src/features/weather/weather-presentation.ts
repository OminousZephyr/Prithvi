import type { FieldWeather, WeatherCondition } from './weather-types.ts';
import type { TranslationKey } from '@/localization/resources';

export function weatherConditionKey(condition: WeatherCondition): TranslationKey {
  const keys: Record<WeatherCondition, TranslationKey> = { clear: 'weatherConditionClear', mostly_clear: 'weatherConditionMostlyClear', partly_cloudy: 'weatherConditionPartlyCloudy', overcast: 'weatherConditionOvercast', fog: 'weatherConditionFog', drizzle: 'weatherConditionDrizzle', rain: 'weatherConditionRain', snow: 'weatherConditionSnow', showers: 'weatherConditionShowers', thunderstorm: 'weatherConditionThunderstorm', unknown: 'weatherConditionUnknown' };
  return keys[condition];
}

export function compactWeatherLine(data: FieldWeather, t: (key: TranslationKey) => string) {
  const temperature = data.current.temperatureC === null ? '—' : `${Math.round(data.current.temperatureC)}°C`;
  const rain = data.days[0]?.precipitationProbability;
  return `${temperature} · ${rain === null || rain === undefined ? t('weatherRainUnavailable') : rain >= 40 ? t('weatherRainPossible') : t('weatherRainLessLikely')}`;
}

export function weatherUpdatedLabel(fetchedAt: string, now = Date.now(), t: (key: TranslationKey, value?: string) => string) {
  const age = Math.max(0, now - Date.parse(fetchedAt)); const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return t('weatherUpdatedJustNow');
  if (minutes < 60) return t('weatherUpdatedMinutes', String(minutes));
  return t('weatherUpdatedHours', String(Math.floor(minutes / 60)));
}

export function weatherDateLabel(date: string, locale: 'en-IN' | 'hi-IN') { return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }); }
