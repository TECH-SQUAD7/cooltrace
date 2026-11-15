import { useEffect, useState } from 'react';
import { Thermometer, Flame, Sparkles, Calculator, SplitSquareHorizontal, BookOpen, Search, MapPin, Loader2, X } from 'lucide-react';
import { AppProvider, useApp } from './state.jsx';
import { api } from './lib/api.js';
import { ErrorBanner, SourceBadge, Notice } from './components/ui.jsx';
import Overview from './pages/Overview.jsx';
import Hotspots from './pages/Hotspots.jsx';
import Insights from './pages/Insights.jsx';
import Optimiser from './pages/Optimiser.jsx';
import Simulator from './pages/Simulator.jsx';
import Methods from './pages/Methods.jsx';

const TABS = [
  { id: 'overview', label: 'Heat map', hint: 'Where it is hot', icon: Thermometer, C: Overview },
  { id: 'hotspots', label: 'Hotspots', hint: 'Significant clusters', icon: Flame, C: Hotspots },
  { id: 'insights', label: 'Briefing', hint: 'Gemini analysis', icon: Sparkles, C: Insights },
  { id: 'optimiser', label: 'Budget', hint: 'Allocate interventions', icon: Calculator, C: Optimiser },
  { id: 'simulator', label: 'Before and after', hint: 'Simulate cooling', icon: SplitSquareHorizontal, C: Simulator },
  { id: 'methods', label: 'Data and methods', hint: 'Sources, model, limits', icon: BookOpen, C: Methods },
];

/** Select styled as an inline word in the control sentence. */
function InlineSelect({ value, onChange, children, label, disabled, className = '' }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`cursor-pointer appearance-none border-0 border-b-2 border-ink bg-transparent px-0.5 pb-0.5 font-semibold text-ink outline-none transition-colors hover:border-accent focus-visible:border-accent disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  );
}

function ControlSentence() {
  const { city, setCity, loading, scenarios, scenarioId, setScenarioId, custom, setCustom } = useApp();
  const [presets, setPresets] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { api.cities().then((d) => setPresets(d.cities)).catch(() => setPresets([])); }, []);

  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true); setErr(null);
    try { setResults((await api.geocode(q.trim())).results); } catch (e2) { setErr(e2.message); setResults(null); } finally { setBusy(false); }
  };
  const presetId = presets.find((p) => p.lat === city.lat && p.lon === city.lon)?.id || '';
  const sc = scenarios.find((s) => s.id === scenarioId);

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2 text-[19px] leading-snug text-ink-2 md:text-[22px]">
      <span>Heat in</span>
      <InlineSelect label="City" value={presetId} disabled={loading} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) setCity(p); }}>
        {!presetId && <option value="">{city.name}</option>}
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </InlineSelect>
      <span className="relative">
        <button className="inline-flex translate-y-[2px] items-center gap-1 rounded-[3px] px-1.5 py-1 text-[13px] font-medium text-ink-3 hover:bg-raised hover:text-ink" onClick={() => setSearchOpen((v) => !v)} aria-expanded={searchOpen}>
          <Search className="h-3.5 w-3.5" /> Other city
        </button>
        {searchOpen && (
          <div className="ct-appear absolute left-0 top-full z-[1200] mt-2 w-80 rounded-[3px] border border-rule-strong bg-surface p-2 text-sm shadow-[0_12px_32px_-12px_rgb(21_34_44/0.35)]">
            <form onSubmit={search} className="relative">
              <input autoFocus className="input w-full pr-8" placeholder="Search for a city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search city" />
              {busy ? <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-ink-3" /> : (
                <button type="button" className="absolute right-2 top-2 text-ink-3 hover:text-ink" onClick={() => { setSearchOpen(false); setResults(null); }} aria-label="Close search"><X className="h-4 w-4" /></button>
              )}
            </form>
            {err && <div className="p-2 text-hot">{err}</div>}
            {results?.length === 0 && <div className="p-2 text-ink-3">No city matches “{q}”. Try a different spelling.</div>}
            <div className="mt-1 max-h-72 overflow-auto">
              {results?.map((r, i) => (
                <button key={i} type="button" className="flex w-full items-start gap-2 rounded-[2px] px-2 py-2 text-left hover:bg-raised"
                  onClick={() => { setCity({ name: r.name, country: r.country, lat: r.lat, lon: r.lon }); setResults(null); setQ(''); setSearchOpen(false); }}>
                  <MapPin className="mt-0.5 h-3.5 w-3.5 text-ink-3" />
                  <span className="text-ink">{r.name}<span className="text-ink-3">{r.admin1 ? `, ${r.admin1}` : ''}, {r.country}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </span>
      {scenarios.length > 0 && (
        <>
          <span>on</span>
          <InlineSelect label="Weather scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="max-w-[min(100%,26rem)] truncate">
            {scenarios.map((s) => <option key={s.id} value={s.id}>{scenarioName(s)}</option>)}
          </InlineSelect>
          <span className="wide font-bold tracking-[-0.02em] text-hot">{(sc?.id === 'custom' ? custom.airTemp : sc?.airTemp)?.toFixed?.(1)} °C</span>
          {scenarioId === 'custom' && (
            <span className="flex w-full flex-wrap items-center gap-4 text-[13px] text-ink-2">
              <label className="flex items-center gap-2">Air temperature <input type="range" min="25" max="50" step="0.5" value={custom.airTemp} onChange={(e) => setCustom({ ...custom, airTemp: +e.target.value })} /></label>
              <label className="flex items-center gap-2">Humidity <input type="range" min="5" max="90" value={custom.rh} onChange={(e) => setCustom({ ...custom, rh: +e.target.value })} /> {custom.rh}%</label>
            </span>
          )}
        </>
      )}
    </div>
  );
}

function scenarioName(s) {
  if (s.id === 'today') return `today's afternoon peak`;
  if (s.id === 'recent') return 'the hottest day of the past month';
  if (s.id === 'year') return 'the hottest day of the past year';
  return 'a custom heatwave';
}

