import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST, clampSeats } from './manifest.js';
import { die, pick } from './random.js';
import {
  DICE_PER_PLAYER,
  FACES,
  owesRoll,
  HIDDEN_FACE,
  beats,
  countFace,
  isOut,
  livePlayers,
  nextLive,
  seatCount,
  totalDice,
} from './liarsDiceDisplay.js';

import type { Bid, CallKind, LdMove, LdState, Showdown } from './liarsDiceDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file holds the rules.
export {
  DICE_PER_PLAYER,
  FACES,
  HIDDEN_FACE,
  beats,
  countFace,
  countInHand,
  describeBid,
  describeCount,
  isOut,
  livePlayers,
  nextLive,
  owesRoll,
  seatCount,
  smallestRaise,
  totalDice,
} from './liarsDiceDisplay.js';
export type { Bid, CallKind, LdMove, LdState, Showdown } from './liarsDiceDisplay.js';

/**
 * Liar's Dice, for two to four.
 *
 * Everyone rolls five dice behind their hand. Round the table, each player
 * either raises the bid — "four 3s" means there are at least four 3s on the
 * whole table, not just in your hand — or calls it. The dice come up, the face
 * is counted, and whoever was wrong loses a die. Out of dice is out of the
 * game; the last player still holding any wins.
 *
 * There are two calls, and the difference between them is the difference
 * between the two ways a bid can be wrong:
 *
 * - **Liar** says the bid is too high. It is settled by "at least", so a bid
 *   met exactly is the bidder being right, not a tie — call "four 3s" on
 *   exactly four 3s and it costs you the die.
 * - **Spot on** says the bid is neither too high nor too low: the count is the
 *   quantity, to the die. Get it right and you take a die *back* (never past
 *   the five you started with); get it wrong and you lose one like anybody
 *   else. It is the only move in the game that costs nobody anything, and the
 *   only one that can be right while the bidder is also right — which is what
 *   makes the last player to be dragged into a bid worth watching rather than
 *   worth pitying.
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
    rolled: [...state.rolled],
    bid: state.bid === null ? null : { ...state.bid },
    history: state.history.map((said) => ({ ...said })),
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
  // No ceiling here: `Math.trunc` turns any infinity or non-number into
  // something this rejects, and every finite quantity above the table is
  // refused by `bid()` in words that say how many dice there actually are.
  if (!Number.isFinite(quantity) || quantity < 1) {
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
  // Said out loud, so it stays said: the round's bidding is public, and the
  // sequence is most of what the next player's call is reasoned from.
  after.history = [...after.history, next];
  after.turn = nextLive(after, next.seat);
  return { ok: true, state: after };
}

/**
 * Who pays and who is paid, given the count that came up.
 *
 * Kept apart from the bookkeeping below because it is the whole of the rules
 * either call is settled by, and it is worth being able to read the two side by
 * side. A `liar` call is settled by "at least" — the bid stands the moment the
 * count *reaches* it, so "four 3s" against exactly four 3s costs the caller. A
 * spot-on call needs the count on the nose and pays a die back for it.
 */
function settlement(
  called: Bid,
  call: CallKind,
  challenger: number,
  actual: number,
): { loser: number | null; paid: number | null } {
  if (call === 'liar') {
    return { loser: actual >= called.quantity ? challenger : called.seat, paid: null };
  }
  if (actual === called.quantity) return { loser: null, paid: challenger };
  return { loser: challenger, paid: null };
}

/**
 * The call. Everything that decides the game happens in here: the face is
 * counted across every hand, a die changes hands, and anyone that empties is
 * out.
 *
 * The die a correct spot-on call earns is rolled rather than invented, so the
 * hand is a hand of real dice at every moment — the face is nobody's business
 * and is re-rolled with the rest at the top of the next round, but a state
 * carrying a die that is not a die is a state every invariant in the game has
 * to start apologising for.
 */
