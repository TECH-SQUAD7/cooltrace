import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, ImageOverlay, Polyline, Rectangle, CircleMarker, Tooltip, Pane, useMap, useMapEvents } from 'react-leaflet';
import { RAMPS, rampColor } from '../lib/colors.js';
import { cellIndex } from '../lib/features.js';

/** Render a gridded field to a PNG data URL (one pixel per cell). */
function fieldToDataURL(grid, values, ramp, [lo, hi], mask) {
  const { n } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const c = rampColor(ramp, (values[k] - lo) / (hi - lo || 1));
      const p = ((n - 1 - i) * n + j) * 4; // row 0 of the grid is the southern edge
      img.data[p] = parseInt(c.slice(1, 3), 16);
      img.data[p + 1] = parseInt(c.slice(3, 5), 16);
      img.data[p + 2] = parseInt(c.slice(5, 7), 16);
      img.data[p + 3] = mask && !mask(k) ? 0 : 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Boundary segments of a set of grid cells (for zone outlines). */
export function zoneEdges(grid, cellIds) {
  const set = new Set(cellIds);
  const { n, bbox, dLat, dLon } = grid;
  const segs = [];
  for (const k of cellIds) {
    const i = Math.floor(k / n), j = k % n;
    const s = bbox.south + i * dLat, w = bbox.west + j * dLon, N = s + dLat, E = w + dLon;
    if (i === 0 || !set.has(k - n)) segs.push([[s, w], [s, E]]);
    if (i === n - 1 || !set.has(k + n)) segs.push([[N, w], [N, E]]);
    if (j === 0 || !set.has(k - 1)) segs.push([[s, w], [N, w]]);
    if (j === n - 1 || !set.has(k + 1)) segs.push([[s, E], [N, E]]);
  }
  return segs;
}

function FitBounds({ bbox }) {
  const map = useMap();
  const key = `${bbox.south},${bbox.west}`;
  useEffect(() => {
    map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]], { padding: [10, 10], animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function Interaction({ grid, onHover, onClick }) {
  const frame = useRef(0);
  useMapEvents({
    mousemove(e) {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => onHover(cellIndex(grid, e.latlng.lat, e.latlng.lng)));
    },
    mouseout() { onHover(-1); },
    click(e) {
      const k = cellIndex(grid, e.latlng.lat, e.latlng.lng);
      if (k >= 0) onClick?.(k);
    },
  });
  return null;
}

/** Keeps several maps in the same view (before/after comparison). */
function Sync({ group }) {
  const map = useMap();
  useEffect(() => {
    if (!group) return;
    group.maps.add(map);
    const onMove = () => {
      if (group.lock) return;
      group.lock = true;
      for (const m of group.maps) if (m !== map) m.setView(map.getCenter(), map.getZoom(), { animate: false });
      group.lock = false;
    };
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
      group.maps.delete(map);
    };
  }, [group, map]);
  return null;
}

/** Thermal-camera style vertical scale with a live cursor readout. */
export function ScaleBar({ ramp, domain, label, format = (v) => v.toFixed(1), value = null }) {
  const [lo, hi] = domain;
  const t = value == null ? null : Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const stops = RAMPS[ramp];
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-[500] flex w-[150px] flex-col items-end">
      <div
        className={`wide mb-2 rounded-[2px] bg-ink px-2 py-1 text-right text-[22px] font-bold leading-none tracking-[-0.03em] text-surface transition-opacity ${value == null ? 'opacity-0' : 'opacity-100'}`}
        aria-live="polite"
      >
        {value == null ? '–' : format(value)}
      </div>
      <div className="relative flex min-h-0 flex-1 gap-1.5">
        <div className="flex flex-col justify-between text-right text-[11px] font-semibold text-ink [text-shadow:0_0_3px_#f8faf9,0_0_3px_#f8faf9,0_0_3px_#f8faf9]">
          <span>{format(hi)}</span>
          <span>{format((lo + hi) / 2)}</span>
          <span>{format(lo)}</span>
        </div>
        <div className="relative w-3 rounded-[2px] ring-1 ring-ink/30" style={{ background: `linear-gradient(to top, ${stops.join(', ')})` }}>
          {t != null && (
            <div className="absolute -left-1.5 -right-1.5 h-[3px] bg-ink ring-1 ring-surface" style={{ bottom: `calc(${t * 100}% - 1.5px)` }} />
          )}
        </div>
      </div>
      <div className="mt-2 rounded-[2px] bg-surface/90 px-1.5 py-0.5 text-right text-[11px] leading-tight text-ink-2">{label}</div>
    </div>
  );
}

