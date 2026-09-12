import { useEffect, useState } from 'react';
import {
  SPEEDS,
  describeTimeControl,
  timeControlFor,
  type PlayerSetup as PlayerSetupValues,
} from '../engine';
import { fetchRoomInfo, heldSeatToken, isValidRoomCode, normaliseRoomCode } from '../net/roomCode';
import { ROOM_CODE_ALPHABET, type RoomInfo, type RoomVisibility } from '../shared/protocol';
import { DIFFICULTIES, type Difficulty } from '../ai/bot';
import { MatchOptionsFields } from './MatchOptionsFields';
import { PLAYER_THEME } from './theme';

export interface MatchOptions {
  gridSize: number;
  timeControlMs: number | null;
  incrementMs: number;
  /** Set when player two is the computer. */
  botDifficulty?: Difficulty | null;
  /** Only meaningful for an online room. */
  visibility?: RoomVisibility;
}

/** Player two when the opponent is the computer. */
export const COMPUTER_PLAYER: PlayerSetupValues = { username: 'Computer', initials: 'CPU' };

export type SetupMode = 'local' | 'online' | 'computer';

interface PlayerSetupProps {
  onStart: (
    playerOne: PlayerSetupValues,
    playerTwo: PlayerSetupValues,
    options: MatchOptions,
  ) => void;
  onJoinRoom?: (code: string, player: PlayerSetupValues) => void;
  /** Online games are all started from the lobby, so this only carries a name. */
  onBrowseLobby?: (player: PlayerSetupValues) => void;
  /** Pre-filled from a ?room= link so a shared invite only asks for a name. */
  initialCode?: string;
  /** Where to land. Set when returning from the lobby, so Back does not
      silently drop the player into pass-and-play. */
  initialMode?: SetupMode;
  joinError?: string | null;
  /** Names carried over from the last game, so nobody retypes them. */
  initialPlayers?: { one: PlayerSetupValues; two: PlayerSetupValues };
}

interface FieldErrors {
  username?: string;
  initials?: string;
}

const INITIALS_PATTERN = /^[A-Za-z0-9]{2,3}$/;

/** Names what is actually missing, not the rules for everything at once. */
function missingFor(mode: SetupMode, one: FieldErrors, two: FieldErrors): string {
  const who = mode === 'local' ? 'Player 1' : 'you';
  if (one.username && one.initials) return `Enter a username and initials for ${who}.`;
  if (one.username) return `Enter a username for ${who}.`;
  if (one.initials) return `${one.initials} for ${who}.`;
  if (two.username) return 'Enter a username for Player 2.';
  if (two.initials) return `${two.initials} for Player 2.`;
  return 'Fill in both players to start.';
}

function validate(values: PlayerSetupValues, taken?: string): FieldErrors {
  const errors: FieldErrors = {};
  if (values.username.trim().length < 2) {
    errors.username = 'Enter at least 2 characters';
  }
  if (!INITIALS_PATTERN.test(values.initials.trim())) {
    errors.initials = 'Use 2-3 letters or numbers';
  } else if (taken && values.initials.trim().toUpperCase() === taken.trim().toUpperCase()) {
    // Initials are the identity chip on the board and the scoreboard, so two
    // players sharing them leaves colour and dash pattern as the only way to
    // tell whose squares are whose.
    errors.initials = 'Both players have these initials';
  }
  return errors;
}

