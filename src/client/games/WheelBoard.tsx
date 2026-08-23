import { useEffect, useLayoutEffect, useRef, useState } from "react";
// Values from wheelDisplay.js, which imports nothing — the board must never
// pull the reducer (and its answer bank) into the client bundle. The types
// below are type-only, so they are erased and carry no runtime import.
import {
  ALPHABET,
  BLANK,
  FINDS_PER_TURN,
  ROUNDS,
  VOWELS,
  VOWEL_COST,
  SPIN_MAX_TRAVEL,
  WEDGE_ARC,
  WHEEL,
  money,
  wedgeLabel,
  wedgeName,
} from "../../shared/games/wheelDisplay.js";
import type { Wedge, WofMove, WofState } from "../../shared/games/wheel.js";
import { wantsStillness } from "../motion.js";
import {
  RADIUS,
  WEDGE_COUNT,
  bandPath,
  flapAngle,
  restAngle,
  sectorPath,
} from "./wheelGeometry.js";

/**
 * How long a spin lasts, from the distance it covers.
 *
 * A flick that travels five turns cannot take the same time as one that
 * travels one, or the speed the player threw at is thrown away and every spin
 * feels identical. Not proportional either: the long ones would outstay their
 * welcome, so the constant part carries the ending — the crawl and the stop —
 * and the distance carries the rest.
 *
 * Handed to the stylesheet as a custom property rather than written out in
 * both places. The transition is what the eye sees and this is when the value
 * is allowed to appear; they have to agree, and two numbers that have to agree
 * eventually do not.
 */
export function spinMs(travel: number): number {
  const wedges = Number.isFinite(travel) ? Math.min(Math.max(travel, 0), SPIN_MAX_TRAVEL) : 0;
  return Math.round(900 + wedges * 16);
}

/** Where a wedge's label sits. The rim itself is RADIUS, from
    `wheelGeometry.ts`; this is far enough in that a number clears the pointer
    and near enough out that it has the wedge's full width to sit across. */
const LABEL_RADIUS = 78;

/**
 * The window onto the wheel: how wide a slice of it the table shows, and how
 * far down the rim the window reaches.
 *
 * A whole wheel in a phone's width is a wheel about 240px across, and at
 * thirty-six wedges that is ten degrees of arc for a three-figure sum — the
 * numbers would be specks. So the box is 104 units wide against a 200-unit
 * wheel: the same wheel drawn about twice as big as the box that holds it,
 * with six wedges in view and the rest of it off both sides. That is
 * what makes a wedge wide enough to letter, and it is why the wedges stream
 * past the pointer *sideways* — a thing you can read while it is moving —
 * rather than turning as a disc going blurry in the middle of the page.
 *
 * The depth is set by the band rather than by the rim: RIM_INNER dips to
 * y ≈ 63 at the corners of the window, and nothing below that is drawn.
 */
const VIEW_W = 104;
const CROP = 64;

/**
 * The inner edge of the visible band, as a radius.
 *
 * The wheel is clipped to the ring between this and the rim — see `bandPath`.
 * A rectangular window cut the wedges off along a straight line at the sides
 * and the bottom, and what was left read as a fan of stripes rather than as
 * part of a wheel. Far enough in that the numbers at 78 sit well clear of the
 * edge, near enough out that the band is a band and not a disc with a bite
 * taken out of the bottom of the frame.
 */
const RIM_INNER = 55;

/**
 * The wheel's hub, in the box's own coordinates. Well below the bottom edge,
 * which is the point — the window is on the top of the rim.
 *
 * The wheel is drawn about its own origin and then moved here by a translate,
 * rather than the box being given a viewBox centred on zero. That reads like
 * the long way round, and it is the only way the spin works: the disc is
 * turned by a CSS `transform`, and `transform-origin` under
 * `transform-box: view-box` is measured from the box's own corner. With a
 * `-110 -110` viewBox the pivot landed a full radius clear of the wheel and
 * the whole thing swung off the screen on the first spin instead of turning on
 * the spot. Starting the box at zero makes the pivot and the hub the same
 * point, whichever way an engine reads it.
 */
