const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    actions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['title', 'reason'] } },
    sources: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING', enum: ['observation', 'weather', 'sensor', 'price', 'field', 'advisory'] }, reference: { type: 'STRING' } }, required: ['type', 'reference'] } },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }, needs_verification: { type: 'BOOLEAN' },
  }, required: ['answer', 'actions', 'sources', 'confidence', 'needs_verification'],
};
const ALLOWED_SOURCE_TYPES = new Set(['observation', 'weather', 'sensor', 'price', 'field', 'advisory']);

export default async function handler(request) {
  return handleKisanMitraRequest(request, { env: process.env, fetcher: fetch });
}

export async function handleKisanMitraRequest(request, { env = {}, fetcher = fetch } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST to ask KisanMitra.' });
  const authorization = request.headers.get('authorization');
  if (authorization && !await validateSupabaseSession(authorization, env, fetcher)) return reply(401, { error: 'Your account session could not be verified. Sign in again or try without an account.' });
  const key = env.GEMINI_API_KEY;
  if (!key) return reply(503, { error: 'KisanMitra is not configured yet.' });
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 32_000) return reply(413, { error: 'This farm question contains too much information.' });
    input = JSON.parse(raw);
  } catch { return reply(400, { error: 'The question could not be read.' }); }
  if (!input || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1000 || !input.context || typeof input.context !== 'object') return reply(400, { error: 'Add a short question about your farm.' });
  const language = input.context.language === 'hi' ? 'hi' : 'en';
  const context = sanitizeContext(input.context);
  try {
    const result = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL || 'gemini-3.8-flash')}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(language) }] },
        contents: [{ role: 'user', parts: [{ text: `Question: ${input.question.trim()}\n\nStructured PRITHVI information (the only farm evidence you may use):\n${JSON.stringify({ ...context, references: [...context.references] })}` }] }],
        generationConfig: { responseFormat: { text: { mimeType: 'application/json', schema: RESPONSE_SCHEMA } }, temperature: 0.2, maxOutputTokens: 900 },
      }),
    });
    if (!result.ok) return reply(result.status === 429 ? 429 : 502, { error: result.status === 429 ? 'KisanMitra is busy. Please try again later.' : 'KisanMitra could not answer right now.' });
    const payload = await result.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? '').join('');
    const parsed = validateModelResponse(JSON.parse(text));
    const allowedReferences = context.references;
    const safe = {
      answer: parsed.answer.slice(0, 2400),
      actions: parsed.actions.slice(0, 3).map(({ title, reason }) => ({ title: title.slice(0, 120), reason: reason.slice(0, 240) })),
      sources: parsed.sources.filter((source) => ALLOWED_SOURCE_TYPES.has(source.type) && allowedReferences.has(source.reference)).slice(0, 10),
      confidence: parsed.confidence,
      needs_verification: true,
    };
    if (!safe.answer.trim() || containsUnsupportedPrescription(safe)) return reply(502, { error: 'KisanMitra returned guidance that could not be safely checked. Please try a different question.' });
    return reply(200, safe);
  } catch {
    return reply(502, { error: 'KisanMitra could not provide a checked response. Your local farm data remains available.' });
  }
}

async function validateSupabaseSession(authorization, env, fetcher) {
  if (!/^Bearer\s+\S+$/i.test(authorization) || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const response = await fetcher(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.SUPABASE_ANON_KEY } });
    return response.ok;
  } catch { return false; }
}

