import { describe, expect, it } from 'vitest';
import { horizontalEdgeId, verticalEdgeId } from '../src/engine';
import type { PlayerId } from '../src/engine';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import {
  emptyRoom,
  joinRoom,
  listingOf,
  nextAlarmAt,
  presenceOf,
  reduceRoom,
  RENEW_LISTING_MS,
  roomInfo,
  type RoomState,
} from './room-logic';

const ada = { token: 'tok-ada', username: 'Ada', initials: 'AL' };
const grace = { token: 'tok-grace', username: 'Grace', initials: 'GH' };

function seat(room: RoomState, who: typeof ada, wantsCreate = false, now = 1000) {
  const result = joinRoom(room, { ...who, wantsCreate, now });
  if (!result.ok) throw new Error(`expected a seat, got ${result.failure}`);
  return result;
}

/** A room with both players seated and a game under way. */
function started() {
  const first = seat(emptyRoom('ABC234', 0), ada, true);
  const second = seat(first.room, grace);
  return second.room;
}

function send(room: RoomState, who: PlayerId, msg: ClientMessage) {
  return reduceRoom(room, { k: 'message', seat: who, msg, now: 2000 });
}

const messagesOf = (effects: { to?: unknown; msg?: ServerMessage }[]) =>
  effects.flatMap((effect) => (effect.msg ? [effect.msg] : []));

describe('seating', () => {
  it('gives the creator p1 and the joiner p2', () => {
    const first = seat(emptyRoom('ABC234', 0), ada, true);
    expect(first.seat).toBe('p1');
    const second = seat(first.room, grace);
    expect(second.seat).toBe('p2');
  });

  it('deals a game only once both seats are filled', () => {
    const first = seat(emptyRoom('ABC234', 0), ada, true);
    expect(first.room.game).toBeNull();

    const second = seat(first.room, grace);
    expect(second.room.game).not.toBeNull();
    expect(second.room.game?.players.p1.username).toBe('Ada');
    expect(second.room.game?.players.p2.username).toBe('Grace');
    expect(messagesOf(second.effects).some((m) => m.t === 'state' && m.reason === 'start')).toBe(true);
  });

  it('refuses a third player', () => {
    const room = started();
    const third = joinRoom(room, {
      token: 'tok-eve',
      username: 'Eve',
      initials: 'EV',
      wantsCreate: false,
      now: 3000,
    });
    expect(third).toEqual({ ok: false, failure: 'room-full' });
  });

  it('refuses to create a room that already exists', () => {
    const first = seat(emptyRoom('ABC234', 0), ada, true);
    const clash = joinRoom(first.room, { ...grace, wantsCreate: true, now: 2000 });
    expect(clash).toEqual({ ok: false, failure: 'room-exists' });
  });

  it('lets a known token reclaim its own seat rather than taking the other', () => {
    const room = started();
    const back = seat(room, ada);
    expect(back.seat).toBe('p1');
    expect(back.room.game).toBe(room.game); // the match is untouched
  });
});

describe('presence', () => {
  it('reports empty, connected and disconnected', () => {
    const alone = seat(emptyRoom('ABC234', 0), ada, true).room;
    expect(presenceOf(alone)).toEqual({ p1: 'connected', p2: 'empty' });

    const both = started();
    expect(presenceOf(both)).toEqual({ p1: 'connected', p2: 'connected' });

    const dropped = reduceRoom(both, { k: 'disconnect', seat: 'p2', now: 5000 }).room;
    expect(presenceOf(dropped)).toEqual({ p1: 'connected', p2: 'disconnected' });
  });

  it('does not free the seat when a player drops', () => {
    const dropped = reduceRoom(started(), { k: 'disconnect', seat: 'p2', now: 5000 }).room;
    expect(dropped.meta.seats.p2).not.toBeNull();

    // So a stranger still cannot take it.
    const stranger = joinRoom(dropped, {
      token: 'tok-eve',
      username: 'Eve',
      initials: 'EV',
      wantsCreate: false,
      now: 6000,
    });
    expect(stranger).toEqual({ ok: false, failure: 'room-full' });
  });
});

