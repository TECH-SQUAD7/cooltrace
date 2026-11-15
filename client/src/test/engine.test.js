import { describe, it, expect } from 'vitest';
import { buildGrid, computeFeatures, pointInRing, cellIndex } from '../lib/features.js';
import { runModel, heatIndexC, surfaceExcess, EMPTY_MODS, buildScenarios } from '../lib/model.js';
import { getisOrdGiStar, clusterHotspots } from '../lib/hotspots.js';
import { optimise, manualPlan, INTERVENTIONS } from '../lib/optimizer.js';

const bbox = { south: 0, west: 0, north: 0.03, east: 0.03 };
function synthLC() {
  const buildings = [];
  // dense block in the lower-left quadrant
  for (let a = 0; a < 60; a++) for (let b = 0; b < 60; b++) buildings.push([0.0005 + a * 0.00022, 0.0005 + b * 0.00022, 4]);
  const park = [[0.02, 0.02], [0.02, 0.029], [0.029, 0.029], [0.029, 0.02], [0.02, 0.02]];
  const roads = [{ pts: [[0.015, 0], [0.015, 0.03]], w: 16 }];
  return { buildings, green: [{ ring: park, kind: 'park' }], water: [], waterLines: [], roads, trees: [] };
}
const grid = buildGrid(bbox, 12);
const features = computeFeatures(grid, synthLC());
const scenario = { airTemp: 40, rh: 30, radiationFactor: 1, wind: 5, offsets: null };

describe('geospatial processing', () => {
  it('point in polygon', () => {
    const sq = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    expect(pointInRing(0.5, 0.5, sq)).toBe(true);
    expect(pointInRing(1.5, 0.5, sq)).toBe(false);
  });
  it('maps coordinates to cells', () => {
    expect(cellIndex(grid, 0.0001, 0.0001)).toBe(0);
    expect(cellIndex(grid, 1, 1)).toBe(-1);
  });
  it('rasterises land cover into valid fractions', () => {
    for (const f of features) {
      const sum = f.roof + f.road + f.veg + f.water + f.other;
      expect(sum).toBeCloseTo(1, 5);
      expect(f.roof).toBeGreaterThanOrEqual(0);
    }
    const parkCell = features[cellIndex(grid, 0.025, 0.025)];
    const denseCell = features[cellIndex(grid, 0.005, 0.005)];
    expect(parkCell.veg).toBeGreaterThan(0.5);
    expect(denseCell.roof).toBeGreaterThan(0.15);
  });
});

describe('heat model', () => {
  const base = runModel(grid, features, scenario);
  it('dense built cells are hotter than parks', () => {
    const park = cellIndex(grid, 0.025, 0.025), dense = cellIndex(grid, 0.005, 0.005);
    expect(base.surface[dense]).toBeGreaterThan(base.surface[park] + 5);
    expect(base.air[dense]).toBeGreaterThan(base.air[park]);
  });
  it('heat index increases with humidity', () => {
    expect(heatIndexC(35, 70)).toBeGreaterThan(heatIndexC(35, 20));
    expect(heatIndexC(20, 90)).toBe(20);
  });
  it('cool roofs reduce surface excess', () => {
    const f = features[cellIndex(grid, 0.005, 0.005)];
    expect(surfaceExcess(f, { ...EMPTY_MODS, coolRoof: 1 })).toBeLessThan(surfaceExcess(f, EMPTY_MODS));
  });
  it('builds scenarios from weather payload', () => {
    const sc = buildScenarios({ samples: [], hourly: [], hottestYear: { tmax: 45, date: 'x', rh: 20, radiationSum: 25 } }, grid.cells);
    expect(sc.find((s) => s.id === 'year').airTemp).toBe(45);
  });
});

describe('hotspot detection', () => {
  it('Gi* finds a planted cluster', () => {
    const n = 10, vals = new Array(n * n).fill(30);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) vals[i * n + j] = 40;
    const z = getisOrdGiStar(n, vals, 1);
    expect(z[1 * n + 1]).toBeGreaterThan(2.58);
    expect(z[8 * n + 8]).toBeLessThan(1);
  });
  it('clusters hotspot zones on model output', () => {
    const base = runModel(grid, features, scenario);
    const z = getisOrdGiStar(grid.n, base.surface, 2);
    const zones = clusterHotspots(grid, z, base, features);
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0].meanSurface).toBeGreaterThan(base.stats.meanSurface);
  });
});

describe('budget optimiser', () => {
  const base = runModel(grid, features, scenario);
  const enabled = new Set(INTERVENTIONS.map((x) => x.id));
  it('never exceeds budget and improves felt temperature', () => {
    const plan = optimise({ grid, features, scenario, baseline: base, budget: 2_000_000, enabled, costs: null });
    expect(plan.total).toBeLessThanOrEqual(2_000_000 + 1);
    expect(plan.total).toBeGreaterThan(0);
    const after = runModel(grid, features, scenario, plan.mods, base.range);
    expect(after.stats.popWeightedFelt).toBeLessThan(base.stats.popWeightedFelt);
  });
  it('bigger budget gives at least as much cooling', () => {
    const small = optimise({ grid, features, scenario, baseline: base, budget: 300_000, enabled, costs: null });
    const big = optimise({ grid, features, scenario, baseline: base, budget: 3_000_000, enabled, costs: null });
    const a = runModel(grid, features, scenario, small.mods, base.range).stats.popWeightedFelt;
    const b = runModel(grid, features, scenario, big.mods, base.range).stats.popWeightedFelt;
    expect(b).toBeLessThanOrEqual(a);
  });
  it('respects disabled interventions', () => {
    const plan = optimise({ grid, features, scenario, baseline: base, budget: 1_000_000, enabled: new Set(['coolRoof']), costs: null });
    expect(plan.byType.every((t) => t.id === 'coolRoof')).toBe(true);
  });
  it('manual plan costs scale with coverage', () => {
    const lo = manualPlan({ grid, features, coverage: { coolRoof: 0.25 }, costs: null });
    const hi = manualPlan({ grid, features, coverage: { coolRoof: 1 }, costs: null });
    expect(hi.total).toBeGreaterThan(lo.total);
  });
});
