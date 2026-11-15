// Capture README / submission screenshots of every section.
// Usage: node shots.mjs [outDir]   (app must be running on APP_URL, default http://localhost:8787)
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, nav, tilesSettled, clickAI } from './lib.mjs';

const out = path.resolve(process.argv[2] || '../docs/screenshots');
fs.mkdirSync(out, { recursive: true });
const withAI = !process.argv.includes('--no-ai');

const { browser, page } = await launch({ width: 1440, height: 900, scale: 1.5 });
try {
  await openApp(page, 'madrid');
  await tilesSettled(page);
  await page.waitForTimeout(2000); // let the reveal animation finish
  const map = page.locator('.leaflet-container').first();
  const box = await map.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.62);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/01-heatmap.png` });

  await nav(page, 'Hotspots');
  await tilesSettled(page);
  if (withAI) await clickAI(page, 'Explain with Gemini').catch((e) => console.warn('AI hotspot:', e.message));
  await page.screenshot({ path: `${out}/02-hotspots.png`, fullPage: true });

  await nav(page, 'Briefing');
  if (withAI) await clickAI(page, 'Generate briefing').catch((e) => console.warn('AI briefing:', e.message));
  await page.screenshot({ path: `${out}/03-briefing.png`, fullPage: true });

  await nav(page, 'Budget');
  await page.waitForTimeout(2500);
  await tilesSettled(page);
  await page.screenshot({ path: `${out}/04-optimiser.png`, fullPage: true });

  await nav(page, 'Before and after');
  await tilesSettled(page);
  await page.screenshot({ path: `${out}/05-before-after.png` });

  await nav(page, 'Data and methods');
  await page.screenshot({ path: `${out}/06-methods.png`, fullPage: true });
  console.log('Saved screenshots to', out);
} finally {
  await browser.close();
}
