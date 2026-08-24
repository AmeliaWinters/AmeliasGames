import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tray } from "../../shared/games/dice.js";
import { row3, startingFrom, type Flick, type Rest3, type ThrownDice, type Toss } from "../../shared/games/toss.js";
import { useFlick } from "../dice/flick.js";
import { clatter, buzz } from "../feel.js";
import { wantsStillness } from "../motion.js";
import type { DiceScene, OnScreen, Placed } from "./scene.js";
import type * as Engine from "./engine.js";

/**
 * A tray of real dice.
 *
 * The replacement for `dice/DiceTray.tsx`, which drew cubes as six CSS faces
 * under `preserve-3d` and turned them by writing a `matrix3d`. Same job, same
 * props, same gesture — `flick.ts` is reused unchanged, because a flick was
 * always measured in tray widths a second and never in anything this file
 * knows about.
 *
 * ── The picture is a canvas; the interface is not ─────────────────────
 *
 * The dice are drawn by WebGL, but everything a player *operates* is still
 * HTML sitting on top of it: one `<button>` per die, positioned each frame
 * from where `scene.draw` says that die came out on screen, carrying the
 * `aria-label`, the `aria-pressed`, the focus ring and the 44px target it
 * carried before. A canvas has no DOM inside it to hang any of that on, and
 * "the dice got prettier and stopped being reachable by keyboard" is not a
 * trade anyone asked for.
 *
 * ── Who runs the simulation, and when ────────────────────────────────
 *
 * The client that throws runs it **twice**. Once immediately, all the way to
 * rest, to find out what it rolled — that is what gets sent, because the
 * server no longer has a simulation to find out for itself. Then again, from
 * the same seed and the same starting places, as the animation. Two runs of
 * two milliseconds, and the second is guaranteed to agree with the first
 * because `startingFrom` is shared with the reducer.
 *
 * Everyone else in the room gets the seed and replays it. That was a deliberate
 * choice — see `toss.ts` — and it is why the dice are *placed* from `toss.rest`
 * whenever they are not in flight: the animation is the local replay, and the
 * record is what the scoresheet is reading.
 */

export interface Dice3DTrayProps {
  count: number;
  /** The tray's own units. Shared with the reducer — see `dice.ts`. */
  tray: Tray;
  /** What the dice landed on. Used for the spoken labels, not for the picture. */
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
  /**
   * Absent when this player cannot throw right now.
   *
   * Takes the whole result rather than the flick, because the throw has already
   * happened by the time this is called: the physics ran here.
   */
  onThrow?(thrown: ThrownDice): void;
  /** Absent in games where a die is not something you tap. */
  onTapDie?(index: number): void;
  /** Whether a die may be kept right now. Ignored without `onTapDie`. */
  keepable?: boolean;
  onRest(): void;
}

/**
 * What a board can ask the tray to do.
 *
 * One thing, and it exists because the physics now lives in here. Both dice
 * games put a "Roll" button beside the tray — the floor, not the ceiling: the
 * same throw for a thumb that would rather press something, and the one a
 * keyboard reaches without focusing the tray. That button is outside this
 * component and cannot run a simulation, and having it send a move with no
 * throw in it would quietly give the keyboard player the server's fallback
 * every time: dice that appear rather than dice that are thrown.
 */
export interface DiceTrayHandle {
  throwNow(flick: Flick): void;
}

/** What a keepable die is called, for anyone who cannot see it. */
function dieLabel(index: number, face: number, held: boolean, flying: boolean): string {
  const what = flying ? "in the air" : face >= 1 && face <= 6 ? String(face) : "not thrown";
  return "Die " + (index + 1) + ", " + what + (held ? ", kept" : "");
}

/**
 * The engine and the renderer, fetched once and shared by every tray.
 *
 * A dynamic `import()` so that Wheel, Letterpress, Word Hunt and the other six
 * games never download a physics engine and a 3D renderer to draw a board that
 * has no dice on it. Cached as the promise rather than the result, so two trays
 * mounting together — Liar's Dice shows one per player — make one request.
 */
let loading: Promise<{ engine: typeof Engine; scene: typeof import("./scene.js") }> | null = null;
function load() {
  if (!loading) {
    loading = Promise.all([import("./engine.js"), import("./scene.js")]).then(async ([engine, scene]) => {
      await engine.initDice();
      return { engine, scene };
    });
  }
  return loading;
}

/** A resting die, in the physics frame the scene draws in. */
function placedFrom(rest: readonly Rest3[], tray: Tray, k: number, half: number): Placed[] {
  const w = tray.w / k;
  const h = tray.h / k;
  return rest.map((r) => ({
    x: r.x / k - w / 2,
    y: r.up / k + half,
    z: r.y / k - h / 2,
    q: r.q,
  }));
}

