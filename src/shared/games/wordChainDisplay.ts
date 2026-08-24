/**
 * The parts of Word Chain the board is allowed to know.
 *
 * Same boundary as `wordleDisplay.ts` and `wordHuntDisplay.ts`, and for the
 * same reason, only more so: this game's three word lists are the second
 * largest thing in the repo after `words.ts`, and they exist to validate a
 * move, which happens on the server. One convenience import in
 * `WordChainBoard.tsx` would put thirty thousand Polish inflections and twelve
 * thousand Japanese entries on the phone of everyone who opens the lobby.
 * `bundle.test.ts` holds that line.
 *
 * The only thing it imports is another leaf that imports nothing itself. The
 * rule is not "no imports" but "nothing that reaches a reducer".
 *
 * There is deliberately no folding or letter logic here. The board never needs
 * to work out what a word must start with, because the server puts the answer
 * in `required` — which is also what stops the board and the reducer ever
 * disagreeing about whose turn it is to say a word beginning with A.
 *
 * `wordChain.ts` re-exports everything here, so the reducer and its tests
 * carry on importing from one place.
 */

export { clockCall, formatClock } from '../clock.js';

export type ChainLang = 'en' | 'pl' | 'ja';

export const LANGS: readonly ChainLang[] = ['en', 'pl', 'ja'];

/**
 * How the chain links one word to the next.
 *
 * `loose` links on the folded letter, which is the only thing that works
 * across languages: a Polish word ending in `ś` has to hand an English or
 * Japanese player something they can answer, and it hands them an `s`.
 *
 * `strict` links on the letter as written, accents and all, and is what a
 * game gets when both players chose the same language — there is nobody to
 * strand, so there is no reason to flatten it. In practice this is a Polish
 * setting: English and Japanese have no accented forms between them, so the
 * two modes are the same game in those languages.
 */
export type ChainMode = 'loose' | 'strict';

/** What to call each language, and what to call a word in it. */
export const LANG_NAME: Record<ChainLang, string> = {
  en: 'English',
  pl: 'Polish',
  ja: 'Japanese',
};

/**
 * How many words each language's list holds.
 *
 * Here so the end-of-game stats can say where a word sat *within its own
 * language*, which is the only comparable thing to say about it: English holds
 * twenty-five thousand words and Japanese twelve, so `#4,000` is an ordinary
 * word in one and an obscure one in the other, and a table putting the two
 * players' mean ranks side by side would be reporting the size of the lists
 * rather than anything about how they played.
 *
 * Three integers rather than a count taken from the lists themselves, because
 * the board is the thing that needs them and the board must never reach a word
 * list — see the note at the top of this file. `wordChain.test.ts` holds them
 * against `chainListSizes()`, so a rebuild that changes a list fails there
 * rather than quietly skewing a percentage.
 */
export const LIST_SIZE: Record<ChainLang, number> = { en: 25_000, pl: 62_669, ja: 12_000 };

/**
 * The shortest word the game will take, in every language.
 *
 * Three, not two, and the reason is the same in all three: two-letter words
 * are function words — Polish `to`, `na`, `za`; Japanese single mora like `no`
 * and `ga`; English `of`, `an`. They are the commonest words in each language,
 * so an unbounded chain becomes two players trading particles. The lists are
 * built to this limit as well, so a word this short is not merely refused, it
 * is not in the dictionary at all; the constant is here for the copy that has
 * to explain the refusal.
 */
export const MIN_LENGTH = 3;

