/**
 * All lobby rules, as a pure function — the same discipline as `room-logic.ts`.
 *
 * The lobby is a cache, never an authority. It hands out a list of games that
 * looked joinable a moment ago; the room itself is the only thing that can
 * grant a seat. A stale row therefore costs one friendly refusal, never a
 * wrong game, which is what lets every write here be advisory and cheap.
 */
import { LOBBY_LIMIT, spend, type Bucket } from './rate-limit';
import type {
  LobbyAnnounce,
  LobbyClientMessage,
  LobbyListing,
  LobbyServerMessage,
} from '../src/shared/protocol';

/**
 * How long a listing survives without being renewed. The backstop for a room
 * whose Durable Object died without ever running a close handler — the only
 * failure mode the room's own deregistration cannot cover.
 */
export const LISTING_TTL_MS = 15 * 60 * 1000;

/** An upper bound on the list, so a reconnect loop cannot flood the screen. */
export const MAX_LISTINGS = 100;

export interface StoredListing extends LobbyListing {
  expiresAt: number;
}

export interface LobbyState {
  /** Storage schema version, as in `RoomMeta.v` — not the wire protocol. */
  v: number;
  listings: Record<string, StoredListing>;
}

export type LobbyEvent =
  | { k: 'announce'; announce: LobbyAnnounce; now: number }
  | { k: 'message'; msg: LobbyClientMessage; now: number; bucket?: Bucket }
  | { k: 'connect'; now: number }
  | { k: 'alarm'; now: number };

export type LobbyEffect = { to: 'all' | 'sender'; msg: LobbyServerMessage };

export interface LobbyReduceResult {
  state: LobbyState;
  effects: LobbyEffect[];
  /** The sender's bucket after this frame; the caller writes it back. */
  bucket?: Bucket;
}

/**
 * Rebuilds an announce from known fields only, clamped the way `GameRoom`
 * clamps identity at the upgrade.
 *
 * The callers are all internal today, but this is the one place where one
 * room's text reaches every browser in the lobby, and a whitelist here means
 * that stays safe however the callers change.
 */
export function sanitiseAnnounce(announce: LobbyAnnounce): LobbyAnnounce {
  if (announce.k === 'unlist') return { k: 'unlist', code: String(announce.code).slice(0, 6) };
  const listing = announce.listing;
  return {
    k: 'list',
    listing: {
      code: String(listing.code).slice(0, 6),
      hostName: String(listing.hostName).slice(0, 16),
      hostInitials: String(listing.hostInitials).slice(0, 3),
      gridSize: Number(listing.gridSize) || 0,
      timeControlMs: listing.timeControlMs === null ? null : Number(listing.timeControlMs) || 0,
      incrementMs: Number(listing.incrementMs) || 0,
      createdAt: Number(listing.createdAt) || 0,
    },
  };
}

export function emptyLobby(): LobbyState {
  return { v: 1, listings: {} };
}

/** Newest first, expired rows filtered — what any snapshot actually contains. */
export function visibleGames(state: LobbyState, now: number): LobbyListing[] {
  return Object.values(state.listings)
    .filter((listing) => listing.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ expiresAt: _expiresAt, ...listing }) => listing);
}

function snapshot(state: LobbyState, now: number, to: 'all' | 'sender'): LobbyEffect {
  return { to, msg: { t: 'lobby', games: visibleGames(state, now) } };
}

export function reduceLobby(state: LobbyState, event: LobbyEvent): LobbyReduceResult {
  switch (event.k) {
    case 'connect':
      return { state, effects: [snapshot(state, event.now, 'sender')] };

    case 'message': {
      // A refresh serialises every listing for the asker. The feed is pushed
      // anyway, so asking is a convenience — and one worth paying for at a
      // sane rate rather than as fast as a loop can ask.
      const { bucket, ok } = spend(event.bucket, event.now, LOBBY_LIMIT);
      if (!ok) {
        return {
          state,
          bucket,
          effects: [
            {
              to: 'sender',
              msg: { t: 'error', code: 'rate-limited', message: 'Too many refreshes' },
            },
          ],
        };
      }
      if (event.msg?.t !== 'refresh') {
        return {
          state,
          bucket,
          effects: [
            { to: 'sender', msg: { t: 'error', code: 'bad-message', message: 'Unknown type' } },
          ],
        };
      }
      return { state, bucket, effects: [snapshot(state, event.now, 'sender')] };
    }

    case 'announce':
      return announce(state, event.announce, event.now);

    case 'alarm': {
      const listings = Object.fromEntries(
        Object.entries(state.listings).filter(([, listing]) => listing.expiresAt > event.now),
      );
      const dropped = Object.keys(listings).length !== Object.keys(state.listings).length;
      if (!dropped) return { state, effects: [] };
      const next = { ...state, listings };
      return { state: next, effects: [snapshot(next, event.now, 'all')] };
    }
  }
}

function announce(state: LobbyState, msg: LobbyAnnounce, now: number): LobbyReduceResult {
  if (msg.k === 'unlist') {
    if (!(msg.code in state.listings)) return { state, effects: [] };
    const listings = { ...state.listings };
    delete listings[msg.code];
    const next = { ...state, listings };
    return { state: next, effects: [snapshot(next, now, 'all')] };
  }

  const isNew = !(msg.listing.code in state.listings);
  // A full lobby refuses newcomers but still lets existing hosts renew, so a
  // flood cannot evict the games people are already looking at.
  if (isNew && Object.keys(state.listings).length >= MAX_LISTINGS) {
    return { state, effects: [] };
  }

  const listings = {
    ...state.listings,
    // Keyed by code, so a host reconnecting upserts rather than duplicates.
    [msg.listing.code]: { ...msg.listing, expiresAt: now + LISTING_TTL_MS },
  };
  const next = { ...state, listings };

  // A renewal changes only the expiry, which no watcher can see. Broadcasting
  // it anyway would wake every browser in the lobby on a timer, multiplied by
  // the number of waiting hosts, to tell them nothing.
  const unchanged =
    JSON.stringify(visibleGames(state, now)) === JSON.stringify(visibleGames(next, now));
  return { state: next, effects: unchanged ? [] : [snapshot(next, now, 'all')] };
}

/**
 * The earliest expiry, or null when there is nothing to sweep. One alarm, never
 * a repeating tick — a resident Durable Object is billed for duration.
 */
export function nextLobbyAlarmAt(state: LobbyState): number | null {
  const times = Object.values(state.listings).map((listing) => listing.expiresAt);
  return times.length ? Math.min(...times) : null;
}
