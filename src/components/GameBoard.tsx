import { useCallback, useRef, useState } from 'react';
import type { GameState, PlayerId } from '../engine';
import { analysePosition } from '../ai/bot';
import { BOARD_THEME, PLAYER_THEME } from './theme';

const SPACING = 40;
const PADDING = 26;
const DOT_RADIUS = 5.2;
const LINE_WIDTH = 5.5;
// viewBox units, so this scales with the board.
const TOUCH_TARGET = 30;
/**
 * How far a click may land from a line and still claim it.
 *
 * Selection is resolved by *distance*, not by which shape the browser happened
 * to hit. The hit rectangles necessarily overlap — a round cap spills 15 units
 * past each end, so neighbouring lines shared a 30-unit band around every dot,
 * and SVG awards the click to whichever was painted last rather than whichever
 * is nearest. That is what made players hit one line and claim another.
 */
const SELECT_RADIUS = TOUCH_TARGET / 2;

type BoardEdge = GameState['edges'][string];

interface GameBoardProps {
  state: GameState;
  onSelectEdge: (edgeId: string) => void;
  disabled: boolean;
  /** Set while the winner's board is being swept in celebration. */
  sweepFor?: PlayerId | null;
  /** Paints the chain analysis over the board while held. */
  showChains?: boolean;
}

function dotX(column: number) {
  return PADDING + column * SPACING;
}

function dotY(row: number) {
  return PADDING + row * SPACING;
}

function endpoints(edge: BoardEdge) {
  return edge.orientation === 'horizontal'
    ? { x1: dotX(edge.column), y1: dotY(edge.row), x2: dotX(edge.column + 1), y2: dotY(edge.row) }
    : { x1: dotX(edge.column), y1: dotY(edge.row), x2: dotX(edge.column), y2: dotY(edge.row + 1) };
}

function midpoint(edge: BoardEdge) {
  return edge.orientation === 'horizontal'
    ? { x: dotX(edge.column) + SPACING / 2, y: dotY(edge.row) }
    : { x: dotX(edge.column), y: dotY(edge.row) + SPACING / 2 };
}

