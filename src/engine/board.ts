import type { Dot, Edge, Square } from './types';

export const DEFAULT_GRID_SIZE = 10;

/**
 * The board never exceeds 10 x 10 dots. 3 x 3 is the floor: a 2 x 2 grid is a
 * single square and there is no game in it.
 */
export const MIN_GRID_SIZE = 3;
export const MAX_GRID_SIZE = 10;

export function clampGridSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_GRID_SIZE;
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(size)));
}

export function horizontalEdgeId(row: number, column: number): string {
  return `H-${row}-${column}`;
}

export function verticalEdgeId(row: number, column: number): string {
  return `V-${row}-${column}`;
}

export function squareId(row: number, column: number): string {
  return `S-${row}-${column}`;
}

export function createDots(gridSize = DEFAULT_GRID_SIZE): Dot[] {
  const dots: Dot[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++) {
      dots.push({ row, column });
    }
  }
  return dots;
}

export function createEdges(gridSize = DEFAULT_GRID_SIZE): Record<string, Edge> {
  const edges: Record<string, Edge> = {};

  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize - 1; column++) {
      const id = horizontalEdgeId(row, column);
      edges[id] = { id, orientation: 'horizontal', row, column, owner: null };
    }
  }

  for (let row = 0; row < gridSize - 1; row++) {
    for (let column = 0; column < gridSize; column++) {
      const id = verticalEdgeId(row, column);
      edges[id] = { id, orientation: 'vertical', row, column, owner: null };
    }
  }

  return edges;
}

export function createSquares(gridSize = DEFAULT_GRID_SIZE): Record<string, Square> {
  const squares: Record<string, Square> = {};
  for (let row = 0; row < gridSize - 1; row++) {
    for (let column = 0; column < gridSize - 1; column++) {
      const id = squareId(row, column);
      squares[id] = { id, row, column, owner: null };
    }
  }
  return squares;
}

/** The four edge ids that enclose the square at (row, column). */
export function edgeIdsForSquare(row: number, column: number): string[] {
  return [
    horizontalEdgeId(row, column),
    horizontalEdgeId(row + 1, column),
    verticalEdgeId(row, column),
    verticalEdgeId(row, column + 1),
  ];
}

/** Square ids (at most two) that an edge can help complete. */
export function squareIdsTouchingEdge(edge: Edge, gridSize = DEFAULT_GRID_SIZE): string[] {
  const maxIndex = gridSize - 2;
  const candidates: Array<[number, number]> =
    edge.orientation === 'horizontal'
      ? [
          [edge.row - 1, edge.column],
          [edge.row, edge.column],
        ]
      : [
          [edge.row, edge.column - 1],
          [edge.row, edge.column],
        ];

  return candidates
    .filter(([row, column]) => row >= 0 && row <= maxIndex && column >= 0 && column <= maxIndex)
    .map(([row, column]) => squareId(row, column));
}

/**
 * Translates a pair of dots into the edge that joins them.
 * Returns null for identical, diagonal, or non-adjacent dots.
 */
export function edgeIdBetweenDots(a: Dot, b: Dot, gridSize = DEFAULT_GRID_SIZE): string | null {
  const inBounds = (dot: Dot) =>
    Number.isInteger(dot.row) &&
    Number.isInteger(dot.column) &&
    dot.row >= 0 &&
    dot.row < gridSize &&
    dot.column >= 0 &&
    dot.column < gridSize;

  if (!inBounds(a) || !inBounds(b)) return null;

  const rowDelta = Math.abs(a.row - b.row);
  const columnDelta = Math.abs(a.column - b.column);

  if (rowDelta === 0 && columnDelta === 1) {
    return horizontalEdgeId(a.row, Math.min(a.column, b.column));
  }
  if (columnDelta === 0 && rowDelta === 1) {
    return verticalEdgeId(Math.min(a.row, b.row), a.column);
  }
  return null;
}
