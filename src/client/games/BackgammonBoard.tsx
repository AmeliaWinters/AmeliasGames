import { useEffect, useRef, useState } from "react";
import {
  BACKGAMMON_TRAY,
  POINTS,
  barEntry,
  diceOnTable,
  direction,
  legalMoves,
  pipCount,
  type BgMove,
  type BgState,
  type Source,
} from "../../shared/games/backgammon.js";
import type { ThrownDice } from "../../shared/games/toss.js";
import { Dice3DTray, type DiceTrayHandle } from "../dice3d/Dice3DTray.js";
import { useLanding } from "../dice/useLanding.js";
import type { BoardProps } from "./boards.js";

/** The inner board's own props — the wrapper below takes the standard set. */
interface Props {
  state: BgState;
  seat: number | null;
  canAct: boolean;
  /** True while the dice are still rolling. Nothing they decide is drawn yet. */
  flying: boolean;
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

/** A checker you can pick up, and the one you have picked up. */
type Mark = "live" | "chosen";

function Checkers({ count, seat, mark }: { count: number; seat: 0 | 1; mark?: Mark }) {
  // Beyond five the stack is drawn tighter and the last one carries the count,
  // which is what a real board does when checkers pile up.
  const shown = Math.min(count, 5);
  return (
    <>
      {Array.from({ length: shown }, (_, i) => (
        // Only the checker on top of the pile is marked. It is the one that
        // would actually leave, and ringing all five of them says no more.
        <span key={i} className={`checker s${seat}${mark && i === shown - 1 ? ` ${mark}` : ""}`}>
          {count > 5 && i === shown - 1 ? count : ""}
        </span>
      ))}
    </>
  );
}

/**
 * The outline marking a point the selected checker may land on.
 *
 * It traces the triangle rather than the column the triangle is drawn in: a
 * rectangle round a point outlines mostly empty board, in a shape that is not
 * the one being pointed at. Stroked rather than clipped a second time —
 * insetting the clip-path narrows the line away to nothing towards the apex,
 * where a non-scaling stroke holds an even two pixels however wide the board
 * is drawn. The polygon is the `.triangle` clip-path in viewBox units, so the
 * two are changed together.
 */
function PointOutline() {
  return (
    <svg
      className="point-edge"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points="0,0 100,0 50,92" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BackgammonBoard({ state, seat, canAct, flying, onMove }: Props) {
  const view = seat ?? 0;
  const { top, bottom } = layoutFor(view);
  const [selected, setSelected] = useState<Source | null>(null);

  // Nothing is markable while the dice are still rolling. The marks are read
  // *off* the dice — a board that lights up the points a 6 can reach before
  // the 6 has stopped has told you the roll ahead of the die showing it.
  const moves = canAct && !flying ? legalMoves(state) : [];

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
    if (!canAct) return;
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
    // Only your own points are ever sources, so a mark never lands on an
    // opposing checker. A die is at least one, so nothing is both a source
    // you have picked up and somewhere that checker can land.
    const mark: Mark | undefined = active === index ? "chosen" : isSource ? "live" : undefined;
    const note =
      mark === "chosen"
        ? ", picked up"
        : isTarget
          ? ", can land here"
          : mark === "live"
            ? ", can move"
            : "";

    return (
      <button
        key={index}
        className={`point surface ${index % 2 === 0 ? "dark" : "light"}`}
        onClick={() => choose(index)}
        disabled={!canAct || (!isSource && !isTarget)}
        aria-label={
          count === 0
            ? `Point ${index + 1}, empty${note}`
            : `Point ${index + 1}, ${count} ${owner === view ? "of your" : "opposing"} checkers${note}`
        }
      >
        <span className="triangle" aria-hidden="true" />
        {isTarget && <PointOutline />}
        <span className="stack">
          {count > 0 && <Checkers count={count} seat={owner} mark={mark} />}
        </span>
      </button>
    );
  }

  const canBearOff = targets.has("off");
  // The bar is not a triangle, so it says the same thing the points do in the
  // only way it can: on the checker rather than on the box it sits in.
  const barMark: Mark | undefined =
    active === "bar" ? "chosen" : sources.has("bar") ? "live" : undefined;
  const barNote =
    barMark === "chosen" ? ", picked up" : barMark === "live" ? ", can come in" : "";

  return (
    <div className="bg">
      <div className="bg-board">
        <div className="bg-row top">
          {top.slice(0, 6).map(renderPoint)}
          <div className="bg-bar-slot" />
          {top.slice(6).map(renderPoint)}
        </div>

        <button
          className="bg-bar surface"
          onClick={() => choose("bar")}
          disabled={!canAct || !sources.has("bar")}
          // Seat-indexed counts told a listener nothing: which of the two is
          // theirs is exactly what they cannot see.
          aria-label={`Bar: ${state.bar[view]} of yours, ${state.bar[1 - view]} of theirs${barNote}`}
        >
          <span className="bar-stack top">
            {state.bar[view === 1 ? 0 : 1] > 0 && (
              <Checkers count={state.bar[view === 1 ? 0 : 1]} seat={(view === 1 ? 0 : 1) as 0 | 1} />
            )}
          </span>
          <span className="bar-stack bottom">
            {state.bar[view] > 0 && (
              <Checkers count={state.bar[view]} seat={view as 0 | 1} mark={barMark} />
            )}
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

/**
 * Backgammon, board and controls.
 *
 * They are one component because they share one fact: whether the dice have
 * stopped. The board draws what the roll makes legal and the controls draw the
 * roll itself, so a flag held separately in each would let one of them answer
 * before the other — which is exactly the thing the tray exists to prevent.
 */
export function BackgammonGame({
  state,
  seat,
  canAct,
  onMove,
}: BoardProps<BgState, BgMove>) {
  const [flying, land] = useLanding(state.toss?.n ?? 0);
  return (
    <>
      <BackgammonBoard
        state={state}
        seat={seat}
        canAct={canAct}
        flying={flying}
        onMove={onMove}
      />
      <BackgammonStatus
        state={state}
        seat={seat}
        canAct={canAct}
        flying={flying}
        onThrow={(thrown) => onMove({ type: "roll", throw: thrown })}
        onPass={() => onMove({ type: "pass" })}
        onRest={land}
      />
    </>
  );
}

/**
 * The pip count, the dice, and whatever the turn is waiting on.
 *
 * The pair a turn is played from is a *pair on the table*, so it is thrown
 * onto one: a tray, at a size worth looking at, rather than two 32px squares
 * in a status line. Dice already played dim rather than vanish — the row
 * shrinking as you spent them made the turn's remaining dice harder to count,
 * not easier, because the thing you are counting kept moving.
 */
export function BackgammonStatus({
  state,
  seat,
  canAct,
  flying,
  onThrow,
  onPass,
  onRest,
}: {
  state: BgState;
  seat: number | null;
  canAct: boolean;
  flying: boolean;
  onThrow(thrown: ThrownDice): void;
  onPass(): void;
  onRest(): void;
}) {
  const trayRef = useRef<DiceTrayHandle>(null);
  const view = seat ?? 0;
  const stuck = canAct && state.phase === "move" && !flying && legalMoves(state).length === 0;
  const canRoll = canAct && state.phase === "roll" && !flying;

  // Two dice, because two dice were thrown — see `diceOnTable`, which is
  // where the double's four moves are turned back into the pair on the table.
  const { thrown, double, left, spent } = diceOnTable(state);

  return (
    <div className="bg-controls">
      <span className="race">
        {pipCount(state, view)} pips to go · they have {pipCount(state, 1 - view)}
      </span>

      <Dice3DTray
        ref={trayRef}
        count={thrown.length}
        tray={BACKGAMMON_TRAY}
        faces={thrown}
        spent={spent}
        toss={state.toss}
        flying={flying}
        mine={canAct}
        label={diceLabel(thrown, state.dice, flying, state.phase)}
        hint={
          canRoll
            ? "Flick to throw"
            : double && state.phase === "move" && !flying
              ? `Double — ${left} of four to play`
              : undefined
        }
        onThrow={canRoll ? onThrow : undefined}
        onRest={onRest}
      />

      {canRoll && (
        // The tray is the throw; this is the same throw for a thumb that would
        // rather press something, and the one a keyboard reaches first.
        // Through the tray, so the button throws the same dice the flick
        // does — the physics is in there.
        <button className="primary" onClick={() => trayRef.current?.throwNow({ x: 0, y: 0 })}>
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

/** The dice read out: what was thrown, and what of it is still to play. */
function diceLabel(
  thrown: readonly number[],
  left: readonly number[],
  flying: boolean,
  phase: BgState["phase"],
): string {
  if (flying) return "The dice, in the air";
  if (phase === "roll") return "The dice, not thrown yet";
  const rolled = `Rolled ${thrown.join(" and ")}`;
  // A double is two dice and four moves, so the count is the news rather than
  // which numbers are left — they are all the same number.
  if (thrown[0] === thrown[1]) {
    if (left.length === 0) return `${rolled}, a double, all four played`;
    return `${rolled}, a double; ${left.length} of four still to play`;
  }
  if (left.length === 0) return `${rolled}, all played`;
  if (left.length === thrown.length) return rolled;
  return `${rolled}; ${left.join(" and ")} still to play`;
}
