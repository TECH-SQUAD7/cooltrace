// Prompt builders for the Gemini-powered features. Numbers are computed locally
// by the COOLTRACE engine; Gemini only interprets them and writes guidance.

export const SYSTEM = `You are COOLTRACE, an urban heat-resilience analyst advising city planners.
You receive metrics computed by a local geospatial heat model (estimates, not satellite measurements).
Rules:
- Ground every statement in the supplied numbers; never invent measurements or data sources.
- If data is labelled "synthetic" or a "proxy", say so where it matters.
- Be concrete, practical and concise. Use metric units and degrees Celsius.
- Respond ONLY with valid JSON matching the requested shape. No markdown.`;

const clip = (obj) => (JSON.stringify(obj ?? null) || "null").slice(0, 12000);

export function hotspotPrompt({ city, hotspot, cityStats, weather, provenance }) {
  return `City: ${city}
Data provenance: ${clip(provenance)}
Current weather: ${clip(weather)}
City-wide baseline: ${clip(cityStats)}
Hotspot zone (Getis-Ord Gi* cluster): ${clip(hotspot)}

Explain why this zone is a heat hotspot and what to do about it.
Return JSON:
{
  "summary": "2-3 sentence plain-language explanation",
  "drivers": [{"factor": "short name", "evidence": "cite the numbers", "impact": "high|medium|low"}],
  "risks": ["who/what is at risk and why"],
  "recommendations": [{"action": "specific intervention", "rationale": "why it fits this zone", "expectedCooling": "estimated range e.g. 0.5-1.5 °C", "cost": "low|medium|high", "timeframe": "e.g. 0-6 months", "priority": 1}],
  "quickWins": ["actions doable within weeks"]
}
Give 3-5 drivers and 4-6 recommendations ordered by priority.`;
}

export function insightsPrompt({ city, cityStats, hotspots, weather, provenance }) {
  return `City: ${city}
Data provenance: ${clip(provenance)}
Weather (current + recent): ${clip(weather)}
City-wide model statistics: ${clip(cityStats)}
Top hotspot zones: ${clip(hotspots)}

Produce an environmental heat intelligence briefing for the city's resilience office.
Return JSON:
{
  "headline": "one sentence",
  "riskLevel": "low|moderate|high|extreme",
  "keyFindings": ["4-6 findings grounded in the numbers"],
  "environmentalInsights": [{"topic": "e.g. Vegetation deficit", "insight": "explanation", "metric": "the supporting number"}],
  "vulnerableGroups": ["groups at risk and why"],
  "recommendations": [{"title": "", "description": "", "scale": "street|neighbourhood|city", "horizon": "short|medium|long"}],
  "heatActionPlan": ["immediate operational steps for the next heat event"],
  "dataCaveats": ["limitations of these estimates"]
}`;
}

export function planReviewPrompt({ city, plan, results, budget, strategy }) {
  return `City: ${city}
Budget: ${budget} USD, optimisation strategy: ${strategy}
Optimised intervention plan (computed locally): ${clip(plan)}
Simulated outcomes (computed locally): ${clip(results)}

Review this cooling investment plan as an expert advisor.
Return JSON:
{
  "assessment": "2-3 sentence overall verdict",
  "score": 0-100,
  "strengths": ["..."],
  "gaps": ["risks, blind spots or trade-offs"],
  "phasing": [{"phase": "Phase 1 (0-6 months)", "actions": ["..."]}],
  "communityEngagement": ["..."],
  "maintenance": ["ongoing care needed to sustain cooling"]
}`;
}

export function askPrompt({ city, question, context }) {
  return `City: ${city}
Context from the COOLTRACE model: ${clip(context)}

User question: ${String(question).slice(0, 1000)}

Answer the question using the context. If the context cannot answer it, say what data would be needed.
Return JSON: {"answer": "concise answer, may use short paragraphs separated by \\n", "followUps": ["2-3 suggested follow-up questions"]}`;
}
