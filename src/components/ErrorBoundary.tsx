import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  /** Bumped to remount the tree, so recovery is a fresh start, not a re-render. */
  generation: number;
}

/**
 * The last line of defence: a render error anywhere below this shows a white
 * page otherwise, with no explanation and no way back.
 *
 * A class because `componentDidCatch` has no hook equivalent — this is the one
 * thing React still requires a class for.
 *
 * Recovery remounts the tree rather than clearing the flag alone. Re-rendering
 * the same state that just threw only throws again; a remount drops it, which
 * for an online game also drops the socket — correct, since that match is over
 * either way.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, generation: 0 };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The only record a player's browser will keep. Kept to console rather than
    // sent anywhere: this game collects nothing about its players.
    console.error('Dots & Squares crashed:', error, info.componentStack);
  }

  private recover = () => {
    this.setState((current) => ({ failed: false, generation: current.generation + 1 }));
  };

  render() {
    if (!this.state.failed) {
      // Keyed so `recover` genuinely rebuilds the tree below.
      return <div key={this.state.generation}>{this.props.children}</div>;
    }

    return (
      <main className="app">
        <div className="panel setup" role="alert">
          <p className="overlay__eyebrow">Something went wrong</p>
          <h2 className="overlay__title">The game hit an error</h2>
          <p className="quit-screen__body">
            Any game in progress has been lost. Starting again from the menu should work — if
            it keeps happening, reloading the page clears everything.
          </p>
          <div className="overlay__actions">
            <button type="button" className="button button--primary" onClick={this.recover}>
              Back to Menu
            </button>
            <button
              type="button"
              className="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </main>
    );
  }
}
