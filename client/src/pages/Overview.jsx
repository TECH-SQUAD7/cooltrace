import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import { Layers, Activity, CalendarDays, BarChart3, MousePointerClick, PieChart as PieIcon } from 'lucide-react';
import { useApp } from '../state.jsx';
import HeatMap from '../components/HeatMap.jsx';
import { Card, Stat, Readout, Segmented, Notice } from '../components/ui.jsx';
import { LAYERS, layerData } from '../lib/layers.js';
import { classifyZ } from '../lib/hotspots.js';
import { axis, gridProps, tooltipProps, legendProps, histogram } from '../components/charts.jsx';
import { fmtC, fmtNum, fmtPct } from '../lib/format.js';

export function CellInspector({ k }) {
  const { features, baseline, z, grid } = useApp();
  if (k == null || k < 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <MousePointerClick className="h-4 w-4" /> Hover or click the map to inspect a 125 m cell.
      </div>
    );
  }
  const f = features[k];
  const c = grid.cells[k];
  const row = (l, v) => (
    <div className="flex justify-between py-0.5"><span className="text-ink-3">{l}</span><span className="font-medium text-ink">{v}</span></div>
  );
  return (
    <div className="text-sm">
      <div className="mb-1 text-xs text-ink-3">Cell {k} · {c.lat.toFixed(4)}, {c.lon.toFixed(4)}</div>
      {row('Surface temp', fmtC(baseline.surface[k]))}
      {row('Air temp', fmtC(baseline.air[k], 2))}
      {row('Felt (heat index)', fmtC(baseline.felt[k]))}
      {row('Vulnerability', baseline.hvi[k].toFixed(0) + ' / 100')}
      {row('Gi* z-score', `${z[k].toFixed(2)} · ${classifyZ(z[k]).label}`)}
      <div className="my-1.5 border-t border-rule" />
      {row('Roofs', fmtPct(f.roof))}
      {row('Roads', fmtPct(f.road))}
      {row('Vegetation', fmtPct(f.veg))}
      {row('Tree canopy', fmtPct(f.canopy))}
      {row('Water', fmtPct(f.water))}
      {row('Buildings (OSM)', fmtNum(f.buildings))}
      {row('People (proxy)', fmtNum(f.population))}
    </div>
  );
}

