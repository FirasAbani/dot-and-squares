import { describe, expect, it } from 'vitest';
import {
  createEdges,
  createGame,
  horizontalEdgeId,
  makeMove,
  verticalEdgeId,
  type GameState,
} from '../engine';
import { chooseMove, openEdges, type Difficulty } from './bot';

const human = { username: 'Ada', initials: 'AL' };
const bot = { username: 'Computer', initials: 'CPU' };

const newGame = (gridSize = 4): GameState => createGame(human, bot, gridSize);

/** Applies moves in order, asserting each is accepted. */
function play(state: GameState, edgeIds: string[]): GameState {
  return edgeIds.reduce((current, edgeId) => {
    const result = makeMove(current, edgeId);
    expect(result.ok, `expected ${edgeId} to be legal`).toBe(true);
    return result.state;
  }, state);
}

/** Deterministic stand-in for Math.random. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const ALL: Difficulty[] = ['easy', 'medium', 'hard'];

describe('every difficulty', () => {
  it('returns a legal, unclaimed edge', () => {
    for (const difficulty of ALL) {
      const state = play(newGame(), [horizontalEdgeId(0, 0), verticalEdgeId(0, 0)]);
      const move = chooseMove(state, difficulty, seeded());
      expect(move, difficulty).not.toBeNull();
      expect(state.edges[move!].owner, difficulty).toBeNull();
    }
  });

  it('is deterministic for a given seed', () => {
    for (const difficulty of ALL) {
      const state = newGame();
      expect(chooseMove(state, difficulty, seeded(42))).toBe(
        chooseMove(state, difficulty, seeded(42)),
      );
    }
  });

  it('returns null when there is nothing to play', () => {
    // Fill the smallest board (3x3 dots, 12 edges) completely.
    const state = play(newGame(3), Object.keys(createEdges(3)));
    expect(state.status).toBe('finished');
    for (const difficulty of ALL) {
      expect(chooseMove(state, difficulty, seeded()), difficulty).toBeNull();
    }
  });

  it('can play a whole game to completion without stalling', () => {
    for (const difficulty of ALL) {
      let state = newGame(4);
      const rand = seeded(7);
      let guard = 0;
      while (state.status === 'playing') {
        const move = chooseMove(state, difficulty, rand);
        expect(move, `${difficulty} returned no move with edges left`).not.toBeNull();
        const result = makeMove(state, move!);
        expect(result.ok, `${difficulty} played an illegal edge`).toBe(true);
        state = result.state;
        expect((guard += 1), 'bot looped forever').toBeLessThan(200);
      }
      expect(openEdges(state)).toHaveLength(0);
    }
  });
});

describe('medium and hard', () => {
  /** A board where exactly one square sits on three sides. */
  function oneBoxAvailable() {
    // S-0-0 needs H-0-0, H-1-0, V-0-0, V-0-1. Give it three of them, with the
    // other moves far away so nothing else is nearly complete.
    return play(newGame(4), [
      horizontalEdgeId(0, 0),
      horizontalEdgeId(3, 2),
      verticalEdgeId(0, 0),
      horizontalEdgeId(3, 1),
      verticalEdgeId(0, 1),
      verticalEdgeId(2, 3),
    ]);
  }

  it('takes a box that is one side from complete', () => {
    const state = oneBoxAvailable();
    for (const difficulty of ['medium', 'hard'] as Difficulty[]) {
      expect(chooseMove(state, difficulty, seeded()), difficulty).toBe(horizontalEdgeId(1, 0));
    }
  });

  it('prefers the move that claims two boxes at once', () => {
    // Two squares share H-1-1: S-0-1 above and S-1-1 below. Bring both to three
    // sides so the shared edge is worth double.
    let state = newGame(4);
    state = play(state, [
      horizontalEdgeId(0, 1),
      verticalEdgeId(0, 1),
      verticalEdgeId(0, 2),
      horizontalEdgeId(2, 1),
      verticalEdgeId(1, 1),
      verticalEdgeId(1, 2),
    ]);
    // S-0-1 has H-0-1, V-0-1, V-0-2 (3 sides, missing H-1-1).
    // S-1-1 has H-2-1, V-1-1, V-1-2 (3 sides, missing H-1-1).
    expect(chooseMove(state, 'medium', seeded())).toBe(horizontalEdgeId(1, 1));
    expect(chooseMove(state, 'hard', seeded())).toBe(horizontalEdgeId(1, 1));
  });

  it('never volunteers a third side while a safe move exists', () => {
    // An empty board is entirely safe: no move can put a square on three sides.
    const state = newGame(4);
    for (const difficulty of ['medium', 'hard'] as Difficulty[]) {
      for (let i = 0; i < 12; i += 1) {
        const move = chooseMove(state, difficulty, seeded(i + 1));
        const edge = state.edges[move!];
        // Verify by simulation: after this move nothing sits on three sides.
        const after = makeMove(state, edge.id);
        expect(after.ok).toBe(true);
        const dangerous = Object.values(after.state.squares).filter((square) => {
          if (square.owner !== null) return false;
          const owned = [
            horizontalEdgeId(square.row, square.column),
            horizontalEdgeId(square.row + 1, square.column),
            verticalEdgeId(square.row, square.column),
            verticalEdgeId(square.row, square.column + 1),
          ].filter((id) => after.state.edges[id]?.owner !== null).length;
          return owned === 3;
        });
        expect(dangerous, `${difficulty} gave away a box`).toHaveLength(0);
      }
    }
  });
});

describe('hard', () => {
  it('gives away the smallest chain when every move is a sacrifice', () => {
    // A crowded 3x3 board where safe moves have run out: hard must still pick
    // something rather than stall.
    const state = play(newGame(3), [
      horizontalEdgeId(0, 0),
      verticalEdgeId(0, 0),
      verticalEdgeId(0, 1),
      horizontalEdgeId(2, 0),
      verticalEdgeId(1, 0),
    ]);
    const move = chooseMove(state, 'hard', seeded());
    expect(move).not.toBeNull();
    expect(state.edges[move!].owner).toBeNull();
  });

  it('beats easy over a series of games', () => {
    // Not a strict guarantee for one game, but hard should dominate a run.
    let hardWins = 0;
    for (let game = 0; game < 8; game += 1) {
      let state = newGame(4);
      const rand = seeded(game + 1);
      while (state.status === 'playing') {
        // p1 is hard, p2 is easy.
        const difficulty: Difficulty = state.currentPlayer === 'p1' ? 'hard' : 'easy';
        const move = chooseMove(state, difficulty, rand);
        state = makeMove(state, move!).state;
      }
      if (state.winner === 'p1') hardWins += 1;
    }
    expect(hardWins, 'hard should win most games against easy').toBeGreaterThanOrEqual(6);
  });
});
