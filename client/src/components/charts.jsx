// Shared Recharts styling (atlas theme) + small helpers
export const INK = { ink: '#15222c', ink2: '#3c4a55', ink3: '#5a6873', rule: '#d2d8d5', accent: '#1f4fd1', hot: '#c2341b', warm: '#e8833a', good: '#1d7a4c' };
export const axis = { tick: { fill: INK.ink3, fontSize: 11 }, stroke: INK.rule, tickLine: false };
export const gridProps = { stroke: INK.rule, strokeDasharray: '2 4', vertical: false };
export const tooltipProps = {
  contentStyle: { background: '#f8faf9', border: `1px solid ${INK.rule}`, borderRadius: 3, fontSize: 12, color: INK.ink, boxShadow: '0 8px 24px -12px rgba(21,34,44,.35)' },
  labelStyle: { color: INK.ink, fontWeight: 600 },
  itemStyle: { color: INK.ink2 },
  cursor: { fill: 'rgba(21,34,44,0.05)' },
};
export const legendProps = { wrapperStyle: { fontSize: 12, color: INK.ink2 }, iconType: 'plainline' };

/** Histogram bins for one or more series sharing the same bin edges. */
export function histogram(seriesMap, bins = 16) {
  const all = Object.values(seriesMap).flatMap((a) => Array.from(a));
  const lo = Math.floor(Math.min(...all)), hi = Math.ceil(Math.max(...all));
  const w = Math.max(0.25, (hi - lo) / bins);
  const rows = Array.from({ length: bins }, (_, b) => ({ bin: `${(lo + b * w).toFixed(1)}`, from: lo + b * w }));
  for (const [key, arr] of Object.entries(seriesMap)) {
    rows.forEach((r) => (r[key] = 0));
    for (const v of arr) rows[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))][key] += 1;
  }
  return rows;
}
