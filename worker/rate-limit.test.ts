/**
 * The limiter itself. Every frame that reaches a reducer costs duration, and
 * on a plan billed by duration a loop is the whole attack.
 */
import { describe, expect, it } from 'vitest';
import { LOBBY_LIMIT, ROOM_LIMIT, newBucket, spend, type Bucket } from './rate-limit';

const LIMIT = { burst: 3, perSecond: 1 };

describe('the token bucket', () => {
  it('allows a burst up to the ceiling, then refuses', () => {
    let bucket: Bucket | undefined;
    const allowed: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = spend(bucket, 1000, LIMIT);
      bucket = result.bucket;
      allowed.push(result.ok);
    }
    expect(allowed).toEqual([true, true, true, false, false]);
  });

  it('refills from elapsed time, with no timer anywhere', () => {
    let bucket = newBucket(LIMIT, 0);
    for (let i = 0; i < 3; i += 1) bucket = spend(bucket, 0, LIMIT).bucket;
    expect(spend(bucket, 0, LIMIT).ok).toBe(false);

    // One second later exactly one token is back.
    const after = spend(bucket, 1000, LIMIT);
    expect(after.ok).toBe(true);
    expect(spend(after.bucket, 1000, LIMIT).ok).toBe(false);
  });

  it('never refills past the ceiling, however long it idles', () => {
    let bucket = newBucket(LIMIT, 0);
    bucket = spend(bucket, 0, LIMIT).bucket;
    // An hour away must not buy 3600 frames of burst.
    const allowed: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = spend(bucket, 3_600_000, LIMIT);
      bucket = result.bucket;
      allowed.push(result.ok);
    }
    expect(allowed).toEqual([true, true, true, false, false]);
  });

  /**
   * A clock that jumps backwards — or an event replayed with an older stamp —
   * must not mint tokens, or the limit is bypassed by lying about the time.
   */
  it('cannot be refilled by going back in time', () => {
    let bucket = newBucket(LIMIT, 10_000);
    for (let i = 0; i < 3; i += 1) bucket = spend(bucket, 10_000, LIMIT).bucket;
    expect(spend(bucket, 0, LIMIT).ok).toBe(false);
  });

  it('starts full, so a first frame is never refused', () => {
    expect(spend(undefined, 0, ROOM_LIMIT).ok).toBe(true);
    expect(spend(undefined, 0, LOBBY_LIMIT).ok).toBe(true);
  });

  it('leaves real play far below the room limit', () => {
    // Four frames a second for ten seconds is faster than anyone plays.
    let bucket: Bucket | undefined;
    let refused = 0;
    for (let i = 0; i < 40; i += 1) {
      const result = spend(bucket, i * 250, ROOM_LIMIT);
      bucket = result.bucket;
      if (!result.ok) refused += 1;
    }
    expect(refused).toBe(0);
  });
});
