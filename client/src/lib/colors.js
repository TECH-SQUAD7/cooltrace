// Colour ramps for map layers (sequential + diverging), interpolated in RGB.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export const RAMPS = {
  heat: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
  vuln: ['#1a1a2e', '#3b1f5c', '#6a1b7a', '#9c2a6f', '#cc4a4a', '#ec7a2d', '#fbb41a'],
  green: ['#3f2a14', '#7a5a2a', '#b8a24a', '#7fbf5a', '#2f9e44', '#0b6e2e'],
  gray: ['#1f2937', '#4b5563', '#9ca3af', '#d1d5db', '#f3f4f6'],
  diverging: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
  cooling: ['#f7f7f7', '#c6e9f5', '#7ccbe8', '#3aa0d6', '#1f6bb3', '#0b3d8c'],
};

export function rampColor(ramp, t) {
  const stops = RAMPS[ramp];
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  const f = x - i;
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

export function rampGradient(ramp) {
  return `linear-gradient(to right, ${RAMPS[ramp].join(', ')})`;
}
