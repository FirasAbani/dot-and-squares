export type PlayerId = 'p1' | 'p2';

export type Orientation = 'horizontal' | 'vertical';

export type GameStatus = 'playing' | 'finished';

/**
 * How a finished game ended. Needed because a resignation must lose *even when
 * the resigner is ahead on squares* — so the winner cannot be derived from the
 * score alone the way `board-complete` allows.
 */
export type GameEnding = 'board-complete' | 'resignation' | 'agreed-draw' | 'timeout';

/**
 * A chess-style clock. Stored as *timestamps and balances*, never as a ticking
 * counter — so the server needs no interval to keep it honest, and a client can
 * render a smooth countdown from `turnStartedAt` without ever being the
 * authority on it.
 */
export interface ClockState {
  /** Starting allowance per player, in milliseconds. */
  initialMs: number;
  /**
   * Fischer increment: milliseconds added to a player's clock when they
   * complete a move. This is what makes a blitz clock a blitz clock — without
   * it a long game is unwinnable however fast you play.
   */
  incrementMs: number;
  /** Time each player has banked, excluding any turn currently running. */
  remainingMs: Record<PlayerId, number>;
  /** Epoch ms when the current player's turn began; null before the first move. */
  turnStartedAt: number | null;
}

export interface Player {
  id: PlayerId;
  username: string;
  initials: string;
  squares: number;
}

export interface Dot {
  row: number;
  column: number;
}

export interface Edge {
  id: string;
  orientation: Orientation;
  row: number;
  column: number;
  owner: PlayerId | null;
}

export interface Square {
  id: string;
  row: number;
  column: number;
  owner: PlayerId | null;
}

export interface GameState {
  players: Record<PlayerId, Player>;
  currentPlayer: PlayerId;
  edges: Record<string, Edge>;
  squares: Record<string, Square>;
  status: GameStatus;
  /** Null while playing, a PlayerId when someone won, 'draw' on a tie. */
  winner: PlayerId | 'draw' | null;
  /** Null while playing; how the game ended once it is finished. */
  ending: GameEnding | null;
  /** The player who resigned, when `ending` is 'resignation'. */
  endedBy: PlayerId | null;
  /** Squares claimed by the most recent move, for UI animation/feedback. */
  lastClaimedSquares: string[];
  /** Size of the dot grid, e.g. 10 means a 10 x 10 grid of dots. */
  gridSize: number;
  /** Null when the match is untimed. */
  clock: ClockState | null;
}

export type MoveRejectionReason =
  | 'game-over'
  | 'unknown-edge'
  | 'edge-taken'
  | 'not-adjacent';

export type MoveResult =
  | { ok: true; state: GameState; claimedSquares: string[]; extraTurn: boolean }
  | { ok: false; state: GameState; reason: MoveRejectionReason };
