/**
 * The rest of the QA simulation's findings, one test each.
 *
 * Several describe behaviour the app had always had and nobody had questioned;
 * the value of the simulation was two people playing as people, not as authors.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PlayerSetup } from './components/PlayerSetup';
import { Lobby } from './components/Lobby';
import { offerInvite } from './net/invite';
import * as quitBehaviour from './quit-behaviour';
import { FakeWebSocket } from './test-utils/fakeSocket';
import { createGame, makeMove } from './engine';

/**
 * A board played right to the end with a DECISIVE winner.
 *
 * The order matters and is not decoration: filling edges in their natural order
 * draws 2-2 on a 3x3, and a draw never runs the victory sweep — so a fixture
 * built that way exercises none of the code this test exists for. Reverse order
 * gives p1 all four squares. The test asserts the outcome rather than trusting
 * it, so the day the engine changes this fails loudly instead of quietly
 * testing nothing.
 */
function playFullBoard() {
  let state = createGame({ username: 'Ada', initials: 'AL' }, { username: 'Bob', initials: 'BO' }, 3);
  for (const id of Object.keys(state.edges).reverse()) {
    if (state.status !== 'playing') break;
    const result = makeMove(state, id, Date.now());
    state = result.ok || result.state !== state ? result.state : state;
  }
  return state;
}

describe('BUG-002 — a code containing a character codes never use', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says so, instead of doing nothing at all', async () => {
    render(<PlayerSetup onStart={() => {}} initialMode="online" />);
    await userEvent.type(screen.getByLabelText(/have a code/i), '000000');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/never contains/i);
    expect(alert.textContent).toMatch(/0, 1, I, L and O/);
  });

  it('names the offending characters, not just the rule', async () => {
    render(<PlayerSetup onStart={() => {}} initialMode="online" />);
    await userEvent.type(screen.getByLabelText(/have a code/i), 'O0IL11');
    expect((await screen.findByRole('alert')).textContent).toMatch(/O, 0, I, L, 1, 1/);
  });

  it('stays quiet for a code that is merely unknown', async () => {
    render(<PlayerSetup onStart={() => {}} initialMode="online" />);
    await userEvent.type(screen.getByLabelText(/have a code/i), 'ZZZZZZ');
    expect(screen.queryByText(/never contains/i)).toBeNull();
  });
});

describe('UX-002 — the other way in', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** It used to vanish at six characters, leaving no action on the screen. */
  it('keeps Browse Open Games reachable while a code is in the field', async () => {
    render(<PlayerSetup onStart={() => {}} initialMode="online" />);
    await userEvent.type(screen.getByLabelText(/username/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/have a code/i), 'ZZZZZZ');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Browse Open Games/i })).toBeTruthy(),
    );
  });
});

describe('UX-005 — the room-code field on a phone', () => {
  it('asks for the keyboard the field actually needs', () => {
    render(<PlayerSetup onStart={() => {}} initialMode="online" />);
    const field = screen.getByLabelText(/have a code/i);
    expect(field.getAttribute('autocapitalize')).toBe('characters');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
  });
});

