import { useEffect, useState } from "react";
// Values from letterpressDisplay.js, which imports nothing: the board must
// never pull the reducer (and the word list with it) into the client bundle.
// The types below are type-only, so they carry no import.
import {
  GRID_SIZE,
  MIN_WORD,
  blockedBy,
  canExtend,
  flips,
  isLocked,
  spell,
  tally,
  unclaimed,
} from "../../shared/games/letterpressDisplay.js";
import type { LpMove, LpState } from "../../shared/games/letterpressDisplay.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<LpState, LpMove>;

/**
 * Letterpress. Tap tiles anywhere on the grid to spell a word; every tile you
 * used turns your colour, unless it is locked.
 *
 * Tap and nothing else: no drag, no keyboard. Word Hunt needs a drag because
 * its letters have to touch and the gesture *is* the rule; here they do not, so
 * a drag would be a worse way of doing what a tap already does. That makes this
 * the friendliest board in the app on a phone: twenty-five targets, each bigger
 * than a thumb, and a tap on a chosen tile takes it back out again.
 *
 * The board says three things about every tile, and all three matter before
 * you commit to a word: whose it is, whether it is locked, and where it sits
 * in the word you are building. The first two are what makes a word worth
 * playing, so they are legible while a word is half-built rather than being
 * covered up by the selection.
 */
