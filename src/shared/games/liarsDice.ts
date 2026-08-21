import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST, clampSeats } from './manifest.js';
import { die, pick } from './random.js';
import {
  DICE_PER_PLAYER,
  FACES,
  HIDDEN_FACE,
  beats,
  countFace,
  isOut,
  livePlayers,
  nextLive,
  seatCount,
  totalDice,
} from './liarsDiceDisplay.js';

import type { Bid, LdMove, LdState, Showdown } from './liarsDiceDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file holds the rules.
export {
  DICE_PER_PLAYER,
  FACES,
  HIDDEN_FACE,
  beats,
  countFace,
  describeBid,
  describeCount,
  isOut,
  livePlayers,
  nextLive,
  seatCount,
  smallestRaise,
  totalDice,
} from './liarsDiceDisplay.js';
export type { Bid, LdMove, LdState, Showdown } from './liarsDiceDisplay.js';

/**
 * Liar's Dice, for two to four.
 *
 * Everyone rolls five dice behind their hand. Round the table, each player
 * either raises the bid — "four 3s" means there are at least four 3s on the
 * whole table, not just in your hand — or calls the last bid a lie. The dice
 * come up, the face is counted, and whoever was wrong loses a die. Out of dice
 * is out of the game; the last player still holding any wins.
 *
 * **Ones are not wild.** The Perudo variant everyone half-remembers from a film
 * counts them for every face, which makes the arithmetic a game in itself. This
 * one counts what it says on the die, so a first-time player can be told the
 * whole of the rules in a sentence and still be counting correctly on their
 * first call.
 *
 * ── The part that matters ──────────────────────────────────────────────
 *
 * The hands are the game. `state.dice` holds all of them, and `view()` is the
 * only thing standing between a player and everybody else's dice — the client
 * is sent the state, so an unredacted hand is a hand anyone can read out of
 * devtools. The redaction keeps the *lengths*, because how many dice each
 * player is holding is public and is most of what a bid is reasoned from, and
 * replaces the faces with `HIDDEN_FACE`, which is not a face and so cannot be
 * counted even by a bug.
 *
 * Hands become public exactly once: in the `Showdown` a call produces, which is
 * a snapshot rather than a flag, so the board can show what was on the table at
 * the moment of the call while the next round is already being dealt.
 */

/** A hostile client is not owed unbounded arithmetic. */
const MAX_BID = 1000;

/**
 * A fresh hand, sorted. Sorting gives away nothing — the owner already knows
 * what they rolled, and nobody else is shown it — and it makes a revealed hand
 * countable at a glance, which is what the whole reveal is for.
 */
function roll(count: number, rng: Rng): number[] {
  return Array.from({ length: count }, () => die(rng)).sort((a, b) => a - b);
}

function clone(state: LdState): LdState {
  return {
    ...state,
    dice: state.dice.map((hand) => [...hand]),
    bid: state.bid === null ? null : { ...state.bid },
    // The showdown is replaced wholesale or left alone, never edited, so the
    // shared reference is safe — and copied anyway, because "safe as long as
    // nobody edits it" is a rule that outlives the person who knew it.
    showdown: state.showdown === null ? null : { ...state.showdown, hands: state.showdown.hands.map((h) => [...h]) },
  };
}

/**
 * Read a bid off the wire. Anything that is not a whole number of a real face
 * is rejected here rather than allowed to become a `NaN` on the table.
 */
function readBid(move: { quantity: unknown; face: unknown }, seat: number): MoveResult<Bid> {
  const quantity = Math.trunc(Number(move.quantity));
  const face = Math.trunc(Number(move.face));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BID) {
    return { ok: false, error: 'Bid at least one die.' };
  }
  if (!Number.isFinite(face) || face < 1 || face > FACES) {
    return { ok: false, error: `Dice run from 1 to ${FACES}.` };
  }
  return { ok: true, state: { seat, quantity, face } };
}

function bid(state: LdState, next: Bid): MoveResult<LdState> {
  const ceiling = totalDice(state);
  if (next.quantity > ceiling) {
    // Bidding more dice than exist is not a bluff, it is a typo — and it would
    // leave the next player with nothing to raise to.
    return { ok: false, error: `There are only ${ceiling} dice on the table.` };
  }
  if (!beats(next, state.bid)) {
    return { ok: false, error: 'Raise the bid: more dice, or the same number of a higher face.' };
  }

  const after = clone(state);
  after.bid = next;
  after.turn = nextLive(after, next.seat);
  return { ok: true, state: after };
}

/**
 * The call. Everything that decides the game happens in here: the face is
 * counted across every hand, the loser gives up a die, and anyone that empties
 * is out. The bid stands if the count *reaches* it — "four 3s" claims at least
 * four, so four is the bidder being right, not a tie.
 */
