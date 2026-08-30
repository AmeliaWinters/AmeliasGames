/**
 * The takeover a hundred GP buys, shared by the two screens that spend it.
 *
 * A chest on the shop's grid and a pull in the gacha dialog are the same
 * press for the same money, and `roll.ts` and `roll.css` already exist so that
 * they cannot drift apart in *timing* or in *movement*. This is the third
 * piece of that: they cannot drift apart in **staging** either. Both spends
 * black out the screen, rumble, burst, and land the thing in the middle of it.
 *
 * **It is a takeover rather than a panel on a card, and that is a reversal.**
 * `Chests.tsx` argued for a block under the button on the grounds that a modal
 * has to be dismissed and opening several in a row is the ordinary case. The
 * argument was right about the cost and wrong about the fix: the answer to
 * "several in a row" is a button that opens the next one *without leaving*,
 * which is what the callers put in `acts`. A 13rem card was never going to
 * hold a moment worth 100 GP.
 *
 * Three beats and no more, because there is **no rarity in this app** -- see
 * `chest.ts`, which says at length why there are no weights and no pity timer.
 * A burst that came in three colours would be inventing a tier system that the
 * server has no opinion about, so every drop gets exactly the same theatre:
 *
 * - `charging`, while the request is out and the spin is cycling. It rumbles.
 * - `landed`, the burst and the reveal. The one place this app spends light.
 * - `plain`, for a refusal or a failed request. **No burst, no stagger, no
 *   noise.** A refusal is the answer to a question and is not a present; the
 *   theatre is already up when the server says no, so it stays up and simply
 *   does not celebrate. Dressing up a no is worse than a no.
 *
 * Nothing in here is a JavaScript timeline. The beat is a `data-at` attribute
 * and everything hanging off it is `animation-delay`, because the Browser pane
 * never composites a frame and an animation nobody can look at is one a
 * tidy-up deletes (see CLAUDE.md). `css.test.ts` reads the order instead.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { SPIN_TICKS } from "./roll.js";
import { buzz, fanfare, ratchet } from "./feel.js";
import { useModalKeys } from "./modalKeys.js";

/** Which of the three beats above is on screen. */
export type Beat = "charging" | "landed" | "plain";

interface Props {
  at: Beat;
  /** What a screen reader is told this layer is. "Opening a chest". */
  label: string;
  /** The picture in the middle. The caller owns it: a chest spins parts of
      its own set and the gacha spins portraits, and neither is this file's
      business. Absent on a refusal, which has no picture to show. */
  art?: ReactNode;
  /** What it was, and what it left. Staggered by `roll-say` on the caller's
      own elements, so each screen keeps its own copy. */
  lines?: ReactNode;
  /** The ways out. Empty while charging, since a paid-for roll that has not
      been shown yet is the one thing here nobody should be able to lose. */
  acts?: ReactNode;
  /** Which face the spin is on, so the notch can be heard. `charging` only. */
  step?: number;
  /** Null while it must not be dismissed, which is exactly `charging`. */
  onDismiss: (() => void) | null;
}

/**
 * Where the sparks go.
 *
 * Fixed and even rather than random, for the reason everything else in this
 * app is seeded: a burst that is different every time is a burst nobody can
 * pin in a test. Alternating distances, so an even ring reads as a scatter
 * without any of it being decided at runtime.
 */
const SPARKS = Array.from({ length: 14 }, (_, i) => i);

export function RollTheatre({ at, label, art, lines, acts, step, onDismiss }: Props) {
  const box = useRef<HTMLDivElement>(null);

  /* Focus lands on the layer itself rather than on a heading, because there
     is no heading: the takeover is a picture and two lines. It is `tabIndex`
     -1 so it can be focused without joining the tab order twice. */
  useEffect(() => {
    box.current?.focus();
  }, []);

  useModalKeys(box, { onEscape: onDismiss });

  /* One notch per face, and the guard is not paperwork: React runs an effect
     again on any re-render whose deps changed, and `step` going 3, 3 through a
     parent's own re-render would double the click. The pitch is the fraction
     through the spin, which is what makes fourteen of these read as one thing
     slowing down. See `ratchet`. */
  const heard = useRef(-1);
  useEffect(() => {
    if (at !== "charging" || step === undefined || step === heard.current) return;
    heard.current = step;
    ratchet(step / SPIN_TICKS);
  }, [at, step]);

  /* The payoff, on the frame the burst starts. The vibration is a pattern
     rather than a duration on purpose: `buzz` throttles a bare number and
     never a pattern, and this is the one buzz in the whole flow. */
  useEffect(() => {
    if (at !== "landed") return;
    fanfare();
    buzz([0, 14, 55, 30]);
  }, [at]);

  return (
    <div
      className="roll-theatre"
      data-at={at}
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      /* Anywhere but the buttons, which is how a gacha has always closed. The
         row below stops the bubble so a press on "Wear it" is that press and
         not also a dismissal. */
      onClick={() => onDismiss?.()}
    >
      {at === "landed" && <Burst />}

      {/* One wrapper whose only job is to be shaken. The rumble and the kick
          would otherwise have to share an element with `roll-panel` or
          `roll-land`, and an element with two animations on it is one where
          adding a third silently drops the first. */}
      <div className="roll-quake">
        <div className={`roll-show${at === "landed" ? " roll-panel" : ""}`}>
          {art && (
            <div className={`roll-figure${at === "landed" ? " roll-land" : ""}`}>
              {art}
              {/* The sweep across the picture, and it is the one thing in here
                  that is pure decoration. It is also the thing that makes a
                  flat drop look like it was worth opening. */}
              {at === "landed" && <span className="roll-shine" aria-hidden="true" />}
            </div>
          )}

          {lines && (
            <div className="roll-lines" role="status">
              {lines}
            </div>
          )}

          {acts && (
            <div className="roll-acts" onClick={(e) => e.stopPropagation()}>
              {acts}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The light.
 *
 * Rays, a shockwave, a flash and fourteen sparks, all of them drawn with
 * gradients and borders off `--accent` rather than with an image, so it themes
 * with the palette and costs nothing to ship. Hidden from screen readers
 * entirely: the answer is the line underneath, and this is the noise around
 * it.
 */
function Burst() {
  return (
    <div className="roll-burst" aria-hidden="true">
      <span className="roll-rays" />
      <span className="roll-wave" />
      <span className="roll-flash" />
      {SPARKS.map((i) => (
        <span
          key={i}
          className="roll-spark"
          style={
            {
              "--spark": `${(i * 360) / SPARKS.length}deg`,
              "--spark-far": i % 2 ? "34vmin" : "23vmin",
              "--spark-late": `${(i % 5) * 26}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
