import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID_SIZE,
  createDots,
  createEdges,
  createGame,
  createSquares,
  edgeIdBetweenDots,
  horizontalEdgeId,
  isEdgeAvailable,
  makeMove,
  agreeDraw,
  clampGridSize,
  MIN_GRID_SIZE,
  flagPlayer,
  hasFlagged,
  makeMoveBetweenDots,
  remainingEdgeCount,
  remainingMsFor,
  resign,
  startClock,
  SPEEDS,
  describeTimeControl,
  edgeCountFor,
  timeControlFor,
  squareId,
  verticalEdgeId,
} from './index';
import type { GameState } from './types';

const setupOne = { username: 'Ada', initials: 'AL' };
const setupTwo = { username: 'Grace', initials: 'GH' };

function newGame(gridSize = DEFAULT_GRID_SIZE): GameState {
  return createGame(setupOne, setupTwo, gridSize);
}

/** Applies moves in order, asserting each one is accepted. */
function play(state: GameState, edgeIds: string[]): GameState {
  return edgeIds.reduce((current, edgeId) => {
    const result = makeMove(current, edgeId);
    expect(result.ok, `expected ${edgeId} to be a legal move`).toBe(true);
    return result.state;
  }, state);
}

describe('board creation', () => {
  it('contains 100 dots', () => {
    expect(createDots()).toHaveLength(100);
  });

  it('contains 180 possible edges', () => {
    const edges = Object.values(createEdges());
    expect(edges).toHaveLength(180);
    expect(edges.filter((edge) => edge.orientation === 'horizontal')).toHaveLength(90);
    expect(edges.filter((edge) => edge.orientation === 'vertical')).toHaveLength(90);
  });

  it('contains 81 possible squares', () => {
    expect(Object.values(createSquares())).toHaveLength(81);
  });

  it('starts with every edge and square unowned', () => {
    const state = newGame();
    expect(Object.values(state.edges).every((edge) => edge.owner === null)).toBe(true);
    expect(Object.values(state.squares).every((square) => square.owner === null)).toBe(true);
    expect(state.players.p1.squares).toBe(0);
    expect(state.players.p2.squares).toBe(0);
    expect(state.status).toBe('playing');
    expect(state.currentPlayer).toBe('p1');
  });

  it('normalises initials to uppercase', () => {
    const state = createGame({ username: 'Ada', initials: 'al' }, setupTwo);
    expect(state.players.p1.initials).toBe('AL');
  });
});

