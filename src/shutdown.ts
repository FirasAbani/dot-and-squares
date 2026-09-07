/**
 * Asks the dev/preview server to stop itself.
 *
 * The counterpart is the `/__shutdown` middleware in `vite.config.ts`. Once it
 * exits, port 5173 is free and stays that way until someone runs `npm run dev`.
 */

export type ShutdownOutcome = 'stopped' | 'unavailable';

export async function requestShutdown(): Promise<ShutdownOutcome> {
  try {
    const response = await fetch('/__shutdown', { method: 'POST' });
    // A static host (a built `dist/`) answers 404/405 — the interface can close
    // but there is no server here for us to stop.
    return response.ok ? 'stopped' : 'unavailable';
  } catch {
    // Vite frequently drops the socket as it exits, which surfaces as a network
    // error. That is a successful shutdown, not a failure.
    return 'stopped';
  }
}
