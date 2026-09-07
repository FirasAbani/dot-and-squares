import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyListing, LobbyServerMessage } from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/protocol';

export type LobbyStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface LobbyFeed {
  status: LobbyStatus;
  games: LobbyListing[];
  open(): void;
  close(): void;
  refresh(): void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Watches the public lobby. A deliberately smaller sibling of
 * `useRemoteSession` rather than a generalisation of it: browsing is anonymous,
 * read-only, and carries no seat, so sharing the session machinery would mean
 * carrying identity and reconnection semantics that do not apply.
 *
 * The server sends whole snapshots, so `games` is replaced outright every time
 * and there is no reconciliation to get wrong.
 */
export function useLobbyFeed(): LobbyFeed {
  const [status, setStatus] = useState<LobbyStatus>('idle');
  const [games, setGames] = useState<LobbyListing[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);

  const connect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    closedByUsRef.current = false;
    setStatus((current) => (current === 'reconnecting' ? current : 'connecting'));

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/api/lobby?v=${PROTOCOL_VERSION}`);
    socketRef.current = socket;

    socket.onopen = () => {
      attemptRef.current = 0;
      setStatus('open');
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as LobbyServerMessage;
        if (msg.t === 'lobby') setGames(msg.games);
      } catch {
        // A frame we cannot read is not worth tearing the feed down for.
      }
    };

    socket.onclose = () => {
      socketRef.current = null;
      if (closedByUsRef.current) return;
      const wait = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
      attemptRef.current += 1;
      setStatus('reconnecting');
      retryRef.current = setTimeout(connect, wait);
    };
  }, []);

  const close = useCallback(() => {
    // Idempotent on purpose: callers close from effects, and handing back a
    // fresh `games` array every time would re-render into an endless loop.
    if (closedByUsRef.current && !socketRef.current && !retryRef.current) return;
    closedByUsRef.current = true;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setStatus('idle');
    setGames((current) => (current.length === 0 ? current : []));
  }, []);

  const refresh = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'refresh' }));
  }, []);

  // A tab that slept may have missed broadcasts; ask for the list on return
  // rather than trusting whatever was on screen when it went away.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => close, [close]);

  return { status, games, open: connect, close, refresh };
}
