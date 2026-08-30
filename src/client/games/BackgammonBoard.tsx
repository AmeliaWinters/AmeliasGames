import { useEffect, useRef, useState } from "react";
import {
  BACKGAMMON_TRAY,
  CHECKERS,
  diceOnTable,
  isHome,
  landingOf,
  legalMoves,
  pipCount,
  type BgLast,
  type BgMove,
  type BgState,
  type Source,
} from "../../shared/games/backgammon.js";
import type { ThrownDice } from "../../shared/games/toss.js";
import { Dice3DTray, type DiceTrayHandle } from "../dice3d/Dice3DTray.js";
import { useLanding } from "../dice/useLanding.js";
import { wantsStillness } from "../motion.js";
import type { BoardProps } from "./boards.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/backgammon.css";

/** The inner board's own props. The wrapper below takes the standard set. */
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
 * view is the two rows swapped: each player sees their own home nearest to
 * them, which is how a physical board works.
 */
const TOP = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const BOTTOM = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

function layoutFor(seat: number) {
  return seat === 1 ? { top: BOTTOM, bottom: TOP } : { top: TOP, bottom: BOTTOM };
}

/** How long a checker takes to cross the board, and how it gets there. */
const FLIGHT_MS = 260;
const FLIGHT_EASE = "cubic-bezier(0.3, 0, 0.2, 1)";

/**
 * Where the checker that just moved was sitting before it moved.
 *
 * Read off the board rather than off the state, in viewport pixels: the two
 * rows are a grid with a fixed-width bar wedged into the middle of it, so the
 * distance between two points is not a number this component knows at any
 * given width. What it does know is how a stack is built, checkers of one
 * width laid from the outer edge of the row inwards, so the slot's own box plus
 * a count gives the exact centre of the checker that left.
 *
 * The count is taken *after* the move, which is the same number: a checker
 * leaving a point of four was the fifth, sitting on top of the three now under
 * it plus itself... which is to say on top of the four that remain minus none.
 * Capped at the five that are actually drawn, for the same reason the stack is.
 */
function departedFrom(
  board: HTMLElement,
  last: BgLast,
  view: number,
  size: number,
): { x: number; y: number } | null {
  const slot =
    last.from === "bar"
      ? board.querySelector<HTMLElement>(
          `.bar-stack.${last.seat === view ? "bottom" : "top"}`,
        )
      : board.querySelector<HTMLElement>(`[data-slot="${last.from}"]`);
  if (!slot) return null;

  const box = slot.getBoundingClientRect();
  const stacked = Math.min(slot.querySelectorAll(".checker").length, 4);
  // Which edge a stack grows from is the same question the CSS answers with
  // `column-reverse`, and the same answer: away from the near rail.
  const fromBottom =
    last.from === "bar"
      ? last.seat === view
      : (slot.closest(".bg-row")?.classList.contains("bottom") ?? false);
  const offset = (stacked + 0.5) * size;
  return {
    x: box.left + box.width / 2,
    y: fromBottom ? box.bottom - offset : box.top + offset,
  };
}

/**
 * Send the checker that just moved across the board it just crossed.
 *
 * The checker is already drawn where it landed by the time this runs, React
 * having committed, so the flight is backwards: measure the gap to where it
 * came from, start it there, and let it fall to nothing. Nothing is animated
 * into a position the reducer has not agreed to, and a device that drops the
 * animation shows the finished position rather than a checker stranded
 * mid-board.
 *
 * The Web Animations API rather than a keyframe, because the distance is
 * measured at the moment of the move and a keyframe cannot be told a number.
 */
