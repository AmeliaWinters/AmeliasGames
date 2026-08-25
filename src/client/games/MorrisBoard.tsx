import { useEffect, useState } from "react";
// Values from morrisDisplay.js, which imports nothing: the board and the
// reducer have to agree about where the points are and which lines are mills,
// and two copies of that would be a board offering moves the rules refuse.
// The types below are type-only, so they are erased and carry no import.
import {
  MEN,
  POINTS,
  RINGS,
  canFly,
  destinations,
  menOnBoard,
  movers,
  mustPlace,
  pointAt,
  pointName,
  pointXY,
  takeable,
} from "../../shared/games/morrisDisplay.js";
import type { MmMove, MmState } from "../../shared/games/morrisDisplay.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<MmState, MmMove>;

/**
 * How much board there is around the outer square, in board units.
 *
 * The men are drawn on the points, so half a man hangs outside the outer ring
 * on every side. Without the margin the top row would be cut in half by the
 * edge of the surface, and the two corner men would lose the ring that tells
 * you whose they are.
 */
const MARGIN = 0.55;
const SPAN = 2 * (RINGS + MARGIN);

/** A point's position as a percentage of the board's width. */
function percent(value: number): string {
  return `${((value + RINGS + MARGIN) / SPAN) * 100}%`;
}

/**
 * The lines. Three nested squares and four spokes, drawn from the same
 * geometry the rules use, so a line on screen is a road a man may actually
 * walk, which on this board is the entire question. The corners have no spokes,
 * and a player who thinks they do will lose a man to it.
 */
function Lines() {
  return (
    <svg
      className="mm-lines"
      viewBox={`${-RINGS - MARGIN} ${-RINGS - MARGIN} ${SPAN} ${SPAN}`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: RINGS }, (_, r) => {
        const reach = RINGS - r;
        return (
          <rect
            key={r}
            x={-reach}
            y={-reach}
            width={reach * 2}
            height={reach * 2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {[1, 3, 5, 7].map((s) => {
        const from = pointXY(pointAt(0, s));
        const to = pointXY(pointAt(2, s));
        return (
          <line
            key={s}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

/**
 * Men still in hand, as pips.
 *
 * The one number both players track all through the first half of the game is
 * how many men are left to come, and counting them off a board of twenty-four
 * points is exactly the chore a roster exists to spare them. It keeps its row
 * once the hands are empty, because "how many men have they got left" is the
 * same question in the second half and the answer moves to the board count.
 */
function Hand({ name, held, standing, fly }: {
  name: string;
  held: number;
  standing: number;
  fly: boolean;
}) {
  return (
    <li className="mm-hand">
      <span className="mm-who">{name}</span>
      <span className="mm-pips" aria-hidden="true">
        {Array.from({ length: MEN }, (_, i) => (
          <i key={i} className={i < held ? "mm-pip held" : "mm-pip"} />
        ))}
      </span>
      <span className="mm-count">
        {held > 0
          ? `${held} to place`
          : fly
            ? `${standing} left, flying`
            : `${standing} on the board`}
      </span>
    </li>
  );
}

export function MorrisBoard({ state, seat, names, canAct, onMove }: Props) {
  const [chosen, setChosen] = useState<number | null>(null);

  // A selection stops meaning anything the moment the position changes, and
  // that includes the man being taken off by somebody else's mill.
  useEffect(() => setChosen(null), [state.board, state.turn, state.taking]);

  const acting = seat !== null && canAct;
  const taking = acting && state.taking === seat;
  const placing = acting && !taking && mustPlace(state, seat);
  const moving = acting && !taking && !placing;

  const sources = moving && seat !== null ? movers(state, seat) : [];
  const targets = new Set<number>(
    taking && seat !== null
      ? takeable(state.board, seat === 0 ? 1 : 0)
      : placing
        ? state.board.flatMap((cell, point) => (cell === null ? [point] : []))
        : chosen !== null
          ? destinations(state, chosen)
          : [],
  );
  const closed = new Set(state.closed ?? []);
  const from = state.lastMove?.type === "move" ? state.lastMove.from : null;
  const landed =
    state.lastMove?.type === "move" || state.lastMove?.type === "place"
      ? state.lastMove.to
      : null;

  /** Play the point, or change which man is picked up. */
  function choose(point: number) {
    if (!acting) return;
    if (taking) {
      if (targets.has(point)) onMove({ type: "take", at: point });
      return;
    }
    if (placing) {
      if (targets.has(point)) onMove({ type: "place", to: point });
      return;
    }
    if (chosen !== null && targets.has(point)) {
      onMove({ type: "move", from: chosen, to: point });
      setChosen(null);
      return;
    }
    setChosen(sources.includes(point) && point !== chosen ? point : null);
  }

  /** What a point is, and what pressing it would do, in words. */
  function label(point: number): string {
    const cell = state.board[point];
    const whose =
      cell === null ? "empty" : `${names[cell] ?? `Player ${cell + 1}`}'s man`;
    const note = closed.has(point)
      ? ", in the mill just closed"
      : point === chosen
        ? ", picked up"
        : taking && targets.has(point)
          ? ", can be taken"
          : targets.has(point)
            ? placing
              ? ", can place here"
              : ", can move here"
            : sources.includes(point)
              ? ", can move"
              : "";
    return `${pointName(point)}, ${whose}${note}`;
  }

  return (
    <div className="mm">
      <div className="mm-board" role="group" aria-label="Nine Men's Morris board">
        <Lines />
        {Array.from({ length: POINTS }, (_, point) => {
          const cell = state.board[point];
          const { x, y } = pointXY(point);
          const classes = [
            "mm-point",
            "surface",
            cell === null ? "empty" : `p${cell}`,
            closed.has(point) ? "milled" : "",
            point === chosen ? "chosen" : "",
            targets.has(point) ? (taking ? "doomed" : "target") : "",
            !targets.has(point) && sources.includes(point) ? "live" : "",
            point === landed ? "landed" : "",
            point === from ? "vacated" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={point}
              className={classes}
              style={{ left: percent(x), top: percent(y) }}
              disabled={!acting || (!targets.has(point) && !sources.includes(point))}
              aria-label={label(point)}
              onClick={() => choose(point)}
            >
              <span className="mm-man" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <ul className="mm-hands">
        {[0, 1].map((who) => (
          <Hand
            key={who}
            name={names[who] ?? `Player ${who + 1}`}
            held={state.hand[who]}
            standing={menOnBoard(state.board, who)}
            fly={canFly(state, who)}
          />
        ))}
      </ul>
    </div>
  );
}
