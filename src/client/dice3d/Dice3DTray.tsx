import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tray } from "../../shared/games/dice.js";
import { row3, startingFrom, type Flick, type Rest3, type ThrownDice, type Toss } from "../../shared/games/toss.js";
import { useFlick } from "../dice/flick.js";
import { Die } from "../games/Die.js";
import { clatter, buzz } from "../feel.js";
import { wantsStillness } from "../motion.js";
import type { DiceScene, OnScreen, Placed } from "./scene.js";
import type * as Engine from "./engine.js";
import {
  cheerFlash,
  cheerLength,
  cheerPose,
  landedBetween,
  PLAYBACK,
  windUp,
  WINDUP_MS,
  type CheerKind,
} from "./beats.js";

/**
 * A tray of real dice.
 *
 * The replacement for `dice/DiceTray.tsx`, which drew cubes as six CSS faces
 * under `preserve-3d` and turned them by writing a `matrix3d`. Same job, same
 * props, same gesture: `flick.ts` is reused unchanged, because a flick was
 * always measured in tray widths a second and never in anything this file knows
 * about.
 *
 * The picture is a canvas; the interface is not
 *
 * The dice are drawn by WebGL, but everything a player *operates* is still
 * HTML sitting on top of it: one `<button>` per die, positioned each frame
 * from where `scene.draw` says that die came out on screen, carrying the
 * `aria-label`, the `aria-pressed`, the focus ring and the 44px target it
 * carried before. A canvas has no DOM inside it to hang any of that on, and
 * "the dice got prettier and stopped being reachable by keyboard" is not a
 * trade anyone asked for.
 *
 * Who runs the simulation, and when
 *
 * The client that throws runs it **twice**. Once immediately, all the way to
 * rest, to find out what it rolled, which is what gets sent because the server
 * no longer has a simulation to find out for itself. Then again, from the same
 * seed and the same starting places, as the animation. Two runs of two
 * milliseconds, and the second is guaranteed to agree with the first because
 * `startingFrom` is shared with the reducer.
 *
 * Everyone else in the room gets the seed and replays it. A deliberate choice,
 * see `toss.ts`, and it is why the dice are *placed* from `toss.rest` whenever
 * they are not in flight: the animation is the local replay, and the record is
 * what the scoresheet is reading.
 */

export interface Dice3DTrayProps {
  count: number;
  /** The tray's own units. Shared with the reducer, see `dice.ts`. */
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
  /**
   * A flourish to run once the dice are down, or nothing.
   *
   * Counted rather than compared, like every other repeatable event in this
   * app: two Yahtzees in two rounds are two of them, and `{ kind: "all" }`
   * twice running is indistinguishable from `{ kind: "all" }` once. The board
   * decides *whether*, being the one that knows the rules, and this decides when
   * and what it looks like, which is why three games can share it.
   */
  cheer?: { n: number; kind: CheerKind } | null;
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

/* Re-exported so a board naming a flourish imports it from the component it
   hands it to, rather than reaching past it into `beats.ts`. */
export type { CheerKind };

/**
 * What a board can ask the tray to do.
 *
 * One thing, and it exists because the physics now lives in here. Both dice
 * games put a "Roll" button beside the tray, the floor rather than the ceiling:
 * the same throw for a thumb that would rather press something, and the one a
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
 * mounting together (Liar's Dice shows one per player) make one request.
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
    cheer,
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
  /*
    The layer the beats are drawn on, and the reason it is a separate element
    rather than a class on the tray itself.

    The slow moment and the flourish are marked by writing classes straight
    onto a node, sixty times a second, because routing them through React would
    re-render every die button on the tray to catch a border colour. React,
    though, owns `className` on any element it renders: the moment `armed` or
    `throwable` changes it rewrites the whole attribute and takes anything
    written by hand with it. This element's `className` is a constant, so React
    never writes it after the first render and never has anything to take.
  */
  const beat = useRef<HTMLDivElement>(null);
  /* Two trays can be on screen at once, Liar's Dice showing every player's, so
     the hint's id has to be unique per instance or `aria-describedby` points
     every tray at the first one's line. */
  const hintId = useId();

