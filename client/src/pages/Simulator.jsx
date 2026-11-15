import { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { SplitSquareHorizontal, SlidersHorizontal, BarChart3, Table2, ArrowRight } from 'lucide-react';
import { useApp } from '../state.jsx';
import HeatMap from '../components/HeatMap.jsx';
import { Card, Segmented, Stat, Readout, Notice } from '../components/ui.jsx';
import { INTERVENTIONS, manualPlan } from '../lib/optimizer.js';
import { runModel } from '../lib/model.js';
import { compareOutcomes } from '../lib/outcomes.js';
import { minmax } from '../lib/layers.js';
import { axis, gridProps, tooltipProps, legendProps, histogram } from '../components/charts.jsx';
import { fmtUSD, fmtNum, fmtC } from '../lib/format.js';

const VARS = [
  { value: 'surface', label: 'Surface' },
  { value: 'air', label: 'Air' },
  { value: 'felt', label: 'Felt' },
  { value: 'hvi', label: 'Vulnerability' },
];

export default function Simulator({ goTo }) {
  const app = useApp();
  const { grid, features, baseline, scenario, plan, hotspotCells, optSettings, zones } = app;
  const [source, setSource] = useState(plan ? 'optimised' : 'manual');
  const [coverage, setCoverage] = useState({ trees: 0.5, coolRoof: 0.5, greenRoof: 0, coolPave: 0.25, pocketPark: 0, shade: 0 });
  const [target, setTarget] = useState('all');
  const [variable, setVariable] = useState('surface');
  const [view, setView] = useState('split');
  const syncGroup = useMemo(() => ({ maps: new Set(), lock: false }), []);

  const manual = useMemo(
    () => manualPlan({ grid, features, coverage, costs: optSettings.costs, targetCells: target === 'hotspots' ? hotspotCells : null }),
    [grid, features, coverage, optSettings.costs, target, hotspotCells]
  );
  const active = source === 'optimised' && plan ? plan : manual;
  const after = useMemo(() => runModel(grid, features, scenario, active.mods, baseline.range), [grid, features, scenario, active, baseline]);
  const out = useMemo(() => compareOutcomes(baseline, after, features), [baseline, after, features]);

  const domain = useMemo(() => {
    if (variable === 'hvi') return [0, 100];
    const [a, b] = minmax(baseline[variable]);
    const [c] = minmax(after[variable]);
    return [Math.min(a, c), b];
  }, [variable, baseline, after]);
  const diff = useMemo(() => Float64Array.from(baseline[variable], (v, k) => v - after[variable][k]), [baseline, after, variable]);
  const diffMax = Math.max(0.05, ...diff);

  const hist = useMemo(() => histogram({ Before: baseline.felt, After: after.felt }, 14), [baseline, after]);
  const fmt = variable === 'hvi' ? (v) => v.toFixed(0) : (v) => `${v.toFixed(1)}°`;
  const label = { surface: 'Surface temperature (°C)', air: 'Air temperature (°C)', felt: 'Felt temperature (°C)', hvi: 'Heat vulnerability (0-100)' }[variable];

  const rows = [
    ['Mean surface temperature', baseline.stats.meanSurface, after.stats.meanSurface, '°C'],
    ['Max surface temperature', baseline.stats.maxSurface, after.stats.maxSurface, '°C'],
    ['Mean air temperature', baseline.stats.meanAir, after.stats.meanAir, '°C'],
    ['Max air temperature', baseline.stats.maxAir, after.stats.maxAir, '°C'],
    ['People-weighted felt temp', baseline.stats.popWeightedFelt, after.stats.popWeightedFelt, '°C'],
    ['Peak felt temperature', baseline.stats.maxFelt, after.stats.maxFelt, '°C'],
    ['Mean vulnerability (HVI)', baseline.stats.meanHVI, after.stats.meanHVI, ''],
    [`People with felt ≥ ${baseline.stats.extremeThreshold}°C (proxy)`, baseline.stats.popExtreme, after.stats.popExtreme, 'ppl'],
    [`Cells above baseline P90 surface (${out.p90Threshold.toFixed(1)}°C)`, out.hotCellsBefore, out.hotCellsAfter, 'cells'],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card title="Scenario" icon={SlidersHorizontal}>
          <div className="space-y-4">
            <Segmented
              options={[{ value: 'optimised', label: 'Optimised plan' }, { value: 'manual', label: 'Manual scenario' }]}
              value={source}
              onChange={setSource}
              size="md"
            />
            {source === 'optimised' && !plan && (
              <Notice tone="warn">
                No optimised plan yet.{' '}
                <button className="text-hot underline" onClick={() => goTo('optimiser')}>Run the budget optimiser</button> or use a manual scenario.
              </Notice>
            )}
            {source === 'optimised' && plan && (
              <div className="rounded-[3px] border border-rule bg-raised/60 p-3 text-sm">
                <div className="text-ink-2">{fmtUSD(plan.total)} · {plan.strategy} strategy · {plan.cellsTreated} cells</div>
                <ul className="mt-2 space-y-1 text-xs text-ink-3">
                  {plan.byType.map((b) => <li key={b.id} className="flex justify-between"><span>{b.name}</span><span>{fmtUSD(b.cost)}</span></li>)}
                </ul>
                <button className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => goTo('optimiser')}>Adjust in optimiser <ArrowRight className="h-3 w-3" /></button>
              </div>
            )}
            {source === 'manual' && (
              <>
                <div>
                  <div className="label mb-1.5">Apply to</div>
                  <Segmented options={[{ value: 'all', label: 'Whole area' }, { value: 'hotspots', label: `Hotspot zones (${zones.length})` }]} value={target} onChange={setTarget} />
                </div>
                <div className="space-y-3">
                  {INTERVENTIONS.map((iv) => (
                    <label key={iv.id} className="block" title={iv.desc}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-ink"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: iv.color }} />{iv.name}</span>
                        <span className="text-xs text-ink-3">{Math.round((coverage[iv.id] || 0) * 100)}% of feasible</span>
                      </div>
                      <input type="range" className="w-full" min={0} max={1} step={0.05} value={coverage[iv.id] || 0}
                        onChange={(e) => setCoverage((c) => ({ ...c, [iv.id]: +e.target.value }))} aria-label={`${iv.name} coverage`} />
                    </label>
                  ))}
                </div>
                <div className="rounded-[3px] border border-rule bg-raised/60 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink-3">Estimated cost</span><span className="font-semibold text-ink">{fmtUSD(manual.total)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-3">Cells treated</span><span>{manual.cellsTreated}</span></div>
                </div>
              </>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Readout cols="lg:grid-cols-4">
            <Stat label="Mean surface cooling" value={`−${out.dMeanSurface.toFixed(2)} °C`} sub={`up to −${out.maxLocalSurfaceCooling.toFixed(1)} °C locally`} tone="cool" />
            <Stat label="Mean air cooling" value={`−${out.dMeanAir.toFixed(2)} °C`} sub={`hottest cell −${out.dMaxAir.toFixed(2)} °C`} tone="cool" />
            <Stat label="People-weighted felt" value={`−${out.dPopFelt.toFixed(2)} °C`} sub={`HVI −${out.dHVI.toFixed(1)} pts`} tone="cool" />
            <Stat label="People out of extreme heat" value={fmtNum(out.popExtremeBefore - out.popExtremeAfter)} sub={`${fmtNum(out.popExtremeAfter)} remain (proxy)`} tone="good" />
      </Readout>
          <Card
            title="Before / after"
            icon={SplitSquareHorizontal}
            bodyClass="p-3"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented options={VARS} value={variable} onChange={setVariable} />
                <Segmented options={[{ value: 'split', label: 'Side by side' }, { value: 'diff', label: 'Cooling map' }]} value={view} onChange={setView} />
              </div>
            }
          >
            {view === 'split' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <HeatMap grid={grid} values={baseline[variable]} domain={domain} ramp={variable === 'hvi' ? 'vuln' : 'heat'} label={label} format={fmt} syncGroup={syncGroup} title="BEFORE" height={460} />
                <HeatMap grid={grid} values={after[variable]} domain={domain} ramp={variable === 'hvi' ? 'vuln' : 'heat'} label={label} format={fmt} syncGroup={syncGroup} title="AFTER" height={460} />
              </div>
            ) : (
              <HeatMap grid={grid} values={diff} domain={[0, diffMax]} ramp="cooling" label={`Reduction in ${label.charAt(0).toLowerCase()}${label.slice(1)}`} format={(v) => `−${v.toFixed(2)}`} title="COOLING ACHIEVED" height={460} />
            )}
            <div className="mt-2 text-xs text-ink-3">Both maps share one colour scale. Pan/zoom is synchronised. Scenario: {scenario.label}.</div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Felt temperature distribution (cells)" icon={BarChart3} bodyClass="p-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bin" {...axis} unit="°" />
                <YAxis {...axis} />
                <Tooltip {...tooltipProps} labelFormatter={(l) => `≥ ${l} °C`} />
                <Legend {...legendProps} />
                <Bar isAnimationActive={false} dataKey="Before" fill="#c2341b" radius={[3, 3, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="After" fill="#1f4fd1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Outcome table" icon={Table2} bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-raised/60 text-left text-[11px]  text-ink-3">
              <tr><th className="px-3 py-2">Metric</th><th className="px-3 py-2 text-right">Before</th><th className="px-3 py-2 text-right">After</th><th className="px-3 py-2 text-right">Change</th></tr>
            </thead>
            <tbody>
              {rows.map(([m, b, a, u]) => {
                const d = a - b;
                const f = (v) => (u === '°C' ? fmtC(v, 2) : fmtNum(v));
                return (
                  <tr key={m} className="border-t border-rule">
                    <td className="px-3 py-2 text-ink-2">{m}</td>
                    <td className="px-3 py-2 text-right">{f(b)}</td>
                    <td className="px-3 py-2 text-right">{f(a)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${d < 0 ? 'text-cool' : d > 0 ? 'text-hot' : 'text-ink-3'}`}>{d > 0 ? '+' : ''}{u === '°C' ? d.toFixed(2) : fmtNum(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
