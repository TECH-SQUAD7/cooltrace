// Computes the real Madrid surface-temperature grid with the COOLTRACE engine
// (from the server's cached OSM + Open-Meteo data) for the video intro.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('..');
const lib = (f) => import(pathToFileURL(path.join(root, 'client/src/lib', f)).href);
const { buildGrid, computeFeatures } = await lib('features.js');
const { runModel, buildScenarios } = await lib('model.js');
const { makeBBox } = await import(pathToFileURL(path.join(root, 'server/src/data.js')).href);

const bbox = makeBBox(40.4168, -3.7038, 1.75);
const cache = path.join(root, 'server/data/cache');
const osm = JSON.parse(fs.readFileSync(path.join(cache, `osm_${bbox.south}_${bbox.west}_${bbox.north}_${bbox.east}`.replace(/[^\w-]/g, '_') + '.json')));
const wx = JSON.parse(fs.readFileSync(path.join(cache, `wx_${bbox.south}_${bbox.west}`.replace(/[^\w-]/g, '_') + '.json')));
const grid = buildGrid(bbox);
const features = computeFeatures(grid, osm);
const sc = buildScenarios(wx, grid.cells).find((s) => s.id === 'year');
const r = runModel(grid, features, sc);
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/grid.json', JSON.stringify({
  n: grid.n,
  surface: Array.from(r.surface, (v) => +v.toFixed(2)),
  min: Math.min(...r.surface), max: Math.max(...r.surface),
  airTemp: sc.airTemp, date: wx.hottestYear?.date, stats: r.stats,
  counts: osm.counts,
}));
console.log('grid ok', sc.airTemp, wx.hottestYear?.date, r.stats.maxSurface, osm.counts);
