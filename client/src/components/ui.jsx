import { AlertTriangle, Loader2, Info, Sparkles, RefreshCw } from 'lucide-react';

export function Spinner({ label, className = '' }) {
  return (
    <div className={`flex items-center gap-2 text-sm text-ink-3 ${className}`} role="status">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

/** Panel with an optional title row. Titles are plain sentence-case headings. */
export function Card({ title, icon: Icon, actions, children, className = '', bodyClass = 'p-4' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.005em] text-ink">
            {Icon && <Icon className="h-4 w-4 text-ink-3" strokeWidth={1.75} />}
            {title}
          </h3>
          {actions}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** A single figure in a readout strip. */
export function Stat({ label, value, sub, tone = 'default' }) {
  const tones = { default: 'text-ink', hot: 'text-hot', cool: 'text-cool', good: 'text-good' };
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`wide mt-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Row of figures sharing one surface, separated by thin rules. */
export function Readout({ children, cols = 'md:grid-cols-3 xl:grid-cols-6' }) {
  return <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rule bg-rule ${cols}`}>{children}</div>;
}

const SOURCE_STYLE = {
  osm: 'text-good',
  'open-meteo': 'text-good',
  synthetic: 'text-warn',
  proxy: 'text-accent',
  model: 'text-ink-2',
  user: 'text-ink-2',
};
const SOURCE_DOT = { osm: 'bg-good', 'open-meteo': 'bg-good', synthetic: 'bg-warn', proxy: 'bg-accent', model: 'bg-ink-3', user: 'bg-ink-3' };

export function SourceBadge({ source, children, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${SOURCE_STYLE[source] || SOURCE_STYLE.user}`}>
      {source === 'synthetic' ? <AlertTriangle className="h-3 w-3" /> : <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOT[source] || 'bg-ink-3'}`} />}
      {children}
    </span>
  );
}

export function ErrorBanner({ error, onRetry, title = 'Something went wrong' }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  return (
    <div className="flex items-start gap-3 rounded-[3px] border border-hot/40 bg-hot/5 p-3 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-hot" />
      <div className="flex-1">
        <div className="font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-ink-2">{msg}</div>
      </div>
      {onRetry && (
        <button className="btn-ghost !py-1" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info' }) {
  const cls = tone === 'warn' ? 'border-warn/30 bg-warn/5' : 'border-rule bg-raised/60';
  return (
    <div className={`flex items-start gap-2.5 rounded-[3px] border p-3 text-sm text-ink-2 ${cls}`}>
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />}
      <div>{children}</div>
    </div>
  );
}

export function AIButton({ onClick, loading, disabled, children, aiReady }) {
  return (
    <button
      className="btn-primary"
      onClick={onClick}
      disabled={loading || disabled || !aiReady}
      title={!aiReady ? 'Gemini API key not configured on the server' : undefined}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function List({ items, className = '' }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className={`space-y-2 text-sm leading-relaxed text-ink-2 ${className}`}>
      {items.map((x, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[9px] h-px w-3 shrink-0 bg-ink-3" />
          <span>{typeof x === 'string' ? x : JSON.stringify(x)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Segmented({ options, value, onChange, size = 'sm' }) {
  return (
    <div className="inline-flex flex-wrap rounded-[3px] border border-rule-strong bg-surface p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[2px] px-2.5 ${size === 'sm' ? 'py-1 text-[13px]' : 'py-1.5 text-sm'} font-medium transition-colors ${
            value === o.value ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-raised'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small heading used inside AI results and panels (sentence case, no caps). */
export function SubHead({ icon: Icon, children }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
      {Icon && <Icon className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />}
      {children}
    </div>
  );
}
