import { Database, FlaskConical, Calculator, AlertTriangle, Sparkles } from 'lucide-react';
import { useApp } from '../state.jsx';
import { Card, SourceBadge } from '../components/ui.jsx';
import { SURFACE_EXCESS } from '../lib/model.js';
import { ASSUMPTIONS } from '../lib/features.js';
import { INTERVENTIONS } from '../lib/optimizer.js';
import { fmtNum } from '../lib/format.js';

const Code = ({ children }) => <code className="rounded bg-raised/60 px-1.5 py-0.5 text-[12px] text-accent">{children}</code>;

export default function Methods() {
  const { env, grid } = useApp();
  const p = env.provenance;
  const lc = env.landcover;
  const rows = [
    ['Weather & climate', p.weather.source, p.weather.label, p.weather.fallbackReason],
    ['Buildings, roads, parks, water, trees', p.landcover.source, p.landcover.label + (p.landcover.osmTimestamp ? ` · OSM snapshot ${p.landcover.osmTimestamp}` : ''), p.landcover.fallbackReason],
    ['Population exposure', 'proxy', p.population.label],
    ['Surface / air / felt temperature', 'model', p.surfaceTemperature.label],
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Data provenance (this session)" icon={Database} className="xl:col-span-2">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([what, src, label, why]) => (
              <tr key={what} className="border-b border-rule last:border-0">
                <td className="w-64 py-2 pr-3 font-medium text-ink">{what}</td>
                <td className="w-32 py-2 pr-3"><SourceBadge source={src}>{src}</SourceBadge></td>
                <td className="py-2 text-ink-2">{label}{why && <div className="text-xs text-warn">Fallback reason: {why}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lc.counts && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-3">
            {Object.entries(lc.counts).map(([k, v]) => <span key={k} className="rounded bg-raised/60 px-2 py-1">{k}: {fmtNum(v)}</span>)}
            <span className="rounded bg-raised/60 px-2 py-1">grid: {grid.n}×{grid.n} cells of ~{Math.round(grid.cellW)}×{Math.round(grid.cellH)} m</span>
          </div>
        )}
      </Card>

      <Card title="Heat model (runs in your browser)" icon={FlaskConical}>
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p><b className="text-ink">1. Rasterisation.</b> OSM features are rasterised onto the grid: building centroids × {ASSUMPTIONS.FOOTPRINT_M2} m² mean footprint → roof share; road centrelines × class width → road share; park/water polygons by 6×6 point sampling; tree nodes × {ASSUMPTIONS.TREE_CANOPY_M2} m² canopy.</p>
          <p><b className="text-ink">2. Surface temperature.</b> <Code>Ts = Ta + R · Σ fᵢ · ΔTᵢ</Code> where fᵢ are surface fractions, R is the solar factor (peak shortwave / 900 W·m⁻²) and ΔTᵢ the full-sun excess of each surface type. Albedo changes scale roof/road excess by (1−α)/(1−α₀); canopy shades ground below it.</p>
          <p><b className="text-ink">3. Air temperature.</b> <Code>Ta,cell = Ta,scenario + IDW offset + k · R · (0.6·smoothed + 0.4·local excess − 5)</Code>, with k = 0.26/(1 + wind/25). Spatial offsets come from 9 Open-Meteo sample points.</p>
          <p><b className="text-ink">4. Felt temperature.</b> NOAA Rothfusz heat index of local air temp and RH, plus a radiant term <Code>0.12 · R · excess · (1 − 0.7·shade)</Code>.</p>
          <p><b className="text-ink">5. Vulnerability (HVI).</b> 50% exposure (felt temp, normalised) + 30% sensitivity (√population proxy) + 20% lack of green access (2-cell neighbourhood).</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(SURFACE_EXCESS).map(([k, v]) => <span key={k} className="rounded bg-raised/60 px-2 py-1">{k}: {v > 0 ? '+' : ''}{v} °C</span>)}
          </div>
        </div>
      </Card>

      <Card title="Hotspots & optimisation (local)" icon={Calculator}>
        <div className="space-y-3 text-sm leading-relaxed text-ink-2">
          <p><b className="text-ink">Getis-Ord Gi*.</b> For each cell, <Code>Gi* = (Σwⱼxⱼ − x̄Σwⱼ) / (S·√((nΣwⱼ² − (Σwⱼ)²)/(n−1)))</Code> with binary weights in a 5×5 cell band. Cells with z ≥ 1.96 (95%) are joined by 8-connectivity into zones; severity = z̄ × HVI/50 × log₁₀(10 + people).</p>
          <p><b className="text-ink">Budget optimiser.</b> Each (cell, intervention) has discrete levels with feasibility limits. A greedy knapsack repeatedly funds the step with the highest <Code>weight × Δfelt / Δcost</Code> that fits the remaining budget, then re-evaluates that cell (diminishing returns). Weights: people (max cooling), people × (1 + HVI/50)² (equity), or hotspot-only.</p>
          <table className="w-full text-xs">
            <thead className="text-left text-ink-3"><tr><th className="py-1">Intervention</th><th>Default unit cost</th><th>Step</th></tr></thead>
            <tbody>
              {INTERVENTIONS.map((iv) => (
                <tr key={iv.id} className="border-t border-rule"><td className="py-1 text-ink">{iv.name}</td><td>${iv.unitCost}/{iv.unit}</td><td className="text-ink-3">{iv.desc}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Role of AI (Google Gemini)" icon={Sparkles}>
        <p className="text-sm leading-relaxed text-ink-2">
          Gemini never computes the numbers. The browser sends the locally computed statistics to the COOLTRACE backend, which adds the API key from its
          <Code>.env</Code> file and asks Gemini for structured JSON explanations, insights, plan reviews and answers. The key is never sent to the browser.
        </p>
      </Card>

      <Card title="Limitations" icon={AlertTriangle}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Temperatures are screening-level model estimates, not satellite land-surface temperature or sensor measurements.</li>
          <li>OSM completeness varies by city; unmapped buildings or trees bias impervious/green shares. Large park relations are included when mapped.</li>
          <li>Population is a building-floor-area proxy ({ASSUMPTIONS.M2_PER_PERSON} m²/person), not census data.</li>
          <li>Intervention costs are indicative USD defaults - edit them in the optimiser to match local prices.</li>
          <li>Synthetic fallback data, when used, is clearly badged and only demonstrates the workflow.</li>
        </ul>
      </Card>
    </div>
  );
}
