import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  ORIENTATIONS,
  P,
  open,
  row,
  step,
  type Contact,
  type Quat,
  type Rest,
  type Tray,
  type World,
} from "../../shared/games/dice.js";
import type { Flick, Toss } from "../../shared/games/toss.js";
import { Cube } from "../games/Die.js";
import { buzz, clatter } from "../feel.js";
import { useFlick } from "./flick.js";
import { wantsStillness } from "../motion.js";

/**
 * A surface you throw dice onto.
 *
 * It re-runs the throw the server already ran. The reducer simulated these
 * dice, read the faces off them where they stopped, and put the throw on the
 * wire; this replays it frame by frame so the player watches the dice arrive
 * at the number they were told. Nothing here chooses anything — and nothing
 * here has to fake anything either, because the number really is the one the
 * cube came to rest on.
 *
 * The tray is drawn at whatever size the screen allows and simulated in its
 * own units, so a phone and a laptop run the same throw and only the scale
 * between them differs. That is why the stylesheet gives it a fixed
 * `aspect-ratio` and this multiplies by one number.
 */

/** A rotation, as the sixteen numbers CSS wants, column by column. */
function matrix3d(q: Quat): string {
  const [w, x, y, z] = q;
  const m = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
  return "matrix3d(" + m.map((v) => v.toFixed(5)).join(",") + ")";
}

export interface DiceTrayProps {
  count: number;
  /** The tray's own units. Shared with the reducer — see `dice.ts`. */
  tray: Tray;
  /** What the dice landed on. Drawn only once they have. */
  faces: readonly number[];
  /** The throw to replay, or null before anyone has rolled. */
  toss: Toss | null;
  /** True from the first render that sees a new toss until it lands. */
  flying: boolean;
  /** Whether this client threw it: sound is the table's, haptics are the hand's. */
  mine?: boolean;
  /** Dice being kept. They stay put, and the thrown ones bounce off them. */
  held?: readonly boolean[];
  /** Dice already played this turn. Backgammon's; nothing else has them. */
  spent?: readonly boolean[];
  /** What the tray is, for anyone who cannot see it. */
  label: string;
  /** The line along the bottom edge, or nothing. */
  hint?: string;
  /** Absent when this player cannot throw right now. */
  onThrow?(flick: Flick): void;
  /** Absent in games where a die is not something you tap. */
  onTapDie?(index: number): void;
  /** Whether a die may be kept right now. Ignored without `onTapDie`. */
  keepable?: boolean;
  onRest(): void;
}

/** What a keepable die is called, for anyone who cannot see it. */
function dieLabel(index: number, face: number, held: boolean, flying: boolean): string {
  const what = flying ? "in the air" : face >= 1 && face <= 6 ? String(face) : "not thrown";
  return "Die " + (index + 1) + ", " + what + (held ? ", kept" : "");
}

