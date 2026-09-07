import {
  DEFAULT_GRID_SIZE,
  clampGridSize,
  createEdges,
  createSquares,
  edgeIdBetweenDots,
  edgeIdsForSquare,
  squareIdsTouchingEdge,
} from './board';
import type { ClockState, Dot, GameState, MoveResult, Player, PlayerId } from './types';

export interface PlayerSetup {
  username: string;
  initials: string;
}

export interface Speed {
  id: string;
  label: string;
  /** Seconds of starting clock per move the board will need. */
  baseSecondsPerMove: number;
  incrementMs: number;
}

export interface TimeControl {
  ms: number | null;
  incrementMs: number;
}

/**
 * Speeds, not fixed minute counts.
 *
 * This board is not chess: a 10x10 grid is 180 moves against chess's ~40, and
 * the move count changes with the chosen board size. A fixed "3+2" therefore
 * means something completely different on a 4x4 (17s per move) than on a 10x10
 * (4s per move). Sizing the clock from the board keeps the *feel* constant, so
 * Blitz is always Blitz.
 *
 * Every timed speed carries an increment. Without one the endgame is where you
 * flag, which is exactly where the long claiming chains need thinking time.
 */
export const SPEEDS: Speed[] = [
  { id: 'casual', label: 'Casual', baseSecondsPerMove: 0, incrementMs: 0 },
  { id: 'bullet', label: 'Bullet', baseSecondsPerMove: 1.5, incrementMs: 1_000 },
  { id: 'blitz', label: 'Blitz', baseSecondsPerMove: 2, incrementMs: 2_000 },
  { id: 'rapid', label: 'Rapid', baseSecondsPerMove: 4, incrementMs: 5_000 },
];

/** Total edges on a board, which is also its total number of moves. */
export function edgeCountFor(gridSize: number): number {
  const size = clampGridSize(gridSize);
  return 2 * size * (size - 1);
}

/** The clock a speed produces on a given board. */
export function timeControlFor(gridSize: number, speed: Speed): TimeControl {
  if (speed.baseSecondsPerMove === 0) return { ms: null, incrementMs: 0 };
  const movesPerPlayer = edgeCountFor(gridSize) / 2;
  const seconds = movesPerPlayer * speed.baseSecondsPerMove;
  // Rounded to a tidy 5s, with a floor so a tiny board is still playable.
  const rounded = Math.max(15, Math.round(seconds / 5) * 5);
  return { ms: rounded * 1_000, incrementMs: speed.incrementMs };
}

/** "3:00 + 2s", or "No limit" — shown so the computed clock is never a mystery. */
export function describeTimeControl(control: TimeControl): string {
  if (control.ms === null) return 'No limit';
  const total = Math.round(control.ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const clock = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `0:${String(secs).padStart(2, '0')}`;
  return control.incrementMs > 0 ? `${clock} + ${control.incrementMs / 1000}s` : clock;
}

export function createGame(
  playerOne: PlayerSetup,
  playerTwo: PlayerSetup,
  gridSize = DEFAULT_GRID_SIZE,
  timeControlMs: number | null = null,
  incrementMs = 0,
): GameState {
  const makePlayer = (id: PlayerId, setup: PlayerSetup): Player => ({
    id,
    username: setup.username.trim(),
    initials: setup.initials.trim().toUpperCase(),
    squares: 0,
  });

  // Clamp once, here — the board builders and the recorded gridSize must agree,
  // or the board carries more edges than the state claims.
  const size = clampGridSize(gridSize);

  return {
    players: {
      p1: makePlayer('p1', playerOne),
      p2: makePlayer('p2', playerTwo),
    },
    currentPlayer: 'p1',
    edges: createEdges(size),
    squares: createSquares(size),
    status: 'playing',
    winner: null,
    ending: null,
    endedBy: null,
    lastClaimedSquares: [],
    gridSize: size,
    clock:
      timeControlMs === null
        ? null
        : {
            initialMs: timeControlMs,
            incrementMs,
            remainingMs: { p1: timeControlMs, p2: timeControlMs },
            turnStartedAt: null,
          },
  };
}

/**
 * Milliseconds a player has left as of `now`, counting down the turn that is
 * currently running. Display-only — never the authority on whether the flag
 * has fallen; that is `hasFlagged`.
 */
export function remainingMsFor(state: GameState, playerId: PlayerId, now: number): number {
  const { clock } = state;
  if (!clock) return Infinity;
  const banked = clock.remainingMs[playerId];
  const startedAt = clock.turnStartedAt;
  const running = state.status === 'playing' && startedAt !== null && state.currentPlayer === playerId;
  return running ? Math.max(0, banked - (now - startedAt)) : banked;
}

/** True when the player to move has run out of time. */
export function hasFlagged(state: GameState, now: number): boolean {
  if (!state.clock || state.status !== 'playing') return false;
  return remainingMsFor(state, state.currentPlayer, now) <= 0;
}

/** Starts the clock for whoever is to move. Idempotent. */
export function startClock(state: GameState, now: number): GameState {
  if (!state.clock || state.status !== 'playing' || state.clock.turnStartedAt !== null) {
    return state;
  }
  return { ...state, clock: { ...state.clock, turnStartedAt: now } };
}

/** The player ran out of time: they lose, whatever the score. */
export function flagPlayer(state: GameState, playerId: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return {
    ...state,
    status: 'finished',
    winner: otherPlayer(playerId),
    ending: 'timeout',
    endedBy: playerId,
    lastClaimedSquares: [],
    clock: state.clock
      ? {
          ...state.clock,
          remainingMs: { ...state.clock.remainingMs, [playerId]: 0 },
          turnStartedAt: null,
        }
      : null,
  };
}

export function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === 'p1' ? 'p2' : 'p1';
}

