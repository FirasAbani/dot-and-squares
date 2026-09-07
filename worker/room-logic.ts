/**
 * All GameRoom rules, as a pure function.
 *
 * The Durable Object is only I/O around this: parse an upgrade, call in here,
 * persist, then send the effects. Keeping the rules pure means they are tested
 * in plain node with no Workers runtime, no sockets and no storage — the same
 * discipline that makes the game engine cheap to test.
 */
import {
  agreeDraw,
  createGame,
  flagPlayer,
  hasFlagged,
  makeMove,
  resign,
  startClock,
} from '../src/engine';
import type { GameState, PlayerId, PlayerSetup } from '../src/engine';
import type {
  ClientMessage,
  JoinFailure,
  LobbyAnnounce,
  LobbyListing,
  RoomVisibility,
  Presence,
  RematchVotes,
  RoomInfo,
  Series,
  SeatStatus,
  ServerMessage,
} from '../src/shared/protocol';

export const SEATS: PlayerId[] = ['p1', 'p2'];

export interface SeatRecord {
  token: string;
  username: string;
  initials: string;
}

export interface RoomMeta {
  v: number;
  code: string;
  createdAt: number;
  lastActivity: number;
  seats: Record<PlayerId, SeatRecord | null>;
  seq: number;
  rematch: RematchVotes;
  drawOfferedBy: PlayerId | null;
  gridSize: number;
  timeControlMs: number | null;
  incrementMs: number;
  /** Public rooms are announced to the lobby; private ones need the code. */
  visibility: RoomVisibility;
  /** Head-to-head across rematches, so a second game has stakes. */
  series: Series;
}

export interface RoomState {
  meta: RoomMeta;
  game: GameState | null;
  /**
   * Ephemeral — rebuilt from live sockets after the DO wakes, never persisted.
   * A seat stays claimed while its player is disconnected.
   */
  connected: Record<PlayerId, boolean>;
}

export type Effect =
  | { to: 'all' | 'sender' | PlayerId; msg: ServerMessage }
  | { closeRoom: true }
  /**
   * A note for the lobby, carried out by the Durable Object. Deciding this in
   * here rather than in the I/O layer is what makes registration testable in
   * plain node alongside every other room rule.
   */
  | { lobby: LobbyAnnounce };

export interface JoinRequest {
  token: string;
  username: string;
  initials: string;
  wantsCreate: boolean;
  now: number;
  /** Only honoured from the player who creates the room. */
  gridSize?: number;
  timeControlMs?: number | null;
  incrementMs?: number;
  visibility?: RoomVisibility;
}

export type JoinResult =
  | { ok: true; room: RoomState; seat: PlayerId; effects: Effect[] }
  | { ok: false; failure: JoinFailure };

export function emptyRoom(code: string, now: number): RoomState {
  return {
    meta: {
      v: 2,
      code,
      createdAt: now,
      lastActivity: now,
      seats: { p1: null, p2: null },
      seq: 0,
      rematch: { p1: false, p2: false },
      drawOfferedBy: null,
      gridSize: 10,
      timeControlMs: null,
      incrementMs: 0,
      visibility: 'private',
      series: { p1: 0, p2: 0, draws: 0 },
    },
    game: null,
    connected: { p1: false, p2: false },
  };
}

/** A read-only summary for a player deciding whether to join. */
export function roomInfo(room: RoomState): RoomInfo {
  const host = room.meta.seats.p1 ?? room.meta.seats.p2;
  return {
    exists: host !== null,
    full: SEATS.every((seat) => room.meta.seats[seat] !== null),
    inProgress: room.game !== null && room.game.status === 'playing',
    visibility: visibilityOf(room),
    hostName: host?.username ?? null,
    gridSize: room.meta.gridSize,
    timeControlMs: room.meta.timeControlMs,
    incrementMs: room.meta.incrementMs,
  };
}

/**
 * A room stored before visibility existed loads without the field. Those were
 * all code-only, so absence means private.
 */
function visibilityOf(room: RoomState): RoomVisibility {
  return room.meta.visibility ?? 'private';
}

/**
 * The listing for a room, or null when it is not something a browser should be
 * offered: private, already full, or already playing.
 */
