import { useEffect, useRef, useState } from "react";
// Values from wheelDisplay.js, which imports nothing — the board must never
// pull the reducer (and its answer bank) into the client bundle. The types
// below are type-only, so they are erased and carry no runtime import.
import {
  ALPHABET,
  BLANK,
  GUESSES_PER_TURN,
  ROUNDS,
  VOWELS,
  VOWEL_COST,
  WEDGE_ARC,
  WHEEL,
  money,
  wedgeLabel,
  wedgeName,
} from "../../shared/games/wheelDisplay.js";
import type { WofMove, WofState } from "../../shared/games/wheel.js";

/**
 * How long the wheel takes to come to rest. Matched by the transition in
 * `styles.css` — the number lives in both because one is what the eye sees and
 * the other is when the value is allowed to appear, and they have to agree.
 */
const SPIN_MS = 2600;

/** Whole turns the wheel makes before settling, so it reads as a throw. */
const SPIN_TURNS = 4;

/** The wheel is drawn in a 220-unit box; these are its two radii. */
const RADIUS = 100;
const LABEL_RADIUS = 74;

/** Where the wheel has to sit for wedge `at` to be under the pointer. */
function restAngle(at: number | null): number {
  if (at === null) return 0;
  // The pointer is at twelve o'clock, and wedge `at` runs clockwise from
  // `at * WEDGE_ARC` — so its middle has to come back by that much plus half
  // a wedge.
  return -(at * WEDGE_ARC + WEDGE_ARC / 2);
}

/** One wedge, as a pie slice from the centre. */
function sectorPath(index: number): string {
  const point = (degrees: number) => {
    const rad = (degrees * Math.PI) / 180;
    // Twelve o'clock is zero and the angle runs clockwise, which is how the
    // wedges are numbered.
    return `${(RADIUS * Math.sin(rad)).toFixed(2)} ${(-RADIUS * Math.cos(rad)).toFixed(2)}`;
  };
  const from = index * WEDGE_ARC;
  return `M 0 0 L ${point(from)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(from + WEDGE_ARC)} Z`;
}

function wedgeClass(index: number): string {
  const wedge = WHEEL[index];
  if (wedge.kind === "bankrupt") return "wof-wedge bankrupt";
  if (wedge.kind === "lose-turn") return "wof-wedge lose";
  // Cash wedges alternate so twenty-one of them do not read as one disc.
  return index % 2 === 0 ? "wof-wedge cash" : "wof-wedge cash alt";
}

/** Whether this device has asked for less movement. */
function wantsStillness(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The wheel itself: twenty-four wedges that turn and stop where the server
 * says they stopped.
 *
 * The server picks the wedge — it is the only thing here holding an rng — and
 * sends back the index it landed on. This animates *to* that index; it never
 * chooses one. Watching the wheel and then being told a different number is
 * the one thing that would make the whole game feel rigged, so the pointer and
 * the money below it are always reading the same field.
 *
 * `spins` rather than `wedgeAt` is what triggers a throw: two spins running
 * can land on the same wedge, and a wheel that sat still on the second one
 * would look broken.
 */
function Wheel({ state, spinning }: { state: WofState; spinning: boolean }) {
  const [angle, setAngle] = useState(() => restAngle(state.wedgeAt));
  const seen = useRef(state.spins);

  useEffect(() => {
    if (state.spins === seen.current) return;
    seen.current = state.spins;
    if (state.wedgeAt === null) return;
    setAngle((current) => {
      const base = current + SPIN_TURNS * 360;
      const target = restAngle(state.wedgeAt);
      // The smallest angle at or past `base` that puts the wedge under the
      // pointer. Always forwards, and always at least SPIN_TURNS of it.
      return base + ((((target - base) % 360) + 360) % 360);
    });
  }, [state.spins, state.wedgeAt]);

  return (
    <div className="wof-wheel-frame">
      <span className="wof-pointer" aria-hidden="true" />
      <svg
        className={spinning ? "wof-disc spinning" : "wof-disc"}
        viewBox="-110 -110 220 220"
        // The wheel is decoration for a fact stated in words below it and in
        // the note line above it, so there is nothing here to announce twice.
        aria-hidden="true"
      >
        <g style={{ transform: `rotate(${angle}deg)` }}>
          {WHEEL.map((wedge, index) => (
            <path key={index} className={wedgeClass(index)} d={sectorPath(index)} />
          ))}
          {WHEEL.map((wedge, index) => (
            <g
              key={`label-${index}`}
              transform={`rotate(${index * WEDGE_ARC + WEDGE_ARC / 2})`}
            >
              <text
                className={wedge.kind === "cash" ? "wof-face" : "wof-face small"}
                x="0"
                y={-LABEL_RADIUS}
                textAnchor="middle"
              >
                {wedgeLabel(wedge)}
              </text>
            </g>
          ))}
        </g>
        <circle className="wof-hub" r="12" />
      </svg>
    </div>
  );
}

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

  /*
    True while the wheel is still turning. The server has already resolved the
    spin by the time the state arrives, so without this the value appears
    before the wheel reaches it — which makes the wheel decoration rather than
    the thing that decided. Held only as long as the animation, and re-armed
    from scratch on every spin, so a missed timer costs a flourish rather than
    hiding the number for good.
  */
  const [spinning, setSpinning] = useState(false);
  const seenSpin = useRef(state.spins);

  useEffect(() => {
    if (state.spins === seenSpin.current) return;
    seenSpin.current = state.spins;
    if (wantsStillness()) return;
    setSpinning(true);
    const id = setTimeout(() => setSpinning(false), SPIN_MS);
    return () => clearTimeout(id);
  }, [state.spins]);

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
  // Where the wheel is standing, which outlives the turn that spun it — see
  // `wedgeAt` on the state.
  const landed = state.wedgeAt === null ? null : WHEEL[state.wedgeAt];
  const guessesLeft = Math.max(0, GUESSES_PER_TURN - state.misses);

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
          <Wheel state={state} spinning={spinning} />

          {/* What the wheel means, in words. The wheel is the flourish; this
              is the fact, and it waits for the pointer to stop so the two
              never disagree in front of the player. */}
          <p className="wof-readout" role="status" aria-live="polite">
            {spinning ? (
              <span className="wof-prompt">Spinning…</span>
            ) : state.wedge?.kind === "cash" ? (
              <>
                <span className="wof-value">{money(state.wedge.value)}</span>
                <span className="wof-prompt">for every letter found</span>
              </>
            ) : landed !== null && landed.kind !== "cash" ? (
              <span className="wof-prompt">{wedgeName(landed)}</span>
            ) : (
              <span className="wof-prompt">
                {myTurn ? "Spin, buy a vowel, or solve" : "Waiting on the wheel"}
              </span>
            )}
          </p>

          {/* Guesses left, for the player who has them. Three to a turn is the
              rule most likely to be news, and counting misses out of the note
              line is not something anyone should have to do. */}
          {myTurn && (
            <p className={guessesLeft === 1 ? "wof-guesses last" : "wof-guesses"}>
              <span className="wof-pips" aria-hidden="true">
                {Array.from({ length: GUESSES_PER_TURN }, (_, i) => (
                  <i key={i} className={i < guessesLeft ? "" : "spent"} />
                ))}
              </span>
              {guessesLeft === GUESSES_PER_TURN
                ? `${GUESSES_PER_TURN} guesses this turn`
                : `${guessesLeft} ${guessesLeft === 1 ? "guess" : "guesses"} left`}
            </p>
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