const HUB_X = VIEW_W / 2;
const HUB_Y = 110;

/**
 * The flick, in degrees of rim per millisecond at the moment of release.
 *
 * `MIN` is the floor and not a threshold: let go slower than this — or
 * backwards, or without moving at all — and the wheel still goes, at the
 * gentlest throw `spinTravel` knows. That is deliberate. A wheel that did
 * nothing until you flicked hard enough would let a player creep it round to
 * the wedge they wanted and release, which is the one way a grabbable wheel
 * can be cheated, and it is why the landing is measured from where the wheel
 * *stopped last time* rather than from wherever the drag left it.
 *
 * `MAX` is a hard thumb across a phone: past it, throwing harder is just
 * waiting longer.
 */
const FLICK_MIN = 0.15;
const FLICK_MAX = 1.2;

/** How long a release looks back for its speed. Long enough to average out a
    jittery finger, short enough that a drag that stopped dead reads as one. */
const FLICK_WINDOW_MS = 120;

/**
 * Bankrupt and Lose a Turn, as marks rather than words.
 *
 * They used to be set as text, and there is no room for it: a wedge is 10°,
 * which is about fourteen units of arc at the label radius, and "BANKRUPT"
 * laid across that at any readable size runs over its neighbours and off the
 * rim. A mark is read at a glance anyway, which is all a wheel in motion gives
 * you — and the words themselves are still said in full underneath, in the
 * readout and in the note line.
 *
 * Drawn about the origin, so the caller places them the same way it places a
 * number: rotated with the wedge, at the label radius.
 */
function wedgeGlyph(wedge: Wedge): string {
  // Bankrupt: the "none of it" sign — a ring with a stroke through it.
  if (wedge.kind === 'bankrupt') {
    return 'M 3.6 0 A 3.6 3.6 0 1 1 -3.6 0 A 3.6 3.6 0 1 1 3.6 0 M -2.5 -2.5 L 2.5 2.5';
  }
  // Lose a Turn: two chevrons, pointing the way the turn is about to go.
  return 'M -3.2 -2.7 L -0.2 0 L -3.2 2.7 M 0.6 -2.7 L 3.6 0 L 0.6 2.7';
}

function wedgeClass(index: number): string {
  const wedge = WHEEL[index];
  if (wedge.kind === "bankrupt") return "wof-wedge bankrupt";
  if (wedge.kind === "lose-turn") return "wof-wedge lose";
  // Cash wedges alternate so thirty-four of them do not read as one disc.
  return index % 2 === 0 ? "wof-wedge cash" : "wof-wedge cash alt";
}

/**
 * The wheel itself: thirty-six wedges that turn and stop where the server says
 * they stopped.
 *
 * The server resolves the spin — it is the only thing here holding an rng —
 * and sends back the index it landed on and the distance it covered. This
 * animates *to* that index; it never chooses one. Watching the wheel and then
 * being told a different number is the one thing that would make the whole
 * game feel rigged, so the pointer and the money below it are always reading
 * the same field.
 *
 * `spins` rather than `wedgeAt` is what triggers a throw: two spins running
 * can land on the same wedge, and a wheel that sat still on the second one
 * would look broken.
 *
 * The rim is also grabbable. A drag turns the wheel under the finger and the
 * speed at the moment of release is sent up as the flick that decides where it
 * stops. The drag itself decides nothing — see FLICK_MIN.
 */
