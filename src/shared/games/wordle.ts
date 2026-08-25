import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { duelWords, isDuelWord } from './words.js';
import { pick } from './random.js';
import {
  GUESS_MS,
  HIDDEN,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  isFinished,
  outOfTime,
  seatsOf,
  targetOf,
} from './wordleDisplay.js';

import type { Mark, Row, WordleMove, WordleState } from './wordleDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word list.
export {
  GUESS_MS,
  HIDDEN,
  KEY_ROWS,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  formatClock,
  isFinished,
  guesserOf,
  keyMarks,
  msLeftFor,
  outOfTime,
  seatsOf,
  targetOf,
} from './wordleDisplay.js';
export type { Mark, Row, WordleMove, WordleState } from './wordleDisplay.js';

/**
 * Wordle as a duel. Everybody sets a five-letter word, everybody is pointed at
 * somebody else's, and they all work on it at once.
 *
 * Two to eight play. The pointing is a random ring drawn at setup (see
 * `target` on `WordleState`), which guarantees nobody is handed their own word
 * and nobody is left without one. At two players there is only one such ring,
 * which is how this game spent its first life as a head-to-head with
 * `opponentOf(seat)` hardcoded to `seat === 0 ? 1 : 0`.
 *
 * Two things here are unlike every other game in this repo:
 *
 * 1. **Nobody waits.** Play is free-simultaneous: a player may guess whenever
 *    they have a guess left, regardless of what the opponent is doing. The
 *    `turn` field of `GameDefinition` assumes one active seat, so it reports
 *    whoever is furthest behind purely as a hint for the status line and
 *    `applyMove` never consults it. Anything deciding whether a player may act
 *    asks `canAct`, not `turn`.
 *
 * 2. **The only secret is the word.** Everyone's guesses and marks are open,
 *    and that costs nothing: their guesses at a word tell you only what you
 *    could work out by marking them yourself. `view()` therefore hides the
 *    words themselves, and only until they can no longer help: the one you are
 *    guessing is revealed once you are finished with it, because losing without
 *    ever learning the word is the unsatisfying ending.
 *
 * 3. **There is a shot clock, and a solve is what starts it.** Until somebody
 *    cracks the word they were pointed at, the game is untimed and everyone
 *    may think as long as they like. The first solve puts everyone still
 *    playing on `GUESS_MS`, one minute, and from then on a player's own guess
 *    buys them the next minute. See `reclock` for the whole rule. `expire`
 *    catches a minute that has gone, which the room calls off a timer, so a
 *    player who walks away once the race is on is finished rather than leaving
 *    everyone else waiting forever. A client counting down is showing the
 *    player a number; the server's clock decides.
 */

/**
 * Standard Wordle marking, which is subtler than it looks: a letter is yellow
 * only if the secret has an unmatched copy of it left over. Guessing SPEED
 * against ABIDE greens the second E and greys the first, because ABIDE has
 * just the one E and that E is spoken for.
 *
 * Exact matches are therefore claimed in a first pass, before any near match
 * is allowed to consume a letter.
 */
export function markGuess(guess: string, secret: string): Mark[] {
  const marks: Mark[] = Array(guess.length).fill('miss');
  const spare = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) {
      marks[i] = 'hit';
    } else {
      spare.set(secret[i], (spare.get(secret[i]) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === 'hit') continue;
    const left = spare.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = 'near';
      spare.set(guess[i], left - 1);
    }
  }

  return marks;
}

/**
 * Fewer guesses wins; solving beats not solving; and nothing here ends level,
 * because this game has no draw. Every finish comes down to one seat.
 *
 * The tiebreak is the clock: two players who spent the same guesses are
 * separated by who got there first, read off `guessedAt`. Play is
 * free-simultaneous and everybody starts the moment the last word is set, so
 * "first" and "fastest" are the same measurement. It cuts against the old rule
 * here, which refused to break a tie on time because it hands the game to the
 * faster typist. True, and the price of never ending level.
 *
 * The same ladder settles a game nobody won, since nobody solving *is* a tie
 * on guesses: a player who was still trying beats one who walked away, and
 * beyond that it is again whoever finished sooner. A seat that never guessed
 * is last, and two seats that match on every rung go to the lower one:
 * arbitrary, but it has to be something and it has to be pure.
 */
