/**
 * Routes WebSocket upgrades to a room or the lobby and hands everything else to
 * the static asset layer. Deliberately thin: all behaviour is in the Durable
 * Objects and their pure logic modules.
 */
import { GameRoom } from './GameRoom';
import { LobbyRoom } from './LobbyRoom';
import { ROOM_CODE_PATTERN } from '../src/shared/protocol';
import { LOBBY_SINGLETON, type Env } from './env';

export { GameRoom, LobbyRoom };
export type { Env };

const ROOM_PATH = /^\/api\/room\/([A-Za-z0-9]{6})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // One lobby for everyone. The path is rewritten rather than forwarded, so
    // the public surface and the internal `/announce` surface share no
    // namespace at all — routing alone is then not the only thing standing
    // between the internet and a write.
    if (url.pathname === '/api/lobby') {
      return env.LOBBY.get(env.LOBBY.idFromName(LOBBY_SINGLETON)).fetch(
        new Request(`https://lobby/watch${url.search}`, request),
      );
    }

    const match = ROOM_PATH.exec(url.pathname);

    if (!match) {
      if (url.pathname.startsWith('/api/')) {
        return new Response('not-found', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    }

    // Normalise before deriving the id, so ABC234 and abc234 are one room.
    const code = match[1].toUpperCase();
    // Validating here means a malformed code never instantiates — and so never
    // bills for — a Durable Object. Checked against the real alphabet, so a
    // confusable code (0 for O, 1 for I or L) is refused rather than quietly
    // opening a different room.
    if (!ROOM_CODE_PATTERN.test(code)) return new Response('bad-code', { status: 404 });
    const id = env.ROOM.idFromName(code);
    return env.ROOM.get(id).fetch(request);
  },
};