describe('turn authority', () => {
  it('accepts a move from the player whose turn it is', () => {
    const room = started();
    const { room: next, effects } = send(room, 'p1', {
      t: 'move',
      edgeId: horizontalEdgeId(0, 0),
      seq: room.meta.seq,
    });
    expect(next.game?.edges[horizontalEdgeId(0, 0)].owner).toBe('p1');
    expect(messagesOf(effects).some((m) => m.t === 'state')).toBe(true);
  });

  it('rejects a move from the player whose turn it is not', () => {
    const room = started();
    const { room: next, effects } = send(room, 'p2', {
      t: 'move',
      edgeId: horizontalEdgeId(0, 0),
      seq: room.meta.seq,
    });
    expect(next.game).toBe(room.game); // untouched
    expect(messagesOf(effects)).toEqual([{ t: 'rejected', reason: 'not-your-turn' }]);
  });

  it('rejects a stale sequence number, so a double tap cannot take two edges', () => {
    const room = started();
    const after = send(room, 'p1', {
      t: 'move',
      edgeId: horizontalEdgeId(0, 0),
      seq: room.meta.seq,
    }).room;

    // The same click arriving twice still carries the old seq.
    const { effects } = send(after, 'p2', {
      t: 'move',
      edgeId: horizontalEdgeId(0, 1),
      seq: room.meta.seq,
    });
    expect(messagesOf(effects)).toEqual([{ t: 'rejected', reason: 'stale' }]);
  });

  it('passes the engine its own rejection reason', () => {
    const room = started();
    const { effects } = send(room, 'p1', { t: 'move', edgeId: 'H-99-99', seq: room.meta.seq });
    expect(messagesOf(effects)).toEqual([{ t: 'rejected', reason: 'unknown-edge' }]);
  });

  it('keeps the turn with the mover when they claim a square', () => {
    // 2x2 board: three sides, then p1 closes the only square.
    let room = seat(seat(emptyRoom('AB2345', 0), ada, true).room, grace).room;
    room = { ...room, game: { ...room.game!, gridSize: room.game!.gridSize } };

    const play = (who: PlayerId, edgeId: string) => {
      const result = send(room, who, { t: 'move', edgeId, seq: room.meta.seq });
      room = result.room;
      return result;
    };

    play('p1', horizontalEdgeId(0, 0));
    play('p2', verticalEdgeId(0, 0));
    play('p1', verticalEdgeId(0, 1));
    expect(room.game?.currentPlayer).toBe('p2');

    // p2 closes it and must keep the turn — never assume alternation.
    play('p2', horizontalEdgeId(1, 0));
    expect(room.game?.players.p2.squares).toBe(1);
    expect(room.game?.currentPlayer).toBe('p2');
  });
});

describe('resigning, draws and rematches', () => {
  it('makes the resigner lose', () => {
    const room = started();
    const { room: next } = send(room, 'p1', { t: 'resign' });
    expect(next.game?.status).toBe('finished');
    expect(next.game?.winner).toBe('p2');
    expect(next.game?.ending).toBe('resignation');
  });

  it('offers a draw to the opponent only', () => {
    const room = started();
    const { room: next, effects } = send(room, 'p1', { t: 'offer-draw' });
    expect(next.meta.drawOfferedBy).toBe('p1');
    expect(effects).toEqual([{ to: 'p2', msg: { t: 'draw-offered', by: 'p1' } }]);
  });

  it('ties the game only once the opponent accepts', () => {
    const offered = send(started(), 'p1', { t: 'offer-draw' }).room;
    const { room: next } = send(offered, 'p2', { t: 'respond-draw', accept: true });
    expect(next.game?.status).toBe('finished');
    expect(next.game?.winner).toBe('draw');
    expect(next.game?.ending).toBe('agreed-draw');
  });

  it('keeps playing when the draw is declined', () => {
    const offered = send(started(), 'p1', { t: 'offer-draw' }).room;
    const { room: next, effects } = send(offered, 'p2', { t: 'respond-draw', accept: false });
    expect(next.game?.status).toBe('playing');
    expect(next.meta.drawOfferedBy).toBeNull();
    expect(effects).toEqual([{ to: 'p1', msg: { t: 'draw-declined', by: 'p2' } }]);
  });

  it('will not let a player accept their own draw offer', () => {
    const offered = send(started(), 'p1', { t: 'offer-draw' }).room;
    const { room: next } = send(offered, 'p1', { t: 'respond-draw', accept: true });
    expect(next.game?.status).toBe('playing');
  });

  it('restarts only when both players want a rematch', () => {
    const finished = send(started(), 'p1', { t: 'resign' }).room;

    const one = send(finished, 'p1', { t: 'rematch', want: true });
    expect(one.room.game?.status).toBe('finished');
    expect(one.room.meta.rematch).toEqual({ p1: true, p2: false });

    const both = send(one.room, 'p2', { t: 'rematch', want: true });
    expect(both.room.game?.status).toBe('playing');
    expect(both.room.meta.rematch).toEqual({ p1: false, p2: false });
    expect(messagesOf(both.effects).some((m) => m.t === 'state' && m.reason === 'rematch')).toBe(
      true,
    );
  });
});