export function listingOf(room: RoomState): LobbyListing | null {
  const hostSeat = SEATS.find((seat) => room.meta.seats[seat] !== null);
  const host = hostSeat ? room.meta.seats[hostSeat] : null;
  if (visibilityOf(room) !== 'public' || !hostSeat || !host) return null;
  if (room.game !== null) return null;
  if (SEATS.every((seat) => room.meta.seats[seat] !== null)) return null;
  // A host who has dropped is not someone to send a stranger to. They re-list
  // the moment they reconnect, because that is a change back the other way.
  if (!room.connected[hostSeat]) return null;
  return {
    code: room.meta.code,
    hostName: host.username,
    hostInitials: host.initials,
    gridSize: room.meta.gridSize,
    timeControlMs: room.meta.timeControlMs,
    incrementMs: room.meta.incrementMs,
    createdAt: room.meta.createdAt,
  };
}

/**
 * The lobby note a room owes after a transition: list it while it is pending,
 * withdraw it the moment it stops being joinable. Comparing against the room
 * as it was means an unchanged room says nothing at all.
 */
function lobbyEffects(before: RoomState, after: RoomState): Effect[] {
  const was = listingOf(before);
  const now = listingOf(after);
  if (now) return was ? [] : [{ lobby: { k: 'list', listing: now } }];
  if (was) return [{ lobby: { k: 'unlist', code: before.meta.code } }];
  return [];
}

export function presenceOf(room: RoomState): Presence {
  const status = (seat: PlayerId): SeatStatus => {
    if (!room.meta.seats[seat]) return 'empty';
    return room.connected[seat] ? 'connected' : 'disconnected';
  };
  return { p1: status('p1'), p2: status('p2') };
}

function otherSeat(seat: PlayerId): PlayerId {
  return seat === 'p1' ? 'p2' : 'p1';
}

function setupOf(record: SeatRecord): PlayerSetup {
  return { username: record.username, initials: record.initials };
}

function welcome(room: RoomState, seat: PlayerId): ServerMessage {
  return {
    t: 'welcome',
    seat,
    code: room.meta.code,
    seq: room.meta.seq,
    state: room.game,
    presence: presenceOf(room),
    rematch: room.meta.rematch,
    drawOfferedBy: room.meta.drawOfferedBy,
    series: room.meta.series,
  };
}

/**
 * Seats a player. Runs during the HTTP upgrade rather than as a message, so a
 * refusal is a plain status code and no handshake message is ever sent.
 */
export function joinRoom(room: RoomState, req: JoinRequest): JoinResult {
  const started = room.game !== null || SEATS.some((seat) => room.meta.seats[seat]);
  if (req.wantsCreate && started) {
    return { ok: false, failure: 'room-exists' };
  }
  // Joining a room that does not exist yet used to silently make you its host.
  // Harmless while a code had to be guessed; a listing that outlives its room
  // would hand that to anyone browsing. Only a creator creates.
  if (!req.wantsCreate && !started) {
    return { ok: false, failure: 'room-closed' };
  }

  // A known token always reclaims its own seat — that is what makes a refresh
  // mid-game rejoin the same match rather than taking the other chair.
  let seat = SEATS.find((candidate) => room.meta.seats[candidate]?.token === req.token);

  if (!seat) {
    seat = SEATS.find((candidate) => room.meta.seats[candidate] === null);
    if (!seat) return { ok: false, failure: 'room-full' };
  }

  const seats = { ...room.meta.seats };
  seats[seat] = { token: req.token, username: req.username, initials: req.initials };

  let next: RoomState = {
    ...room,
    meta: {
      ...room.meta,
      seats,
      lastActivity: req.now,
      // Only the creator chooses the board and the clock.
      gridSize: req.wantsCreate && req.gridSize !== undefined ? req.gridSize : room.meta.gridSize,
      timeControlMs:
        req.wantsCreate && req.timeControlMs !== undefined
          ? req.timeControlMs
          : room.meta.timeControlMs,
      incrementMs:
        req.wantsCreate && req.incrementMs !== undefined
          ? req.incrementMs
          : room.meta.incrementMs,
      visibility:
        req.wantsCreate && req.visibility !== undefined
          ? req.visibility
          : visibilityOf(room),
    },
    connected: { ...room.connected, [seat]: true },
  };

  const effects: Effect[] = [];

  // Both chairs filled and nothing under way: deal a new game.
  const p1 = next.meta.seats.p1;
  const p2 = next.meta.seats.p2;
  if (!next.game && p1 && p2) {
    next = {
      ...next,
      meta: { ...next.meta, seq: next.meta.seq + 1 },
      game: startClock(
        createGame(
          setupOf(p1),
          setupOf(p2),
          next.meta.gridSize,
          next.meta.timeControlMs,
          next.meta.incrementMs,
        ),
        req.now,
      ),
    };
  }

  effects.push({ to: 'sender', msg: welcome(next, seat) });
  effects.push({ to: otherSeat(seat), msg: { t: 'presence', presence: presenceOf(next) } });
  if (next.game && next.game !== room.game) {
    effects.push({
      to: 'all',
      msg: {
        t: 'state',
        seq: next.meta.seq,
        state: next.game,
        reason: 'start',
        series: next.meta.series,
      },
    });
  }

  effects.push(...lobbyEffects(room, next));

  return { ok: true, room: next, seat, effects };
}