/** Perpendicular distance from a point to a line segment. */
function distanceToEdge(edge: BoardEdge, x: number, y: number): number {
  const { x1, y1, x2, y2 } = endpoints(edge);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  // Clamped projection, so the nearest point never runs off the end of the
  // segment into a neighbour's territory.
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function GameBoard({
  state,
  onSelectEdge,
  disabled,
  sweepFor = null,
  showChains = false,
}: GameBoardProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  /**
   * The cursor belongs to keyboard play only. Showing it after a mouse click
   * put an unexplained white marker on the board that read as a rendering
   * glitch, so it stays hidden until an arrow key is actually pressed.
   */
  const [keyboardMode, setKeyboardMode] = useState(false);

  const { gridSize } = state;
  const extent = PADDING * 2 + (gridSize - 1) * SPACING;
  const activeTheme = PLAYER_THEME[state.currentPlayer];
  const dots = Array.from({ length: gridSize }, (_, index) => index);
  const edges = Object.values(state.edges);
  const squares = Object.values(state.squares);

  const cursor = cursorId ? state.edges[cursorId] : undefined;
  // Only computed while the overlay is held, so it costs nothing in normal play.
  const analysis = showChains && !disabled ? analysePosition(state) : { safeEdgeIds: [], cost: {} };
  // Before anyone has moved a phone player has no hover, so the gaps look inert.
  const untouched = Object.values(state.edges).every((edge) => edge.owner === null);

  /**
   * Moves to the nearest edge in the pressed direction, measured between
   * midpoints. Working geometrically rather than by index means the cursor
   * crosses between horizontal and vertical lines naturally, so there is no
   * orientation mode for the player to track.
   */
  const step = useCallback(
    (from: BoardEdge, dx: number, dy: number) => {
      const origin = midpoint(from);
      let best: BoardEdge | undefined;
      let bestCost = Infinity;

      for (const candidate of edges) {
        if (candidate.id === from.id) continue;
        const point = midpoint(candidate);
        const forward = dx !== 0 ? (point.x - origin.x) * dx : (point.y - origin.y) * dy;
        if (forward <= 0) continue;
        const drift = dx !== 0 ? Math.abs(point.y - origin.y) : Math.abs(point.x - origin.x);
        // Weight sideways drift heavily so the cursor holds its lane instead of
        // wandering diagonally across the board.
        const cost = forward + drift * 3;
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }

      return best ?? from;
    },
    [edges],
  );

  /** Maps a screen point into board coordinates. Null when unavailable. */
  const toBoard = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || typeof svg.getScreenCTM !== 'function') return null;
    try {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: point.x, y: point.y };
    } catch {
      return null;
    }
  }, []);

  /** The unclaimed line closest to a screen point, within SELECT_RADIUS. */
  const edgeNearest = useCallback(
    (clientX: number, clientY: number) => {
      const point = toBoard(clientX, clientY);
      if (!point) return null;
      let best: string | null = null;
      let bestDistance = SELECT_RADIUS;
      for (const edge of edges) {
        if (edge.owner) continue;
        const distance = distanceToEdge(edge, point.x, point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = edge.id;
        }
      }
      return best;
    },
    [edges, toBoard],
  );

  /**
   * Resolves a pointer event to the line the player actually aimed at. Falls
   * back to the element under the pointer when coordinates are unusable (jsdom
   * in tests, or a browser without getScreenCTM).
   */
  const resolveEdge = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      const nearest = edgeNearest(event.clientX, event.clientY);
      if (nearest) return nearest;
      const target = event.target as Element | null;
      return target?.getAttribute?.('data-edge-id') ?? null;
    },
    [edgeNearest],
  );

  const firstOpenEdge = useCallback(
    () => edges.find((edge) => !edge.owner) ?? edges[0],
    [edges],
  );

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;

    const delta = ARROW_DELTAS[event.key];
    if (delta) {
      // The board owns the arrow keys; without this the page scrolls instead.
      event.preventDefault();
      setKeyboardMode(true);
      setCursorId((current) => {
        const from = (current ? state.edges[current] : undefined) ?? firstOpenEdge();
        return from ? step(from, delta[0], delta[1]).id : null;
      });
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setKeyboardMode(true);
      const target = cursorId ? state.edges[cursorId] : undefined;
      if (target && !target.owner) onSelectEdge(target.id);
    }
  };

  const describeCursor = () => {
    if (!cursor || !keyboardMode) return '';
    const owner = cursor.owner ? state.players[cursor.owner] : null;
    const position = `${cursor.orientation} line, row ${cursor.row + 1}, column ${cursor.column + 1}`;
    return owner
      ? `${position}, already claimed by ${owner.username}`
      : `${position}, open. Press Enter to claim it.`;
  };

  return (
    <div className="board">
      <svg
        viewBox={`0 0 ${extent} ${extent}`}
        className="board__svg"
        role="grid"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Dots and Squares board, ${gridSize} by ${gridSize} dots. Use the arrow keys to move between lines and Enter to claim one.`}
        aria-describedby="board-cursor-status"
        ref={svgRef}
        onKeyDown={handleKeyDown}
        onFocus={() => setCursorId((current) => current ?? firstOpenEdge()?.id ?? null)}
        // A pointer interaction is not keyboard navigation, so drop the cursor.
        onPointerDown={(event) => {
          setKeyboardMode(false);
          // Touch has no hover, so show the resolved target on press instead.
          if (event.pointerType === 'touch') setHoveredEdge(edgeNearest(event.clientX, event.clientY));
        }}
        onClick={(event) => {
          if (disabled) return;
          const id = resolveEdge(event);
          if (id && !state.edges[id]?.owner) onSelectEdge(id);
        }}
        onPointerMove={(event) => {
          // Preview whatever a click would actually claim, so what lights up is
          // what you get.
          if (disabled || event.pointerType === 'touch') return;
          setHoveredEdge(edgeNearest(event.clientX, event.clientY));
        }}
        onPointerLeave={() => setHoveredEdge(null)}
      >
        <rect x="0" y="0" width={extent} height={extent} className="board__background" />

        {/* Chain analysis, held open by the player. Reveals only what the
            position already contains — no rule changes. */}
        {showChains && !disabled && (
          <g className="board__vision" aria-hidden="true">
            {analysis.safeEdgeIds.map((id) => {
              const edge = state.edges[id];
              if (!edge) return null;
              return <line key={`safe-${id}`} {...endpoints(edge)} className="edge__safe" />;
            })}
            {Object.entries(analysis.cost).map(([id, cost]) => {
              const edge = state.edges[id];
              if (!edge) return null;
              const mid = midpoint(edge);
              return (
                <text
                  key={`cost-${id}`}
                  x={mid.x}
                  y={mid.y}
                  className="edge__cost"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {cost}
                </text>
              );
            })}
          </g>
        )}

        {squares.map((square) => {
          if (!square.owner) return null;
          const theme = PLAYER_THEME[square.owner];
          const initials = state.players[square.owner].initials;
          const claimIndex = state.lastClaimedSquares.indexOf(square.id);
          const justClaimed = claimIndex >= 0;
          const swept = sweepFor !== null && square.owner === sweepFor;
          // Reading order, so the celebration washes across the board.
          const sweepIndex = swept ? square.row * state.gridSize + square.column : 0;
          return (
            <g
              key={square.id}
              className={
                swept ? 'square square--sweep' : justClaimed ? 'square square--new' : 'square'
              }
              // Staggers a double claim into two beats instead of one flash.
              style={
                swept
                  ? ({ '--claim-index': sweepIndex } as React.CSSProperties)
                  : justClaimed
                    ? ({ '--claim-index': claimIndex } as React.CSSProperties)
                    : undefined
              }
            >
              <rect
                x={dotX(square.column)}
                y={dotY(square.row)}
                width={SPACING}
                height={SPACING}
                fill={theme.fill}
              />
              <text
                x={dotX(square.column) + SPACING / 2}
                y={dotY(square.row) + SPACING / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={theme.text}
                fontSize={initials.length > 2 ? 13 : 16}
                fontWeight="700"
              >
                {initials}
              </text>
            </g>
          );
        })}

        {edges.map((edge) => {
          const { x1, y1, x2, y2 } = endpoints(edge);
          const isHovered = hoveredEdge === edge.id && !edge.owner && !disabled;
          const ownerTheme = edge.owner ? PLAYER_THEME[edge.owner] : null;
          const stroke = ownerTheme ? ownerTheme.line : isHovered ? activeTheme.soft : BOARD_THEME.open;
          return (
            <line
              key={edge.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeWidth={edge.owner || isHovered ? LINE_WIDTH : 2.5}
              // Round caps on a dashed line add a half-circle to every dash and
              // the run reads as a string of blobs, so dashed lines get butt.
              strokeLinecap={ownerTheme?.dash ? 'butt' : 'round'}
              // Claimed lines differ in pattern as well as colour, so the board
              // still reads without colour vision.
              strokeDasharray={ownerTheme?.dash}
              className={edge.owner ? 'edge edge--claimed' : 'edge'}
            />
          );
        })}

        {dots.map((row) =>
          dots.map((column) => (
            <circle
              key={`dot-${row}-${column}`}
              cx={dotX(column)}
              cy={dotY(row)}
              r={DOT_RADIUS}
              fill={BOARD_THEME.dot}
            />
          )),
        )}

        {/* Keyboard cursor, drawn above the lines so it is never hidden by one.
            Slim and dashed: it should trace the edge, not cover it. */}
        {cursor && keyboardMode && !disabled && (
          <line
            {...endpoints(cursor)}
            className="edge__cursor"
            stroke={BOARD_THEME.cursor}
            strokeWidth={4}
            strokeLinecap="butt"
            fill="none"
            aria-hidden="true"
          />
        )}

        {untouched && !disabled && (
          <g className="board__ghosts" aria-hidden="true">
            {edges.slice(0, 3).map((edge) => (
              <line key={`ghost-${edge.id}`} {...endpoints(edge)} className="edge__ghost" />
            ))}
          </g>
        )}

        {edges.map((edge) => {
          if (edge.owner || disabled) return null;
          const { x1, y1, x2, y2 } = endpoints(edge);
          return (
            <line
              key={`hit-${edge.id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="transparent"
              strokeWidth={TOUCH_TARGET}
              // Butt, not round: a round cap spilled 15 units past each end and
              // overlapped the neighbouring line.
              strokeLinecap="butt"
              className="edge__hit"
              data-edge-id={edge.id}
            />
          );
        })}
      </svg>

      {/* Outside the SVG on purpose: an SVG <text> node here would be read as
          part of the board graphic and would count as board content. */}
      <p id="board-cursor-status" className="visually-hidden" aria-live="polite">
        {describeCursor()}
      </p>
    </div>
  );
}
