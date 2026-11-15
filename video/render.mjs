// Renders the COOLTRACE motion-graphic demo video frame by frame.
//   node render.mjs                 full render -> ../docs/cooltrace-demo.mp4
//   node render.mjs --preview 3,12  stills at those seconds -> preview/
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { launch } from './lib.mjs';
import { writeSoundtrack } from './audio.mjs';

const FPS = 30;
const TRANSITION = 0.75;
const args = process.argv.slice(2);
const previewArg = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;

// ------------------------------------------------------------ footage
const clip = (name) => {
  const j = JSON.parse(fs.readFileSync(`footage/${name}/index.json`, 'utf8'));
  j.urls = j.frames.map((f) => pathToFileURL(path.resolve('footage', name, f.file)).href);
  j.times = j.frames.map((f) => f.t);
  return j;
};
const frameAt = (c, t) => {
  let lo = 0, hi = c.times.length - 1;
  if (t <= c.times[0]) return c.urls[0];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.times[mid] <= t) lo = mid; else hi = mid - 1; }
  return c.urls[lo];
};

const C = Object.fromEntries(['heatmap', 'hotspots', 'optimiser', 'simulator', 'briefing'].map((n) => [n, clip(n)]));
const hm = C.hotspots.marks, bm = C.briefing.marks, om = C.optimiser.marks, sm = C.simulator.marks;

// ------------------------------------------------------------ edit decision list
const FEATURES = [
  {
    id: 'heatmap', short: 'Heat map', clip: 'heatmap',
    title: ['A heat map', 'of any city'],
    body: ['Open-Meteo weather and', 'OpenStreetMap land cover', 'become a 125 m heat model', 'that runs in the browser.'],
    metric: ['784', 'cells modelled for every scenario'],
    spans: [[3.0, 14.6, 1.1]],
    cam: [[3.0, 800, 520, 1.0], [5.5, 740, 600, 1.22], [12.0, 740, 600, 1.22], [14.6, 780, 560, 1.08]],
  },
  {
    id: 'hotspots', short: 'Hotspots', clip: 'hotspots',
    title: ['Hotspots that', 'pass a real test'],
    body: ['Getis-Ord Gi* separates', 'significant clusters from', 'noise. Gemini explains each', 'one using the model’s numbers.'],
    metric: ['Gi* ≥ 1.96', '95% confidence, computed locally'],
    spans: [[2.6, hm.aiClick + 0.8, 1.2], [hm.aiDone - 0.25, hm.aiDone + 8.5, 1.15]],
    cam: [[2.6, 640, 520, 1.06], [hm.aiClick - 1.2, 900, 560, 1.06], [hm.aiClick + 0.8, 1120, 520, 1.15],
      [hm.aiDone - 0.25, 1130, 420, 1.42], [hm.aiDone + 8.5, 1130, 560, 1.42]],
    chip: 'Live Gemini response, wait time shortened', chipFrom: 1,
  },
  {
    id: 'optimiser', short: 'Budget', clip: 'optimiser',
    title: ['Spend where it', 'cools the most people'],
    body: ['Every cell and six', 'interventions are weighed', 'against your budget, then', 'cooling is plotted against cost.'],
    metric: ['6 measures', 'trees, cool and green roofs, paving, parks, shade'],
    spans: [[0.3, 19.6, 1.6]],
    cam: [[0.3, 800, 500, 1.0], [om.budget - 1.5, 470, 330, 1.32], [om.run - 0.2, 470, 420, 1.25], [om.run + 1.6, 1120, 330, 1.3], [om.map - 1.5, 1120, 360, 1.2], [19.6, 800, 640, 1.04]],
  },
  {
    id: 'simulator', short: 'Before and after', clip: 'simulator',
    title: ['See the effect', 'before you build'],
    body: ['Synced before and after', 'maps, a cooling map and', 'an outcome table for surface,', 'air and felt temperature.'],
    metric: ['3 measures', 'surface, air and felt temperature'],
    spans: [[0.3, 12.6, 1.1]],
    cam: [[0.3, 1090, 520, 1.1], [sm.cooling, 1090, 500, 1.2], [sm.trees - 2.2, 900, 480, 1.05], [12.6, 820, 500, 1.0]],
  },
  {
    id: 'briefing', short: 'Briefing', clip: 'briefing',
    title: ['A briefing for', 'the resilience office'],
    body: ['Gemini writes findings,', 'vulnerable groups and a heat', 'action plan, grounded in', 'the local statistics.'],
    metric: ['JSON-mode', 'structured output, validated server-side'],
    spans: [[0.2, bm.aiClick + 0.7, 1], [bm.aiDone - 0.2, 24.4, 1.2]],
    cam: [[0.2, 800, 450, 1.0], [bm.aiClick + 0.7, 900, 300, 1.15], [bm.aiDone - 0.2, 950, 400, 1.3], [24.4, 950, 560, 1.3]],
    chip: 'Live Gemini response, wait time shortened', chipFrom: 1,
  },
];