export function PlayerSetup({
  onStart,
  onJoinRoom,
  onBrowseLobby,
  initialCode,
  initialMode,
  joinError,
  initialPlayers,
}: PlayerSetupProps) {
  // Defaults to local so the pass-and-play form is what renders on load.
  const [mode, setMode] = useState<SetupMode>(initialMode ?? (initialCode ? 'online' : 'local'));
  const [code, setCode] = useState(initialCode ?? '');
  const [one, setOne] = useState<PlayerSetupValues>(
    initialPlayers?.one ?? { username: '', initials: '' },
  );
  // Player two is prefilled so pass-and-play is playable in one field.
  const [two, setTwo] = useState<PlayerSetupValues>(
    initialPlayers?.two ?? { username: 'Player 2', initials: 'P2' },
  );
  const [showErrors, setShowErrors] = useState(false);
  // 10x10 is 81 squares — a long, slow first game. 5x5 finishes.
  const [gridSize, setGridSize] = useState(5);
  const [speed, setSpeed] = useState(SPEEDS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [invite, setInvite] = useState<RoomInfo | null>(null);
  const [checking, setChecking] = useState(false);

  // A joiner inherits the host's board and clock, so those controls are hidden
  // rather than shown doing nothing.
  const joining = mode === 'online' && isValidRoomCode(normaliseRoomCode(code));

  /**
   * Characters a room code never contains.
   *
   * The alphabet leaves out 0, 1, I, L and O precisely because people confuse
   * them — and the field accepted them anyway, then did nothing at all: no
   * lookup, no error, not even "looking up that game". The screen was identical
   * to an empty field, so the one case the alphabet exists to protect against
   * was the only one with no feedback. Both QA players hit this independently.
   */
  const confusable = normaliseRoomCode(code)
    .split('')
    .filter((character) => !ROOM_CODE_ALPHABET.includes(character));

  // Look the room up as soon as a full code is present, so the joiner sees the
  // match before committing to a seat.
  useEffect(() => {
    if (mode !== 'online') return;
    const clean = normaliseRoomCode(code);
    if (!isValidRoomCode(clean)) {
      setInvite(null);
      return;
    }
    let cancelled = false;
    setChecking(true);

    // The host publishes the code the moment they press Create, which can be
    // before their socket has actually created the room. A link opened in that
    // window used to report "no game found" for ever, so retry a few times
    // before believing it.
    const attempt = async (tries: number): Promise<void> => {
      const info = await fetchRoomInfo(clean);
      if (cancelled) return;
      if (info?.exists || tries === 0) {
        setInvite(info);
        setChecking(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (!cancelled) await attempt(tries - 1);
    };
    void attempt(4);

    return () => {
      cancelled = true;
    };
  }, [code, mode]);

  // Recomputed as the board slider moves, so the clock always matches the board.
  const timeControl = timeControlFor(gridSize, speed);

  const errorsOne = validate(one);
  // Only pass-and-play has two seats to clash; online opponents are on their
  // own screens and the server keeps them distinct.
  const errorsTwo = validate(two, mode === 'local' ? one.initials : undefined);
  const onlineValid = Object.keys(errorsOne).length === 0;
  const isValid =
    mode === 'local' ? onlineValid && Object.keys(errorsTwo).length === 0 : onlineValid;
  const canJoin = onlineValid && isValidRoomCode(normaliseRoomCode(code));

  /**
   * A seat we still hold in this room. A seat is claimed, not released, while
   * its player is away — that is what lets them come back — so the room reports
   * itself full and this screen used to refuse the very player it was holding
   * the seat for. Re-entering the code, or opening the invite link, both landed
   * on "That game already has two players" and there was no way back into your
   * own match.
   *
   * The room reclaims a known token and hands back the same seat. So this
   * preflight must not refuse on `full` alone: like a lobby row, it is a cache,
   * and the room is the authority.
   */
  const returning = joining && heldSeatToken(normaliseRoomCode(code)) !== null;

  /** True when the invitation card has taken over this part of the screen. */
  const showingInvite =
    joining && !checking && Boolean(invite?.exists) && (!invite?.full || returning);


  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Nothing here starts an online game any more — the lobby does. Enter in
    // the room-code field must not fall through to a pass-and-play start.
    if (mode === 'online') return;
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    const options = {
      gridSize,
      timeControlMs: timeControl.ms,
      incrementMs: timeControl.incrementMs,
    };
    if (mode === 'computer') {
      onStart(one, COMPUTER_PLAYER, { ...options, botDifficulty: difficulty });
      return;
    }
    onStart(one, two, options);
  };

  const renderFields = (
    label: string,
    playerKey: 'p1' | 'p2',
    values: PlayerSetupValues,
    setValues: (next: PlayerSetupValues) => void,
    errors: FieldErrors,
  ) => (
    <fieldset
      className="setup__player"
      style={{ '--player-color': PLAYER_THEME[playerKey].line } as React.CSSProperties}
    >
      <legend>{label}</legend>
      <label className="field">
        <span className="field__label">Username</span>
        <input
          type="text"
          value={values.username}
          maxLength={16}
          autoComplete="off"
          required
          aria-invalid={showErrors && Boolean(errors.username)}
          placeholder={playerKey === 'p1' ? 'Player 1' : 'Player 2'}
          onChange={(event) => setValues({ ...values, username: event.target.value })}
        />
        {showErrors && errors.username && <span className="field__error">{errors.username}</span>}
      </label>
      <label className="field">
        <span className="field__label">Initials</span>
        <input
          type="text"
          value={values.initials}
          maxLength={3}
          autoComplete="off"
          required
          aria-invalid={showErrors && Boolean(errors.initials)}
          placeholder={playerKey === 'p1' ? 'P1' : 'P2'}
          className="field__initials"
          onChange={(event) =>
            setValues({ ...values, initials: event.target.value.toUpperCase().slice(0, 3) })
          }
        />
        {showErrors && errors.initials && <span className="field__error">{errors.initials}</span>}
      </label>
    </fieldset>
  );

  return (
    <form className="panel setup" onSubmit={handleSubmit} noValidate>
      <header className="setup__header">
        <h1>Dots &amp; Squares</h1>
        <p>
          Take turns joining two neighbouring dots. Close the fourth side of a box to claim it,
          score a point, and go again.
        </p>
      </header>

      <div className="setup__modes" role="group" aria-label="How to play">
        <button
          type="button"
          className={mode === 'local' ? 'button button--chosen' : 'button'}
          aria-pressed={mode === 'local'}
          onClick={() => setMode('local')}
        >
          Pass &amp; Play
        </button>
        <button
          type="button"
          className={mode === 'online' ? 'button button--chosen' : 'button'}
          aria-pressed={mode === 'online'}
          onClick={() => setMode('online')}
        >
          Play Online
        </button>
        <button
          type="button"
          className={mode === 'computer' ? 'button button--chosen' : 'button'}
          aria-pressed={mode === 'computer'}
          onClick={() => setMode('computer')}
        >
          vs Computer
        </button>
      </div>

      <div className="setup__players">
        {renderFields(mode === 'local' ? 'Player 1' : 'You', 'p1', one, setOne, errorsOne)}
        {mode === 'local' && renderFields('Player 2', 'p2', two, setTwo, errorsTwo)}
      </div>

      {/* Online has one way in — the lobby — where the board, the clock and who
          can join are all chosen at the moment a game is actually staged. This
          screen only needs a name and, for an invited player, their code. */}
      {mode === 'online' && (
        <div className="field">
          {/* Kept visible even with a code in the field. It used to vanish at
              six characters, so a failed lookup left a screen with no action on
              it at all — and clearing the field to get the button back was not
              signposted anywhere. The moment the code route fails is exactly
              when the other route matters. */}
          {!showingInvite && (
            <>
              <button
                type="button"
                className="button button--primary setup__browse"
                disabled={!onlineValid}
                onClick={() => onBrowseLobby?.(one)}
              >
                Browse Open Games
              </button>
              <p className="board__hint">
                {onlineValid
                  ? 'Join a game that is waiting, or start your own from there.'
                  : 'Enter your name above to browse.'}
              </p>
            </>
          )}
          <label className="field__label" htmlFor="room-code">
            Have a code? Join their game
          </label>
          <input
            id="room-code"
            type="text"
            className="field__initials setup__code"
            value={code}
            maxLength={6}
            autoComplete="off"
            // A code is uppercase letters and digits only. Without these a phone
            // offers a lowercase keyboard and autocorrect, which is itself one
            // of the ways a character the alphabet excludes reaches the field.
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABC234"
            onChange={(event) => setCode(normaliseRoomCode(event.target.value))}
          />

          {confusable.length > 0 && (
            <p className="setup__hint" role="alert">
              A room code never contains {confusable.join(', ')} — codes leave out 0, 1, I, L
              and O so they cannot be misread. Check the code and try again.
            </p>
          )}

          {joining && checking && (
            <p className="board__hint" role="status">
              Looking up that game…
            </p>
          )}

          {joining && !checking && invite && !invite.exists && (
            <p className="setup__hint" role="alert">
              No game found with that code.
            </p>
          )}

          {joining && !checking && invite?.full && !returning && (
            <p className="setup__hint" role="alert">
              That game already has two players.
            </p>
          )}

          {joining && !checking && invite?.exists && (!invite.full || returning) && (
            <div className="invite" role="group" aria-label="Match invitation">
              <p className="invite__eyebrow">
                {returning ? 'Your game is still there' : 'You have been invited'}
              </p>
              <p className="invite__host">
                {returning ? (
                  <>
                    Rejoin <strong>{invite.hostName}</strong>
                  </>
                ) : (
                  <>
                    <strong>{invite.hostName}</strong> wants to play
                  </>
                )}
              </p>
              <dl className="invite__facts">
                <div>
                  <dt>Board</dt>
                  <dd>
                    {invite.gridSize} &times; {invite.gridSize} dots &middot;{' '}
                    {(invite.gridSize - 1) ** 2} squares
                  </dd>
                </div>
                <div>
                  <dt>Clock</dt>
                  <dd>
                    {describeTimeControl({
                      ms: invite.timeControlMs,
                      incrementMs: invite.incrementMs,
                    })}
                  </dd>
                </div>
              </dl>
              <div className="overlay__actions">
                <button type="button" className="button" onClick={() => setCode('')}>
                  Decline
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!canJoin}
                  onClick={() => onJoinRoom?.(normaliseRoomCode(code), one)}
                >
                  {returning ? 'Rejoin Game' : 'Accept & Play'}
                </button>
              </div>
              {!onlineValid && <p className="board__hint">Enter your name above to accept.</p>}
            </div>
          )}

          {joinError && (
            <p className="setup__hint" role="alert">
              {joinError}
            </p>
          )}
        </div>
      )}

      {mode === 'computer' && (
        <div className="field">
          <span className="field__label" id="difficulty-label">
            Opponent
          </span>
          <div className="setup__choices" role="group" aria-labelledby="difficulty-label">
            {DIFFICULTIES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  option.id === difficulty
                    ? 'button button--ghost button--chosen time-control'
                    : 'button button--ghost time-control'
                }
                aria-pressed={option.id === difficulty}
                onClick={() => setDifficulty(option.id)}
              >
                <span className="time-control__label">{option.label}</span>
                <span className="time-control__kind">{option.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode !== 'online' && (
        <MatchOptionsFields
          gridSize={gridSize}
          onGridSize={setGridSize}
          speed={speed}
          onSpeed={setSpeed}
        />
      )}

      {mode !== 'online' && (
        <>
          <button
            type="submit"
            className="button button--primary"
            disabled={!isValid}
            // A disabled control with no explanation is a dead end: a first
            // visitor lands here with Player 1 blank (Player 2 is pre-filled),
            // clicks Start Game, and nothing happens and nothing says why.
            aria-describedby={isValid ? undefined : 'start-blocked'}
          >
            {mode === 'computer' ? 'Play Computer' : 'Start Game'}
          </button>
          {!isValid && (
            <p className="setup__hint" id="start-blocked" role="status">
              {missingFor(mode, errorsOne, errorsTwo)}
            </p>
          )}
        </>
      )}
    </form>
  );
}