export function isEdgeAvailable(state: GameState, edgeId: string): boolean {
  const edge = state.edges[edgeId];
  return state.status === 'playing' && edge !== undefined && edge.owner === null;
}

export function remainingEdgeCount(state: GameState): number {
  return Object.values(state.edges).filter((edge) => edge.owner === null).length;
}

/**
 * Only ever score-compares. A resignation or an agreed draw sets its winner
 * explicitly, so this must not be consulted for those endings — the resigner
 * loses whatever the score says.
 */
export function calculateWinner(state: GameState): PlayerId | 'draw' | null {
  if (state.status !== 'finished') return null;
  if (state.ending !== null && state.ending !== 'board-complete') return state.winner;
  const { p1, p2 } = state.players;
  if (p1.squares > p2.squares) return 'p1';
  if (p2.squares > p1.squares) return 'p2';
  return 'draw';
}

/** The player gives up: they lose, however the board currently stands. */
export function resign(state: GameState, playerId: PlayerId): GameState {
  if (state.status !== 'playing') return state;
  return {
    ...state,
    status: 'finished',
    winner: otherPlayer(playerId),
    ending: 'resignation',
    endedBy: playerId,
    lastClaimedSquares: [],
  };
}

/** Both players agreed to a tie, regardless of the score. */
export function agreeDraw(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  return {
    ...state,
    status: 'finished',
    winner: 'draw',
    ending: 'agreed-draw',
    endedBy: null,
    lastClaimedSquares: [],
  };
}

/**
 * Claims an edge for the current player and applies every rule that follows.
 *
 * `now` is only needed for a timed game — it charges the mover for the turn
 * they just spent and restarts the clock for whoever moves next. Untimed games
 * ignore it entirely, which is why it stays optional and last.
 */
export function makeMove(state: GameState, edgeId: string, now?: number): MoveResult {
  if (state.status !== 'playing') {
    return { ok: false, state, reason: 'game-over' };
  }

  // A move made after the flag fell does not count; the clock decides first.
  if (now !== undefined && hasFlagged(state, now)) {
    return { ok: false, state: flagPlayer(state, state.currentPlayer), reason: 'game-over' };
  }

  const edge = state.edges[edgeId];
  if (!edge) {
    return { ok: false, state, reason: 'unknown-edge' };
  }
  if (edge.owner !== null) {
    return { ok: false, state, reason: 'edge-taken' };
  }

  const mover = state.currentPlayer;
  const edges = { ...state.edges, [edgeId]: { ...edge, owner: mover } };
  const squares = { ...state.squares };

  const claimedSquares: string[] = [];
  for (const id of squareIdsTouchingEdge(edge, state.gridSize)) {
    const square = squares[id];
    if (!square || square.owner !== null) continue;
    const isComplete = edgeIdsForSquare(square.row, square.column).every(
      (boundaryId) => edges[boundaryId]?.owner !== null,
    );
    if (isComplete) {
      squares[id] = { ...square, owner: mover };
      claimedSquares.push(id);
    }
  }

  const players = { ...state.players };
  if (claimedSquares.length > 0) {
    players[mover] = { ...players[mover], squares: players[mover].squares + claimedSquares.length };
  }

  const extraTurn = claimedSquares.length > 0;
  const boardFull = Object.values(edges).every((candidate) => candidate.owner !== null);

  const nextState: GameState = {
    ...state,
    players,
    edges,
    squares,
    currentPlayer: extraTurn ? mover : otherPlayer(mover),
    status: boardFull ? 'finished' : 'playing',
    winner: null,
    ending: boardFull ? 'board-complete' : null,
    endedBy: null,
    lastClaimedSquares: claimedSquares,
    clock: chargeClock(state, mover, now),
  };
  nextState.winner = calculateWinner(nextState);

  return { ok: true, state: nextState, claimedSquares, extraTurn };
}

/**
 * Deducts the elapsed turn from the mover and restarts the clock for the next
 * turn. Note the clock restarts even when the mover keeps the turn after
 * claiming a square — their own time keeps running, as it would in chess.
 */
function chargeClock(state: GameState, mover: PlayerId, now: number | undefined): ClockState | null {
  const { clock } = state;
  if (!clock) return null;
  if (now === undefined) return clock;

  const spent = clock.turnStartedAt === null ? 0 : now - clock.turnStartedAt;
  // Charge the turn first, then credit the increment — a player who moves in
  // under the increment ends up ahead, which is the point of blitz.
  const left = Math.max(0, clock.remainingMs[mover] - spent) + clock.incrementMs;
  return {
    ...clock,
    remainingMs: { ...clock.remainingMs, [mover]: left },
    turnStartedAt: now,
  };
}

/** Convenience wrapper for input expressed as two dots rather than an edge id. */
export function makeMoveBetweenDots(state: GameState, a: Dot, b: Dot): MoveResult {
  const edgeId = edgeIdBetweenDots(a, b, state.gridSize);
  if (edgeId === null) {
    return { ok: false, state, reason: 'not-adjacent' };
  }
  return makeMove(state, edgeId);
}
