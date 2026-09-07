import { useCallback, useEffect, useRef, useState } from 'react';
import { GameBoard } from './components/GameBoard';
import { GameOverScreen, type MatchHighlights } from './components/GameOverScreen';
import { Lobby } from './components/Lobby';
import { PublicLobby } from './components/PublicLobby';
import { useLobbyFeed } from './net/useLobbyFeed';
import { PlayerSetup, type MatchOptions } from './components/PlayerSetup';
import { generateRoomCode } from './net/roomCode';
import { useRemoteSession } from './net/useRemoteSession';
import { QuitScreen } from './components/QuitScreen';
import { Scoreboard } from './components/Scoreboard';
import { PLAYER_THEME } from './components/theme';
import { canStopServer } from './quit-behaviour';
import {
  isMuted,
  isOpponent,
  playChainResolve,
  playClaimLine,
  playClaimSquare,
  playCountdownTick,
  playDefeat,
  playDrawOffered,
  playOpponentJoined,
  playOpponentLeft,
  playRejected,
  playTimeUp,
  playVictory,
  playVictorySweep,
  primeAudio,
  setAudioSeat,
  setMuted,
} from './sound';
import { chooseMove, type Difficulty } from './ai/bot';
import { requestShutdown, type ShutdownOutcome } from './shutdown';
import {
  createGame,
  flagPlayer,
  hasFlagged,
  makeMove,
  remainingEdgeCount,
  remainingMsFor,
  startClock,
  type GameState,
  type PlayerId,
  type PlayerSetup as PlayerSetupValues,
} from './engine';

interface Match {
  playerOne: PlayerSetupValues;
  playerTwo: PlayerSetupValues;
  options: MatchOptions;
  /** Set when player two is the computer. Lives here so a rematch keeps it. */
  bot: Difficulty | null;
}

type QuitPhase = 'idle' | 'confirming' | 'quitting';

/**
 * How often the clock display refreshes. The clock itself is stored as a
 * balance plus a start timestamp, so this only drives repainting — dropping a
 * tick can never lose or gain a player any time.
 */
const CLOCK_TICK_MS = 200;

const JOIN_ERRORS: Record<string, string> = {
  'room-full': 'That room already has two players.',
  'room-exists': 'That code is taken — try creating again.',
  'room-closed': 'That room is no longer open.',
  'bad-code': 'That code does not look right.',
};

const NOTICES: Record<string, string> = {
  'not-your-turn': 'Not your turn.',
  'edge-taken': 'Someone just took that line.',
  'game-over': 'The game has finished.',
  'unknown-edge': "That move isn't valid.",
  'not-adjacent': "That move isn't valid.",
  'no-seat': 'You are not seated in this game.',
  'no-game': 'No game in progress.',
};

/** Read once on load so a shared ?room= link opens straight into join. */
const linkedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? undefined;

const PLAYERS_KEY = 'ds:players';

/** Names from the last game, so returning to setup never means retyping. */
function loadPlayers(): { one: PlayerSetupValues; two: PlayerSetupValues } | undefined {
  try {
    const raw = localStorage.getItem(PLAYERS_KEY);
    return raw ? (JSON.parse(raw) as { one: PlayerSetupValues; two: PlayerSetupValues }) : undefined;
  } catch {
    return undefined;
  }
}

function savePlayers(one: PlayerSetupValues, two: PlayerSetupValues): void {
  try {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify({ one, two }));
  } catch {
    // A blocked store just means they are not remembered next visit.
  }
}