export function LetterpressBoard({ state, seat, names, canAct, onMove }: Props) {
  const [path, setPath] = useState<number[]>([]);

  const mine = seat !== null;
  const myMove = mine && canAct;
  const over = state.winner !== null || state.draw;
  const counts = tally(state);
  const free = unclaimed(state);

  /*
    A half-built word means nothing once the board has moved underneath it. It
    is cleared on every move by anybody, not only on losing the turn, because
    the tiles a word was going to take are exactly what the opponent's move
    changes.
  */
  useEffect(() => {
    setPath([]);
  }, [state.moveCount, myMove]);

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  const word = spell(state.grid, path);
  const longEnough = word.length >= MIN_WORD;
  // Only ever asked of a word long enough to play: `blockedBy` matches on
  // prefixes, and every word on the board starts with something two letters
  // long that somebody has played.
  const spent = longEnough ? blockedBy(state.played, word) : null;
  const takes = mine
    ? path.filter((cell) => flips(state.owner, cell, seat as 0 | 1)).length
    : 0;

  function tap(cell: number) {
    if (!myMove) return;
    setPath((current) =>
      // A tap on a tile already in the word takes that one letter back out and
      // leaves the rest where they are. Dropping everything after it as well
      // would punish a slip in the middle of a long word by making you build
      // the whole thing again.
      current.includes(cell)
        ? current.filter((taken) => taken !== cell)
        : canExtend(current, cell)
          ? current.concat(cell)
          : current,
    );
  }

  /*
    Deliberately does not clear the word. The board cannot tell a real word
    from a plausible one -- only the server holds the dictionary -- so a
    refusal is an ordinary outcome here rather than an accident, and clearing
    on send would make every guess cost the taps that built it. The effect
    above clears it when the move actually lands, which is the only moment it
    should stop being what you are looking at.
  */
  function submit() {
    if (!longEnough || spent !== null) return;
    onMove({ type: "play", path });
  }

  return (
    <div className="board lp-board">
      {/* The count, which is the score and the whole of it. The bar underneath
          is the same two numbers as a length, because "sixteen to seven" and
          "most of the board" are different thoughts and the second one is the
          one you act on. */}
      <div className="lp-scores" role="list" aria-label="Tiles held">
        {[0, 1].map((side) => (
          <span
            className={`lp-score s${side}${side === seat ? " mine" : ""}`}
            role="listitem"
            key={side}
          >
            <span className="lp-chip" aria-hidden="true" />
            <span className="lp-who">{nameFor(side)}</span>
            <span className="lp-tiles">{counts[side]}</span>
          </span>
        ))}
        <span className="lp-free" role="listitem">
          {free} free
        </span>
      </div>
      <div className="lp-bar" aria-hidden="true">
        <i className="s0" style={{ flexGrow: counts[0] }} />
        <i className="free" style={{ flexGrow: free }} />
        <i className="s1" style={{ flexGrow: counts[1] }} />
      </div>

      <div
        className="lp-grid"
        style={{ ["--lp-size" as string]: GRID_SIZE }}
        role="group"
        aria-label="The grid"
      >
        {state.grid.map((letter, cell) => {
          const holder = state.owner[cell];
          const locked = isLocked(state.owner, cell);
          const step = path.indexOf(cell);
          const just = state.lastPlay?.includes(cell) ?? false;
          const classes = [
            "lp-tile",
            "surface",
            holder === null ? "free" : `s${holder}`,
            locked ? "locked" : "",
            step === -1 ? "" : "picked",
            just ? "just" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              type="button"
              key={cell}
              className={classes}
              disabled={!myMove}
              onClick={() => tap(cell)}
              aria-pressed={step !== -1}
              aria-label={[
                letter,
                holder === null ? "unclaimed" : holder === seat ? "yours" : `${nameFor(holder)}'s`,
                // Said in the same breath as the owner, because together they
                // are the whole reason to pick this tile or leave it.
                locked ? "locked" : "",
                step === -1 ? "" : `letter ${step + 1} of your word`,
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <span className="lp-letter">{letter}</span>
              {step !== -1 && <span className="lp-step">{step + 1}</span>}
            </button>
          );
        })}
      </div>

      {myMove && (
        <div className="lp-tray">
          {/* Always here, never appearing: a line that came and went would
              shove twenty-five tap targets up and down under a thumb. */}
          <p className="lp-draft" aria-live="polite">
            {word ? (
              <span className="lp-spelt">{word}</span>
            ) : (
              <span className="lp-hint">
                Tap any tiles, anywhere. {MIN_WORD} letters or more
              </span>
            )}
            {spent !== null && (
              <span className="lp-spent">
                {spent === word ? "already played" : `${spent} has been played`}
              </span>
            )}
            {/* What the word is worth, in the only currency there is. A word
                that takes nothing is a legal move and almost never a good
                one, so it says so rather than being quietly allowed. */}
            {longEnough && spent === null && (
              <span className={takes === 0 ? "lp-takes none" : "lp-takes"}>
                {takes === 0 ? "takes nothing" : `takes ${takes}`}
              </span>
            )}
          </p>
          <button
            type="button"
            className="lp-take"
            disabled={!longEnough || spent !== null}
            onClick={submit}
          >
            Play it
          </button>
          <button
            type="button"
            className="lp-clear"
            disabled={path.length === 0}
            onClick={() => setPath([])}
          >
            Clear
          </button>
          {/* Never disabled: it is always a legal move on your turn, and the
              label carries the warning rather than the button being greyed. */}
          <button type="button" className="lp-pass" onClick={() => onMove({ type: "pass" })}>
            {state.passes === 1 ? "Pass, and that ends it" : "Pass"}
          </button>
        </div>
      )}

      {/*
        Only ever rendered while it is not your move, which is what makes "you
        played" safe to say: the game strictly alternates, so the last word to
        land was necessarily yours. A turn you passed leaves no word, and says
        only who is being waited on.
      */}
      {mine && !myMove && !over && (
        <p className="lp-waiting" aria-live="polite">
          {state.lastWord ? `You played ${state.lastWord}. ` : ""}
          Waiting for {nameFor(state.turn)}.
        </p>
      )}

      {/* Everything played, in the order it was played, because the list is
          also the rule: a word on it is a word neither of you may use again,
          and so is anything starting with one. */}
      {state.played.length > 0 && (
        <section className="lp-history">
          <h3 className="lp-history-head">Played ({state.played.length})</h3>
          <ul>
            {state.played.map((played) => (
              <li className={state.words[0].includes(played) ? "s0" : "s1"} key={played}>
                {played}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
