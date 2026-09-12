/**
 * Two blockers found by a QA simulation against the live site.
 *
 * Both were reachable by an ordinary player in one or two clicks, and neither
 * produced a console error — which is why the existing suite never saw them.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { FakeWebSocket } from './test-utils/fakeSocket';
import * as quitBehaviour from './quit-behaviour';

describe('Quit on the game over screen, in a deployed build', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * The reported blocker: on production the dialog vanished and left a board
   * with no buttons, no dialog and nothing to click. The confirm overlay only
   * renders when the server is stoppable, but Quit set the phase regardless.
   */
  it('leaves somewhere to go rather than a dead screen', async () => {
    // A deployed build: there is no dev server to stop.
    vi.spyOn(quitBehaviour, 'canStopServer').mockReturnValue(false);

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'vs Computer' }));
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Ada');
    const initials = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'AL');
    fireEvent.change(screen.getByLabelText(/Board/), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Play Computer' }));

    // A 3x3 board is 12 edges; click until the game ends.
    for (let i = 0; i < 80; i += 1) {
      if (screen.queryByRole('dialog', { name: 'Game over' })) break;
      const edge = document.querySelector('[data-edge-id]');
      if (edge) fireEvent.click(edge);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    const dialog = await screen.findByRole('dialog', { name: 'Game over' }, { timeout: 6000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quit' }));

    // Whatever it does, the player must not be stranded: there has to be
    // something on screen they can act on.
    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });
});

describe('coming back to an online game after a refresh', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The reported blocker: a seat stays claimed while its player is away, so the
   * room reports itself full — and this screen refused the very player whose
   * seat it was holding. Re-entering the code said "already has two players",
   * and the match was unreachable for ever while the opponent waited.
   */
  it('offers a rejoin when the full seat is our own', async () => {
    // We were in ABC234 and still hold its token, as a refresh would leave us.
    sessionStorage.setItem('ds:token:ABC234', 'tok-mine');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          exists: true,
          full: true,
          inProgress: true,
          visibility: 'private',
          hostName: 'Grace',
          gridSize: 5,
          timeControlMs: null,
          incrementMs: 0,
        }),
      })),
    );

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
    await userEvent.type(screen.getByLabelText(/username/i), 'Ada');
    const initials = screen.getByLabelText(/initials/i) as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'AL');
    await userEvent.type(screen.getByLabelText(/have a code/i), 'ABC234');

    expect(await screen.findByRole('button', { name: 'Rejoin Game' })).toBeTruthy();
    expect(screen.queryByText(/already has two players/i)).toBeNull();
  });

  /** A stranger must still be refused: the seat is not theirs to take. */
  it('still refuses a full room to someone who was never in it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          exists: true,
          full: true,
          inProgress: true,
          visibility: 'public',
          hostName: 'Grace',
          gridSize: 5,
          timeControlMs: null,
          incrementMs: 0,
        }),
      })),
    );

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
    await userEvent.type(screen.getByLabelText(/username/i), 'Eve');
    const initials = screen.getByLabelText(/initials/i) as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'EV');
    await userEvent.type(screen.getByLabelText(/have a code/i), 'ABC234');

    expect(await screen.findByText(/already has two players/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /rejoin/i })).toBeNull();
  });

  /** Asking whether we hold a token must not create one. */
  it('does not mint a token just by looking at a code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
    await userEvent.type(screen.getByLabelText(/have a code/i), 'XYZ789');
    await waitFor(() => expect(sessionStorage.getItem('ds:token:XYZ789')).toBeNull());
  });
});
