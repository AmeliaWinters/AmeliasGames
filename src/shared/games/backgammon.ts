import type { GameDefinition, MoveResult } from "../types.js";
import { GAME_MANIFEST } from "./manifest.js";
import type { Tray } from "./dice.js";
import { nextToss } from "./toss.js";
import type { Toss } from "./toss.js";

/**
 * Backgammon.
 *
 * Board layout: `points[0..23]`, one number per point. Positive means that
 * many seat-0 checkers, negative means seat-1. Seat 0 travels downward
 * (23 -> 0) and bears off past 0; seat 1 travels upward and bears off past 23.
 * Each player's home board is the last six points of their own journey.
 *
 * Not implemented: the doubling cube. Everything else is here, including the
 * two rules people usually skip: you must play as many dice as you can, and if
 * only one of two can be played it has to be the higher one.
 */

export const POINTS = 24;
export const CHECKERS = 15;

/**
 * The tray the pair is thrown into, in its own units.
 *
 * Not pixels: the server simulates the throw and reads the pair off it, so the
 * tray it simulates has to be the tray every device draws, whatever size that
 * device draws it at. Shallower than Yahtzee's and with a bigger die, because
 * two dice in a tray sized for five read as two dice that got lost. Kept in
 * step with Yahtzee's when both were made a quarter smaller.
 */
export const BACKGAMMON_TRAY: Tray = { w: 100, h: 34, die: 6 };

/**
 * The dice on the table, and what is left of them.
 *
 * Here rather than in the board because getting it wrong put dice on the
 * board that were never thrown: a double is four *moves* and it was drawn as
 * four dice, but the tray draws the cubes the simulation tumbled and there
 * are only ever two of those. The two spare ones sat unrotated in the corner
 * of the tray, and an unrotated cube shows a one, so a double four showed two
 * fours and two ones, and the ones were not dice.
 *
 * Two dice, then, always. The four is bookkeeping, and `left` is what the
 * board says in words.
 */
export function diceOnTable(state: BgState): {
  /** The pair, as thrown. Two zeroes before the first roll. */
  thrown: number[];
  /** Both the same. Four moves from two dice. */
  double: boolean;
  /** Moves still to play: two normally, up to four on a double. */
  left: number;
  /**
   * Which of the two are used up, matched by value rather than by count:
   * `dice` holds what is unplayed, and playing the 5 of a 3-and-5 leaves [3],
   * so counting from the end would strike out the 3, the one you still have.
   *
   * Never one of a double. Both dice are the same number and neither is spent
   * until all four moves are, so dimming one would be picking a die at random
   * and calling it used.
   */
  spent: boolean[];
} {
  const thrown = state.roll === null ? [0, 0] : [...state.roll];
  const double = state.roll !== null && state.roll[0] === state.roll[1];
  const left = state.dice.length;
  const unplayed = [...state.dice];
  const spent = double
    ? thrown.map(() => state.phase === "move" && left === 0)
    : thrown.map((face) => {
        const at = unplayed.indexOf(face);
        if (at === -1) return true;
        unplayed.splice(at, 1);
        return false;
      });
  return { thrown, double, left, spent };
}

/**
 * The one move just played, kept so a board can show it happening.
 *
 * `n` counts every move of the game and is what a board should watch. The
 * object cannot be watched by identity: state arrives over the wire and is
 * parsed fresh each push, so `last` is a new object on every message and an
 * effect keyed on it would replay the flight when the *opponent* reconnected.
 * The same trap `toss` documents, from the other direction.
 */
export interface BgLast {
  seat: 0 | 1;
  from: Source;
  /** Where it landed, or "off" when it ran past the edge and was borne off. */
  to: number | "off";
  die: number;
  /** True when it sent an enemy blot to the bar. */
  hit: boolean;
  n: number;
}

/**
 * What a seat did with the dice, totted up as the game goes.
 *
 * Kept in state rather than derived at the end because none of it survives in
 * the position: a hit leaves no trace once the checker comes back in, and a
 * die you could not play leaves none at all. `off` and `pipCount` already say
 * where the game got to, so nothing here repeats them. This is the story of how
 * it got there.
 */
