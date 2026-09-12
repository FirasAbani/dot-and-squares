import { describe, expect, it } from 'vitest';
import type { LobbyListing, LobbyServerMessage } from '../src/shared/protocol';
import {
  emptyLobby,
  LISTING_TTL_MS,
  MAX_LISTINGS,
  nextLobbyAlarmAt,
  reduceLobby,
  sanitiseAnnounce,
  visibleGames,
  type LobbyEffect,
  type LobbyState,
} from './lobby-logic';

function listing(code: string, createdAt = 1000): LobbyListing {
  return {
    code,
    hostName: 'Ada',
    hostInitials: 'AL',
    gridSize: 10,
    timeControlMs: null,
    incrementMs: 0,
    createdAt,
  };
}

function list(state: LobbyState, code: string, now = 1000, createdAt = now) {
  return reduceLobby(state, { k: 'announce', announce: { k: 'list', listing: listing(code, createdAt) }, now });
}

function unlist(state: LobbyState, code: string, now = 1000) {
  return reduceLobby(state, { k: 'announce', announce: { k: 'unlist', code }, now });
}

/** The games carried by the first snapshot in an effect list. */
function gamesIn(effects: LobbyEffect[]): LobbyListing[] {
  const msg = effects.map((effect) => effect.msg).find((m): m is Extract<LobbyServerMessage, { t: 'lobby' }> => m.t === 'lobby');
  if (!msg) throw new Error('expected a lobby snapshot');
  return msg.games;
}

describe('listing games', () => {
  it('broadcasts a snapshot containing a newly listed game', () => {
    const { state, effects } = list(emptyLobby(), 'ABC234');
    expect(effects).toHaveLength(1);
    expect(effects[0].to).toBe('all');
    expect(gamesIn(effects).map((game) => game.code)).toEqual(['ABC234']);
    expect(visibleGames(state, 1000)).toHaveLength(1);
  });

  it('upserts rather than duplicates when a host re-lists the same code', () => {
    const first = list(emptyLobby(), 'ABC234').state;
    const second = list(first, 'ABC234', 2000);
    expect(visibleGames(second.state, 2000)).toHaveLength(1);
    expect(gamesIn(second.effects)).toHaveLength(1);
  });

  it('orders newest first', () => {
    let state = list(emptyLobby(), 'AAA111', 1000, 1000).state;
    state = list(state, 'BBB222', 1000, 5000).state;
    expect(visibleGames(state, 1000).map((game) => game.code)).toEqual(['BBB222', 'AAA111']);
  });

  it('never leaks the internal expiry onto the wire', () => {
    const { effects } = list(emptyLobby(), 'ABC234');
    expect(gamesIn(effects)[0]).not.toHaveProperty('expiresAt');
  });

  it('refuses a new listing once full, without disturbing the existing ones', () => {
    let state = emptyLobby();
    for (let i = 0; i < MAX_LISTINGS; i += 1) {
      state = list(state, `C${String(i).padStart(5, '0')}`).state;
    }
    expect(visibleGames(state, 1000)).toHaveLength(MAX_LISTINGS);

    const overflow = list(state, 'ZZZ999');
    expect(overflow.effects).toHaveLength(0);
    expect(visibleGames(overflow.state, 1000)).toHaveLength(MAX_LISTINGS);
  });

  it('still lets an existing host renew when the lobby is full', () => {
    let state = emptyLobby();
    for (let i = 0; i < MAX_LISTINGS; i += 1) {
      state = list(state, `C${String(i).padStart(5, '0')}`).state;
    }
    const renewed = list(state, 'C00000', 9000);
    expect(renewed.effects).toHaveLength(1);
    expect(visibleGames(renewed.state, 9000)).toHaveLength(MAX_LISTINGS);
  });
});

describe('unlisting games', () => {
  it('removes the game and broadcasts once', () => {
    const listed = list(emptyLobby(), 'ABC234').state;
    const { state, effects } = unlist(listed, 'ABC234');
    expect(effects).toHaveLength(1);
    expect(gamesIn(effects)).toEqual([]);
    expect(visibleGames(state, 1000)).toEqual([]);
  });

  it('says nothing at all when the code was never listed', () => {
    const { effects } = unlist(emptyLobby(), 'NOPE99');
    expect(effects).toEqual([]);
  });
});

