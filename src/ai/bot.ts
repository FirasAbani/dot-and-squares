/**
 * A computer opponent.
 *
 * Pure and dependency-free like the engine it sits on: no React, no DOM, and
 * no `Math.random` — randomness is injected so a test can seed it and get the
 * same game every time.
 *
 * The engine exposes everything needed except a notion of a *safe* move, which
 * is derived here from the two board primitives `edgeIdsForSquare` and
 * `squareIdsTouchingEdge`.
 */
import { edgeIdsForSquare, squareIdsTouchingEdge } from '../engine';
import type { Edge, GameState } from '../engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotProfile {
  id: Difficulty;
  label: string;
  blurb: string;
}

export const DIFFICULTIES: BotProfile[] = [
  { id: 'easy', label: 'Easy', blurb: 'Plays anywhere' },
  { id: 'medium', label: 'Medium', blurb: 'Takes free boxes' },
  { id: 'hard', label: 'Hard', blurb: 'Plays the chains' },
];

/** Every edge nobody has claimed yet. */
export function openEdges(state: GameState): Edge[] {
  return Object.values(state.edges).filter((edge) => edge.owner === null);
}

/** How many of a square's four sides are already drawn. */
function sidesOwned(state: GameState, squareId: string): number {
  const square = state.squares[squareId];
  if (!square) return 0;
  return edgeIdsForSquare(square.row, square.column).filter(
    (edgeId) => state.edges[edgeId]?.owner !== null,
  ).length;
}

/** Squares this edge would complete right now. */
function completes(state: GameState, edge: Edge): string[] {
  return squareIdsTouchingEdge(edge, state.gridSize).filter(
    (id) => state.squares[id] && state.squares[id].owner === null && sidesOwned(state, id) === 3,
  );
}

/**
 * A move that hands nothing over: after playing it, no square sits on exactly
 * three sides, so the opponent cannot take anything.
 */
export function isSafe(state: GameState, edge: Edge): boolean {
  return squareIdsTouchingEdge(edge, state.gridSize).every((id) => {
    const square = state.squares[id];
    if (!square || square.owner !== null) return true;
    // Playing this edge adds one side. Landing on three is the gift.
    return sidesOwned(state, id) + 1 !== 3;
  });
}

/**
 * Size of the run the opponent could take if we open here — how many boxes
 * cascade from this sacrifice. Walking it lets Hard give away the cheapest one.
 */
export function sacrificeCost(state: GameState, edge: Edge): number {
  const owned = new Set<string>();
  // Squares this move would put on three sides: the entry points of the run.
  const queue = squareIdsTouchingEdge(edge, state.gridSize).filter((id) => {
    const square = state.squares[id];
    return square && square.owner === null && sidesOwned(state, id) + 1 === 3;
  });

  let cost = 0;
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (owned.has(id)) continue;
    owned.add(id);
    cost += 1;

    // Taking that box opens its neighbours through the sides still missing.
    const square = state.squares[id];
    if (!square) continue;
    for (const edgeId of edgeIdsForSquare(square.row, square.column)) {
      const candidate = state.edges[edgeId];
      if (!candidate || candidate.owner !== null || candidate.id === edge.id) continue;
      for (const neighbourId of squareIdsTouchingEdge(candidate, state.gridSize)) {
        const neighbour = state.squares[neighbourId];
        if (!neighbour || neighbour.owner !== null || owned.has(neighbourId)) continue;
        if (sidesOwned(state, neighbourId) >= 2) queue.push(neighbourId);
      }
    }
  }
  return cost;
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

/**
 * Chooses a legal move. Never returns a claimed edge, and always returns
 * something while the game is playable.
 */
export function chooseMove(
  state: GameState,
  difficulty: Difficulty,
  rand: () => number = Math.random,
): string | null {
  const open = openEdges(state);
  if (open.length === 0 || state.status !== 'playing') return null;

  if (difficulty === 'easy') return pick(open, rand).id;

  // Free boxes are never a mistake — and claiming grants another turn.
  const captures = open.filter((edge) => completes(state, edge).length > 0);
  if (captures.length > 0) {
    // Prefer a double capture when one is going.
    const best = Math.max(...captures.map((edge) => completes(state, edge).length));
    return pick(
      captures.filter((edge) => completes(state, edge).length === best),
      rand,
    ).id;
  }

  const safe = open.filter((edge) => isSafe(state, edge));
  if (safe.length > 0) return pick(safe, rand).id;

  // Everything left is a sacrifice. Medium shrugs; Hard gives away the least.
  if (difficulty === 'medium') return pick(open, rand).id;

  let cheapest = open;
  let cheapestCost = Infinity;
  for (const edge of open) {
    const cost = sacrificeCost(state, edge);
    if (cost < cheapestCost) {
      cheapestCost = cost;
      cheapest = [edge];
    } else if (cost === cheapestCost) {
      cheapest.push(edge);
    }
  }
  return pick(cheapest, rand).id;
}

export interface PositionAnalysis {
  /** Edges that hand nothing to the opponent. */
  safeEdgeIds: string[];
  /** For each unsafe edge, how many boxes opening it would give away. */
  cost: Record<string, number>;
}

/**
 * Renders the analysis a strong player already does in their head: which moves
 * are safe, and how expensive each sacrifice is. Pure — no rules change, it
 * only reveals what the position already contains.
 */
export function analysePosition(state: GameState): PositionAnalysis {
  const safeEdgeIds: string[] = [];
  const cost: Record<string, number> = {};
  for (const edge of openEdges(state)) {
    if (completes(state, edge).length > 0) continue;
    if (isSafe(state, edge)) safeEdgeIds.push(edge.id);
    else cost[edge.id] = sacrificeCost(state, edge);
  }
  return { safeEdgeIds, cost };
}