export interface BgStats {
  /** Turns this seat rolled the dice. */
  rolls: number;
  doubles: number;
  /** Pips the dice offered. A double is worth four of its face, not two. */
  pips: number;
  /** Pips that went unplayed because nothing legal could use them. */
  wasted: number;
  /** Enemy blots sent to the bar. */
  hits: number;
}

function emptyStats(): BgStats {
  return { rolls: 0, doubles: 0, pips: 0, wasted: 0, hits: 0 };
}

export interface BgState {
  points: number[];
  /** Checkers sitting on the bar, waiting to re-enter. */
  bar: [number, number];
  /** Checkers borne off. Fifteen wins. */
  off: [number, number];
  turn: 0 | 1;
  /** Dice still unplayed this turn. Doubles start as four entries. */
  dice: number[];
  /** The pair rolled, kept so the UI can show what happened. */
  roll: [number, number] | null;
  /**
   * How that pair was thrown, or null before the first roll. `phase` nearly
   * serves as the trigger for a board animating a throw, but only nearly: two
   * turns running can roll the same pair, and dice that sat still on the
   * second one would read as broken. See `toss.ts`.
   */
  toss: Toss | null;
  phase: "roll" | "move";
  winner: 0 | 1 | null;
  /** 1 single, 2 gammon, 3 backgammon. */
  result: 1 | 2 | 3 | null;
  last: BgLast | null;
  stats: [BgStats, BgStats];
  /**
   * Seat 0's pip lead after each completed turn, starting at 0.
   *
   * One number rather than two because the lead is the thing worth drawing:
   * both pip counts fall all game, so a chart of them is two lines sloping the
   * same way, and who was actually ahead (the only question a race asks) is the
   * gap between them that neither line shows.
   */
  race: number[];
}

export type Source = number | "bar";

export type BgMove =
  // The flick is how the dice were thrown, not what they landed on.
  // The throw is what the client's simulation did, reported back, not a
  // request to roll. `readThrow` in `toss.ts` says how far it is believed, and
  // a move with nothing usable in it is rolled here instead.
  | { type: "roll"; throw?: unknown }
  | { type: "move"; from: Source; die: number }
  | { type: "pass" };

// Geometry

/** Seat 0 counts down, seat 1 counts up. */
export function direction(seat: number): -1 | 1 {
  return seat === 0 ? -1 : 1;
}

/** How far a point is from bearing off, counted in pips. Point 1 is nearest. */
export function pipValue(seat: number, point: number): number {
  return seat === 0 ? point + 1 : POINTS - point;
}

export function isHome(seat: number, point: number): boolean {
  return pipValue(seat, point) <= 6;
}

/** Where a checker coming off the bar lands for a given die. */
export function barEntry(seat: number, die: number): number {
  return seat === 0 ? POINTS - die : die - 1;
}

/**
 * Where a checker ends up, or "off" if the die runs it past the edge.
 *
 * Geometry only: it says nothing about whether the move is legal, which is
 * `applyOne`'s business. Both the reducer (recording what just happened) and
 * the board (marking where a picked-up checker may land) need the same answer,
 * and they had two copies of it.
 */
export function landingOf(seat: number, from: Source, die: number): number | "off" {
  if (from === "bar") return barEntry(seat, die);
  const landed = from + direction(seat) * die;
  return landed >= 0 && landed < POINTS ? landed : "off";
}

export function countAt(state: BgState, point: number, seat: number): number {
  const value = state.points[point];
  return seat === 0 ? Math.max(0, value) : Math.max(0, -value);
}

/** A point is blocked only by two or more enemy checkers; a lone one is a blot. */
function blocked(state: BgState, point: number, seat: number): boolean {
  return countAt(state, point, 1 - seat) >= 2;
}

/** Total pips a seat still has to travel. Shown to players as a race number. */
export function pipCount(state: BgState, seat: number): number {
  let pips = state.bar[seat] * (POINTS + 1);
  for (let i = 0; i < POINTS; i++) pips += countAt(state, i, seat) * pipValue(seat, i);
  return pips;
}

