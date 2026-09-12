/**
 * The singleton lobby Durable Object. I/O only — every rule lives in
 * `lobby-logic.ts`, which is a pure function tested without a runtime.
 *
 * The same two invariants as GameRoom keep this on the free tier: no timers or
 * intervals, and nothing important in instance fields. The one alarm is set to
 * the earliest listing expiry and deleted when the list empties.
 */
import type { LobbyAnnounce, LobbyClientMessage, LobbyServerMessage } from '../src/shared/protocol';
import { PROTOCOL_VERSION } from '../src/shared/protocol';
import type { Bucket } from './rate-limit';
import {
  emptyLobby,
  sanitiseAnnounce,
  nextLobbyAlarmAt,
  reduceLobby,
  type LobbyEffect,
  type LobbyState,
} from './lobby-logic';

const MAX_FRAME_BYTES = 2048;

export class LobbyRoom implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal only. The router rewrites public traffic to `/watch`, so this
    // path is not reachable from any URL a browser can ask for.
    if (url.pathname === '/announce') {
      if (request.method !== 'POST') return plain(405, 'method-not-allowed');
      let announce: LobbyAnnounce;
      try {
        announce = (await request.json()) as LobbyAnnounce;
      } catch {
        return plain(400, 'bad-announce');
      }
      if (!announce || (announce.k !== 'list' && announce.k !== 'unlist')) {
        return plain(400, 'bad-announce');
      }
      announce = sanitiseAnnounce(announce);

      const now = Date.now();
      const { state, effects } = reduceLobby(await this.load(), { k: 'announce', announce, now });
      await this.save(state);
      this.dispatch(effects, null);
      return plain(200, 'ok');
    }

    if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) return plain(400, 'bad-version');
    if (request.headers.get('Upgrade') !== 'websocket') return plain(426, 'expected-websocket');

    // Browsing is anonymous: no token, no identity. A watcher never gets a seat
    // from here, so there is nothing to authenticate.
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    const state = await this.load();
    const { effects } = reduceLobby(state, { k: 'connect', now: Date.now() });
    this.dispatch(effects, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) {
      return send(ws, { t: 'error', code: 'bad-message', message: 'Unreadable frame' });
    }

    let msg: LobbyClientMessage;
    try {
      msg = JSON.parse(raw) as LobbyClientMessage;
    } catch {
      return send(ws, { t: 'error', code: 'bad-message', message: 'Not JSON' });
    }

    const state = await this.load();
    const rate = (ws.deserializeAttachment() as { rate?: Bucket } | null)?.rate;
    const { effects, bucket } = reduceLobby(state, {
      k: 'message',
      msg,
      now: Date.now(),
      bucket: rate,
    });
    if (bucket) ws.serializeAttachment({ rate: bucket });
    this.dispatch(effects, ws);
  }

  async alarm(): Promise<void> {
    const { state, effects } = reduceLobby(await this.load(), { k: 'alarm', now: Date.now() });
    await this.save(state);
    this.dispatch(effects, null);
  }

  private async load(): Promise<LobbyState> {
    return (await this.ctx.storage.get<LobbyState>('lobby')) ?? emptyLobby();
  }

  private async save(state: LobbyState): Promise<void> {
    await this.ctx.storage.put('lobby', state);
    const at = nextLobbyAlarmAt(state);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private dispatch(effects: LobbyEffect[], sender: WebSocket | null): void {
    for (const effect of effects) {
      if (effect.to === 'sender') {
        if (sender) send(sender, effect.msg);
        continue;
      }
      for (const socket of this.ctx.getWebSockets()) send(socket, effect.msg);
    }
  }
}

function send(ws: WebSocket, msg: LobbyServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A socket that has gone away is not an error worth failing the handler for.
  }
}

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
