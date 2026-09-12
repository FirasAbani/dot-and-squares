/**
 * Five players around one public lobby, driven through the real App in jsdom.
 *
 * Alice + Bob are already playing. Cara and Dan have each staged a public game
 * and are waiting. Eve browses, and everything below is about what Eve sees and
 * what happens when she picks.
 *
 * Each player is a separate React root in the same document, so every query is
 * scoped with `within(root)` — `screen` would see all five at once.
 */
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { FakeWebSocket } from './test-utils/fakeSocket';
import { createGame, resign } from './engine';
import type { LobbyListing } from './shared/protocol';

/** A room the fake `/api/room/CODE?info=1` endpoint knows about. */
interface RoomFact {
  exists: boolean;
  full: boolean;
  inProgress: boolean;
  visibility: 'public' | 'private';
  hostName: string;
  gridSize: number;
  timeControlMs: number | null;
  incrementMs: number;
}

const rooms = new Map<string, RoomFact>();

function room(hostName: string, over: Partial<RoomFact> = {}): RoomFact {
  return {
    exists: true,
    full: false,
    inProgress: false,
    visibility: 'public',
    hostName,
    gridSize: 5,
    timeControlMs: null,
    incrementMs: 0,
    ...over,
  };
}

function listingFor(code: string, hostName: string, over: Partial<LobbyListing> = {}): LobbyListing {
  return {
    code,
    hostName,
    hostInitials: hostName.slice(0, 2).toUpperCase(),
    gridSize: 5,
    timeControlMs: null,
    incrementMs: 0,
    createdAt: 1000,
    ...over,
  };
}

/** Mount one player's tab. RTL gives each render its own container. */
function mount() {
  return render(<App />).container;
}

async function goOnline(root: HTMLElement, username: string, initials: string) {
  await userEvent.click(within(root).getByRole('button', { name: 'Play Online' }));
  // Cleared first: the setup screen remembers the last player, so typing into a
  // field that still holds "Ada" produces "AdaEve" and every later assertion
  // about this player's name quietly stops matching.
  const name = within(root).getByLabelText(/username/i) as HTMLInputElement;
  await userEvent.clear(name);
  await userEvent.type(name, username);
  const field = within(root).getByLabelText(/initials/i) as HTMLInputElement;
  await userEvent.clear(field);
  await userEvent.type(field, initials);
}

/** The most recent socket whose URL contains `fragment`. */
function socketFor(fragment: string): FakeWebSocket {
  const matches = FakeWebSocket.instances.filter((s) => s.url.includes(fragment));
  const socket = matches[matches.length - 1];
  if (!socket) throw new Error(`no socket for ${fragment}; have ${FakeWebSocket.instances.map((s) => s.url).join(', ')}`);
  return socket;
}

function socketsFor(fragment: string): FakeWebSocket[] {
  return FakeWebSocket.instances.filter((s) => s.url.includes(fragment));
}

function codeOf(socket: FakeWebSocket): string {
  return socket.url.match(/\/api\/room\/([A-Z0-9]+)/)![1];
}

function welcome(code: string, seat: 'p1' | 'p2', state: unknown) {
  return {
    t: 'welcome',
    seat,
    code,
    seq: 0,
    state,
    presence: { p1: 'connected', p2: 'connected' },
    rematch: { p1: false, p2: false },
    drawOfferedBy: null,
    series: { p1: 0, p2: 0, draws: 0 },
  };
}

/**
 * Stage a public game and stop on the host's waiting screen.
 *
 * Hosting runs through the lobby now, so this walks the same two screens a
 * player does: open the list, then start a game from it.
 */
async function hostPublicGame(name: string, initials: string) {
  const root = mount();
  await goOnline(root, name, initials);
  await userEvent.click(within(root).getByRole('button', { name: /Browse Open Games/ }));
  act(() => FakeWebSocket.last().accept());
  await userEvent.click(await within(root).findByRole('button', { name: 'Start a Game' }));
  await userEvent.click(within(root).getByRole('button', { name: 'Start Game' }));
  const socket = FakeWebSocket.last();
  const code = codeOf(socket);
  act(() => {
    socket.accept();
    socket.emit({ ...welcome(code, 'p1', null), presence: { p1: 'connected', p2: 'disconnected' } });
  });
  return { root, code, socket };
}

