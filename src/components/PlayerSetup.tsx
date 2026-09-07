import { useEffect, useState } from 'react';
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  SPEEDS,
  describeTimeControl,
  timeControlFor,
  type PlayerSetup as PlayerSetupValues,
} from '../engine';
import { fetchRoomInfo, isValidRoomCode, normaliseRoomCode } from '../net/roomCode';
import type { RoomInfo, RoomVisibility } from '../shared/protocol';
import { DIFFICULTIES, type Difficulty } from '../ai/bot';
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
  onCreateRoom?: (player: PlayerSetupValues, options: MatchOptions) => void;
  onJoinRoom?: (code: string, player: PlayerSetupValues) => void;
  onBrowseLobby?: (player: PlayerSetupValues, options: MatchOptions) => void;
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

function validate(values: PlayerSetupValues): FieldErrors {
  const errors: FieldErrors = {};
  if (values.username.trim().length < 2) {
    errors.username = 'Enter at least 2 characters';
  }
  if (!INITIALS_PATTERN.test(values.initials.trim())) {
    errors.initials = 'Use 2-3 letters or numbers';
  }
  return errors;
}

export function PlayerSetup({
  onStart,
  onCreateRoom,
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
  // Public by default: a lobby nobody stages games into is an empty lobby.
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [invite, setInvite] = useState<RoomInfo | null>(null);
  const [checking, setChecking] = useState(false);

  // The host picks the board and clock; a joiner inherits them, so those
  // controls are hidden rather than shown doing nothing.
  const joining = mode === 'online' && isValidRoomCode(normaliseRoomCode(code));

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
  const errorsTwo = validate(two);
  const onlineValid = Object.keys(errorsOne).length === 0;
  const isValid =
    mode === 'local' ? onlineValid && Object.keys(errorsTwo).length === 0 : onlineValid;
  const canJoin = onlineValid && isValidRoomCode(normaliseRoomCode(code));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    const options = {
      gridSize,
      timeControlMs: timeControl.ms,
      incrementMs: timeControl.incrementMs,
    };
    if (mode === 'online') {
      onCreateRoom?.(one, { ...options, visibility });
      return;
    }
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

      {mode === 'online' && !joining && (
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
              <span className="time-control__kind">Only people with your code</span>
            </button>
          </div>
        </div>
      )}

      {mode === 'online' && (
        <div className="field">
          {!joining && (
            <button
              type="button"
              className="button setup__browse"
              disabled={!onlineValid}
              onClick={() =>
                onBrowseLobby?.(one, {
                  gridSize,
                  timeControlMs: timeControl.ms,
                  incrementMs: timeControl.incrementMs,
                  visibility: 'public',
                })
              }
            >
              Browse open games
            </button>
          )}
          {!joining && !onlineValid && (
            <p className="board__hint">Enter your name above to browse.</p>
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
            placeholder="ABC234"
            onChange={(event) => setCode(normaliseRoomCode(event.target.value))}
          />

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

          {joining && !checking && invite?.full && (
            <p className="setup__hint" role="alert">
              That game already has two players.
            </p>
          )}

          {joining && !checking && invite?.exists && !invite.full && (
            <div className="invite" role="group" aria-label="Match invitation">
              <p className="invite__eyebrow">You have been invited</p>
              <p className="invite__host">
                <strong>{invite.hostName}</strong> wants to play
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
                  Accept &amp; Play
                </button>
              </div>
              {!onlineValid && (
                <p className="board__hint">Enter your name above to accept.</p>
              )}
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

      {!joining && (
      <div className="setup__options">
        <div className="field">
          <label className="field__label" htmlFor="grid-size">
            Board — {gridSize} &times; {gridSize} dots, {(gridSize - 1) ** 2} squares
          </label>
          <input
            id="grid-size"
            type="range"
            className="setup__range"
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            step={1}
            value={gridSize}
            onChange={(event) => setGridSize(Number(event.target.value))}
          />
        </div>

        <div className="field">
          <span className="field__label" id="time-control-label">
            Speed — {describeTimeControl(timeControl)} on this board
          </span>
          <div className="setup__choices" role="group" aria-labelledby="time-control-label">
            {SPEEDS.map((option) => {
              const control = timeControlFor(gridSize, option);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={
                    option.id === speed.id
                      ? 'button button--ghost button--chosen time-control'
                      : 'button button--ghost time-control'
                  }
                  aria-pressed={option.id === speed.id}
                  onClick={() => setSpeed(option)}
                >
                  <span className="time-control__label">{option.label}</span>
                  <span className="time-control__kind">{describeTimeControl(control)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      )}

      {!joining && (
        <button type="submit" className="button button--primary" disabled={!isValid}>
          {mode === 'online' ? 'Create Room' : mode === 'computer' ? 'Play Computer' : 'Start Game'}
        </button>
      )}
      {showErrors && !isValid && (
        <p className="setup__hint" role="alert">
          {mode === 'local'
            ? 'Both players need a username and 2-3 character initials.'
            : 'Enter a username and 2-3 character initials.'}
        </p>
      )}
    </form>
  );
}
