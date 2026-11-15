import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseJSONLoose } from '../src/gemini.js';
import { classifyOSM, makeBBox, syntheticLandcover } from '../src/data.js';

let server, base;
const savedKey = process.env.GEMINI_API_KEY;

before(async () => {
  delete process.env.GEMINI_API_KEY; // tests must never hit the real API
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  if (savedKey) process.env.GEMINI_API_KEY = savedKey;
});

test('health reports AI not configured without key', async () => {
  const r = await fetch(`${base}/api/health`).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.equal(r.ai.configured, false);
});

test('AI endpoint returns 503 with clear message when key missing', async () => {
  const res = await fetch(`${base}/api/ai/hotspot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'Test', hotspot: { id: 1 } }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'AI_NOT_CONFIGURED');
  assert.match(body.error, /GEMINI_API_KEY/);
});

test('AI endpoint validates input', async () => {
  const res = await fetch(`${base}/api/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'X', question: '' }),
  });
  assert.equal(res.status, 400);
});

test('environment endpoint rejects bad coordinates', async () => {
  const res = await fetch(`${base}/api/environment?lat=abc&lon=1`);
  assert.equal(res.status, 400);
});

test('environment synthetic mode is clearly labelled', async () => {
  const r = await fetch(`${base}/api/environment?lat=28.6&lon=77.2&synthetic=1`).then((x) => x.json());
  assert.equal(r.landcover.source, 'synthetic');
  assert.equal(r.weather.source, 'synthetic');
  assert.match(r.provenance.landcover.label, /SYNTHETIC/);
  assert.ok(r.landcover.buildings.length > 100);
});

test('parseJSONLoose handles fenced JSON', () => {
  assert.deepEqual(parseJSONLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJSONLoose('Here: {"b":[1,2]} done'), { b: [1, 2] });
});

test('classifyOSM sorts features into layers', () => {
  const out = classifyOSM([
    { type: 'way', tags: { building: 'yes', 'building:levels': '4' }, center: { lat: 1, lon: 2 } },
    { type: 'way', tags: { leisure: 'park' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }] },
    { type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] },
    { type: 'node', tags: { natural: 'tree' }, lat: 0.5, lon: 0.5 },
  ]);
  assert.equal(out.buildings.length, 1);
  assert.equal(out.buildings[0][2], 4);
  assert.equal(out.green.length, 1);
  assert.equal(out.roads[0].w, 16);
  assert.equal(out.trees.length, 1);
});

test('bbox is ~3.5 km square', () => {
  const b = makeBBox(0, 0, 1.75);
  assert.ok(Math.abs((b.north - b.south) * 110.574 - 3.5) < 0.01);
  assert.ok(syntheticLandcover(b).green.length > 0);
});