describe('expiry', () => {
  it('hides a listing past its time to live', () => {
    const { state } = list(emptyLobby(), 'ABC234', 1000);
    expect(visibleGames(state, 1000 + LISTING_TTL_MS - 1)).toHaveLength(1);
    expect(visibleGames(state, 1000 + LISTING_TTL_MS + 1)).toHaveLength(0);
  });

  it('drops expired rows on the alarm and tells everyone', () => {
    const { state } = list(emptyLobby(), 'ABC234', 1000);
    const swept = reduceLobby(state, { k: 'alarm', now: 1000 + LISTING_TTL_MS + 1 });
    expect(swept.state.listings).toEqual({});
    expect(swept.effects).toHaveLength(1);
    expect(swept.effects[0].to).toBe('all');
  });

  it('stays quiet when the alarm finds nothing to sweep', () => {
    const { state } = list(emptyLobby(), 'ABC234', 1000);
    expect(reduceLobby(state, { k: 'alarm', now: 2000 }).effects).toEqual([]);
  });

  it('schedules one alarm at the earliest expiry, and none when empty', () => {
    expect(nextLobbyAlarmAt(emptyLobby())).toBeNull();
    let state = list(emptyLobby(), 'AAA111', 5000).state;
    state = list(state, 'BBB222', 1000).state;
    expect(nextLobbyAlarmAt(state)).toBe(1000 + LISTING_TTL_MS);
  });
});

describe('watchers', () => {
  it('sends the full list to the socket that just connected', () => {
    const state = list(emptyLobby(), 'ABC234').state;
    const { effects } = reduceLobby(state, { k: 'connect', now: 1000 });
    expect(effects).toHaveLength(1);
    expect(effects[0].to).toBe('sender');
    expect(gamesIn(effects).map((game) => game.code)).toEqual(['ABC234']);
  });

  it('answers a refresh with a sender-only snapshot', () => {
    const state = list(emptyLobby(), 'ABC234').state;
    const { effects } = reduceLobby(state, { k: 'message', msg: { t: 'refresh' }, now: 1000 });
    expect(effects[0].to).toBe('sender');
    expect(gamesIn(effects)).toHaveLength(1);
  });

  it('refuses an unknown message without touching the list', () => {
    const state = list(emptyLobby(), 'ABC234').state;
    const { effects } = reduceLobby(state, {
      k: 'message',
      msg: { t: 'nonsense' } as never,
      now: 1000,
    });
    expect(effects).toEqual([
      { to: 'sender', msg: { t: 'error', code: 'bad-message', message: 'Unknown type' } },
    ]);
  });

  it('never lets a browser change the list', () => {
    const state = list(emptyLobby(), 'ABC234').state;
    const after = reduceLobby(state, { k: 'message', msg: { t: 'refresh' }, now: 1000 });
    expect(after.state).toBe(state);
  });
});

describe('never mutating its input', () => {
  it('leaves the state alone when listing', () => {
    const state = list(emptyLobby(), 'AAA111').state;
    const before = structuredClone(state);
    list(state, 'BBB222', 2000);
    expect(state).toEqual(before);
  });

  it('leaves the state alone when unlisting', () => {
    const state = list(emptyLobby(), 'AAA111').state;
    const before = structuredClone(state);
    unlist(state, 'AAA111');
    expect(state).toEqual(before);
  });

  it('leaves the state alone when sweeping', () => {
    const state = list(emptyLobby(), 'AAA111', 1000).state;
    const before = structuredClone(state);
    reduceLobby(state, { k: 'alarm', now: 1000 + LISTING_TTL_MS + 1 });
    expect(state).toEqual(before);
  });

  it('returns the very same state when an unlist finds nothing', () => {
    const state = list(emptyLobby(), 'AAA111').state;
    expect(unlist(state, 'NOPE99').state).toBe(state);
  });
});

describe('sweeping only what has actually expired', () => {
  it('keeps the survivors', () => {
    let state = list(emptyLobby(), 'OLD111', 1000).state;
    state = list(state, 'NEW222', 1000 + LISTING_TTL_MS).state;
    const swept = reduceLobby(state, { k: 'alarm', now: 1000 + LISTING_TTL_MS + 1 });
    expect(Object.keys(swept.state.listings)).toEqual(['NEW222']);
    expect(gamesIn(swept.effects).map((game) => game.code)).toEqual(['NEW222']);
  });

  it('re-arms the alarm on the next survivor, not the row it just dropped', () => {
    let state = list(emptyLobby(), 'OLD111', 1000).state;
    state = list(state, 'NEW222', 1000 + LISTING_TTL_MS).state;
    const swept = reduceLobby(state, { k: 'alarm', now: 1000 + LISTING_TTL_MS + 1 });
    expect(nextLobbyAlarmAt(swept.state)).toBe(1000 + LISTING_TTL_MS + LISTING_TTL_MS);
  });

  it('asks for no alarm once the last listing goes', () => {
    const state = list(emptyLobby(), 'AAA111').state;
    expect(nextLobbyAlarmAt(unlist(state, 'AAA111').state)).toBeNull();
  });

  it('treats a listing as gone the instant it reaches its expiry', () => {
    const { state } = list(emptyLobby(), 'ABC234', 1000);
    expect(visibleGames(state, 1000 + LISTING_TTL_MS)).toEqual([]);
  });
});

