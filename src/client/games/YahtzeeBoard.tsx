import { useRef } from "react";
// Values from yahtzeeDisplay.js, which imports nothing: the board needs the
// scoring table at runtime to show a player what a box would be worth, and
// taking it from the reducer would pull `applyMove` and the whole registry
// into the client bundle. `bundle.test.ts` holds that line for every game.
import {
  CATEGORIES,
  CATEGORY_NAME,
  EXTRA_YAHTZEE,
  LOWER,
  ROLLS,
  UPPER,
  UPPER_BONUS,
  UPPER_TARGET,
  YAHTZEE_TRAY,
  jokerApplies,
  legalCategories,
  scoreFor,
  total,
  upperBonus,
  upperSubtotal,
} from "../../shared/games/yahtzeeDisplay.js";
import type {
  Category,
  Sheet,
  YMove,
  YState,
} from "../../shared/games/yahtzeeDisplay.js";
import type { ThrownDice } from "../../shared/games/toss.js";
import { Dice3DTray, type DiceTrayHandle } from "../dice3d/Dice3DTray.js";
import { useLanding } from "../dice/useLanding.js";

/**
 * The tray, read out. One label rather than five, because "die showing three,
 * die showing three, die showing five" is a worse way to hear a hand than
 * "3, 3, 5, 2, 6" is — and the dice inside are moved by a solver, so they are
 * not five things to visit in order.
 */
function trayLabel(state: YState, flying: boolean, rolled: boolean): string {
  if (flying) return "The dice, in the air";
  if (!rolled) return "The dice, not thrown yet";
  const faces = state.dice
    .map((face, i) => `${face}${state.held[i] ? " kept" : ""}`)
    .join(", ");
  return `The dice: ${faces}`;
}

import type { BoardProps } from "./boards.js";

type Props = BoardProps<YState, YMove>;

/**
 * A cell on someone's card. Three states, and they have to be told apart at a
 * glance: filled (a number, and it is settled), open (blank), or open to *you*
 * right now (a button showing what this hand would be worth there).
 *
 * The preview is the whole interface. Yahtzee's decision is "which box does
 * this hand go in", and asking a player to do thirteen sums in their head on a
 * phone is asking them to play a different, worse game.
 */
function Box({
  sheet,
  category,
  dice,
  pickable,
  onScore,
}: {
  sheet: Sheet;
  category: Category;
  dice: number[];
  pickable: boolean;
  onScore(): void;
}) {
  const filled = sheet[category];
  if (filled !== null) {
    return <td className={filled === 0 ? "yz-box spent" : "yz-box"}>{filled}</td>;
  }
  if (!pickable) return <td className="yz-box" />;

  const worth = scoreFor(category, dice, jokerApplies(sheet, dice));
  return (
    <td className="yz-box">
      <button
        className={worth === 0 ? "yz-pick zero" : "yz-pick"}
        onClick={onScore}
        aria-label={`Score ${CATEGORY_NAME[category]} for ${worth}`}
      >
        {worth}
      </button>
    </td>
  );
}

