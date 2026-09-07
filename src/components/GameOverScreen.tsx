import type { GameState, PlayerId } from '../engine';
import { PLAYER_THEME } from './theme';

/** Facts about a finished match that are worth naming. */
export interface MatchHighlights {
  peakChain: Record<PlayerId, number>;
  behindBy: Record<PlayerId, number>;
  botDifficulty?: string | null;
  series?: { p1: number; p2: number; draws: number } | null;
}

interface GameOverScreenProps {
  state: GameState;
  /**
   * Which seat is watching this screen, or null for pass-and-play where both
   * players share one. Decides who gets told they lost.
   */
  viewerSeat: PlayerId | null;
  highlights?: MatchHighlights;
  /** Who has asked for a rematch. Null when there is no opponent to ask. */
  rematch?: { mine: boolean; theirs: boolean; opponentName: string } | null;
  onPlayAgain: () => void;
  onNewGame: () => void;
  onQuit: () => void;
}

const ENDING_LABEL: Record<string, string> = {
  'board-complete': 'Game over',
  resignation: 'Forfeited',
  'agreed-draw': 'Draw agreed',
  timeout: 'Out of time',
};

/**
 * The single most notable true thing about this game, for the eyebrow above the
 * result. "Game over" is the flattest possible word for the biggest moment.
 */
function describeAchievement(
  state: GameState,
  highlights: MatchHighlights | undefined,
): string | null {
  const winner = state.winner;
  if (!winner || winner === 'draw' || state.ending !== 'board-complete') return null;
  const loser = winner === 'p1' ? 'p2' : 'p1';

  if (state.players[loser].squares === 0) return 'Perfect board';
  if (highlights?.botDifficulty === 'hard') return 'Beat Hard';
  if ((highlights?.behindBy[winner] ?? 0) >= 3) return 'Comeback';

  const peak = highlights?.peakChain[winner] ?? 0;
  if (peak >= 4) return `Longest chain ×${peak}`;

  const total = Object.keys(state.squares).length;
  const margin = state.players[winner].squares - state.players[loser].squares;
  if (margin === 1) return 'Won by one';
  if (margin >= Math.max(3, total / 2)) return 'Commanding win';

  // A board played to the end and won is always an achievement — never let it
  // fall back to the flat "Game over" this whole function exists to replace.
  return 'Victory';
}

export function GameOverScreen({
  state,
  viewerSeat,
  highlights,
  rematch = null,
  onPlayAgain,
  onNewGame,
  onQuit,
}: GameOverScreenProps) {
  const { p1, p2 } = state.players;
  const winner =
    state.winner === null || state.winner === 'draw' ? null : state.players[state.winner];
  const winnerSeat = state.winner === 'draw' ? null : state.winner;
  // On a shared screen both players are looking, so it is fine; online and
  // against the computer, congratulating the winner to the loser's face is not.
  const achievement =
    viewerSeat === null || viewerSeat === winnerSeat
      ? describeAchievement(state, highlights)
      : null;
  const endedBy = state.endedBy;
  // LOOOOOSER is aimed at the player who lost it, so online it only appears on
  // their screen. On a shared pass-and-play screen (no seat) it still shows —
  // there is only one screen and the message is for whoever flagged.
  const loser =
    endedBy && (viewerSeat === null || viewerSeat === endedBy) ? state.players[endedBy] : null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Game over">
      <div className="panel overlay__panel">
        <p className={achievement ? 'overlay__eyebrow overlay__eyebrow--earned' : 'overlay__eyebrow'}>
          {achievement ?? (state.ending && ENDING_LABEL[state.ending]) ?? 'Game over'}
        </p>
        {loser ? (
          <>
            <h2 className="overlay__title overlay__title--loser">LOOOOOSER!!</h2>
            <p className="quit-confirm__body">
              {state.ending === 'timeout'
                ? `${loser.username} ran out of time. ${winner?.username} wins.`
                : `${loser.username} forfeited. ${winner?.username} wins.`}
            </p>
          </>
        ) : (
          <h2
            className="overlay__title"
            style={
              winner ? ({ color: PLAYER_THEME[winner.id].line } as React.CSSProperties) : undefined
            }
          >
            {winner ? `${winner.username} wins!` : "It's a draw!"}
          </h2>
        )}

        <div className="overlay__scores">
          {[p1, p2].map((player) => (
            <div
              key={player.id}
              className="overlay__score"
              style={{ '--player-color': PLAYER_THEME[player.id].line } as React.CSSProperties}
            >
              <span className="overlay__score-initials">{player.initials}</span>
              <span className="overlay__score-value">{player.squares}</span>
              <span className="overlay__score-name">{player.username}</span>
            </div>
          ))}
        </div>

        {highlights?.series && (
          <p className="overlay__series">
            Series {state.players.p1.initials} {highlights.series.p1} &ndash;{' '}
            {highlights.series.p2} {state.players.p2.initials}
            {highlights.series.draws > 0 ? ` · ${highlights.series.draws} drawn` : ''}
          </p>
        )}

        {rematch?.theirs && !rematch.mine && (
          <p className="overlay__rematch" role="status">
            <strong>{rematch.opponentName}</strong> wants a rematch
          </p>
        )}
        {rematch?.mine && !rematch.theirs && (
          <p className="overlay__rematch" role="status">
            Waiting for <strong>{rematch.opponentName}</strong> to accept…
          </p>
        )}

        <div className="overlay__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={onPlayAgain}
            disabled={rematch?.mine && !rematch.theirs}
          >
            {rematch?.theirs && !rematch.mine
              ? 'Accept Rematch'
              : rematch?.mine
                ? 'Asked…'
                : 'Play Again'}
          </button>
          {/* Named for where it goes: back to setup with the players' details
              still filled in, so only the settings need changing. */}
          <button type="button" className="button" onClick={onNewGame}>
            Change Setup
          </button>
        </div>

        {/* Its own row: this overlay covers the header, so Quit would be
            unreachable here otherwise — and it should not sit flush against
            the two buttons players actually press most. */}
        <button type="button" className="button button--ghost button--danger" onClick={onQuit}>
          Quit
        </button>
      </div>
    </div>
  );
}
