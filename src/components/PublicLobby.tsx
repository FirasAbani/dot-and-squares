import { useState } from 'react';
import { SPEEDS, describeTimeControl, timeControlFor } from '../engine';
import type { LobbyListing, RoomVisibility } from '../shared/protocol';
import type { LobbyStatus } from '../net/useLobbyFeed';
import { MatchOptionsFields } from './MatchOptionsFields';
import type { MatchOptions } from './PlayerSetup';

interface PublicLobbyProps {
  games: LobbyListing[];
  status: LobbyStatus;
  /** The game whose join is in flight — its row is held until we know. */
  busyCode: string | null;
  notice: string | null;
  onJoin: (code: string, hostName: string) => void;
  /** Stage a game of your own and wait for someone to take it. */
  onStage: (options: MatchOptions) => void;
  onBack: () => void;
}

/**
 * The online hub: the games waiting for an opponent, and the one place a game
 * is started.
 *
 * Every row is a snapshot of something that was true a moment ago; the room
 * itself decides whether a seat is still free. So nothing here is optimistic —
 * a row that has just filled fails on the way in and says so.
 *
 * Starting a game lives here rather than on the setup screen because the two
 * were the same act described twice: a public game is one that appears in this
 * list, so the list is where you say whether yours does.
 */
export function PublicLobby({
  games,
  status,
  busyCode,
  notice,
  onJoin,
  onStage,
  onBack,
}: PublicLobbyProps) {
  const [staging, setStaging] = useState(false);
  // 10x10 is 81 squares — a long, slow first game. 5x5 finishes.
  const [gridSize, setGridSize] = useState(5);
  const [speed, setSpeed] = useState(SPEEDS[0]);
  // Public by default: a lobby nobody stages games into is an empty lobby.
  const [visibility, setVisibility] = useState<RoomVisibility>('public');

  // The staging form replaces the list rather than sitting under it, so the
  // screen keeps a single primary action and an obvious way back.
  if (staging) {
    const timeControl = timeControlFor(gridSize, speed);
    return (
      <div className="panel setup lobby-browser">
        <header className="setup__header">
          <h1>Start a game</h1>
          <p>Pick the board and who can join. You will wait here until someone arrives.</p>
        </header>

        <MatchOptionsFields
          gridSize={gridSize}
          onGridSize={setGridSize}
          speed={speed}
          onSpeed={setSpeed}
        />

        <div className="field">
          <span className="field__label" id="visibility-label">
            Who can join
          </span>
          <div className="setup__choices" role="group" aria-labelledby="visibility-label">
            <button
              type="button"
              className={
                visibility === 'public'
                  ? 'button button--ghost button--chosen time-control'
                  : 'button button--ghost time-control'
              }
              aria-pressed={visibility === 'public'}
              onClick={() => setVisibility('public')}
            >
              <span className="time-control__label">Public</span>
              <span className="time-control__kind">Anyone browsing the lobby can join</span>
            </button>
            <button
              type="button"
              className={
                visibility === 'private'
                  ? 'button button--ghost button--chosen time-control'
                  : 'button button--ghost time-control'
              }
              aria-pressed={visibility === 'private'}
              onClick={() => setVisibility('private')}
            >
              <span className="time-control__label">Private</span>
              <span className="time-control__kind">Only people you send the link to</span>
            </button>
          </div>
        </div>

        <div className="overlay__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() =>
              onStage({
                gridSize,
                timeControlMs: timeControl.ms,
                incrementMs: timeControl.incrementMs,
                visibility,
              })
            }
          >
            Start Game
          </button>
          <button type="button" className="button" onClick={() => setStaging(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

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
          No open games right now — start one and you will be first in.
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

      {/* Being first here is a normal thing to be, not a dead end: staging
          from the lobby leaves the player waiting in it rather than sending
          them back to the setup screen to start again. */}
      <div className="overlay__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busyCode !== null}
          onClick={() => setStaging(true)}
        >
          Start a Game
        </button>
        <button type="button" className="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