  const kit = useRef<Awaited<ReturnType<typeof load>> | null>(null);
  const scene = useRef<DiceScene | null>(null);
  const live = useRef<Engine.ThrowWorld | null>(null);
  const pending = useRef(0);
  /** The flourish's own frame handle: it runs after the throw, not inside it. */
  const cheering = useRef(0);
  /** The last flourish this tray has run, by the counter the board hands it. */
  const cheered = useRef(0);
  /** One asked for while the dice were still in the air, owed until they land. */
  const queued = useRef<CheerKind | null>(null);
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

  /**
   * Draw whatever the world currently holds, and place the buttons over it.
   *
   * `glow` is how brightly the dice are lit from inside, and it is nought on
   * every frame but a flourish's.
   */
  const paint = useCallback((dice: readonly Placed[], glow = 0) => {
    const view = scene.current;
    if (!view) return;
    setSpots(view.draw(dice, { held: latest.current.held, spent: latest.current.spent, glow }));
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
  // this tray goes away. A dropped WebGL context still counts against a small
  // per-page limit, and Liar's Dice plus a rematch is enough to reach it.
  useLayoutEffect(() => {
    if (!ready || !box.current || !kit.current) return;
    /*
      A tray without a GPU draws nothing rather than taking the game down with
      it. `createScene` builds a `WebGLRenderer`, and that constructor throws
      outright when the canvas will not give up a context -- a device with
      WebGL disabled or blocklisted, a browser that has run out of contexts, or
      a headless environment. Thrown from a layout effect it reaches the app's
      error boundary, so the whole table becomes the white screen, including
      the Roll button that does not need a GPU and the score sheet that is the
      actual game.

      Every path below already checks `scene.current` for null, because that is
      the state a tray is in for the moment before the modules land. This makes
      that state permanent instead of fatal: the dice are not drawn, and
      everything a player operates -- the roll, the keeps, the labels -- is
      HTML that never went through WebGL in the first place.
    */
    let view;
    try {
      view = kit.current.scene.createScene(box.current, tray);
    } catch {
      return;
    }
    scene.current = view;
    return () => {
      view.dispose();
      scene.current = null;
    };
  }, [ready, tray]);

  /*
    Where the dice sit when nothing is happening: where the last throw left
    them, or in a row if there has not been one.

    One expression, used by both the effect below and the resize observer. They
    used to differ, the effect falling back to a row and the observer only
    redrawing `if (idle)`, so a tray that had never been thrown into resized its
    canvas and then never repainted, leaving five dice drawn for the old width
    and five buttons sitting wherever they had been. It showed at 320px, which
    is where everything in this project shows.
  */
  const resting = useMemo(
    () => (toss?.rest?.length === count ? toss.rest : row3(tray, count)),
    [toss, tray, count],
  );
  /* Where the dice are lying, reachable from a loop that outlived the render
     that knew. A ref rather than a dependency so `startCheer` stays stable: it
     is held by the throw's own loop, and a new identity every time the dice
     move would mean the loop holding a stale one for the length of a throw. */
  const lie = useRef(resting);
  lie.current = resting;

  // Where the dice are when nothing is happening. Not while a throw is running,
  // and not for a throw about to start either: this effect is declared before
  // that one and would otherwise stand the dice on their finishing places a
  // moment before the throw put them back.
  useLayoutEffect(() => {
    if (!ready) return;
    if (pending.current !== 0) return;
    if (toss && toss.n !== seen.current) return;
    place(resting);
  }, [ready, place, resting, toss]);

  // And again whenever the tray changes size. The positions are in tray units,
  // so a phone turning sideways only changes the scale.
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

  /**
   * The flourish, run here and now.
   *
   * Its own animation loop and its own handle, because it is not part of the
   * throw: the dice have already been reported, the scoresheet beside the tray
   * has already been written, and nothing this does is ever read back. That is
   * also the safety argument: see `beats.ts` for why the hop is scripted rather
   * than thrown, and why a turn about the world's vertical axis is the one kind
   * of spin that cannot change the number on top.
   */
  const startCheer = useCallback(
    (kind: CheerKind) => {
      const mods = kit.current;
      const el = beat.current;
      if (!mods || !el) return;
      const { count: many, tray: table } = latest.current;
      const rest = placedFrom(lie.current, table, mods.engine.scaleOf(table), mods.engine.DIE_HALF);
      const flash = cheerFlash(kind);
      el.style.setProperty("--cheer", String(flash));

      if (wantsStillness()) {
        /*
          The moment still happens; it simply does not move. The rim takes its
          tint, a colour not being motion, and the one player who most needs
          telling something rare occurred is the one who cannot watch it. The
          dice are left lying exactly where they are.
        */
        el.classList.add("cheering", "still");
        clatter(0.85, false, 1.35);
        cancelAnimationFrame(cheering.current);
        cheering.current = 0;
        window.setTimeout(() => el.classList.remove("cheering", "still"), 900);
        return;
      }

      el.classList.add("cheering");
      const total = cheerLength(kind, many);
      let opened = 0;
      let was = 0;

      const frame = (now: number) => {
        if (opened === 0) opened = now;
        const ms = now - opened;
        // Each die is heard as it touches down, a little higher than the one
        // before it, which is what makes a row of identical knocks a run.
        for (const i of landedBetween(kind, many, was, ms)) {
          clatter(0.8, false, 1 + i * 0.13);
        }
        was = ms;
        if (ms >= total) {
          cheering.current = 0;
          el.classList.remove("cheering");
          el.style.removeProperty("--cheer");
          paint(rest);
          return;
        }
        // One envelope over the whole flourish rather than one per die, so the
        // tray brightens and fades once instead of flickering five times.
        paint(cheerPose(rest, kind, ms), flash * 4 * (ms / total) * (1 - ms / total));
        cheering.current = requestAnimationFrame(frame);
      };

      cancelAnimationFrame(cheering.current);
      cheering.current = requestAnimationFrame(frame);
    },
    [paint],
  );

  /*
    A flourish asked for from outside.

    Keyed by `n` rather than by what it is, for the reason every other counter
    in this app exists: two Yahtzees in two rounds are two events, and one
    compared by value would fire once. Held back while a throw is running,
    because the move that says "five alike" arrives while the dice that say so
    are still in the air, and celebrating a number before it is on the table
    gives the result away and then plays the reveal.
  */
  useLayoutEffect(() => {
    if (!ready || !cheer || cheer.n === cheered.current) return;
    cheered.current = cheer.n;
    if (pending.current !== 0) queued.current = cheer.kind;
    else startCheer(cheer.kind);
  }, [ready, cheer, startCheer]);

  // The throw.
  useLayoutEffect(() => {
    if (!ready || !toss || toss.n === seen.current) return;
    const mods = kit.current;
    if (!mods) return;
    seen.current = toss.n;
    const keeping = latest.current.held ?? [];

    if (wantsStillness()) {
      // The dice still land where and how they landed, they just get there at
      // once and nothing is held back. The bargain the Wheel already strikes.
      place(toss.rest);
      clatter(0.6, false);
      if (latest.current.mine) buzz(10);
      latest.current.onRest();
      return;
    }

    /*
      The whole flick, aim included.

      `ax`/`ay` used to be dropped here, the spec being built as a fresh
      `{ x, y }` literal, and that is not a tidier way of saying the same thing.
      `entryOf` reads the aim to decide which edge of the tray the dice come in
      by, and a replay without it enters them somewhere else entirely, runs a
      different throw, and then snaps to the reported resting places at the end. `toss.ts` says it in as many words where it stores the field:
      "a re-run missing where the dice came in from lands them somewhere else."
    */
    const spec = {
      tray,
      count,
      seed: toss.seed,
      flick: { x: toss.x, y: toss.y, ax: toss.ax, ay: toss.ay },
      from: toss.from,
      held: keeping,
    };

    const world = mods.engine.openThrow(spec);
    live.current = world;

    /*
      The handful leaving the table.

      `placedOf` is where `openThrow` put the dice, up in the air and already
      moving, and `toss.from` is where they were lying before it. The wind-up
      draws the journey between the two, and until it is over the physics has
      not been stepped at all: `last` stays zero, so the first stepped frame
      measures its delta from the release rather than from the wind-up's start
      and the throw does not begin a sixth of a second behind itself.
    */
    const release = mods.engine.placedOf(world);
    const origin = placedFrom(toss.from, tray, mods.engine.scaleOf(tray), mods.engine.DIE_HALF);
    paint(windUp(origin, release, 0, keeping));

    const hits: Engine.Hit[] = [];
    let opened = 0;
    let last = 0;
    let carried = 0;

    const frame = (now: number) => {
      const running = live.current;
      if (!running) return;
      if (opened === 0) opened = now;

      if (now - opened < WINDUP_MS) {
        paint(windUp(origin, release, (now - opened) / WINDUP_MS, keeping));
        pending.current = requestAnimationFrame(frame);
        return;
      }

      if (last === 0) {
        last = now;
        // The throw leaves the hand *here*, not when the world was built. A
        // buzz at the top of the wind-up is a buzz for the pick-up.
        if (latest.current.mine) buzz(16);
      }
      /*
        One rate, and the same one all the way through.

        The clock used to be remapped *within* a throw (a third of life through
        the decisive contact, four times life through the tail) and that is
        gone: `beats.ts` keeps the note on why, and the short version is that
        dice are a thing everyone has watched land, so a throw that changes
        speed partway through reads as broken rather than as emphasis. What is
        applied here is a single constant across every frame of every throw,
        which is a statement about how big the dice are on screen rather than
        about which moment matters. See `PLAYBACK`.

        Capped, so a tab that was hidden for a minute does not try to simulate a
        minute of dice the moment it comes back.
      */
      carried += (Math.min(now - last, mods.engine.PHYS.MAX_FRAME * 1000) / 1000) * PLAYBACK;
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
        // 10,000 is the median loudest contact of a throw, measured, see
        // `QUIET`, so a typical throw's hardest hit is a full-volume one and
        // the unusually hard ones clamp rather than the ordinary ones being
        // quiet. Both numbers moved by the same factor when the physics was
        // rescaled to centimetres, and neither means anything on its own.
        clatter(Math.min(loudest.impulse / 10000, 1), loudest.wall);
        if (latest.current.mine && loudest.impulse > 3300) buzz(7);
      }

      paint(mods.engine.placedOf(running));

      if (moving > 0 && steps > 0) {
        pending.current = requestAnimationFrame(frame);
        return;
      }
      if (steps === 0) {
        // Nothing was stepped this frame; the accumulator has not filled yet.
        // Not the end of the throw, just a frame that arrived early.
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
      // A flourish that arrived with the move rather than after it. See
      // `startCheer` for why it waits rather than being dropped.
      const owed = queued.current;
      if (owed) {
        queued.current = null;
        startCheer(owed);
      }
    };

    cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(frame);
  }, [ready, toss, tray, count, place, paint, startCheer]);

  useEffect(
    () => () => {
      cancelAnimationFrame(pending.current);
      cancelAnimationFrame(cheering.current);
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
    // when there is nothing to throw, or keeping all five in Yahtzee disables
    // the throw and takes releasing one down with it.
    enabled: (Boolean(onThrow) || Boolean(onTapDie && keepable)) && ready,
    onThrow: onThrow ? throwNow : undefined,
    onTapDie,
  });

  const throwable = Boolean(onThrow);

  /*
    Whether the row of flat dice along the top edge is showing.

    It used to be shown only when a die was *hard to read where it lies*: sat
    on top of another one, or overlapping one on screen from where this camera
    stands. Real cubes do that, the physics is deliberately left alone about it
    (shoving them apart afterwards would mean the tray showing something the
    throw did not do), and the row was the reading being fixed rather than the
    pile.

    That was the right fix for the wrong scope. A row that appears on some
    throws and not others is a control that moves under the thumb: the way to
    keep a die is in a different place depending on how the last throw happened
    to land, and a player has to find it again each time. It is also the only
    place a die's number is stated flat-on rather than in perspective, which is
    worth having on the throws that are merely awkward to read as well as the
    ones that are impossible.

    So it is up from the moment there is something to show: once the dice are
    down and carrying faces, and never in flight, where every die is briefly on
    top of every other one and the numbers are not the player's yet.
  */
  const readout = useMemo(
    () => !flying && faces.some((f) => f >= 1 && f <= 6),
    [flying, faces],
  );

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
      // The hint below says how: flick to throw, tap a die to keep it.
      // Described rather than labelled, since the label is the state and this
      // is the instruction, and a screen reader reads the two in that order.
      aria-describedby={hint ? hintId : undefined}
      {...handlers}
    >
      {/* The beats. Empty and inert until a class is written onto it, see the
          ref's note above, and `dice.css` for why being under the canvas is
          where this belongs rather than a stacking bug. */}
      <div ref={beat} className="dice-beat" aria-hidden="true" />
      {Array.from({ length: count }, (_, i) => {
        const spot = spots[i];
        /*
          A die with nowhere to be is a die that was not thrown: Backgammon
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
            /*
              While the row below is showing, it is the way to reach these
              dice and this is scenery: two controls for one die would be two
              stops in the tab order and two things read out for one number.
              The pointer still lands on the cube itself, because a tap is the
              flick gesture's business and `data-die` is what it looks for.
            */
            {...(readout
              ? { tabIndex: -1, "aria-hidden": true as const }
              : { "aria-pressed": Boolean(held?.[i]), "aria-label": dieLabel(i, faces[i] ?? 0, Boolean(held?.[i]), flying) })}
            style={style}
            /*
              Keyboard only. A tap is already the flick gesture's business,
              since the tray captures the pointer, so a click here would either
              never arrive or arrive as well, and toggling twice is worse than
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
      {/*
        The dice as numbers, along the top edge, from the moment they are down.

        Along the *far* edge on purpose: that end of the tray is where a die is
        drawn smallest and read worst, and a bar over it covers less than one
        over the near end would. `data-die` rather than an `onClick`, because
        the tray takes the pointer capture on the way down and a click handler
        on a child of it either never fires or fires twice, the same reason
        the cubes' own buttons are keyboard-only.
      */}
      {readout && (
        <div className="dice-readout">
          {Array.from({ length: count }, (_, i) => {
            const face = faces[i] ?? 0;
            const spoken = dieLabel(i, face, Boolean(held?.[i]), flying);
            if (!onTapDie) {
              return (
                <span key={i} className={spent?.[i] ? "readout-die spent" : "readout-die"}>
                  <Die value={face} label={spoken} />
                </span>
              );
            }
            return (
              <button
                key={i}
                type="button"
                className={held?.[i] ? "readout-die held" : "readout-die"}
                data-die={i}
                disabled={flying || !keepable}
                aria-pressed={Boolean(held?.[i])}
                aria-label={spoken}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onTapDie(i);
                }}
              >
                {/* The label is the button's; the die inside it is a picture. */}
                <Die value={face} label="" />
              </button>
            );
          })}
        </div>
      )}
      {hint && (
        <p className="dice-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
});
