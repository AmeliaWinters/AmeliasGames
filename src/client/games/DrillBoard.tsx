/**
 * Drill: one card at a time, alone.
 *
 * The quietest board in the app, and deliberately. Everything else here draws
 * a table with somebody else at it; this draws a card, a box to type in, and a
 * count of how far through you are. There is nobody to react to, no seat strip,
 * no turn to wait for — so anything that would be atmosphere in another game is
 * noise in this one.
 *
 * It imports the display module and never the reducer, for the two reasons
 * `drillDisplay.ts` sets out: the word lists are the second largest thing in
 * the repo, and the answer to the clue on screen is a secret until the card
 * settles.
 */
import { useEffect, useRef, useState } from "react";
import {
  DRILL_CARDS,
  DRILL_LANGS,
  DRILL_LANG_NAME,
  canAct,
  formatClock,
  msLeftFor,
  tally,
  type DrillLang,
  type DrillMove,
  type DrillState,
} from "../../shared/games/drillDisplay.js";
import { useServerNow } from "../clock.js";

/** The countdown on the open card. */
function Clock({ state, now }: { state: DrillState; now: number }) {
  const left = msLeftFor(state, now);
  return (
    <span
      className={left <= 5000 ? "drill-clock drill-clock-low" : "drill-clock"}
      // Not a live region: it changes every tenth of a second, and a screen
      // reader announcing that is a screen reader nobody can use. The card and
      // its result are announced; the clock is for the eye.
      aria-hidden="true"
    >
      {formatClock(left)}
    </span>
  );
}

export function DrillBoard({
  state,
  seat,
  canAct: mayAct,
  now: serverNow,
  onMove,
}: {
  state: DrillState;
  seat: number | null;
  canAct: boolean;
  now: number;
  onMove(move: DrillMove): void;
}) {
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const now = useServerNow(serverNow, state.phase === "asking" || state.phase === "setup");

  // A new card is a new question, so the box empties itself rather than making
  // somebody clear the last answer out of it. Keyed on how many are done,
  // which is the one thing that changes exactly once per card.
  const cardNo = state.done.length;
  useEffect(() => {
    setTyped("");
    // Only where there is a keyboard already: focusing a field on a phone
    // throws the keyboard up over the clue the card just showed.
    if (matchMedia("(hover: hover)").matches) field.current?.focus();
  }, [cardNo, state.phase]);

  const live = mayAct && seat !== null && canAct(state, seat, now);

  if (state.phase === "setup") {
    return (
      <section className="drill drill-setup" aria-labelledby="drill-setup-head">
        <h2 id="drill-setup-head">Which language?</h2>
        <div className="drill-langs">
          {DRILL_LANGS.map((lang: DrillLang) => (
            <button
              key={lang}
              className="primary"
              disabled={!live}
              onClick={() => onMove({ type: "lang", lang })}
            >
              {DRILL_LANG_NAME[lang]}
            </button>
          ))}
        </div>
        <p className="hint">
          {DRILL_CARDS} cards. Words you owe a review on come first.
        </p>
      </section>
    );
  }

  if (state.phase === "over") {
    const counted = tally(state);
    return (
      <section className="drill drill-over" aria-labelledby="drill-over-head">
        <h2 id="drill-over-head">
          {state.done.length === 0
            ? "Nothing reviewed"
            : `${counted.right} of ${state.done.length} right`}
        </h2>
        {counted.reviewed > 0 && (
          <p className="drill-reviewed">
            {counted.reviewed} of them {counted.reviewed === 1 ? "was" : "were"} a review you owed.
          </p>
        )}
        <ul className="drill-list">
          {state.done.map((card, i) => (
            <li key={i} className={`drill-row drill-${card.how ?? "timeout"}`}>
              <span className="drill-w">
                {card.word}
                {card.script && <span className="drill-script">{card.script}</span>}
              </span>
              <span className="drill-g">{card.clue}</span>
              {/* What they typed, but only when it was wrong and only when
                  there was something: seeing your own near-miss beside the
                  answer is most of what makes a wrong card worth having. */}
              {card.how === "wrong" && card.said && (
                <span className="drill-said">you said {card.said}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const card = state.card;
  if (!card) return null;
  const revealing = state.phase === "reveal";

  return (
    <section className="drill" aria-labelledby="drill-clue">
      <header className="drill-top">
        <span className="drill-count">
          {state.done.length + 1} / {DRILL_CARDS}
        </span>
        {card.review && <span className="drill-due">review</span>}
        {!revealing && <Clock state={state} now={now} />}
      </header>

      {/* The clue is the question, so it is the largest thing on the board. */}
      <p className="drill-clue" id="drill-clue">
        {card.clue}
      </p>

      {revealing ? (
        <div className={`drill-answer drill-${card.how ?? "timeout"}`} role="status">
          <p className="drill-verdict">
            {card.how === "right"
              ? "Right"
              : card.how === "gave-up"
                ? "It was"
                : card.how === "timeout"
                  ? "Time. It was"
                  : "Not quite. It was"}
          </p>
          <p className="drill-word">
            {card.word}
            {card.script && <span className="drill-script">{card.script}</span>}
          </p>
          {/* The dictionary form, where the word asked about was an inflection
              of one. It is the row the ledger files this under, so it is the
              form worth learning. */}
          {card.lemma && card.lemma !== card.word && (
            <p className="drill-lemma">from {card.lemma}</p>
          )}
        </div>
      ) : (
        <form
          className="drill-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (!live || !typed.trim()) return;
            onMove({ type: "say", word: typed });
          }}
        >
          <label className="sr-only" htmlFor="drill-say">
            The word
          </label>
          <input
            id="drill-say"
            ref={field}
            value={typed}
            disabled={!live}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            // Latin letters, because Polish is typed unaccented and Japanese in
            // romaji. `chainLookup` folds whatever arrives, so a player who
            // does have the accents on their keyboard is not punished for
            // using them.
            inputMode="text"
          />
          <div className="drill-acts">
            <button className="primary" disabled={!live || !typed.trim()}>
              Answer
            </button>
            {/* Not a forfeit. Saying you do not know it is how the session
                keeps moving, and the ledger treats it as one rung better than
                a wrong guess. */}
            <button type="button" disabled={!live} onClick={() => onMove({ type: "pass" })}>
              I don't know it
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

