// Values from wheelDisplay.js, which imports nothing: the board must never
// pull the reducer (and its answer bank) into the client bundle. The types
// below are type-only, so they carry no runtime import.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ALPHABET,
  BLANK,
  FINDS_PER_TURN,
  ROUNDS,
  VOWELS,
  VOWEL_COST,
  WHEEL,
  money,
  spinMs,
  wedgeName,
} from "../../shared/games/wheelDisplay.js";
import type { WofMove, WofState } from "../../shared/games/wheel.js";
import { wantsStillness } from "../motion.js";

import type { BoardProps } from "./boards.js";
import { namer, seatName } from "./names.js";
import { Wheel } from "./wheel/Wheel.js";
import {
  Purse,
  REVEAL_STAGGER,
  spoken,
  tileClass,
  turnedNow,
} from "./wheel/parts.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/wheel.css";

type Props = BoardProps<WofState, WofMove>;

export function WheelBoard({
  state,
  seat,
  names,
  connected,
  canAct,
  onMove,
}: Props) {
  const [solving, setSolving] = useState(false);
  const [guess, setGuess] = useState("");

  /*
    True while the wheel is still turning. The server has already resolved the
    spin by the time the state arrives, so without this the answer arrives
    before the wheel does, which makes the wheel decoration rather than the
    thing that decided. Held only as long as the animation, and re-armed from
    scratch on every spin, so a missed timer costs a flourish rather than
    stopping the board for good.
  */
  const [spinning, setSpinning] = useState(false);
  const seenSpin = useRef(state.spins);

  /*
    The board as it stood before the wheel was thrown, held for as long as the
    wheel is turning.

    Gating the readout alone was not enough, and the note line was only the
    most obvious leak: "You spun $800." appeared over a wheel still going round,
    and so did the money in the purses, the letters-left pips, and, on Bankrupt,
    every control greying out as the turn passed. Any one of them tells you how
    it went before you can see it. So the whole position waits, and the wheel is
    the only thing on this board reading live state.

    `null` means there is nothing to wait for, which is every move that is not
    a spin.
  */
  const [frozen, setFrozen] = useState<WofState | null>(null);
  const shown = frozen ?? state;

  /*
    The position one render ago. Updated in an effect declared *after* the one
    that freezes, so when a spin lands this still holds the board the player was
    looking at a moment earlier, exactly what has to stay on screen while the
    wheel runs.
  */
  const before = useRef(state);

  useLayoutEffect(() => {
    if (state.spins === seenSpin.current) return;
    seenSpin.current = state.spins;
    if (wantsStillness()) return;
    setSpinning(true);
    setFrozen(before.current);
    // A backstop, not the clock. The wheel says when it has stopped, because
    // only it knows how far the drag left it to travel, see `onSettled`. This
    // is here because a transition that never runs never ends: a tab
    // backgrounded mid-spin, or a wheel already where it had to be, would
    // otherwise freeze the board for good. Generous on purpose; it should never
    // be the thing that fires.
    const id = setTimeout(
      () => {
        setSpinning(false);
        setFrozen(null);
      },
      spinMs(state.travel) + 600,
    );
    return () => clearTimeout(id);
    // Layout rather than plain effect: a passive one runs after paint, so the
    // spun value got one frame on screen before the freeze caught it, a flicker
    // of the answer, which is the whole thing this is here to prevent.
  }, [state.spins, state.travel]);

  useEffect(() => {
    before.current = state;
  });

  // A half-typed answer stops meaning anything the moment the turn moves on or
  // a new puzzle goes up.
  useEffect(() => {
    if (!canAct) {
      setSolving(false);
      setGuess("");
    }
  }, [canAct]);
  useEffect(() => {
    setSolving(false);
    setGuess("");
  }, [shown.round]);

  // Two names for the same seat, and they are not interchangeable. `nameFor`
  // is for the note line, which is a sentence: "You spun $800." `seatName` is
  // for the strip, where every seat is labelled the same way and the one that
  // is yours is marked with a badge rather than renamed. Calling yourself "You"
  // in a scoreboard reads as a fifth player.
  const nameFor = namer(names, seat);

  const bank = seat === null ? 0 : (shown.bank[seat] ?? 0);
  const canBuyVowel =
    canAct && !spinning && shown.phase === "spin" && bank >= VOWEL_COST;
  // The one gate the wheel and the Spin button share. They are two ways of
  // making the same move and must never be offered on different terms.
  const canSpin = canAct && !spinning && shown.phase === "spin";
  const justCalled = shown.roundOver
    ? null
    : (shown.called[shown.called.length - 1] ?? null);
  // Where the wheel is standing, which outlives the turn that spun it. See
  // `wedgeAt` on the state.
  const landed = shown.wedgeAt === null ? null : WHEEL[shown.wedgeAt];
  const findsLeft = Math.max(0, FINDS_PER_TURN - shown.finds);

  function submitSolve(event: React.FormEvent) {
    event.preventDefault();
    if (!guess.trim()) return;
    onMove({ type: "solve", answer: guess });
    setSolving(false);
    setGuess("");
  }

  /* How many tiles the last call has turned so far, as the puzzle is drawn.
     See REVEAL_STAGGER. Reset every render, read nowhere else. */
  let turning = 0;

  return (
    <div className="wof">
      {/* Who is here and what they have: the players strip and the scoreboard,
          which are one thing now: see `Purse`. First, because that is where a
          player expects to find out who is at the table, and because it is
          where the shell's own strip used to stand. It stays out of the middle
          on purpose, because a scoreboard between the wheel and the keyboard is
          what once pushed twenty-six keys off the bottom of a phone. */}
      <div className="wof-money">
        {shown.bank.map((amount, index) => (
          <Purse
            key={index}
            seatIndex={index}
            name={seatName(names, index)}
            mine={index === seat}
            away={!(connected[index] ?? true) && !!names[index]}
            amount={amount}
            banked={shown.score[index] ?? 0}
            active={shown.turn === index && !shown.over}
          />
        ))}
      </div>

      {/* Which round, what the phrase is about, and what just happened: one
          line, because they are three short muted facts that were costing two
          lines of a phone between them, and because together they read as the
          caption the puzzle below never had: "Food & Drink. Bob spun $800."
          The note keeps its own live region; only the box round it moved. */}
      <div className="wof-strap">
        <p className="wof-round">
          Round {shown.round} of {ROUNDS} - {shown.category}
        </p>
        {/* The one thing a player most needs to know and cannot see anywhere
            else: what just happened, and to whom. */}
        <p className="wof-note" role="status" aria-live="polite">
          {shown.note ? `${nameFor(shown.note.seat)} ${shown.note.text}` : ""}
        </p>
      </div>

      <div
        className="wof-puzzle"
        role="img"
        aria-label={`${shown.category}. ${spoken(shown.answer)}`}
      >
        {shown.answer.split(" ").map((word, w) => (
          <span className="wof-word" key={w} aria-hidden="true">
            {[...word].map((ch, i) => (
              <span
                key={i}
                className={tileClass(ch, justCalled)}
                /* Counted as the board is drawn rather than gathered up first,
                   because reading order *is* the order they should turn in.
                   `turning` is reset on every render, so this is a plain loop
                   counter that happens to live in JSX. */
                style={
                  turnedNow(ch, justCalled)
                    ? ({
                        "--wof-flip": `${turning++ * REVEAL_STAGGER}ms`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {ch === BLANK ? "" : ch}
              </span>
            ))}
          </span>
        ))}
      </div>

      {!shown.roundOver && (
        <div className="wof-wheel">
          <Wheel
            state={state}
            spinning={spinning}
            grabbable={canSpin && !spinning}
            onSpin={(velocity) => onMove({ type: "spin", velocity })}
            onSettled={() => {
              setSpinning(false);
              setFrozen(null);
            }}
          />

          {/* What the wheel means, in words. The wheel is the flourish; this
              is the fact, and it waits for the pointer to stop so the two
              never disagree in front of the player. */}
          <p
            className={
              !spinning && landed !== null && landed.kind !== "cash"
                ? "wof-readout bad"
                : "wof-readout"
            }
            role="status"
            aria-live="polite"
          >
            {spinning ? (
              <span className="wof-prompt">Spinning...</span>
            ) : shown.wedge?.kind === "cash" ? (
              <>
                {/* Keyed on the spin, so React replaces the element rather
                    than updating it and the arrival animation runs again. Two
                    spins can pay the same money, and a number that did not
                    move on the second one would look like a wheel that had
                    not been thrown. */}
                <span className="wof-value" key={shown.spins}>
                  {money(shown.wedge.value)}
                </span>
                <span className="wof-prompt">for every letter found</span>
              </>
            ) : landed !== null && landed.kind !== "cash" ? (
              <span className="wof-prompt" key={shown.spins}>
                {wedgeName(landed)}
              </span>
            ) : (
              <span className="wof-prompt">
                {canAct
                  ? "Flick the wheel, buy a vowel, or solve"
                  : "Waiting on the wheel"}
              </span>
            )}
          </p>

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
              placeholder={shown.category}
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
          {shown.roundOver ? (
            !shown.over && (
              <button
                className="primary"
                disabled={!canAct}
                onClick={() => onMove({ type: "next" })}
              >
                Start round {shown.round + 1}
              </button>
            )
          ) : (
            <>
              <button
                className="primary"
                disabled={!canSpin}
                /* No `velocity`, so the wheel decides, see WofMove. This is
                   the keyboard's throw, and a player who would rather not
                   flick. */
                onClick={() => onMove({ type: "spin" })}
              >
                Spin
              </button>
              <button disabled={!canSpin} onClick={() => setSolving(true)}>
                Solve
              </button>
            </>
          )}
        </div>
      )}

      {!shown.roundOver && (
        <>
          <div className="wof-keys">
            {[...ALPHABET].map((letter) => {
              const spent = shown.called.includes(letter);
              const vowel = VOWELS.includes(letter);
              const usable =
                canAct &&
                !spinning &&
                !spent &&
                (shown.phase === "call" ? !vowel : vowel && canBuyVowel);
              return (
                <button
                  key={letter}
                  className={
                    spent ? "wof-key surface spent" : "wof-key surface"
                  }
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
          {/* Under the keyboard, because both halves of it are about the
              keyboard: what you may press, and how many more times. The count
              used to sit under the wheel with the money, a screen away from
              the keys it governs, and it was its own row there, which on a
              phone is the row that put the last rank of letters under the
              fold. */}
          <div className="wof-foot">
            <p className="wof-legend">
              {/* Set as short as it can be said. "Consonants need a spin.
                  Vowels cost $250." is the same two facts in nine more
                  characters, and the nine are the difference between this
                  sharing a row with the counter beside it and wrapping under
                  it, which at 375px is the twenty pixels a four-player table
                  has left. Measured at 375, 390 and 1920. */}
              {shown.phase === "call"
                ? "Name a consonant."
                : `Spin for a consonant - vowels ${money(VOWEL_COST)}`}
            </p>
            {/* How much of the streak is left. A wrong guess ends the turn on
                the spot, which needs no meter, since nobody has to be told they
                get one. The cap on right ones is the rule that is actually news,
                so it is the only one shown. */}
            {canAct && (
              <p
                className={
                  findsLeft === 1 ? "wof-guesses last" : "wof-guesses"
                }
              >
                <span className="wof-pips" aria-hidden="true">
                  {Array.from({ length: FINDS_PER_TURN }, (_, i) => (
                    <i key={i} className={i < findsLeft ? "" : "spent"} />
                  ))}
                </span>
                {findsLeft} {findsLeft === 1 ? "letter" : "letters"} left
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