export type RoomEvent =
  | { k: 'message'; seat: PlayerId; msg: ClientMessage; now: number }
  /**
   * `stillHere` is set when the seat has another live socket — a reload lands
   * its new socket before the old one's close is processed. Without it the
   * stale close would report a host as gone while they are sitting right there,
   * and unlist a room nothing would ever put back.
   */
  | { k: 'disconnect'; seat: PlayerId; now: number; stillHere?: boolean }
  | { k: 'alarm'; now: number };

export interface ReduceResult {
  room: RoomState;
  effects: Effect[];
}

const IDLE_REAP_MS = 24 * 60 * 60 * 1000;
/**
 * How often a listed room re-announces itself. Comfortably inside the lobby's
 * 15-minute listing TTL, so a waiting host never expires off the list, and a
 * `list` that failed to land gets another chance without any retry machinery.
 */
export const RENEW_LISTING_MS = 5 * 60 * 1000;

export function reduceRoom(room: RoomState, event: RoomEvent): ReduceResult {
  if (event.k === 'disconnect') {
    const next: RoomState = {
      ...room,
      // The seat is NOT freed — this is turn-based, the player can come back.
      connected: { ...room.connected, [event.seat]: event.stillHere === true },
      meta: { ...room.meta, lastActivity: event.now },
    };
    return {
      room: next,
      effects: [
        { to: 'all', msg: { t: 'presence', presence: presenceOf(next) } },
        ...lobbyEffects(room, next),
      ],
    };
  }

  if (event.k === 'alarm') {
    // The clock is authoritative here, not on any client: if the flag has
    // fallen the game ends now, whatever either browser thinks.
    if (room.game && room.game.status === 'playing' && hasFlagged(room.game, event.now)) {
      return advance(room, flagPlayer(room.game, room.game.currentPlayer), 'move');
    }
    // A room still waiting for an opponent renews its listing rather than
    // letting the lobby's TTL quietly drop it.
    const listing = listingOf(room);
    if (listing) return { room, effects: [{ lobby: { k: 'list', listing } }] };

    const idle = event.now - room.meta.lastActivity > IDLE_REAP_MS;
    const nobodyHere = SEATS.every((seat) => !room.connected[seat]);
    if (!(idle && nobodyHere)) return { room, effects: [] };
    // Withdraw before closing. Redundant when the host's disconnect already did
    // it, but an unlist of an unknown code is a no-op, and a room outliving its
    // listing is the one failure worth being sure about.
    const withdraw: Effect[] =
      visibilityOf(room) === 'public' ? [{ lobby: { k: 'unlist', code: room.meta.code } }] : [];
    return { room, effects: [...withdraw, { closeRoom: true }] };
  }

  return handleMessage(room, event.seat, event.msg, event.now);
}

