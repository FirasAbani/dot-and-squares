import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './Lobby';

function renderLobby(over: Partial<React.ComponentProps<typeof Lobby>> = {}) {
  const onCancel = vi.fn();
  render(<Lobby code="ABC234" status="connecting" onCancel={onCancel} {...over} />);
  return { onCancel };
}

afterEach(() => vi.useRealTimers());

describe('the waiting screen', () => {
  it('names the failure instead of spinning on Connecting…', () => {
    renderLobby({ status: 'closed', failure: 'room-closed' });
    expect(screen.getByRole('alert').textContent).toMatch(/no longer open/i);
    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.getByRole('heading', { name: /could not connect/i })).toBeTruthy();
  });

  it('does not offer a code or a copy button for a room that never opened', () => {
    renderLobby({ status: 'closed', failure: 'room-full' });
    expect(screen.queryByRole('button', { name: /Creating room|Copy link/ })).toBeNull();
    expect(screen.queryByText('······')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('falls back to a plain explanation when the reason is unknown', () => {
    renderLobby({ status: 'closed', failure: null });
    expect(screen.getByRole('alert').textContent).toMatch(/check your connection/i);
  });

  it('admits a slow connect rather than repeating Connecting…', () => {
    vi.useFakeTimers();
    renderLobby({ status: 'connecting' });
    expect(screen.getByRole('status').textContent).toContain('Connecting…');
    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByRole('status').textContent).toMatch(/taking longer/i);
  });

  it('says Copy link once the room is really open', () => {
    renderLobby({ status: 'open' });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText('ABC234')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/waiting for the other player/i);
  });

  it('tells a joiner they are joining, without the host&apos;s code', () => {
    renderLobby({ status: 'connecting', isHost: false, hostName: 'Grace' });
    expect(screen.getByRole('heading', { name: 'Joining' })).toBeTruthy();
    expect(screen.getByText(/taking a seat in grace's game/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy link|Creating room/ })).toBeNull();
  });
});
