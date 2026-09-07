import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  SPEEDS,
  describeTimeControl,
  timeControlFor,
  type Speed,
} from '../engine';

interface MatchOptionsFieldsProps {
  gridSize: number;
  onGridSize: (size: number) => void;
  speed: Speed;
  onSpeed: (speed: Speed) => void;
}

/**
 * Board size and clock, the two settings every new game needs.
 *
 * Shared rather than duplicated because they are now asked in two places — the
 * setup screen for a local or computer game, the lobby for an online one — and
 * two copies of a slider is exactly how the online board quietly stops matching
 * the offline one.
 */
export function MatchOptionsFields({
  gridSize,
  onGridSize,
  speed,
  onSpeed,
}: MatchOptionsFieldsProps) {
  const timeControl = timeControlFor(gridSize, speed);

  return (
    <div className="setup__options">
      <div className="field">
        <label className="field__label" htmlFor="grid-size">
          Board — {gridSize} &times; {gridSize} dots, {(gridSize - 1) ** 2} squares
        </label>
        <input
          id="grid-size"
          type="range"
          className="setup__range"
          min={MIN_GRID_SIZE}
          max={MAX_GRID_SIZE}
          step={1}
          value={gridSize}
          onChange={(event) => onGridSize(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <span className="field__label" id="time-control-label">
          Speed — {describeTimeControl(timeControl)} on this board
        </span>
        <div className="setup__choices" role="group" aria-labelledby="time-control-label">
          {SPEEDS.map((option) => {
            const control = timeControlFor(gridSize, option);
            return (
              <button
                key={option.id}
                type="button"
                className={
                  option.id === speed.id
                    ? 'button button--ghost button--chosen time-control'
                    : 'button button--ghost time-control'
                }
                aria-pressed={option.id === speed.id}
                onClick={() => onSpeed(option)}
              >
                <span className="time-control__label">{option.label}</span>
                <span className="time-control__kind">{describeTimeControl(control)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