function handleMessage(
  room: RoomState,
  seat: PlayerId,
  msg: ClientMessage,
  now: number,
): ReduceResult {
  const touched = (next: RoomState): RoomState => ({
    ...next,
    meta: { ...next.meta, lastActivity: now },
  });
  const reject = (reason: Parameters<typeof rejectMsg>[0]): ReduceResult => ({
    room: touched(room),
    effects: [{ to: 'sender', msg: rejectMsg(reason) }],
  });

  if (!room.meta.seats[seat]) return reject('no-seat');

  switch (msg.t) {
    case 'resync': {
      if (!room.game) return reject('no-game');
      return {
        room: touched(room),
        effects: [
          {
            to: 'sender',
            msg: {
              t: 'state',
              seq: room.meta.seq,
              state: room.game,
              reason: 'sync',
              series: room.meta.series,
            },
          },
        ],
      };
    }

    case 'move': {
      const game = room.game;
      if (!game) return reject('no-game');
      if (game.status !== 'playing') return reject('game-over');
      // The whole anti-cheat story: the sender must own the current turn.
      if (game.currentPlayer !== seat) return reject('not-your-turn');
      // Guards a laggy double-tap from consuming two edges.
      if (msg.seq !== room.meta.seq) return reject('stale');

      const result = makeMove(game, msg.edgeId, now);
      if (!result.ok) {
        // A move made after the flag fell comes back as a finished state, and
        // that ending has to be broadcast rather than just refused.
        if (result.state !== game) return advance(touched(room), result.state, 'move');
        return reject(result.reason);
      }

      return advance(touched(room), result.state, 'move');
    }

    case 'resign': {
      if (!room.game || room.game.status !== 'playing') return reject('game-over');
      return advance(touched(room), resign(room.game, seat), 'resign');
    }

    case 'offer-draw': {
      if (!room.game || room.game.status !== 'playing') return reject('game-over');
      const next = touched({
        ...room,
        meta: { ...room.meta, drawOfferedBy: seat },
      });
      return {
        room: next,
        effects: [{ to: otherSeat(seat), msg: { t: 'draw-offered', by: seat } }],
      };
    }

    case 'respond-draw': {
      const offeredBy = room.meta.drawOfferedBy;
      // Only the opponent can answer, and only an offer that is still open.
      if (!offeredBy || offeredBy === seat || !room.game) return reject('no-game');

      const cleared = touched({ ...room, meta: { ...room.meta, drawOfferedBy: null } });
      if (!msg.accept) {
        return {
          room: cleared,
          effects: [{ to: offeredBy, msg: { t: 'draw-declined', by: seat } }],
        };
      }
      return advance(cleared, agreeDraw(room.game), 'draw');
    }

    case 'rematch': {
      const votes = { ...room.meta.rematch, [seat]: msg.want };
      const bothWant = SEATS.every((candidate) => votes[candidate]);
      const p1 = room.meta.seats.p1;
      const p2 = room.meta.seats.p2;

      if (!bothWant || !p1 || !p2) {
        return {
          room: touched({ ...room, meta: { ...room.meta, rematch: votes } }),
          effects: [{ to: 'all', msg: { t: 'rematch', votes } }],
        };
      }

      const cleared = touched({
        ...room,
        meta: { ...room.meta, rematch: { p1: false, p2: false }, drawOfferedBy: null },
      });
      return advance(
        cleared,
        startClock(
          createGame(
            setupOf(p1),
            setupOf(p2),
            room.meta.gridSize,
            room.meta.timeControlMs,
            room.meta.incrementMs,
          ),
          now,
        ),
        'rematch',
      );
    }

    case 'leave': {
      const left = touched({ ...room, connected: { ...room.connected, [seat]: false } });
      return {
        room: left,
        effects: [
          { to: 'all', msg: { t: 'presence', presence: presenceOf(left) } },
          ...lobbyEffects(room, left),
        ],
      };
    }

    default: {
      return {
        room: touched(room),
        effects: [
          { to: 'sender', msg: { t: 'error', code: 'bad-message', message: 'Unknown message' } },
        ],
      };
    }
  }
}

function rejectMsg(reason: NonNullable<Extract<ServerMessage, { t: 'rejected' }>['reason']>) {
  return { t: 'rejected', reason } as const;
}

/** Commits a new game state: bumps seq, clears any draw offer, broadcasts. */
function advance(
  room: RoomState,
  game: GameState,
  reason: Extract<ServerMessage, { t: 'state' }>['reason'],
): ReduceResult {
  const seq = room.meta.seq + 1;

  // Count the result once, at the transition into a finished game.
  const justFinished = game.status === 'finished' && room.game?.status !== 'finished';
  const series = justFinished
    ? {
        p1: room.meta.series.p1 + (game.winner === 'p1' ? 1 : 0),
        p2: room.meta.series.p2 + (game.winner === 'p2' ? 1 : 0),
        draws: room.meta.series.draws + (game.winner === 'draw' ? 1 : 0),
      }
    : room.meta.series;

  const next: RoomState = {
    ...room,
    meta: { ...room.meta, seq, drawOfferedBy: null, series },
    game,
  };
  return {
    room: next,
    effects: [{ to: 'all', msg: { t: 'state', seq, state: game, reason, series } }],
  };
}

/**
 * When the DO should next wake to check the clock: the moment the player to
 * move runs out, or the idle-reap deadline when the game is untimed.
 *
 * A single alarm per turn, never a repeating timer — a timer would keep the
 * object resident and bill duration for the whole life of the room.
 */
export function nextAlarmAt(room: RoomState): number {
  const reapAt = room.meta.lastActivity + IDLE_REAP_MS;
  // A listed room wakes sooner, only to renew its listing. Still one alarm.
  if (listingOf(room)) return Math.min(reapAt, room.meta.lastActivity + RENEW_LISTING_MS);
  const game = room.game;
  if (!game?.clock || game.status !== 'playing' || game.clock.turnStartedAt === null) {
    return reapAt;
  }
  const flagAt = game.clock.turnStartedAt + game.clock.remainingMs[game.currentPlayer];
  return Math.min(flagAt, reapAt);
}