export default function App() {
  const [match, setMatch] = useState<Match | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [online, setOnline] = useState(false);
  const [savedPlayers, setSavedPlayers] = useState(loadPlayers);
  const remote = useRemoteSession();
  const lobby = useLobbyFeed();
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
  /** Explains, back on the setup screen, why a match ended without a rematch. */
  const [matchEndedNotice, setMatchEndedNotice] = useState<string | null>(null);
  const [hosting, setHosting] = useState(true);
  const [joiningHost, setJoiningHost] = useState<string | null>(null);
  const [quitPhase, setQuitPhase] = useState<QuitPhase>('idle');
  const [shutdown, setShutdown] = useState<ShutdownOutcome | null>(null);
  // Forces a repaint while a clock runs. The clock itself is a balance plus a
  // timestamp, so this only drives rendering — a dropped tick cannot alter time.
  const [, tick] = useState(0);
  // Boxes claimed in the current unbroken run of turns by one player. A move
  // takes at most two, so a long cascade only exists across extra turns.
  const [chain, setChain] = useState(0);
  const [muted, setMutedState] = useState(isMuted);
  // Held while the winning board is swept, before the result panel arrives.
  const [celebrating, setCelebrating] = useState(false);
  // Held to peek at the chain analysis. Reveals nothing the position does not
  // already contain, so it changes no rules.
  const [showChains, setShowChains] = useState(false);

  // Online play is authoritative on the server, so the board comes from there.
  const activeState = online ? remote.state : state;

  const startGame = useCallback(
    (playerOne: PlayerSetupValues, playerTwo: PlayerSetupValues, options: MatchOptions) => {
      primeAudio();
      setSavedPlayers({ one: playerOne, two: playerTwo });
      savePlayers(playerOne, playerTwo);
      setMatch({ playerOne, playerTwo, options, bot: options.botDifficulty ?? null });
      setState(
        startClock(
          createGame(playerOne, playerTwo, options.gridSize, options.timeControlMs, options.incrementMs),
          Date.now(),
        ),
      );
    },
    [],
  );

  const playAgain = useCallback(() => {
    if (!match) return;
    setState(
      startClock(
        createGame(
          match.playerOne,
          match.playerTwo,
          match.options.gridSize,
          match.options.timeControlMs,
          match.options.incrementMs,
        ),
        Date.now(),
      ),
    );
  }, [match]);

  const newGame = useCallback(() => {
    setMatch(null);
    setState(null);
  }, []);

  const selectEdge = useCallback((edgeId: string) => {
    setState((current) => {
      if (!current) return current;
      const result = makeMove(current, edgeId, Date.now());
      // A rejected move still matters when the clock ran out — makeMove hands
      // back the flagged state in that case.
      return result.ok || result.state !== current ? result.state : current;
    });
  }, []);

  /**
   * Watches for state changes and turns them into feel: accumulates the chain,
   * and sounds each claimed box at a rising pitch.
   *
   * Derived from whole `GameState`s rather than from `MoveResult`, because the
   * online client only ever receives states — so one implementation covers both
   * modes and needs no protocol change.
   */
  const lastSeenRef = useRef<{ edges: number; player: PlayerId | null }>({
    edges: -1,
    player: null,
  });
  /** Facts worth naming on the end screen. Kept out of GameState so the online
      protocol is untouched. */
  const highlightsRef = useRef<MatchHighlights>({ peakChain: { p1: 0, p2: 0 }, behindBy: { p1: 0, p2: 0 } });
  useEffect(() => {
    if (!activeState) {
      lastSeenRef.current = { edges: -1, player: null };
      setChain(0);
      return;
    }
    const drawn = Object.values(activeState.edges).filter((edge) => edge.owner !== null).length;
    const previous = lastSeenRef.current;
    if (drawn === previous.edges) return;

    const claimed = activeState.lastClaimedSquares.length;
    const sameRun = previous.player === activeState.currentPlayer;

    // The mover is the previous current player when the turn just changed, and
    // the current one while a run continues.
    const mover = sameRun ? activeState.currentPlayer : previous.player;
    const theirs = isOpponent(mover);

    if (previous.edges >= 0 && drawn > previous.edges) {
      playClaimLine(theirs);
      for (let i = 0; i < claimed; i += 1) {
        const position = (sameRun ? chain : 0) + i;
        window.setTimeout(() => playClaimSquare(position, theirs), i * 90);
      }
    }

    // A move that claims nothing ends the run, as does the turn changing hands.
    const ending = claimed === 0 || !sameRun;
    if (ending && chain >= 2) {
      window.setTimeout(() => playChainResolve(chain, isOpponent(previous.player)), claimed * 90);
    }
    setChain(ending ? claimed : chain + claimed);

    // Peak chain per player, and the deepest deficit each came back from.
    const run = ending ? (sameRun ? chain + claimed : claimed) : chain + claimed;
    if (mover && run > highlightsRef.current.peakChain[mover]) {
      highlightsRef.current.peakChain[mover] = run;
    }
    for (const seat of ['p1', 'p2'] as PlayerId[]) {
      const deficit =
        activeState.players[seat === 'p1' ? 'p2' : 'p1'].squares - activeState.players[seat].squares;
      if (deficit > highlightsRef.current.behindBy[seat]) {
        highlightsRef.current.behindBy[seat] = deficit;
      }
    }
    lastSeenRef.current = { edges: drawn, player: activeState.currentPlayer };
  }, [activeState, chain]);

  // A sting on the end screen, once.
  const endedRef = useRef(false);
  useEffect(() => {
    if (!activeState || activeState.status !== 'finished') {
      endedRef.current = false;
      setCelebrating(false);
      highlightsRef.current = { peakChain: { p1: 0, p2: 0 }, behindBy: { p1: 0, p2: 0 } };
      return;
    }
    if (endedRef.current) return;
    endedRef.current = true;

    const seat = online ? remote.seat : null;
    const winner = activeState.winner;
    const lost =
      winner !== null && winner !== 'draw' && seat !== null ? winner !== seat : false;

    // A board played to the end is an achievement worth replaying; a timeout or
    // a forfeit is not, so those keep the plain sting.
    const earned = activeState.ending === 'board-complete' && winner !== null && winner !== 'draw';
    if (earned && !lost) {
      const owned = Object.values(activeState.squares).filter((sq) => sq.owner === winner).length;
      setCelebrating(true);
      playVictorySweep(owned);
      const timer = setTimeout(() => setCelebrating(false), 900);
      return () => clearTimeout(timer);
    }
    if (lost) playDefeat();
    else playVictory();
  }, [activeState, online, remote.seat]);

  // Sounds for things that would otherwise happen silently while you look away.
  const presenceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!online || !remote.presence || !remote.seat) return;
    const theirs = remote.presence[remote.seat === 'p1' ? 'p2' : 'p1'];
    if (presenceRef.current === theirs) return;
    const before = presenceRef.current;
    presenceRef.current = theirs;
    if (before === null) return;
    if (theirs === 'connected') playOpponentJoined();
    else if (before === 'connected') playOpponentLeft();
  }, [online, remote.presence, remote.seat]);

  const drawRef = useRef<PlayerId | null>(null);
  useEffect(() => {
    if (remote.drawOfferedBy && remote.drawOfferedBy !== drawRef.current) playDrawOffered();
    drawRef.current = remote.drawOfferedBy;
  }, [remote.drawOfferedBy]);

  const noticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (remote.notice && remote.notice !== noticeRef.current) playRejected();
    noticeRef.current = remote.notice;
  }, [remote.notice]);

  useEffect(() => {
    setAudioSeat(online ? remote.seat : null);
  }, [online, remote.seat]);

  // Hold C to see the chains.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'c' || event.key === 'C') setShowChains(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'c' || event.key === 'C') setShowChains(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const clockRunning = Boolean(activeState?.clock) && activeState?.status === 'playing';

  /**
   * Keeps the displayed clock moving continuously.
   *
   * This has to run for online play too. It previously watched only the local
   * `state`, so an online clock sat frozen between server messages and only
   * jumped when somebody moved — it looked stopped.
   *
   * Only the local game flags here; online, the server's alarm is the
   * authority and the client merely draws what it is told.
   */
  useEffect(() => {
    if (!clockRunning) return;
    const timer = setInterval(() => {
      tick((n) => n + 1);
      if (online) return;
      setState((current) => {
        if (!current || current.status !== 'playing') return current;
        const now = Date.now();
        return hasFlagged(current, now) ? flagPlayer(current, current.currentPlayer) : current;
      });
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [clockRunning, online]);

  // The last five seconds get a rising beep per second, then a lower tone when
  // the flag falls. Driven off the running clock, so both players hear it.
  const lastBeepRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeState?.clock) {
      lastBeepRef.current = null;
      return;
    }
    if (activeState.status !== 'playing') {
      if (activeState.ending === 'timeout' && lastBeepRef.current !== 0) {
        lastBeepRef.current = 0;
        playTimeUp();
      }
      return;
    }
    const left = remainingMsFor(activeState, activeState.currentPlayer, Date.now());
    const secondsLeft = Math.ceil(left / 1000);
    if (secondsLeft > 5 || secondsLeft < 1) {
      if (secondsLeft > 5) lastBeepRef.current = null;
      return;
    }
    // One beep per second boundary, never repeated on the same second.
    if (lastBeepRef.current !== secondsLeft) {
      lastBeepRef.current = secondsLeft;
      playCountdownTick(secondsLeft);
    }
  });

  /**
   * Plays the computer's move.
   *
   * Keyed on how many edges are drawn, NOT on `currentPlayer` — claiming a box
   * grants another turn and leaves `currentPlayer` unchanged, so a
   * currentPlayer-keyed effect would stall the bot exactly mid-cascade.
   *
   * The delay is capped against the bot's own clock: `makeMove` charges it for
   * wall-clock thinking time, so a fixed pause would flag it on a short clock.
   */
  const drawnEdges = state
    ? Object.values(state.edges).filter((edge) => edge.owner !== null).length
    : -1;
  useEffect(() => {
    const difficulty = match?.bot;
    if (!difficulty || online || !state || state.status !== 'playing') return;
    if (state.currentPlayer !== 'p2') return;

    const left = state.clock ? remainingMsFor(state, 'p2', Date.now()) : Infinity;
    const delay = Math.max(120, Math.min(450, left / 20));

    const timer = setTimeout(() => {
      setState((current) => {
        if (!current || current.status !== 'playing' || current.currentPlayer !== 'p2') {
          return current;
        }
        const move = chooseMove(current, difficulty);
        if (!move) return current;
        const result = makeMove(current, move, Date.now());
        return result.ok || result.state !== current ? result.state : current;
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [match?.bot, online, state?.currentPlayer, state?.status, drawnEdges]);

  const createRoom = useCallback(
    (player: PlayerSetupValues, options: MatchOptions) => {
      primeAudio();
      setSavedPlayers((current) => ({ one: player, two: current?.two ?? { username: 'Player 2', initials: 'P2' } }));
      savePlayers(player, savedPlayers?.two ?? { username: 'Player 2', initials: 'P2' });
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
    [remote],
  );

  const joinRoom = useCallback(
    (code: string, player: PlayerSetupValues) => {
      primeAudio();
      setSavedPlayers((current) => ({ one: player, two: current?.two ?? { username: 'Player 2', initials: 'P2' } }));
      savePlayers(player, savedPlayers?.two ?? { username: 'Player 2', initials: 'P2' });
      setMatchEndedNotice(null);
      setOnline(true);
      setHosting(false);
      remote.connect({ code, player, create: false });
    },
    [remote],
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
    setState(null);
    setMatch(null);
  }, [remote.rematchExpired, remote]);

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
      setSavedPlayers((current) => ({
        one: player,
        two: current?.two ?? { username: 'Player 2', initials: 'P2' },
      }));
      setLobbyNotice(null);
      setBrowsing(true);
      lobby.open();
    },
    [lobby],
  );

  const joinFromLobby = useCallback(
    (code: string, player: PlayerSetupValues, hostName: string) => {
      // The row is a cache; the room decides. Hold it until we know which.
      setBusyCode(code);
      setJoiningHost(hostName);
      joinRoom(code, player);
    },
    [joinRoom],
  );

  const leaveOnline = useCallback(() => {
    remote.disconnect();
    setOnline(false);
  }, [remote]);

  const confirmQuit = useCallback(async () => {
    setQuitPhase('quitting');
    setShutdown(await requestShutdown());
  }, []);

  // Escape is the expected way out of a modal. Only while confirming — once the
  // shutdown is in flight there is nothing left to cancel.
  useEffect(() => {
    if (quitPhase !== 'confirming') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuitPhase('idle');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quitPhase]);

  if (shutdown) {
    return <QuitScreen outcome={shutdown} />;
  }

  const stoppable = canStopServer();

  const quitButton = (
    <button
      type="button"
      className="button button--ghost button--danger"
      onClick={stoppable ? () => setQuitPhase('confirming') : newGame}
    >
      {stoppable ? 'Quit' : 'Leave Game'}
    </button>
  );

  const quitDialog = quitPhase === 'idle' || !stoppable ? null : (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Quit game">
      <div className="panel overlay__panel">
        <p className="overlay__eyebrow">Quit</p>
        <h2 className="overlay__title">Stop the game server?</h2>
        <p className="quit-confirm__body">
          {state
            ? 'This ends the match in progress and shuts the server down. '
            : 'This closes the game and shuts the server down. '}
          Nothing will be running until someone starts it again with{' '}
          <code>npm run dev</code>.
        </p>
        {/* Cancel comes first and holds focus: for an irreversible action the
            safe choice should be the one reached by reflex, and the dangerous
            one should take deliberate effort to hit. */}
        <div className="overlay__actions">
          <button
            type="button"
            className="button"
            onClick={() => setQuitPhase('idle')}
            disabled={quitPhase === 'quitting'}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={confirmQuit}
            disabled={quitPhase === 'quitting'}
          >
            {quitPhase === 'quitting' ? 'Shutting down…' : 'Quit & Stop Server'}
          </button>
        </div>
      </div>
    </div>
  );

  if (browsing && !remote.seat) {
    return (
      <main className="app">
        <PublicLobby
          games={lobby.games.filter((game) => !deadCodes.includes(game.code))}
          status={lobby.status}
          busyCode={busyCode}
          notice={lobbyNotice}
          onJoin={(code, hostName) => browsePlayer && joinFromLobby(code, browsePlayer, hostName)}
          onStage={(options) => {
            if (!browsePlayer) return;
            // Being first in is fine — stage the game and wait right here.
            setBrowsing(false);
            lobby.close();
            createRoom(browsePlayer, options);
          }}
          onBack={() => {
            setBrowsing(false);
            lobby.close();
          }}
        />
      </main>
    );
  }

  if (online && !activeState) {
    return (
      <main className="app">
        <Lobby
          code={remote.code ?? '......'}
          status={remote.status}
          onCancel={leaveOnline}
          isHost={hosting}
          hostName={joiningHost}
          failure={remote.failure}
        />
      </main>
    );
  }

  if (!activeState) {
    return (
      <main className="app">
        <PlayerSetup
          initialPlayers={savedPlayers}
          onStart={startGame}
          onJoinRoom={joinRoom}
          onBrowseLobby={browseLobby}
          initialCode={linkedRoom}
          // Someone sent back from an online match belongs on the online tab,
          // not dropped into pass-and-play holding an explanation about a
          // player who is not there.
          initialMode={browsePlayer || matchEndedNotice ? 'online' : undefined}
          joinError={
            matchEndedNotice ??
            (remote.failure ? (JOIN_ERRORS[remote.failure] ?? 'Could not join.') : null)
          }
        />
        {/* Only offered when it can actually do something. In a deployed build
            this button means "leave the game", and on the setup screen there is
            no game to leave — it rendered as a dead control that did nothing.
            In local dev it still stops the dev server, which is meaningful here. */}
        {stoppable && <div className="app__footer">{quitButton}</div>}
        {quitDialog}
      </main>
    );
  }

  const current = activeState.players[activeState.currentPlayer];
  const isFinished = activeState.status === 'finished';
  // Local pass-and-play has no seat, so whoever is to move may always move.
  // Locally the mover is always "me" — except against the computer, where p2 is
  // the bot and the board must lock on its turn.
  const mySeat = online ? remote.seat : match?.bot ? 'p1' : activeState.currentPlayer;
  const isMyTurn = mySeat === activeState.currentPlayer;
  const opponentGone = online && remote.presence?.[mySeat === 'p1' ? 'p2' : 'p1'] !== 'connected';
  // Both overlays are aria-modal and carry their own actions. Leaving the
  // header buttons mounted underneath would duplicate New Game and Quit, and
  // leave them in the tab order behind a modal.
  const overlayOpen = isFinished || quitPhase !== 'idle';
  // Positive means p1 leads. "N edges left" told a new player nothing about
  // who was winning.
  const lead = activeState.players.p1.squares - activeState.players.p2.squares;

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Dots &amp; Squares</h1>
        {!overlayOpen && (
          <div className="app__header-actions">
            <button
              type="button"
              className="button button--ghost"
              aria-pressed={muted}
              // No aria-label: it would override the visible text and break
              // voice control, which needs the spoken name to match the label.
              onClick={() => {
                const next = !muted;
                setMuted(next);
                setMutedState(next);
              }}
            >
              {muted ? 'Sound off' : 'Sound on'}
            </button>
            {online ? (
              <>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={!!remote.drawOfferedBy}
                  onClick={remote.offerDraw}
                >
                  Offer Draw
                </button>
                <button
                  type="button"
                  className="button button--ghost button--danger"
                  onClick={remote.resign}
                >
                  Forfeit
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button button--ghost" onClick={newGame}>
                  New Game
                </button>
                {quitButton}
              </>
            )}
          </div>
        )}
      </header>

      <Scoreboard state={activeState} />

      <div
        className="turn-banner"
        style={{ '--player-color': PLAYER_THEME[activeState.currentPlayer].line } as React.CSSProperties}
        aria-live="polite"
      >
        {isFinished ? (
          <>
            {/* Only a filled board has "all lines played" — a forfeit, an
                agreed draw or a flag ends the game with the board unfinished. */}
            <span>
              {activeState.ending === 'board-complete'
                ? 'All lines played'
                : activeState.ending === 'resignation'
                  ? 'Forfeited'
                  : activeState.ending === 'timeout'
                    ? 'Out of time'
                    : 'Draw agreed'}
            </span>
            <span>
              {activeState.ending === 'board-complete'
                ? Object.keys(activeState.edges).length
                : `${remainingEdgeCount(activeState)} left`}
            </span>
          </>
        ) : (
          <>
            <span>
              {online && !isMyTurn ? (
                <>
                  Waiting for <strong>{current.username}</strong>
                </>
              ) : online ? (
                <>
                  <strong>Your turn</strong> — you are {activeState.players[mySeat!].initials}
                </>
              ) : chain > 0 ? (
                <>
                  <strong>{current.username}</strong> goes again
                </>
              ) : (
                <>
                  <strong>{current.username}</strong> to play
                </>
              )}
            </span>
            <span>
              {Object.values(activeState.squares).filter((sq) => sq.owner === null).length} squares
              left
              {lead !== 0 && (
                <>
                  {' · '}
                  <strong>
                    {activeState.players[lead > 0 ? 'p1' : 'p2'].initials} +{Math.abs(lead)}
                  </strong>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {chain >= 3 && !isFinished && (
        <div
          className={chain >= 8 ? 'chain chain--t3' : chain >= 5 ? 'chain chain--t2' : 'chain'}
          role="status"
          style={{ '--player-color': PLAYER_THEME[activeState.currentPlayer].line } as React.CSSProperties}
        >
          Chain &times;{chain}
        </div>
      )}

      <GameBoard
        showChains={showChains}
        sweepFor={
          celebrating && activeState.winner !== null && activeState.winner !== 'draw'
            ? activeState.winner
            : null
        }
        state={activeState}
        onSelectEdge={online ? remote.selectEdge : selectEdge}
        disabled={isFinished || !isMyTurn}
      />

      {online && remote.notice && (
        <p className="board__notice" role="status">
          {NOTICES[remote.notice] ?? 'That move was refused.'}
        </p>
      )}

      {online && opponentGone && !isFinished && (
        <p className="board__notice" role="status">
          {remote.presence?.[mySeat === 'p1' ? 'p2' : 'p1'] === 'empty'
            ? 'Waiting for the other player to join…'
            : 'The other player disconnected — waiting for them to come back.'}
          {/* On an untimed board their flag never falls, so without this the
              only way out of a game nobody is playing was to forfeit and take
              a recorded loss. Leaving is not the same thing as losing. */}
          <button type="button" className="button button--ghost" onClick={leaveOnline}>
            Leave game
          </button>
        </p>
      )}

      {online && remote.drawOfferedBy && remote.drawOfferedBy !== mySeat && !isFinished && (
        <div className="board__notice board__notice--offer" role="status">
          <span>{activeState.players[remote.drawOfferedBy].username} offers a draw.</span>
          <span className="setup__choices">
            <button type="button" className="button button--ghost" onClick={() => remote.respondDraw(true)}>
              Accept
            </button>
            <button type="button" className="button button--ghost" onClick={() => remote.respondDraw(false)}>
              Decline
            </button>
          </span>
        </div>
      )}

      {online && remote.drawDeclined && !isFinished && (
        <p className="board__notice" role="status">
          Your draw offer was declined.
        </p>
      )}

      {!isFinished && !online && match?.bot && !isMyTurn && (
        <p className="board__waiting" role="status">
          <span className="board__waiting-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Computer is thinking…
        </p>
      )}

      {!isFinished && online && !isMyTurn && !opponentGone && (
        <p className="board__waiting" role="status">
          <span className="board__waiting-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {current.username} is thinking…
        </p>
      )}

      {!isFinished && (
        <button
          type="button"
          className="button button--ghost board__peek"
          aria-pressed={showChains}
          onPointerDown={() => setShowChains(true)}
          onPointerUp={() => setShowChains(false)}
          onPointerLeave={() => setShowChains(false)}
        >
          Hold to see chains
        </button>
      )}

      {!isFinished && (online ? isMyTurn : !match?.bot || isMyTurn) && (
        <p className="board__hint">
          Tap a gap between two dots, or focus the board and use the arrow keys and Enter.
        </p>
      )}

      {isFinished && quitPhase === 'idle' && !celebrating && (
        <GameOverScreen
          state={activeState}
          viewerSeat={online ? remote.seat : match?.bot ? 'p1' : null}
          rematch={
            online && remote.seat
              ? {
                  mine: remote.rematchVotes[remote.seat],
                  theirs: remote.rematchVotes[remote.seat === 'p1' ? 'p2' : 'p1'],
                  opponentName:
                    activeState.players[remote.seat === 'p1' ? 'p2' : 'p1'].username,
                }
              : null
          }
          highlights={{
            ...highlightsRef.current,
            botDifficulty: match?.bot ?? null,
            series: online ? remote.series : null,
          }}
          onPlayAgain={online ? remote.requestRematch : playAgain}
          onNewGame={online ? leaveOnline : newGame}
          onQuit={online ? leaveOnline : () => setQuitPhase('confirming')}
        />
      )}

      {quitDialog}
    </main>
  );
}
