// Thin client for the COOLTRACE backend. The Gemini key lives only on the server.
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, signal, timeout = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error || `Request failed (HTTP ${res.status})`, res.status, data?.code);
    if (data == null) throw new ApiError('Empty response from server', res.status);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError(signal?.aborted ? 'Request cancelled' : 'Request timed out', 0, 'TIMEOUT');
    throw new ApiError('Cannot reach the COOLTRACE server. Is the backend running?', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request('/api/health', { timeout: 8000 }),
  cities: () => request('/api/cities'),
  geocode: (q) => request(`/api/geocode?q=${encodeURIComponent(q)}`),
  environment: (lat, lon, { synthetic = false, signal } = {}) =>
    request(`/api/environment?lat=${lat}&lon=${lon}${synthetic ? '&synthetic=1' : ''}`, { signal, timeout: 180000 }),
  ai: (kind, body) => request(`/api/ai/${kind}`, { method: 'POST', body, timeout: 90000 }),
};
