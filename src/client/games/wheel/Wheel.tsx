/**
 * The wheel itself: the sectors, their labels, the flap the pointer rides, and
 * the throw that spins it.
 *
 * A whole file because it is the one thing on this board that is a picture
 * rather than a screen. It is handed a state and a move sender and knows
 * nothing else about the game -- not the puzzle, not the purses, not whose turn
 * it is beyond what `canAct` tells it.
 *
 * The geometry it draws with lives in `wheelGeometry.ts`, shared with the test
 * that renders the wheel to a PNG and holds it to a digest. Changing a number
 * here that belongs there will fail that test, which is the point of it.
 */
import { useEffect, useRef, useState } from "react";
// Values from wheelDisplay.js, which imports nothing: the board must never
// pull the reducer (and its answer bank) into the client bundle. The types
// below are type-only, so they carry no runtime import.
import {
  WEDGE_ARC,
  WHEEL,
  spinMs,
  wedgeLabel,
} from "../../../shared/games/wheelDisplay.js";
import type { Wedge, WofState } from "../../../shared/games/wheel.js";
import {
  HUB_RADIUS,
  RADIUS,
  flapAngle,
  restAngle,
  sectorPath,
} from "../wheelGeometry.js";

/** Where a wedge's label sits. The rim itself is RADIUS, from
    `wheelGeometry.ts`; this is far enough in that a number clears the pointer
    and near enough out that it has the wedge's full width to sit across. */
const LABEL_RADIUS = 80;

/**
 * The window onto the wheel: how wide a slice of it the table shows, and how
 * far down it reaches.
 *
 * A whole wheel in a phone's width is a wheel about 340px across, and at
 * thirty-six wedges that is ten degrees of arc for a three-figure sum. So the
 * box is 150 units wide against a 200-unit wheel: most of the wheel, with the
 * far sides of the rim running off both edges, which is what keeps a wedge
 * wide enough to letter.
 *
 * The depth is a fraction of the wheel rather than the whole radius: SHOW is
 * how much of the 200-unit diameter the window keeps, measured down from the
 * top of the rim, and CROP is that plus the sliver of clearance the pointer
 * needs above it. The hub therefore sits well below the frame again, and the
 * numbers cannot be read off the box. See HUB_Y.
 *
 * The frame's `aspect-ratio` has to be VIEW_W / CROP exactly: the SVG keeps the
 * default `preserveAspectRatio`, so a box that disagrees with the viewBox does
 * not crop harder, it letterboxes, and the wheel shrinks away from the sides of
 * a frame still holding the old height. It used to be written out a second time
 * in the stylesheet, and the two had to be changed together by hand. Now the
 * board hands the ratio over as `--wof-frame` and there is only the one number:
 * see the style on `.wof-wheel-frame` below.
 */
const VIEW_W = 100;

/** Clearance above the rim, in box units. The pointer is drawn from y=1 to
    y=17, so the wheel starts below its tip. */
const RIM_TOP = 8;

/** How much of the wheel's diameter the window keeps, from the top of the rim
    down. Small on purpose: the wedges that matter are the ones at the pointer,
    and the rest of the disc is scenery that costs height a phone has not got.

    It was 0.3, and 0.3 is the single reason this table did not fit a screen:
    at the column's full width that frame was 459px tall, which is half a
    laptop before the keyboard has been drawn. Cutting the band rather than
    scaling the wheel is what keeps a wedge the size it was: the labels are
    sized against the wedge, not against the frame, so nothing here touched
    them. The rim still runs off both sides at the bottom edge (at y = CROP the
    disc is 160 units across against a 90-unit window), which is the whole
    point of a wheel too big for its window. */
const SHOW = 0.2;

const CROP = Math.round(RIM_TOP + 2 * RADIUS * SHOW);

