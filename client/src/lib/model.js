// Local urban heat model. A transparent, physically-motivated surface-energy
// mixture model: each surface type has a characteristic excess temperature over
// air under full sun; cell surface temperature is the area-weighted mix, air
// temperature responds to smoothed surface excess, and felt temperature combines
// heat index (humidity) with radiant load. All parameters are documented in the
// Methods tab. This is a screening model, not a substitute for satellite LST.
import { clamp } from './features.js';

// Surface excess temperature above air at full sun (~900 W/m2), deg C
export const SURFACE_EXCESS = {
  roof: 22, // dark roof, albedo ~0.15
  road: 18, // asphalt, albedo ~0.12
  pavedOther: 13, // concrete/paving
  bare: 9, // bare soil
  veg: 2, // irrigated/ground vegetation
  canopy: -1, // tree crown / shaded ground
  water: -2,
  greenRoof: 4,
};
const BASE_ROOF_ALBEDO = 0.15, COOL_ROOF_ALBEDO = 0.65;
const BASE_PAVE_ALBEDO = 0.12, COOL_PAVE_ALBEDO = 0.35;
const RURAL_EXCESS = 5; // reference excess of surrounding mixed land (deg C)

export const EMPTY_MODS = Object.freeze({ coolRoof: 0, greenRoof: 0, coolPave: 0, addCanopy: 0, addVeg: 0, shade: 0 });

/** Rothfusz/NOAA heat index, input and output in deg C. */
export function heatIndexC(tC, rh) {
  if (tC < 26.7) return tC;
  const T = (tC * 9) / 5 + 32, R = rh;
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R +
    0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
  if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  return ((hi - 32) * 5) / 9;
}

/** Surface excess (deg C at full sun) for one cell with modifiers applied. */
export function surfaceExcess(f, m = EMPTY_MODS) {
  const greenRoofShare = clamp(m.greenRoof, 0, 1);
  const coolRoofShare = clamp(m.coolRoof, 0, 1 - greenRoofShare);
  const roofAlb = BASE_ROOF_ALBEDO + coolRoofShare * (COOL_ROOF_ALBEDO - BASE_ROOF_ALBEDO) / Math.max(1e-9, 1 - greenRoofShare);
  const roofExcess = SURFACE_EXCESS.roof * (1 - roofAlb) / (1 - BASE_ROOF_ALBEDO);
  const paveAlb = BASE_PAVE_ALBEDO + clamp(m.coolPave) * (COOL_PAVE_ALBEDO - BASE_PAVE_ALBEDO);
  const roadExcess = SURFACE_EXCESS.road * (1 - paveAlb) / (1 - BASE_PAVE_ALBEDO);

  // Pocket parks convert paved "other" (then road) surface into vegetation
  let other = f.other, road = f.road;
  const addVeg = Math.min(m.addVeg || 0, other + road);
  const fromOther = Math.min(addVeg, other);
  other -= fromOther;
  road -= addVeg - fromOther;
  const veg = f.veg + addVeg;

  // Tree canopy shades the ground below it (roads/paving first)
  const canopy = clamp(f.canopy + (m.addCanopy || 0), 0, 0.95);
  const shadeable = road + other + veg;
  const shadeFrac = shadeable > 0 ? clamp(canopy / shadeable) : 0;

  const pavedOther = other * f.pavedShare, bare = other * (1 - f.pavedShare);
  const ground =
    road * roadExcess + pavedOther * SURFACE_EXCESS.pavedOther + bare * SURFACE_EXCESS.bare + veg * SURFACE_EXCESS.veg;
  const shadedGround = ground * (1 - shadeFrac) + shadeable * shadeFrac * SURFACE_EXCESS.canopy;
  const roofs = f.roof * ((1 - greenRoofShare) * roofExcess + greenRoofShare * SURFACE_EXCESS.greenRoof);
  return roofs + shadedGround + f.water * SURFACE_EXCESS.water;
}