export const Dice3DTray = forwardRef<DiceTrayHandle, Dice3DTrayProps>(function Dice3DTray(
  {
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
  },
  handle,
) {
  const box = useRef<HTMLDivElement>(null);
  /* Two trays can be on screen at once — Liar's Dice shows every player's — so
     the hint's id has to be unique per instance or `aria-describedby` points
     every tray at the first one's line. */
  const hintId = useId();

  const kit = useRef<Awaited<ReturnType<typeof load>> | null>(null);
  const scene = useRef<DiceScene | null>(null);
  const live = useRef<Engine.ThrowWorld | null>(null);
  const pending = useRef(0);
  const [ready, setReady] = useState(false);
  /** Where each die is on screen, so the buttons can be put over them. */
  const [spots, setSpots] = useState<Array<OnScreen | null>>([]);

  /* The last throw this tray has run. Starts at whatever the state arrived
     holding, so a player who reconnects into a game in progress is shown the
     dice where they lie rather than watching a throw that happened while they
     were away. */
  const seen = useRef(toss?.n ?? 0);

  /* The loop outlives the render that made it, so anything it reads has to
     come from a ref rather than from that render's props. */
  const latest = useRef({ held, spent, onRest, mine, count, tray });
  latest.current = { held, spent, onRest, mine, count, tray };

  useEffect(() => {
    let alive = true;
    load().then((mods) => {
      if (!alive) return;
      kit.current = mods;
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Draw whatever the world currently holds, and place the buttons over it. */
  const paint = useCallback((dice: readonly Placed[]) => {
    const view = scene.current;
    if (!view) return;
    setSpots(view.draw(dice, { held: latest.current.held, spent: latest.current.spent }));
  }, []);

  /** The dice standing still, where the throw left them. */
  const place = useCallback(
    (at: readonly Rest3[]) => {
      const mods = kit.current;
      if (!mods || !scene.current) return;
      paint(placedFrom(at, tray, mods.engine.scaleOf(tray), mods.engine.DIE_HALF));
    },
    [tray, paint],
  );

  // Build the renderer once the modules are here, and give the GPU back when
  // this tray goes away — a dropped WebGL context still counts against a small
  // per-page limit, and Liar's Dice plus a rematch is enough to reach it.
  useLayoutEffect(() => {
    if (!ready || !box.current || !kit.current) return;
    const view = kit.current.scene.createScene(box.current, tray);
    scene.current = view;
    return () => {
      view.dispose();
      scene.current = null;
    };
  }, [ready, tray]);

  /*
    Where the dice sit when nothing is happening: where the last throw left
    them, or in a row if there has not been one.

    One expression, used by both the effect below and the resize observer.
    They used to differ — the effect fell back to a row and the observer only
    redrew `if (idle)` — so a tray that had never been thrown into resized its
    canvas and then never repainted, leaving five dice drawn for the old width
    and five buttons sitting wherever they had been. It showed at 320px, which
    is where everything in this project shows.
  */
  const resting = useMemo(
    () => (toss?.rest?.length === count ? toss.rest : row3(tray, count)),
    [toss, tray, count],
  );

  // Where the dice are when nothing is happening. Not while a throw is running,
  // and not for a throw about to start either — this effect is declared before
  // that one and would otherwise stand the dice on their finishing places a
  // moment before the throw put them back.
  useLayoutEffect(() => {
    if (!ready) return;
    if (pending.current !== 0) return;
    if (toss && toss.n !== seen.current) return;
    place(resting);
  }, [ready, place, resting, toss]);

  // And again whenever the tray changes size — the positions are in tray
  // units, so a phone turning sideways only changes the scale.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(() => {
      scene.current?.resize();
      // Mid-throw, redraw the throw; otherwise redraw wherever they are lying.
      // Never neither: a resize that moves the camera and repaints nothing
      // leaves the dice drawn for a tray that no longer exists.
      const world = live.current;
      const mods = kit.current;
      if (world && mods) paint(mods.engine.placedOf(world));
      else place(resting);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [paint, place, resting]);

  // The throw.
  useLayoutEffect(() => {
    if (!ready || !toss || toss.n === seen.current) return;
    const mods = kit.current;
    if (!mods) return;
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

    const world = mods.engine.openThrow({
      tray,
      count,
      seed: toss.seed,
      flick: { x: toss.x, y: toss.y },
      from: toss.from,
      held: keeping,
    });
    live.current = world;
    if (latest.current.mine) buzz(16);
    paint(mods.engine.placedOf(world));

    const hits: Engine.Hit[] = [];
    let last = 0;
    let carried = 0;

    const frame = (now: number) => {
      const running = live.current;
      if (!running) return;
      if (last === 0) last = now;
      // Capped, so a tab that was hidden for a minute does not try to simulate
      // a minute of dice the moment it comes back.
      carried += Math.min(now - last, mods.engine.PHYS.MAX_FRAME * 1000) / 1000;
      last = now;

      let moving = 1;
      let steps = 0;
      const heard: Engine.Hit[] = [];
      while (carried >= mods.engine.PHYS.STEP && steps < mods.engine.PHYS.MAX_SUBSTEPS) {
        moving = mods.engine.stepThrow(running, hits);
        for (const hit of hits) heard.push(hit);
        carried -= mods.engine.PHYS.STEP;
        steps++;
      }

      // The loudest contact of the frame, once. Five dice landing together is
      // one clatter, not five clicks inside 16ms.
      let loudest: Engine.Hit | null = null;
      for (const hit of heard) if (!loudest || hit.impulse > loudest.impulse) loudest = hit;
      if (loudest) {
        clatter(Math.min(loudest.impulse / 900, 1), loudest.wall);
        if (latest.current.mine && loudest.impulse > 300) buzz(7);
      }

      paint(mods.engine.placedOf(running));

      if (moving > 0 && steps > 0) {
        pending.current = requestAnimationFrame(frame);
        return;
      }
      if (steps === 0) {
        // Nothing was stepped this frame — the accumulator has not filled yet.
        // Not the end of the throw; just a frame that arrived early.
        pending.current = requestAnimationFrame(frame);
        return;
      }
      pending.current = 0;
      mods.engine.disposeThrow(running);
      live.current = null;
      /*
        Placed from the record rather than left where the local replay stopped.

        This is the one line where "replay the seed and trust it" stops being
        trusted, and it is here because the alternative is the bug this whole
        change started from: a cube showing a number that disagrees with the
        scoresheet beside it. The animation is the replay; the resting place is
        the throw as it was reported. On the client that threw them these are
        the same dice, and on any other one the difference lasts a single frame.
      */
      place(toss.rest);
      latest.current.onRest();
    };

    cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(frame);
  }, [ready, toss, tray, count, place, paint]);

  useEffect(
    () => () => {
      cancelAnimationFrame(pending.current);
      const world = live.current;
      if (world && kit.current) kit.current.engine.disposeThrow(world);
      live.current = null;
    },
    [],
  );

  /**
   * Throw them, here and now, and report what happened.
   *
   * The whole simulation runs synchronously before anything is sent, because
   * the server has none and the faces have to come from somewhere. Two
   * milliseconds for five dice; the animation is a second run of the same seed
   * once the move comes back.
   */
  const throwNow = useCallback(
    (flick: Flick) => {
      const mods = kit.current;
      if (!mods || !onThrow) return;
      const from = startingFrom(toss, tray, count);
      const seed = (Math.random() * 0x1_0000_0000) >>> 0;
      const world = mods.engine.openThrow({
        tray,
        count,
        seed,
        flick,
        from,
        held: latest.current.held,
      });
      const out = mods.engine.settleThrow(world);
      mods.engine.disposeThrow(world);
      onThrow({ ...flick, seed, faces: out.faces, rest: out.rest });
    },
    [onThrow, toss, tray, count],
  );

  useImperativeHandle(handle, () => ({ throwNow }), [throwNow]);

  const { handlers, armed } = useFlick({
    // A tap on a die is this gesture too, so the tray has to be listening even
    // when there is nothing to throw — otherwise keeping all five in Yahtzee
    // disables the throw and takes releasing one down with it.
    enabled: (Boolean(onThrow) || Boolean(onTapDie && keepable)) && ready,
    onThrow: onThrow ? throwNow : undefined,
    onTapDie,
  });

  const throwable = Boolean(onThrow);

  return (
    <div
      ref={box}
      className={["dice-tray", "dice-tray-3d", armed ? "armed" : "", throwable ? "live" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        // The tray the player sees is the tray the throw happened in.
        ["--tray-ratio" as string]: tray.w + " / " + tray.h,
      }}
      role={throwable ? "button" : "group"}
      tabIndex={throwable ? 0 : undefined}
      aria-label={label}
      // The hint below says how — flick to throw, tap a die to keep it.
      // Described rather than labelled: the label is the state, this is the
      // instruction, and a screen reader reads the two in that order.
      aria-describedby={hint ? hintId : undefined}
      {...handlers}
    >
      {Array.from({ length: count }, (_, i) => {
        const spot = spots[i];
        /*
          A die with nowhere to be is a die that was not thrown — Backgammon
          draws a double as four moves but only ever throws two cubes. The
          canvas hides the cube; this hides its button, so a screen reader is
          not offered a die that is not on the table.
        */
        if (!spot) return null;
        const size = Math.max(spot.size, 44);
        const style = {
          left: spot.x - size / 2 + "px",
          top: spot.y - size / 2 + "px",
          width: size + "px",
          height: size + "px",
        };
        if (!onTapDie) {
          return <span key={i} className="die-mark" aria-hidden="true" style={style} />;
        }
        return (
          <button
            key={i}
            type="button"
            className={held?.[i] ? "die-mark die-hold held" : "die-mark die-hold"}
            data-die={i}
            disabled={flying || !keepable}
            aria-pressed={Boolean(held?.[i])}
            aria-label={dieLabel(i, faces[i] ?? 0, Boolean(held?.[i]), flying)}
            style={style}
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
          />
        );
      })}
      {hint && (
        <p className="dice-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
});
