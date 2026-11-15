import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { buildGrid, computeFeatures } from './lib/features.js';
import { buildScenarios, runModel } from './lib/model.js';
import { getisOrdGiStar, clusterHotspots } from './lib/hotspots.js';
import { defaultCosts, INTERVENTIONS } from './lib/optimizer.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const DEFAULT_CITY = { id: 'delhi', name: 'New Delhi', country: 'India', lat: 28.6328, lon: 77.2197 };

export function AppProvider({ children }) {
  const [health, setHealth] = useState(null);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [env, setEnv] = useState(null);
  const [envError, setEnvError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [scenarioId, setScenarioId] = useState('year');
  const [custom, setCustom] = useState({ airTemp: 42, rh: 30, radiationFactor: 1, wind: 6 });
  const [hotspotVar, setHotspotVar] = useState('surface');
  const [plan, setPlan] = useState(null); // optimiser output
  const [optSettings, setOptSettings] = useState({
    budget: 5_000_000, strategy: 'equity', enabled: INTERVENTIONS.map((x) => x.id), costs: defaultCosts(),
  });
  const [aiCache, setAiCache] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setHealth({ ok: false, error: e.message }));
  }, []);

  const load = useCallback(async (c, syn) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setEnvError(null);
    try {
      const data = await api.environment(c.lat, c.lon, { synthetic: syn, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setEnv(data);
      setPlan(null);
      setAiCache({});
    } catch (e) {
      if (!ctrl.signal.aborted) setEnvError(e);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(city, synthetic); }, [city, synthetic, load]);

  // ---- local analytics pipeline (memoised) ----
  const grid = useMemo(() => (env ? buildGrid(env.bbox) : null), [env]);
  const features = useMemo(() => (env && grid ? computeFeatures(grid, env.landcover) : null), [env, grid]);
  const scenarios = useMemo(() => (env && grid ? buildScenarios(env.weather, grid.cells) : []), [env, grid]);
  const scenario = useMemo(() => {
    const s = scenarios.find((x) => x.id === scenarioId) || scenarios.find((x) => x.id === 'year') || scenarios[0];
    if (!s) return null;
    return s.id === 'custom' ? { ...s, ...custom } : s;
  }, [scenarios, scenarioId, custom]);
  const baseline = useMemo(() => (grid && features && scenario ? runModel(grid, features, scenario) : null), [grid, features, scenario]);
  const z = useMemo(() => (baseline ? getisOrdGiStar(grid.n, baseline[hotspotVar], 2) : null), [baseline, grid, hotspotVar]);
  const zones = useMemo(() => (z ? clusterHotspots(grid, z, baseline, features) : []), [z, grid, baseline, features]);
  const hotspotCells = useMemo(() => new Set(zones.flatMap((zn) => zn.cellIds)), [zones]);

  // scenario change invalidates an optimised plan's numbers (plan levels still valid, but re-run is clearer)
  useEffect(() => { setPlan(null); }, [scenario]);

  const cacheAI = useCallback((key, value) => setAiCache((c) => ({ ...c, [key]: value })), []);

  const value = {
    health, aiReady: Boolean(health?.ai?.configured),
    city, setCity, env, envError, loading, reload: () => load(city, synthetic), synthetic, setSynthetic,
    grid, features, scenarios, scenario, scenarioId, setScenarioId, custom, setCustom,
    baseline, z, zones, hotspotCells, hotspotVar, setHotspotVar,
    plan, setPlan, optSettings, setOptSettings, aiCache, cacheAI,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Compact context sent to Gemini (numbers only, computed locally). */
export function aiContext({ city, env, scenario, baseline, zones }) {
  return {
    city: `${city.name}, ${city.country || ''}`.trim(),
    provenance: env?.provenance,
    weather: scenario && {
      scenario: scenario.label, airTemp: scenario.airTemp, relativeHumidity: scenario.rh,
      solarFactor: +scenario.radiationFactor.toFixed(2), wind: scenario.wind, note: scenario.note,
      hottestDayPast12Months: env?.weather?.hottestYear,
    },
    cityStats: baseline && { ...baseline.stats, studyArea: '3.5 x 3.5 km grid of 28x28 cells (~125 m)' },
    hotspots: zones.slice(0, 6).map(({ cellIds, bounds, ...z }) => z),
  };
}
