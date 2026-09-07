/**
 * One Durable Object per game room. This file is I/O only — every rule lives in
 * `room-logic.ts`, which is a pure function and tested without a runtime.
 *
 * Two invariants keep this on the free tier:
 *   1. No timers, no intervals, no long-lived promises. A resident object is
 *      billed for duration; a hibernating one is not.
 *   2. Nothing important in instance fields. The object is evicted between
 *      messages, so per-socket state rides in `serializeAttachment` and room
 *      state in storage.
 */
import type { PlayerId } from '../src/engine';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import { LOBBY_SINGLETON, type Env } from './env';
import { PROTOCOL_VERSION, ROOM_CODE_PATTERN } from '../src/shared/protocol';
import {
  emptyRoom,
  joinRoom,
  nextAlarmAt,
  reduceRoom,
  roomInfo,
  type Effect,
  type RoomState,
} from './room-logic';

interface Attachment {
  seat: PlayerId;
  token: string;
}

/** Refuses an oversized frame rather than letting it throw inside a handler. */
const MAX_FRAME_BYTES = 2048;

export class GameRoom implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = (url.pathname.split('/').pop() ?? '').toUpperCase();

    if (!ROOM_CODE_PATTERN.test(code)) return plain(400, 'bad-code');
    if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) return plain(400, 'bad-version');

    // A preview for the join screen. Read-only: it never claims a seat, so a
    // player can look at the match and walk away.
    if (url.searchParams.get('info') === '1') {
      const room = await this.load(code, Date.now());
      return new Response(JSON.stringify(roomInfo(room)), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') return plain(426, 'expected-websocket');

    const token = url.searchParams.get('token') ?? '';
    const username = (url.searchParams.get('u') ?? '').slice(0, 16);
    const initials = (url.searchParams.get('i') ?? '').slice(0, 3);
    if (!token || username.length < 2 || initials.length < 2) return plain(400, 'bad-identity');

    const now = Date.now();
    const room = await this.load(code, now);
    const timeParam = url.searchParams.get('time');

    const result = joinRoom(room, {
      token,
      username,
      initials,
      wantsCreate: url.searchParams.get('create') === '1',
      now,
      gridSize: Number(url.searchParams.get('grid')) || undefined,
      timeControlMs: timeParam === null ? undefined : timeParam === '' ? null : Number(timeParam),
      incrementMs: Number(url.searchParams.get('inc')) || 0,
      visibility: url.searchParams.get('pub') === '1' ? 'public' : 'private',
    });

    if (!result.ok) {
      const status = result.failure === 'room-full' ? 409 : result.failure === 'room-exists' ? 409 : 400;
      return plain(status, result.failure);
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // A reload can land the new socket before the old one's close is processed,
    // leaving two per seat. The stale close would then arrive after the join and
    // unlist a host who is sitting right there, with no transition left to put
    // them back. Retire the old socket now, while we can still see it.
    for (const existing of this.ctx.getWebSockets()) {
      const attachment = existing.deserializeAttachment() as Attachment | null;
      if (attachment?.seat === result.seat) {
        try {
          existing.close(1000, 'replaced');
        } catch {
          // Already gone; nothing to retire.
        }
      }
    }

    // Tag with the seat so a reconnecting socket can be found after eviction.
    this.ctx.acceptWebSocket(server, [result.seat]);
    server.serializeAttachment({ seat: result.seat, token } satisfies Attachment);

    await this.save(result.room);
    this.dispatch(result.room, result.effects, server);
    await this.announce(result.effects);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) {
      return send(ws, { t: 'error', code: 'bad-message', message: 'Unreadable frame' });
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return send(ws, { t: 'error', code: 'bad-message', message: 'Not JSON' });
    }
    if (!msg || typeof msg.t !== 'string') {
      return send(ws, { t: 'error', code: 'bad-message', message: 'Missing type' });
    }

    const now = Date.now();
    const room = await this.load('', now);
    const { room: next, effects } = reduceRoom(room, {
      k: 'message',
      seat: attachment.seat,
      msg,
      now,
    });

    await this.save(next);
    this.dispatch(next, effects, ws);
    await this.announce(effects);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const room = await this.load('', now);
    const { room: next, effects } = reduceRoom(room, { k: 'alarm', now });

    if (effects.some((effect) => 'closeRoom' in effect)) {
      await this.announce(effects);
      await this.ctx.storage.deleteAll();
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'room-closed');
      return;
    }

    await this.save(next);
    this.dispatch(next, effects, null);
    await this.announce(effects);
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const now = Date.now();
    const room = await this.load('', now);
    // Another socket on this seat means a reload, not a departure.
    const stillHere = this.ctx.getWebSockets().some((socket) => {
      if (socket === ws) return false;
      const other = socket.deserializeAttachment() as Attachment | null;
      return other?.seat === attachment.seat;
    });

    const { room: next, effects } = reduceRoom(room, {
      k: 'disconnect',
      seat: attachment.seat,
      now,
      stillHere,
    });
    await this.save(next);
    this.dispatch(next, effects, ws);
    await this.announce(effects);
  }

  /**
   * Rebuilds room state from storage. `connected` is deliberately derived from
   * the live sockets rather than persisted — after an eviction the stored flag
   * would be a lie.
   */
  private async load(code: string, now: number): Promise<RoomState> {
    const stored = await this.ctx.storage.get<Omit<RoomState, 'connected'>>('room');
    const base = stored ?? emptyRoom(code, now);

    const connected: Record<PlayerId, boolean> = { p1: false, p2: false };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment) connected[attachment.seat] = true;
    }
    return { meta: base.meta, game: base.game, connected };
  }

  private async save(room: RoomState): Promise<void> {
    await this.ctx.storage.put('room', { meta: room.meta, game: room.game });
    // One alarm per turn — the flag deadline, or the idle reap. Never a repeat.
    await this.ctx.storage.setAlarm(nextAlarmAt(room));
  }

  /**
   * Tells the lobby what changed. Advisory only: a failed announce must never
   * break a game.
   *
   * A dropped `unlist` self-heals when the listing expires. A dropped `list`
   * cannot — it would leave the host invisible — so a listed room re-announces
   * itself on its renewal alarm, which is also what keeps the TTL from expiring
   * a host who is still waiting.
   *
   * Awaited in effect order, so a `list` cannot land after the `unlist` that
   * followed it.
   */
  private async announce(effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      if (!('lobby' in effect)) continue;
      try {
        const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName(LOBBY_SINGLETON));
        await stub.fetch(
          new Request('https://lobby/announce', {
            method: 'POST',
            body: JSON.stringify(effect.lobby),
          }),
        );
      } catch {
        // See above: the lobby is a cache, and a stale row still cannot hand
        // anyone a seat that is taken.
      }
    }
  }

  private dispatch(_room: RoomState, effects: Effect[], sender: WebSocket | null): void {
    for (const effect of effects) {
      // Positive test, deliberately: a blacklist here silently breaks the next
      // time an effect variant is added.
      if (!('to' in effect)) continue;
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as Attachment | null;
        if (!attachment) continue;
        const target = effect.to;
        const wanted =
          target === 'all' ||
          (target === 'sender' && socket === sender) ||
          target === attachment.seat;
        if (wanted) send(socket, effect.msg);
      }
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A socket that has gone away is not an error worth failing the handler for.
  }
}

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