describe('move validation', () => {
  it('accepts a horizontal move between adjacent dots', () => {
    const result = makeMoveBetweenDots(newGame(), { row: 0, column: 0 }, { row: 0, column: 1 });
    expect(result.ok).toBe(true);
    expect(result.state.edges[horizontalEdgeId(0, 0)].owner).toBe('p1');
  });

  it('accepts a vertical move between adjacent dots', () => {
    const result = makeMoveBetweenDots(newGame(), { row: 0, column: 0 }, { row: 1, column: 0 });
    expect(result.ok).toBe(true);
    expect(result.state.edges[verticalEdgeId(0, 0)].owner).toBe('p1');
  });

  it('accepts moves given in either dot order', () => {
    const result = makeMoveBetweenDots(newGame(), { row: 3, column: 4 }, { row: 3, column: 3 });
    expect(result.ok).toBe(true);
    expect(result.state.edges[horizontalEdgeId(3, 3)].owner).toBe('p1');
  });

  it('rejects diagonal moves', () => {
    const state = newGame();
    const result = makeMoveBetweenDots(state, { row: 0, column: 0 }, { row: 1, column: 1 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('not-adjacent');
    expect(result.state).toBe(state);
    expect(edgeIdBetweenDots({ row: 0, column: 0 }, { row: 1, column: 1 })).toBeNull();
  });

  it('rejects non-adjacent moves', () => {
    const result = makeMoveBetweenDots(newGame(), { row: 0, column: 0 }, { row: 0, column: 5 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('not-adjacent');
    expect(edgeIdBetweenDots({ row: 2, column: 2 }, { row: 2, column: 2 })).toBeNull();
  });

  it('rejects moves that fall outside the grid', () => {
    const result = makeMoveBetweenDots(newGame(), { row: 0, column: 9 }, { row: 0, column: 10 });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown edge ids', () => {
    const result = makeMove(newGame(), 'H-99-99');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('unknown-edge');
  });

  it('rejects duplicate moves and leaves the turn untouched', () => {
    const afterFirst = play(newGame(), [horizontalEdgeId(0, 0)]);
    expect(afterFirst.currentPlayer).toBe('p2');

    const duplicate = makeMove(afterFirst, horizontalEdgeId(0, 0));
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok === false && duplicate.reason).toBe('edge-taken');
    expect(duplicate.state.currentPlayer).toBe('p2');
    expect(duplicate.state.edges[horizontalEdgeId(0, 0)].owner).toBe('p1');
  });

  it('reports edge availability', () => {
    const state = newGame();
    expect(isEdgeAvailable(state, horizontalEdgeId(0, 0))).toBe(true);
    const afterMove = play(state, [horizontalEdgeId(0, 0)]);
    expect(isEdgeAvailable(afterMove, horizontalEdgeId(0, 0))).toBe(false);
    expect(isEdgeAvailable(afterMove, 'nope')).toBe(false);
  });

  it('does not mutate the previous state', () => {
    const state = newGame();
    const snapshot = JSON.stringify(state);
    makeMove(state, horizontalEdgeId(0, 0));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('turn management', () => {
  it('switches turns after a move that completes nothing', () => {
    const state = newGame();
    expect(state.currentPlayer).toBe('p1');
    const afterP1 = play(state, [horizontalEdgeId(0, 0)]);
    expect(afterP1.currentPlayer).toBe('p2');
    const afterP2 = play(afterP1, [horizontalEdgeId(5, 5)]);
    expect(afterP2.currentPlayer).toBe('p1');
  });

  it('awards a completed square to the current player and grants another turn', () => {
    // Three sides of square (0,0) drop on p1, p2, p1; p2 then closes it.
    const beforeClosing = play(newGame(), [
      horizontalEdgeId(0, 0), // p1
      verticalEdgeId(0, 0), // p2
      verticalEdgeId(0, 1), // p1
    ]);
    expect(beforeClosing.currentPlayer).toBe('p2');

    const closing = makeMove(beforeClosing, horizontalEdgeId(1, 0));
    expect(closing.ok).toBe(true);
    if (!closing.ok) return;

    expect(closing.claimedSquares).toEqual([squareId(0, 0)]);
    expect(closing.extraTurn).toBe(true);
    expect(closing.state.squares[squareId(0, 0)].owner).toBe('p2');
    expect(closing.state.players.p2.squares).toBe(1);
    expect(closing.state.players.p1.squares).toBe(0);
    expect(closing.state.currentPlayer).toBe('p2');
  });

  it('awards both squares when one move completes two', () => {
    // Box in squares (0,0) and (0,1) except for the shared edge V-0-1.
    const state = play(newGame(), [
      horizontalEdgeId(0, 0),
      horizontalEdgeId(1, 0),
      verticalEdgeId(0, 0),
      horizontalEdgeId(0, 1),
      horizontalEdgeId(1, 1),
      verticalEdgeId(0, 2),
      horizontalEdgeId(9, 0), // filler so the shared edge falls to p1
    ]);
    expect(state.currentPlayer).toBe('p2');

    const result = makeMove(state, verticalEdgeId(0, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.claimedSquares).toHaveLength(2);
    expect(result.claimedSquares).toEqual(
      expect.arrayContaining([squareId(0, 0), squareId(0, 1)]),
    );
    expect(result.state.players.p2.squares).toBe(2);
    expect(result.state.squares[squareId(0, 0)].owner).toBe('p2');
    expect(result.state.squares[squareId(0, 1)].owner).toBe('p2');
    expect(result.state.currentPlayer).toBe('p2');
  });
});

describe('game completion', () => {
  it('finishes once the final edge is played and picks the higher score', () => {
    // The smallest board is 3x3 dots: 12 edges, 4 squares.
    const edgeIds = Object.keys(createEdges(3));
    expect(edgeIds).toHaveLength(12);

    let state = play(newGame(3), edgeIds.slice(0, -1));
    expect(state.status).toBe('playing');
    expect(state.winner).toBeNull();

    const final = makeMove(state, edgeIds[edgeIds.length - 1]);
    expect(final.ok).toBe(true);
    if (!final.ok) return;

    state = final.state;
    expect(state.status).toBe('finished');
    expect(remainingEdgeCount(state)).toBe(0);
    expect(state.players.p1.squares + state.players.p2.squares).toBe(4);
    const { p1, p2 } = state.players;
    expect(state.winner).toBe(p1.squares === p2.squares ? 'draw' : p1.squares > p2.squares ? 'p1' : 'p2');
  });

  it('rejects moves once the game is finished', () => {
    let state = newGame(3);
    state = play(state, Object.keys(createEdges(3)));
    expect(state.status).toBe('finished');

    const result = makeMove(state, horizontalEdgeId(0, 0));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('game-over');
  });

  it('detects a draw when both players hold the same number of squares', () => {
    // 3x3 dots = 4 squares. p1 takes the top two, p2 takes the bottom two.
    const state = play(newGame(3), [
      // Eight opening moves, none of which closes a square.
      horizontalEdgeId(1, 0),
      horizontalEdgeId(1, 1),
      verticalEdgeId(0, 0),
      verticalEdgeId(0, 1),
      verticalEdgeId(0, 2),
      verticalEdgeId(1, 0),
      verticalEdgeId(1, 2),
      horizontalEdgeId(2, 0),
      // p1 closes both top squares, then plays a harmless edge and hands over.
      horizontalEdgeId(0, 0),
      horizontalEdgeId(0, 1),
      horizontalEdgeId(2, 1),
      // p2 closes both bottom squares with the final edge.
      verticalEdgeId(1, 1),
    ]);

    expect(state.status).toBe('finished');
    expect(state.players.p1.squares).toBe(2);
    expect(state.players.p2.squares).toBe(2);
    expect(state.winner).toBe('draw');
  });
});

/**
 * p1 leads 1-0 on a 3x3 board. p2's moves are deliberately far from the square
 * p1 is closing, so the parity works out with p1 playing the fourth side.
 */
function p1AheadByOne(): GameState {
  return play(newGame(3), [
    horizontalEdgeId(0, 0), // p1 - side 1
    horizontalEdgeId(2, 0), // p2 - filler
    verticalEdgeId(0, 0), // p1 - side 2
    horizontalEdgeId(2, 1), // p2 - filler
    verticalEdgeId(0, 1), // p1 - side 3
    verticalEdgeId(1, 0), // p2 - filler
    horizontalEdgeId(1, 0), // p1 - closes it, and keeps the turn
  ]);
}

describe('resigning and agreed draws', () => {
  it('makes the resigner lose even when they are ahead', () => {
    const ahead = p1AheadByOne();
    expect(ahead.players.p1.squares).toBe(1);
    expect(ahead.players.p2.squares).toBe(0);

    const state = resign(ahead, 'p1');

    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p2');
    expect(state.ending).toBe('resignation');
    expect(state.endedBy).toBe('p1');
    // The score is untouched — only the outcome changes.
    expect(state.players.p1.squares).toBe(1);
  });

  it('lets either player resign', () => {
    expect(resign(newGame(3), 'p2').winner).toBe('p1');
    expect(resign(newGame(3), 'p1').winner).toBe('p2');
  });

  it('records an agreed draw whatever the score', () => {
    const state = agreeDraw(p1AheadByOne());

    expect(state.status).toBe('finished');
    expect(state.winner).toBe('draw');
    expect(state.ending).toBe('agreed-draw');
    expect(state.endedBy).toBeNull();
  });

  it('ignores a resignation or draw once the game is over', () => {
    const finished = resign(newGame(3), 'p1');
    expect(resign(finished, 'p2')).toBe(finished);
    expect(agreeDraw(finished)).toBe(finished);
  });

  it('does not mutate the state it was given', () => {
    const before = newGame(3);
    const snapshot = JSON.stringify(before);
    resign(before, 'p1');
    agreeDraw(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('marks a completed board as board-complete', () => {
    const state = play(newGame(3), Object.keys(createEdges(3)));
    expect(state.status).toBe('finished');
    expect(state.ending).toBe('board-complete');
    expect(state.endedBy).toBeNull();
  });

  it('starts a game with no ending recorded', () => {
    expect(newGame().ending).toBeNull();
    expect(newGame().endedBy).toBeNull();
  });
});

describe('grid size limits', () => {
  it('clamps to between 3 and 10', () => {
    // 2 x 2 is a single square, so it is not offered.
    expect(clampGridSize(1)).toBe(3);
    expect(clampGridSize(2)).toBe(3);
    expect(clampGridSize(3)).toBe(3);
    expect(clampGridSize(7)).toBe(7);
    expect(clampGridSize(10)).toBe(10);
    expect(clampGridSize(25)).toBe(10);
  });

  it('never builds a board bigger than 10 x 10', () => {
    const huge = createGame(setupOne, setupTwo, 40);
    expect(huge.gridSize).toBe(10);
    expect(Object.keys(huge.edges)).toHaveLength(180);
  });

  it('builds a smaller board when asked', () => {
    const small = createGame(setupOne, setupTwo, 4);
    expect(small.gridSize).toBe(4);
    // 4x4 dots: 12 horizontal + 12 vertical edges, 9 squares.
    expect(Object.keys(small.edges)).toHaveLength(24);
    expect(Object.keys(small.squares)).toHaveLength(9);
  });
});

describe('the clock', () => {
  const TWO_MIN = 2 * 60_000;
  const timed = (gridSize = 3) => createGame(setupOne, setupTwo, gridSize, TWO_MIN);

  it('is absent unless a time control is given', () => {
    expect(newGame().clock).toBeNull();
    expect(remainingMsFor(newGame(), 'p1', 1000)).toBe(Infinity);
    expect(hasFlagged(newGame(), 1e12)).toBe(false);
  });

  it('gives both players the full allowance and does not run before the first move', () => {
    const state = timed();
    expect(state.clock?.remainingMs).toEqual({ p1: TWO_MIN, p2: TWO_MIN });
    expect(state.clock?.turnStartedAt).toBeNull();
    // No turn has started, so time does not tick.
    expect(remainingMsFor(state, 'p1', 999_999)).toBe(TWO_MIN);
  });

  it('counts down only the player to move', () => {
    const state = startClock(timed(), 1_000);
    expect(remainingMsFor(state, 'p1', 4_000)).toBe(TWO_MIN - 3_000);
    expect(remainingMsFor(state, 'p2', 4_000)).toBe(TWO_MIN);
  });

  it('charges the mover for the turn they spent and restarts for the next', () => {
    const started = startClock(timed(), 1_000);
    const result = makeMove(started, horizontalEdgeId(0, 0), 6_000);
    expect(result.ok).toBe(true);

    const after = result.state;
    expect(after.clock?.remainingMs.p1).toBe(TWO_MIN - 5_000);
    expect(after.clock?.remainingMs.p2).toBe(TWO_MIN);
    expect(after.clock?.turnStartedAt).toBe(6_000);
  });

  it("keeps the mover's own clock running when they claim a square and go again", () => {
    // p1 closes a square on the fourth move and keeps the turn.
    let state = startClock(timed(), 0);
    for (const [edgeId, at] of [
      [horizontalEdgeId(0, 0), 1_000],
      [horizontalEdgeId(2, 0), 2_000],
      [verticalEdgeId(0, 0), 3_000],
      [horizontalEdgeId(2, 1), 4_000],
      [verticalEdgeId(0, 1), 5_000],
      [verticalEdgeId(1, 0), 6_000],
      [horizontalEdgeId(1, 0), 7_000],
    ] as [string, number][]) {
      const result = makeMove(state, edgeId, at);
      expect(result.ok, edgeId).toBe(true);
      state = result.state;
    }

    expect(state.currentPlayer).toBe('p1'); // extra turn
    expect(state.clock?.turnStartedAt).toBe(7_000); // and their clock restarted
  });

  it('ignores the clock entirely when now is not passed', () => {
    const result = makeMove(startClock(timed(), 1_000), horizontalEdgeId(0, 0));
    expect(result.ok).toBe(true);
    expect(result.state.clock?.remainingMs.p1).toBe(TWO_MIN);
  });

  it('flags the player who ran out, and they lose regardless of score', () => {
    const state = flagPlayer(p1AheadByOne(), 'p1');
    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p2');
    expect(state.ending).toBe('timeout');
    expect(state.endedBy).toBe('p1');
    expect(state.players.p1.squares).toBe(1);
  });

  it('detects a fallen flag and refuses a late move', () => {
    const started = startClock(timed(), 0);
    expect(hasFlagged(started, TWO_MIN - 1)).toBe(false);
    expect(hasFlagged(started, TWO_MIN + 1)).toBe(true);

    const late = makeMove(started, horizontalEdgeId(0, 0), TWO_MIN + 5_000);
    expect(late.ok).toBe(false);
    expect(late.state.ending).toBe('timeout');
    expect(late.state.winner).toBe('p2');
  });

  it('never lets a balance go negative', () => {
    const started = startClock(timed(), 0);
    expect(remainingMsFor(started, 'p1', TWO_MIN * 10)).toBe(0);
  });
});

describe('blitz increment', () => {
  const THREE_MIN = 3 * 60_000;
  const INC = 2_000;
  const blitz = (gridSize = 3) => createGame(setupOne, setupTwo, gridSize, THREE_MIN, INC);

  it('records the increment on the clock', () => {
    expect(blitz().clock?.incrementMs).toBe(INC);
    expect(createGame(setupOne, setupTwo, 3, THREE_MIN).clock?.incrementMs).toBe(0);
  });

  it('credits the increment after charging the turn', () => {
    const started = startClock(blitz(), 1_000);
    // Five seconds spent, two credited back.
    const result = makeMove(started, horizontalEdgeId(0, 0), 6_000);
    expect(result.ok).toBe(true);
    expect(result.state.clock?.remainingMs.p1).toBe(THREE_MIN - 5_000 + INC);
  });

  it('leaves a player ahead when they move faster than the increment', () => {
    const started = startClock(blitz(), 0);
    // A one-second move on a two-second increment nets +1s.
    const result = makeMove(started, horizontalEdgeId(0, 0), 1_000);
    expect(result.state.clock?.remainingMs.p1).toBe(THREE_MIN + 1_000);
  });

  it('credits the increment on an extra turn too', () => {
    let state = startClock(blitz(), 0);
    const moves: [string, number][] = [
      [horizontalEdgeId(0, 0), 1_000],
      [horizontalEdgeId(2, 0), 2_000],
      [verticalEdgeId(0, 0), 3_000],
      [horizontalEdgeId(2, 1), 4_000],
      [verticalEdgeId(0, 1), 5_000],
      [verticalEdgeId(1, 0), 6_000],
      [horizontalEdgeId(1, 0), 7_000], // p1 closes a square and goes again
    ];
    for (const [edgeId, at] of moves) {
      const result = makeMove(state, edgeId, at);
      expect(result.ok, edgeId).toBe(true);
      state = result.state;
    }
    expect(state.currentPlayer).toBe('p1');
    // p1 made 4 moves of 1s each: -4s spent, +8s credited.
    expect(state.clock?.remainingMs.p1).toBe(THREE_MIN - 4_000 + 4 * INC);
  });

  it('never credits an increment to a player who has flagged', () => {
    const started = startClock(blitz(), 0);
    const late = makeMove(started, horizontalEdgeId(0, 0), THREE_MIN + 5_000);
    expect(late.ok).toBe(false);
    expect(late.state.ending).toBe('timeout');
    expect(late.state.clock?.remainingMs.p1).toBe(0);
  });

  it('counts the moves a board actually has', () => {
    expect(edgeCountFor(10)).toBe(180);
    expect(edgeCountFor(4)).toBe(24);
    expect(edgeCountFor(3)).toBe(12);
  });

  it('scales the clock to the board, so a speed feels the same on any size', () => {
    const blitz = SPEEDS.find((s) => s.id === 'blitz')!;
    // 10x10 is 90 moves each; 2s per move lands on the familiar chess 3+2.
    expect(timeControlFor(10, blitz)).toEqual({ ms: 180_000, incrementMs: 2_000 });
    // A quarter of the moves gets roughly a quarter of the clock.
    expect(timeControlFor(6, blitz)).toEqual({ ms: 60_000, incrementMs: 2_000 });
    expect(timeControlFor(4, blitz)).toEqual({ ms: 25_000, incrementMs: 2_000 });
  });

  it('keeps a per-move budget roughly constant across board sizes', () => {
    const blitz = SPEEDS.find((s) => s.id === 'blitz')!;
    for (const size of [4, 6, 8, 10]) {
      const c = timeControlFor(size, blitz);
      const moves = edgeCountFor(size) / 2;
      const perMove = (c.ms! + moves * c.incrementMs) / moves / 1000;
      // A fixed 3+2 swung from 17s to 4s per move across these sizes.
      expect(perMove).toBeGreaterThan(3.5);
      expect(perMove).toBeLessThan(5);
    }
  });

  it('never produces an unplayably short clock on a tiny board', () => {
    for (const speed of SPEEDS.filter((s) => s.id !== 'casual')) {
      expect(timeControlFor(MIN_GRID_SIZE, speed).ms).toBeGreaterThanOrEqual(15_000);
    }
  });

  it('gives every timed speed an increment', () => {
    for (const speed of SPEEDS.filter((s) => s.id !== 'casual')) {
      expect(speed.incrementMs).toBeGreaterThan(0);
    }
  });

  it('leaves Casual untimed', () => {
    const casual = SPEEDS.find((s) => s.id === 'casual')!;
    expect(timeControlFor(10, casual)).toEqual({ ms: null, incrementMs: 0 });
    expect(describeTimeControl(timeControlFor(10, casual))).toBe('No limit');
  });

  it('describes the clock in a form a chess player reads', () => {
    expect(describeTimeControl({ ms: 180_000, incrementMs: 2_000 })).toBe('3:00 + 2s');
    expect(describeTimeControl({ ms: 25_000, incrementMs: 2_000 })).toBe('0:25 + 2s');
    expect(describeTimeControl({ ms: 300_000, incrementMs: 0 })).toBe('5:00');
  });
});
