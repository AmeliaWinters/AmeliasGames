import { useEffect, useRef, useState } from "react";
// Values from wordleDisplay.js, which imports nothing — the board must never
// pull the reducer (and the word list with it) into the client bundle. The
// types below are type-only, so they are erased and carry no runtime import.
import {
  HIDDEN,
  KEY_ROWS,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  clockCall,
  formatClock,
  guesserOf,
  keyMarks,
  msLeftFor,
  seatsOf,
  targetOf,
} from "../../shared/games/wordleDisplay.js";
import type {
  Mark,
  Row,
  WordleMove,
  WordleState,
} from "../../shared/games/wordleDisplay.js";
import { useServerNow } from "../clock.js";

interface Props {
  state: WordleState;
  seat: number | null;
  names: string[];
  /** The server's clock as of this state — see `useServerNow`. */
  now: number;
  onMove(move: WordleMove): void;
}

/** Under this much left on the shot clock, it starts shouting about it. */
const URGENT_MS = 15 * 1000;

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


/**
 * The keyboard, doing the two jobs it does in Wordle: it is the record of what
 * you have learned, and on a phone it is how you type. Tapping beats the OS
 * keyboard here — that one covers half the screen, and this board's whole point
 * is watching two grids at once.
 *
 * It shows only your own letters. Your opponent's marks are against a different
 * word and would be worse than useless on these keys.
 */
