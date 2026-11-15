import { useCallback, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';

/** Run a Gemini-backed request through the backend, caching results per key. */
export function useAI(key, kind) {
  const { aiCache, cacheAI } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (body) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.ai(kind, body);
        if (!res?.result || typeof res.result !== 'object') throw new Error('Gemini returned an empty result.');
        cacheAI(key, res);
        return res;
      } catch (e) {
        setError(e);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [kind, key, cacheAI]
  );

  return { data: aiCache[key] || null, loading, error, run };
}
