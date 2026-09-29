import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonLineDecoder, parseEsp32JsonLine } from '../../src/features/sensors/protocol/esp32-jsonl.ts';

test('parses valid JSON lines and does not turn device time into app time', () => {
  const result = parseEsp32JsonLine('{"device_id":"PRITHVI-ESP32-01","timestamp":0,"temperature_c":27.4,"humidity_pct":62.1,"soil_raw":1842,"rain_raw":3200}');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.frame.deviceId, 'PRITHVI-ESP32-01');
    assert.equal(result.frame.deviceTimestamp, 0);
    assert.equal(result.frame.temperatureC, 27.4);
    assert.equal(result.frame.fieldQuality.rain.valid, true);
  }
});

test('reports absent, null, and out-of-range measurements as unavailable', () => {
  const result = parseEsp32JsonLine('{"device_id":"node-a","temperature_c":null,"soil_raw":5000}');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.frame.temperatureC, null);
    assert.equal(result.frame.fieldQuality.temperature.valid, false);
    assert.equal(result.frame.humidityPct, null);
    assert.equal(result.frame.fieldQuality.humidity.valid, false);
    assert.equal(result.frame.soilRaw, null);
    assert.equal(result.frame.fieldQuality.soil_moisture.valid, false);
  }
});

test('rejects malformed JSON and payloads without a device ID', () => {
  assert.deepEqual(parseEsp32JsonLine('{oops'), { ok: false, reason: 'malformed_json' });
  assert.deepEqual(parseEsp32JsonLine('{"temperature_c":25}'), { ok: false, reason: 'invalid_payload' });
});

test('assembles fragmented lines and ignores overlong lines until the next delimiter', () => {
  const decoder = new JsonLineDecoder(8);
  assert.deepEqual(decoder.push('{"x":').lines, []);
  const result = decoder.push('1}\r\n123456789x\n{"a":1}\n');
  assert.deepEqual(result.lines, ['{"x":1}', '{"a":1}']);
  assert.equal(result.discarded, 1);
});