describe('housekeeping', () => {
  it('bumps the sequence number on every state change', () => {
    const room = started();
    const before = room.meta.seq;
    const after = send(room, 'p1', {
      t: 'move',
      edgeId: horizontalEdgeId(0, 0),
      seq: before,
    }).room;
    expect(after.meta.seq).toBe(before + 1);
  });

  it('resyncs a client on request', () => {
    const room = started();
    const { effects } = send(room, 'p1', { t: 'resync' });
    const msg = messagesOf(effects)[0];
    expect(msg.t).toBe('state');
    expect(msg.t === 'state' && msg.reason).toBe('sync');
  });

  it('reaps a room only when it is idle and empty', () => {
    const room = started();
    const day = 24 * 60 * 60 * 1000;

    // Still connected: never reaped, however old.
    expect(reduceRoom(room, { k: 'alarm', now: day * 10 }).effects).toEqual([]);

    let empty = reduceRoom(room, { k: 'disconnect', seat: 'p1', now: 1000 }).room;
    empty = reduceRoom(empty, { k: 'disconnect', seat: 'p2', now: 1000 }).room;

    expect(reduceRoom(empty, { k: 'alarm', now: 2000 }).effects).toEqual([]);
    expect(reduceRoom(empty, { k: 'alarm', now: 1000 + day + 1 }).effects).toEqual([
      { closeRoom: true },
    ]);
  });
});

describe('the clock', () => {
  const TWO_MIN = 2 * 60_000;

  function timedRoom(now = 1000) {
    const first = joinRoom(emptyRoom('TIME01', now), {
      ...ada,
      wantsCreate: true,
      now,
      gridSize: 3,
      timeControlMs: TWO_MIN,
    });
    if (!first.ok) throw new Error('seat failed');
    const second = joinRoom(first.room, { ...grace, wantsCreate: false, now });
    if (!second.ok) throw new Error('seat failed');
    return second.room;
  }

  it('starts both clocks running when the game is dealt', () => {
    const room = timedRoom(1000);
    expect(room.game?.clock?.remainingMs).toEqual({ p1: TWO_MIN, p2: TWO_MIN });
    expect(room.game?.clock?.turnStartedAt).toBe(1000);
  });

  it('schedules the alarm for the flag, not a repeating tick', () => {
    const room = timedRoom(1000);
    // p1 is to move with a full allowance from t=1000.
    expect(nextAlarmAt(room)).toBe(1000 + TWO_MIN);
  });

  it('falls back to the idle-reap deadline when untimed', () => {
    const room = started();
    const day = 24 * 60 * 60 * 1000;
    expect(nextAlarmAt(room)).toBe(room.meta.lastActivity + day);
  });

  it('charges the mover and re-aims the alarm at the next player', () => {
    const room = timedRoom(1000);
    const after = reduceRoom(room, {
      k: 'message',
      seat: 'p1',
      msg: { t: 'move', edgeId: horizontalEdgeId(0, 0), seq: room.meta.seq },
      now: 6000,
    }).room;

    expect(after.game?.clock?.remainingMs.p1).toBe(TWO_MIN - 5000);
    expect(after.game?.clock?.remainingMs.p2).toBe(TWO_MIN);
    expect(nextAlarmAt(after)).toBe(6000 + TWO_MIN);
  });

  it('ends the game when the alarm finds the flag has fallen', () => {
    const room = timedRoom(1000);
    const { room: next, effects } = reduceRoom(room, { k: 'alarm', now: 1000 + TWO_MIN + 1 });

    expect(next.game?.status).toBe('finished');
    expect(next.game?.ending).toBe('timeout');
    expect(next.game?.winner).toBe('p2');
    expect(messagesOf(effects).some((m) => m.t === 'state')).toBe(true);
  });

  it('leaves the game alone when the alarm fires early', () => {
    const room = timedRoom(1000);
    const { room: next } = reduceRoom(room, { k: 'alarm', now: 1000 + 10_000 });
    expect(next.game?.status).toBe('playing');
  });

  it('carries the time control into a rematch', () => {
    const finished = reduceRoom(timedRoom(1000), { k: 'message', seat: 'p1', msg: { t: 'resign' }, now: 2000 }).room;
    const one = reduceRoom(finished, { k: 'message', seat: 'p1', msg: { t: 'rematch', want: true }, now: 3000 }).room;
    const both = reduceRoom(one, { k: 'message', seat: 'p2', msg: { t: 'rematch', want: true }, now: 4000 }).room;

    expect(both.game?.status).toBe('playing');
    expect(both.game?.clock?.remainingMs).toEqual({ p1: TWO_MIN, p2: TWO_MIN });
    expect(both.game?.gridSize).toBe(3);
  });
});