function flyLastMove(board: HTMLElement | null, last: BgLast | null, view: number): void {
  if (!board || !last || last.to === "off" || wantsStillness()) return;

  const landed = board.querySelector<HTMLElement>(
    `[data-slot="${last.to}"] .checker:last-of-type`,
  );
  // `animate` is missing under jsdom, where boards are rendered by tests.
  if (!landed || typeof landed.animate !== "function") return;
  const arrival = landed.getBoundingClientRect();
  if (arrival.width === 0) return; // not laid out yet; nothing to measure against

  const start = departedFrom(board, last, view, arrival.width);
  if (!start) return;

  const dx = start.x - (arrival.left + arrival.width / 2);
  const dy = start.y - (arrival.top + arrival.height / 2);
  landed.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
    { duration: FLIGHT_MS, easing: FLIGHT_EASE },
  );
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
 * the one being pointed at. Stroked rather than clipped a second time, because
 * insetting the clip-path narrows the line away to nothing towards the apex
 * where a non-scaling stroke holds an even two pixels however wide the board is
 * drawn. The polygon is the `.triangle` clip-path in viewBox units, so the two
 * are changed together.
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
  const boardRef = useRef<HTMLDivElement>(null);

  // Keyed on the move number, not on `last` itself. State arrives over the
  // wire and is parsed fresh on every push, so the object is new each time and
  // an effect watching it would fly the same checker again whenever anything
  // else in the room changed. See `BgLast`.
  const played = state.last?.n ?? 0;
  useEffect(() => {
    flyLastMove(boardRef.current, state.last, view);
    // `state.last` is deliberately not a dependency: `played` is the fact that
    // it changed, and re-running on identity is the bug above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [played, view]);

  // Nothing is markable while the dice are still rolling. The marks are read
  // *off* the dice, and a board lighting up the points a 6 can reach before the
  // 6 has stopped has told you the roll ahead of the die showing it.
  const moves = canAct && !flying ? legalMoves(state) : [];

  // A selection stops meaning anything the moment the position changes.
  useEffect(() => setSelected(null), [state.points, state.dice, state.turn]);

  // Forced re-entry: if the only legal moves come off the bar, pre-select it.
  const barOnly = moves.length > 0 && moves.every((m) => m.from === "bar");
  const active = selected ?? (barOnly ? "bar" : null);

  const sources = new Set(moves.map((m) => String(m.from)));
  const fromActive = active === null ? [] : moves.filter((m) => m.from === active);
  const targets = new Map(fromActive.map((m) => [String(landingOf(view, m.from, m.die)), m.die]));

  // Whose checker was just knocked off, if one was. The bar says so on the
  // stack it lands in: a checker appearing on the bar with no announcement is
  // the one event on this board that can be missed entirely, because it happens
  // on the opponent's turn and a point you were on simply empties.
  const struck = state.last?.hit ? 1 - state.last.seat : null;

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

    // Your own six home points are marked along the rail. Bearing off is the
    // one rule on this board that depends on where the *rest* of your checkers
    // are, and until the board said which six points those were, the only way
    // to check was to count triangles from the corner.
    const home = isHome(view, index) ? " home" : "";

    return (
      <button
        key={index}
        data-slot={index}
        className={`point surface ${index % 2 === 0 ? "dark" : "light"}${home}`}
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
      <div className="bg-board" ref={boardRef}>
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
          {/* Keyed on the move number so the flash plays again on the next
              hit: a CSS animation runs on mount, and a class that was already
              there when the second checker arrived would not restart it. */}
          <span
            key={`top-${played}`}
            className={`bar-stack top${struck === (view === 1 ? 0 : 1) ? " struck" : ""}`}
          >
            {state.bar[view === 1 ? 0 : 1] > 0 && (
              <Checkers count={state.bar[view === 1 ? 0 : 1]} seat={(view === 1 ? 0 : 1) as 0 | 1} />
            )}
          </span>
          <span
            key={`bottom-${played}`}
            className={`bar-stack bottom${struck === view ? " struck" : ""}`}
          >
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
        {/* Keyed for the same reason the bar stacks are: a checker coming off
            is the other thing that happens away from where you were looking,
            at the far end of a line of text that never moves. */}
        <span
          key={`borne-${played}`}
          className={`borne${state.last?.to === "off" && state.last.seat === view ? " landed" : ""}`}
        >
          Borne off: you {state.off[view]}, them {state.off[1 - view]}
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
 * The pip lead, drawn as it moved.
 *
 * Above the line is the viewer ahead. One line rather than two pip counts,
 * because both counts fall all game: two lines sloping the same way, with the
 * only question a race actually asks, who was in front, living in the gap
 * between them that neither line draws.
 *
 * Scaled to the biggest lead either player held, so a game that stayed close
 * fills the box just as a runaway does; the number under it says which kind it
 * was. Stroked with a non-scaling stroke over a stretched viewBox, the same
 * trick the landing outline uses, so the line is the same weight at any width.
 */
function RaceChart({ race, view }: { race: number[]; view: number }) {
  // The stored lead is seat 0's. Everyone reads a chart as being about
  // themselves, so seat 1 sees it flipped rather than upside down.
  const lead = race.map((n) => (view === 0 ? n : -n));
  const peak = Math.max(10, ...lead.map(Math.abs));
  const span = Math.max(1, lead.length - 1);
  const path = lead
    .map((n, i) => `${i === 0 ? "M" : "L"} ${(i / span) * 100} ${50 - (n / peak) * 46}`)
    .join(" ");
  const best = Math.max(...lead);
  const worst = Math.min(...lead);

  return (
    <div className="bg-race">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="level" x1="0" y1="50" x2="100" y2="50" vectorEffect="non-scaling-stroke" />
        <path d={path} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="caption">
        {/* Both ends of the swing, because either can be the story: a game won
            from behind and a game never in doubt have the same final score. */}
        {best > 0 ? `Ahead by as much as ${best} pips` : "Never in front"}
        {worst < 0 ? `, behind by as much as ${-worst}` : ""}
      </p>
    </div>
  );
}

/**
 * What the two of you did with the dice, once it no longer matters.
 *
 * None of this is in the final position, since a hit leaves no trace once the
 * checker comes back in and a die nobody could play leaves none at all, so it
 * is counted as the game goes and spent here. Luck and use are kept apart on
 * purpose: pips *offered* is the dice's doing, pips *wasted* is the position's,
 * and a player who lost the race while rolling better has been told something
 * worth knowing.
 */
function BackgammonSummary({ state, seat }: { state: BgState; seat: number | null }) {
  const view = seat ?? 0;
  const mine = state.stats[view];
  const theirs = state.stats[1 - view];

  const rows: Array<[string, number | string, number | string]> = [
    ["Turns rolled", mine.rolls, theirs.rolls],
    ["Doubles", mine.doubles, theirs.doubles],
    ["Pips rolled", mine.pips, theirs.pips],
    ["Pips wasted", mine.wasted, theirs.wasted],
    ["Blots hit", mine.hits, theirs.hits],
    ["Borne off", `${state.off[view]}/${CHECKERS}`, `${state.off[1 - view]}/${CHECKERS}`],
  ];

  return (
    <div className="bg-stats">
      <h2>How it went</h2>
      <RaceChart race={state.race} view={view} />
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col">You</th>
            <th scope="col">Them</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ours, theirsValue]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{ours}</td>
              <td>{theirsValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Backgammon, board and controls.
 *
 * They are one component because they share one fact: whether the dice have
 * stopped. The board draws what the roll makes legal and the controls draw the
 * roll itself, so a flag held separately in each would let one answer before
 * the other, exactly the thing the tray exists to prevent.
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
      {state.winner === null ? (
        <BackgammonStatus
          state={state}
          seat={seat}
          canAct={canAct}
          flying={flying}
          onThrow={(thrown) => onMove({ type: "roll", throw: thrown })}
          onPass={() => onMove({ type: "pass" })}
          onRest={land}
        />
      ) : (
        // The tray goes when the game does. It is a control, and leaving a
        // pip count and a pair of dead dice under a finished board says the
        // turn is still waiting on somebody.
        <BackgammonSummary state={state} seat={seat} />
      )}
    </>
  );
}

/**
 * The pip count, the dice, and whatever the turn is waiting on.
 *
 * The pair a turn is played from is a *pair on the table*, so it is thrown
 * onto one: a tray, at a size worth looking at, rather than two 32px squares in
 * a status line. Dice already played dim rather than vanish, because the row
 * shrinking as you spent them made the turn's remaining dice harder to count
 * rather than easier, the thing you are counting having kept moving.
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

  // Two dice, because two dice were thrown. See `diceOnTable`, where the
  // double's four moves are turned back into the pair on the table.
  const { thrown, double, left, spent } = diceOnTable(state);

  /*
    A double, marked the same way a Yahtzee is. The tray owns the gesture and
    scales it down for a pair, because a double turns up every few throws and a
    flourish that big every few throws stops being one.

    `double` is already computed above for the hint, so this is the fact the
    board had anyway rather than a second opinion about the dice.
  */
  const cheer = state.toss && double ? { n: state.toss.n, kind: "pair" as const } : null;

  return (
    <div className="bg-controls">
      <span className="race">
        {pipCount(state, view)} pips to go - they have {pipCount(state, 1 - view)}
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
        cheer={cheer}
        label={diceLabel(thrown, state.dice, flying, state.phase)}
        hint={
          canRoll
            ? "Flick to throw"
            : double && state.phase === "move" && !flying
              ? `Double, ${left} of four to play`
              : undefined
        }
        onThrow={canRoll ? onThrow : undefined}
        onRest={onRest}
      />

      {canRoll && (
        // The tray is the throw; this is the same throw for a thumb that would
        // rather press something, and the one a keyboard reaches first.
        // Through the tray, so the button throws the same dice the flick does.
        // The physics is in there.
        <button className="primary" onClick={() => trayRef.current?.throwNow({ x: 0, y: 0 })}>
          Roll
        </button>
      )}
      {stuck && (
        <button className="primary" onClick={onPass}>
          No moves, end turn
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
  // which numbers are left. They are all the same number.
  if (thrown[0] === thrown[1]) {
    if (left.length === 0) return `${rolled}, a double, all four played`;
    return `${rolled}, a double; ${left.length} of four still to play`;
  }
  if (left.length === 0) return `${rolled}, all played`;
  if (left.length === thrown.length) return rolled;
  return `${rolled}; ${left.join(" and ")} still to play`;
}
