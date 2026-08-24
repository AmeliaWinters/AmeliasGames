import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import {
  chainKey,
  chainLookup,
  commonestStarting,
  countStarting,
  foldLetter,
} from './chainDictionary.js';
import type { ChainEntry } from './chainDictionary.js';
import {
  LANGS,
  LANG_NAME,
  MIN_ANSWERS,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  isFinished,
  usedKeys,
} from './wordChainDisplay.js';

import type { ChainLang, ChainLink, ChainMode, WcMove, WcState } from './wordChainDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word lists.
export {
  LANGS,
  LANG_NAME,
  MIN_ANSWERS,
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
export type {
  ChainLang,
  ChainLink,
  ChainMode,
  WcMove,
  WcPhase,
  WcState,
} from './wordChainDisplay.js';

/**
 * Word chain across three languages: say a word starting with the letter the
 * last one ended on, in the language you chose, before your minute runs out.
 *
 * Two play, each on a language of their own — so a Polish word ending in A is
 * answered by an English or Japanese one beginning with A, and the chain
 * crosses languages every turn. The clock is what beats you — either it runs
 * out or you admit it was going to — and when it does the game shows the
 * commonest word that would have worked. That reveal is the point of the whole
 * thing: a minute of failing to think of a word is the moment you are most
 * likely to remember the answer.
 *
 * Five things here are worth knowing before changing anything:
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
 * 2. **A word that leaves the opponent almost nothing to say is refused.** No
 *    Japanese word begins with L, Q or X, and Polish has exactly one starting
 *    with X. Without this rule a player could be handed a letter their
 *    language cannot answer and lose to the dictionary rather than to their
 *    own vocabulary, which is not a game. `tooThin` is the check, and the bar
 *    is a count rather than one word — the numbers, per language, and the
 *    measurements behind them are on `MIN_ANSWERS`.
 *
 * 3. **A refused word costs seconds, not the game.** The lists hold common
 *    words only and will not have everything a player knows, so a rejection
 *    has to be survivable: `applyMove` says why and leaves the clock alone.
 *
 * 4. **Two players in the same language get their accents back.** The chain
 *    normally links on the folded letter, because `ś` is not something an
 *    English or Japanese player can answer. When both seats picked the same
 *    language there is nobody to strand, so the chain links on the letter as
 *    written: *coś* asks for *świat*, and *był* asks for *łatwo*. It is a
 *    Polish rule in practice — English and Japanese have no accented forms —
 *    and `mode` is the whole of it, decided once in `beginPlay` and stored on
 *    the state so the board and the reducer cannot come to differ. Five of the
 *    nine accented letters begin no Polish word at all, and the same
 *    `MIN_ANSWERS` gate that refuses a Japanese L refuses a word ending in
 *    one of them.
 *
 * 5. **There are two ways to lose and they are the same ending.** The clock
 *    running out, and saying so yourself. `concede` is both of them, because
 *    the reveal is the point of the game and a player who has already given up
 *    on the minute should not have to sit through the rest of it to see the
 *    word. Only `gaveUp` tells them apart, and only the copy reads it.
 */

const SEATS = 2;

const opponentOf = (seat: number): number => (seat + 1) % SEATS;

/**
 * The letter a word hands on: the last of the key the chain is linking on.
 *
 * In a `loose` game that is the folded key, so *ręką* hands on an `a`. In a
 * `strict` one it is the word as written, so *coś* hands on a `ś`.
 */
const handsOn = (entry: ChainEntry, mode: ChainMode): string => chainKey(entry, mode).slice(-1);

/** Which chain this game is: see `ChainMode`, and point 4 above. */
const modeOf = (state: WcState): ChainMode => (state.strict ? 'strict' : 'loose');

function linkFrom(entry: ChainEntry, lang: ChainLang, seat: number): ChainLink {
  return {
    word: entry.word,
    key: entry.key,
    lang,
    seat,
    gloss: entry.gloss,
    script: entry.script,
    lemma: entry.lemma,
    rank: entry.rank,
  };
}

/**
 * Whether answering `letter` in `lang` is unreasonable — too few words start
 * with it and are still unsaid, or the language never had any.
 *
 * Not a check for zero. See `MIN_ANSWERS`: a letter with three answers, all of
 * them proper nouns out of a subtitle corpus, is a letter nobody can play.
 */
function tooThin(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
  mode: ChainMode,
): boolean {
  return countStarting(lang, letter, used, mode) < MIN_ANSWERS[lang];
}

/**
 * The state the seat on the clock is handed: whose turn, what letter, how many
 * words are behind it, and a fresh minute.
 *
 * One place, because the count and the letter have to agree — a `required` set
 * without recounting would leave the board telling a player there are 1,501
 * words when the letter has changed underneath it.
 */
function handTo(
  state: WcState,
  seat: number,
  required: string,
  used: ReadonlySet<string>,
  now: number,
): WcState {
  const lang = state.langs[seat];
  return {
    ...state,
    at: seat,
    required,
    available: lang == null ? null : countStarting(lang, required, used, modeOf(state)),
    deadline: now + TURN_MS,
  };
}

/**
 * End the game against `seat`, with the word they could have said.
 *
 * Both endings come through here — the clock, and the give-up button — because
 * they differ only in what the status line says. `gaveUp` carries that
 * difference and nothing else does.
 */
function concede(state: WcState, seat: number, gaveUp: boolean): WcState {
  const lang = state.langs[seat] ?? 'en';
  const reveal = commonestStarting(lang, state.required, usedKeys(state), modeOf(state));
  return {
    ...state,
    phase: 'over',
    loser: seat,
    gaveUp,
    available: null,
    deadline: null,
    reveal: reveal ? linkFrom(reveal, lang, seat) : null,
  };
}

/**
 * Setup is over: decide what kind of chain this is, and put the first player
 * on the clock with the whole of their language open.
 *
 * The mode is settled here and never again. Deciding it per word — asking each
 * time whether the two languages happen to match — would come to the same
 * answer, but it would put the rule somewhere a later change could make it
 * waver mid-chain, and a game that starts asking for `ł` after ten words of
 * asking for `l` is not a game anybody can play.
 */
function beginPlay(state: WcState, langs: ChainLang[], now: number): WcState {
  const strict = langs[0] === langs[1];
  return handTo({ ...state, phase: 'playing', langs, strict }, 0, '', new Set(), now);
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
      // Not knowable until both seats have chosen — see `beginPlay`.
      strict: false,
      chain: [],
      at: 0,
      required: '',
      // Nobody is thinking yet, so there is nothing to count. Set the moment
      // play begins — see `handTo`.
      available: null,
      // Null until the room says both seats are filled — see `start`. A clock
      // armed when the room *opened* would run down while the second player
      // was still reading the invite.
      deadline: null,
      loser: null,
      gaveUp: false,
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

    if (move.type === 'give-up') {
      // Setup is the one phase where `canAct` lets both seats through, and
      // there is nothing to give up on there — a player who does not want to
      // choose a language has already been handled, by `expire`.
      if (state.phase !== 'playing') return { ok: false, error: 'The game has not started.' };
      return { ok: true, state: concede(state, seat, true) };
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

    // Matched against the *stored* word, not the typed one. In a strict game
    // that is the entire trick: `chainLookup` found this entry from `swiatlo`,
    // and it is **światło** that has to start with the required `ś`. Nobody is
    // ever asked to type a letter their keyboard does not have.
    const mode = modeOf(state);
    if (state.required && !chainKey(entry, mode).startsWith(foldLetter(state.required, mode))) {
      return { ok: false, error: `Has to start with ${state.required.toUpperCase()}.` };
    }

    const next = opponentOf(seat);
    const nextLang = state.langs[next];
    const letter = handsOn(entry, mode);
    const after = new Set(used).add(entry.key);
    if (nextLang != null && tooThin(nextLang, letter, after, mode)) {
      const ends = letter.toUpperCase();
      // Says "hardly any" rather than a count, because the count is the part a
      // player would argue with: told there are three, they will name a fourth
      // that the list has never heard of and be right. The complaint the copy
      // has to answer is "why won't you take my word", and the answer is that
      // the other player would have had nothing to say to it.
      return {
        ok: false,
        error: `${entry.word} ends in ${ends}, and there are hardly any ${LANG_NAME[nextLang]} words left that start with it.`,
      };
    }

    return {
      ok: true,
      state: handTo(
        { ...state, chain: [...state.chain, linkFrom(entry, lang, seat)] },
        next,
        letter,
        after,
        at,
      ),
    };
  },

  /**
   * Settle a minute that has gone.
   *
   * Two quite different endings share this hook. During setup nobody loses: an
   * undecided seat is given English and the game starts, because a player who
   * wandered off before picking a language should not hand their opponent a
   * win, and a room stuck forever on a menu is worse than either. Once play
   * has started the clock is the losing condition, and `concede` is where the
   * reveal is worked out — the commonest word the loser could have said. The
   * give-up button ends the game through the same function; the only thing
   * that tells the two apart afterwards is `gaveUp`.
   */
  expire(state, now) {
    if (state.deadline === null || now < state.deadline) return null;

    if (state.phase === 'setup') {
      const langs = state.langs.map((l) => l ?? 'en') as ChainLang[];
      return beginPlay(state, langs, now);
    }
    if (state.phase !== 'playing') return null;

    return concede(state, state.at, false);
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
      const how = state.gaveUp ? 'gave up' : 'ran out of time';
      return `${who(state.loser)} ${how}. ${who(opponentOf(state.loser))} wins.`;
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