function decide(state: WordleState): number {
  return seatsOf(state).reduce((best, seat) => (ahead(state, seat, best) ? seat : best));
}

/**
 * Whether `a` finishes ahead of `b`. Strictly: equal on every count keeps `b`,
 * which is how `decide`'s reduce lands on the lower seat.
 */
function ahead(state: WordleState, a: number, b: number): boolean {
  const solvedA = state.solvedIn[a];
  const solvedB = state.solvedIn[b];

  if ((solvedA === null) !== (solvedB === null)) return solvedB === null;
  if (solvedA !== null && solvedB !== null && solvedA !== solvedB) return solvedA < solvedB;

  if (solvedA === null) {
    // Neither got there. Still trying beats walking away, so a game where
    // everyone but one player let their clock go is a win for whoever was
    // left, not a tie on the six guesses nobody landed.
    const goneA = state.timedOut.includes(a);
    const goneB = state.timedOut.includes(b);
    if (goneA !== goneB) return goneB;
  }

  return endedAt(state, a) < endedAt(state, b);
}

/** When a seat last guessed, which is its solve if it solved. Never guessed is last. */
function endedAt(state: WordleState, seat: number): number {
  return state.guessedAt[seat] ?? Infinity;
}

/**
 * Who guesses whose word: a random ring around the table.
 *
 * A single cycle rather than any old derangement, drawn by shuffling the seats
 * and pointing each at the next. Two properties come free and both matter: no
 * seat can point at itself, so nobody is handed the answer to their own word;
 * and every seat is pointed at exactly once, so nobody sets a word that goes
 * unguessed and nobody sits without one to work on.
 */
function ring(count: number, rng: Rng): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const target = Array<number>(count).fill(0);
  for (let i = 0; i < order.length; i++) {
    target[order[i]] = order[(i + 1) % order.length];
  }
  return target;
}

/**
 * Accept a word, or say why not. Case and surrounding space are the player's
 * business, not the rules'; anything else is rejected with a reason specific
 * enough to act on, because "invalid word" tells a player nothing about
 * whether to retype it or think of another one.
 */
function readWord(raw: unknown): MoveResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'That is not a word.' };
  const word = raw.trim().toUpperCase();
  if (word.length !== WORD_LENGTH) {
    return { ok: false, error: `Words are ${WORD_LENGTH} letters.` };
  }
  if (!/^[A-Z]+$/.test(word)) {
    return { ok: false, error: 'Letters only, no spaces, digits or punctuation.' };
  }
  if (!isDuelWord(word)) {
    return { ok: false, error: `${word} is not in the word list.` };
  }
  return { ok: true, state: word };
}

function isOver(state: WordleState): boolean {
  return state.phase === 'over';
}

function setWord(state: WordleState, word: string, seat: number): MoveResult<WordleState> {
  if (state.phase !== 'setup') {
    return { ok: false, error: 'Every word is already set.' };
  }
  if (state.secrets[seat] !== null) {
    // Deliberately final. Letting a player swap their word after seeing the
    // opponent's first guess would make every mark already shown a lie.
    return { ok: false, error: 'You have already set your word.' };
  }

  const secrets = state.secrets.slice();
  secrets[seat] = word;
  const allIn = secrets.every((s) => s !== null);

  return { ok: true, state: { ...state, secrets, phase: allIn ? 'play' : 'setup' } };
}

