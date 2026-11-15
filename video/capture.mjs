// Records real COOLTRACE footage as timestamped JPEG frames via the Chrome
// DevTools screencast, with a drawn cursor, so the demo video can be edited
// frame-accurately. Usage: node capture.mjs [clipName ...]
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, nav, tilesSettled, sleep } from './lib.mjs';

const W = 1600, H = 1000;
const OUT = path.resolve('footage');

// Visible cursor + click ripple (headless screenshots have no OS cursor)
const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__ct_cursor')) return;
    const c = document.createElement('div');
    c.id = '__ct_cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.3 L11.6 24 L15 22.5 L11.7 15 L19 15 Z" fill="#15222c" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 2px 3px rgba(21,34,44,.35))' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX - 18 + 'px', top: e.clientY - 18 + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '2px solid #1f4fd1', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.3)', opacity: '1' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let mouse = { x: W / 2, y: H / 2 };

async function glide(page, x, y, ms = 700) {
  const from = { ...mouse };
  const start = Date.now();
  for (;;) {
    const p = Math.min(1, (Date.now() - start) / ms);
    const e = ease(p);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (p >= 1) break;
    await sleep(14);
  }
  mouse = { x, y };
}
async function centerOf(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function clickOn(page, locator, ms = 650) {
  const c = await centerOf(page, locator);
  await glide(page, c.x, c.y, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
async function smoothScroll(page, dy, ms = 900) {
  const steps = Math.round(ms / 16);
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const target = Math.round(dy * ease(i / steps));
    await page.mouse.wheel(0, target - done);
    done = target;
    await sleep(16);
  }
}

class Recorder {
  constructor(page, client) { this.page = page; this.client = client; this.frames = []; this.marks = {}; }
  async start() {
    this.marks = {};
    this.frames = [];
    this.client.on('Page.screencastFrame', this.onFrame = async ({ data, metadata, sessionId }) => {
      this.frames.push({ t: metadata.timestamp, data });
      await this.client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    // a tiny repaint keeps frames flowing even when the page is static
    this.keepalive = setInterval(() => this.page.evaluate(() => { document.documentElement.style.setProperty('--ct-tick', String(Math.random())); const c = document.getElementById('__ct_cursor'); if (c) c.style.opacity = c.style.opacity === '0.999' ? '1' : '0.999'; }).catch(() => {}), 33);
  }
  mark(name) { this.marks[name] = Date.now() / 1000 - this.t0; }
  async stop(name) {
    clearInterval(this.keepalive);
    await this.client.send('Page.stopScreencast');
    this.client.off('Page.screencastFrame', this.onFrame);
    const dir = path.join(OUT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const base = this.frames[0]?.t ?? this.t0;
    const index = this.frames.map((f, i) => {
      const file = `${String(i).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
      return { file, t: +(f.t - base).toFixed(4) };
    });
    const offset = base - this.t0; // align marks to the first frame
    const marks = Object.fromEntries(Object.entries(this.marks).map(([k, v]) => [k, +(v - offset).toFixed(3)]));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ width: W, height: H, frames: index, marks, duration: index.at(-1)?.t ?? 0 }, null, 1));
    console.log(`${name}: ${index.length} frames, ${(index.at(-1)?.t ?? 0).toFixed(1)}s, marks ${JSON.stringify(marks)}`);
  }
}

const CLIPS = {
  async heatmap(page, rec) {
    await nav(page, 'Heat map');
    await tilesSettled(page);
    await page.mouse.move(mouse.x, mouse.y);
    await rec.start();
    await sleep(400);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Felt' }));
    rec.mark('felt');
    await sleep(1900);
    const map = await page.locator('.leaflet-container').first().boundingBox();
    await glide(page, map.x + map.width * 0.42, map.y + map.height * 0.66, 900);
    await glide(page, map.x + map.width * 0.30, map.y + map.height * 0.45, 1100);
    await glide(page, map.x + map.width * 0.72, map.y + map.height * 0.55, 1300);
    rec.mark('hovered');
    await sleep(500);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Vulnerability' }));
    rec.mark('vuln');
    await sleep(1900);
    await glide(page, map.x + map.width * 0.48, map.y + map.height * 0.72, 900);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Surface' }));
    await sleep(2000);
    await rec.stop('heatmap');
  },
  async hotspots(page, rec) {
    await nav(page, 'Hotspots');
    await tilesSettled(page);
    await rec.start();
    await sleep(500);
    const zones = page.locator('button', { hasText: /^Zone [A-Z]/ });
    await clickOn(page, zones.nth(1));
    await sleep(900);
    await clickOn(page, zones.nth(0));
    rec.mark('zoneA');
    await sleep(700);
    await smoothScroll(page, 560, 1100);
    await sleep(300);
    const btn = page.locator('button', { hasText: /Explain with Gemini|Regenerate/ }).first();
    await clickOn(page, btn);
    rec.mark('aiClick');
    await page.waitForFunction(() => document.body.innerText.includes('Generated by'), null, { timeout: 120000 });
    rec.mark('aiDone');
    await sleep(900);
    await smoothScroll(page, 420, 1400);
    await sleep(1200);
    await smoothScroll(page, 420, 1400);
    await sleep(1200);
    await rec.stop('hotspots');
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  async optimiser(page, rec) {
    await nav(page, 'Budget');
    await sleep(2500);
    await tilesSettled(page);
    await rec.start();
    await sleep(500);
    const slider = page.locator('input[aria-label="Budget slider"]');
    const sb = await slider.boundingBox();
    const y = sb.y + sb.height / 2;
    const cur = await slider.evaluate((el) => (el.value - el.min) / (el.max - el.min));
    await glide(page, sb.x + sb.width * cur, y, 700);
    await page.mouse.down();
    await glide(page, sb.x + sb.width * 0.82, y, 1300);
    await page.mouse.up();
    rec.mark('budget');
    await sleep(400);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Max cooling' }));
    await sleep(300);
    await clickOn(page, page.locator('button', { hasText: 'Run optimisation' }));
    rec.mark('run');
    await sleep(2600);
    await glide(page, 1100, 330, 800);
    await sleep(1200);
    await smoothScroll(page, 520, 1300);
    rec.mark('map');
    await tilesSettled(page, 4000);
    await sleep(2200);
    await rec.stop('optimiser');
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  async simulator(page, rec) {
    await nav(page, 'Before and after');
    await tilesSettled(page);
    await rec.start();
    await sleep(600);
    const maps = page.locator('.leaflet-container');
    const a = await maps.nth(0).boundingBox();
    await glide(page, a.x + a.width * 0.5, a.y + a.height * 0.5, 800);
    await page.mouse.down();
    await glide(page, a.x + a.width * 0.38, a.y + a.height * 0.40, 1200);
    await page.mouse.up();
    rec.mark('panned');
    await sleep(400);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Cooling map' }));
    rec.mark('cooling');
    await sleep(2200);
    await clickOn(page, page.locator('button[role="radio"]', { hasText: 'Manual scenario' }));
    await sleep(500);
    const trees = page.locator('input[aria-label="Street trees coverage"]');
    const tb = await trees.boundingBox();
    await glide(page, tb.x + tb.width * 0.5, tb.y + tb.height / 2, 700);
    await page.mouse.down();
    await glide(page, tb.x + tb.width * 0.95, tb.y + tb.height / 2, 1200);
    await page.mouse.up();
    rec.mark('trees');
    await sleep(2000);
    await rec.stop('simulator');
  },
  async briefing(page, rec) {
    await nav(page, 'Briefing');
    await rec.start();
    await sleep(500);
    const btn = page.locator('button', { hasText: /Generate briefing|Regenerate/ }).first();
    await clickOn(page, btn);
    rec.mark('aiClick');
    await page.waitForFunction(() => document.body.innerText.includes('Generated by'), null, { timeout: 120000 });
    rec.mark('aiDone');
    await sleep(1500);
    await smoothScroll(page, 500, 1600);
    await sleep(1500);
    await rec.stop('briefing');
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
const { browser, context, page } = await launch({ width: W, height: H, scale: 1 });
await context.addInitScript(CURSOR_SCRIPT);
const client = await context.newCDPSession(page);
const rec = new Recorder(page, client);
try {
  await openApp(page, 'madrid');
  await page.evaluate(CURSOR_SCRIPT);
  await page.mouse.move(mouse.x, mouse.y);
  for (const name of wanted) await CLIPS[name](page, rec);
} finally {
  await browser.close();
}
