import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateJSON, isConfigured, modelCandidates, AIError } from './gemini.js';
import { SYSTEM, hotspotPrompt, insightsPrompt, planReviewPrompt, askPrompt } from './prompts.js';
import { makeBBox, geocode, getWeather, getLandcover, syntheticWeather, syntheticLandcover } from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PRESET_CITIES = [
  { id: 'delhi', name: 'New Delhi', country: 'India', lat: 28.6328, lon: 77.2197 },
  { id: 'ahmedabad', name: 'Ahmedabad', country: 'India', lat: 23.0258, lon: 72.5873 },
  { id: 'phoenix', name: 'Phoenix', country: 'United States', lat: 33.4484, lon: -112.074 },
  { id: 'madrid', name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  { id: 'dubai', name: 'Dubai', country: 'UAE', lat: 25.2631, lon: 55.2972 },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357 },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.2868, lon: 103.8545 },
  { id: 'paris', name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522 },
];

// Simple fixed-window rate limiter (per IP) to protect the Gemini quota.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'anon';
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many AI requests. Please wait a moment.', code: 'RATE_LIMIT' });
    }
    next();
  };
}

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '300kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, ai: { provider: 'gemini', configured: isConfigured(), models: modelCandidates() }, time: new Date().toISOString() });
  });

  app.get('/api/cities', (req, res) => res.json({ cities: PRESET_CITIES }));

  app.get('/api/geocode', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || q.length > 100) return res.status(400).json({ error: 'Query must be 2-100 characters.' });
    try {
      res.json({ results: await geocode(q) });
    } catch (e) {
      res.status(502).json({ error: `City search unavailable: ${e.message}` });
    }
  });

  app.get('/api/environment', async (req, res) => {
    const lat = num(req.query.lat, -85, 85);
    const lon = num(req.query.lon, -180, 180);
    const halfKm = num(req.query.halfKm ?? 1.75, 0.5, 3) ?? 1.75;
    if (lat == null || lon == null) return res.status(400).json({ error: 'Valid lat and lon are required.' });
    const bbox = makeBBox(lat, lon, halfKm);
    const forceSynthetic = req.query.synthetic === '1';

    const [wx, lc] = await Promise.allSettled([
      forceSynthetic ? Promise.resolve(syntheticWeather(bbox)) : getWeather(bbox),
      forceSynthetic ? Promise.resolve(null) : getLandcover(bbox),
    ]);
    let weather = wx.status === 'fulfilled' ? wx.value : { ...syntheticWeather(bbox), fallbackReason: wx.reason?.message };
    let landcover = lc.status === 'fulfilled' && lc.value ? lc.value : null;
    if (!landcover) {
      landcover = { ...syntheticLandcover(bbox), fallbackReason: forceSynthetic ? 'Synthetic mode requested' : lc.reason?.message };
    }
    res.json({
      bbox,
      center: { lat, lon },
      weather,
      landcover,
      provenance: {
        weather: { source: weather.source, label: weather.sourceLabel, fallbackReason: weather.fallbackReason },
        landcover: { source: landcover.source, label: landcover.sourceLabel, fallbackReason: landcover.fallbackReason, osmTimestamp: landcover.osmTimestamp },
        population: { source: 'proxy', label: 'Population exposure estimated from OSM building density x floors (proxy, not census)' },
        surfaceTemperature: { source: 'model', label: 'Surface/air temperatures are modelled locally from weather + land cover (not satellite LST)' },
      },
    });
  });

  // ---------------------------------------------------------------- AI routes
  const ai = express.Router();
  ai.use(rateLimit({ windowMs: 60_000, max: 20 }));

  const handle = (builder, validate) => async (req, res) => {
    const body = req.body || {};
    const problem = validate(body);
    if (problem) return res.status(400).json({ error: problem, code: 'BAD_REQUEST' });
    try {
      const { model, result } = await generateJSON(SYSTEM, builder(body));
      res.json({ model, result, generatedAt: new Date().toISOString() });
    } catch (e) {
      const status = e instanceof AIError ? e.status : 500;
      console.warn('[ai]', e.code || '', e.message);
      res.status(status).json({ error: e.message, code: e.code || 'AI_ERROR' });
    }
  };
  const needCity = (b) => (typeof b.city === 'string' && b.city.length > 0 && b.city.length < 120 ? null : 'city is required');

  ai.post('/hotspot', handle(hotspotPrompt, (b) => needCity(b) || (b.hotspot && typeof b.hotspot === 'object' ? null : 'hotspot object is required')));
  ai.post('/insights', handle(insightsPrompt, (b) => needCity(b) || (b.cityStats ? null : 'cityStats is required')));
  ai.post('/plan-review', handle(planReviewPrompt, (b) => needCity(b) || (b.plan && b.results ? null : 'plan and results are required')));
  ai.post('/ask', handle(askPrompt, (b) => needCity(b) || (typeof b.question === 'string' && b.question.trim().length > 2 && b.question.length <= 1000 ? null : 'question must be 3-1000 characters')));
  app.use('/api/ai', ai);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built frontend in production
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