/** A browsing player parked in front of the open-games list. */
async function browse(name: string, initials: string) {
  const root = mount();
  await goOnline(root, name, initials);
  await userEvent.click(within(root).getByRole('button', { name: /Browse Open Games/ }));
  const socket = FakeWebSocket.last();
  act(() => socket.accept());
  return { root, socket };
}

function rows(root: HTMLElement) {
  return within(root).getAllByRole('group', { name: /^Game hosted by / });
}

describe('five players around one public lobby', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    rooms.clear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const code = String(input).match(/\/api\/room\/([A-Z0-9]+)/)?.[1] ?? '';
        const fact = rooms.get(code);
        return {
          ok: true,
          json: async () => fact ?? { exists: false },
        };
      }),
    );
    sessionStorage.clear();

  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------- Q1, Q2, Q9
  it('shows Eve exactly the two open games, with each host distinguishable', async () => {
    // Alice and Bob are mid-game: Alice hosts, Bob takes the second seat.
    const alice = await hostPublicGame('Alice', 'AL');
    rooms.set(alice.code, room('Alice'));
    const started = createGame({ username: 'Alice', initials: 'AL' }, { username: 'Bob', initials: 'BO' });

    const bobRoot = mount();
    await goOnline(bobRoot, 'Bob', 'BO');
    // Bob is a different browser, so he does not hold Alice's seat token. This
    // suite runs five "players" in one jsdom, which means one sessionStorage —
    // and a code we hold a token for is now correctly offered as a rejoin
    // rather than an invitation. Dropping it here restores the real separation.
    sessionStorage.removeItem(`ds:token:${alice.code}`);
    await userEvent.type(within(bobRoot).getByLabelText(/Have a code/i), alice.code);
    await userEvent.click(await within(bobRoot).findByRole('button', { name: /Accept/ }));
    act(() => {
      const bobSocket = FakeWebSocket.last();
      bobSocket.accept();
      bobSocket.emit(welcome(alice.code, 'p2', started));
    });
    act(() => alice.socket.emit({ t: 'state', seq: 1, state: started, reason: 'start', series: { p1: 0, p2: 0, draws: 0 } }));
    // Their game is under way, so it is no longer a lobby candidate.
    rooms.set(alice.code, room('Alice', { full: true, inProgress: true }));
    expect(within(bobRoot).getByText(/Forfeit/)).toBeTruthy();

    const cara = await hostPublicGame('Cara', 'CA');
    const dan = await hostPublicGame('Dan', 'DA');
    const eve = await browse('Eve', 'EV');

    act(() =>
      eve.socket.emit({
        t: 'lobby',
        games: [
          listingFor(cara.code, 'Cara'),
          listingFor(dan.code, 'Dan', { gridSize: 7, timeControlMs: 300000, incrementMs: 3000 }),
        ],
      }),
    );

    // Q1 — exactly two rows, and Alice's in-progress game is not one of them.
    await waitFor(() => expect(rows(eve.root)).toHaveLength(2));
    expect(within(eve.root).queryByText('Alice')).toBeNull();
    expect(within(eve.root).queryByRole('button', { name: "Join Alice's game" })).toBeNull();

    // Q2 — host name, board size and clock read correctly per row.
    const [caraRow, danRow] = rows(eve.root);
    expect(caraRow.textContent).toContain('Cara');
    expect(caraRow.textContent).toContain('5 × 5 dots');
    expect(caraRow.textContent).toContain('16 squares');
    expect(caraRow.textContent).toContain('No limit');
    expect(danRow.textContent).toContain('Dan');
    expect(danRow.textContent).toContain('7 × 7 dots');
    expect(danRow.textContent).toContain('36 squares');
    expect(danRow.textContent).toContain('5:00 + 3s');

    // Q9 — the two joins are told apart by accessible name, and the count is
    // announced in a live region.
    expect(within(eve.root).getByRole('button', { name: "Join Cara's game" })).toBeTruthy();
    expect(within(eve.root).getByRole('button', { name: "Join Dan's game" })).toBeTruthy();
    const status = within(eve.root).getAllByRole('status').find((el) => /waiting|loading|lobby/i.test(el.textContent ?? ''));
    expect(status?.textContent).toMatch(/2 games waiting/);
  });

  // -------------------------------------------------------------------- Q3, Q4
  it('opens Cara’s room when Eve picks Cara, and other browsers update live', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    const dan = await hostPublicGame('Dan', 'DA');
    rooms.set(cara.code, room('Cara'));
    rooms.set(dan.code, room('Dan'));

    const eve = await browse('Eve', 'EV');
    const onlooker = await browse('Frank', 'FR');
    const snapshot = { t: 'lobby', games: [listingFor(cara.code, 'Cara'), listingFor(dan.code, 'Dan')] };
    act(() => {
      eve.socket.emit(snapshot);
      onlooker.socket.emit(snapshot);
    });
    await waitFor(() => expect(rows(eve.root)).toHaveLength(2));

    const roomsBefore = socketsFor('/api/room/').length;
    await userEvent.click(within(eve.root).getByRole('button', { name: "Join Cara's game" }));

    // Q3 — Cara's code, not Dan's; no create/pub; the lobby socket let go.
    const opened = socketFor('/api/room/');
    expect(codeOf(opened)).toBe(cara.code);
    expect(codeOf(opened)).not.toBe(dan.code);
    expect(opened.url).not.toContain('create=1');
    expect(opened.url).not.toContain('pub=1');
    expect(socketsFor('/api/room/').length).toBe(roomsBefore + 1);
    // The lobby is deliberately held open until the room answers, so Eve keeps
    // seeing the list (with her row busy) rather than being shown the host's
    // invite screen for a game she is only joining. It closes once she is seated.
    expect(eve.socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(
      within(eve.root).getByRole('button', { name: "Join Cara's game" }).getAttribute('aria-busy'),
    ).toBe('true');

    // Q4 — the onlooker's list shrinks with no action from him.
    act(() => onlooker.socket.emit({ t: 'lobby', games: [listingFor(dan.code, 'Dan')] }));
    await waitFor(() => expect(rows(onlooker.root)).toHaveLength(1));
    expect(rows(onlooker.root)[0].textContent).toContain('Dan');
    expect(within(onlooker.root).queryByText('Cara')).toBeNull();
  });

  // ------------------------------------------------------------------------ Q5
  it('puts Eve back on the list when Cara’s game fills mid-click, and lets her take Dan’s', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    const dan = await hostPublicGame('Dan', 'DA');
    rooms.set(cara.code, room('Cara', { full: true, inProgress: false }));
    rooms.set(dan.code, room('Dan'));

    const eve = await browse('Eve', 'EV');
    act(() =>
      eve.socket.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara'), listingFor(dan.code, 'Dan')] }),
    );
    await waitFor(() => expect(rows(eve.root)).toHaveLength(2));

    await userEvent.click(within(eve.root).getByRole('button', { name: "Join Cara's game" }));
    // A refused upgrade: 1006 with no welcome. NOT 1001, which is a socket the
    // server had already accepted and then closed.
    act(() => socketFor(`/api/room/${cara.code}`).close(1006));

    const alert = await within(eve.root).findByRole('alert');
    expect(alert.textContent).toMatch(/just filled/i);
    expect(within(eve.root).getByRole('heading', { name: /open games/i })).toBeTruthy();
    // No retry storm into a refusal that will never change. Cara's own host
    // socket points at the same room, so count only the ones Eve opened.
    await new Promise((r) => setTimeout(r, 60));
    expect(socketsFor(`/api/room/${cara.code}`).filter((s) => s.url.includes('u=Eve'))).toHaveLength(1);

    // She is back in front of a live lobby: the feed reopened and re-populated.
    const reopened = socketFor('/api/lobby');
    expect(reopened).not.toBe(eve.socket);
    act(() => {
      reopened.accept();
      reopened.emit({ t: 'lobby', games: [listingFor(dan.code, 'Dan')] });
    });
    const danJoin = await within(eve.root).findByRole('button', { name: "Join Dan's game" });
    expect((danJoin as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(danJoin);
    act(() => {
      const s = socketFor(`/api/room/${dan.code}`);
      s.accept();
      s.emit(welcome(dan.code, 'p2', createGame({ username: 'Dan', initials: 'DA' }, { username: 'Eve', initials: 'EV' })));
    });
    await waitFor(() => expect(within(eve.root).queryByRole('heading', { name: /open games/i })).toBeNull());
    expect(within(eve.root).getByText('Forfeit')).toBeTruthy();
  });

  // ------------------------------------------------------------------------ Q6
  it('tells Eve the lobby dropped, and recovers when it comes back', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    const eve = await browse('Eve', 'EV');
    act(() => eve.socket.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara')] }));
    await waitFor(() => expect(rows(eve.root)).toHaveLength(1));

    act(() => eve.socket.close(1006));
    await waitFor(() =>
      expect(within(eve.root).getByRole('status').textContent).toMatch(/reconnecting/i),
    );

    // Observed, and defensible: the last snapshot stays on screen while the
    // feed reconnects, so the page does not blank out. The rows are stale but
    // the live region says so, and a click on a row that has since gone lands
    // on the "just filled" path rather than a dead end (see the Q5 case).
    expect(rows(eve.root)).toHaveLength(1);
    expect(within(eve.root).getByRole('status').textContent).not.toMatch(/game[s]? waiting/);

    await waitFor(() => expect(socketsFor('/api/lobby').length).toBe(2), { timeout: 3000 });
    const retry = socketFor('/api/lobby');
    act(() => {
      retry.accept();
      retry.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara')] });
    });
    await waitFor(() =>
      expect(within(eve.root).getByRole('status').textContent).toMatch(/1 game waiting/),
    );
    expect(rows(eve.root)).toHaveLength(1);
  });

  // ------------------------------------------------------------------------ Q7
  it('shows an empty lobby that is not mistakable for still loading', async () => {
    const root = mount();
    await goOnline(root, 'Eve', 'EV');
    await userEvent.click(within(root).getByRole('button', { name: /Browse Open Games/ }));
    const socket = FakeWebSocket.last();

    // Before the socket opens: loading, and no "no games" claim.
    expect(within(root).getByRole('status').textContent).toMatch(/loading open games/i);
    expect(within(root).queryByText(/no open games right now/i)).toBeNull();

    act(() => {
      socket.accept();
      socket.emit({ t: 'lobby', games: [] });
    });

    await waitFor(() =>
      expect(within(root).getByText(/no open games right now/i)).toBeTruthy(),
    );
    expect(within(root).getByRole('status').textContent).toMatch(/0 games waiting/);
    expect(within(root).queryByText(/loading open games/i)).toBeNull();
    expect(within(root).queryAllByRole('group', { name: /^Game hosted by / })).toHaveLength(0);
  });

  // ------------------------------------------------------------------------ Q8
  it('returns Eve to the setup screen after she joins and the game ends', async () => {
    const dan = await hostPublicGame('Dan', 'DA');
    rooms.set(dan.code, room('Dan'));
    const eve = await browse('Eve', 'EV');
    act(() => eve.socket.emit({ t: 'lobby', games: [listingFor(dan.code, 'Dan')] }));

    await userEvent.click(await within(eve.root).findByRole('button', { name: "Join Dan's game" }));
    const playing = createGame({ username: 'Dan', initials: 'DA' }, { username: 'Eve', initials: 'EV' });
    act(() => {
      const s = socketFor(`/api/room/${dan.code}`);
      s.accept();
      s.emit(welcome(dan.code, 'p2', playing));
    });
    expect(await within(eve.root).findByText('Forfeit')).toBeTruthy();

    // The game ends and she leaves from the end screen.
    act(() =>
      socketFor(`/api/room/${dan.code}`).emit({
        t: 'state',
        seq: 2,
        state: resign(playing, 'p1'),
        reason: 'resign',
        series: { p1: 0, p2: 1, draws: 0 },
      }),
    );
    const leave = await within(eve.root).findByRole('button', { name: /new game|quit|leave/i });
    await userEvent.click(leave);

    // Back on setup — not stranded on a lobby with nothing behind it.
    expect(
      await within(eve.root).findByRole('button', { name: /Browse Open Games/ }),
    ).toBeTruthy();
    expect(within(eve.root).queryByRole('heading', { name: /open games/i })).toBeNull();
  });
});

