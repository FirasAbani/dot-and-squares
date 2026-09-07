import { useEffect } from 'react';
import type { ShutdownOutcome } from '../shutdown';

interface QuitScreenProps {
  outcome: ShutdownOutcome;
}

/**
 * The last thing on screen after Quit. The server is already gone by the time
 * this renders, so everything here has to be static — no fetches, no reloads.
 */
export function QuitScreen({ outcome }: QuitScreenProps) {
  useEffect(() => {
    // Only succeeds for a script-opened window; browsers refuse to let a tab
    // the user opened themselves close itself. The copy below therefore has to
    // stand on its own for the common case.
    window.close();
  }, []);

  return (
    <main className="app quit-screen">
      <div className="panel quit-screen__panel" role="status">
        <p className="overlay__eyebrow">
          {outcome === 'stopped' ? 'Server stopped' : 'Game closed'}
        </p>
        <h2 className="overlay__title">Thanks for playing</h2>

        <p className="quit-screen__body">
          {outcome === 'stopped'
            ? 'The game server has shut down and this page is no longer live. You can close this tab.'
            : 'The game is closed. This page was not served by a dev server, so nothing was shut down.'}
        </p>

        <p className="quit-screen__label">To play again, run:</p>
        <code className="quit-screen__command">npm run dev</code>
        <p className="quit-screen__hint">
          from <code>~/Code/Application</code>, then reopen localhost:5173
        </p>
      </div>
    </main>
  );
}