/**
 * The fewest unsaid words a letter has to have behind it before the game will
 * hand it to anybody.
 *
 * "There is one" and "you could think of one" are different questions. The
 * lists come from subtitle corpora, so the thinnest letters are answerable
 * only by whatever proper nouns wandered in: Polish X is *Xavier* and nothing
 * else, Polish Y is four American place names, Polish V is fourteen Dutch
 * surnames, English X is three. Being handed one of those is losing to the
 * dictionary rather than to your own vocabulary, which is not a game.
 *
 * Per language, because the three lists are not the same size and are not
 * distributed the same way. Sorted, the whole-list counts below two hundred
 * run
 *
 *     ja L 0   ja Q 0   ja X 0   pl X 1   ja V 2   en X 3   pl Q 3
 *     pl Y 4   pl V 14  | en Z 50  en Q 93 | ja W 103  en Y 109
 *     ja E 152  ja U 156  ja Z 167  pl E 189
 *
 * English sits at forty, which clears its one dead letter and keeps Z (50) and
 * Q (93) — thin, but *zebra* and *question* are words anybody can find, and a
 * bar high enough to take them would be the game refusing letters on the
 * player's behalf. Polish and Japanese sit at a hundred, which is comfortable
 * in Polish — the next letter up is E at 189 — and deliberate rather than
 * comfortable in Japanese, where W at 103 clears it by three words. If a
 * rebuild of the lists moves Japanese W, this number is the thing to look at,
 * and `wordChain.test.ts` fails loudly rather than quietly dropping the
 * letter.
 *
 * It is a floor on what is *left*, not on the letter, so it tightens as a long
 * game eats a thin one — English Z starts at fifty and stops being handable
 * once eleven Z words have been said. That is right: the last few words
 * starting with Z are no easier to find than the only one.
 *
 * It does the second half of its job in `strict` mode, where it is the whole
 * of "given they're possible": five of the nine Polish accented letters —
 * ą, ę, ń, ó, ź — begin no Polish word at all, so a word ending in one of them
 * is refused, and ł, ś and ż, which begin hundreds, are handed over happily.
 */
export const MIN_ANSWERS: Record<ChainLang, number> = { en: 40, pl: 100, ja: 100 };

/**
 * How long a player has to produce a word, and how long the two of them have
 * to choose their languages.
 *
 * A minute is the whole game: running out of it is the only way to lose, so
 * this number is not a stall-breaker bolted onto the rules the way Word Duel's
 * is, it *is* the rule. Sixty seconds is long enough that a word you know will
 * surface and short enough that one you don't will not.
 *
 * It is the *opening* minute, not every minute: the clock tightens as the
 * chain grows, so a turn's real allowance is `turnMsFor(said)` and nothing but
 * setup should reach for this constant on its own.
 *
 * Setup gets the same minute for a duller reason: a player who never picks a
 * language would otherwise hang the room forever. Nobody loses to it — see
 * `expire` in the reducer, which defaults the undecided to English and starts
 * the game rather than ending it.
 */
export const TURN_MS = 60 * 1000;

/**
 * How many words the chain grows by before the minute gets a second shorter,
 * and how much shorter.
 *
 * The chain is the only thing in this game that keeps score, so it is the only
 * honest thing to tie the pace to: three words in, both players have answered
 * at least once, the easy openers are spent, and the clock starts closing. A
 * word of the chain costs a third of a second, so the minute is halved by word
 * ninety and the pressure arrives somewhere in the middle of a long game
 * rather than at the end of it.
 */
export const TURN_STEP_WORDS = 3;
export const TURN_STEP_MS = 1000;

/**
 * The floor the minute never goes under.
 *
 * Ten seconds is enough to say a word that is already in your head and not
 * much more, which is the ending the ramp is walking towards: past here the
 * game has stopped asking what you know and started asking what you can reach
 * for. Shorter would be losing to the keyboard rather than to the vocabulary.
 * Reached at 150 words — see `turnMsFor` — which is a long game but not an
 * impossible one, so unlike most floors this is a number two good players can
 * expect to actually play against.
 */
export const MIN_TURN_MS = 10 * 1000;

/**
 * How long a player gets to answer, given how many words are already chained.
 *
 * A pure function of the chain length rather than a countdown kept on the
 * state, so that every turn's allowance can be recovered afterwards from
 * nothing but the word's place in the chain: the end screen has to say a word
 * arrived "with four seconds left", and by then the deadline it beat is long
 * overwritten. `said` is the number of words *behind* the player, so the
 * opener and the two answers after it get the full minute and the fourth word
 * is the first one to feel it.
 *
 * Setup does not use this — the language menu always gets the full minute; see
 * `TURN_MS`.
 */
export function turnMsFor(said: number): number {
  const steps = Math.floor(Math.max(0, said) / TURN_STEP_WORDS);
  return Math.max(MIN_TURN_MS, TURN_MS - steps * TURN_STEP_MS);
}