function sanitizeContext(value) {
  const refs = new Set();
  const farm = value.farm && typeof value.farm === 'object' ? { id: short(value.farm.id, 80), name: short(value.farm.name, 100), location: short(value.farm.location, 100) } : undefined;
  const field = value.field && typeof value.field === 'object' ? { id: short(value.field.id, 80), name: short(value.field.name, 100), crop: short(value.field.crop, 60), variety: short(value.field.variety, 60), growthStage: short(value.field.growthStage, 60) } : undefined;
  if (field?.id) refs.add(`field:${field.id}`);
  const observations = rows(value.recentObservations, 12).flatMap((row) => {
    if (!row || typeof row.id !== 'string' || typeof row.timestamp !== 'string') return [];
    refs.add(`observation:${row.id}`);
    return [{ id: short(row.id, 80), timestamp: short(row.timestamp, 40), crop: short(row.crop, 60), condition: short(row.condition, 100), status: short(row.status, 30), confidence: unitFloat(row.confidence), source: short(row.source, 30) }];
  });
  const evidence = rows(value.scoutingEvidence, 10).flatMap((row) => { if (!row || typeof row.id !== 'string') return []; return [{ id: short(row.id, 80), observationCount: boundedInteger(row.observationCount, 0, 100), crop: short(row.crop, 60), condition: short(row.condition, 100), evidenceLevel: short(row.evidenceLevel, 30), status: short(row.status, 30) }]; });
  const advisories = rows(value.activeAdvisories, 10).flatMap((row) => { if (!row || typeof row.id !== 'string') return []; refs.add(`advisory:${row.id}`); return [{ id: short(row.id, 80), category: short(row.category, 40), title: short(row.title, 120), message: short(row.message, 240), action: short(row.action, 160), priority: short(row.priority, 20) }]; });
  const alerts = rows(value.activeAlerts, 10).flatMap((row) => { if (!row || typeof row.id !== 'string') return []; return [{ id: short(row.id, 80), type: short(row.type, 30), title: short(row.title, 100), message: short(row.message, 200), priority: short(row.priority, 20) }]; });
  const sensorReadings = rows(value.sensorReadings, 8).flatMap((row) => { if (!row || typeof row.kind !== 'string' || typeof row.value !== 'number' || !Number.isFinite(row.value)) return []; refs.add(`sensor:${row.kind}`); return [{ kind: short(row.kind, 30), value: row.value, unit: short(row.unit, 30), observedAt: short(row.observedAt, 40), quality: short(row.quality, 20) }]; });
  const weather = value.weather && typeof value.weather === 'object' ? {
    fetchedAt: short(value.weather.fetchedAt, 40), current: sanitizeWeatherCurrent(value.weather.current),
    nextDays: rows(value.weather.nextDays, 5).map((day) => ({ date: short(day?.date, 20), minC: finiteOrNull(day?.minC), maxC: finiteOrNull(day?.maxC), precipitationProbability: finiteOrNull(day?.precipitationProbability), precipitationMm: finiteOrNull(day?.precipitationMm), condition: short(day?.condition, 30) })),
  } : undefined;
  if (weather && field?.id) refs.add(`weather:${field.id}`);
  const recentCropPrices = rows(value.recentCropPrices, 5).flatMap((row) => { if (!row || typeof row.id !== 'string' || typeof row.value !== 'number' || !Number.isFinite(row.value)) return []; refs.add(`price:${row.id}`); return [{ id: short(row.id, 80), crop: short(row.crop, 60), market: short(row.market, 80), value: row.value, unit: short(row.unit, 30), observedAt: short(row.observedAt, 40) }]; });
  return { farm, field, recentObservations: observations, scoutingEvidence: evidence, activeAdvisories: advisories, activeAlerts: alerts, sensorReadings, weather, recentCropPrices, language: value.language === 'hi' ? 'hi' : 'en', references: refs };
}

function sanitizeWeatherCurrent(value) {
  if (!value || typeof value !== 'object') return undefined;
  return { temperatureC: finiteOrNull(value.temperatureC), apparentC: finiteOrNull(value.apparentC), humidityPct: finiteOrNull(value.humidityPct), precipitationMm: finiteOrNull(value.precipitationMm), condition: short(value.condition, 30), windKmh: finiteOrNull(value.windKmh), windDirectionDegrees: finiteOrNull(value.windDirectionDegrees) };
}
function validateModelResponse(value) {
  if (!value || typeof value !== 'object' || typeof value.answer !== 'string' || !Array.isArray(value.actions) || !Array.isArray(value.sources) || !['high', 'medium', 'low'].includes(value.confidence)) throw new Error('Invalid model response.');
  const actions = value.actions.map((row) => { if (!row || typeof row.title !== 'string' || typeof row.reason !== 'string') throw new Error('Invalid model response.'); return { title: row.title, reason: row.reason }; });
  const sources = value.sources.map((row) => { if (!row || typeof row.type !== 'string' || typeof row.reference !== 'string') throw new Error('Invalid model response.'); return { type: row.type, reference: row.reference }; });
  return { answer: value.answer, actions, sources, confidence: value.confidence };
}
function systemPrompt(language) {
  const locale = language === 'hi' ? 'Hindi' : 'English';
  return `You are KisanMitra, PRITHVI's cautious farm information assistant. Reply in ${locale}. Use only the supplied structured PRITHVI information. If a value is absent, say it is unavailable; never invent observations, sensor readings, weather, crop prices, field history, or image content. Explain recorded observations as observations, not confirmed disease. Do not diagnose, prescribe or recommend pesticides, fertilizer, chemicals, or treatment; do not command irrigation or aircraft. Suggest only safe checking, inspection, or monitoring steps. Make uncertainty clear. Mention whether evidence is missing or stale. Return only the requested JSON. Set needs_verification true. A farmer makes the final decision.`;
}
function containsUnsupportedPrescription(value) { return /\b(apply|spray|use|mix|dose|treat|treatment)\b.{0,60}\b(pesticide|fungicide|insecticide|fertili[sz]er|chemical|herbicide|crop|disease)\b|\b(irrigate|water)\s+(now|immediately|right away)\b|\b(disease|infection)\s+confirmed\b/i.test(`${value.answer} ${value.actions.map((item) => `${item.title} ${item.reason}`).join(' ')}`); }
function rows(value, limit) { return Array.isArray(value) ? value.slice(0, limit) : []; }
function short(value, max) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : undefined; }
function finiteOrNull(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function unitFloat(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined; }
function boundedInteger(value, min, max) { return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : 0; }
