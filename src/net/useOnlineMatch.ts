import { useCallback, useEffect, useState } from 'react';
import type { PlayerSetup as PlayerSetupValues } from '../engine';
import type { MatchOptions } from '../components/PlayerSetup';
import { generateRoomCode } from './roomCode';
import { useLobbyFeed } from './useLobbyFeed';
import { useRemoteSession } from './useRemoteSession';

interface UseOnlineMatchOptions {
  /** A name the player has committed to, worth remembering for next time. */
  rememberPlayer: (player: PlayerSetupValues) => void;
  /** Entering a live match — the gesture that lets audio be unlocked. */
  onEnterMatch: () => void;
  /** An online match ended with no rematch; the local board must be cleared. */
  onMatchEnded: () => void;
}

/**
 * The whole online match lifecycle: the lobby feed, the room socket, and the
 * screen-level state that says which of them the player is looking at.
 *
 * It lives here rather than in App because it was never really nine pieces of
 * state — `browsing`, `browsePlayer`, `busyCode`, `lobbyNotice`, `deadCodes`,
 * `hosting` and `joiningHost` are one concern wearing seven names, and reading
 * any one of them in App meant reconstructing the other six to know what it
 * meant. App keeps the board, the sound and the quit flow; everything about
 * being connected to someone else is in here.
 *
 * Three App-side concerns are passed in as callbacks rather than reached for
 * directly: remembering a name, unlocking audio, and clearing the local board.
 * Each belongs to App, and a network hook that imported the sound module to do
 * the second would put the layering back exactly where this moves it from.
 */
export function useOnlineMatch({
  rememberPlayer,
  onEnterMatch,
  onMatchEnded,
}: UseOnlineMatchOptions) {
  const remote = useRemoteSession();
  const lobby = useLobbyFeed();

  const [online, setOnline] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [browsePlayer, setBrowsePlayer] = useState<PlayerSetupValues | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState<string | null>(null);
  /**
   * Rows the lobby is still advertising but that refused us on the way in. The
   * feed is the server's view; this is what we have actually proven. Without it
   * a dead row stays on screen and the second click looks exactly like the
   * first — which is what "nothing happened" felt like.
   */
  const [deadCodes, setDeadCodes] = useState<string[]>([]);
  const [hosting, setHosting] = useState(true);
  const [joiningHost, setJoiningHost] = useState<string | null>(null);
  /** Explains, back on the setup screen, why a match ended without a rematch. */
  const [matchEndedNotice, setMatchEndedNotice] = useState<string | null>(null);

  const createRoom = useCallback(
    (player: PlayerSetupValues, options: MatchOptions) => {
      onEnterMatch();
      rememberPlayer(player);
      setMatchEndedNotice(null);
      setOnline(true);
      setHosting(true);
      setJoiningHost(null);
      remote.connect({
        code: generateRoomCode(),
        player,
        create: true,
        gridSize: options.gridSize,
        timeControlMs: options.timeControlMs,
        incrementMs: options.incrementMs,
        visibility: options.visibility,
      });
    },
    [remote, rememberPlayer, onEnterMatch],
  );

  const joinRoom = useCallback(
    (code: string, player: PlayerSetupValues) => {
      onEnterMatch();
      rememberPlayer(player);
      setMatchEndedNotice(null);
      setOnline(true);
      setHosting(false);
      remote.connect({ code, player, create: false });
    },
    [remote, rememberPlayer, onEnterMatch],
  );

  /**
   * A rematch offer that expired. Both players are returned to the start —
   * there is nothing left to wait for, and the alternative is a screen that
   * never changes.
   */
  useEffect(() => {
    if (!remote.rematchExpired) return;
    setMatchEndedNotice('The other player did not answer — the match has ended.');
    remote.disconnect();
    setOnline(false);
    onMatchEnded();
  }, [remote.rematchExpired, remote, onMatchEnded]);

  // A join that landed. Without this the browse screen is still armed behind
  // the game, and leaving it later drops the player onto a dead lobby.
  useEffect(() => {
    if (!remote.seat) return;
    setBusyCode(null);
    setBrowsing(false);
    setLobbyNotice(null);
    lobby.close();
  }, [remote.seat, lobby]);

  /**
   * A join that started from the lobby and was refused. The row was a snapshot
   * of something already gone, so put the player back in front of the list with
   * a plain explanation rather than a dead-end error screen.
   */
  useEffect(() => {
    if (!busyCode || !remote.failure) return;
    setLobbyNotice(
      remote.failure === 'room-full'
        ? 'That game just filled — pick another.'
        : 'That game is no longer open — pick another.',
    );
    setDeadCodes((current) => (current.includes(busyCode) ? current : [...current, busyCode]));
    setBusyCode(null);
    remote.disconnect();
    setOnline(false);
    setBrowsing(true);
    lobby.open();
  }, [busyCode, remote, lobby]);

  const browseLobby = useCallback(
    (player: PlayerSetupValues) => {
      setBrowsePlayer(player);
      rememberPlayer(player);
      setLobbyNotice(null);
      setBrowsing(true);
      lobby.open();
    },
    [lobby, rememberPlayer],
  );

  const joinFromLobby = useCallback(
    (code: string, hostName: string) => {
      if (!browsePlayer) return;
      // The row is a cache; the room decides. Hold it until we know which.
      setBusyCode(code);
      setJoiningHost(hostName);
      joinRoom(code, browsePlayer);
    },
    [browsePlayer, joinRoom],
  );

  /** Being first in is fine — stage the game and wait right here. */
  const stageFromLobby = useCallback(
    (options: MatchOptions) => {
      if (!browsePlayer) return;
      setBrowsing(false);
      lobby.close();
      createRoom(browsePlayer, options);
    },
    [browsePlayer, lobby, createRoom],
  );

  const leaveLobby = useCallback(() => {
    setBrowsing(false);
    lobby.close();
  }, [lobby]);

  const leaveOnline = useCallback(() => {
    remote.disconnect();
    setOnline(false);
  }, [remote]);

  return {
    remote,
    online,
    /** True while the player is looking at the open-games list. */
    browsing,
    browsePlayer,
    busyCode,
    lobbyNotice,
    matchEndedNotice,
    hosting,
    joiningHost,
    /** The feed, minus rows this client has already been refused by. */
    games: lobby.games.filter((game) => !deadCodes.includes(game.code)),
    lobbyStatus: lobby.status,
    createRoom,
    joinRoom,
    browseLobby,
    joinFromLobby,
    stageFromLobby,
    leaveLobby,
    leaveOnline,
  };
}