function clone(state: BgState): BgState {
  return {
    ...state,
    points: state.points.slice(),
    bar: [...state.bar] as [number, number],
    off: [...state.off] as [number, number],
    dice: state.dice.slice(),
    // Both are written through by the bookkeeping below, so both are copied
    // for the reason `roll` is: a derived state that shares them with the one
    // it came from can rewrite a stored snapshot's history.
    stats: [{ ...state.stats[0] }, { ...state.stats[1] }],
    race: state.race.slice(),
    // `roll` is a tuple too. Leaving it aliased means a derived state shares it
    // with the state it came from, which is one careless write away from
    // corrupting a stored snapshot.
    roll: state.roll ? ([...state.roll] as [number, number]) : null,
    // The throw carries two arrays of its own, and the spread above copies
    // only the reference to it. Nothing writes to a stored `Toss` today, since
    // `nextToss` only fills in the object it just built, so this costs nothing
    // now and is here for the same reason `roll` is.
    toss: state.toss
      ? {
          ...state.toss,
          from: state.toss.from.map((r) => ({ ...r })),
          rest: state.toss.rest.map((r) => ({ ...r })),
        }
      : null,
  };
}

function place(state: BgState, point: number, seat: number, delta: number): void {
  state.points[point] += seat === 0 ? delta : -delta;
}

// Legality

/** Every checker home (and none on the bar) is the gate to bearing off. */
export function canBearOff(state: BgState, seat: number): boolean {
  if (state.bar[seat] > 0) return false;
  let accounted = state.off[seat];
  for (let i = 0; i < POINTS; i++) {
    const count = countAt(state, i, seat);
    if (count > 0 && !isHome(seat, i)) return false;
    accounted += count;
  }
  return accounted === CHECKERS;
}

/** True when no checker sits further from home than `point`. */
function isHighest(state: BgState, seat: number, point: number): boolean {
  const pip = pipValue(seat, point);
  for (let i = 0; i < POINTS; i++) {
    if (countAt(state, i, seat) > 0 && pipValue(seat, i) > pip) return false;
  }
  return true;
}

/**
 * Apply one die to one checker, or return null if that isn't legal.
 * Every rule about blocked points, hitting, the bar and bearing off lives here.
 */
export function applyOne(
  state: BgState,
  seat: number,
  from: Source,
  die: number,
): BgState | null {
  if (!state.dice.includes(die)) return null;

  const next = clone(state);

  if (from === "bar") {
    if (next.bar[seat] === 0) return null;
    const target = barEntry(seat, die);
    if (blocked(next, target, seat)) return null;
    next.bar[seat] -= 1;
    hitIfBlot(next, target, seat);
    place(next, target, seat, 1);
  } else {
    // Checkers on the bar must all come in before anything else moves.
    if (next.bar[seat] > 0) return null;
    if (!Number.isInteger(from) || from < 0 || from >= POINTS) return null;
    if (countAt(next, from, seat) === 0) return null;

    const target = from + direction(seat) * die;

    if (target >= 0 && target < POINTS) {
      if (blocked(next, target, seat)) return null;
      place(next, from, seat, -1);
      hitIfBlot(next, target, seat);
      place(next, target, seat, 1);
    } else {
      // Running past the edge is bearing off, which has its own conditions.
      if (!canBearOff(next, seat)) return null;
      const pip = pipValue(seat, from);
      // An exact roll always bears off; a bigger one only from the furthest point.
      if (die !== pip && !(die > pip && isHighest(next, seat, from))) return null;
      place(next, from, seat, -1);
      next.off[seat] += 1;
    }
  }

  next.dice.splice(next.dice.indexOf(die), 1);
  return next;
}

function hitIfBlot(state: BgState, point: number, seat: number): void {
  if (countAt(state, point, 1 - seat) === 1) {
    place(state, point, 1 - seat, -1);
    state.bar[1 - seat] += 1;
  }
}

/** Every single move that is legal right now, before the use-both-dice rule. */
function candidates(state: BgState, seat: number): Array<{ from: Source; die: number }> {
  const found: Array<{ from: Source; die: number }> = [];
  const dice = [...new Set(state.dice)];

  for (const die of dice) {
    if (state.bar[seat] > 0) {
      if (applyOne(state, seat, "bar", die)) found.push({ from: "bar", die });
      continue;
    }
    for (let point = 0; point < POINTS; point++) {
      if (countAt(state, point, seat) === 0) continue;
      if (applyOne(state, seat, point, die)) found.push({ from: point, die });
    }
  }
  return found;
}

