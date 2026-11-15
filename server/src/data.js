// Public environmental data acquisition (no API keys required):
//  - Weather & climate: Open-Meteo forecast + ERA5 archive (https://open-meteo.com, CC BY 4.0)
//  - Land cover / built form: OpenStreetMap via Overpass API (ODbL)
// Falls back to clearly-labelled synthetic data if a source is unavailable.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../data/cache');
const UA = 'COOLTRACE/1.0 (urban heat research tool)';
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const memCache = new Map();
const r5 = (x) => Math.round(x * 1e5) / 1e5;

export function makeBBox(lat, lon, halfKm = 1.75) {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { south: r5(lat - dLat), west: r5(lon - dLon), north: r5(lat + dLat), east: r5(lon + dLon) };
}

async function fetchJSON(url, { timeout = 20000, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: opts.signal || controller.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(key, maxAgeMs) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.t < maxAgeMs) return hit.v;
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const v = JSON.parse(await fs.readFile(file, 'utf8'));
    memCache.set(key, { t: stat.mtimeMs, v });
    return v;
  } catch {
    return null;
  }
}

async function writeCache(key, v) {
  memCache.set(key, { t: Date.now(), v });
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(v));
  } catch (e) {
    console.warn('[cache] write failed', e.message);
  }
}

// ---------------------------------------------------------------- geocoding
export async function geocode(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const data = await fetchJSON(url, { timeout: 10000 });
  return (data.results || []).map((r) => ({
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    lat: r.latitude,
    lon: r.longitude,
    population: r.population,
  }));
}

// ---------------------------------------------------------------- weather
const isoDate = (d) => d.toISOString().slice(0, 10);

export async function getWeather(bbox) {
  const key = `wx_${bbox.south}_${bbox.west}`.replace(/[^\w-]/g, '_');
  const cached = await readCache(key, 30 * 60 * 1000);
  if (cached) return cached;

  const lats = [], lons = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      lats.push(r5(bbox.south + ((bbox.north - bbox.south) * (i + 0.5)) / 3));
      lons.push(r5(bbox.west + ((bbox.east - bbox.west) * (j + 0.5)) / 3));
    }
  const cLat = r5((bbox.south + bbox.north) / 2);
  const cLon = r5((bbox.west + bbox.east) / 2);
  const current = 'temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,shortwave_radiation,cloud_cover,is_day';

  const sampleUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=${current}&timezone=auto`;
  const centerUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${cLat}&longitude=${cLon}` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,shortwave_radiation,uv_index` +
    `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,uv_index_max,shortwave_radiation_sum` +
    `&past_days=30&forecast_days=7&timezone=auto`;
  const end = new Date(Date.now() - 6 * 864e5);
  const start = new Date(end.getTime() - 365 * 864e5);
  const archiveUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${cLat}&longitude=${cLon}` +
    `&start_date=${isoDate(start)}&end_date=${isoDate(end)}` +
    `&daily=temperature_2m_max,apparent_temperature_max,shortwave_radiation_sum,relative_humidity_2m_mean,wind_speed_10m_max&timezone=auto`;

  const [samplesR, centerR, archiveR] = await Promise.allSettled([
    fetchJSON(sampleUrl),
    fetchJSON(centerUrl),
    fetchJSON(archiveUrl, { timeout: 30000 }),
  ]);
  if (samplesR.status !== 'fulfilled' || centerR.status !== 'fulfilled') {
    throw new Error(`Open-Meteo unavailable: ${(samplesR.reason || centerR.reason)?.message}`);
  }
  const samplesArr = Array.isArray(samplesR.value) ? samplesR.value : [samplesR.value];
  const samples = samplesArr.map((s, k) => ({
    lat: lats[k],
    lon: lons[k],
    temp: s.current?.temperature_2m,
    rh: s.current?.relative_humidity_2m,
    apparent: s.current?.apparent_temperature,
    wind: s.current?.wind_speed_10m,
    windDir: s.current?.wind_direction_10m,
    radiation: s.current?.shortwave_radiation,
    cloud: s.current?.cloud_cover,
    isDay: s.current?.is_day,
  }));
  const c = centerR.value;
  const hourly = (c.hourly?.time || []).map((t, k) => ({
    time: t,
    temp: c.hourly.temperature_2m[k],
    apparent: c.hourly.apparent_temperature[k],
    rh: c.hourly.relative_humidity_2m[k],
    radiation: c.hourly.shortwave_radiation[k],
    uv: c.hourly.uv_index?.[k],
  }));
  const daily = (c.daily?.time || []).map((t, k) => ({
    date: t,
    tmax: c.daily.temperature_2m_max[k],
    tmin: c.daily.temperature_2m_min[k],
    apparentMax: c.daily.apparent_temperature_max[k],
    uvMax: c.daily.uv_index_max?.[k],
    radiationSum: c.daily.shortwave_radiation_sum?.[k],
  }));

  const today = new Date().toISOString().slice(0, 10);
  const pastDaily = daily.filter((d) => d.date <= today && d.tmax != null);
  const peakRecent = pastDaily.reduce((a, b) => (b.tmax > (a?.tmax ?? -99) ? b : a), null);

  let hottestYear = null;
  let archive = [];
  if (archiveR.status === 'fulfilled' && archiveR.value.daily) {
    const a = archiveR.value.daily;
    archive = a.time.map((t, k) => ({
      date: t,
      tmax: a.temperature_2m_max[k],
      apparentMax: a.apparent_temperature_max[k],
      radiationSum: a.shortwave_radiation_sum[k],
      rh: a.relative_humidity_2m_mean?.[k],
      windMax: a.wind_speed_10m_max?.[k],
    }));
    hottestYear = archive.filter((d) => d.tmax != null).reduce((x, y) => (y.tmax > (x?.tmax ?? -99) ? y : x), null);
  }

  // Monthly climatology from the archive (for charts)
  const monthly = {};
  for (const d of archive) {
    if (d.tmax == null) continue;
    const m = d.date.slice(0, 7);
    monthly[m] ??= { month: m, sum: 0, n: 0, max: -99 };
    monthly[m].sum += d.tmax;
    monthly[m].n += 1;
    monthly[m].max = Math.max(monthly[m].max, d.tmax);
  }

  const result = {
    source: 'open-meteo',
    sourceLabel: 'Open-Meteo forecast API + ERA5 reanalysis archive (real data)',
    timezone: c.timezone,
    fetchedAt: new Date().toISOString(),
    samples,
    hourly,
    daily,
    peakRecent,
    hottestYear,
    monthly: Object.values(monthly).map((m) => ({ month: m.month, avgMax: +(m.sum / m.n).toFixed(1), max: m.max })),
    archiveAvailable: archive.length > 0,
  };
  await writeCache(key, result);
  return result;
}

