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

interface Props {
  state: YState;
  seat: number | null;
  names: string[];
  myTurn: boolean;
  onMove(move: YMove): void;
}

/** Pip counts, drawn in CSS. A face of 0 is a die that has not been rolled. */
function Die({
  face,
  held,
  index,
  usable,
  onToggle,
}: {
  face: number;
  held: boolean;
  index: number;
  usable: boolean;
  onToggle(): void;
}) {
  const label = face === 0 ? `Die ${index + 1}, not rolled` : `Die ${index + 1}, ${face}${held ? ", kept" : ""}`;
  return (
    <button
      className={["yz-die", held ? "held" : "", face === 0 ? "blank" : ""].filter(Boolean).join(" ")}
      data-face={face}
      disabled={!usable}
      onClick={onToggle}
      aria-pressed={held}
      aria-label={label}
    >
      {Array.from({ length: face }, (_, pip) => (
        <i key={pip} aria-hidden="true" />
      ))}
    </button>
  );
}

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

export function YahtzeeBoard({ state, seat, names, myTurn, onMove }: Props) {
  const rolled = state.rollsLeft < ROLLS;
  const canRoll = myTurn && state.rollsLeft > 0;
  const canKeep = myTurn && rolled && state.rollsLeft > 0;
  // Which boxes this hand may go in is a rule, not a hint: the reducer refuses
  // the same ones, so greying them out here only saves a round trip.
  const legal =
    myTurn && rolled && seat !== null ? legalCategories(state.sheets[seat], state.dice) : [];

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

      <div className="yz-dice" role="group" aria-label="The dice">
        {state.dice.map((face, index) => (
          <Die
            key={index}
            face={face}
            index={index}
            held={state.held[index]}
            usable={canKeep}
            onToggle={() => onMove({ type: "hold", die: index })}
          />
        ))}
      </div>

      {/* The one thing a player cannot see anywhere else: what just happened,
          and to whom. Same job as the Wheel's note line. */}
      <p className="yz-note" role="status" aria-live="polite">
        {state.note ? `${nameFor(state.note.seat)} ${state.note.text}` : ""}
      </p>

      <div className="yz-actions">
        <button className="primary" disabled={!canRoll} onClick={() => onMove({ type: "roll" })}>
          {rolled ? `Roll again (${state.rollsLeft})` : "Roll"}
        </button>
        <p className="yz-legend">
          {!myTurn
            ? "Waiting for the dice"
            : !rolled
              ? "Three rolls, then fill a box."
              : state.rollsLeft > 0
                ? "Tap a die to keep it."
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