function key(state: BgState, seat: number): string {
  return `${seat}|${state.points.join(",")}|${state.bar.join(",")}|${[...state.dice].sort().join(",")}`;
}

/** Longest run of moves playable from here. Memoised: positions repeat a lot. */
function longestRun(state: BgState, seat: number, seen = new Map<string, number>()): number {
  if (state.dice.length === 0) return 0;
  const cacheKey = key(state, seat);
  const cached = seen.get(cacheKey);
  if (cached !== undefined) return cached;

  let best = 0;
  for (const option of candidates(state, seat)) {
    const after = applyOne(state, seat, option.from, option.die);
    if (!after) continue;
    best = Math.max(best, 1 + longestRun(after, seat, seen));
    if (best === state.dice.length) break; // cannot do better
  }

  seen.set(cacheKey, best);
  return best;
}

/**
 * The moves a player is actually allowed to make.
 *
 * Backgammon obliges you to use as many dice as you can, so a move that
 * strands a die you could otherwise have played is illegal. And when exactly
 * one die can be played, it must be the higher one if that is possible.
 */
export function legalMoves(state: BgState): Array<{ from: Source; die: number }> {
  if (state.phase !== "move" || state.winner !== null) return [];
  const seat = state.turn;
  const target = longestRun(state, seat);
  if (target === 0) return [];

  const seen = new Map<string, number>();
  let allowed = candidates(state, seat).filter((option) => {
    const after = applyOne(state, seat, option.from, option.die);
    return after !== null && 1 + longestRun(after, seat, seen) === target;
  });

  if (target === 1 && new Set(state.dice).size > 1) {
    const highest = Math.max(...allowed.map((option) => option.die));
    allowed = allowed.filter((option) => option.die === highest);
  }

  return allowed;
}

// Outcome

/** 1 single, 2 gammon (loser bore none off), 3 backgammon (and still stuck). */
function scoreFor(state: BgState, winner: number): 1 | 2 | 3 {
  const loser = 1 - winner;
  if (state.off[loser] > 0) return 1;
  if (state.bar[loser] > 0) return 3;
  for (let i = 0; i < POINTS; i++) {
    // Still sitting in the winner's home board is what makes it a backgammon.
    if (countAt(state, i, loser) > 0 && isHome(winner, i)) return 3;
  }
  return 2;
}

function endTurn(state: BgState): void {
  // Whatever is still in `dice` is what the position refused to let them play.
  // Counted here because this is the only place a turn ends, whether they gave
  // up on it or the board did it for them.
  for (const die of state.dice) state.stats[state.turn].wasted += die;
  state.race.push(pipCount(state, 1) - pipCount(state, 0));
  state.dice = [];
  // `roll` means "the pair the player to move rolled". Once the turn flips it
  // would otherwise still hold the *previous* player's dice.
  state.roll = null;
  state.phase = "roll";
  state.turn = (1 - state.turn) as 0 | 1;
}

function startingPoints(): number[] {
  const points = Array<number>(POINTS).fill(0);
  // Each player: two on their 24, five on their 13, three on their 8, five on their 6.
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return points;
}

