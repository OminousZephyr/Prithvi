/** Wire protocol: one UTF-8 JSON object per line. Device timestamps are informational only. */
export interface Esp32SensorFrame {
  deviceId: string;
  deviceTimestamp?: string | number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  soilRaw: number | null;
  rainRaw: number | null;
  fieldQuality: Record<'temperature' | 'humidity' | 'soil_moisture' | 'rain', { valid: boolean; detail?: string }>;
}

export type ParseLineResult = { ok: true; frame: Esp32SensorFrame } | { ok: false; reason: 'malformed_json' | 'invalid_payload' };

function parseReading(value: unknown, field: string, minimum: number, maximum: number): { value: number | null; valid: boolean; detail?: string } {
  if (value === null || value === undefined) return { value: null, valid: false, detail: 'Reading unavailable from device' };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return { value: null, valid: false, detail: `Invalid ${field} value from device` };
  }
  return { value, valid: true };
}

/** Parses the existing USB JSONL shape or the Wi-Fi REST /sensors shape. */
export function parseEsp32JsonLine(line: string): ParseLineResult {
  let decoded: unknown;
  try { decoded = JSON.parse(line.trim()); } catch { return { ok: false, reason: 'malformed_json' }; }
  return parseEsp32SensorPayload(decoded);
}

export function parseEsp32SensorPayload(decoded: unknown): ParseLineResult {
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return { ok: false, reason: 'invalid_payload' };
  const payload = decoded as Record<string, unknown>;
  if (typeof payload.device_id !== 'string' || !payload.device_id.trim() || payload.device_id.length > 64) return { ok: false, reason: 'invalid_payload' };

  const temperature = parseReading(payload.temperature_c ?? payload.temperature, 'temperature', -40, 80);
  const humidity = parseReading(payload.humidity_pct ?? payload.humidity, 'humidity', 0, 100);
  const soil = parseReading(payload.soil_raw, 'soil moisture ADC', 0, 4095);
  const rain = parseReading(payload.rain_raw, 'rain ADC', 0, 4095);
  const timestamp = payload.timestamp ?? payload.uptime_ms;
  const deviceTimestamp = typeof timestamp === 'string' || typeof timestamp === 'number' || timestamp === null ? timestamp : undefined;
  return { ok: true, frame: {
    deviceId: payload.device_id.trim(), deviceTimestamp,
    temperatureC: temperature.value, humidityPct: humidity.value, soilRaw: soil.value, rainRaw: rain.value,
    fieldQuality: {
      temperature: { valid: temperature.valid, detail: temperature.detail },
      humidity: { valid: humidity.valid, detail: humidity.detail },
      soil_moisture: { valid: soil.valid, detail: soil.detail },
      rain: { valid: rain.valid, detail: rain.detail },
    },
  } };
}

/** Handles fragmented serial chunks, CRLF, multiple lines, and overlong records without throwing. */
export class JsonLineDecoder {
  private pending = '';
  private droppingLine = false;
  private readonly maxLineLength: number;
  constructor(maxLineLength = 16_384) { this.maxLineLength = maxLineLength; }

  push(chunk: string): { lines: string[]; discarded: number } {
    const lines: string[] = [];
    let discarded = 0;
    for (const character of chunk) {
      if (character === '\n') {
        const line = this.pending.replace(/\r$/, '').trim();
        if (!this.droppingLine && line) lines.push(line);
        this.pending = '';
        this.droppingLine = false;
      } else if (this.droppingLine) continue;
      else if (this.pending.length < this.maxLineLength) this.pending += character;
      else { this.pending = ''; this.droppingLine = true; discarded += 1; }
    }
    return { lines, discarded };
  }
}
