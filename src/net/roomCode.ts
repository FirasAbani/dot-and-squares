import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
  type RoomInfo,
} from '../shared/protocol';

/**
 * Room codes are generated in the browser and confirmed by the server, so
 * creating a room costs no extra request — the WebSocket upgrade carries
 * `create=1` and the server answers 409 if the code is already taken.
 */

// The alphabet and the pattern live in shared/protocol.ts, so the server
// refuses exactly what this cannot produce.
export const CODE_LENGTH = ROOM_CODE_LENGTH;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('');
}

export function normaliseRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/**
 * A per-TAB, per-room identity, so a refresh reclaims the same seat.
 *
 * Deliberately `sessionStorage`, not `localStorage`. The server treats a known
 * token as the same player returning and hands back their existing seat — so
 * with `localStorage`, which every window of a browser shares, two windows on
 * one machine both claimed p1 and the second seat was never filled. The game
 * could never start. `sessionStorage` is scoped to the tab, so two windows are
 * two players, while a refresh within a tab still reconnects.
 *
 * Known edge: duplicating a tab copies `sessionStorage` in some browsers, which
 * reproduces the clash. Open a new window rather than duplicating one.
 */
export function seatToken(code: string): string {
  const key = `ds:token:${code}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private browsing or blocked storage: a fresh token each time means no
    // reconnect, but the game still works.
    return crypto.randomUUID();
  }
}

export function shareLink(code: string): string {
  return `${location.origin}/?room=${code}`;
}

/**
 * Reads a room's settings without joining it, so the second player can see the
 * match and decline. Returns null when the room cannot be reached.
 */
export async function fetchRoomInfo(code: string): Promise<RoomInfo | null> {
  try {
    const response = await fetch(`/api/room/${code}?v=${PROTOCOL_VERSION}&info=1`);
    if (!response.ok) return null;
    return (await response.json()) as RoomInfo;
  } catch {
    return null;
  }
}