/**
 * The wheel's hub, in the box's own coordinates: one radius below the top of
 * the rim, which puts it below the bottom edge of the frame. That is why it is
 * derived from RIM_TOP and not from CROP. Tying it to the bottom edge
 * (`CROP - 8`) meant cropping the window slid the whole wheel up with it, and
 * the top of the rim went out of the frame along with the middle of it.
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
const HUB_Y = RIM_TOP + RADIUS;

/** How long a release looks back for its speed. Long enough to average out a
    jittery finger, short enough that a drag that stopped dead reads as one. */
const FLICK_WINDOW_MS = 120;

/**
 * Bankrupt and Lose a Turn, as marks rather than words.
 *
 * They used to be set as text, and there is no room for it: a wedge is 10 deg,
 * which is about fourteen units of arc at the label radius, and "BANKRUPT"
 * laid across that at any readable size runs over its neighbours and off the
 * rim. A mark is read at a glance anyway, which is all a wheel in motion gives
 * you, and the words themselves are still said in full underneath, in the
 * readout and in the note line.
 *
 * Drawn about the origin, so the caller places them the same way it places a
 * number: rotated with the wedge, at the label radius.
 */
function wedgeGlyph(wedge: Wedge): string {
  // Bankrupt: the "none of it" sign, a ring with a stroke through it.
  if (wedge.kind === "bankrupt") {
    return "M 3.6 0 A 3.6 3.6 0 1 1 -3.6 0 A 3.6 3.6 0 1 1 3.6 0 M -2.5 -2.5 L 2.5 2.5";
  }
  // Lose a Turn: two chevrons, pointing the way the turn is about to go.
  return "M -3.2 -2.7 L -0.2 0 L -3.2 2.7 M 0.6 -2.7 L 3.6 0 L 0.6 2.7";
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
 * The server resolves the spin, being the only thing here holding an rng, and
 * sends back the index it landed on and the distance it covered. This animates
 * *to* that index; it never chooses one. Watching the wheel and then being told
 * a different number is the one thing that would make the whole game feel
 * rigged, so the pointer and the money below it always read the same field.
 *
 * `spins` rather than `wedgeAt` is what triggers a throw: two spins running
 * can land on the same wedge, and a wheel that sat still on the second one
 * would look broken.
 *
 * The rim is grabbable. A drag turns the wheel under the finger at one to one,
 * and the speed at the moment of release, signed so a flick left throws it
 * left, is the whole of the throw. Where the drag *left* the wheel decides
 * nothing: see the note on `spin` in `wheel.ts` for why the landing is anchored
 * to where the wheel stopped last time instead.
 */
export function Wheel({
  state,
  spinning,
  grabbable,
  onSpin,
  onSettled,
}: {
  state: WofState;
  spinning: boolean;
  grabbable: boolean;
  onSpin: (velocity: number) => void;
  onSettled: () => void;
}) {
  /*
    Where the wheel is standing and how long it has to get there. One piece of
    state because they are one fact, and because the duration can only be worked
    out in the same breath as the angle. A drag sets `ms` to zero; the
    stylesheet takes it from here.
  */
  const [turn, setTurn] = useState(() => ({
    angle: restAngle(state.wedgeAt === null ? null : state.rest),
    ms: 0,
  }));
  const angle = turn.angle;
  const [dragging, setDragging] = useState(false);
  const seen = useRef(state.spins);
  /* The two elements the flapper loop touches directly. It runs every frame
     of a spin, and putting the deflection through React state would re-render
     seventy-two paths sixty times a second to move one triangle. */
  const turning = useRef<SVGGElement>(null);
  const flapper = useRef<SVGPathElement>(null);

  /** Lay the flapper against the wheel standing at `wheel` degrees. */
  function setFlap(wheel: number) {
    if (flapper.current)
      flapper.current.style.transform = `rotate(${flapAngle(wheel)}deg)`;
  }
  /* The live drag: where the finger started, what the wheel read then, and the
     last few positions with their timestamps, the tail being what a release is
     measured over. Held in a ref rather than in state because it changes on
     every pointermove and none of it is drawn. */
  const drag = useRef<{
    from: number;
    base: number;
    trail: { at: number; t: number }[];
  } | null>(null);

  useEffect(() => {
    if (state.spins === seen.current) return;
    seen.current = state.spins;
    if (state.wedgeAt === null) return;
    setTurn((current) => {
      // The distance the throw actually covered, signed: a flick left turns the
      // wheel left, and a hard one visibly goes further than a gentle one.
      const swept = current.angle + state.travel * WEDGE_ARC;
      const target = restAngle(state.rest);
      // ...landed where the throw left it. `swept` is the exact distance from
      // where the wheel *rested*, but a drag may have left it up to half a
      // turn either side of that, so the last step is the nearest angle to the
      // physical distance that stands the wheel at `state.rest`. Nothing here
      // rounds to a wedge any more: `rest` is fractional, so the correction is
      // only ever the whole turn the drag added or took off.
      const landed = swept + (((((target - swept) % 360) + 540) % 360) - 180);
      // Timed from the distance actually drawn rather than from `travel`, so
      // the wheel decelerates at the wheel's own rate whatever the drag added
      // or took off. The two agree to within a few per cent; the transition and
      // the freeze upstairs would both be lying about the other few.
      return {
        angle: landed,
        ms: spinMs(Math.abs(landed - current.angle) / WEDGE_ARC),
      };
    });
  }, [state.spins, state.wedgeAt, state.rest, state.travel]);

  /**
   * The flapper, through a spin.
   *
   * Read off the wheel's *live* rotation rather than worked out from a clock,
   * because the wheel is turned by a CSS transition and only the engine knows
   * how far through its easing it is. `getComputedStyle` gives the matrix it
   * has actually resolved to this frame; the rest is `flapAngle`.
   *
   * Nothing here is verifiable in the preview pane, which is a hidden document
   * and never fires a frame. See `wheelGeometry.test.ts` for the half that can
   * be pinned.
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
      // it as the identity. It should never appear, the group always carrying a
      // rotate, but a throw here would stop the loop dead mid-spin.
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
    // Captured, so a finger that leaves the frame mid-throw, which is most of
    // them given the frame is a band, still finishes its drag here. It throws
    // if the pointer has already gone, and a throw here would cost the drag
    // rather than the capture, so it is allowed to fail.
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* no capture; the drag still works while the finger stays on the wheel */
    }
    const at = angleAt(svg, event.clientX, event.clientY);
    drag.current = {
      from: at,
      base: angle,
      trail: [{ at: 0, t: event.timeStamp }],
    };
    setDragging(true);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    const live = drag.current;
    if (!live) return;
    const raw =
      angleAt(event.currentTarget, event.clientX, event.clientY) - live.from;
    // atan2 wraps at the bottom of the circle; the trail must not, or a drag
    // that crossed the wrap would read as a full turn the other way.
    const last = live.trail[live.trail.length - 1].at;
    const turned = last + (((raw - last + 540) % 360) - 180);
    live.trail.push({ at: turned, t: event.timeStamp });
    if (live.trail.length > 24) live.trail.shift();
    // No easing under the hand: the wheel is where the finger is, this frame.
    setTurn({ angle: live.base + turned, ms: 0 });
    // Under the hand the wheel ticks too, which is most of what tells you you
    // have hold of it.
    setFlap(live.base + turned);
  }

  function release(event: React.PointerEvent<SVGSVGElement>) {
    const live = drag.current;
    if (!live) return;
    drag.current = null;
    setDragging(false);
    // The turn can move on mid-drag: somebody else solved it, or the round
    // ended. The wheel is left wherever the hand put it, which the next spin's
    // snap tidies up; what must not happen is a move nobody may make.
    if (!grabbable) return;

    // Speed over the tail of the drag rather than over the whole of it: a
    // player who lines the wheel up slowly and then snaps it has thrown it
    // hard, and the seconds before the snap are no part of the throw.
    const trail = live.trail;
    const last = trail[trail.length - 1];
    const first =
      trail.find((sample) => last.t - sample.t <= FLICK_WINDOW_MS) ?? trail[0];
    const ms = last.t - first.t;
    // Signed, and in the same units the reducer thinks in: degrees of the
    // wheel's own rotation per millisecond, positive clockwise. `spinThrow`
    // clamps it at both ends and floors it, so a finger that stopped dead
    // before letting go still throws the wheel. See SPIN_MIN_TRAVEL.
    const velocity = ms > 0 ? (last.at - first.at) / ms : 0;
    onSpin(velocity);
  }

  const classes = ["wof-disc"];
  if (spinning) classes.push("spinning");
  if (grabbable) classes.push("grabbable");
  if (dragging) classes.push("dragging");

  return (
    /* The frame's shape is the viewBox's shape or the wheel letterboxes inside
       it, so it is handed over from here rather than written out again in the
       stylesheet, where it could only be kept in step by remembering to. */
    <div
      className="wof-wheel-frame"
      style={{ "--wof-frame": `${VIEW_W} / ${CROP}` } as React.CSSProperties}
    >
      <svg
        className={classes.join(" ")}
        viewBox={`0 0 ${VIEW_W} ${CROP}`}
        /* The three numbers the stylesheet needs and cannot know: how long
           this throw takes, which is the throw's own duration and not a stock
           one, and where the wheel's hub is. The pivot used to be `center`,
           which meant half the box: true only while the box was square, and it
           stopped being square the moment it was cropped. */
        style={
          {
            "--wof-spin": `${turn.ms}ms`,
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
        {/* Two groups, and they do different jobs: the outer one is the only
            thing that turns, and the inner one never moves; it just carries
            the wheel from the origin to the hub. See HUB_X. There is no clip
            any more: the box itself is the crop now that the whole radius is
            inside it, and what falls off the sides is the far rim of a wheel
            wider than the frame.

            `transitionend` is what says the wheel has stopped, rather than a
            second clock upstairs racing this one. The board holds the whole
            position back until it fires. */}
        <g>
          <g
            className="wof-turn"
            ref={turning}
            style={{ transform: `rotate(${angle}deg)` }}
            /* This element's own rotation, and nothing else. React routes a
               bubbled `transitionend` through here too, so a transition added
               to a wedge or a label later would otherwise end the spin early,
               and ending it early is the board showing the answer over a wheel
               that is still going round. */
            onTransitionEnd={(event) => {
              if (
                event.target === turning.current &&
                event.propertyName === "transform"
              ) {
                onSettled();
              }
            }}
          >
            <g transform={`translate(${HUB_X} ${HUB_Y})`}>
              {WHEEL.map((wedge, index) => (
                <path
                  key={index}
                  className={wedgeClass(index)}
                  d={sectorPath(index)}
                />
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
        {/* The hub. Still, and drawn over the turning group: thirty-six wedges
            meeting at a point is thirty-six slivers of mush, and a wheel needs
            something at the middle holding it anyway. */}
        <circle className="wof-hub" cx={HUB_X} cy={HUB_Y} r={HUB_RADIUS} />
        <circle
          className="wof-hub pin"
          cx={HUB_X}
          cy={HUB_Y}
          r={HUB_RADIUS / 3}
        />
        {/* The flapper. Drawn inside the wheel's own box rather than floated
            over it, so it sits on the rim at every width without a percentage
            anybody has to keep in step with the crop. One wedge wide, so what
            it is sitting on is unmistakable, and hinged at its top edge, so
            each peg that passes underneath can knock the tip aside. */}
        <path
          className="wof-pointer"
          ref={flapper}
          d={`M ${HUB_X} 17 L ${HUB_X - 6} 1 L ${HUB_X + 6} 1 Z`}
        />
      </svg>
    </div>
  );
}
