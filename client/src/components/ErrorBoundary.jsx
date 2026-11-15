import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('COOLTRACE UI error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="card max-w-lg p-6">
          <h1 className="text-lg font-semibold text-hot">The interface hit an unexpected error</h1>
          <p className="mt-2 text-sm text-ink-2">{String(this.state.error?.message || this.state.error)}</p>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn-ghost" onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}