describe('announcing a room to the lobby', () => {
  const lobbyNotes = (effects: { lobby?: unknown }[]) =>
    effects.flatMap((effect) => (effect.lobby ? [effect.lobby] : []));

  function publicRoom(now = 1000) {
    return joinRoom(emptyRoom('ABC234', now), {
      ...ada,
      wantsCreate: true,
      now,
      visibility: 'public',
    });
  }

  it('lists a public room the moment its host stages it', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    expect(lobbyNotes(created.effects)).toEqual([
      {
        k: 'list',
        listing: {
          code: 'ABC234',
          hostName: 'Ada',
          hostInitials: 'AL',
          gridSize: 10,
          timeControlMs: null,
          incrementMs: 0,
          createdAt: 1000,
        },
      },
    ]);
  });

  it('says nothing at all for a private room', () => {
    const created = seat(emptyRoom('ABC234', 0), ada, true);
    expect(lobbyNotes(created.effects)).toEqual([]);
  });

  it('defaults to private, so an unmarked room is never listed', () => {
    const created = seat(emptyRoom('ABC234', 0), ada, true);
    expect(listingOf(created.room)).toBeNull();
  });

  it('treats a room stored before visibility existed as private', () => {
    const created = seat(emptyRoom('ABC234', 0), ada, true);
    // What a v1 room looks like when it loads out of storage.
    const legacy = {
      ...created.room,
      meta: { ...created.room.meta, visibility: undefined as unknown as 'private' },
    };
    expect(listingOf(legacy)).toBeNull();
    expect(roomInfo(legacy).visibility).toBe('private');
  });

  it('says nothing when a private room is reaped', () => {
    const created = seat(emptyRoom('ABC234', 0), ada, true);
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    const reaped = reduceRoom(gone.room, { k: 'alarm', now: 25 * 60 * 60 * 1000 });
    expect(lobbyNotes(reaped.effects)).toEqual([]);
    expect(reaped.effects).toEqual([{ closeRoom: true }]);
  });

  it('does not re-announce a room that is already listed', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    // A second player looking at the room preview changes nothing about it.
    expect(lobbyNotes(reduceRoom(created.room, { k: 'message', seat: 'p1', msg: { t: 'resync' }, now: 2000 }).effects)).toEqual([]);
  });

  it('carries the creator&apos;s chosen board and clock into the listing', () => {
    const created = joinRoom(emptyRoom('ABC234', 0), {
      ...ada,
      wantsCreate: true,
      now: 0,
      visibility: 'public',
      gridSize: 5,
      timeControlMs: 60000,
      incrementMs: 2000,
    });
    if (!created.ok) throw new Error(created.failure);
    expect(lobbyNotes(created.effects)).toEqual([
      expect.objectContaining({
        k: 'list',
        listing: expect.objectContaining({ gridSize: 5, timeControlMs: 60000, incrementMs: 2000 }),
      }),
    ]);
  });

  it('withdraws it in the very same breath as starting the game', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const joined = seat(created.room, grace);
    expect(lobbyNotes(joined.effects)).toEqual([{ k: 'unlist', code: 'ABC234' }]);
    // The withdrawal and the game starting are one atomic set of effects.
    expect(messagesOf(joined.effects).some((msg) => msg.t === 'state')).toBe(true);
  });

  it('withdraws it when the waiting host drops', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    expect(lobbyNotes(gone.effects)).toEqual([{ k: 'unlist', code: 'ABC234' }]);
  });

  it('withdraws it when the waiting host leaves deliberately', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const gone = send(created.room, 'p1', { t: 'leave' });
    expect(lobbyNotes(gone.effects)).toEqual([{ k: 'unlist', code: 'ABC234' }]);
  });

  it('re-lists when the host comes back', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    const back = joinRoom(gone.room, { ...ada, wantsCreate: false, now: 3000 });
    if (!back.ok) throw new Error(back.failure);
    expect(back.seat).toBe('p1');
    expect(lobbyNotes(back.effects)).toEqual([
      expect.objectContaining({ k: 'list' }),
    ]);
  });

  it('stays quiet when a player drops out of a game already under way', () => {
    const gone = reduceRoom(started(), { k: 'disconnect', seat: 'p2', now: 2000 });
    expect(lobbyNotes(gone.effects)).toEqual([]);
  });

  it('withdraws before the idle reap closes the room', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    // Only an empty room is reapable, so the host has to be gone first.
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    const reaped = reduceRoom(gone.room, { k: 'alarm', now: 1000 + 25 * 60 * 60 * 1000 });
    expect(lobbyNotes(reaped.effects)).toEqual([{ k: 'unlist', code: 'ABC234' }]);
    expect(reaped.effects.some((effect) => 'closeRoom' in effect)).toBe(true);
  });

  it('reports visibility on the join preview', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    expect(roomInfo(created.room).visibility).toBe('public');
    expect(roomInfo(seat(emptyRoom('ZZZ999', 0), grace, true).room).visibility).toBe('private');
  });

  it('renews a waiting listing rather than letting it expire', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    // The alarm for a listed room lands well inside the lobby's 15-minute TTL.
    expect(nextAlarmAt(created.room)).toBe(1000 + RENEW_LISTING_MS);
    const renewed = reduceRoom(created.room, { k: 'alarm', now: 1000 + RENEW_LISTING_MS });
    expect(lobbyNotes(renewed.effects)).toEqual([
      expect.objectContaining({ k: 'list' }),
    ]);
  });

  it('goes back to the plain reap deadline once the game starts', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const playing = seat(created.room, grace, false, 1000);
    expect(nextAlarmAt(playing.room)).toBeGreaterThan(1000 + RENEW_LISTING_MS);
  });

  it('never lets a joiner change an existing room&apos;s visibility', () => {
    const created = publicRoom();
    if (!created.ok) throw new Error(created.failure);
    const joined = joinRoom(created.room, {
      ...grace,
      wantsCreate: false,
      now: 2000,
      visibility: 'private',
    });
    if (!joined.ok) throw new Error(joined.failure);
    expect(joined.room.meta.visibility).toBe('public');
  });
});