describe('sanitising what a room announces', () => {
  it('clamps a host name to the length the upgrade allows', () => {
    const cleaned = sanitiseAnnounce({
      k: 'list',
      listing: { ...listing('ABC234'), hostName: 'x'.repeat(80), hostInitials: 'ABCDEF' },
    });
    if (cleaned.k !== 'list') throw new Error('expected a listing');
    expect(cleaned.listing.hostName).toHaveLength(16);
    expect(cleaned.listing.hostInitials).toHaveLength(3);
  });

  it('drops any field it does not know about', () => {
    const cleaned = sanitiseAnnounce({
      k: 'list',
      listing: { ...listing('ABC234'), evil: '<script>' } as never,
    });
    expect(cleaned).not.toHaveProperty('listing.evil');
  });

  it('coerces nonsense numbers rather than passing them on', () => {
    const cleaned = sanitiseAnnounce({
      k: 'list',
      listing: { ...listing('ABC234'), gridSize: 'huge', incrementMs: NaN } as never,
    });
    if (cleaned.k !== 'list') throw new Error('expected a listing');
    expect(cleaned.listing.gridSize).toBe(0);
    expect(cleaned.listing.incrementMs).toBe(0);
  });

  it('keeps an untimed clock untimed rather than turning it into zero', () => {
    const cleaned = sanitiseAnnounce({ k: 'list', listing: listing('ABC234') });
    if (cleaned.k !== 'list') throw new Error('expected a listing');
    expect(cleaned.listing.timeControlMs).toBeNull();
  });

  it('clamps an unlisted code too', () => {
    expect(sanitiseAnnounce({ k: 'unlist', code: 'WAYTOOLONG' })).toEqual({
      k: 'unlist',
      code: 'WAYTOO',
    });
  });
});

describe('staying quiet when nothing visible changed', () => {
  it('does not wake every watcher for a renewal', () => {
    const listed = list(emptyLobby(), 'ABC234', 1000).state;
    // A renewal re-sends the SAME listing — the room's createdAt does not move,
    // only the expiry the lobby derives, and no browser can see an expiry.
    const renewed = list(listed, 'ABC234', 1000 + 5 * 60 * 1000, 1000);
    expect(renewed.effects).toEqual([]);
  });

  it('still extends the listing even though it says nothing', () => {
    const listed = list(emptyLobby(), 'ABC234', 1000).state;
    const renewed = list(listed, 'ABC234', 600000, 1000).state;
    expect(nextLobbyAlarmAt(renewed)).toBe(600000 + LISTING_TTL_MS);
    expect(visibleGames(renewed, 600000)).toHaveLength(1);
  });

  it('does speak up when a renewal actually changes something', () => {
    const listed = list(emptyLobby(), 'ABC234', 1000).state;
    const renamed = reduceLobby(listed, {
      k: 'announce',
      announce: { k: 'list', listing: { ...listing('ABC234'), hostName: 'Grace' } },
      now: 2000,
    });
    expect(renamed.effects).toHaveLength(1);
    expect(gamesIn(renamed.effects)[0].hostName).toBe('Grace');
  });
});

/**
 * A refresh serialises every listing for the asker. The feed is pushed anyway,
 * so asking is a convenience — and one that must cost something to abuse.
 */
describe('a client refreshing the lobby in a loop', () => {
  it('refuses once the bucket is empty, and says why', () => {
    let state = emptyLobby();
    let bucket;
    let last;
    for (let i = 0; i < 30; i += 1) {
      last = reduceLobby(state, { k: 'message', msg: { t: 'refresh' }, now: 1000, bucket });
      state = last.state;
      bucket = last.bucket;
    }
    const error = last!.effects.find((e) => e.msg.t === 'error') as
      | { msg: { code: string } }
      | undefined;
    expect(error?.msg.code).toBe('rate-limited');
  });

  it('still answers a refresh at a human rate', () => {
    let bucket;
    let refused = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = reduceLobby(emptyLobby(), {
        k: 'message',
        msg: { t: 'refresh' },
        now: i * 2000,
        bucket,
      });
      bucket = result.bucket;
      if (result.effects.some((e) => e.msg.t === 'error')) refused += 1;
    }
    expect(refused).toBe(0);
  });

  /** A push to everyone must never be charged to whoever happened to ask. */
  it('does not rate-limit an announce from a room', () => {
    let state = emptyLobby();
    for (let i = 0; i < 30; i += 1) {
      state = list(state, 'ABC234', 1000 + i).state;
    }
    expect(Object.keys(state.listings)).toHaveLength(1);
  });
});
