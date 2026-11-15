// Local hotspot detection: Getis-Ord Gi* statistic with a fixed distance band,
// then 8-connected clustering of significant hot cells into hotspot zones.

/** Gi* z-scores for a gridded field. radius in cells (Chebyshev distance band, includes self). */
export function getisOrdGiStar(n, values, radius = 2) {
  const N = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / N;
  const s = Math.sqrt(values.reduce((a, b) => a + b * b, 0) / N - mean * mean);
  const z = new Float64Array(N);
  if (!(s > 1e-12)) return z;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let sumWX = 0, W = 0;
      for (let di = -radius; di <= radius; di++)
        for (let dj = -radius; dj <= radius; dj++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          sumWX += values[a * n + b];
          W += 1; // binary weights => sum(w^2) == W
        }
      const denom = s * Math.sqrt((N * W - W * W) / (N - 1));
      z[i * n + j] = denom > 0 ? (sumWX - mean * W) / denom : 0;
    }
  return z;
}

export function classifyZ(z) {
  if (z >= 2.58) return { label: 'Hot spot (99%)', level: 3 };
  if (z >= 1.96) return { label: 'Hot spot (95%)', level: 2 };
  if (z >= 1.65) return { label: 'Hot spot (90%)', level: 1 };
  if (z <= -2.58) return { label: 'Cool spot (99%)', level: -3 };
  if (z <= -1.96) return { label: 'Cool spot (95%)', level: -2 };
  if (z <= -1.65) return { label: 'Cool spot (90%)', level: -1 };
  return { label: 'Not significant', level: 0 };
}

/** Group significant hot cells (z >= threshold) into connected zones with summary statistics. */
export function clusterHotspots(grid, z, model, features, threshold = 1.96) {
  const { n, cells } = grid;
  const seen = new Uint8Array(cells.length);
  const zones = [];
  for (let k = 0; k < cells.length; k++) {
    if (seen[k] || z[k] < threshold) continue;
    const stack = [k], members = [];
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop();
      members.push(c);
      const i = Math.floor(c / n), j = c % n;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const q = a * n + b;
          if (!seen[q] && z[q] >= threshold) { seen[q] = 1; stack.push(q); }
        }
    }
    if (members.length < 2) continue; // ignore single-cell noise
    const avg = (fn) => members.reduce((s, m) => s + fn(m), 0) / members.length;
    const lats = members.map((m) => cells[m].bounds), pop = members.reduce((s, m) => s + features[m].population, 0);
    zones.push({
      cellIds: members,
      cells: members.length,
      areaHa: +((members.length * grid.cellArea) / 1e4).toFixed(1),
      centroid: [avg((m) => cells[m].lat), avg((m) => cells[m].lon)],
      bounds: [
        [Math.min(...lats.map((b) => b[0][0])), Math.min(...lats.map((b) => b[0][1]))],
        [Math.max(...lats.map((b) => b[1][0])), Math.max(...lats.map((b) => b[1][1]))],
      ],
      meanZ: +avg((m) => z[m]).toFixed(2),
      maxZ: +Math.max(...members.map((m) => z[m])).toFixed(2),
      meanSurface: +avg((m) => model.surface[m]).toFixed(1),
      maxSurface: +Math.max(...members.map((m) => model.surface[m])).toFixed(1),
      meanAir: +avg((m) => model.air[m]).toFixed(2),
      meanFelt: +avg((m) => model.felt[m]).toFixed(1),
      meanHVI: +avg((m) => model.hvi[m]).toFixed(1),
      impervious: +avg((m) => features[m].impervious).toFixed(2),
      roof: +avg((m) => features[m].roof).toFixed(2),
      road: +avg((m) => features[m].road).toFixed(2),
      vegetation: +avg((m) => features[m].veg).toFixed(2),
      canopy: +avg((m) => features[m].canopy).toFixed(2),
      water: +avg((m) => features[m].water).toFixed(3),
      buildings: Math.round(members.reduce((s, m) => s + features[m].buildings, 0)),
      populationProxy: Math.round(pop),
    });
  }
  // severity: heat x people x vulnerability
  for (const zn of zones) zn.severity = +(zn.meanZ * (zn.meanHVI / 50) * Math.log10(10 + zn.populationProxy)).toFixed(2);
  zones.sort((a, b) => b.severity - a.severity);
  zones.forEach((zn, idx) => { zn.id = idx + 1; zn.name = `Zone ${String.fromCharCode(65 + (idx % 26))}${idx >= 26 ? Math.floor(idx / 26) : ''}`; });
  return zones;
}
