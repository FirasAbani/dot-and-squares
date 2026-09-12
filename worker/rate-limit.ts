/**
 * A token bucket, as a pure function.
 *
 * Every socket frame that reaches a reducer costs real duration: the room runs
 * game logic, writes storage and sets an alarm; the lobby serialises its whole
 * listing set. Nothing stopped one client sending those as fast as it could
 * type them, and on a plan billed by duration that is the cheapest attack there
 * is — no bug required, just a loop.
 *
 * The bucket lives on the socket attachment rather than in room state, because
 * room state is rebuilt from storage on every request: a counter kept there
 * would reset with each frame and limit nothing. Per-connection is also the
 * right grain — one player flooding must not throttle their opponent.
 *
 * Refilling from elapsed time rather than on a timer is what keeps the "no
 * timers in a Durable Object" rule intact: an idle connection costs nothing and
 * arrives with a full bucket.
 */
export interface Bucket {
  tokens: number;
  /** When `tokens` was last accurate. */
  last: number;
}

export interface Limit {
  /** How much burst is allowed — the bucket's ceiling. */
  burst: number;
  /** How fast it refills. */
  perSecond: number;
}

/** Room frames: a fast human plays a few a second; a loop plays thousands. */
export const ROOM_LIMIT: Limit = { burst: 40, perSecond: 15 };

/** Lobby refreshes: the feed is pushed, so asking is a convenience, not a need. */
export const LOBBY_LIMIT: Limit = { burst: 10, perSecond: 1 };

export function newBucket(limit: Limit, now: number): Bucket {
  return { tokens: limit.burst, last: now };
}

/**
 * Spend one token. Returns the new bucket and whether the frame is allowed.
 *
 * A clock that jumps backwards (or an event replayed with an older timestamp)
 * must not mint tokens, so elapsed time is floored at zero.
 */
export function spend(
  bucket: Bucket | undefined,
  now: number,
  limit: Limit,
): { bucket: Bucket; ok: boolean } {
  const current = bucket ?? newBucket(limit, now);
  const elapsed = Math.max(0, now - current.last) / 1000;
  const tokens = Math.min(limit.burst, current.tokens + elapsed * limit.perSecond);

  if (tokens < 1) return { bucket: { tokens, last: now }, ok: false };
  return { bucket: { tokens: tokens - 1, last: now }, ok: true };
}
