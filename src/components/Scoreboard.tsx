import { remainingMsFor, type GameState, type PlayerId } from '../engine';
import { PLAYER_THEME } from './theme';

interface ScoreboardProps {
  state: GameState;
}

const PLAYER_ORDER: PlayerId[] = ['p1', 'p2'];

/** m:ss, or 0:0s.s under ten seconds so the last moments read as urgent. */
function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = (safe % 60_000) / 1000;
  if (minutes === 0 && safe < 10_000) return seconds.toFixed(1);
  return `${minutes}:${Math.floor(seconds).toString().padStart(2, '0')}`;
}

export function Scoreboard({ state }: ScoreboardProps) {
  return (
    <div className="scoreboard">
      {PLAYER_ORDER.map((id) => {
        const player = state.players[id];
        const theme = PLAYER_THEME[id];
        const isActive = state.status === 'playing' && state.currentPlayer === id;
        return (
          <div
            key={id}
            className={isActive ? 'player-card player-card--active' : 'player-card'}
            // --player-strong is the darker variant, used for the accent bar on
            // the active card, which inverts to a white background.
            style={
              {
                '--player-color': theme.line,
                '--player-fill': theme.fill,
                '--player-strong': theme.soft,
              } as React.CSSProperties
            }
            aria-current={isActive}
          >
            <div className="player-card__identity">
              <span className="player-card__initials">{player.initials}</span>
              <span className="player-card__name" title={player.username}>
                {player.username}
              </span>
            </div>
            <div className="player-card__score">{String(player.squares).padStart(2, '0')}</div>
            <div className="player-card__status">{isActive ? 'Your turn' : 'Waiting'}</div>
            {state.clock && (
              <div
                className={
                  remainingMsFor(state, id, Date.now()) < 10_000
                    ? 'player-card__clock player-card__clock--low'
                    : 'player-card__clock'
                }
                // Announcing every tick would flood a screen reader; the value
                // is read on demand instead.
                aria-label={`${player.username} time remaining`}
              >
                {formatClock(remainingMsFor(state, id, Date.now()))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
