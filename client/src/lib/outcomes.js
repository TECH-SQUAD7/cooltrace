// Before/after comparison metrics (local).
import { costOf } from './optimizer.js';

const pct = (a, p) => {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function compareOutcomes(base, after, features) {
  const pop = features.map((f) => f.population);
  const totalPop = pop.reduce((a, b) => a + b, 0) || 1;
  const p90 = pct(base.surface, 0.9);
  let hotBefore = 0, hotAfter = 0, personDegrees = 0, maxCooling = 0;
  const delta = new Float64Array(base.felt.length);
  for (let k = 0; k < delta.length; k++) {
    delta[k] = base.air[k] - after.air[k];
    if (base.surface[k] >= p90) hotBefore++;
    if (after.surface[k] >= p90) hotAfter++;
    personDegrees += pop[k] * (base.felt[k] - after.felt[k]);
    maxCooling = Math.max(maxCooling, base.surface[k] - after.surface[k]);
  }
  const b = base.stats, a = after.stats;
  return {
    delta,
    dMeanSurface: b.meanSurface - a.meanSurface,
    dMaxSurface: b.maxSurface - a.maxSurface,
    maxLocalSurfaceCooling: maxCooling,
    dMeanAir: b.meanAir - a.meanAir,
    dMaxAir: b.maxAir - a.maxAir,
    dPopFelt: b.popWeightedFelt - a.popWeightedFelt,
    dMaxFelt: b.maxFelt - a.maxFelt,
    dHVI: b.meanHVI - a.meanHVI,
    popExtremeBefore: b.popExtreme, popExtremeAfter: a.popExtreme,
    hotCellsBefore: hotBefore, hotCellsAfter: hotAfter, p90Threshold: p90,
    personDegrees, avgFeltCoolingPerPerson: personDegrees / totalPop,
  };
}

export function perCellSpend(plan, features, A, costs) {
  return plan.levels.map((lv, k) => Object.entries(lv).reduce((s, [id, l]) => s + (l ? costOf(id, features[k], A, l, costs) : 0), 0));
}