function Keyboard({
  rows,
  disabled,
  onLetter,
  onBackspace,
  onEnter,
  canSubmit,
}: {
  rows: Row[];
  disabled: boolean;
  onLetter(letter: string): void;
  onBackspace(): void;
  onEnter(): void;
  canSubmit: boolean;
}) {
  const marks = keyMarks(rows);

  return (
    <div className="wd-keys" role="group" aria-label="Letters you have tried">
      {KEY_ROWS.map((row, index) => (
        <div className="wd-keys-row" key={row}>
          {/* Backspace and enter sit on the last row, as they do everywhere. */}
          {index === 2 && (
            <button
              type="button"
              className="wd-key wide"
              disabled={disabled || !canSubmit}
              onClick={onEnter}
            >
              Enter
            </button>
          )}
          {[...row].map((letter) => {
            const mark = marks[letter];
            return (
              <button
                type="button"
                key={letter}
                className={mark ? `wd-key ${mark}` : "wd-key"}
                disabled={disabled}
                onClick={() => onLetter(letter)}
                // Untried letters say nothing extra: "K, not yet tried" on
                // twenty-odd keys is noise, and silence already means that.
                aria-label={mark ? `${letter}, ${MARK_LABEL[mark]}` : letter}
              >
                {letter}
              </button>
            );
          })}
          {index === 2 && (
            <button
              type="button"
              className="wd-key wide"
              disabled={disabled}
              onClick={onBackspace}
              aria-label="Backspace"
            >
              ⌫
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function WordleBoard({ state, seat, names, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  // Two different people, and above two players they are not the same one:
  // `hunting` set the word you are guessing, and `setFor` is guessing yours.
  const hunting = seat === null ? null : targetOf(state, seat);
  const setFor = seat === null ? null : guesserOf(state, seat);

  // Only tick while a clock is actually running. Until somebody cracks a word
  // nobody is under the whistle, and there is nothing to count.
  const ticking = state.phase === "play" && state.dueBy.some((at) => at !== null);
  const clock = useServerNow(now, ticking);
  const myLeft = seat === null ? null : msLeftFor(state, seat, clock);
  // Everyone else still under the whistle. At two players this is the one
  // opponent; above two it is however many have yet to answer.
  const others =
    seat === null
      ? []
      : seatsOf(state).filter((s) => s !== seat && msLeftFor(state, s, clock) !== null);
  /** Everyone else who can still guess. */
  const live =
    seat === null ? [] : seatsOf(state).filter((s) => s !== seat && canAct(state, s));
  const alone = seat !== null && live.length === 0;
  const stillGoing =
    live.length === 0
      ? "Everyone else is done too."
      : live.length === 1
        ? `Waiting for ${names[live[0]] || `Player ${live[0] + 1}`}.`
        : `Waiting on ${live.length} others.`;

  // A half-typed word means nothing once it has been accepted, or once the
  // phase moves on underneath it.
  useEffect(() => {
    setDraft("");
  }, [state.phase, seat === null ? 0 : state.guesses[seat].length]);

  const nameFor = (index: number | null) =>
    index === null ? "" : index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A spectator (no seat) watches; everything below reads as "not my move".
  const mine = seat !== null;
  // The clock closes the input the moment it reads zero, rather than a
  // round-trip later — the server has already stopped taking guesses by then,
  // and a box that still accepts one is promising something it cannot deliver.
  const myMove = mine && canAct(state, seat) && myLeft !== 0;

  function submit() {
    if (draft.length !== WORD_LENGTH) return;
    onMove({ type: state.phase === "setup" ? "setWord" : "guess", word: draft });
    setDraft("");
  }

  if (state.phase === "setup") {
    const yourWord = mine ? state.secrets[seat] : null;
    // `HIDDEN` rather than null is how a chosen-but-secret word reaches us, so
    // this distinguishes "they are ready" from "they are still thinking".
    const waiting = seatsOf(state).filter((s) => s !== seat && state.secrets[s] === null);

    return (
      <div className="board wd-board wd-setup">
        <p className="wd-brief">
          Pick a five-letter word for {nameFor(setFor) || "the next player"} to
          guess. Slang and swearing are fair game. You will be hunting somebody
          else's — nobody ever gets their own. The guessing is untimed until
          somebody cracks their word — that puts everyone still hunting on a
          one-minute clock, and running it out finishes you.
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
          {waiting.length === 0
            ? "Everyone is ready."
            : waiting.length === 1
              ? `Waiting for ${nameFor(waiting[0])} to choose.`
              : `Waiting on ${waiting.length} more words.`}
        </p>
      </div>
    );
  }

  const over = state.phase === "over";

  return (
    <div className="board wd-board">
      <div className="wd-panels">
        {/*
          You first, then everybody else in seat order. Each panel shows the
          word that player is hunting and every attempt they have made on it.
          All of it is open, and that gives nothing away: the marks against a
          word are what anyone watching could work out for themselves.
        */}
        {seatsOf(state)
          .sort((a, b) => (a === seat ? -1 : b === seat ? 1 : a - b))
          .map((side) => {
            // The word this side is hunting is the one their own target set.
            const target = state.secrets[targetOf(state, side)];
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
                      : side === setFor
                        ? `${nameFor(side)} guessing your word`
                        : `${nameFor(side)}'s guesses`
                  }
                />
              </section>
            );
          })}
      </div>

      {mine && !over && (
        <>
          {/*
            The shot clock, and only when one is running: until somebody
            solves nobody is on one, and a 1:00 sitting there frozen would
            read as broken rather than as not yet started.
            Yours or theirs — whose it is changes the whole message, so the
            two are written out rather than shared.
          */}
          {myLeft !== null && (
            <p
              className={[
                "clock compact",
                myLeft <= URGENT_MS ? "urgent" : "",
                myLeft === 0 ? "done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // Announced when the wording changes, not on every tick: a
              // countdown read out four times a second is unusable with a
              // screen reader on.
              role="timer"
              aria-live="off"
            >
              <span className="clock-face">
                {myLeft === 0 ? "Time" : formatClock(myLeft)}
              </span>
              <span className="clock-note">
                {myLeft === 0 ? "you ran out" : "to guess"}
              </span>
              {/* The announcement the clock above cannot make without reading
                  itself out four times a second. `clockCall` changes only on
                  crossing a mark, so this speaks at a minute, thirty, ten and
                  time — and stays silent in between. */}
              <span className="sr-only" aria-live="polite">
                {clockCall(myLeft, true)}
              </span>
            </p>
          )}
          {others.length === 1 && (
            <p className="wd-waiting" aria-live="polite">
              {nameFor(others[0])} has{" "}
              {formatClock(msLeftFor(state, others[0], clock) as number)} to answer.
            </p>
          )}
          {others.length > 1 && (
            <p className="wd-waiting" aria-live="polite">
              {others.length} others are on the clock.
            </p>
          )}

          <WordInput
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            disabled={!myMove}
            label={`Guess ${nameFor(hunting)}'s word`}
            submitLabel="Guess"
            autoFocus
          />
          {!myMove && (
            <p className="wd-waiting" aria-live="polite">
              {state.solvedIn[seat] !== null
                ? `You got it in ${state.solvedIn[seat]}. ${stillGoing}`
                : myLeft === 0
                  ? "Your minute is up."
                  : `Out of guesses. ${stillGoing}`}
            </p>
          )}
          {myMove && alone && (
            <p className="wd-waiting" aria-live="polite">
              Everyone else is done — the table is yours, a minute a guess.
            </p>
          )}
          <Keyboard
            rows={state.guesses[seat]}
            disabled={!myMove}
            canSubmit={draft.length === WORD_LENGTH}
            onLetter={(letter) =>
              setDraft((current) =>
                current.length >= WORD_LENGTH ? current : current + letter,
              )
            }
            onBackspace={() => setDraft((current) => current.slice(0, -1))}
            onEnter={submit}
          />
        </>
      )}
    </div>
  );
}