/**
 * Where every shot clock in this game is started, stopped and left alone.
 * Called with the state as it stands *after* a guess by `mover`.
 *
 * Three rules, and the order they are written in is the order they matter:
 *
 * 1. **Nothing is timed until a word has actually been cracked.** Working out
 *    a five-letter word from cold is thinking, not stalling, and a countdown
 *    over that only rushes people out of the part of the game they came for.
 *    So while `solvedIn` is empty every clock is off, and the guess that fills
 *    it is the one that starts them.
 * 2. **Once somebody has solved, everyone still playing is on a clock.** The
 *    game now has a result standing and the only thing between it and the
 *    scoreboard is the players who have not answered it, which is exactly the
 *    stall worth putting a whistle on. The mover buys their own next minute by
 *    guessing; everyone else keeps the clock they are already on rather than
 *    being handed a fresh one, so a player firing off guesses cannot top up the
 *    others and a player under pressure cannot buy time by making somebody else
 *    move.
 * 3. **A seat that can no longer act has no clock.** Solved, out of guesses or
 *    timed out, there is nothing left for it to be late for.
 *
 * At two players this reads simply: guess away untimed, and the moment one of
 * you gets it the other has a minute per guess to catch up.
 */
function reclock(state: WordleState, mover: number, now: number): Array<number | null> {
  const cracked = seatsOf(state).some((seat) => state.solvedIn[seat] !== null);
  if (!cracked) return state.dueBy.map(() => null);

  return state.dueBy.map((due, seat) => {
    if (!canAct(state, seat)) return null;
    return seat === mover ? now + GUESS_MS : (due ?? now + GUESS_MS);
  });
}

function guess(
  state: WordleState,
  word: string,
  seat: number,
  now: number,
): MoveResult<WordleState> {
  if (state.phase === 'setup') {
    return { ok: false, error: 'Waiting for every word to be set.' };
  }
  if (state.phase === 'over') {
    return { ok: false, error: 'The game is already over.' };
  }
  if (state.solvedIn[seat] !== null) {
    return { ok: false, error: 'You have already solved it.' };
  }
  if (state.guesses[seat].length >= MAX_GUESSES) {
    return { ok: false, error: 'You are out of guesses.' };
  }
  // Belt and braces. The room settles the clock before every move it applies,
  // so a guess this late normally meets a game that is already over. The
  // reducer is not entitled to assume its caller did that.
  if (outOfTime(state, seat, now)) {
    return { ok: false, error: 'Your minute is up.' };
  }

  // The word this seat is guessing at is the one its target set.
  const secret = state.secrets[targetOf(state, seat)];
  if (secret === null || secret === undefined) {
    return { ok: false, error: 'Waiting for every word to be set.' };
  }

  const rows: Row[] = state.guesses[seat].concat({ word, marks: markGuess(word, secret) });
  const guesses = state.guesses.slice();
  guesses[seat] = rows;

  const solvedIn = state.solvedIn.slice();
  if (word === secret) solvedIn[seat] = rows.length;

  // When this guess landed, which is what separates two players who spend the
  // same number of them. Stamped on every guess rather than only on a solve:
  // a game nobody solves is a tie on guesses too, and needs the same tiebreak.
  const guessedAt = state.guessedAt.slice();
  guessedAt[seat] = now;

  const next: WordleState = { ...state, guesses, solvedIn, guessedAt };
  if (seatsOf(next).every((s) => isFinished(next, s))) {
    // No clock survives the end of a game: `deadline` would otherwise keep
    // asking the room to wake up for a game there is nothing left to settle.
    return {
      ok: true,
      state: {
        ...next,
        dueBy: next.dueBy.map(() => null),
        phase: 'over',
        winner: decide(next),
      },
    };
  }
  return { ok: true, state: { ...next, dueBy: reclock(next, seat, now) } };
}

