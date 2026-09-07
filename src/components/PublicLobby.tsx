import { describeTimeControl } from '../engine';
import type { LobbyListing } from '../shared/protocol';
import type { LobbyStatus } from '../net/useLobbyFeed';

interface PublicLobbyProps {
  games: LobbyListing[];
  status: LobbyStatus;
  /** The game whose join is in flight — its row is held until we know. */
  busyCode: string | null;
  notice: string | null;
  onJoin: (code: string, hostName: string) => void;
  onBack: () => void;
}

/**
 * The list of games waiting for an opponent.
 *
 * Every row is a snapshot of something that was true a moment ago; the room
 * itself decides whether a seat is still free. So nothing here is optimistic —
 * a row that has just filled fails on the way in and says so.
 */
export function PublicLobby({
  games,
  status,
  busyCode,
  notice,
  onJoin,
  onBack,
}: PublicLobbyProps) {
  return (
    <div className="panel setup lobby-browser">
      <header className="setup__header">
        <h1>Open games</h1>
        <p>Anyone can join these. Pick one and you are straight into a match.</p>
      </header>

      {notice && (
        <p className="setup__hint" role="alert">
          {notice}
        </p>
      )}

      <p className="board__hint" role="status">
        {status === 'open'
          ? games.length === 1
            ? '1 game waiting'
            : `${games.length} games waiting`
          : status === 'reconnecting'
            ? 'Lost the lobby — reconnecting…'
            : 'Loading open games…'}
      </p>

      {status === 'open' && games.length === 0 && (
        <p className="setup__hint">
          No open games right now — stage one and players will see it appear.
        </p>
      )}

      <ul className="lobby-browser__list" aria-label="Open games">
        {games.map((game) => (
          <li key={game.code}>
            <div className="invite" role="group" aria-label={`Game hosted by ${game.hostName}`}>
              <p className="invite__host">
                <strong>{game.hostName}</strong> is waiting
              </p>
              <dl className="invite__facts">
                <div>
                  <dt>Board</dt>
                  <dd>
                    {game.gridSize} &times; {game.gridSize} dots &middot;{' '}
                    {(game.gridSize - 1) ** 2} squares
                  </dd>
                </div>
                <div>
                  <dt>Clock</dt>
                  <dd>
                    {describeTimeControl({
                      ms: game.timeControlMs,
                      incrementMs: game.incrementMs,
                    })}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button--primary"
                // The pressed row stays enabled so focus is not thrown to the
                // body mid-join; the others are held so a second click cannot
                // open a second socket.
                disabled={busyCode !== null && busyCode !== game.code}
                aria-busy={busyCode === game.code}
                aria-label={`Join ${game.hostName}'s game`}
                onClick={() => busyCode === null && onJoin(game.code, game.hostName)}
              >
                {busyCode === game.code ? 'Joining…' : 'Join'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button type="button" className="button" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
