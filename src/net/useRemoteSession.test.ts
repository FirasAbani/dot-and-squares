import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '../test-utils/fakeSocket';
import { useRemoteSession } from './useRemoteSession';

const player = { username: 'Ada', initials: 'AL' };
const rooms = () => FakeWebSocket.instances.filter((s) => s.url.includes('/api/room/'));

describe('useRemoteSession', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const connect = () => {
    const { result } = renderHook(() => useRemoteSession());
    act(() => result.current.connect({ code: 'ABC234', player, create: true }));
    return result;
  };

  it('gives up on an upgrade that never opens and never closes', async () => {
    // A hung TCP connect produces neither event. Without a bound this renders
    // as an eternal spinner the player cannot tell from a crash.
    const result = connect();
    expect(result.current.status).toBe('connecting');

    act(() => void vi.advanceTimersByTime(15000));
    expect(result.current.status).toBe('closed');

    // The reason is asked of the room rather than guessed, so it lands a
    // microtask later than the status does.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.failure).toBeTruthy();
  });

  it('leaves a socket that opened alone', () => {
    const result = connect();
    act(() => FakeWebSocket.last().accept());
    act(() => void vi.advanceTimersByTime(60000));
    expect(result.current.status).toBe('open');
    expect(rooms()).toHaveLength(1);
  });

  it('still retries a drop after the connect timer has been armed', () => {
    const result = connect();
    act(() => FakeWebSocket.last().accept());
    // Ever-opened, so an unexpected close is a drop, not a refusal.
    act(() => FakeWebSocket.last().close(1006));
    expect(result.current.status).toBe('reconnecting');
    act(() => void vi.advanceTimersByTime(1000));
    expect(rooms()).toHaveLength(2);
  });

  it('does not retry an upgrade refused before it ever opened', () => {
    connect();
    act(() => FakeWebSocket.last().close(1006));
    act(() => void vi.advanceTimersByTime(20000));
    expect(rooms()).toHaveLength(1);
  });

  it('stops the timer when the player leaves, so a late fire cannot fake a failure', () => {
    const result = connect();
    act(() => result.current.disconnect());
    act(() => void vi.advanceTimersByTime(30000));
    expect(result.current.status).toBe('idle');
    expect(result.current.failure).toBeNull();
  });
});
