// Intervention catalogue and local budget optimiser (greedy marginal benefit/cost
// knapsack with per-cell diminishing returns). Runs entirely in the browser.
import { cellFelt, EMPTY_MODS } from './model.js';

// Indicative unit costs in USD (capital + ~3 years establishment). Editable in the UI.
export const INTERVENTIONS = [
  {
    id: 'trees', name: 'Street trees', color: '#1d7a4c', unit: 'tree', unitCost: 900, perLevel: 30,
    desc: '30 shade trees per cell step (~50 m2 mature canopy each)',
    maxLevel: (f, A) => {
      const add = (30 * 50) / A;
      const room = Math.min(0.6, f.road + f.other + f.veg) - f.canopy;
      return Math.max(0, Math.min(4, Math.floor(room / add)));
    },
    apply: (m, f, A, lv) => { m.addCanopy += (lv * 30 * 50) / A; },
    units: (f, A, lv) => lv * 30,
  },
  {
    id: 'coolRoof', name: 'Cool roofs', color: '#6ea8d9', unit: 'm2', unitCost: 25, desc: 'Reflective coating on 25% of roof area per step (albedo 0.15 -> 0.65)',
    maxLevel: (f) => (f.roof >= 0.05 ? 4 : 0),
    apply: (m, f, A, lv) => { m.coolRoof = Math.min(1 - m.greenRoof, m.coolRoof + 0.25 * lv); },
    units: (f, A, lv) => 0.25 * lv * f.roof * A,
  },
  {
    id: 'greenRoof', name: 'Green roofs', color: '#8fb04a', unit: 'm2', unitCost: 160, desc: 'Extensive green roof on 10% of roof area per step',
    maxLevel: (f) => (f.roof >= 0.1 ? 3 : 0),
    apply: (m, f, A, lv) => { m.greenRoof = Math.min(1, m.greenRoof + 0.1 * lv); m.coolRoof = Math.min(m.coolRoof, 1 - m.greenRoof); },
    units: (f, A, lv) => 0.1 * lv * f.roof * A,
  },
  {
    id: 'coolPave', name: 'Cool pavements', color: '#8d7bd1', unit: 'm2', unitCost: 30, desc: 'High-albedo coating on 25% of road area per step (0.12 -> 0.35)',
    maxLevel: (f) => (f.road >= 0.04 ? 4 : 0),
    apply: (m, f, A, lv) => { m.coolPave = Math.min(1, m.coolPave + 0.25 * lv); },
    units: (f, A, lv) => 0.25 * lv * f.road * A,
  },
  {
    id: 'pocketPark', name: 'Pocket parks', color: '#3e9b74', unit: 'm2', unitCost: 220, desc: 'Convert 600 m2 of paved space to planted park per step',
    maxLevel: (f, A) => Math.max(0, Math.min(2, Math.floor(((f.other * f.pavedShare + f.road * 0.15) * A) / 600))),
    apply: (m, f, A, lv) => { m.addVeg += (lv * 600) / A; },
    units: (f, A, lv) => lv * 600,
  },
  {
    id: 'shade', name: 'Shade structures', color: '#c9932e', unit: 'm2', unitCost: 150, desc: '300 m2 of shade sails / canopies at stops & walkways per step',
    maxLevel: (f) => (f.population > 20 && f.road + f.other > 0.15 ? 2 : 0),
    apply: (m, f, A, lv) => { m.shade += (lv * 300) / A; },
    units: (f, A, lv) => lv * 300,
  },
];
export const INTERVENTION_BY_ID = Object.fromEntries(INTERVENTIONS.map((x) => [x.id, x]));

export function defaultCosts() {
  return Object.fromEntries(INTERVENTIONS.map((x) => [x.id, x.unitCost]));
}

export function modsForCell(levelsForCell, f, A) {
  const m = { ...EMPTY_MODS };
  // fixed order so roof shares are resolved consistently
  for (const iv of INTERVENTIONS) {
    const lv = levelsForCell?.[iv.id] || 0;
    if (lv > 0) iv.apply(m, f, A, lv);
  }
  return m;
}

export function modsFromLevels(levels, features, A) {
  return features.map((f, k) => modsForCell(levels[k], f, A));
}

export function costOf(id, f, A, lv, costs) {
  return INTERVENTION_BY_ID[id].units(f, A, lv) * (costs?.[id] ?? INTERVENTION_BY_ID[id].unitCost);
}

/** Per-cell weights for each optimisation strategy. */
export function strategyWeights(strategy, features, baseline, hotspotCells) {
  const meanPop = features.reduce((s, f) => s + f.population, 0) / features.length || 1;
  const floor = 0.05 * meanPop; // even empty cells (parks, roads) carry some public exposure
  return features.map((f, k) => {
    const people = f.population + floor;
    if (strategy === 'equity') return people * (1 + baseline.hvi[k] / 50) ** 2;
    if (strategy === 'hotspots') return hotspotCells.has(k) ? people : 0;
    return people;
  });
}

