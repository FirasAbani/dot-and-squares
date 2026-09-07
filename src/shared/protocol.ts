/**
 * Wire protocol between the browser and the GameRoom Durable Object.
 *
 * Lives under `src/` so the existing root tsconfig picks it up unchanged; the
 * worker's own tsconfig reaches in here too. Types only — no runtime imports
 * beyond the engine's own types, so this file is free to import either side.
 */
import type { GameState, MoveRejectionReason, PlayerId } from '../engine';

/** Bumped whenever an engine rule or a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 2;

export type SeatStatus = 'empty' | 'connected' | 'disconnected';

export type Presence = Record<PlayerId, SeatStatus>;

export type RematchVotes = Record<PlayerId, boolean>;

/** Running head-to-head tally across rematches in one room. */
export interface Series {
  p1: number;
  p2: number;
  draws: number;
}

/** Transport-level refusals, on top of the engine's own move rejections. */
export type RejectionReason =
  | MoveRejectionReason
  | 'not-your-turn'
  | 'no-seat'
  | 'stale'
  | 'no-game';

export type ClientMessage =
  /** `seq` is the last sequence number this client has applied. */
  | { t: 'move'; edgeId: string; seq: number }
  | { t: 'resign' }
  | { t: 'offer-draw' }
  | { t: 'respond-draw'; accept: boolean }
  | { t: 'rematch'; want: boolean }
  | { t: 'resync' }
  | { t: 'leave' };

export type ServerMessage =
  | {
      t: 'welcome';
      seat: PlayerId;
      code: string;
      seq: number;
      state: GameState | null;
      presence: Presence;
      rematch: RematchVotes;
      drawOfferedBy: PlayerId | null;
      series: Series;
    }
  | {
      t: 'state';
      seq: number;
      state: GameState;
      reason: 'sync' | 'start' | 'move' | 'rematch' | 'resign' | 'draw';
      series: Series;
    }
  | { t: 'presence'; presence: Presence }
  | { t: 'rematch'; votes: RematchVotes }
  | { t: 'draw-offered'; by: PlayerId }
  | { t: 'draw-declined'; by: PlayerId }
  | { t: 'rejected'; reason: RejectionReason }
  | { t: 'error'; code: 'room-closed' | 'bad-message'; message: string };

/**
 * A preview of a room, fetched over plain HTTP before joining. Lets the second
 * player see what they are walking into — board size, clock, who is hosting —
 * and decline without ever taking a seat.
 */
export interface RoomInfo {
  exists: boolean;
  visibility: RoomVisibility;
  full: boolean;
  inProgress: boolean;
  hostName: string | null;
  gridSize: number;
  timeControlMs: number | null;
  incrementMs: number;
}

/** HTTP status reasons the upgrade can fail with, surfaced to the join screen. */
export type JoinFailure = 'bad-code' | 'room-exists' | 'room-full' | 'room-closed';

/**
 * Who may join a staged game. `public` lists it in the lobby for anyone to
 * take; `private` is the original behaviour — reachable only with the code.
 */
export type RoomVisibility = 'public' | 'private';

/** One pending public game, as shown on the lobby screen. */
export interface LobbyListing {
  code: string;
  hostName: string;
  hostInitials: string;
  gridSize: number;
  timeControlMs: number | null;
  incrementMs: number;
  createdAt: number;
}

/** Browsing is read-only; `refresh` re-syncs a socket that survived a sleep. */
export type LobbyClientMessage = { t: 'refresh' };

export type LobbyServerMessage =
  /**
   * The whole list, every time. Snapshots rather than deltas: a listing race
   * then heals itself on the next broadcast instead of needing reconciliation.
   */
  | { t: 'lobby'; games: LobbyListing[] }
  | { t: 'error'; code: 'bad-message'; message: string };

/**
 * Room to lobby, carried on an internal stub fetch. Never routed from the
 * public Worker, so it is unreachable from the internet by construction.
 */
export type LobbyAnnounce =
  | { k: 'list'; listing: LobbyListing }
  | { k: 'unlist'; code: string };