describe('BUG-003 — two players, one set of initials', () => {
  it('refuses a start where the scoreboard could not tell them apart', async () => {
    const onStart = vi.fn();
    render(<PlayerSetup onStart={onStart} />);
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Firas');
    const p1 = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(p1);
    await userEvent.type(p1, 'FA');
    await userEvent.type(screen.getAllByLabelText('Username')[1], 'Sam');
    const p2 = screen.getAllByLabelText('Initials')[1] as HTMLInputElement;
    await userEvent.clear(p2);
    await userEvent.type(p2, 'FA');

    expect((screen.getByRole('button', { name: 'Start Game' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/both players have these initials/i)).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('still allows matching initials against the computer, who shares no screen', async () => {
    render(<PlayerSetup onStart={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'vs Computer' }));
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Firas');
    const p1 = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(p1);
    await userEvent.type(p1, 'CPU');
    expect(
      (screen.getByRole('button', { name: 'Play Computer' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('UX-001 — the first click a visitor makes', () => {
  /**
   * Player 1 arrives blank while Player 2 is pre-filled, so Start Game is dead
   * on arrival. It was hard-disabled with no hint, no aria and no required
   * marker: clicked six times, nothing happened and nothing said why.
   */
  it('says what is missing, and links it to the button', () => {
    render(<PlayerSetup onStart={() => {}} />);
    const start = screen.getByRole('button', { name: 'Start Game' });

    expect((start as HTMLButtonElement).disabled).toBe(true);
    const describedBy = start.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy!);
    expect(hint?.textContent).toMatch(/player 1/i);
  });

  it('stops saying it once the form is usable', async () => {
    render(<PlayerSetup onStart={() => {}} />);
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Ada');
    const p1 = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(p1);
    await userEvent.type(p1, 'AL');

    const start = screen.getByRole('button', { name: 'Start Game' });
    expect((start as HTMLButtonElement).disabled).toBe(false);
    expect(start.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('BUG-008 / ENH-001 — inviting when nothing will copy', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    vi.restoreAllMocks();
  });

  /** The old message blamed the share sheet for the clipboard's failure. */
  it('hands over the invitation itself rather than naming a mechanism', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });

    render(<Lobby code="ABC234" status="open" onCancel={() => {}} hostName="Ada" />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite a player' }));

    const box = (await screen.findByLabelText(/invitation text and link/i)) as HTMLTextAreaElement;
    expect(box.value).toContain('ABC234');
    expect(screen.queryByText(/read out the code/i)).toBeNull();
    expect(screen.queryByText(/share sheet/i)).toBeNull();
  });

  it('reports the clipboard path as copied, not as a failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
    expect(await offerInvite('ABC234', 'Ada')).toBe('copied');
  });
});

describe('UX-003 / UX-004 — leaving a game', () => {
  beforeEach(() => {
    // Vitest pins import.meta.env.DEV to true, so the deployed behaviour —
    // where leaving means leaving and there is no server to stop — is reached
    // by stubbing the helper.
    vi.spyOn(quitBehaviour, 'canStopServer').mockReturnValue(false);
  });
  afterEach(() => vi.restoreAllMocks());

  async function playComputer() {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'vs Computer' }));
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Ada');
    const initials = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'AL');
    fireEvent.change(screen.getByLabelText(/Board/), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Play Computer' }));
    await waitFor(() => expect(document.querySelector('[data-edge-id]')).toBeTruthy());
  }

  /** One mis-tap used to cost the whole match, with no prompt and no undo. */
  it('does not throw a match away on a single tap', async () => {
    await playComputer();
    await userEvent.click(screen.getByRole('button', { name: 'Leave Game' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('[data-edge-id]')).toBeTruthy();
  });

  /** Playing the computer twice meant re-picking mode and difficulty. */
  it('comes back to the mode that was being played', async () => {
    await playComputer();
    await userEvent.click(screen.getByRole('button', { name: 'Leave Game' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave Game' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'vs Computer' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
  });
});

describe('BUG-007 — the joiner of a finished online game', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The host saw the result; the joiner was stranded on the finished board with
   * the scores visible, no winner and nothing to click. Any message arriving
   * after the final state gave `remote.state` a new identity, the end-of-game
   * effect re-ran, React ran its cleanup and cancelled the victory-sweep timer,
   * and the early return meant it was never re-armed — so `celebrating` stayed
   * true and the game over screen, gated on it being false, never appeared.
   */
  it('reaches the game over screen even when more messages follow the final state', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
    await userEvent.type(screen.getByLabelText(/username/i), 'Bob');
    const initials = screen.getByLabelText(/initials/i) as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'BO');
    await userEvent.click(screen.getByRole('button', { name: /Browse Open Games/i }));
    act(() => FakeWebSocket.last().accept());
    await userEvent.click(await screen.findByRole('button', { name: 'Start a Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));

    const socket = FakeWebSocket.last();
    // A board played to the end and won — the only case that runs the sweep.
    const finished = playFullBoard();
    expect(finished.ending).toBe('board-complete');
    expect(finished.winner).toBe('p1');
    act(() => {
      socket.accept();
      socket.emit({
        t: 'welcome',
        // The winning seat: the sweep, and therefore the strand, belongs to
        // whoever won, and a loser would never arm the timer at all.
        seat: 'p1',
        code: 'ABC234',
        seq: 1,
        state: finished,
        presence: { p1: 'connected', p2: 'connected' },
        rematch: { p1: false, p2: false },
        drawOfferedBy: null,
        series: { p1: 1, p2: 0, draws: 0 },
      });
    });

    /*
     * Exactly what stranded the joiner: a further `state` broadcast arriving
     * behind the final one. It carries the same finished game but a NEW object,
     * so `activeState` changes identity, the end-of-game effect re-runs, React
     * runs the previous cleanup — and that cleanup used to cancel the sweep
     * timer that the `endedRef` early return then never re-armed.
     */
    act(() =>
      socket.emit({
        t: 'state',
        seq: 2,
        state: { ...finished },
        reason: 'sync',
        series: { p1: 1, p2: 0, draws: 0 },
      }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Game over' }, { timeout: 4000 }),
    ).toBeTruthy();
  });
});

describe('BUG-001 / BUG-005 — defending a game in progress', () => {
  afterEach(() => vi.restoreAllMocks());

  async function inAGame() {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'vs Computer' }));
    await userEvent.type(screen.getAllByLabelText('Username')[0], 'Ada');
    const initials = screen.getAllByLabelText('Initials')[0] as HTMLInputElement;
    await userEvent.clear(initials);
    await userEvent.type(initials, 'AL');
    fireEvent.change(screen.getByLabelText(/Board/), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Play Computer' }));
    await waitFor(() => expect(document.querySelector('[data-edge-id]')).toBeTruthy());
  }

  /** A reload used to destroy the match in silence. */
  it('asks the browser to confirm a reload while a game is running', async () => {
    await inAGame();

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not interrupt a reload when there is no game to lose', () => {
    render(<App />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  /**
   * Back is the reflex for "previous screen". The app pushed no entries of its
   * own, so it walked off the site entirely and took the match with it.
   */
  it('pushes an entry for the game, so Back has somewhere to land', async () => {
    // The entry is the whole fix: without one, Back consumes the entry that
    // brought the player to the site and leaves it. jsdom cannot navigate away,
    // so the entry being pushed is the observable part.
    const push = vi.spyOn(history, 'pushState');
    await inAGame();

    expect(push).toHaveBeenCalled();
    expect(push.mock.calls.some(([state]) => (state as { dsGame?: boolean })?.dsGame)).toBe(true);
  });

  it('returns to the menu when that entry is popped', async () => {
    await inAGame();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });

    expect(await screen.findByRole('button', { name: 'Play Computer' })).toBeTruthy();
    expect(document.querySelector('[data-edge-id]')).toBeNull();
  });
});
