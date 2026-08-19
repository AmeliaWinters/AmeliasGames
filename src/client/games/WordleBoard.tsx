import { useEffect, useRef, useState } from "react";
// Values from wordleDisplay.js, which imports nothing — the board must never
// pull the reducer (and the word list with it) into the client bundle. The
// types below are type-only, so they are erased and carry no runtime import.
import {
  HIDDEN,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  isFinished,
  opponentOf,
} from "../../shared/games/wordleDisplay.js";
import type {
  Mark,
  Row,
  WordleMove,
  WordleState,
} from "../../shared/games/wordleDisplay.js";

interface Props {
  state: WordleState;
  seat: number | null;
  names: string[];
  onMove(move: WordleMove): void;
}

/**
 * Note the absence of `myTurn`. Play here is free-simultaneous, so `room.turn`
 * says nothing about whether *you* may type — `canAct` does, and it is the
 * only thing this component asks.
 */

/** Six rows always, so the grid does not grow and shove the input around. */
function padRows(rows: Row[]): Array<Row | null> {
  return Array.from({ length: MAX_GUESSES }, (_, i) => rows[i] ?? null);
}

/**
 * Colour named as well as shown. The whole game is in these three states, and
 * a player who cannot tell green from yellow would otherwise be reading an
 * empty grid.
 */
const MARK_LABEL: Record<Mark, string> = {
  hit: "correct",
  near: "elsewhere in the word",
  miss: "not in the word",
};

function GuessGrid({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="wd-grid" role="table" aria-label={label}>
      {padRows(rows).map((row, index) => (
        <div className="wd-row" role="row" key={index}>
          {Array.from({ length: WORD_LENGTH }, (_, i) => {
            const letter = row?.word[i] ?? "";
            const mark = row?.marks[i];
            return (
              <span
                role="cell"
                key={i}
                className={mark ? `wd-tile ${mark}` : "wd-tile blank"}
                // The letter alone would be read as a bare column of letters
                // with none of the information that makes it a Wordle grid.
                aria-label={mark ? `${letter}, ${MARK_LABEL[mark]}` : "empty"}
              >
                {letter}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * One five-letter box, used for both the word you set and every guess you
 * make. Kept uncontrolled-ish on purpose: filtering as the player types means
 * a stray digit never lands in the field at all.
 */
function WordInput({
  value,
  onChange,
  onSubmit,
  disabled,
  label,
  submitLabel,
  autoFocus,
}: {
  value: string;
  onChange(next: string): void;
  onSubmit(): void;
  disabled: boolean;
  label: string;
  submitLabel: string;
  autoFocus: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

  return (
    <form
      className="wd-entry"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="wd-label" htmlFor="wd-word">
        {label}
      </label>
      <div className="wd-entry-row">
        <input
          id="wd-word"
          ref={input}
          className="wd-input"
          value={value}
          disabled={disabled}
          maxLength={WORD_LENGTH}
          // Every one of these matters on a phone, where the default is a
          // capitalised, autocorrected, spell-checked mess fighting the player.
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder={"·".repeat(WORD_LENGTH)}
          aria-label={label}
          onChange={(event) =>
            onChange(event.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())
          }
        />
        <button
          type="submit"
          className="wd-submit"
          disabled={disabled || value.length !== WORD_LENGTH}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function WordleBoard({ state, seat, names, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const them = seat === null ? null : opponentOf(seat);

  // A half-typed word means nothing once it has been accepted, or once the
  // phase moves on underneath it.
  useEffect(() => {
    setDraft("");
  }, [state.phase, seat === null ? 0 : state.guesses[seat].length]);

  const nameFor = (index: number | null) =>
    index === null ? "" : index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A spectator (no seat) watches; everything below reads as "not my move".
  const mine = seat !== null;
  const myMove = mine && canAct(state, seat);

  function submit() {
    if (draft.length !== WORD_LENGTH) return;
    onMove({ type: state.phase === "setup" ? "setWord" : "guess", word: draft });
    setDraft("");
  }

  if (state.phase === "setup") {
    const yourWord = mine ? state.secrets[seat] : null;
    // `HIDDEN` rather than null is how a chosen-but-secret word reaches us, so
    // this distinguishes "they are ready" from "they are still thinking".
    const theyAreReady = them !== null && state.secrets[them] !== null;

    return (
      <div className="board wd-board wd-setup">
        <p className="wd-brief">
          Pick a five-letter word for {nameFor(them) || "your opponent"} to
          guess. Slang and swearing are fair game.
        </p>

        {yourWord === null ? (
          <WordInput
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            disabled={!myMove}
            label="Your word"
            submitLabel="Lock it in"
            autoFocus
          />
        ) : (
          <p className="wd-locked">
            Your word is <strong>{yourWord}</strong>. No changing it now.
          </p>
        )}

        <p className="wd-waiting" aria-live="polite">
          {theyAreReady
            ? `${nameFor(them)} is ready.`
            : `Waiting for ${nameFor(them) || "the other player"} to choose.`}
        </p>
      </div>
    );
  }

  const over = state.phase === "over";

  return (
    <div className="board wd-board">
      <div className="wd-panels">
        {/*
          You on the left, them on the right. Each panel shows the word that
          side is hunting and every attempt they have made on it. Both sides
          are open, and that gives nothing away: you are each guessing the
          other's word, so their guesses at yours tell you only what you could
          already mark yourself.
        */}
        {[seat, them]
          .filter((side): side is number => side !== null)
          .map((side) => {
            // The word this side is hunting is the one their opponent set.
            const target = state.secrets[opponentOf(side)];
            const solved = state.solvedIn[side];
            const yours = side === seat;
            return (
              <section className="wd-panel" key={side}>
                <h3 className="wd-panel-head">
                  <span>{yours ? "You" : nameFor(side)}</span>
                  <span className="wd-count">
                    {solved !== null
                      ? `solved in ${solved}`
                      : `${state.guesses[side].length}/${MAX_GUESSES}`}
                  </span>
                </h3>

                {/*
                  Your own word reads out in full on the right — it is yours,
                  you already know it. The one you are hunting stays masked
                  until the game ends and the server finally sends it.
                */}
                <p className={target === HIDDEN ? "wd-target masked" : "wd-target"}>
                  {target ?? "—"}
                </p>

                <GuessGrid
                  rows={state.guesses[side]}
                  label={
                    yours
                      ? "Your guesses"
                      : `${nameFor(side)} guessing your word`
                  }
                />
              </section>
            );
          })}
      </div>

      {mine && !over && (
        <>
          <WordInput
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            disabled={!myMove}
            label={`Guess ${nameFor(them)}'s word`}
            submitLabel="Guess"
            autoFocus
          />
          {!myMove && (
            <p className="wd-waiting" aria-live="polite">
              {state.solvedIn[seat] !== null
                ? `You got it in ${state.solvedIn[seat]}. Waiting for ${nameFor(them)}.`
                : `Out of guesses. Waiting for ${nameFor(them)}.`}
            </p>
          )}
          {myMove && them !== null && isFinished(state, them) && (
            <p className="wd-waiting" aria-live="polite">
              {nameFor(them)} is done — the table is yours.
            </p>
          )}
        </>
      )}
    </div>
  );
}