const LOADING_STEPS = [
  'Reading weather and climate records from Open-Meteo',
  'Fetching buildings, roads, parks and water from OpenStreetMap',
  'Public map servers can take up to a minute for a new city',
  'Still waiting on OpenStreetMap. If it fails, labelled synthetic data is used instead',
];

function LoadingScreen({ city }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(LOADING_STEPS.length - 1, s + 1)), 9000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="card relative flex h-[62vh] flex-col items-start justify-end overflow-hidden p-8">
      <div className="absolute inset-0 grid grid-cols-[repeat(28,1fr)] opacity-70" aria-hidden>
        {Array.from({ length: 28 * 14 }, (_, k) => (
          <span key={k} className="animate-pulse border-[0.5px] border-surface" style={{ background: `hsl(${200 - ((k * 37) % 180)} 70% ${86 - ((k * 13) % 14)}%)`, animationDelay: `${(k % 28) * 60}ms` }} />
        ))}
      </div>
      <div className="relative rounded-[3px] bg-surface/95 p-5">
        <div className="wide text-[28px] font-bold tracking-[-0.03em] text-ink">Mapping heat in {city}</div>
        <div className="mt-2 flex items-center gap-2 text-sm text-ink-2"><Loader2 className="h-4 w-4 animate-spin" /> {LOADING_STEPS[step]}</div>
        <div className="mt-1 text-[13px] text-ink-3">The heat model, hotspot statistics and optimiser then run in your browser.</div>
      </div>
    </div>
  );
}

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState('overview');
  const Active = TABS.find((t) => t.id === tab).C;
  const prov = app.env?.provenance;

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-rule bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
          <div>
            <div className="wide text-[22px] font-black leading-none tracking-[-0.04em] text-ink">
              COOL<span className="font-light">TRACE</span>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-3">Urban heat intelligence</div>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full lg:hidden ${app.aiReady ? 'bg-good' : 'bg-warn'}`}
            title={app.aiReady ? 'Gemini connected' : 'Gemini key missing'}
          />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0" aria-label="Sections">
          {TABS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`group flex shrink-0 items-center gap-3 rounded-[3px] px-2.5 py-2 text-left transition-colors ${
                tab === id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-raised hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>
                <span className="block text-[14px] font-semibold leading-tight">{label}</span>
                <span className={`hidden text-[12px] leading-tight lg:block ${tab === id ? 'text-surface/65' : 'text-ink-3'}`}>{hint}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-3 px-5 pb-5 text-[12px] leading-relaxed text-ink-3 lg:block">
          <div className="flex items-center gap-2 text-ink-2">
            <span className={`h-2 w-2 rounded-full ${app.aiReady ? 'bg-good' : app.health ? 'bg-warn' : 'bg-rule-strong'}`} />
            {app.aiReady ? 'Gemini connected' : app.health ? 'Gemini key missing' : 'Connecting to server'}
          </div>
          <p>Weather © Open-Meteo (CC BY 4.0). Map data © OpenStreetMap contributors (ODbL). Modelled estimates for planning screening.</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-rule bg-paper/90 px-5 py-4 backdrop-blur lg:sticky lg:top-0 lg:z-[1100] lg:px-8">
          <ControlSentence />
          {prov && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <SourceBadge source={prov.weather.source} title={prov.weather.fallbackReason}>{prov.weather.source === 'synthetic' ? 'Synthetic weather' : 'Weather from Open-Meteo and ERA5'}</SourceBadge>
              <SourceBadge source={prov.landcover.source} title={prov.landcover.fallbackReason}>{prov.landcover.source === 'synthetic' ? 'Synthetic land cover' : 'Land cover from OpenStreetMap'}</SourceBadge>
              <SourceBadge source="proxy">Population estimated from buildings</SourceBadge>
              <SourceBadge source="model">Temperatures modelled locally</SourceBadge>
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-3">
                <input type="checkbox" checked={app.synthetic} onChange={(e) => app.setSynthetic(e.target.checked)} /> Use synthetic demo data
              </label>
            </div>
          )}
        </header>

        <main className="space-y-5 px-5 py-5 lg:px-8 lg:py-6">
          {app.health && !app.health.ok && <ErrorBanner title="The COOLTRACE server is not responding" error={app.health.error} />}
          {app.health?.ok && !app.aiReady && (
            <Notice tone="warn">
              AI explanations are off because the server has no Gemini key. Add <code className="rounded-[2px] bg-raised px-1">GEMINI_API_KEY</code> to <code className="rounded-[2px] bg-raised px-1">server/.env</code> and restart. Maps, hotspots, the optimiser and the simulator still work.
            </Notice>
          )}
          {app.envError && <ErrorBanner title="Environmental data could not be loaded" error={app.envError} onRetry={app.reload} />}
          {app.loading && <LoadingScreen city={app.city.name} />}
          {!app.loading && app.baseline && (
            <div key={tab} className="ct-appear">
              <Active goTo={setTab} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