function challenge(state: LdState, challenger: number): MoveResult<LdState> {
  const called = state.bid;
  if (called === null) return { ok: false, error: 'There is no bid to call yet.' };

  const actual = countFace(state.dice, called.face);
  const loser = actual >= called.quantity ? challenger : called.seat;

  const after = clone(state);
  const hands = state.dice.map((hand) => [...hand]);
  after.dice[loser] = after.dice[loser].slice(1);

  const out = isOut(after, loser) ? [loser] : [];
  const showdown: Showdown = { bid: called, challenger, actual, loser, hands, out };

  const left = livePlayers(after);
  if (left.length <= 1) {
    after.phase = 'over';
    after.over = true;
    after.winner = left[0] ?? null;
    after.turn = after.winner ?? loser;
    after.bid = null;
    after.showdown = showdown;
    return { ok: true, state: after };
  }

  after.phase = 'reveal';
  after.bid = null;
  after.showdown = showdown;
  // The player who lost the die opens the next round — the standard rule, and
  // the merciful one: it hands the initiative to whoever is furthest behind.
  // Knocked out, and it passes to the next seat still holding dice.
  after.turn = isOut(after, loser) ? nextLive(after, loser) : loser;
  after.starter = after.turn;
  return { ok: true, state: after };
}

function nextRound(state: LdState, rng: Rng): LdState {
  const after = clone(state);
  after.round = state.round + 1;
  after.dice = state.dice.map((hand) => (hand.length > 0 ? roll(hand.length, rng) : []));
  after.bid = null;
  after.phase = 'bid';
  after.starter = state.turn;
  // The showdown stays until the dice are re-rolled and then goes: it describes
  // a table that no longer exists.
  after.showdown = null;
  return after;
}

export const liarsDice: GameDefinition<LdState, LdMove> = {
  id: GAME_MANIFEST.liarsdice.id,
  name: GAME_MANIFEST.liarsdice.name,
  minPlayers: GAME_MANIFEST.liarsdice.minPlayers,
  maxPlayers: GAME_MANIFEST.liarsdice.maxPlayers,

  setup(playerCount, rng): LdState {
    // Clamped rather than trusted: the turn walks round `% seats`, and a zero
    // here would divide by nothing. `clampSeats` is what the lobby uses, so the
    // table the room builds is the table the lobby offered.
    const seats = clampSeats(GAME_MANIFEST.liarsdice, playerCount);
    // Nobody has an opening advantage: who opens is drawn, like the wheel's
    // starter. Opening is a real disadvantage here — you bid with the least
    // information anyone will have all round.
    const starter = pick(rng, seats);
    return {
      round: 1,
      dice: Array.from({ length: seats }, () => roll(DICE_PER_PLAYER, rng)),
      turn: starter,
      bid: null,
      phase: 'bid',
      starter,
      showdown: null,
      winner: null,
      over: false,
    };
  },

  applyMove(state, move, seat, rng): MoveResult<LdState> {
    if (state.over) return { ok: false, error: 'The game is already over.' };
    if (!move || typeof move !== 'object') return { ok: false, error: 'Unknown move.' };
    if (seat < 0 || seat >= seatCount(state)) return { ok: false, error: 'You are not playing.' };
    if (isOut(state, seat)) return { ok: false, error: 'You are out of dice.' };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };

    if (state.phase === 'reveal') {
      if (move.type !== 'next') return { ok: false, error: 'The dice are on the table.' };
      return { ok: true, state: nextRound(state, rng) };
    }
    if (move.type === 'next') return { ok: false, error: 'This round is still going.' };

    if (move.type === 'bid') {
      const read = readBid(move, seat);
      if (!read.ok) return { ok: false, error: read.error };
      return bid(state, read.state);
    }

    if (move.type === 'challenge') return challenge(state, seat);

    return { ok: false, error: 'Unknown move.' };
  },

  /**
   * Everything a client is allowed to know. Every hand but this seat's own is
   * replaced with the same number of `HIDDEN_FACE` dice — the count is public,
   * the faces never are, not even once a player is out and not even at the end,
   * because the last round's hands are already public in the showdown and a
   * hand from any earlier round is nobody's business.
   */
  view(state, seat) {
    return {
      ...state,
      dice: state.dice.map((hand, index) =>
        index === seat ? [...hand] : hand.map(() => HIDDEN_FACE),
      ),
    };
  },

  turn(state) {
    return state.over ? null : state.turn;
  },

  isOver(state) {
    return state.over;
  },

  status(state, names) {
    const nameFor = (index: number) => names[index] ?? `Player ${index + 1}`;

    if (state.over) {
      if (state.winner === null) return 'Nobody is left holding dice';
      const held = state.dice[state.winner]?.length ?? 0;
      return `${nameFor(state.winner)} wins with ${held} ${held === 1 ? 'die' : 'dice'} left`;
    }
    if (state.phase === 'reveal') return `${nameFor(state.turn)} to roll the next round`;
    if (state.bid === null) return `${nameFor(state.turn)} to open the round`;
    return `${nameFor(state.turn)} to raise or call`;
  },
};