/** One word in the chain, as the board should draw it. */
export interface ChainLink {
  /**
   * The word as it should be *read*: Polish with its diacritics back on,
   * Japanese in romaji, English as typed. Not what the game compares — see
   * `key`.
   */
  word: string;
  /**
   * The folded form the game actually reasons about: lower case, ASCII, Polish
   * diacritics flattened, Japanese romanisation variants collapsed. It is on
   * the wire because the board underlines the letter that carries to the next
   * word, and that letter is this string's last one, not `word`'s — `ręką`
   * hands on an `a`.
   */
  key: string;
  lang: ChainLang;
  /** Who said it. */
  seat: number;
  /** English meaning, or empty when the list has none for this word. */
  gloss: string;
  /**
   * Japanese in its own script, so the romaji is not the only thing a learner
   * ever sees. Empty for the other two languages.
   */
  script: string;
  /**
   * The dictionary form, when the word played was an inflection of it — Polish
   * `jestem` carries `być`. Empty when the word is already its own lemma, and
   * for the languages where the distinction does not arise.
   */
  lemma: string;
  /**
   * How long the player took over it, in milliseconds, out of the minute they
   * had. Zero on the reveal, which nobody played.
   *
   * Recorded rather than derived, because it cannot be recovered later: the
   * clock is a single `deadline` that the next word overwrites, so a turn that
   * is not measured as it ends is gone. It is what the end-of-game stats are
   * mostly made of — a mean answer time is the one number here that is about
   * the players rather than about the words they happened to know.
   */
  ms: number;
  /**
   * Where the word sits in its language's frequency list, commonest first and
   * counting from one — `#742` under the word on the board, which is how a
   * player finds out that the word they reached for is the four hundredth
   * commonest thing anyone says.
   *
   * On the wire because the board has no list to look it up in, and a rank
   * within a language rather than across them: the Japanese list holds twelve
   * thousand words to English's twenty-five, so the same number means
   * something rarer in English. The board shows the language beside it, which
   * is as much as a bare number can honestly carry.
   */
  rank: number;
}

export type WcPhase = 'setup' | 'playing' | 'over';

export interface WcState {
  phase: WcPhase;
  /** Each seat's language, or null while they are still choosing. */
  langs: (ChainLang | null)[];
  /**
   * How the chain links, decided once when play begins and never after: two
   * players who chose the same language get `strict`, everyone else `loose`.
   *
   * Derivable from `langs`, and stored anyway, because the board has to say
   * which game it is before the first word is played and the two must never
   * disagree about it mid-chain. `false` throughout setup.
   */
  strict: boolean;
  /** Oldest first. The last link is the one being answered. */
  chain: ChainLink[];
  /** The seat the game is waiting on. Meaningless once `phase` is `over`. */
  at: number;
  /**
   * The letter the next word must start with, or '' for the opening word,
   * which is free. Computed by the server from the last link so that nothing
   * else has to know how folding works — and in a `strict` game it can be an
   * accented one, `ł` or `ś` or `ż`, which the board shows as it stands.
   */
  required: string;
  /**
   * How many words the seat on the clock could still legally say: unsaid words
   * in their language starting with `required`, or the whole of their language
   * before the first word. Null while nobody is on the clock.
   *
   * The server counts it because only the server has the lists — the board
   * shows the number and never derives it, the same bargain as `required`.
   * It is symmetric information: both players see the same count, and it is
   * the count for whoever is thinking, not for whoever is reading it.
   */
  available: number | null;
  /** When the current minute runs out, or null before the game is on a clock. */
  deadline: number | null;
  /** The seat that lost, or null while nobody has. */
  loser: number | null;
  /**
   * Whether the loser said so themselves rather than running the clock down.
   *
   * The two endings want different words on the screen — "ran out of time" is
   * wrong about a player who pressed the button with forty seconds left — but
   * they are otherwise the same ending, reveal and all. Giving up is not a
   * lesser loss here: the reveal is the reason to play, and a player who
   * cannot think of a word should be able to reach it without sitting out a
   * minute they have already spent.
   */
  gaveUp: boolean;
  /**
   * The word the loser could have said: the commonest one in their language
   * that starts with `required` and has not been used. Null until somebody
   * loses, and null in the vanishingly rare case that no such word exists.
   *
   * This is the reason the lists are frequency-ordered, and most of the reason
   * to play the game at all — a minute of failing to think of a word is the
   * moment you are most likely to remember the answer.
   */
  reveal: ChainLink | null;
}

export type WcMove =
  | { type: 'lang'; lang: ChainLang }
  | { type: 'say'; word: string }
  /** Only from the seat on the clock, and only once play has started. */
  | { type: 'give-up' };