// ---------------------------------------------------------------- OSM land cover
const ROAD_WIDTH = { motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 10, residential: 7, unclassified: 7, service: 5, living_street: 5 };
const GREEN_TAGS = {
  leisure: /^(park|garden|pitch|playground|nature_reserve|golf_course|recreation_ground)$/,
  landuse: /^(grass|forest|meadow|recreation_ground|village_green|orchard|cemetery|allotments|greenfield)$/,
  natural: /^(wood|scrub|grassland|heath|wetland)$/,
};

function overpassQuery(b) {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:60];
(
  way["building"](${bb});
)->.b;
.b out tags center qt;
(
  way["leisure"~"^(park|garden|pitch|playground|nature_reserve|golf_course|recreation_ground)$"](${bb});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|orchard|cemetery|allotments|greenfield)$"](${bb});
  way["natural"~"^(wood|scrub|grassland|heath|wetland|water)$"](${bb});
  way["landuse"~"^(reservoir|basin)$"](${bb});
  way["waterway"~"^(river|canal|riverbank)$"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](${bb});
  way["natural"="tree_row"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve|golf_course|recreation_ground)$"](${bb});
  relation["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery|reservoir)$"](${bb});
  relation["natural"~"^(wood|scrub|grassland|wetland|water)$"](${bb});
);
out tags geom qt;
node["natural"="tree"](${bb});
out qt;`;
}

async function queryOverpass(query) {
  const controllers = OVERPASS_MIRRORS.map(() => new AbortController());
  const attempt = (url, idx) =>
    new Promise((resolve, reject) => {
      setTimeout(async () => {
        if (controllers[idx].signal.aborted) return reject(new Error('aborted'));
        try {
          const json = await fetchJSON(url, {
            method: 'POST',
            timeout: 75000,
            signal: controllers[idx].signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
          });
          if (!Array.isArray(json.elements)) throw new Error('bad payload');
          if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
          resolve({ json, mirror: new URL(url).host });
        } catch (e) {
          reject(e);
        }
      }, idx * 5000); // staggered start to be polite to public mirrors
    });
  try {
    const out = await Promise.any(OVERPASS_MIRRORS.map(attempt));
    controllers.forEach((c) => c.abort());
    return out;
  } catch (e) {
    controllers.forEach((c) => c.abort());
    throw new Error('All Overpass mirrors failed: ' + (e.errors || []).map((x) => x.message).join('; '));
  }
}

/** Join multipolygon outer member ways into closed rings. */
export function joinRings(segments) {
  const pool = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift();
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      const end = ring[ring.length - 1];
      for (let k = 0; k < pool.length; k++) {
        const s = pool[k];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat([...s].reverse().slice(1));
        else continue;
        pool.splice(k, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(same(ring[0], ring[ring.length - 1]) ? ring : [...ring, ring[0]]);
  }
  return rings;
}

const isWater = (t) => t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank';
const isGreen = (t) => GREEN_TAGS.leisure.test(t.leisure || '') || GREEN_TAGS.landuse.test(t.landuse || '') || GREEN_TAGS.natural.test(t.natural || '');

export function classifyOSM(elements) {
  const buildings = [], green = [], water = [], waterLines = [], roads = [], trees = [], treeRows = [];
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node' && t.natural === 'tree') {
      trees.push([r5(el.lat), r5(el.lon)]);
      continue;
    }
    if (el.type === 'relation') {
      const outers = (el.members || [])
        .filter((m) => m.type === 'way' && m.role !== 'inner' && Array.isArray(m.geometry))
        .map((m) => m.geometry.filter(Boolean).map((p) => [r5(p.lat), r5(p.lon)]));
      const rings = joinRings(outers);
      if (isWater(t)) water.push(...rings);
      else if (isGreen(t)) rings.forEach((ring) => green.push({ ring, kind: t.leisure || t.landuse || t.natural }));
      continue;
    }
    if (el.type !== 'way') continue;
    if (t.natural === 'tree_row' && el.geometry) {
      treeRows.push({ pts: el.geometry.map((p) => [r5(p.lat), r5(p.lon)]), w: 8 });
      continue;
    }
    if (t.building && el.center) {
      const lv = parseFloat(t['building:levels']);
      buildings.push([r5(el.center.lat), r5(el.center.lon), Number.isFinite(lv) ? Math.min(lv, 80) : 0]);
      continue;
    }
    const geom = (el.geometry || []).map((p) => [r5(p.lat), r5(p.lon)]);
    if (geom.length < 2) continue;
    if (t.highway && ROAD_WIDTH[t.highway]) {
      roads.push({ pts: geom, w: ROAD_WIDTH[t.highway], cls: t.highway });
    } else if (t.waterway === 'river' || t.waterway === 'canal') {
      waterLines.push({ pts: geom, w: t.waterway === 'river' ? 35 : 12 });
    } else if (isWater(t)) {
      if (geom.length >= 4) water.push(geom);
    } else if (isGreen(t)) {
      if (geom.length >= 4) green.push({ ring: geom, kind: t.leisure || t.landuse || t.natural });
    }
  }
  return { buildings, green, water, waterLines, roads, trees, treeRows };
}

export async function getLandcover(bbox, { allowSynthetic = true } = {}) {
  const key = `osm_${bbox.south}_${bbox.west}_${bbox.north}_${bbox.east}`.replace(/[^\w-]/g, '_');
  const cached = await readCache(key, 30 * 864e5);
  if (cached) return { ...cached, cached: true };
  try {
    const { json, mirror } = await queryOverpass(overpassQuery(bbox));
    const layers = classifyOSM(json.elements);
    if (layers.buildings.length + layers.roads.length < 20) throw new Error('Too few OSM features mapped in this area');
    const result = {
      source: 'osm',
      sourceLabel: `OpenStreetMap contributors via Overpass (${mirror}) - real data, ODbL`,
      fetchedAt: new Date().toISOString(),
      osmTimestamp: json.osm3s?.timestamp_osm_base,
      counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.length])),
      ...layers,
    };
    await writeCache(key, result);
    return result;
  } catch (err) {
    console.warn('[osm] falling back to synthetic land cover:', err.message);
    if (!allowSynthetic) throw err;
    return { ...syntheticLandcover(bbox), fallbackReason: err.message };
  }
}

// ---------------------------------------------------------------- synthetic fallback
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticLandcover(b) {
  const rand = mulberry32(Math.floor(Math.abs(b.south * 1000 + b.west * 7919)) || 42);
  const H = b.north - b.south, W = b.east - b.west;
  const cores = [
    [0.5 + (rand() - 0.5) * 0.2, 0.5 + (rand() - 0.5) * 0.2, 1],
    [rand(), rand(), 0.6],
    [rand(), rand(), 0.5],
  ];
  const density = (u, v) => cores.reduce((s, [cu, cv, w]) => s + w * Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / 0.05), 0);
  const buildings = [];
  for (let k = 0; k < 9000; k++) {
    const u = rand(), v = rand();
    if (rand() < Math.min(0.95, density(u, v))) buildings.push([r5(b.south + u * H), r5(b.west + v * W), Math.round(1 + rand() * 6 * density(u, v))]);
  }
  const circle = (cu, cv, rad, n = 18) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return [r5(b.south + (cu + rad * Math.cos(a)) * H), r5(b.west + (cv + rad * Math.sin(a)) * W)];
    });
  const green = Array.from({ length: 6 }, () => ({ ring: circle(rand(), rand(), 0.03 + rand() * 0.06), kind: 'park' }));
  const water = [circle(0.15 + rand() * 0.7, 0.15 + rand() * 0.7, 0.03)];
  const riverU = 0.2 + rand() * 0.6;
  const waterLines = [{ pts: Array.from({ length: 12 }, (_, i) => [r5(b.south + (riverU + 0.1 * Math.sin(i)) * H), r5(b.west + (i / 11) * W)]), w: 35 }];
  const roads = [];
  for (let g = 1; g < 9; g++) {
    roads.push({ pts: [[r5(b.south + (g / 9) * H), b.west], [r5(b.south + (g / 9) * H), b.east]], w: g % 3 === 0 ? 16 : 8, cls: 'synthetic' });
    roads.push({ pts: [[b.south, r5(b.west + (g / 9) * W)], [b.north, r5(b.west + (g / 9) * W)]], w: g % 3 === 0 ? 16 : 8, cls: 'synthetic' });
  }
  const trees = [];
  for (let k = 0; k < 600; k++) trees.push([r5(b.south + rand() * H), r5(b.west + rand() * W)]);
  return {
    source: 'synthetic',
    sourceLabel: 'SYNTHETIC demonstration land cover (OpenStreetMap was unavailable)',
    fetchedAt: new Date().toISOString(),
    counts: { buildings: buildings.length, green: green.length, water: water.length, waterLines: 1, roads: roads.length, trees: trees.length },
    buildings, green, water, waterLines, roads, trees,
  };
}

export function syntheticWeather(bbox) {
  const lat = (bbox.south + bbox.north) / 2;
  const base = 38 - Math.abs(lat - 25) * 0.35;
  const samples = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      samples.push({
        lat: bbox.south + ((bbox.north - bbox.south) * (i + 0.5)) / 3,
        lon: bbox.west + ((bbox.east - bbox.west) * (j + 0.5)) / 3,
        temp: +(base + (i - 1) * 0.2).toFixed(1), rh: 35, apparent: base + 2, wind: 8, windDir: 220, radiation: 820, cloud: 5, isDay: 1,
      });
  const now = Date.now();
  const hourly = Array.from({ length: 72 }, (_, h) => {
    const t = new Date(now + h * 3600e3);
    const diurnal = Math.sin(((t.getUTCHours() - 9) / 24) * 2 * Math.PI);
    return { time: t.toISOString().slice(0, 16), temp: +(base - 5 + 6 * diurnal).toFixed(1), apparent: +(base - 4 + 7 * diurnal).toFixed(1), rh: 40, radiation: Math.max(0, 900 * diurnal), uv: Math.max(0, 10 * diurnal) };
  });
  return {
    source: 'synthetic',
    sourceLabel: 'SYNTHETIC demonstration weather (Open-Meteo was unavailable)',
    fetchedAt: new Date().toISOString(),
    samples, hourly, daily: [],
    peakRecent: { date: 'synthetic', tmax: base + 1 },
    hottestYear: { date: 'synthetic', tmax: base + 4, rh: 30, radiationSum: 28, windMax: 12 },
    monthly: [], archiveAvailable: false,
  };
}
