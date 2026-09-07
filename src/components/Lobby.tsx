import { useState } from 'react';
import { shareLink } from '../net/roomCode';
import type { ConnectionStatus } from '../net/useRemoteSession';

interface LobbyProps {
  code: string;
  status: ConnectionStatus;
  onCancel: () => void;
  /** False when this player is joining someone else's room. */
  isHost?: boolean;
  /** Whose game is being joined, when we know it. */
  hostName?: string | null;
}

/**
 * Shown between reaching a room and the game starting.
 *
 * A host is waiting for someone to arrive and needs the code to share. A joiner
 * is waiting for a handshake and needs neither — offering them a code to send
 * out would be inviting a stranger to a game that is not theirs.
 */
export function Lobby({ code, status, onCancel, isHost = true, hostName }: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const live = status === 'open';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the code is on screen to read out.
      setCopied(false);
    }
  };

  return (
    <div className="panel setup">
      <header className="setup__header">
        <h1>{isHost ? 'Waiting' : 'Joining'}</h1>
        <p>
          {isHost
            ? 'Send this code to the other player. The game starts the moment they join.'
            : `Taking a seat in ${hostName ? `${hostName}'s` : 'the'} game…`}
        </p>
      </header>

      {/* The code is only real once the room exists on the server; showing it
          while still connecting invites sharing a link that dead-ends. */}
      {isHost && <code className="quit-screen__command lobby__code">{live ? code : '······'}</code>}

      <div className="overlay__actions">
        {isHost && (
          <button type="button" className="button button--primary" onClick={copy} disabled={!live}>
            {copied ? 'Link copied' : live ? 'Copy link' : 'Creating room…'}
          </button>
        )}
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <p className="board__waiting" role="status">
        <span className="board__waiting-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {status === 'reconnecting'
          ? 'Reconnecting…'
          : !isHost
            ? 'Joining…'
            : status === 'open'
              ? 'Waiting for the other player to join…'
              : 'Connecting…'}
      </p>
    </div>
  );
}