export function isFinished(state: WcState): boolean {
  return state.phase === 'over';
}

/** Whether the clock has run out as of `now`. False when there is no clock. */
export function outOfTime(state: WcState, now: number | undefined): boolean {
  return state.deadline !== null && now !== undefined && now >= state.deadline;
}

/** How much of the minute is left, for the countdown. */
export function msLeftFor(state: WcState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, state.deadline - now);
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is only *sometimes* strictly alternating and the contract has to be honest
 * about which kind it is. During setup both players choose at once and neither
 * is waiting on the other, so two seats can act; once play starts exactly one
 * can. `turn` reports a single seat throughout, which is why it is a hint for
 * the status line and this is the predicate every control is gated on.
 */
export function canAct(state: WcState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.langs.length) return false;
  if (state.phase === 'setup') return state.langs[seat] === null;
  if (state.phase === 'over') return false;
  return state.at === seat && !outOfTime(state, now);
}

/**
 * How one seat played, averaged over the words they said.
 *
 * Averages rather than totals throughout, because the two seats do not get the
 * same number of turns — the loser has had one more than the winner — and a
 * total would make "went second" look like a difference in play.
 */
export interface SeatStat {
  seat: number;
  lang: ChainLang | null;
  /** How many words this seat contributed. Zero seats are not worth drawing. */
  said: number;
  /** Mean length in letters, counted in code points so `ż` is one letter. */
  letters: number;
  /**
   * Mean position in the seat's own list, as a fraction: 0.04 is "top 4% of
   * the language". Comparable between seats in a way a mean rank is not — see
   * `LIST_SIZE`. Lower is commoner, so a *higher* number is the rarer player.
   */
  percentile: number;
  /** Mean time taken, in milliseconds out of the minute. */
  ms: number;
}

/** A single word worth pointing at, and where in the chain it was. */
export interface ChainHighlight {
  link: ChainLink;
  /** Which word of the chain it was, counting from one. */
  turn: number;
}

export interface ChainStats {
  /** One per seat, in seat order, including seats that never said anything. */
  seats: SeatStat[];
  /** The word left latest — the one that nearly ran the clock out. */
  closest: ChainHighlight | null;
  /** The word furthest down its own language's list. */
  rarest: ChainHighlight | null;
  /** The word with the most letters. */
  longest: ChainHighlight | null;
}

/** Where a word sits in its own list, as a fraction. Lower is commoner. */
function depth(link: ChainLink): number {
  return link.rank / LIST_SIZE[link.lang];
}

/** Letters, in code points — `żółty` is five, not eight. */
function letters(word: string): number {
  return [...word].length;
}

/**
 * What the chain says about the two of them, worked out at the end.
 *
 * Pure, and here rather than in the board, because it is the kind of thing
 * that is easy to get quietly wrong — a mean over the wrong denominator, a
 * "rarest" that is really "rarest in the biggest list" — and none of that is
 * visible by looking at the screen. `wordChain.test.ts` holds it.
 *
 * Every superlative keeps the *earliest* word on a tie, so the same chain
 * always reports the same moment. Two words of six letters is not a reason for
 * the end screen to pick one at random.
 */
export function chainStats(state: WcState): ChainStats {
  const seats: SeatStat[] = state.langs.map((lang, seat) => {
    const said = state.chain.filter((link) => link.seat === seat);
    const mean = (of: (link: ChainLink) => number): number =>
      said.length === 0 ? 0 : said.reduce((total, link) => total + of(link), 0) / said.length;
    return {
      seat,
      lang,
      said: said.length,
      letters: mean((link) => letters(link.word)),
      percentile: mean(depth),
      ms: mean((link) => link.ms),
    };
  });

  let closest: ChainHighlight | null = null;
  let rarest: ChainHighlight | null = null;
  let longest: ChainHighlight | null = null;
  state.chain.forEach((link, i) => {
    const here = { link, turn: i + 1 };
    if (closest === null || link.ms > closest.link.ms) closest = here;
    if (rarest === null || depth(link) > depth(rarest.link)) rarest = here;
    if (longest === null || letters(link.word) > letters(longest.link.word)) longest = here;
  });

  return { seats, closest, rarest, longest };
}

/** Every word already said, folded, so a repeat can be spotted in one lookup. */
export function usedKeys(state: WcState): Set<string> {
  return new Set(state.chain.map((link) => link.key));
}
