import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { chainLookup, commonestStarting } from './chainDictionary.js';
import type { ChainEntry } from './chainDictionary.js';
import {
  LANGS,
  LANG_NAME,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  isFinished,
  usedKeys,
} from './wordChainDisplay.js';

import type { ChainLang, ChainLink, WcMove, WcState } from './wordChainDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word lists.
export {
  LANGS,
  LANG_NAME,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  clockCall,
  formatClock,
  isFinished,
  msLeftFor,
  outOfTime,
  usedKeys,
} from './wordChainDisplay.js';
export type { ChainLang, ChainLink, WcMove, WcPhase, WcState } from './wordChainDisplay.js';

/**
 * Word chain across three languages: say a word starting with the letter the
 * last one ended on, in the language you chose, before your minute runs out.
 *
 * Two play, each on a language of their own — so a Polish word ending in A is
 * answered by an English or Japanese one beginning with A, and the chain
 * crosses languages every turn. Running out of time is the only way to lose,
 * and when it happens the game shows the commonest word that would have
 * worked. That reveal is the point of the whole thing: a minute of failing to
 * think of a word is the moment you are most likely to remember the answer.
 *
 * Three things here are worth knowing before changing anything:
 *
 * 1. **Japanese links on romaji letters, not on kana.** Real shiritori chains
 *    the last *mora* to the first, and a word ending in the kana `n` loses
 *    outright. This game cannot do that, because a kana has no letter for an
 *    English or Polish word to answer, and cross-language chaining is the
 *    whole idea. So Japanese is typed and linked as romaji: the word for
 *    cherry blossom is `sakura`, it ends in an `a`, and the next player
 *    answers an `a` in whatever language they are playing. A word ending in
 *    the kana `n` is an `n` here and perfectly legal. This is a deliberate
 *    departure from the game Japanese speakers know.
 *
 * 2. **A word that leaves the opponent nothing to say is refused.** No
 *    Japanese word begins with L, Q or X, and Polish has one word starting
 *    with X. Without this rule a player could be handed a letter their
 *    language cannot answer and lose to the dictionary rather than to their
 *    own vocabulary, which is not a game. `leavesNothing` is the check, and it
 *    reuses `commonestStarting` — the same function that finds the reveal,
 *    asked the same question from the other side.
 *
 * 3. **A refused word costs seconds, not the game.** The lists hold common
 *    words only and will not have everything a player knows, so a rejection
 *    has to be survivable: `applyMove` says why and leaves the clock alone.
 *    The only losing condition is the clock.
 */

const SEATS = 2;

const opponentOf = (seat: number): number => (seat + 1) % SEATS;

/** The letter a word hands on: the last of its folded key. See `fold`. */
const handsOn = (entry: ChainEntry): string => entry.key.slice(-1);

function linkFrom(entry: ChainEntry, lang: ChainLang, seat: number): ChainLink {
  return {
    word: entry.word,
    key: entry.key,
    lang,
    seat,
    gloss: entry.gloss,
    script: entry.script,
    lemma: entry.lemma,
  };
}

/**
 * Whether answering `letter` in `lang` is impossible — every word that starts
 * with it has already been said, or the language never had one.
 */
function leavesNothing(lang: ChainLang, letter: string, used: ReadonlySet<string>): boolean {
  return commonestStarting(lang, letter, used) === null;
}

/** Setup is over: put the first player on the clock. */
function beginPlay(state: WcState, langs: ChainLang[], now: number): WcState {
  return { ...state, phase: 'playing', langs, at: 0, required: '', deadline: now + TURN_MS };
}