describe('what Eve sees between clicking Join and the room answering', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    rooms.clear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const code = String(input).match(/\/api\/room\/([A-Z0-9]+)/)?.[1] ?? '';
        const fact = rooms.get(code);
        return { ok: true, json: async () => fact ?? { exists: false } };
      }),
    );
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * FOUND BUG — the joiner is shown the HOST's waiting screen.
   *
   * `App.tsx:585` routes every `online && !activeState` render to <Lobby>, which
   * is written for the player who created the room: it says "Send this code to
   * the other player", prints the room code, and offers "Invite a player". Eve, who
   * just joined Cara's game from the browse list, is told to invite somebody to
   * a game that already has both seats — and the code she is invited to share is
   * Cara's. In a deployed build this is however long the join round-trip takes.
   */
  it('does not tell a joiner to invite someone to the game she just joined', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    rooms.set(cara.code, room('Cara'));
    const eve = await browse('Eve', 'EV');
    act(() => eve.socket.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara')] }));
    await userEvent.click(await within(eve.root).findByRole('button', { name: "Join Cara's game" }));

    // The room has not answered yet — this is the whole join round-trip.
    const panel = eve.root;
    expect(within(panel).queryByText(/send this code to the other player/i)).toBeNull();
    expect(within(panel).queryByRole('button', { name: /invite a player/i })).toBeNull();
    expect(within(panel).queryByText(/waiting for the other player to join/i)).toBeNull();
  });

  /**
   * FOUND BUG (minor, dead code) — PublicLobby's `busyCode` branch is
   * unreachable through the App.
   *
   * `PublicLobby.tsx:78-92` renders "Joining…" / `aria-busy` / disables the
   * other rows while a join is in flight, and `App.tsx:483` sets `busyCode`
   * exactly for that. But `joinRoom` sets `online` in the same batch, and
   * `App.tsx:571` only renders PublicLobby when `browsing && !online` — so the
   * browse screen is already gone by the time `busyCode` is non-null. The
   * pending-join affordance never reaches a user.
   */
  it('shows the pressed row as busy while the join is in flight', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    const dan = await hostPublicGame('Dan', 'DA');
    rooms.set(cara.code, room('Cara'));
    const eve = await browse('Eve', 'EV');
    act(() =>
      eve.socket.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara'), listingFor(dan.code, 'Dan')] }),
    );
    await waitFor(() => expect(rows(eve.root)).toHaveLength(2));

    await userEvent.click(within(eve.root).getByRole('button', { name: "Join Cara's game" }));

    expect(within(eve.root).queryByText('Joining…')).toBeTruthy();
    expect(
      (within(eve.root).getByRole('button', { name: "Join Dan's game" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens exactly one fresh lobby feed after a refused join, not two', async () => {
    const cara = await hostPublicGame('Cara', 'CA');
    rooms.set(cara.code, room('Cara', { full: true }));
    const eve = await browse('Eve', 'EV');
    act(() => eve.socket.emit({ t: 'lobby', games: [listingFor(cara.code, 'Cara')] }));
    await userEvent.click(await within(eve.root).findByRole('button', { name: "Join Cara's game" }));
    // Counted relative to what is already open — Cara reached her own game
    // through the lobby too, so an absolute number would only measure that.
    const feedsBefore = socketsFor('/api/lobby').length;
    act(() => socketFor(`/api/room/${cara.code}`).close(1006));

    await within(eve.root).findByRole('alert');
    await new Promise((r) => setTimeout(r, 60));
    expect(socketsFor('/api/lobby')).toHaveLength(feedsBefore + 1);
  });
});
