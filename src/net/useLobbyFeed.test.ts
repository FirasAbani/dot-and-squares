import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '../test-utils/fakeSocket';
import type { LobbyListing } from '../shared/protocol';
import { useLobbyFeed } from './useLobbyFeed';

function listing(code: string, hostName = 'Ada'): LobbyListing {
  return {
    code,
    hostName,
    hostInitials: 'AL',
    gridSize: 5,
    timeControlMs: null,
    incrementMs: 0,
    createdAt: 1000,
  };
}

describe('useLobbyFeed', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks for the lobby at the protocol version it speaks', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    expect(FakeWebSocket.last().url).toContain('/api/lobby?v=2');
  });

  it('starts empty and fills from the first snapshot', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    expect(result.current.games).toEqual([]);

    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('AAA111')] });
    });
    expect(result.current.status).toBe('open');
    expect(result.current.games.map((game) => game.code)).toEqual(['AAA111']);
  });

  it('replaces the list wholesale rather than appending to it', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('AAA111'), listing('BBB222')] });
    });
    expect(result.current.games).toHaveLength(2);

    // A game filling means the next snapshot simply has fewer rows.
    act(() => FakeWebSocket.last().emit({ t: 'lobby', games: [listing('BBB222')] }));
    expect(result.current.games.map((game) => game.code)).toEqual(['BBB222']);
  });

  it('shrugs off a frame it cannot read', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'lobby', games: [listing('AAA111')] });
    });
    act(() => {
      FakeWebSocket.last().onmessage?.({ data: 'not json' } as MessageEvent);
    });
    expect(result.current.games).toHaveLength(1);
    expect(result.current.status).toBe('open');
  });

  it('ignores a message type it does not know', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => {
      FakeWebSocket.last().accept();
      FakeWebSocket.last().emit({ t: 'error', code: 'bad-message', message: 'nope' });
    });
    expect(result.current.games).toEqual([]);
  });

  it('retries after an unexpected close', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());

    act(() => FakeWebSocket.last().close(1006));
    expect(result.current.status).toBe('reconnecting');

    act(() => void vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stops retrying once the player walks away', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());

    act(() => result.current.close());
    expect(result.current.status).toBe('idle');
    expect(result.current.games).toEqual([]);

    act(() => void vi.advanceTimersByTime(60000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('asks for a fresh list when the tab comes back', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(FakeWebSocket.last().sent).toEqual([JSON.stringify({ t: 'refresh' })]);
  });

  it('does not shout into a socket that is not open', () => {
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => result.current.refresh());
    expect(FakeWebSocket.last().sent).toEqual([]);
  });

  it('can be closed repeatedly without handing back new state each time', () => {
    // An effect may call close() on every render; if it returned a fresh games
    // array each time, that render would loop forever.
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());
    act(() => result.current.close());
    const after = result.current.games;
    act(() => result.current.close());
    act(() => result.current.close());
    expect(result.current.games).toBe(after);
    expect(result.current.status).toBe('idle');
  });

  it('replaces a live feed rather than running two', () => {
    // Browse, get refused on a join, come back to the list: open() runs again
    // while a socket is already live. The orphan kept its onclose armed and
    // would quietly start a second, competing feed.
    vi.useFakeTimers();
    const { result } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());
    const first = FakeWebSocket.last();

    act(() => result.current.open());
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);

    act(() => void vi.advanceTimersByTime(20000));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('closes the socket when the screen goes away', () => {
    const { result, unmount } = renderHook(() => useLobbyFeed());
    act(() => result.current.open());
    act(() => FakeWebSocket.last().accept());
    const socket = FakeWebSocket.last();

    unmount();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