function isLang(value: unknown): value is ChainLang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export const wordChain: GameDefinition<WcState, WcMove> = {
  ...GAME_MANIFEST.wordchain,

  setup(): WcState {
    return {
      phase: 'setup',
      langs: Array(SEATS).fill(null),
      chain: [],
      at: 0,
      required: '',
      // Null until the room says both seats are filled — see `start`. A clock
      // armed when the room *opened* would run down while the second player
      // was still reading the invite.
      deadline: null,
      loser: null,
      reveal: null,
    };
  },

  start(state, now) {
    if (state.phase !== 'setup' || state.deadline !== null) return null;
    return { ...state, deadline: now + TURN_MS };
  },

  deadline(state) {
    return state.deadline;
  },

  applyMove(state, move, seat, _rng: Rng, now): MoveResult<WcState> {
    const at = now ?? 0;
    if (!canAct(state, seat, now)) return { ok: false, error: 'Not your move.' };

    if (move.type === 'lang') {
      if (!isLang(move.lang)) return { ok: false, error: 'No such language.' };
      const langs = state.langs.slice();
      langs[seat] = move.lang;
      if (langs.some((l) => l === null)) return { ok: true, state: { ...state, langs } };
      return { ok: true, state: beginPlay(state, langs as ChainLang[], at) };
    }

    if (move.type !== 'say') return { ok: false, error: 'No such move.' };

    const lang = state.langs[seat];
    if (lang == null) return { ok: false, error: 'Choose a language first.' };

    const typed = move.word.trim();
    if (typed.length < MIN_LENGTH) {
      return { ok: false, error: `Words have to be at least ${MIN_LENGTH} letters.` };
    }

    const entry = chainLookup(lang, typed);
    // The lists hold common words only, so this is the refusal a player is
    // most likely to think is wrong. Naming the language it looked in is what
    // makes it arguable rather than baffling.
    if (!entry) return { ok: false, error: `Not in the ${LANG_NAME[lang]} list.` };

    // Repeats are checked before the letter, and the order is the message. A
    // word that is both already said and starts wrongly is most usefully
    // reported as the repeat: "has to start with E" sends a player hunting for
    // a word they have in fact already played.
    const used = usedKeys(state);
    if (used.has(entry.key)) return { ok: false, error: `${entry.word} has already been said.` };

    if (state.required && !entry.key.startsWith(state.required)) {
      return { ok: false, error: `Has to start with ${state.required.toUpperCase()}.` };
    }

    const next = opponentOf(seat);
    const nextLang = state.langs[next];
    const letter = handsOn(entry);
    const after = new Set(used).add(entry.key);
    if (nextLang != null && leavesNothing(nextLang, letter, after)) {
      const ends = letter.toUpperCase();
      return {
        ok: false,
        error: `${entry.word} ends in ${ends}, and there is no ${LANG_NAME[nextLang]} word left that starts with it.`,
      };
    }

    return {
      ok: true,
      state: {
        ...state,
        chain: [...state.chain, linkFrom(entry, lang, seat)],
        at: next,
        required: letter,
        deadline: at + TURN_MS,
      },
    };
  },

  /**
   * Settle a minute that has gone.
   *
   * Two quite different endings share this hook. During setup nobody loses: an
   * undecided seat is given English and the game starts, because a player who
   * wandered off before picking a language should not hand their opponent a
   * win, and a room stuck forever on a menu is worse than either. Once play
   * has started the clock is the entire losing condition, and this is where
   * the reveal is worked out — the commonest word the loser could have said.
   */
  expire(state, now) {
    if (state.deadline === null || now < state.deadline) return null;

    if (state.phase === 'setup') {
      const langs = state.langs.map((l) => l ?? 'en') as ChainLang[];
      return beginPlay(state, langs, now);
    }
    if (state.phase !== 'playing') return null;

    const lang = state.langs[state.at] ?? 'en';
    const reveal = commonestStarting(lang, state.required, usedKeys(state));
    return {
      ...state,
      phase: 'over',
      loser: state.at,
      deadline: null,
      reveal: reveal ? linkFrom(reveal, lang, state.at) : null,
    };
  },

  /**
   * A hint for the status line, and nothing more.
   *
   * During setup it names whoever has still to choose, but both may act then
   * and neither is waiting on the other, so it is a guess in exactly the way
   * the contract warns about. `canAct` is the question every control means.
   */
  turn(state) {
    if (state.phase === 'over') return null;
    if (state.phase === 'setup') {
      const waiting = state.langs.findIndex((l) => l === null);
      return waiting === -1 ? 0 : waiting;
    }
    return state.at;
  },

  canAct,

  isOver: isFinished,

  status(state, names) {
    const who = (seat: number): string => names[seat] ?? `Player ${seat + 1}`;
    if (state.phase === 'over') {
      if (state.loser === null) return 'Game over.';
      return `${who(state.loser)} ran out of time. ${who(opponentOf(state.loser))} wins.`;
    }
    if (state.phase === 'setup') {
      const waiting = state.langs.flatMap((l, i) => (l === null ? [who(i)] : []));
      return waiting.length === SEATS
        ? 'Choosing languages.'
        : `Waiting for ${waiting.join(' and ')} to choose a language.`;
    }
    const lang = state.langs[state.at];
    const named = lang ? `${LANG_NAME[lang]} word` : 'word';
    return state.required
      ? `${who(state.at)}'s turn: a ${named} starting with ${state.required.toUpperCase()}.`
      : `${who(state.at)} opens with any ${named}.`;
  },
};
