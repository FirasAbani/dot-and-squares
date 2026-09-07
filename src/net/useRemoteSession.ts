import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId, PlayerSetup } from '../engine';
import type {
  ClientMessage,
  JoinFailure,
  Presence,
  RejectionReason,
  RematchVotes,
  RoomVisibility,
  Series,
  ServerMessage,
} from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { fetchRoomInfo, seatToken } from './roomCode';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RemoteSession {
  status: ConnectionStatus;
  code: string | null;
  seat: PlayerId | null;
  state: GameState | null;
  presence: Presence | null;
  rematchVotes: RematchVotes;
  drawOfferedBy: PlayerId | null;
  drawDeclined: boolean;
  /** Set when a rematch offer expired unanswered; the match is over. */
  rematchExpired: boolean;
  series: Series | null;
  failure: JoinFailure | null;
  notice: RejectionReason | null;
  connect(options: ConnectOptions): void;
  disconnect(): void;
  selectEdge(edgeId: string): void;
  resign(): void;
  offerDraw(): void;
  respondDraw(accept: boolean): void;
  requestRematch(): void;
  clearNotice(): void;
}

export interface ConnectOptions {
  code: string;
  player: PlayerSetup;
  create: boolean;
  gridSize?: number;
  timeControlMs?: number | null;
  incrementMs?: number;
  /** Only meaningful when creating; a joiner never sets the room's visibility. */
  visibility?: RoomVisibility;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * A connect that yields neither an open nor a close is hanging. Generous, so a
 * cold Durable Object is never mistaken for a failure — the happy path measures
 * well under two seconds — but bounded, because an unbounded wait renders as an
 * eternal spinner the player cannot tell from a crash.
 */
const CONNECT_TIMEOUT_MS = 15000;

export function useRemoteSession(): RemoteSession {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [rematchVotes, setRematchVotes] = useState<RematchVotes>({ p1: false, p2: false });
  const [drawOfferedBy, setDrawOfferedBy] = useState<PlayerId | null>(null);
  const [drawDeclined, setDrawDeclined] = useState(false);
  const [rematchExpired, setRematchExpired] = useState(false);
  const [series, setSeries] = useState<Series | null>(null);
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [notice, setNotice] = useState<RejectionReason | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef<ConnectOptions | null>(null);
  const seqRef = useRef(0);
  const attemptRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the user deliberately leaves, so we do not reconnect afterwards.
  const closedByUsRef = useRef(false);
  /**
   * Whether this session ever got past the handshake. A refused join is an HTTP
   * 4xx with no 101, which the browser reports as a plain 1006 close — the same
   * code a dropped network gives. Having opened at least once is what tells the
   * two apart: never opened means the server said no, and retrying is pointless.
   */
  const everOpenedRef = useRef(false);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  const apply = useCallback((msg: ServerMessage) => {
    switch (msg.t) {
      case 'welcome':
        setSeat(msg.seat);
        setCode(msg.code);
        setPresence(msg.presence);
        setRematchVotes(msg.rematch);
        setDrawOfferedBy(msg.drawOfferedBy);
        setSeries(msg.series);
        if (msg.state) setState(msg.state);
        seqRef.current = msg.seq;
        break;
      case 'state':
        setState(msg.state);
        setSeries(msg.series);
        seqRef.current = msg.seq;
        setDrawOfferedBy(null);
        setDrawDeclined(false);
        if (msg.reason === 'rematch' || msg.reason === 'start') {
          setRematchVotes({ p1: false, p2: false });
        }
        break;
      case 'presence':
        setPresence(msg.presence);
        break;
      case 'rematch':
        setRematchVotes(msg.votes);
        break;
      case 'rematch-timeout':
        setRematchVotes({ p1: false, p2: false });
        setRematchExpired(true);
        break;
      case 'draw-offered':
        setDrawOfferedBy(msg.by);
        break;
      case 'draw-declined':
        setDrawDeclined(true);
        break;
      case 'rejected':
        setNotice(msg.reason);
        break;
      case 'error':
        setNotice('no-game');
        break;
    }
  }, []);

  const open = useCallback(
    (options: ConnectOptions, isRetry: boolean) => {
      optionsRef.current = options;
      closedByUsRef.current = false;
      if (!isRetry) everOpenedRef.current = false;
      setStatus(isRetry ? 'reconnecting' : 'connecting');
      setFailure(null);

      const params = new URLSearchParams({
        v: String(PROTOCOL_VERSION),
        token: seatToken(options.code),
        u: options.player.username,
        i: options.player.initials,
      });
      // Only the creator's first attempt claims the room; a retry must not, or
      // the reconnect would collide with the room it just made.
      if (options.create && !isRetry) params.set('create', '1');
      // Rides with `create` for the same reason: only the first attempt stages
      // the room, so only the first attempt may declare it public.
      if (options.create && !isRetry && options.visibility === 'public') params.set('pub', '1');
      if (options.gridSize !== undefined) params.set('grid', String(options.gridSize));
      if (options.timeControlMs !== undefined) {
        params.set('time', options.timeControlMs === null ? '' : String(options.timeControlMs));
      }
      if (options.incrementMs !== undefined) params.set('inc', String(options.incrementMs));

      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(
        `${scheme}://${location.host}/api/room/${options.code}?${params}`,
      );
      socketRef.current = socket;

      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      connectTimerRef.current = setTimeout(() => {
        connectTimerRef.current = null;
        if (socketRef.current !== socket || socket.readyState === WebSocket.OPEN) return;
        // Closing by hand turns a silent stall into the onclose we already know
        // how to explain. A socket closed while still CONNECTING does not
        // reliably deliver onclose, so a first attempt says so itself.
        socket.close();
        if (socketRef.current === socket && !everOpenedRef.current) {
          socketRef.current = null;
          setStatus('closed');
          setFailure('room-closed');
        }
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        attemptRef.current = 0;
        everOpenedRef.current = true;
        if (connectTimerRef.current) {
          clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }
        setStatus('open');
      };

      socket.onmessage = (event) => {
        try {
          apply(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          // A frame we cannot read is not worth tearing the session down for.
        }
      };

      socket.onclose = (event) => {
        if (connectTimerRef.current) {
          clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }
        socketRef.current = null;
        if (closedByUsRef.current) {
          setStatus('closed');
          return;
        }
        // A room the server closed under us.
        if (event.code === 1001) {
          setFailure('room-closed');
          setStatus('closed');
          return;
        }
        // Closed without ever opening: the upgrade was refused. The status code
        // is not visible to the WebSocket API, so ask the room why — and if even
        // that cannot be reached, say the room has gone rather than retrying
        // into a refusal that will never change.
        if (!everOpenedRef.current) {
          setStatus('closed');
          void fetchRoomInfo(options.code)
            .then((info) => {
              if (!info) return setFailure('room-closed');
              if (!info.exists) return setFailure(options.create ? 'bad-code' : 'room-closed');
              return setFailure(info.full || info.inProgress ? 'room-full' : 'room-exists');
            })
            .catch(() => setFailure('room-closed'));
          return;
        }
        const wait = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
        attemptRef.current += 1;
        setStatus('reconnecting');
        retryRef.current = setTimeout(() => {
          const current = optionsRef.current;
          if (current) open(current, true);
        }, wait);
      };
    },
    [apply],
  );

  const connect = useCallback(
    (options: ConnectOptions) => {
      attemptRef.current = 0;
      setCode(options.code);
      open(options, false);
    },
    [open],
  );

  const disconnect = useCallback(() => {
    closedByUsRef.current = true;
    if (retryRef.current) clearTimeout(retryRef.current);
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    send({ t: 'leave' });
    socketRef.current?.close();
    socketRef.current = null;
    optionsRef.current = null;
    setStatus('idle');
    setState(null);
    setSeat(null);
    setCode(null);
    setPresence(null);
    setRematchExpired(false);
    // Otherwise the next screen renders the error from the session just ended.
    setFailure(null);
  }, [send]);

  useEffect(
    () => () => {
      closedByUsRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      socketRef.current?.close();
    },
    [],
  );

  return {
    status,
    code,
    seat,
    state,
    presence,
    rematchVotes,
    drawOfferedBy,
    drawDeclined,
    rematchExpired,
    series,
    failure,
    notice,
    connect,
    disconnect,
    selectEdge: useCallback(
      (edgeId: string) => send({ t: 'move', edgeId, seq: seqRef.current }),
      [send],
    ),
    resign: useCallback(() => send({ t: 'resign' }), [send]),
    offerDraw: useCallback(() => send({ t: 'offer-draw' }), [send]),
    respondDraw: useCallback((accept: boolean) => send({ t: 'respond-draw', accept }), [send]),
    requestRematch: useCallback(() => send({ t: 'rematch', want: true }), [send]),
    clearNotice: useCallback(() => setNotice(null), []),
  };
}