export const wordle: GameDefinition<WordleState, WordleMove> = {
  id: GAME_MANIFEST.wordle.id,
  name: GAME_MANIFEST.wordle.name,
  minPlayers: 2,
  maxPlayers: 8,

  /**
   * The words come from the players, so there is nothing to draw but the ring,
   * and that is the one thing here needing the rng: who is guessing whose word
   * must not be predictable from the seating.
   */
  setup(playerCount, rng): WordleState {
    const count = Math.max(2, Math.min(playerCount, 8));
    return {
      phase: 'setup',
      secrets: Array<string | null>(count).fill(null),
      target: ring(count, rng),
      guesses: Array.from({ length: count }, () => [] as Row[]),
      solvedIn: Array<number | null>(count).fill(null),
      guessedAt: Array<number | null>(count).fill(null),
      // Nobody is on a clock yet, and nobody is until a word is cracked.
      // There is no `start` here for the same reason: the room is dealt,
      // everyone picks a word, and the guessing runs untimed until the first
      // solve puts everyone else under the whistle.
      dueBy: Array<number | null>(count).fill(null),
      timedOut: [],
      winner: null,
    };
  },

  applyMove(state, move, seat, _rng, now = Date.now()): MoveResult<WordleState> {
    if (!Number.isInteger(seat) || seat < 0 || seat >= state.secrets.length) {
      return { ok: false, error: 'You are not playing.' };
    }
    if (!move || (move.type !== 'setWord' && move.type !== 'guess')) {
      return { ok: false, error: 'Unknown move.' };
    }

    const word = readWord(move.word);
    if (!word.ok) return { ok: false, error: word.error };

    return move.type === 'setWord'
      ? setWord(state, word.state, seat)
      : guess(state, word.state, seat, now);
  },

  /**
   * A hint for the status line only, see the note at the top of this file.
   * Whoever has played fewer rows is who the game is waiting on; ties go to
   * seat 0 so this stays a pure function of the state.
   */
  turn(state) {
    if (isOver(state)) return null;
    const seats = seatsOf(state);
    // A seat under the whistle is one the game is actually waiting on, and
    // saying so is the whole job of this hint. Above two players several may
    // be on a clock at once; the one closest to running out is the answer.
    const ticking = seats
      .filter((seat) => state.dueBy[seat] !== null)
      .sort((a, b) => (state.dueBy[a] as number) - (state.dueBy[b] as number));
    if (ticking.length > 0) return ticking[0];

    const live = seats.filter((seat) => canAct(state, seat));
    if (live.length === 0) return null;
    // Whoever has played fewest rows is the one the game is waiting on; ties
    // go to the lower seat so this stays a pure function of the state.
    return live.reduce((a, b) => (state.guesses[a].length <= state.guesses[b].length ? a : b));
  },

  // The display module's predicate *is* the contract's, passed straight
  // through: the board and the server have to answer "may I type" the same
  // way, and a second implementation here is the way they stop doing that.
  canAct,

  isOver,

  /**
   * The soonest anyone's minute runs out. Only one clock is ever running, so
   * in practice this is that clock, written as the earliest of the two anyway
   * so it cannot quietly start returning the wrong one if that changes.
   */
  deadline(state) {
    if (state.phase !== 'play') return null;
    const due = state.dueBy.filter((at): at is number => at !== null);
    return due.length === 0 ? null : Math.min(...due);
  },

  /**
   * A minute gone finishes the player it ran out on. Called by the room off a
   * timer, so it lands whether or not anyone is watching, which is the point of
   * a clock, and again before any move that arrives late.
   *
   * Whether that also ends the *game* is the interesting part. A timeout is a
   * player abandoning the duel rather than playing it out, so once it leaves
   * fewer than two people still able to guess there is no duel left to decide
   * and the game is settled there and then. At two players that is the whole
   * of the old rule: one clock goes, the other player wins, immediately. Above
   * two, the rest carry on without the player who stopped.
   *
   * Note what this does *not* do: a player finishing honestly, by solving or
   * spending their guesses, never ends anyone else's game early, because the
   * others are still entitled to the guesses they have left. A solve starts
   * their clock; it does not stop their game.
   */
  expire(state, now) {
    if (state.phase !== 'play') return null;
    const seats = seatsOf(state);
    const late = seats.filter((seat) => outOfTime(state, seat, now));
    if (late.length === 0) return null;

    const timedOut = state.timedOut.concat(late);
    const stopped: WordleState = { ...state, timedOut };
    const live = seats.filter((seat) => canAct(stopped, seat));

    if (live.length <= 1) {
      return {
        ...stopped,
        dueBy: stopped.dueBy.map(() => null),
        phase: 'over',
        winner: decide(stopped),
      };
    }

    // Still a game. Everyone left who is not already on a clock goes on one:
    // the clock that just expired may have been the only one running, and
    // once a word has been cracked a game with no clock at all is the stall
    // this mechanism exists to stop. Only reachable past the first solve:
    // before that no clock is running, so none can expire.
    const dueBy = stopped.dueBy.map((due, seat) =>
      canAct(stopped, seat) ? (due ?? now + GUESS_MS) : null,
    );
    return { ...stopped, dueBy };
  },

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    const seats = seatsOf(state);

    if (state.phase === 'setup') {
      const waiting = seats.filter((seat) => state.secrets[seat] === null);
      if (waiting.length === seats.length) return 'Everyone is choosing a word';
      if (waiting.length === 1) return `Waiting for ${nameFor(waiting[0])} to choose a word`;
      return `Waiting on ${waiting.length} more words`;
    }

    if (state.phase === 'over') {
      // `winner` is always set once the game is over, there being no draw to
      // report, but the type says otherwise and a status line is no place to
      // throw.
      const winner = state.winner;
      if (winner === null) return 'Game over';

      const count = state.solvedIn[winner];
      if (count !== null) {
        const guesses = `${count} ${count === 1 ? 'guess' : 'guesses'}`;
        // Somebody else matched the count and lost on the clock, so say what
        // actually decided it. "Wins in 3" over a table of threes reads like an
        // error.
        const shared = seats.some((seat) => seat !== winner && state.solvedIn[seat] === count);
        return shared
          ? `${nameFor(winner)} wins in ${guesses}, first to it`
          : `${nameFor(winner)} wins in ${guesses}`;
      }

      // Won without solving. Their guess count is beside the point and may not
      // exist, so the line is about how everyone else went out instead.
      const gone = state.timedOut.filter((seat) => seat !== winner);
      if (gone.length === 1) {
        return `${nameFor(gone[0])} ran out of time, so ${nameFor(winner)} wins`;
      }
      if (gone.length > 1) {
        return `${nameFor(winner)} wins. ${gone.map(nameFor).join(', ')} ran out of time`;
      }
      // Nobody solved and nobody walked away: six guesses each and the clock
      // is all that is left to separate them.
      return `Not one word was cracked, so ${nameFor(winner)} wins on speed`;
    }

    const live = seats.filter((seat) => canAct(state, seat));
    if (live.length === 1) return `Waiting on ${nameFor(live[0])}`;

    const ticking = seats.filter((seat) => state.dueBy[seat] !== null);
    if (ticking.length === 1) return `${nameFor(ticking[0])} is on the clock`;
    if (ticking.length > 1) return `${ticking.length} players are on the clock`;

    return live.length === 2 ? 'Both guessing' : `${live.length} still guessing`;
  },

  /**
   * The secrets are the only hidden thing in the game. Everyone's guesses,
   * their marks and how close they are you could derive yourself, so hiding
   * them would only cost the tension of watching people close in.
   *
   * A player who has chosen shows as `HIDDEN` rather than `null`, so the board
   * can tell "chosen, not for your eyes" from "still thinking". You always see
   * your own, which you typed. You see the one you are guessing once you are
   * finished with it, because losing without ever learning the word is the
   * unsatisfying ending. Everything is open once the game is over.
   *
   * What you never see, while it could still matter, is a word somebody *else*
   * is guessing. At two players that distinction did not exist; above two it
   * is the difference between a duel and a table where one finished player can
   * hand out answers.
   */
  view(state, seat) {
    if (state.phase === 'over') return state;
    const mine = targetOf(state, seat);
    const done = isFinished(state, seat);
    return {
      ...state,
      secrets: state.secrets.map((word, index) => {
        if (index === seat) return word;
        if (index === mine && done) return word;
        return word === null ? null : HIDDEN;
      }),
    };
  },
};

/**
 * Exported for the test that holds the word list to a usable size. The
 * five-letter subset, not the whole dictionary: this game plays at one length,
 * and how many eight-letter words exist says nothing about whether a player
 * here is fighting it.
 */
export function wordCount(): number {
  return duelWords().size;
}
