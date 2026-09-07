/**
 * The lobby end to end, through the real App: stage a game, browse, join.
 *
 * Lives beside App.test.tsx rather than inside it because it is the only suite
 * that replaces the global WebSocket, and that stub must not leak into the
 * tests that know nothing about the network.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { FakeWebSocket } from './test-utils/fakeSocket';
import type { LobbyListing } from './shared/protocol';

function listing(code: string, hostName: string): LobbyListing {
  return {
    code,
    hostName,
    hostInitials: hostName.slice(0, 2).toUpperCase(),
    gridSize: 5,
    timeControlMs: null,
    incrementMs: 0,
    createdAt: 1000,
  };
}

async function nameYourself() {
  await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
  await userEvent.type(screen.getByLabelText(/username/i), 'Ada');
  const initials = screen.getByLabelText(/initials/i) as HTMLInputElement;
  await userEvent.clear(initials);
  await userEvent.type(initials, 'AL');
}

describe('the public lobby, through the app', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers Public and Private when staging an online game, public first', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));

    const publicButton = screen.getByRole('button', { name: /Public/ });
    const privateButton = screen.getByRole('button', { name: /Private/ });
    expect(publicButton.getAttribute('aria-pressed')).toBe('true');
    expect(privateButton.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(privateButton);
    expect(privateButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('tells the server a public room is public, and a private one is not', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: 'Create Room' }));

    const url = FakeWebSocket.last().url;
    expect(url).toContain('create=1');
    expect(url).toContain('pub=1');
  });

  it('omits pub=1 for a private room', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Private/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create Room' }));

    expect(FakeWebSocket.last().url).not.toContain('pub=1');
  });

  it('will not let a nameless player browse', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Online' }));
    expect((screen.getByRole('button', { name: /Browse open games/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows a game staged by someone else with no action from this player', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    expect(FakeWebSocket.last().url).toContain('/api/lobby');
    await screen.findByText(/loading open games/i);

    // Nobody touches anything: the row arrives because the server pushed it.
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });

    expect(await screen.findByText('Grace')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Join Grace's game" })).toBeTruthy();
  });

  it('takes a row away again when that game fills', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });
    expect(await screen.findByText('Grace')).toBeTruthy();

    act(() => FakeWebSocket.last().emit({ t: 'lobby', games: [] }));
    await waitFor(() => expect(screen.queryByText('Grace')).toBeNull());
    expect(screen.getByText(/no open games right now/i)).toBeTruthy();
  });

  it('opens the room socket when a game is chosen, and lets the lobby go', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    const lobbySocket = FakeWebSocket.last();
    act(() => {
      lobbySocket.accept();
      lobbySocket.emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });

    await userEvent.click(await screen.findByRole('button', { name: "Join Grace's game" }));

    const roomSocket = FakeWebSocket.last();
    expect(roomSocket.url).toContain('/api/room/BBB222');
    // A joiner never claims the room, and never sets its visibility.
    expect(roomSocket.url).not.toContain('create=1');
    expect(roomSocket.url).not.toContain('pub=1');

    // The lobby is held open until the room actually answers — that is what
    // keeps the list on screen (with the pressed row busy) instead of flashing
    // the host's invite screen at someone who is only joining.
    expect(lobbySocket.readyState).toBe(FakeWebSocket.OPEN);
    expect(screen.getByRole('button', { name: "Join Grace's game" }).getAttribute('aria-busy')).toBe(
      'true',
    );

    act(() => {
      roomSocket.accept();
      roomSocket.emit({
        t: 'welcome',
        seat: 'p2',
        code: 'BBB222',
        seq: 0,
        state: null,
        presence: { p1: 'connected', p2: 'connected' },
        rematch: { p1: false, p2: false },
        drawOfferedBy: null,
        series: { p1: 0, p2: 0, draws: 0 },
      });
    });
    await waitFor(() => expect(lobbySocket.readyState).toBe(FakeWebSocket.CLOSED));
  });

  it('puts the player back in front of the list when the game just filled', async () => {
    // A refused upgrade is an HTTP 4xx with no 101, which the browser reports
    // as a bare 1006 — NOT the 1001 the server sends when it closes a socket it
    // had already accepted. Getting this constant wrong hides the whole path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          exists: true,
          full: true,
          inProgress: false,
          visibility: 'public',
          hostName: 'Grace',
          gridSize: 5,
          timeControlMs: null,
          incrementMs: 0,
        }),
      })),
    );

    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });
    await userEvent.click(await screen.findByRole('button', { name: "Join Grace's game" }));

    const roomSocket = FakeWebSocket.last();
    act(() => roomSocket.close(1006));

    expect((await screen.findByRole('alert')).textContent).toMatch(/just filled/i);
    expect(screen.getByRole('heading', { name: /open games/i })).toBeTruthy();
    // And it must not sit there retrying a refusal that will never change.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(FakeWebSocket.instances.filter((s) => s.url.includes('/api/room/'))).toHaveLength(1);
  });

  it('leaves the lobby behind once a join lands', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });
    await userEvent.click(await screen.findByRole('button', { name: "Join Grace's game" }));

    act(() => {
      const room = FakeWebSocket.last();
      room.accept();
      room.emit({
        t: 'welcome',
        seat: 'p2',
        code: 'BBB222',
        seq: 0,
        state: null,
        presence: { p1: 'connected', p2: 'connected' },
        rematch: { p1: false, p2: false },
        drawOfferedBy: null,
        series: { p1: 0, p2: 0, draws: 0 },
      });
    });

    // A joiner is told they are joining — never handed the host's room code and
    // a Copy link button for a game that is not theirs.
    expect(await screen.findByRole('heading', { name: /joining/i })).toBeTruthy();
    expect(screen.getByText(/taking a seat in grace's game/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /cancel|leave/i }));
    expect(await screen.findByRole('button', { name: 'Create Room' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /open games/i })).toBeNull();
  });

  it('never re-offers a game that refused the join, even while the lobby still lists it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    const lobbySocket = FakeWebSocket.last();
    act(() => {
      lobbySocket.accept();
      lobbySocket.emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });
    await userEvent.click(await screen.findByRole('button', { name: "Join Grace's game" }));
    act(() => FakeWebSocket.last().close(1006));

    // The server has no idea the host is gone, so it keeps advertising the row.
    // We do know: we were just refused by it.
    await screen.findByRole('alert');
    act(() => {
      const feed = FakeWebSocket.instances.filter((s) => s.url.includes('/api/lobby')).pop()!;
      feed.accept();
      feed.emit({ t: 'lobby', games: [listing('BBB222', 'Grace')] });
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: "Join Grace's game" })).toBeNull(),
    );
    // And the empty state offers a real next step rather than a dead end.
    expect(screen.getByText(/start one and you will be first in/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start a game and wait/i })).toBeTruthy();
  });

  it('lets the first player in stage a game and wait there', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));

    const lobbySocket = FakeWebSocket.last();
    act(() => {
      lobbySocket.accept();
      lobbySocket.emit({ t: 'lobby', games: [] });
    });
    expect(await screen.findByText(/start one and you will be first in/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /start a game and wait/i }));

    // She becomes the host of a public room — and is told so as a host, with a
    // code to share, not as someone joining a stranger's game.
    const roomSocket = FakeWebSocket.last();
    expect(roomSocket.url).toContain('create=1');
    expect(roomSocket.url).toContain('pub=1');
    expect(await screen.findByRole('heading', { name: /waiting/i })).toBeTruthy();
    await waitFor(() => expect(lobbySocket.readyState).toBe(FakeWebSocket.CLOSED));
  });

  it('stages with the board and clock the player chose, not a default', async () => {
    render(<App />);
    await nameYourself();
    // Move the board off its default before browsing.
    fireEvent.change(screen.getByLabelText(/Board/), { target: { value: '8' } });
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [] });
    });
    await userEvent.click(await screen.findByRole('button', { name: /start a game and wait/i }));

    expect(FakeWebSocket.last().url).toContain('grid=8');
  });

  it('ends the match when a rematch offer is never answered', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: 'Create Room' }));

    const room = FakeWebSocket.last();
    const finished = {
      players: {
        p1: { id: 'p1', username: 'Firas', initials: 'FA', squares: 9 },
        p2: { id: 'p2', username: 'Grace', initials: 'GH', squares: 7 },
      },
      currentPlayer: 'p1',
      edges: {},
      squares: {},
      status: 'finished',
      winner: 'p1',
      ending: 'resignation',
      endedBy: 'p2',
      lastClaimedSquares: [],
      gridSize: 5,
      clock: null,
    };
    act(() => {
      room.accept();
      room.emit({
        t: 'welcome',
        seat: 'p1',
        code: 'ABC234',
        seq: 1,
        state: finished,
        presence: { p1: 'connected', p2: 'disconnected' },
        rematch: { p1: false, p2: false },
        drawOfferedBy: null,
        series: { p1: 1, p2: 0, draws: 0 },
      });
    });

    // The opponent has quit. This player offers a rematch anyway, and the
    // server gives up on it five seconds later.
    act(() => room.emit({ t: 'rematch', votes: { p1: true, p2: false } }));
    act(() => room.emit({ t: 'rematch-timeout' }));

    // Back to the start, told why, rather than watching a screen that will
    // never change.
    expect(await screen.findByRole('button', { name: 'Create Room' })).toBeTruthy();
    expect(screen.getByText(/did not answer — the match has ended/i)).toBeTruthy();
  });

  it('comes back to the setup screen from the lobby', async () => {
    render(<App />);
    await nameYourself();
    await userEvent.click(screen.getByRole('button', { name: /Browse open games/ }));
    act(() => FakeWebSocket.last().accept());

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Create Room' })).toBeTruthy();
  });
});
