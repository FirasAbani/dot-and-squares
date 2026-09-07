import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LobbyListing } from '../shared/protocol';
import { PublicLobby } from './PublicLobby';

function listing(code: string, hostName: string, over: Partial<LobbyListing> = {}): LobbyListing {
  return {
    code,
    hostName,
    hostInitials: hostName.slice(0, 2).toUpperCase(),
    gridSize: 5,
    timeControlMs: null,
    incrementMs: 0,
    createdAt: 1000,
    ...over,
  };
}

function renderLobby(over: Partial<React.ComponentProps<typeof PublicLobby>> = {}) {
  const onJoin = vi.fn();
  const onStage = vi.fn();
  const onBack = vi.fn();
  render(
    <PublicLobby
      games={[]}
      status="open"
      busyCode={null}
      notice={null}
      onJoin={onJoin}
      onStage={onStage}
      onBack={onBack}
      {...over}
    />,
  );
  return { onJoin, onStage, onBack };
}

describe('the public lobby', () => {
  it('invites the player to stage one when nothing is open', () => {
    renderLobby();
    expect(screen.getByText(/no open games right now/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Join / })).toBeNull();
  });

  it('does not claim the lobby is empty while it is still loading', () => {
    renderLobby({ status: 'connecting' });
    expect(screen.queryByText(/no open games right now/i)).toBeNull();
    expect(screen.getByText(/loading open games/i)).toBeTruthy();
  });

  it('shows a row per open game, with its host, board and clock', () => {
    renderLobby({
      games: [
        listing('AAA111', 'Ada'),
        listing('BBB222', 'Grace', { gridSize: 4, timeControlMs: 60000, incrementMs: 2000 }),
      ],
    });
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.getByText(/5 × 5 dots · 16 squares/)).toBeTruthy();
    expect(screen.getByText(/4 × 4 dots · 9 squares/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Join / })).toHaveLength(2);
    // Each row names its host, so a screen-reader list is not N identical buttons.
    expect(screen.getByRole('button', { name: "Join Ada's game" })).toBeTruthy();
  });

  it('counts the waiting games for a screen reader', () => {
    renderLobby({ games: [listing('AAA111', 'Ada')] });
    expect(screen.getByRole('status').textContent).toBe('1 game waiting');
  });

  it('joins the game whose button was pressed', async () => {
    const { onJoin } = renderLobby({
      games: [listing('AAA111', 'Ada'), listing('BBB222', 'Grace')],
    });
    await userEvent.click(screen.getByRole('button', { name: "Join Grace's game" }));
    // The host's name rides along so the joining screen can name whose game it is.
    expect(onJoin).toHaveBeenCalledWith('BBB222', 'Grace');
  });

  it('holds every row while one join is in flight, so a double tap cannot open two', () => {
    renderLobby({
      games: [listing('AAA111', 'Ada'), listing('BBB222', 'Grace')],
      busyCode: 'AAA111',
    });
    // The pressed row keeps focus and announces itself busy...
    const pressed = screen.getByRole('button', { name: "Join Ada's game" });
    expect(pressed.getAttribute('aria-busy')).toBe('true');
    expect((pressed as HTMLButtonElement).disabled).toBe(false);
    // ...while every other row is held, so a second click cannot open a socket.
    expect(
      (screen.getByRole('button', { name: "Join Grace's game" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('explains a game that filled before the click landed', () => {
    renderLobby({ notice: 'That game just filled — pick another.' });
    expect(screen.getByRole('alert').textContent).toContain('That game just filled');
  });

  it('says when the lobby connection dropped', () => {
    renderLobby({ status: 'reconnecting' });
    expect(screen.getByRole('status').textContent).toMatch(/reconnecting/i);
  });

  it('lets the first player in start a game instead of dead-ending', async () => {
    const { onStage } = renderLobby();
    expect(screen.getByText(/start one and you will be first in/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start a Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(onStage).toHaveBeenCalled();
  });

  it('still offers to start one when other games are already listed', async () => {
    const { onStage } = renderLobby({ games: [listing('AAA111', 'Ada')] });
    await userEvent.click(screen.getByRole('button', { name: 'Start a Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(onStage).toHaveBeenCalled();
  });

  it('holds the start button while a join is in flight', () => {
    renderLobby({ games: [listing('AAA111', 'Ada')], busyCode: 'AAA111' });
    expect(
      (screen.getByRole('button', { name: 'Start a Game' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  /**
   * The board, the clock and who can join were all asked on the setup screen
   * before anyone had decided to host. They are asked here now, at the moment a
   * game is actually staged — and the choice has to reach the caller.
   */
  it('asks for the board, the clock and who can join before staging', async () => {
    const { onStage } = renderLobby();
    await userEvent.click(screen.getByRole('button', { name: 'Start a Game' }));

    expect(screen.getByRole('heading', { name: /start a game/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Board/), { target: { value: '7' } });
    await userEvent.click(screen.getByRole('button', { name: /Private/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));

    expect(onStage).toHaveBeenCalledWith(
      expect.objectContaining({ gridSize: 7, visibility: 'private' }),
    );
  });

  it('defaults a staged game to public, so the lobby it was started from fills', async () => {
    const { onStage } = renderLobby();
    await userEvent.click(screen.getByRole('button', { name: 'Start a Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Game' }));

    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }));
  });

  it('lets the player back out of staging to the list', async () => {
    const { onStage, onBack } = renderLobby({ games: [listing('AAA111', 'Ada')] });
    await userEvent.click(screen.getByRole('button', { name: 'Start a Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Back to the list, not out of the lobby altogether.
    expect(screen.getByRole('heading', { name: /open games/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Join Ada's game" })).toBeTruthy();
    expect(onStage).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('offers a way back', async () => {
    const { onBack } = renderLobby();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});
