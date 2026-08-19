import { useEffect, useState } from "react";
import {
  ALPHABET,
  BLANK,
  ROUNDS,
  VOWELS,
  VOWEL_COST,
  money,
  type WofMove,
  type WofState,
} from "../../shared/games/wheel.js";

interface Props {
  state: WofState;
  seat: number | null;
  names: string[];
  myTurn: boolean;
  onMove(move: WofMove): void;
}

/**
 * The puzzle board is drawn from the *masked* answer — the only version this
 * component has ever seen. `_` is a letter nobody has called; everything else
 * is on the board because it was called, or because it was never hidden.
 */
function tileClass(ch: string, justCalled: string | null): string {
  if (ch === BLANK) return "wof-tile blank";
  if (!ALPHABET.includes(ch)) return "wof-tile mark";
  return ch === justCalled ? "wof-tile letter just" : "wof-tile letter";
}

/**
 * The board read out rather than looked at. Letter by letter, because "blank
 * P blank blank C E" is the information — "_PIECE" is not something a screen
 * reader says usefully.
 */
function spoken(answer: string): string {
  return answer
    .split(" ")
    .map((word) => [...word].map((ch) => (ch === BLANK ? "blank" : ch)).join(" "))
    .join(", ");
}

export function WheelBoard({ state, seat, names, myTurn, onMove }: Props) {
  const [solving, setSolving] = useState(false);
  const [guess, setGuess] = useState("");

  // A half-typed answer stops meaning anything the moment the turn moves on or
  // a new puzzle goes up.
  useEffect(() => {
    if (!myTurn) {
      setSolving(false);
      setGuess("");
    }
  }, [myTurn]);
  useEffect(() => {
    setSolving(false);
    setGuess("");
  }, [state.round]);

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  const bank = seat === null ? 0 : (state.bank[seat] ?? 0);
  const canBuyVowel = myTurn && state.phase === "spin" && bank >= VOWEL_COST;
  const justCalled = state.roundOver
    ? null
    : (state.called[state.called.length - 1] ?? null);

  function submitSolve(event: React.FormEvent) {
    event.preventDefault();
    if (!guess.trim()) return;
    onMove({ type: "solve", answer: guess });
    setSolving(false);
    setGuess("");
  }

  return (
    <div className="wof">
      <p className="wof-round">
        Round {state.round} of {ROUNDS} · {state.category}
      </p>

      <div
        className="wof-puzzle"
        role="img"
        aria-label={`${state.category}. ${spoken(state.answer)}`}
      >
        {state.answer.split(" ").map((word, w) => (
          <span className="wof-word" key={w} aria-hidden="true">
            {[...word].map((ch, i) => (
              <span key={i} className={tileClass(ch, justCalled)}>
                {ch === BLANK ? "" : ch}
              </span>
            ))}
          </span>
        ))}
      </div>

      {/* The one thing a player most needs to know and cannot see anywhere
          else: what just happened, and to whom. */}
      <p className="wof-note" role="status" aria-live="polite">
        {state.note ? `${nameFor(state.note.seat)} ${state.note.text}` : ""}
      </p>

      {!state.roundOver && (
        <div className="wof-wheel">
          {state.wedge?.kind === "cash" ? (
            <>
              <span className="wof-value">{money(state.wedge.value)}</span>
              <span className="wof-prompt">for every letter found</span>
            </>
          ) : (
            <span className="wof-prompt">
              {myTurn ? "Spin, buy a vowel, or solve" : "Waiting on the wheel"}
            </span>
          )}
        </div>
      )}

      {/* Above the keyboard, not below it: the keys are the tallest block on
          the page, and a Spin button under twenty-six of them is a Spin button
          below the fold on a four-handed game. */}
      {solving ? (
        <form className="wof-solve" onSubmit={submitSolve}>
          <label className="wof-guess">
            Your answer
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder={state.category}
              maxLength={60}
              autoFocus
            />
          </label>
          <div className="wof-actions">
            <button className="primary" type="submit" disabled={!guess.trim()}>
              Solve it
            </button>
            <button type="button" onClick={() => setSolving(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="wof-actions">
          {state.roundOver ? (
            !state.over && (
              <button className="primary" disabled={!myTurn} onClick={() => onMove({ type: "next" })}>
                Start round {state.round + 1}
              </button>
            )
          ) : (
            <>
              <button
                className="primary"
                disabled={!myTurn || state.phase !== "spin"}
                onClick={() => onMove({ type: "spin" })}
              >
                Spin
              </button>
              <button
                disabled={!myTurn || state.phase !== "spin"}
                onClick={() => setSolving(true)}
              >
                Solve
              </button>
            </>
          )}
        </div>
      )}

      {!state.roundOver && (
        <>
          <div className="wof-keys">
            {[...ALPHABET].map((letter) => {
              const spent = state.called.includes(letter);
              const vowel = VOWELS.includes(letter);
              const usable =
                myTurn && !spent && (state.phase === "call" ? !vowel : vowel && canBuyVowel);
              return (
                <button
                  key={letter}
                  className={spent ? "wof-key spent" : "wof-key"}
                  disabled={!usable}
                  onClick={() => onMove({ type: "letter", letter })}
                  aria-label={
                    spent
                      ? `${letter}, already called`
                      : vowel
                        ? `Buy the vowel ${letter} for ${money(VOWEL_COST)}`
                        : `Call the letter ${letter}`
                  }
                >
                  {letter}
                </button>
              );
            })}
          </div>
          <p className="wof-legend">
            {state.phase === "call"
              ? "Name a consonant."
              : `Consonants need a spin. Vowels cost ${money(VOWEL_COST)}.`}
          </p>
        </>
      )}
      {/* Last, because it is read rather than used. Everything above it is
          something you tap, and at four players a scoreboard in the middle
          pushed the keys off the bottom of the phone. Every change to it is
          narrated in the note line as it happens. */}
      <div className="wof-money">
        {state.bank.map((amount, index) => (
          <div
            key={index}
            className={["wof-purse", `p${index}`, state.turn === index && !state.over ? "active" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="chip" aria-hidden="true" />
            <span className="who">{nameFor(index)}</span>
            <span className="round">{money(amount)}</span>
            <span className="banked">{money(state.score[index] ?? 0)} banked</span>
          </div>
        ))}
      </div>
    </div>
  );
}
