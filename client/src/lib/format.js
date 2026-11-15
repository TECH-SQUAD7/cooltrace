export const fmtC = (v, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)} °C` : '–');
export const fmtPct = (v, d = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');
export const fmtNum = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '–');
export const fmtUSD = (v) => {
  if (!Number.isFinite(v)) return '–';
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${Math.round(v)}`;
};