/**
 * Greedy budget optimiser.
 * @param {object} p
 * @param {number} p.budget USD
 * @param {string} p.strategy 'cooling' | 'equity' | 'hotspots'
 * @param {Set<string>} p.enabled intervention ids
 * @param {object} p.costs unit cost overrides
 */
export function optimise({ grid, features, scenario, baseline, budget, strategy = 'cooling', enabled, costs, hotspotCells = new Set() }) {
  const A = grid.cellArea;
  const N = features.length;
  const offsets = scenario.offsets || new Array(N).fill(0);
  const weights = strategyWeights(strategy, features, baseline, hotspotCells);
  const ivs = INTERVENTIONS.filter((x) => enabled.has(x.id));
  const levels = features.map(() => ({}));
  const maxLv = features.map((f) => Object.fromEntries(ivs.map((iv) => [iv.id, iv.maxLevel(f, A)])));
  const curFelt = features.map((f, k) => cellFelt(f, EMPTY_MODS, scenario, offsets[k]));

  // candidate table: best next step for every (cell, intervention)
  const cand = new Map();
  const evalCell = (k) => {
    if (weights[k] <= 0) return;
    const f = features[k];
    for (const iv of ivs) {
      const key = k * 16 + ivs.indexOf(iv);
      const lv = levels[k][iv.id] || 0;
      if (lv >= maxLv[k][iv.id]) { cand.delete(key); continue; }
      const next = { ...levels[k], [iv.id]: lv + 1 };
      const felt = cellFelt(f, modsForCell(next, f, A), scenario, offsets[k]);
      const benefit = weights[k] * (curFelt[k] - felt);
      const cost = costOf(iv.id, f, A, lv + 1, costs) - costOf(iv.id, f, A, lv, costs);
      if (benefit <= 1e-9 || cost <= 0) { cand.delete(key); continue; }
      cand.set(key, { k, id: iv.id, lv: lv + 1, cost, benefit, ratio: benefit / cost, felt });
    }
  };
  for (let k = 0; k < N; k++) evalCell(k);

  let remaining = budget, spent = 0;
  const actions = [];
  for (let iter = 0; iter < 20000 && cand.size; iter++) {
    let best = null;
    for (const c of cand.values()) if (c.cost <= remaining && (!best || c.ratio > best.ratio)) best = c;
    if (!best) break;
    levels[best.k][best.id] = best.lv;
    remaining -= best.cost;
    spent += best.cost;
    actions.push({ cell: best.k, type: best.id, level: best.lv, cost: best.cost, deltaFelt: curFelt[best.k] - best.felt });
    curFelt[best.k] = best.felt;
    evalCell(best.k);
  }
  return summarisePlan({ levels, features, A, costs, actions, budget, spent, strategy });
}

export function summarisePlan({ levels, features, A, costs, actions = [], budget, spent, strategy }) {
  const byType = Object.fromEntries(INTERVENTIONS.map((x) => [x.id, { id: x.id, name: x.name, cost: 0, units: 0, cells: 0, unit: x.unit }]));
  let total = 0;
  const touched = new Set();
  levels.forEach((lv, k) => {
    for (const [id, l] of Object.entries(lv)) {
      if (!l) continue;
      const c = costOf(id, features[k], A, l, costs);
      byType[id].cost += c;
      byType[id].units += INTERVENTION_BY_ID[id].units(features[k], A, l);
      byType[id].cells += 1;
      total += c;
      touched.add(k);
    }
  });
  return {
    levels,
    mods: modsFromLevels(levels, features, A),
    actions,
    budget,
    spent: spent ?? total,
    total,
    strategy,
    cellsTreated: touched.size,
    byType: Object.values(byType).filter((x) => x.cost > 0).map((x) => ({ ...x, cost: Math.round(x.cost), units: Math.round(x.units) })),
  };
}

/** Manual scenario: apply a coverage share (0-1 of feasible max) for each intervention to target cells. */
export function manualPlan({ grid, features, coverage, costs, targetCells = null }) {
  const A = grid.cellArea;
  const levels = features.map((f, k) => {
    const out = {};
    if (targetCells && !targetCells.has(k)) return out;
    for (const iv of INTERVENTIONS) {
      const share = coverage[iv.id] || 0;
      if (share <= 0) continue;
      const lv = Math.round(share * iv.maxLevel(f, A));
      if (lv > 0) out[iv.id] = lv;
    }
    return out;
  });
  return summarisePlan({ levels, features, A, costs, strategy: 'manual' });
}