describe('a room that is no longer there', () => {
  it('refuses a joiner rather than quietly making them the host', () => {
    const result = joinRoom(emptyRoom('ABC234', 0), { ...grace, wantsCreate: false, now: 1000 });
    expect(result).toEqual({ ok: false, failure: 'room-closed' });
  });

  it('still lets a creator stage a brand new room', () => {
    const result = joinRoom(emptyRoom('ABC234', 0), { ...ada, wantsCreate: true, now: 1000 });
    expect(result.ok).toBe(true);
  });

  it('still lets a dropped host reclaim their own seat', () => {
    const created = seat(emptyRoom('ABC234', 0), ada, true);
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    const back = joinRoom(gone.room, { ...ada, wantsCreate: false, now: 3000 });
    expect(back.ok).toBe(true);
  });
});

describe('a socket closing that is not a departure', () => {
  it('keeps a reloading host listed and present', () => {
    const created = joinRoom(emptyRoom('ABC234', 1000), {
      ...ada,
      wantsCreate: true,
      now: 1000,
      visibility: 'public',
    });
    if (!created.ok) throw new Error(created.failure);

    // The old socket's close arrives after the reload has already reconnected.
    const stale = reduceRoom(created.room, {
      k: 'disconnect',
      seat: 'p1',
      now: 2000,
      stillHere: true,
    });
    expect(stale.room.connected.p1).toBe(true);
    expect(listingOf(stale.room)).not.toBeNull();
    expect(stale.effects.some((effect) => 'lobby' in effect)).toBe(false);
  });

  it('still treats a real departure as one', () => {
    const created = joinRoom(emptyRoom('ABC234', 1000), {
      ...ada,
      wantsCreate: true,
      now: 1000,
      visibility: 'public',
    });
    if (!created.ok) throw new Error(created.failure);
    const gone = reduceRoom(created.room, { k: 'disconnect', seat: 'p1', now: 2000 });
    expect(gone.room.connected.p1).toBe(false);
    expect(listingOf(gone.room)).toBeNull();
  });
});
