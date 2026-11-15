// Gemini API client (server-side only). The API key never leaves the backend.
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

export class AIError extends Error {
  constructor(message, status = 502, code = 'AI_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

export function modelCandidates() {
  const preferred = (process.env.GEMINI_MODEL || '').trim();
  return [...new Set([preferred, ...FALLBACK_MODELS].filter(Boolean))];
}

let workingModel = null;

/** Extract the first JSON object/array from model text, tolerating code fences. */
export function parseJSONLoose(text) {
  if (typeof text !== 'string') throw new Error('No text to parse');
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const endObj = cleaned.lastIndexOf('}');
    const endArr = cleaned.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Model response was not valid JSON');
  }
}

async function callModel(model, body, signal) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY.trim(),
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * Send a prompt to Gemini and return parsed JSON.
 * @param {string} system  System instruction
 * @param {string} prompt  User prompt
 */
export async function generateJSON(system, prompt, { temperature = 0.4, maxOutputTokens = 8192 } = {}) {
  if (!isConfigured()) {
    throw new AIError(
      'Gemini API key is not configured. Add GEMINI_API_KEY to server/.env and restart the server.',
      503,
      'AI_NOT_CONFIGURED'
    );
  }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  };

  const models = workingModel ? [workingModel, ...modelCandidates().filter((m) => m !== workingModel)] : modelCandidates();
  let lastError = null;

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const { res, data } = await callModel(model, body, controller.signal);
      if (res.ok) {
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text) {
          const reason = candidate?.finishReason || data.promptFeedback?.blockReason || 'empty response';
          throw new AIError(`Gemini returned no content (${reason}).`, 502, 'AI_EMPTY');
        }
        workingModel = model;
        try {
          return { model, result: parseJSONLoose(text) };
        } catch {
          throw new AIError('Gemini returned a response that could not be parsed. Please retry.', 502, 'AI_PARSE');
        }
      }

      const msg = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 404) {
        lastError = new AIError(`Model ${model} unavailable: ${msg}`, 502, 'AI_MODEL');
        continue; // try next model
      }
      if (res.status === 400 && /api key/i.test(msg)) {
        throw new AIError('Gemini rejected the API key. Check GEMINI_API_KEY in server/.env.', 401, 'AI_BAD_KEY');
      }
      if (res.status === 401 || res.status === 403) {
        throw new AIError(`Gemini denied access: ${msg}`, 401, 'AI_BAD_KEY');
      }
      if (res.status === 429) {
        throw new AIError('Gemini rate limit or quota exceeded. Wait a minute and try again.', 429, 'AI_RATE_LIMIT');
      }
      if (res.status >= 500) {
        lastError = new AIError(`Gemini service error: ${msg}`, 502, 'AI_UPSTREAM');
        continue;
      }
      throw new AIError(`Gemini request failed: ${msg}`, 502, 'AI_UPSTREAM');
    } catch (err) {
      if (err instanceof AIError) throw err;
      if (err.name === 'AbortError') {
        lastError = new AIError('Gemini request timed out.', 504, 'AI_TIMEOUT');
        continue;
      }
      lastError = new AIError(`Could not reach Gemini: ${err.message}`, 502, 'AI_NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new AIError('No Gemini model available.', 502, 'AI_MODEL');
}