/** Inverse-distance weighting of weather-station/grid samples onto cells. */
export function idwOffsets(cells, samples) {
  const valid = (samples || []).filter((s) => Number.isFinite(s.temp));
  if (!valid.length) return cells.map(() => 0);
  const mean = valid.reduce((a, s) => a + s.temp, 0) / valid.length;
  return cells.map((c) => {
    let num = 0, den = 0;
    for (const s of valid) {
      const d2 = (c.lat - s.lat) ** 2 + (c.lon - s.lon) ** 2 + 1e-9;
      num += (s.temp - mean) / d2;
      den += 1 / d2;
    }
    return num / den;
  });
}

function smooth(grid, values, radius = 1) {
  const { n } = grid;
  const out = new Float64Array(values.length);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0, w = 0;
      for (let di = -radius; di <= radius; di++)
        for (let dj = -radius; dj <= radius; dj++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const wt = di === 0 && dj === 0 ? 2 : 1 / Math.hypot(di, dj);
          s += values[a * n + b] * wt;
          w += wt;
        }
      out[i * n + j] = s / w;
    }
  return out;
}

/** Cheap per-cell felt temperature without neighbourhood effects (used by the optimiser). */
export function cellFelt(f, m, sc, offset = 0) {
  const R = sc.radiationFactor;
  const excess = surfaceExcess(f, m);
  const kAir = 0.26 / (1 + sc.wind / 25);
  const air = sc.airTemp + offset + kAir * R * (excess - RURAL_EXCESS);
  const shade = clamp(f.canopy + (m.addCanopy || 0) + (m.shade || 0), 0, 1);
  return heatIndexC(air, sc.rh) + 0.12 * R * Math.max(0, excess) * (1 - 0.7 * shade);
}

/**
 * Run the full model for a weather scenario and optional per-cell modifiers.
 * @returns {{surface, air, felt, hvi, excess} Float64Arrays + stats}
 */
export function runModel(grid, features, scenario, mods = null, ref = null) {
  const N = features.length;
  const R = scenario.radiationFactor;
  const offsets = scenario.offsets || new Array(N).fill(0);
  const excess = new Float64Array(N);
  for (let k = 0; k < N; k++) excess[k] = surfaceExcess(features[k], mods?.[k] || EMPTY_MODS);
  const surface = new Float64Array(N), air = new Float64Array(N), felt = new Float64Array(N);
  const sm = smooth(grid, excess, 2);
  const kAir = 0.26 / (1 + scenario.wind / 25);
  for (let k = 0; k < N; k++) {
    const base = scenario.airTemp + offsets[k];
    surface[k] = base + R * excess[k];
    air[k] = base + kAir * R * (0.6 * sm[k] + 0.4 * excess[k] - RURAL_EXCESS);
    const m = mods?.[k] || EMPTY_MODS;
    const shade = clamp(features[k].canopy + (m.addCanopy || 0) + (m.shade || 0), 0, 1);
    felt[k] = heatIndexC(air[k], scenario.rh) + 0.12 * R * Math.max(0, excess[k]) * (1 - 0.7 * shade);
  }

  // Heat Vulnerability Index: exposure x sensitivity x (lack of) adaptive capacity
  const green = features.map((f, k) => clamp(f.veg + f.canopy + (mods?.[k]?.addCanopy || 0) + (mods?.[k]?.addVeg || 0)));
  const greenAccess = smooth(grid, green, 2);
  const range = ref || {
    feltMin: Math.min(...felt), feltMax: Math.max(...felt),
    popMax: Math.max(1, ...features.map((f) => f.population)),
  };
  const hvi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const exposure = clamp((felt[k] - range.feltMin) / Math.max(0.5, range.feltMax - range.feltMin));
    const sensitivity = clamp(Math.sqrt(features[k].population / range.popMax));
    const lack = 1 - clamp(greenAccess[k] / 0.5);
    hvi[k] = 100 * (0.5 * exposure + 0.3 * sensitivity + 0.2 * lack);
  }
  return { surface, air, felt, hvi, excess, range, stats: summarize({ surface, air, felt, hvi }, features, scenario) };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function summarize(r, features, scenario) {
  const pop = features.map((f) => f.population);
  const totalPop = pop.reduce((a, b) => a + b, 0);
  const extremeThreshold = scenario.extremeFelt ?? 41; // "danger" heat index band
  let popExtreme = 0, cellsExtreme = 0, popWeightedFelt = 0;
  for (let k = 0; k < r.felt.length; k++) {
    if (r.felt[k] >= extremeThreshold) { popExtreme += pop[k]; cellsExtreme++; }
    popWeightedFelt += r.felt[k] * pop[k];
  }
  const f = (x) => +x.toFixed(2);
  return {
    meanSurface: f(mean(r.surface)), maxSurface: f(Math.max(...r.surface)), p90Surface: f(pct(r.surface, 0.9)),
    meanAir: f(mean(r.air)), maxAir: f(Math.max(...r.air)), minAir: f(Math.min(...r.air)),
    uhiIntensity: f(pct(r.air, 0.95) - pct(r.air, 0.05)),
    meanFelt: f(mean(r.felt)), maxFelt: f(Math.max(...r.felt)),
    popWeightedFelt: f(totalPop ? popWeightedFelt / totalPop : mean(r.felt)),
    meanHVI: f(mean(r.hvi)),
    extremeThreshold, popExtreme: Math.round(popExtreme), cellsExtreme,
    totalPopProxy: Math.round(totalPop),
    meanImpervious: f(mean(features.map((x) => x.impervious))),
    meanCanopy: f(mean(features.map((x) => x.canopy))),
    meanVeg: f(mean(features.map((x) => x.veg + x.canopy * 0.5))),
    meanWater: f(mean(features.map((x) => x.water))),
  };
}

