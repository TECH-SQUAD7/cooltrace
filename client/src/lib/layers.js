// Map layer definitions shared by all views.
const minmax = (a) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo < 0.5 ? [lo - 0.25, hi + 0.25] : [lo, hi];
};
const c1 = (v) => `${v.toFixed(1)}°`;
const pct = (v) => `${Math.round(v * 100)}%`;

export const LAYERS = [
  { id: 'surface', label: 'Surface temperature (°C)', short: 'Surface', ramp: 'heat', format: c1, get: ({ model }) => model.surface },
  { id: 'air', label: 'Air temperature (°C)', short: 'Air', ramp: 'heat', format: c1, get: ({ model }) => model.air },
  { id: 'felt', label: 'Felt / heat index (°C)', short: 'Felt', ramp: 'heat', format: c1, get: ({ model }) => model.felt },
  { id: 'hvi', label: 'Heat vulnerability index (0-100)', short: 'Vulnerability', ramp: 'vuln', format: (v) => v.toFixed(0), get: ({ model }) => model.hvi, domain: () => [0, 100] },
  { id: 'gi', label: 'Getis-Ord Gi* z-score', short: 'Gi* z', ramp: 'diverging', format: (v) => v.toFixed(1), get: ({ z }) => z, domain: () => [-4, 4] },
  { id: 'impervious', label: 'Impervious surface share', short: 'Impervious', ramp: 'gray', format: pct, get: ({ features }) => features.map((f) => f.impervious), domain: () => [0, 1] },
  { id: 'green', label: 'Vegetation + tree canopy share', short: 'Green', ramp: 'green', format: pct, get: ({ features }) => features.map((f) => Math.min(1, f.veg + f.canopy)), domain: () => [0, 0.8] },
  { id: 'population', label: 'Population exposure (proxy, people/cell)', short: 'People', ramp: 'vuln', format: (v) => Math.round(v).toString(), get: ({ features }) => features.map((f) => f.population) },
];
export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

export function layerData(id, ctx, domainOverride) {
  const L = LAYER_BY_ID[id];
  const values = Float64Array.from(L.get(ctx));
  const domain = domainOverride || (L.domain ? L.domain() : minmax(values));
  return { ...L, values, domain };
}

export { minmax };