function callBid(
  state: LdState,
  challenger: number,
  call: CallKind,
  rng: Rng,
): MoveResult<LdState> {
  const called = state.bid;
  if (called === null) return { ok: false, error: 'There is no bid to call yet.' };

  const actual = countFace(state.dice, called.face);
  const { loser, paid } = settlement(called, call, challenger, actual);

  const after = clone(state);
  const hands = state.dice.map((hand) => [...hand]);
  if (loser !== null) after.dice[loser] = after.dice[loser].slice(1);
  // A full hand is the ceiling: winning the same die back twice would let two
  // lucky calls undo a game's worth of them.
  const gainer = paid !== null && after.dice[paid].length < DICE_PER_PLAYER ? paid : null;
  if (gainer !== null) after.dice[gainer] = [...after.dice[gainer], die(rng)].sort((a, b) => a - b);

  const out = loser !== null && isOut(after, loser) ? [loser] : [];
  const showdown: Showdown = { bid: called, call, challenger, actual, loser, gainer, hands, out };

  after.bid = null;
  after.showdown = showdown;

  const left = livePlayers(after);
  if (left.length <= 1) {
    after.phase = 'over';
    after.over = true;
    after.winner = left[0] ?? null;
    after.turn = after.winner ?? challenger;
    return { ok: true, state: after };
  }

  after.phase = 'reveal';
  // The player who lost the die opens the next round — the standard rule, and
  // the merciful one: it hands the initiative to whoever is furthest behind.
  // A spot-on call that cost nobody anything has no such player, so it goes to
  // whoever made it, who has earned the one seat with the least information.
  // Knocked out, and it passes to the next seat still holding dice.
  const opener = loser ?? challenger;
  after.turn = isOut(after, opener) ? nextLive(after, opener) : opener;
  after.starter = after.turn;
  return { ok: true, state: after };
}

/**
 * A seat's own hand, as the client that threw it reports it.
 *
 * The reducer already dealt this hand — see `nextRound` — so the game is
 * playable without this ever arriving, which is the point: a client with no
 * WebAssembly, or one that simply never sends it, is not a round that hangs.
 * What this adds is that the dice a player *watched land* are the dice they
 * are holding, rather than an animation that agreed with a number chosen
 * elsewhere.
 *
 * **This is the most trusting thing in the app, and it is trusted on purpose.**
 * A modified client reports five sixes and there is nothing here that could
 * know. In a game whose whole substance is bluffing about a hidden hand, that
 * is a large thing to give away; it was given away knowingly, in exchange for
 * the dice being real everywhere rather than real in two games out of three.
 * Anyone tightening this later wants the server to keep dealing and the client
 * to animate onto what it was dealt — which is the same picture and none of
 * this risk.
 */
function reportHand(state: LdState, seat: number, faces: unknown): MoveResult<LdState> {
  if (!owesRoll(state, seat)) {
    return { ok: false, error: 'Your dice are already on the table.' };
  }
  const want = state.dice[seat].length;
  if (!Array.isArray(faces) || faces.length !== want) {
    return { ok: false, error: `That is not ${want} dice.` };
  }
  const hand: number[] = [];
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 1 || face > FACES) {
      return { ok: false, error: `Dice run from 1 to ${FACES}.` };
    }
    hand.push(face);
  }

  const after = clone(state);
  // Sorted, like a dealt hand: the owner already knows what they rolled and
  // nobody else is shown it, so the order gives away nothing and a revealed
  // hand is countable at a glance.
  after.dice[seat] = hand.sort((a, b) => a - b);
  after.rolled[seat] = true;
  return { ok: true, state: after };
}

function nextRound(state: LdState, rng: Rng): LdState {
  const after = clone(state);
  after.round = state.round + 1;
  after.dice = state.dice.map((hand) => (hand.length > 0 ? roll(hand.length, rng) : []));
  // Everyone's own throw is owed again. The hands above are the fallback, and
  // the ones a client reports replace them — see `owesRoll`.
  after.rolled = state.dice.map(() => false);
  after.bid = null;
  after.history = [];
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
      rolled: Array.from({ length: seats }, () => false),
      turn: starter,
      bid: null,
      history: [],
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

    /*
      Before the turn check, because rolling is the one thing here that happens
      out of turn: every hand hits the table at once at the top of a round, and
      making four players wait their turn to throw would be a different game.
      A seat may only ever report its *own* hand, which is what `seat` is.
    */
    if (move.type === 'roll') return reportHand(state, seat, move.faces);

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

    if (move.type === 'challenge') return callBid(state, seat, 'liar', rng);
    if (move.type === 'exact') return callBid(state, seat, 'exact', rng);

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

  /*
    Not `turn(state) === seat`, and the difference is real: everyone throws
    their own dice at the top of a round, at the same time, whoever is due to
    bid. So this is the union of "it is your turn" and "you still owe a throw",
    and a board must not gate its *bidding* controls on it — `turn` is what
    those want. `owesRoll` carries the other half.
  */
  canAct(state, seat) {
    return !state.over && (state.turn === seat || owesRoll(state, seat));
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