export default function Overview() {
  const app = useApp();
  const { grid, features, baseline, z, zones, env, scenario } = app;
  const [layer, setLayer] = useState('surface');
  const [smooth, setSmooth] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [hover, setHover] = useState(-1);
  const [picked, setPicked] = useState(-1);
  const L = useMemo(() => layerData(layer, { model: baseline, features, z }), [layer, baseline, features, z]);
  const s = baseline.stats;
  const wx = env.weather;

  const forecast = useMemo(() => (wx.daily || []).map((d) => ({ date: d.date.slice(5), Max: d.tmax, Min: d.tmin, 'Feels-like max': d.apparentMax })), [wx]);
  const hourly = useMemo(() => {
    const now = new Date().toISOString().slice(0, 13);
    return (wx.hourly || []).filter((h) => h.time.slice(0, 13) >= now).slice(0, 48).map((h) => ({ t: h.time.slice(5, 13).replace('T', ' '), Temp: h.temp, 'Feels like': h.apparent }));
  }, [wx]);
  const hist = useMemo(() => histogram({ Cells: baseline.surface }, 18), [baseline]);
  const cover = useMemo(() => {
    const m = (fn) => features.reduce((a, f) => a + fn(f), 0) / features.length;
    return [
      { name: 'Roofs', value: m((f) => f.roof), color: '#c2341b' },
      { name: 'Roads', value: m((f) => f.road), color: '#5a6873' },
      { name: 'Other paved', value: m((f) => f.other * f.pavedShare), color: '#9aa5ab' },
      { name: 'Bare / unsealed', value: m((f) => f.other * (1 - f.pavedShare)), color: '#c9a26b' },
      { name: 'Vegetation', value: m((f) => f.veg), color: '#1d7a4c' },
      { name: 'Water', value: m((f) => f.water), color: '#1f4fd1' },
    ].filter((x) => x.value > 0.001);
  }, [features]);

  return (
    <div className="space-y-4">
      <Readout cols="md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Mean surface temp" value={fmtC(s.meanSurface)} sub={`max ${fmtC(s.maxSurface)}`} tone="hot" />
        <Stat label="Air temp range" value={`${s.minAir.toFixed(1)}–${s.maxAir.toFixed(1)}°`} sub={`UHI P95-P5: ${s.uhiIntensity.toFixed(1)} °C`} />
        <Stat label="Pop-weighted felt" value={fmtC(s.popWeightedFelt)} sub={`peak ${fmtC(s.maxFelt)}`} tone="hot" />
        <Stat label={`People ≥ ${s.extremeThreshold}°C felt`} value={fmtNum(s.popExtreme)} sub={`of ${fmtNum(s.totalPopProxy)} (proxy)`} />
        <Stat label="Hotspot zones" value={zones.length} sub={`${zones.reduce((a, b) => a + b.cells, 0)} cells, Gi* ≥ 1.96`} />
        <Stat label="Green cover" value={fmtPct(s.meanVeg)} sub={`impervious ${fmtPct(s.meanImpervious)}`} tone="good" />
      </Readout>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card
          title="Urban heat map"
          icon={Layers}
          bodyClass="p-3"
          actions={
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <label className="flex items-center gap-1"><input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Zones</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Smooth</label>
            </div>
          }
        >
          <div className="mb-3 overflow-x-auto">
            <Segmented options={LAYERS.map((l) => ({ value: l.id, label: l.short }))} value={layer} onChange={setLayer} />
          </div>
          <HeatMap
            grid={grid}
            values={L.values}
            ramp={L.ramp}
            domain={L.domain}
            label={L.label}
            format={L.format}
            smooth={smooth}
            zones={showZones ? zones : []}
            onHover={setHover}
            onCellClick={setPicked}
            selectedCell={picked}
            revealKey={`${app.city.name}-${scenario.id}-${layer}`}
            height={560}
          />
          <div className="mt-2 text-xs text-ink-3">
            Scenario: <span className="text-ink-2">{scenario.label}</span> · air {scenario.airTemp}°C, RH {Math.round(scenario.rh)}%, solar factor {scenario.radiationFactor.toFixed(2)}. {scenario.note}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Cell inspector" icon={MousePointerClick}>
            <CellInspector k={hover >= 0 ? hover : picked} />
          </Card>
          <Card title="Land cover mix" icon={PieIcon} bodyClass="p-2">
            <div className="h-44">
              <ResponsiveContainer>
                <PieChart>
                  <Pie isAnimationActive={false} data={cover} dataKey="value" nameKey="name" innerRadius={38} outerRadius={64} paddingAngle={1} stroke="#f8faf9">
                    {cover.map((c) => <Cell key={c.name} fill={c.color} />)}
                  </Pie>
                  <Tooltip {...tooltipProps} formatter={(v) => fmtPct(v, 1)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-2 pb-1 text-[11px]">
              {cover.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.color }} /> {c.name} <span className="ml-auto text-ink-3">{fmtPct(c.value)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {env.provenance.landcover.source === 'synthetic' && (
        <Notice tone="warn">
          Land cover is SYNTHETIC demonstration data because OpenStreetMap could not be reached ({env.provenance.landcover.fallbackReason || 'requested'}). Results illustrate the workflow only.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Next 48 h (Open-Meteo forecast)" icon={Activity} bodyClass="p-2">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={hourly} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axis} interval={7} />
                <YAxis {...axis} unit="°" domain={['auto', 'auto']} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendProps} />
                <Line isAnimationActive={false} type="monotone" dataKey="Temp" stroke="#e8833a" dot={false} strokeWidth={2} />
                <Line isAnimationActive={false} type="monotone" dataKey="Feels like" stroke="#c2341b" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Past 30 days + 7-day outlook" icon={CalendarDays} bodyClass="p-2">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={forecast} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axis} interval={6} />
                <YAxis {...axis} unit="°" domain={['auto', 'auto']} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendProps} />
                <Line isAnimationActive={false} type="monotone" dataKey="Max" stroke="#c2341b" dot={false} strokeWidth={2} />
                <Line isAnimationActive={false} type="monotone" dataKey="Min" stroke="#1f4fd1" dot={false} strokeWidth={1.5} />
                <Line isAnimationActive={false} type="monotone" dataKey="Feels-like max" stroke="#b7791f" dot={false} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={wx.monthly?.length ? '12-month daily max (ERA5)' : 'Surface temperature distribution'} icon={BarChart3} bodyClass="p-2">
          <div className="h-56">
            <ResponsiveContainer>
              {wx.monthly?.length ? (
                <BarChart data={wx.monthly.map((m) => ({ month: m.month.slice(2), 'Avg max': m.avgMax, 'Record max': m.max }))} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axis} />
                  <YAxis {...axis} unit="°" />
                  <Tooltip {...tooltipProps} />
                  <Legend {...legendProps} />
                  <Bar isAnimationActive={false} dataKey="Avg max" fill="#e8833a" radius={[3, 3, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="Record max" fill="#8f1d12" radius={[3, 3, 0, 0]} />
                </BarChart>
              ) : (
                <BarChart data={hist}><XAxis dataKey="bin" {...axis} /><YAxis {...axis} /><Bar isAnimationActive={false} dataKey="Cells" fill="#e8833a" /></BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Modelled surface temperature distribution (all 784 cells)" icon={BarChart3} bodyClass="p-2">
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={hist} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bin" {...axis} unit="°" />
              <YAxis {...axis} />
              <Tooltip {...tooltipProps} labelFormatter={(l) => `≥ ${l} °C`} />
              <Bar isAnimationActive={false} dataKey="Cells" fill="#e8833a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
