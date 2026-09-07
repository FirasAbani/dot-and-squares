/**
 * The reported asymmetry: a rematch that times out returned the player who did
 * not answer to the start screen, but not the one who asked.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { FakeWebSocket } from './test-utils/fakeSocket';
import { createGame, resign } from './engine';

/** A real finished game, so the end screen renders exactly as it does live. */
function finishedGame() {
  return resign(createGame({ username: 'Alice', initials: 'AL' }, { username: 'Bob', initials: 'BO' }, 3), 'p2');
}

async function seatedAt(seat: 'p1' | 'p2') {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
  await userEvent.type(screen.getByLabelText(/username/i), seat === 'p1' ? 'Alice' : 'Bob');
  const ini = screen.getByLabelText(/initials/i) as HTMLInputElement;
  await userEvent.clear(ini);
  await userEvent.type(ini, seat === 'p1' ? 'AL' : 'BO');
  await userEvent.click(screen.getByRole('button', { name: 'Create Room' }));

  const socket = FakeWebSocket.last();
  act(() => {
    socket.accept();
    socket.emit({
      t: 'welcome',
      seat,
      code: 'ABC234',
      seq: 1,
      state: finishedGame(),
      presence: { p1: 'connected', p2: 'connected' },
      rematch: { p1: false, p2: false },
      drawOfferedBy: null,
      series: { p1: 0, p2: 1, draws: 0 },
    });
  });
  return socket;
}

describe('a rematch offer that expires', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns the player who ASKED to the start screen', async () => {
    const socket = await seatedAt('p1');
    // Press the real button, which is what the reported case actually did.
    await userEvent.click(await screen.findByRole('button', { name: /play again|rematch/i }));
    act(() => socket.emit({ t: 'rematch', votes: { p1: true, p2: false } }));
    act(() => socket.emit({ t: 'rematch-timeout' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create Room' })).toBeTruthy(),
    );
    expect(screen.getByText(/did not answer — the match has ended/i)).toBeTruthy();
  });

  it('returns the player who did NOT answer to the start screen', async () => {
    const socket = await seatedAt('p2');
    act(() => socket.emit({ t: 'rematch', votes: { p1: true, p2: false } }));
    act(() => socket.emit({ t: 'rematch-timeout' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create Room' })).toBeTruthy(),
    );
  });
});
