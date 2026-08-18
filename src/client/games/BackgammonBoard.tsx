import { useEffect, useState } from "react";
import {
  POINTS,
  barEntry,
  direction,
  legalMoves,
  pipCount,
  type BgState,
  type Source,
} from "../../shared/games/backgammon.js";

interface Props {
  state: BgState;
  seat: number | null;
  myTurn: boolean;
  onMove(move: { type: "move"; from: Source; die: number }): void;
}

/**
 * Seat 0's board reads as a horseshoe: from the top-right corner leftward
 * along the top, down the left side, then rightward along the bottom into
 * their home board at bottom right. Seat 1 travels the same shape, so their
 * view is the two rows swapped — each player sees their own home nearest to
 * them, which is how a physical board works.
 */
const TOP = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const BOTTOM = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

function layoutFor(seat: number) {
  return seat === 1 ? { top: BOTTOM, bottom: TOP } : { top: TOP, bottom: BOTTOM };
}

/** Where a checker ends up, or "off" if it runs past the edge of the board. */
function targetOf(seat: number, from: Source, die: number): number | "off" {
  if (from === "bar") return barEntry(seat, die);
  const landed = from + direction(seat) * die;
  return landed >= 0 && landed < POINTS ? landed : "off";
}

/** Pip positions on a die face, as [column, row] on a 3×3 grid. */
const FACES: Record<number, Array<[number, number]>> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
  6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};

export function Die({ value }: { value: number }) {
  return (
    <span className="die" role="img" aria-label={`Die showing ${value}`}>
      {(FACES[value] ?? []).map(([column, row], i) => (
        <span key={i} className="pip" style={{ gridColumn: column, gridRow: row }} />
      ))}
    </span>
  );
}

function Checkers({ count, seat }: { count: number; seat: 0 | 1 }) {
  // Beyond five the stack is drawn tighter and the last one carries the count,
  // which is what a real board does when checkers pile up.
  const shown = Math.min(count, 5);
  return (
    <>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={`checker s${seat}`}>
          {count > 5 && i === shown - 1 ? count : ""}
        </span>
      ))}
    </>
  );
}

export function BackgammonBoard({ state, seat, myTurn, onMove }: Props) {
  const view = seat ?? 0;
  const { top, bottom } = layoutFor(view);
  const [selected, setSelected] = useState<Source | null>(null);

  const moves = myTurn ? legalMoves(state) : [];

  // A selection stops meaning anything the moment the position changes.
  useEffect(() => setSelected(null), [state.points, state.dice, state.turn]);

  // Forced re-entry: if the only legal moves come off the bar, pre-select it.
  const barOnly = moves.length > 0 && moves.every((m) => m.from === "bar");
  const active = selected ?? (barOnly ? "bar" : null);

  const sources = new Set(moves.map((m) => String(m.from)));
  const fromActive = active === null ? [] : moves.filter((m) => m.from === active);
  const targets = new Map(fromActive.map((m) => [String(targetOf(view, m.from, m.die)), m.die]));

  /** Play the selected checker to `where`, or change what is selected. */
  function choose(where: Source) {
    if (!myTurn) return;
    const die = targets.get(String(where));
    if (active !== null && die !== undefined) {
      onMove({ type: "move", from: active, die });
      setSelected(null);
      return;
    }
    setSelected(sources.has(String(where)) && where !== active ? where : null);
  }

  function bearOff() {
    const die = targets.get("off");
    if (active === null || die === undefined) return;
    onMove({ type: "move", from: active, die });
    setSelected(null);
  }

  // Rendered by a plain function rather than a nested component: a component
  // declared inside the render body is a new type every update, so React
  // would remount all 24 points and drop keyboard focus on every move.
  function renderPoint(index: number) {
    const value = state.points[index];
    const count = Math.abs(value);
    const owner: 0 | 1 = value > 0 ? 0 : 1;
    const isTarget = targets.has(String(index));
    const isSource = sources.has(String(index));

    return (
      <button
        key={index}
        className={[
          "point",
          index % 2 === 0 ? "dark" : "light",
          isTarget ? "target" : "",
          active === index ? "chosen" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => choose(index)}
        disabled={!myTurn || (!isSource && !isTarget)}
        aria-label={
          count === 0
            ? `Point ${index + 1}, empty`
            : `Point ${index + 1}, ${count} ${owner === view ? "of your" : "opposing"} checkers`
        }
      >
        <span className="triangle" aria-hidden="true" />
        <span className="stack">{count > 0 && <Checkers count={count} seat={owner} />}</span>
      </button>
    );
  }

  const canBearOff = targets.has("off");

  return (
    <div className="bg">
      <div className="bg-board">
        <div className="bg-row top">
          {top.slice(0, 6).map(renderPoint)}
          <div className="bg-bar-slot" />
          {top.slice(6).map(renderPoint)}
        </div>

        <button
          className={[
            "bg-bar",
            active === "bar" ? "chosen" : "",
            sources.has("bar") ? "live" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => choose("bar")}
          disabled={!myTurn || !sources.has("bar")}
          aria-label={`Bar: ${state.bar[0]} and ${state.bar[1]} checkers`}
        >
          <span className="bar-stack top">
            {state.bar[view === 1 ? 0 : 1] > 0 && (
              <Checkers count={state.bar[view === 1 ? 0 : 1]} seat={(view === 1 ? 0 : 1) as 0 | 1} />
            )}
          </span>
          <span className="bar-stack bottom">
            {state.bar[view] > 0 && <Checkers count={state.bar[view]} seat={view as 0 | 1} />}
          </span>
        </button>

        <div className="bg-row bottom">
          {bottom.slice(0, 6).map(renderPoint)}
          <div className="bg-bar-slot" />
          {bottom.slice(6).map(renderPoint)}
        </div>
      </div>

      <div className="bg-tray">
        <span className="borne">
          Borne off — you {state.off[view]}, them {state.off[1 - view]}
        </span>
        {canBearOff && (
          <button className="primary bear" onClick={bearOff}>
            Bear off
          </button>
        )}
      </div>
    </div>
  );
}

/** Pip counts and remaining dice, shown beneath the board. */
export function BackgammonStatus({
  state,
  seat,
  myTurn,
  onRoll,
  onPass,
}: {
  state: BgState;
  seat: number | null;
  myTurn: boolean;
  onRoll(): void;
  onPass(): void;
}) {
  const view = seat ?? 0;
  const stuck = myTurn && state.phase === "move" && legalMoves(state).length === 0;

  return (
    <div className="bg-controls">
      <span className="race">
        {pipCount(state, view)} pips to go · they have {pipCount(state, 1 - view)}
      </span>

      <div className="dice">
        {state.dice.map((value, i) => (
          <Die key={i} value={value} />
        ))}
      </div>

      {myTurn && state.phase === "roll" && (
        <button className="primary" onClick={onRoll}>
          Roll
        </button>
      )}
      {stuck && (
        <button className="primary" onClick={onPass}>
          No moves — end turn
        </button>
      )}
    </div>
  );
}
