import { useEffect, useState } from 'react';
import { inviteMessage, offerInvite, type InviteOutcome } from '../net/invite';
import type { JoinFailure } from '../shared/protocol';
import type { ConnectionStatus } from '../net/useRemoteSession';

interface LobbyProps {
  code: string;
  status: ConnectionStatus;
  onCancel: () => void;
  /** False when this player is joining someone else's room. */
  isHost?: boolean;
  /** Whose game is being joined, when we know it. */
  hostName?: string | null;
  /** Why the connection ended, when it ended badly. */
  failure?: JoinFailure | null;
}

const FAILURE_TEXT: Record<JoinFailure, string> = {
  'room-full': 'That room already has two players.',
  'room-exists': 'That code is already taken — try again for a new one.',
  'room-closed': 'That room is no longer open.',
  'bad-code': 'That code does not look right.',
};

/** How long a connect may sit silent before we admit it is slow. */
const SLOW_MS = 4000;

/**
 * Shown between reaching a room and the game starting.
 *
 * A host is waiting for someone to arrive and needs the code to share. A joiner
 * is waiting for a handshake and needs neither — offering them a code to send
 * out would be inviting a stranger to a game that is not theirs.
 *
 * Every terminal state has to be nameable. `closed` once rendered the same
 * spinner as `connecting`, so a room that had failed looked exactly like one
 * that was merely slow, and the player waited for ever on nothing.
 */
export function Lobby({
  code,
  status,
  onCancel,
  isHost = true,
  hostName,
  failure = null,
}: LobbyProps) {
  const [invited, setInvited] = useState<InviteOutcome | null>(null);
  const [slow, setSlow] = useState(false);
  const live = status === 'open';
  const failed = status === 'closed';

  // Silence past this point is worth naming: the connect has not failed, but
  // saying nothing about it is exactly what reads as a hang.
  useEffect(() => {
    if (status !== 'connecting' && status !== 'reconnecting') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const invite = async () => {
    const outcome = await offerInvite(code, hostName ?? undefined);
    // Nothing is said about a sheet the player dismissed: they saw it, they
    // changed their mind, and a message about it would be noise.
    if (outcome === 'dismissed') return;
    setInvited(outcome);
    setTimeout(() => setInvited(null), 2500);
  };

  return (
    <div className="panel setup">
      <header className="setup__header">
        <h1>{failed ? 'Could not connect' : isHost ? 'Waiting' : 'Joining'}</h1>
        <p>
          {failed
            ? 'Nothing was lost — go back and pick another game.'
            : isHost
              ? 'Send this code to the other player. The game starts the moment they join.'
              : `Taking a seat in ${hostName ? `${hostName}'s` : 'the'} game…`}
        </p>
      </header>

      {/* The code is only real once the room exists on the server; showing it
          while still connecting invites sharing a link that dead-ends. */}
      {isHost && !failed && (
        <code className="quit-screen__command lobby__code">{live ? code : '······'}</code>
      )}

      <div className="overlay__actions">
        {isHost && !failed && (
          <button
            type="button"
            className="button button--primary"
            onClick={invite}
            disabled={!live}
          >
            {!live
              ? 'Creating room…'
              : invited === 'shared'
                ? 'Invitation sent'
                : invited === 'copied'
                  ? 'Invitation copied'
                  : 'Invite a player'}
          </button>
        )}
        <button type="button" className="button" onClick={onCancel}>
          {failed ? 'Back' : 'Cancel'}
        </button>
      </div>

      {/* Neither the share sheet nor the clipboard worked, so hand over the
          invitation itself rather than explaining which mechanism failed. The
          player still has someone to invite; a selected textarea is something
          they can act on. */}
      {isHost && invited === 'failed' && (
        <div className="field" role="group" aria-label="Invitation to copy">
          <p className="setup__hint" role="alert">
            Copying did not work here — select this and send it yourself:
          </p>
          <textarea
            className="field__initials lobby__invite-text"
            readOnly
            rows={2}
            value={inviteMessage(code, hostName ?? undefined)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Invitation text and link"
          />
        </div>
      )}

      {failed ? (
        <p className="setup__hint" role="alert">
          {(failure && FAILURE_TEXT[failure]) ?? 'Could not reach the room. Check your connection.'}
        </p>
      ) : (
        <p className="board__waiting" role="status">
          <span className="board__waiting-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {status === 'reconnecting'
            ? slow
              ? 'Still reconnecting — the connection is slow…'
              : 'Reconnecting…'
            : !isHost
              ? slow
                ? 'Still joining — the connection is slow…'
                : 'Joining…'
              : live
                ? 'Waiting for the other player to join…'
                : slow
                  ? 'Still connecting — this is taking longer than usual…'
                  : 'Connecting…'}
        </p>
      )}
    </div>
  );
}
