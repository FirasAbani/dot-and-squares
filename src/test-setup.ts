import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

/**
 * Browser storage is per-test, like the DOM is.
 *
 * The app remembers players in `localStorage` and seat tokens in
 * `sessionStorage`, so without this a test that starts a match leaves a name
 * behind for whichever test runs next — and the setup screen then renders
 * pre-filled when that test expected it empty. It stayed hidden locally
 * because Node's own `localStorage` is inert here, so the writes went nowhere;
 * on a runtime where jsdom's real one is used they persisted, and CI failed on
 * code that passes on every machine in this house.
 *
 * Unlike the WebSocket stub — which must stay per-suite, since replacing a
 * global would reach every test that knows nothing about the network — this is
 * the removal of leaked state, which no test can want.
 */
afterEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // A storage-less environment has nothing to leak.
  }
});
