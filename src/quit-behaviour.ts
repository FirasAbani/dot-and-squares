/**
 * Whether Quit should offer to stop the server.
 *
 * Only true in local development, where a Vite dev server is genuinely running
 * and `/__shutdown` can exit it. In a deployed build the "server" is a
 * globally-distributed Worker with no process to kill, so the button becomes
 * "Leave Game" instead.
 *
 * Extracted into its own module so tests can stub it rather than fighting
 * `import.meta.env`, which vitest pins to DEV.
 */
export function canStopServer(): boolean {
  return import.meta.env.DEV;
}