export function DiceTray({
  count,
  tray,
  faces,
  toss,
  flying,
  mine,
  held,
  spent,
  label,
  hint,
  onThrow,
  onTapDie,
  keepable,
  onRest,
}: DiceTrayProps) {
  const box = useRef<HTMLDivElement>(null);
  /*
    Two arrays, because they are not always the same element. Where a die can
    be kept it is wrapped in a button — so keeping one is reachable by tab and
    not only by finger — and it is the button the solver moves, while the cube
    inside it does the turning.
  */
  const slots = useRef<Array<HTMLElement | null>>([]);
  const cubes = useRef<Array<HTMLElement | null>>([]);
  const world = useRef<World | null>(null);
  const pending = useRef(0);
  /*
    The last throw this tray has run. Starts at whatever the state arrived
    holding, so a player who reconnects into a game in progress is shown the
    dice where they lie rather than watching a throw that happened while they
    were away.
  */
  const seen = useRef(toss?.n ?? 0);

  /* The loop outlives the render that made it, so anything it reads has to
     come from a ref rather than from that render's props. */
  const latest = useRef({ held, onRest, mine });
  latest.current = { held, onRest, mine };

  /** Pixels per tray unit. The only thing the screen's size changes. */
  const scale = useCallback(() => {
    const rect = box.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect.width / tray.w : 0;
  }, [tray.w]);

  const draw = useCallback(() => {
    const live = world.current;
    const k = scale();
    if (!live || k === 0) return;
    const size = tray.die * k;
    // In pixels, and written here rather than declared in the stylesheet: a
    // die is a share of the tray, and a percentage would be resolved against
    // whichever box each rule happened to sit in — the pips are inside the
    // die, so theirs would come out a seventh of the size intended.
    box.current?.style.setProperty("--die", size.toFixed(2) + "px");
    /*
      Every slot, not every body — and the difference is a bug this has told
      twice. A slot with no body behind it is never given a position or a
      rotation, so it stays in the corner of the tray at the identity, and a
      cube at the identity is a cube showing a one. Backgammon drew a double
      as four dice that way and put two ones in the corner of the board.

      A tray asked for more dice than were thrown is a caller's mistake and
      not something to paper over, but a die that does not exist has to be
      *absent* rather than wrong: hidden is a hole, and a hole is something
      you go and look at.
    */
    slots.current.forEach((slot, i) => {
      const body = live.bodies[i];
      if (slot) slot.style.visibility = body ? "" : "hidden";
    });
    live.bodies.forEach((body, i) => {
      const slot = slots.current[i];
      if (slot) {
        const x = (body.x * k - size / 2).toFixed(2);
        const y = (body.y * k - size / 2).toFixed(2);
        // Nearer the eye while it is off the table, which is the only thing
        // that says a die passing over another is passing *over* it.
        const lift = 1 + 0.11 * (body.air / P.AIRBORNE);
        slot.style.transform =
          "translate(" + x + "px," + y + "px) scale(" + lift.toFixed(3) + ")";
      }
      const cube = cubes.current[i];
      if (cube) cube.style.transform = matrix3d(body.q);
    });
  }, [scale, tray.die]);

  /** The dice standing still, where the throw left them. */
  const place = useCallback(
    (at: readonly Rest[]) => {
      world.current = {
        tray,
        t: 0,
        bodies: at.map((rest) => ({
          x: rest.x,
          y: rest.y,
          a: 0,
          w: 0,
          vx: 0,
          vy: 0,
          q: ORIENTATIONS[rest.o % ORIENTATIONS.length],
          half: tray.die / 2,
          im: 0,
          ii: 0,
          asleep: true,
          slow: 0,
          air: 0,
          tip: null,
        })),
        rng: () => 0,
      };
      draw();
    },
    [tray, draw],
  );

  const idle = toss?.rest?.length === count ? toss.rest : row(tray, count);

  // Where the dice are when nothing is happening. Not while a throw is
  // running, and not for a throw about to start either — this effect is
  // declared before that one and would otherwise stand the dice on their
  // finishing places a moment before the throw put them back.
  useLayoutEffect(() => {
    if (pending.current !== 0) return;
    if (toss && toss.n !== seen.current) return;
    place(idle);
  }, [place, idle, toss]);

  // And again whenever the tray changes size — the positions are in tray
  // units, so a phone turning sideways only changes the scale.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(() => draw());
    watch.observe(el);
    return () => watch.disconnect();
  }, [draw]);

  useLayoutEffect(() => {
    if (!toss || toss.n === seen.current) return;
    seen.current = toss.n;
    const keeping = latest.current.held ?? [];

    if (wantsStillness()) {
      // The dice still land where and how they landed — they just get there at
      // once, and nothing is held back. The bargain the Wheel already strikes.
      place(toss.rest);
      clatter(0.6, false);
      if (latest.current.mine) buzz(10);
      latest.current.onRest();
      return;
    }

    world.current = open({ tray, toss, from: toss.from, held: keeping });
    if (latest.current.mine) buzz(16);
    draw();

    const contacts: Contact[] = [];
    let last = 0;
    let carried = 0;

    const frame = (now: number) => {
      const live = world.current;
      if (!live) return;
      if (last === 0) last = now;
      // Capped, so a tab that was hidden for a minute does not try to simulate
      // a minute of dice the moment it comes back.
      carried += Math.min(now - last, 100) / 1000;
      last = now;

      contacts.length = 0;
      let moving = live.bodies.filter((body) => !body.asleep).length;
      let steps = 0;
      while (carried >= P.STEP && steps < P.MAX_STEPS) {
        moving = step(live, contacts);
        carried -= P.STEP;
        steps++;
      }

      // The loudest contact of the frame, once. Five dice landing together is
      // one clatter, not five clicks inside 16ms.
      let loudest: Contact | null = null;
      for (const hit of contacts) {
        if (!loudest || hit.impulse > loudest.impulse) loudest = hit;
      }
      if (loudest) {
        clatter(Math.min(loudest.impulse / 70, 1), loudest.wall);
        if (latest.current.mine && loudest.impulse > 25) buzz(7);
      }

      draw();

      if (moving > 0) {
        pending.current = requestAnimationFrame(frame);
        return;
      }
      pending.current = 0;
      latest.current.onRest();
    };

    cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(frame);
  }, [toss, tray, place, draw]);

  useEffect(() => () => cancelAnimationFrame(pending.current), []);

  const { handlers, armed } = useFlick({
    // A tap on a die is this gesture too, so the tray has to be listening even
    // when there is nothing to throw — otherwise keeping all five in Yahtzee
    // disables the throw and takes releasing one down with it.
    enabled: Boolean(onThrow) || Boolean(onTapDie && keepable),
    onThrow,
    onTapDie,
  });

  const throwable = Boolean(onThrow);

  return (
    <div
      ref={box}
      className={["dice-tray", armed ? "armed" : "", throwable ? "live" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        // The tray the player sees is the tray the throw happened in. The
        // die's own size is set in pixels by `draw`, which is the only place
        // that knows what a tray unit is worth on this screen.
        ["--tray-ratio" as string]: tray.w + " / " + tray.h,
      }}
      role={throwable ? "button" : "group"}
      tabIndex={throwable ? 0 : undefined}
      aria-label={label}
      {...handlers}
    >
      {Array.from({ length: count }, (_, i) => {
        // A cube shows whatever face the solver has turned towards the
        // player, so there is nothing to withhold here and nothing to reveal:
        // the only thing the board decides is whether it has been thrown yet.
        const cube = (
          <Cube
            blank={!flying && (faces[i] ?? 0) === 0}
            spent={!flying && spent?.[i]}
            ref={(el) => {
              cubes.current[i] = el;
            }}
          />
        );
        if (!onTapDie) {
          return (
            <span
              key={i}
              className="die-slot"
              ref={(el) => {
                slots.current[i] = el;
              }}
            >
              {cube}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={held?.[i] ? "die-slot die-hold held" : "die-slot die-hold"}
            data-die={i}
            disabled={flying || !keepable}
            aria-pressed={Boolean(held?.[i])}
            aria-label={dieLabel(i, faces[i] ?? 0, Boolean(held?.[i]), flying)}
            ref={(el) => {
              slots.current[i] = el;
            }}
            /*
              Keyboard only. A tap is already the flick gesture's business —
              the tray captures the pointer, so a click here would either never
              arrive or arrive as well, and toggling twice is worse than
              either. Stopped from bubbling, or the tray would read Enter on a
              die as Enter on the tray and throw them.
            */
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onTapDie(i);
            }}
          >
            {cube}
          </button>
        );
      })}
      {hint && (
        <p className="dice-hint" aria-hidden="true">
          {hint}
        </p>
      )}
    </div>
  );
}