const spanDur = (spans) => spans.reduce((s, [a, b, r]) => s + (b - a) / r, 0);
const SCENES = [
  { kind: 'intro', id: 'intro', dur: 6.0 },
  { kind: 'statement', id: 'statement', dur: 5.4 },
  ...FEATURES.map((f, index) => ({ kind: 'feature', id: f.id, f, index, dur: spanDur(f.spans) })),
  { kind: 'arch', id: 'arch', dur: 6.8 },
  { kind: 'outro', id: 'outro', dur: 6.2 },
];
let acc = 0;
for (const s of SCENES) { s.start = acc; acc += s.dur; }
const TOTAL = acc;

/** Scene-local time -> clip time, plus which span we are in. */
function clipTime(f, lt) {
  let used = 0;
  for (let i = 0; i < f.spans.length; i++) {
    const [a, b, r] = f.spans[i]; const d = (b - a) / r;
    if (lt <= used + d || i === f.spans.length - 1) return { t: a + Math.min(d, Math.max(0, lt - used)) * r, span: i, since: lt - used };
    used += d;
  }
}
const inOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function camAt(f, ct) {
  const k = f.cam;
  if (ct <= k[0][0]) return { cx: k[0][1], cy: k[0][2], s: k[0][3] };
  for (let i = 1; i < k.length; i++) {
    if (ct <= k[i][0]) {
      const p = inOut((ct - k[i - 1][0]) / (k[i][0] - k[i - 1][0] || 1));
      return { cx: k[i - 1][1] + (k[i][1] - k[i - 1][1]) * p, cy: k[i - 1][2] + (k[i][2] - k[i - 1][2]) * p, s: k[i - 1][3] + (k[i][3] - k[i - 1][3]) * p };
    }
  }
  const l = k.at(-1); return { cx: l[1], cy: l[2], s: l[3] };
}

function layerFor(scene, lt) {
  const L = { kind: scene.kind, id: scene.id, lt };
  if (scene.kind !== 'feature') return L;
  const f = scene.f, c = C[f.clip];
  const { t, span, since } = clipTime(f, lt);
  Object.assign(L, { src: frameAt(c, t), cam: camAt(f, t), index: scene.index, progress: lt / scene.dur, chip: f.chip || null });
  L.chipOpacity = f.chip && span >= (f.chipFrom ?? 0) ? Math.min(1, since / 0.35) : 0;
  if (span > 0 && since < 0.25) { // crossfade across the jump cut
    const [, pb] = f.spans[span - 1];
    L.src2 = frameAt(c, pb); L.mix = 1 - since / 0.25;
    // hold the camera from the previous span during the dissolve
  }
  return L;
}

function stateAt(T) {
  const i = Math.max(0, SCENES.findIndex((s) => T >= s.start && T < s.start + s.dur));
  const s = SCENES[i === -1 ? SCENES.length - 1 : i];
  const lt = T - s.start;
  const top = layerFor(s, lt);
  if (lt < TRANSITION && SCENES.indexOf(s) > 0) {
    const prev = SCENES[SCENES.indexOf(s) - 1];
    top.reveal = inOut(lt / TRANSITION);
    return { layers: [layerFor(prev, prev.dur - 0.001), top] };
  }
  return { layers: [top] };
}

// ------------------------------------------------------------ intro data
const grid = JSON.parse(fs.readFileSync('data/grid.json', 'utf8'));
const n = grid.n;
const idx = grid.surface.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]);
const hot = idx[0][1], warm = idx[Math.floor(idx.length * 0.15)][1], cool = idx.at(-1)[1];
const ij = (k) => [Math.floor(k / n), k % n];
const introPath = [ij(cool), ij(warm), ij(hot), ij(hot)];

const setupData = {
  grid: { n, surface: grid.surface, min: grid.min, max: grid.max, airTemp: grid.airTemp },
  introPath,
  features: FEATURES.map(({ id, short, title, body, metric, chip }) => ({ id, short, title, body, metric, chip })),
};

// ------------------------------------------------------------ render
const { browser, page } = await launch({ width: 1920, height: 1080, scale: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(pathToFileURL(path.resolve('comp.html')).href, { waitUntil: 'networkidle' });
await page.evaluate((d) => window.setup(d), setupData);
console.log(`Timeline: ${TOTAL.toFixed(2)} s, ${Math.round(TOTAL * FPS)} frames`);
fs.writeFileSync('data/timeline.json', JSON.stringify(SCENES.map(({ kind, id, start, dur }) => ({ kind, id, start, dur })), null, 1));

try {
  if (previewArg) {
    fs.mkdirSync('preview', { recursive: true });
    for (const t of previewArg.split(',').map(Number)) {
      await page.evaluate((s) => window.renderFrame(s), stateAt(t));
      await page.screenshot({ path: `preview/t${String(t).replace('.', '_')}.jpg`, type: 'jpeg', quality: 90 });
    }
    console.log('Preview stills written to preview/');
  } else {
    const dir = path.resolve('frames');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const total = Math.round(TOTAL * FPS);
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      await page.evaluate((s) => window.renderFrame(s), stateAt(f / FPS));
      await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
      if (f % 150 === 0) console.log(`frame ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    await browser.close();
    const wav = path.resolve('data/soundtrack.wav');
    writeSoundtrack(wav, TOTAL, SCENES.map((s) => s.start));
    const out = path.resolve('../docs/cooltrace-demo.mp4');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(ffmpeg, [
      '-y', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-i', wav,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out,
    ], { stdio: 'inherit' });
    console.log('Wrote', out);
  }
} finally {
  await browser.close().catch(() => {});
}