function Wheel({
  state,
  spinning,
  grabbable,
  onSpin,
}: {
  state: WofState;
  spinning: boolean;
  grabbable: boolean;
  onSpin: (power: number) => void;
}) {
  const [angle, setAngle] = useState(() => restAngle(state.wedgeAt));
  const [dragging, setDragging] = useState(false);
  const seen = useRef(state.spins);
  /* The two elements the flapper loop touches directly. It runs every frame
     of a spin, and putting the deflection through React state would re-render
     seventy-two paths sixty times a second to move one triangle. */
  const turning = useRef<SVGGElement>(null);
  const flapper = useRef<SVGPathElement>(null);

  /** Lay the flapper against the wheel standing at `wheel` degrees. */
  function setFlap(wheel: number) {
    if (flapper.current) flapper.current.style.transform = `rotate(${flapAngle(wheel)}deg)`;
  }
  /* The live drag: where the finger started, what the wheel read then, and the
     last few positions with their timestamps — the tail is what a release is
     measured over. Held in a ref rather than in state because it changes on
     every pointermove and none of it is drawn. */
  const drag = useRef<{ from: number; base: number; trail: { at: number; t: number }[] } | null>(
    null,
  );

  useEffect(() => {
    if (state.spins === seen.current) return;
    seen.current = state.spins;
    if (state.wedgeAt === null) return;
    setAngle((current) => {
      // Whole turns from the distance the wheel was actually thrown, so a hard
      // flick visibly goes further than a gentle one. At least one, because a
      // spin that never comes round at all does not read as a spin.
      const turns = Math.max(1, Math.floor(state.travel / WEDGE_COUNT));
      const base = current + turns * 360;
      const target = restAngle(state.wedgeAt);
      // The smallest angle at or past `base` that puts the wedge under the
      // pointer. Always forwards, and always at least `turns` of it.
      return base + ((((target - base) % 360) + 360) % 360);
    });
  }, [state.spins, state.wedgeAt, state.travel]);

  /**
   * The flapper, through a spin.
   *
   * Read off the wheel's *live* rotation rather than worked out from a clock,
   * because the wheel is turned by a CSS transition and only the engine knows
   * how far through its easing it is. `getComputedStyle` gives the matrix it
   * has actually resolved to this frame; the rest is `flapAngle`.
   *
   * Nothing here is verifiable in the preview pane, which is a hidden document
   * and never fires a frame — see `wheelGeometry.test.ts` for the half that
   * can be pinned.
   */
  useEffect(() => {
    if (!spinning) {
      setFlap(angle);
      return;
    }
    const disc = turning.current;
    if (!disc) return;
    let frame = 0;
    const tick = () => {
      // "none" is not a matrix, and DOMMatrix throws on it rather than reading
      // it as the identity. It should never appear — the group always carries
      // a rotate — but a throw here would stop the loop dead mid-spin.
      const css = getComputedStyle(disc).transform;
      if (css && css !== "none") {
        const m = new DOMMatrixReadOnly(css);
        setFlap((Math.atan2(m.b, m.a) * 180) / Math.PI);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `angle` is read only on the way out, to settle the flapper where the
    // wheel stopped; re-running this on every degree of a drag would restart
    // the loop sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning]);

  /**
   * Where a pointer is, as an angle about the hub, measured the way the wheel
   * is: zero at twelve o'clock and growing clockwise.
   *
   * Worked out from the box rather than from anything on screen, because the
   * hub is a good way below the bottom of the window by design and there is no
   * element sitting there to measure from.
   */
  function angleAt(svg: SVGSVGElement, x: number, y: number): number {
    const box = svg.getBoundingClientRect();
    const scale = box.width / VIEW_W;
    const dx = x - (box.left + HUB_X * scale);
    const dy = box.top + HUB_Y * scale - y;
    return (Math.atan2(dx, dy) * 180) / Math.PI;
  }

  function grab(event: React.PointerEvent<SVGSVGElement>) {
    if (!grabbable) return;
    const svg = event.currentTarget;
    // Captured, so a finger that leaves the frame mid-throw — which is most of
    // them, the frame being a band — still finishes its drag here. It throws
    // if the pointer has already gone, and a throw here would cost the drag
    // rather than the capture, so it is allowed to fail.
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* no capture; the drag still works while the finger stays on the wheel */
    }
    const at = angleAt(svg, event.clientX, event.clientY);
    drag.current = { from: at, base: angle, trail: [{ at: 0, t: event.timeStamp }] };
    setDragging(true);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    const live = drag.current;
    if (!live) return;
    const raw = angleAt(event.currentTarget, event.clientX, event.clientY) - live.from;
    // atan2 wraps at the bottom of the circle; the trail must not, or a drag
    // that crossed the wrap would read as a full turn the other way.
    const last = live.trail[live.trail.length - 1].at;
    const turned = last + (((raw - last + 540) % 360) - 180);
    live.trail.push({ at: turned, t: event.timeStamp });
    if (live.trail.length > 24) live.trail.shift();
    setAngle(live.base + turned);
    // Under the hand the wheel ticks too — that is most of what tells you you
    // have hold of it.
    setFlap(live.base + turned);
  }

  function release(event: React.PointerEvent<SVGSVGElement>) {
    const live = drag.current;
    if (!live) return;
    drag.current = null;
    setDragging(false);
    // The turn can move on mid-drag — somebody else solved it, or the round
    // ended. The wheel is left wherever the hand put it, which the next spin's
    // snap tidies up; what must not happen is a move nobody may make.
    if (!grabbable) return;

    // Speed over the tail of the drag rather than over the whole of it: a
    // player who lines the wheel up slowly and then snaps it has thrown it
    // hard, and the seconds before the snap are no part of the throw.
    const trail = live.trail;
    const last = trail[trail.length - 1];
    const first = trail.find((sample) => last.t - sample.t <= FLICK_WINDOW_MS) ?? trail[0];
    const ms = last.t - first.t;
    const speed = ms > 0 ? (last.at - first.at) / ms : 0;
    // Backwards and stationary both land on zero, which is the gentlest throw
    // the wheel knows rather than no throw at all.
    const power = Math.min(Math.max((speed - FLICK_MIN) / (FLICK_MAX - FLICK_MIN), 0), 1);
    onSpin(power);
  }

  const classes = ["wof-disc"];
  if (spinning) classes.push("spinning");
  if (grabbable) classes.push("grabbable");
  if (dragging) classes.push("dragging");

  return (
    <div className="wof-wheel-frame">
      <svg
        className={classes.join(" ")}
        viewBox={`0 0 ${VIEW_W} ${CROP}`}
        /* The three numbers the stylesheet needs and cannot know: how long
           this spin lasts, which now depends on how far it goes, and where the
           wheel's hub is. The pivot used to be `center`, which meant half the
           box — true only while the box was square, and it stopped being square
           the moment it was cropped. */
        style={
          {
            "--wof-spin": `${spinMs(state.travel)}ms`,
            "--wof-hub-x": `${HUB_X}px`,
            "--wof-hub-y": `${HUB_Y}px`,
          } as React.CSSProperties
        }
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        // The wheel is decoration for a fact stated in words below it and in
        // the note line above it, so there is nothing here to announce twice.
        // The Spin button is the accessible way to throw it and the only way a
        // keyboard has; a flick has no keyboard equivalent worth faking.
        aria-hidden="true"
      >
        <defs>
          {/* The window, as a shape rather than as the edges of the box — see
              `bandPath`. On a static wrapper, never on the group that turns,
              or the window would go round with the wheel. */}
          <clipPath id="wof-rim-band">
            <path
              clipRule="evenodd"
              transform={`translate(${HUB_X} ${HUB_Y})`}
              d={bandPath(RIM_INNER)}
            />
          </clipPath>
        </defs>
        {/* Three groups, and they do different jobs: the outer one holds the
            window still, the middle one is the only thing that turns, and the
            inner one never moves — it just carries the wheel from the origin
            to the hub. See HUB_X. */}
        <g clipPath="url(#wof-rim-band)">
          <g className="wof-turn" ref={turning} style={{ transform: `rotate(${angle}deg)` }}>
            <g transform={`translate(${HUB_X} ${HUB_Y})`}>
              {WHEEL.map((wedge, index) => (
                <path key={index} className={wedgeClass(index)} d={sectorPath(index)} />
              ))}
              {WHEEL.map((wedge, index) => (
                <g
                  key={`label-${index}`}
                  transform={`rotate(${index * WEDGE_ARC + WEDGE_ARC / 2}) translate(0 ${-LABEL_RADIUS})`}
                >
                  {wedge.kind === "cash" ? (
                    <text className="wof-face" x="0" y="0" textAnchor="middle">
                      {wedgeLabel(wedge)}
                    </text>
                  ) : (
                    <path
                      className="wof-glyph"
                      // A number is placed by its baseline, so its body sits a
                      // few units further out than the point it is hung from.
                      // A mark is placed by its middle, so it is nudged to
                      // match and the two sit on one ring.
                      transform="translate(0 -2.4)"
                      d={wedgeGlyph(wedge)}
                    />
                  )}
                </g>
              ))}
            </g>
          </g>
        </g>
        {/* The two edges of the band, struck as circles so they are true arcs
            rather than the clip's boundary showing through. The outer one is
            the rim, and it is what holds the wheel off the page now that there
            is no card behind it: the cash wedges are a shade either side of
            the ground in both palettes, which is enough to tell them apart
            and not enough to give the wheel an edge of its own. */}
        <circle className="wof-rim" cx={HUB_X} cy={HUB_Y} r={RADIUS} />
        <circle className="wof-rim inner" cx={HUB_X} cy={HUB_Y} r={RIM_INNER} />
        {/* The flapper. Drawn inside the wheel's own box rather than floated
            over it, so it sits on the rim at every width without a percentage
            anybody has to keep in step with the crop. One wedge wide, so what
            it is sitting on is unmistakable — and hinged at its top edge, so
            each peg that passes underneath can knock the tip aside. */}
        <path
          className="wof-pointer"
          ref={flapper}
          d={`M ${HUB_X} 22 L ${HUB_X - 7} 1 L ${HUB_X + 7} 1 Z`}
        />
      </svg>
    </div>
  );
}

import type { BoardProps } from "./boards.js";

type Props = BoardProps<WofState, WofMove>;

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

export function WheelBoard({ state, seat, names, canAct, onMove }: Props) {
  const [solving, setSolving] = useState(false);
  const [guess, setGuess] = useState("");

  /*
    True while the wheel is still turning. The server has already resolved the
    spin by the time the state arrives, so without this the answer arrives
    before the wheel does — which makes the wheel decoration rather than the
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
    and so did the money in the purses, the letters-left pips, and — on
    Bankrupt — every control greying out as the turn passed. Any one of them
    tells you how it went before you can see it. So the whole position waits,
    and the wheel is the only thing on this board reading live state.

    `null` means there is nothing to wait for, which is every move that is not
    a spin.
  */
  const [frozen, setFrozen] = useState<WofState | null>(null);
  const shown = frozen ?? state;

  /*
    The position one render ago. Updated in an effect declared *after* the one
    that freezes, so that when a spin lands this still holds the board the
    player was looking at a moment earlier — which is exactly what has to stay
    on screen while the wheel runs.
  */
  const before = useRef(state);

  useLayoutEffect(() => {
    if (state.spins === seenSpin.current) return;
    seenSpin.current = state.spins;
    if (wantsStillness()) return;
    setSpinning(true);
    setFrozen(before.current);
    const id = setTimeout(() => {
      setSpinning(false);
      setFrozen(null);
    }, spinMs(state.travel));
    return () => clearTimeout(id);
    // Layout rather than plain effect: a passive one runs after paint, so the
    // spun value got one frame on screen before the freeze caught it — a
    // flicker of the answer, which is the whole thing this is here to prevent.
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

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  const bank = seat === null ? 0 : (shown.bank[seat] ?? 0);
  const canBuyVowel = canAct && !spinning && shown.phase === "spin" && bank >= VOWEL_COST;
  // The one gate the wheel and the Spin button share. They are two ways of
  // making the same move and must never be offered on different terms.
  const canSpin = canAct && !spinning && shown.phase === "spin";
  const justCalled = shown.roundOver
    ? null
    : (shown.called[shown.called.length - 1] ?? null);
  // Where the wheel is standing, which outlives the turn that spun it — see
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

  return (
    <div className="wof">
      <p className="wof-round">
        Round {shown.round} of {ROUNDS} · {shown.category}
      </p>

      <div
        className="wof-puzzle"
        role="img"
        aria-label={`${shown.category}. ${spoken(shown.answer)}`}
      >
        {shown.answer.split(" ").map((word, w) => (
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
        {shown.note ? `${nameFor(shown.note.seat)} ${shown.note.text}` : ""}
      </p>

      {!shown.roundOver && (
        <div className="wof-wheel">
          <Wheel
            state={state}
            spinning={spinning}
            grabbable={canSpin && !spinning}
            onSpin={(power) => onMove({ type: "spin", power })}
          />

          {/* What the wheel means, in words. The wheel is the flourish; this
              is the fact, and it waits for the pointer to stop so the two
              never disagree in front of the player. */}
          <p className="wof-readout" role="status" aria-live="polite">
            {spinning ? (
              <span className="wof-prompt">Spinning…</span>
            ) : shown.wedge?.kind === "cash" ? (
              <>
                <span className="wof-value">{money(shown.wedge.value)}</span>
                <span className="wof-prompt">for every letter found</span>
              </>
            ) : landed !== null && landed.kind !== "cash" ? (
              <span className="wof-prompt">{wedgeName(landed)}</span>
            ) : (
              <span className="wof-prompt">
                {canAct ? "Flick the wheel, buy a vowel, or solve" : "Waiting on the wheel"}
              </span>
            )}
          </p>

          {/* How much of the streak is left. A wrong guess ends the turn on
              the spot, which needs no meter — nobody has to be told they get
              one. The cap on right ones is the rule that is actually news, so
              it is the only one shown. */}
          {canAct && (
            <div className="wof-meters">
              <p className={findsLeft === 1 ? "wof-guesses last" : "wof-guesses"}>
                <span className="wof-pips" aria-hidden="true">
                  {Array.from({ length: FINDS_PER_TURN }, (_, i) => (
                    <i key={i} className={i < findsLeft ? "" : "spent"} />
                  ))}
                </span>
                {findsLeft} {findsLeft === 1 ? "letter" : "letters"} left
              </p>
            </div>
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
              <button className="primary" disabled={!canAct} onClick={() => onMove({ type: "next" })}>
                Start round {shown.round + 1}
              </button>
            )
          ) : (
            <>
              <button
                className="primary"
                disabled={!canSpin}
                /* No `power`, so the wheel decides — see WofMove. This is the
                   keyboard's throw, and a player who would rather not flick. */
                onClick={() => onMove({ type: "spin" })}
              >
                Spin
              </button>
              <button
                disabled={!canSpin}
                onClick={() => setSolving(true)}
              >
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
                  className={spent ? "wof-key surface spent" : "wof-key surface"}
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
            {shown.phase === "call"
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
        {shown.bank.map((amount, index) => (
          <div
            key={index}
            className={["wof-purse", `p${index}`, shown.turn === index && !shown.over ? "active" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="chip" aria-hidden="true" />
            <span className="who">{nameFor(index)}</span>
            <span className="round">{money(amount)}</span>
            <span className="banked">{money(shown.score[index] ?? 0)} banked</span>
          </div>
        ))}
      </div>
    </div>
  );
}