export const backgammon: GameDefinition<BgState, BgMove> = {
  id: GAME_MANIFEST.backgammon.id,
  name: GAME_MANIFEST.backgammon.name,
  minPlayers: 2,
  maxPlayers: 2,

  setup(_playerCount, rng): BgState {
    return {
      points: startingPoints(),
      bar: [0, 0],
      off: [0, 0],
      // Nobody has an opening advantage: who starts is decided by the dice.
      turn: rng() < 0.5 ? 0 : 1,
      dice: [],
      roll: null,
      toss: null,
      phase: "roll",
      winner: null,
      result: null,
      last: null,
      stats: [emptyStats(), emptyStats()],
      // Both sides start on 167 pips, so the race opens dead level and the
      // chart has a left-hand end to be drawn from.
      race: [0],
    };
  },

  applyMove(state, move, seat, rng): MoveResult<BgState> {
    if (state.winner !== null) return { ok: false, error: "The game is already over." };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };
    if (!move || typeof move !== "object") return { ok: false, error: "Unknown move." };

    if (move.type === "roll") {
      if (state.phase !== "roll") return { ok: false, error: "You have already rolled." };
      // The pair is read off the dice where they stop, but they stopped in the
      // browser that threw them, so this is the *reported* pair. See `toss.ts`:
      // the shape is checked, the numbers cannot be.
      const thrown = nextToss({
        previous: state.toss,
        sent: move.throw,
        rng,
        tray: BACKGAMMON_TRAY,
        count: 2,
      });
      const [a, b] = thrown.faces;
      const rolled = clone(state);
      const double = a === b;
      rolled.stats[seat].rolls += 1;
      if (double) rolled.stats[seat].doubles += 1;
      // What the dice were worth, which is what `wasted` is subtracted from.
      // A double is four moves, so it offers four times its face.
      rolled.stats[seat].pips += double ? a * 4 : a + b;
      return {
        ok: true,
        state: {
          ...rolled,
          roll: [a, b] as [number, number],
          toss: thrown.toss,
          // Doubles are played four times over.
          dice: double ? [a, a, a, a] : [a, b],
          phase: "move",
        },
      };
    }

    if (move.type === "pass") {
      if (state.phase !== "move") return { ok: false, error: "Roll the dice first." };
      if (legalMoves(state).length > 0) {
        return { ok: false, error: "You still have a legal move." };
      }
      const next = clone(state);
      endTurn(next);
      return { ok: true, state: next };
    }

    if (move.type !== "move") return { ok: false, error: "Unknown move." };
    if (state.phase !== "move") return { ok: false, error: "Roll the dice first." };

    const permitted = legalMoves(state).some(
      (option) => option.from === move.from && option.die === move.die,
    );
    if (!permitted) {
      // Distinguish "you can't do that at all" from "the rules force your hand".
      const wouldWork = applyOne(state, seat, move.from, move.die);
      return {
        ok: false,
        error: wouldWork
          ? "You must play as many dice as possible, and that move wastes one."
          : "That move isn't legal.",
      };
    }

    const next = applyOne(state, seat, move.from, move.die);
    if (!next) return { ok: false, error: "That move isn't legal." };

    // A hit is read off the bar rather than reported by `applyOne`, which
    // returns a position and no account of how it got there.
    const hit = next.bar[1 - seat] > state.bar[1 - seat];
    if (hit) next.stats[seat].hits += 1;
    next.last = {
      seat: seat as 0 | 1,
      from: move.from,
      to: landingOf(seat, move.from, move.die),
      die: move.die,
      hit,
      n: (state.last?.n ?? 0) + 1,
    };

    if (next.off[seat] === CHECKERS) {
      next.winner = seat as 0 | 1;
      next.result = scoreFor(next, seat);
      // The last turn never ends through `endTurn`, so the race would stop one
      // entry short, at the position before the checker that won it came off.
      next.race.push(pipCount(next, 1) - pipCount(next, 0));
      next.dice = [];
      return { ok: true, state: next };
    }

    // A turn ends as soon as nothing further can be played, so nobody has to
    // sit looking at a die they cannot use.
    if (next.dice.length === 0 || legalMoves(next).length === 0) endTurn(next);

    return { ok: true, state: next };
  },

  turn(state) {
    return state.winner !== null ? null : state.turn;
  },

  canAct(state, seat) {
    return state.winner === null && state.turn === seat;
  },

  isOver(state) {
    return state.winner !== null;
  },

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.winner !== null) {
      const suffix =
        state.result === 3 ? ", a backgammon" : state.result === 2 ? ", a gammon" : "";
      return `${nameFor(state.winner)} wins${suffix}`;
    }
    if (state.phase === "roll") return `${nameFor(state.turn)} to roll`;
    if (legalMoves(state).length === 0) return `${nameFor(state.turn)} has no legal move`;
    if (state.bar[state.turn] > 0) return `${nameFor(state.turn)} must come in off the bar`;
    return `${nameFor(state.turn)} to play`;
  },
};