export default function HeatMap({
  grid, values, ramp = 'heat', domain, label, format, zones = [], selectedZone = null, onZoneClick,
  onHover, onCellClick, selectedCell = -1, height = 520, smooth = true, syncGroup, mask, opacity = 0.8, children, title,
  revealKey,
}) {
  const url = useMemo(() => (values ? fieldToDataURL(grid, values, ramp, domain, mask) : null), [grid, values, ramp, domain, mask]);
  const bounds = [[grid.bbox.south, grid.bbox.west], [grid.bbox.north, grid.bbox.east]];
  const outlines = useMemo(() => zones.map((z) => ({ z, segs: zoneEdges(grid, z.cellIds) })), [zones, grid]);
  const sel = selectedCell >= 0 ? grid.cells[selectedCell] : null;
  const [hover, setHover] = useState(-1);

  // Signature reveal: replay the "develop" animation whenever the dataset changes
  const [revealing, setRevealing] = useState(Boolean(revealKey));
  useEffect(() => {
    if (!revealKey) return undefined;
    setRevealing(true);
    const t = setTimeout(() => setRevealing(false), 1800);
    return () => clearTimeout(t);
  }, [revealKey]);

  const handleHover = (k) => {
    setHover(k);
    onHover?.(k);
  };

  return (
    <div className={`relative overflow-hidden rounded-[3px] border border-rule-strong ${revealing ? 'ct-develop' : ''}`} style={{ height }}>
      {title && (
        <div className="wide pointer-events-none absolute left-14 top-3 z-[500] rounded-[2px] bg-ink px-2 py-1 text-[12px] font-bold tracking-[0.02em] text-surface">
          {title}
        </div>
      )}
      {revealing && <div className="ct-scanline" />}
      <MapContainer bounds={bounds} className="h-full w-full" zoomSnap={0.25} scrollWheelZoom attributionControl>
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution='Basemap &copy; Esri &middot; Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Open-Meteo'
          maxNativeZoom={16}
          maxZoom={19}
        />
        {url && <ImageOverlay url={url} bounds={bounds} opacity={opacity} className={smooth ? 'ct-smooth' : 'ct-pixel'} />}
        <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={16} maxZoom={19} />
        </Pane>
        <Rectangle bounds={bounds} pathOptions={{ color: '#15222c', weight: 1, fill: false, dashArray: '2 4', opacity: 0.6 }} interactive={false} />
        {outlines.map(({ z, segs }) => (
          <Polyline
            key={z.id}
            positions={segs}
            pathOptions={{ color: '#15222c', weight: selectedZone === z.id ? 3 : 1.5, opacity: selectedZone === z.id ? 1 : 0.75 }}
            eventHandlers={onZoneClick ? { click: () => onZoneClick(z.id) } : undefined}
          />
        ))}
        {zones.map((z) => (
          <CircleMarker
            key={`m${z.id}`}
            center={z.centroid}
            radius={selectedZone === z.id ? 6 : 4}
            pathOptions={{ color: '#f8faf9', weight: 2, fillColor: '#15222c', fillOpacity: 1 }}
            eventHandlers={onZoneClick ? { click: () => onZoneClick(z.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -5]} permanent={zones.length <= 8}>
              {z.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {sel && <Rectangle bounds={sel.bounds} pathOptions={{ color: '#1f4fd1', weight: 2.5, fill: false }} interactive={false} />}
        {hover >= 0 && hover !== selectedCell && (
          <Rectangle bounds={grid.cells[hover].bounds} pathOptions={{ color: '#15222c', weight: 1.5, fill: false }} interactive={false} />
        )}
        <FitBounds bbox={grid.bbox} />
        <Interaction grid={grid} onHover={handleHover} onClick={onCellClick} />
        <Sync group={syncGroup} />
        {children}
      </MapContainer>
      {domain && <ScaleBar ramp={ramp} domain={domain} label={label} format={format} value={hover >= 0 && values ? values[hover] : null} />}
    </div>
  );
}
