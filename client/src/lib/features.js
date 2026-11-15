// Local geospatial processing: rasterise vector land cover onto an analysis grid.
// Everything here runs in the browser - no external services.

export const GRID_N = 28;
const M_PER_DEG_LAT = 110574;
const FOOTPRINT_M2 = 160; // mean building footprint assumption (OSM gives centroids only)
const DEFAULT_FLOORS = 2;
const M2_PER_PERSON = 40; // gross floor area per resident/occupant (proxy)
const TREE_CANOPY_M2 = 50;

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function buildGrid(bbox, n = GRID_N) {
  const dLat = (bbox.north - bbox.south) / n;
  const dLon = (bbox.east - bbox.west) / n;
  const midLat = (bbox.north + bbox.south) / 2;
  const cellW = dLon * 111320 * Math.cos((midLat * Math.PI) / 180);
  const cellH = dLat * M_PER_DEG_LAT;
  const cells = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const s = bbox.south + i * dLat, w = bbox.west + j * dLon;
      cells.push({ id: i * n + j, i, j, bounds: [[s, w], [s + dLat, w + dLon]], lat: s + dLat / 2, lon: w + dLon / 2 });
    }
  return { n, bbox, dLat, dLon, cellW, cellH, cellArea: cellW * cellH, cells };
}

export function cellIndex(grid, lat, lon) {
  const i = Math.floor((lat - grid.bbox.south) / grid.dLat);
  const j = Math.floor((lon - grid.bbox.west) / grid.dLon);
  if (i < 0 || j < 0 || i >= grid.n || j >= grid.n) return -1;
  return i * grid.n + j;
}

export function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [ya, xa] = ring[a], [yb, xb] = ring[b];
    if (ya > lat !== yb > lat && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

function ringBBox(ring) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [la, lo] of ring) {
    if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo;
  }
  return { s, w, n, e };
}

/** Fraction of each cell covered by any of the polygons (sub-sampled 6x6). */
function polygonCoverage(grid, rings) {
  const out = new Float64Array(grid.cells.length);
  if (!rings.length) return out;
  const polys = rings.map((r) => ({ r, b: ringBBox(r) }));
  const K = 6;
  for (const c of grid.cells) {
    const [[s, w]] = c.bounds;
    const cand = polys.filter((p) => p.b.n >= s && p.b.s <= s + grid.dLat && p.b.e >= w && p.b.w <= w + grid.dLon);
    if (!cand.length) continue;
    let hit = 0;
    for (let a = 0; a < K; a++)
      for (let b = 0; b < K; b++) {
        const la = s + ((a + 0.5) / K) * grid.dLat, lo = w + ((b + 0.5) / K) * grid.dLon;
        if (cand.some((p) => la >= p.b.s && la <= p.b.n && lo >= p.b.w && lo <= p.b.e && pointInRing(la, lo, p.r))) hit++;
      }
    out[c.id] = hit / (K * K);
  }
  return out;
}

/** Accumulate line area (length x width, m2) into cells by sampling along segments. */
function lineArea(grid, lines) {
  const out = new Float64Array(grid.cells.length);
  const kx = grid.cellW / grid.dLon, ky = grid.cellH / grid.dLat; // metres per degree
  for (const { pts, w } of lines) {
    for (let k = 1; k < pts.length; k++) {
      const [la1, lo1] = pts[k - 1], [la2, lo2] = pts[k];
      const len = Math.hypot((la2 - la1) * ky, (lo2 - lo1) * kx);
      const steps = Math.max(1, Math.ceil(len / 10));
      const stepLen = len / steps;
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const idx = cellIndex(grid, la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t);
        if (idx >= 0) out[idx] += stepLen * w;
      }
    }
  }
  return out;
}

/**
 * Convert raw land cover layers into per-cell surface fractions.
 * Fractions: roof, road, other (misc. paved/bare), veg (ground vegetation), water; canopy overlaps.
 */
export function computeFeatures(grid, lc) {
  const N = grid.cells.length, A = grid.cellArea;
  const bCount = new Float64Array(N), floorArea = new Float64Array(N), levelsSum = new Float64Array(N);
  for (const [la, lo, lv] of lc.buildings || []) {
    const idx = cellIndex(grid, la, lo);
    if (idx < 0) continue;
    const floors = lv > 0 ? lv : DEFAULT_FLOORS;
    bCount[idx] += 1;
    levelsSum[idx] += floors;
    floorArea[idx] += FOOTPRINT_M2 * floors;
  }
  const treeCount = new Float64Array(N);
  for (const [la, lo] of lc.trees || []) {
    const idx = cellIndex(grid, la, lo);
    if (idx >= 0) treeCount[idx] += 1;
  }
  const greenCov = polygonCoverage(grid, (lc.green || []).map((g) => g.ring));
  const waterCov = polygonCoverage(grid, lc.water || []);
  const roadA = lineArea(grid, lc.roads || []);
  const riverA = lineArea(grid, lc.waterLines || []);
  const treeRowA = lineArea(grid, lc.treeRows || []);

  return grid.cells.map((c, id) => {
    const water = clamp(waterCov[id] + riverA[id] / A);
    const roof = clamp((bCount[id] * FOOTPRINT_M2) / A, 0, Math.min(0.8, 1 - water));
    const road = clamp(roadA[id] / A, 0, 1 - water - roof);
    const canopy = clamp((treeCount[id] * TREE_CANOPY_M2 + treeRowA[id]) / A + greenCov[id] * 0.35, 0, 0.9);
    const veg = clamp(greenCov[id] * 0.9, 0, 1 - water - roof - road);
    const other = Math.max(0, 1 - water - roof - road - veg);
    const urban = roof + road;
    const pavedShare = clamp(0.35 + urban * 1.2, 0.35, 0.9); // share of "other" that is sealed
    return {
      id,
      roof, road, veg, water, other, canopy, pavedShare,
      impervious: clamp(roof + road + other * pavedShare),
      buildings: bCount[id],
      avgFloors: bCount[id] ? levelsSum[id] / bCount[id] : 0,
      population: floorArea[id] / M2_PER_PERSON,
      trees: treeCount[id],
      greenPolyCover: greenCov[id],
    };
  });
}

export const ASSUMPTIONS = { FOOTPRINT_M2, DEFAULT_FLOORS, M2_PER_PERSON, TREE_CANOPY_M2, GRID_N };