/** Build weather scenarios from the backend weather payload. */
export function buildScenarios(weather, cells) {
  const offsets = idwOffsets(cells, weather.samples);
  const radFromSum = (mj) => clamp(((mj ?? 22) * 36.3) / 900, 0.3, 1.2); // daily MJ/m2 -> peak W/m2 factor
  const list = [];
  const today = new Date().toISOString().slice(0, 10);
  const todayHours = (weather.hourly || []).filter((h) => h.time.slice(0, 10) === today && h.temp != null);
  if (todayHours.length) {
    const peak = todayHours.reduce((a, b) => (b.temp > a.temp ? b : a));
    const maxRad = Math.max(...todayHours.map((h) => h.radiation || 0));
    list.push({
      id: 'today', label: `Today's peak (${peak.time.slice(11, 16)})`, airTemp: peak.temp, rh: peak.rh ?? 40,
      radiationFactor: clamp(maxRad / 900, 0.15, 1.2), wind: weather.samples?.[4]?.wind ?? 8, source: weather.source,
      note: 'Forecast hourly peak for today',
    });
  }
  if (weather.peakRecent?.tmax != null) {
    list.push({
      id: 'recent', label: `Hottest of last 30 days (${weather.peakRecent.date})`, airTemp: weather.peakRecent.tmax, rh: 35,
      radiationFactor: radFromSum(weather.peakRecent.radiationSum), wind: 8, source: weather.source,
      note: 'Daily max from Open-Meteo past days; RH assumed 35%',
    });
  }
  if (weather.hottestYear?.tmax != null) {
    list.push({
      id: 'year', label: `Hottest day, past 12 months (${weather.hottestYear.date})`, airTemp: weather.hottestYear.tmax,
      rh: clamp((weather.hottestYear.rh ?? 40) * 0.8, 10, 90), radiationFactor: radFromSum(weather.hottestYear.radiationSum),
      wind: weather.hottestYear.windMax ? weather.hottestYear.windMax * 0.5 : 8, source: weather.source,
      note: 'ERA5 reanalysis daily max; afternoon RH approximated as 0.8 x daily mean',
    });
  }
  list.push({ id: 'custom', label: 'Custom heatwave', airTemp: 42, rh: 30, radiationFactor: 1, wind: 6, source: 'user', note: 'User-defined design day' });
  return list.map((s) => ({ ...s, offsets }));
}
