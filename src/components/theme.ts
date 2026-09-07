import type { PlayerId } from '../engine';

export interface PlayerTheme {
  line: string;
  fill: string;
  text: string;
  soft: string;
  /**
   * Stroke pattern for claimed lines. Colour alone must never carry meaning
   * (WCAG 1.4.1), and a claimed line has no text on it to fall back to — so the
   * two players also differ in line style. Blue/amber is used instead of
   * blue/red because red and blue are the pair most often confused.
   */
  dash?: string;
  /** Spoken/label form of the same distinction, for screen readers. */
  pattern: string;
}

/**
 * Tuned for the dark board (#16171a). Every value here is measured — see the
 * contrast notes in README: lines clear 3:1 against the board, initials clear
 * 4.5:1 against their own claimed square.
 */
export const PLAYER_THEME: Record<PlayerId, PlayerTheme> = {
  p1: {
    line: '#5b9cff',
    fill: 'rgba(91, 156, 255, 0.22)',
    text: '#bcd5ff',
    soft: '#2f5fa8',
    pattern: 'solid',
  },
  p2: {
    line: '#ffb020',
    fill: 'rgba(255, 176, 32, 0.22)',
    text: '#ffd88a',
    soft: '#a06b12',
    dash: '9 5',
    pattern: 'dashed',
  },
};

/** Board furniture that isn't owned by a player. */
export const BOARD_THEME = {
  /** Unclaimed lines are the tap targets, so they hold 3:1 on the board. */
  open: '#696c73',
  dot: '#8a8d94',
  background: '#16171a',
  /** The keyboard cursor has to be light here — a dark ring would vanish. */
  cursor: '#ffffff',
};