export function YahtzeeBoard({ state, seat, names, canAct, onMove }: Props) {
  const [flying, land] = useLanding(state.toss?.n ?? 0);
  const rolled = state.rollsLeft < ROLLS;
  const keepingAll = rolled && state.held.every(Boolean);
  // Keeping all five and rolling again spends a roll and moves nothing, so
  // there is nothing to press. The reducer refuses it too; this only saves the
  // round trip and the error.
  const canRoll = canAct && state.rollsLeft > 0 && !flying && !keepingAll;
  const canKeep = canAct && rolled && state.rollsLeft > 0 && !flying;
  // Which boxes this hand may go in is a rule, not a hint: the reducer refuses
  // the same ones, so greying them out here only saves a round trip.
  //
  // Withheld while the dice are in the air. Thirteen previews appearing before
  // the dice they are computed from have stopped is the sheet answering a
  // question nobody has finished asking.
  const legal =
    canAct && rolled && !flying && seat !== null
      ? legalCategories(state.sheets[seat], state.dice)
      : [];

  const trayRef = useRef<DiceTrayHandle>(null);
  const throwDice = (thrown: ThrownDice) => onMove({ type: "roll", throw: thrown });

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  const row = (category: Category) => (
    <tr key={category} className={legal.includes(category) ? "yz-row open" : "yz-row"}>
      <th scope="row">{CATEGORY_NAME[category]}</th>
      {state.sheets.map((sheet, index) => (
        <Box
          key={index}
          sheet={sheet}
          category={category}
          dice={state.dice}
          pickable={index === seat && legal.includes(category)}
          onScore={() => onMove({ type: "score", category })}
        />
      ))}
    </tr>
  );

  return (
    <div className="yz">
      <p className="yz-round">
        Round {state.round} of {CATEGORIES.length}
      </p>

      <Dice3DTray
        ref={trayRef}
        count={state.dice.length}
        tray={YAHTZEE_TRAY}
        faces={state.dice}
        toss={state.toss}
        flying={flying}
        mine={canAct}
        held={state.held}
        keepable={canKeep}
        label={trayLabel(state, flying, rolled)}
        hint={canAct && !flying ? (rolled ? "Tap a die to keep it" : "Flick to throw") : undefined}
        onThrow={canRoll ? throwDice : undefined}
        onTapDie={(die) => canKeep && onMove({ type: "hold", die })}
        onRest={land}
      />

      {/* The one thing a player cannot see anywhere else: what just happened,
          and to whom. Same job as the Wheel's note line. */}
      <p className="yz-note" role="status" aria-live="polite">
        {state.note ? `${nameFor(state.note.seat)} ${state.note.text}` : ""}
      </p>

      <div className="yz-actions">
        {/* The button is the floor, not the ceiling: the tray is the throw,
            and this is the same throw for a thumb that would rather press
            something, and the one a keyboard reaches without focusing the
            tray. */}
        <button
          className="primary"
          disabled={!canRoll}
          // Through the tray, so the button throws the same dice the flick
          // does — the physics is in there, and a move sent from here without
          // it would land the dice with no throw to watch.
          onClick={() => trayRef.current?.throwNow({ x: 0, y: 0 })}
        >
          {rolled ? `Roll again (${state.rollsLeft})` : "Roll"}
        </button>
        <p className="yz-legend">
          {!canAct
            ? "Waiting for the dice"
            : flying
              ? "…"
              : !rolled
                ? "Three rolls, then fill a box. Flick the tray to throw."
                : keepingAll
                  ? "You are keeping all five — fill a box."
                  : state.rollsLeft > 0
                    ? "Tap a die to keep it, or throw the rest."
                    : "Tap a score to fill that box."}
        </p>
      </div>

      <table className="yz-sheet">
        <caption className="sr-only">The score sheet</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Box</span>
            </th>
            {state.sheets.map((_, index) => (
              <th
                key={index}
                scope="col"
                className={["yz-who", `p${index}`, state.turn === index && !state.over ? "active" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {nameFor(index)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {UPPER.map(row)}
          <tr className="yz-sum">
            <th scope="row">
              Bonus at {UPPER_TARGET}
              <span className="sr-only"> — {UPPER_BONUS} points</span>
            </th>
            {state.sheets.map((sheet, index) => (
              <td key={index}>
                <span className="yz-progress">{upperSubtotal(sheet)}</span>
                {upperBonus(sheet) > 0 ? ` +${UPPER_BONUS}` : ""}
              </td>
            ))}
          </tr>
          {LOWER.map(row)}
          {state.extras.some((count) => count > 0) && (
            <tr className="yz-sum">
              <th scope="row">Extra Yahtzees</th>
              {state.extras.map((count, index) => (
                <td key={index}>{count > 0 ? count * EXTRA_YAHTZEE : ""}</td>
              ))}
            </tr>
          )}
          <tr className="yz-total">
            <th scope="row">Total</th>
            {state.sheets.map((sheet, index) => (
              <td key={index}>{total(sheet, state.extras[index])}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
