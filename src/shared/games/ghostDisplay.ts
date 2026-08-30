/**
 * The parts of Superghost the board is allowed to know.
 *
 * Same boundary as `wordChainDisplay.ts`, and it matters here for exactly the
 * reason it matters there: the game runs on the Polish and English lists in
 * `chainWords.ts`, they exist to decide whether a move loses the round, and
 * that is decided on the server. One convenience import in `GhostBoard.tsx`
 * would put thirty thousand Polish inflections on the phone of everyone who
 * opens the lobby. `bundle.test.ts` holds that line.
 *
 * There is deliberately no dictionary logic here, not even a "does this look
 * alive" guess. The board never has to work out whether a letter is safe,
 * because working that out is the entire game and the server has already
 * answered in `left`, `reveals` and `phase`. A board that could tell would be
 * a board that could play for you.
 *
 * `ghost.ts` re-exports everything here, so the reducer and its tests still
 * import from one place.
 */

export type GhostLang = 'en' | 'pl';

export const GHOST_LANGS: readonly GhostLang[] = ['en', 'pl'];

export const GHOST_LANG_NAME: Record<GhostLang, string> = {
  en: 'English',
  pl: 'Polish',
};

/** Written in the language it names, for the setup tiles and for a screen reader. */
export const GHOST_LANG_NATIVE: Record<GhostLang, string> = {
  en: 'English',
  pl: 'polski',
};

/** Which end of the fragment a letter goes on. Superghost's whole rule change. */
export type GhostSide = 'start' | 'end';

export const GHOST_SIDES: readonly GhostSide[] = ['start', 'end'];

/**
 * The word a losing round spells out, a letter at a time. Five rounds and you
 * are out.
 *
 * Kept in English in both languages, because it is the game's name rather than
 * a translation: Polish for a ghost is *duch*, four letters, and using it would
 * make a Polish match one round shorter than an English one for no reason a
 * player could act on.
 */
export const GHOST_WORD = 'GHOST';

export const MAX_LETTERS = GHOST_WORD.length;

/**
 * The shortest thing that counts as finishing a word, and the one number here
 * that came out different from the brief.
 *
 * Ghost's classic rule is "three letters or more", which is what a game that
 * only ever appends needs: the fragment grows one letter a turn from one end,
 * and a three-letter floor still leaves room to steer. Superghost grows from
 * *both* ends, so the third letter arrives on the third move of the round with
 * two players who have each had one turn, and almost every live three-letter
 * fragment in either language is already a word. At three, a round is over
 * before anybody has made a decision.
 *
 * Four is the floor the Superghost variant is actually played on, and it is
 * also what the index is built to: a fragment has to be inside a word of at
 * least this length to count as alive, so `ab` being a word of its own does not
 * keep a dead position standing. See `ghostDictionary.ts`.
 */
export const MIN_WORD = 4;

/**
 * Hardcoded, not derived from the word lists: the point of QWERTY is that
 * letters sit where a thumb expects them. Same call `wordleDisplay.ts` makes.
 *
 * Polish gets a fourth row of the nine accented letters rather than a folded
 * keyboard, which is the opposite of what Word Chain does and is right for a
 * different game. Word Chain folds because a player is *typing* a word they
 * already know and a phone keyboard has no `ż` on it. Here the app draws the
 * keys, so there is nothing to fold around, and folding would be actively
 * wrong: `ż` and `z` start different words, and a game that treated them as
 * one letter would teach the single thing about Polish spelling a learner most
 * needs to get right.
 *
 * Q, V and X stay on the Polish rows although native words use none of them.
 * They are legal moves that lose the round, which is the same thing every
 * other bad letter is, and pulling three keys out of QWERTY to say so would
 * move the letters around the rest of the row.
 */
export const GHOST_KEY_ROWS: Record<GhostLang, readonly string[]> = {
  en: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  pl: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM', 'ĄĆĘŁŃÓŚŹŻ'],
};

/** Every letter that can be played in a language, lower case. */
export function ghostAlphabet(lang: GhostLang): string {
  return GHOST_KEY_ROWS[lang].join('').toLowerCase();
}

export type GhostPhase = 'setup' | 'playing' | 'round' | 'over';

/** A move that would have kept a lost position alive. See `GhostReveal`. */
export interface GhostOut {
  side: GhostSide;
  letter: string;
}

/**
 * What a round ended on, and what the two players are meant to take from it.
 *
 * This is where the game teaches, so it carries more than the result. Losing a
 * round is the one moment a player is guaranteed to read a definition, and a
 * reveal that only said "you lost" would spend it.
 */
export interface GhostReveal {
  /** Who lost the round. */
  seat: number;
  reason:
    /** Their letter finished a real word. */
    | 'completed'
    /** Their letter left a fragment no word contains. */
    | 'dead-end'
    /** They gave the round up rather than play. */
    | 'gave-up';
  /** The fragment as it stood when the round ended, losing letter included. */
  fragment: string;
  /** The letter that ended it, and which end it went on. Null on a give-up. */
  played: GhostOut | null;
  /**
   * The word being shown, which is a different word depending on `reason`: the
   * one they completed, or the commonest word they could still have been
   * heading for from the position they threw away. Empty only if the list has
   * nothing at all, which a dead end after a give-up can genuinely mean.
   */
  word: string;
  gloss: string;
  /** The dictionary form, where Polish has one: `jestem` is shown under `być`. */
  lemma: string;
  /** Where the word sits in its language's frequency order, counting from one. */
  rank: number;
  /**
   * The letters that would have kept them alive: still inside some word, and
   * not finishing one.
   *
   * The other half of the lesson, and the half a definition cannot give. A dead
   * end tells you the position was lost; this tells you whether it was, and a
   * give-up with four outs on it is a player who folded a position they had.
   * Empty on a completed word, where the question does not arise.
   */
  outs: GhostOut[];
}

export interface GhostState {
  phase: GhostPhase;
  /** Shared, unlike Word Chain's: one fragment cannot be in two languages. */
  lang: GhostLang;
  /** What is on the table, lower case, accents as written. */
  fragment: string;
  /** How many letters of GHOST each seat has taken, in seat order. */
  letters: number[];
  /** Counting from zero, and it is also which seat opens. See `openerOf`. */
  round: number;
  /** The seat the game is waiting on. Meaningless outside `playing`. */
  at: number;
  /**
   * How many words still contain the fragment.
   *
   * Public, and public on purpose: both players see the same number, so it
   * gives neither an edge, and it is the difference between bluffing and
   * guessing. A fragment down to two words is a position you can feel closing.
   * Computed by the server every move, because the only thing that could work
   * it out on a board is the whole word list.
   */
  left: number;
  /** Every round that has ended, oldest first. The last is the one on screen. */
  reveals: GhostReveal[];
  /** The seat that spelled GHOST, or null while the match is still on. */
  loser: number | null;
}

export type GhostMove =
  | { type: 'lang'; lang: GhostLang }
  /** Setup only. Either seat may start, once they have settled the language. */
  | { type: 'begin' }
  | { type: 'play'; side: GhostSide; letter: string }
  /** Leaves the reveal and opens the next round. Either seat. */
  | { type: 'next' }
  /** Only from the seat on the fragment, and only while a round is running. */
  | { type: 'give-up' };

export function isFinished(state: GhostState): boolean {
  return state.phase === 'over';
}

/**
 * The reveal on screen, or null when there is nothing to show.
 *
 * The board asks this rather than reading `reveals[reveals.length - 1]`,
 * because that array is the whole match and what the screen wants is "is a
 * round being explained right now": mid-play the last reveal is the *previous*
 * round's, and drawing it would be the game reporting a loss that has already
 * been paid for.
 */
export function revealNow(state: GhostState): GhostReveal | null {
  if (state.phase !== 'round' && state.phase !== 'over') return null;
  return state.reveals[state.reveals.length - 1] ?? null;
}

/** How much of GHOST a seat has spelled, as the letters themselves. */
export function spelled(state: GhostState, seat: number): string {
  return GHOST_WORD.slice(0, Math.min(state.letters[seat] ?? 0, MAX_LETTERS));
}

/** Whether a seat has spelled the whole word and is out of the match. */
export function isOut(state: GhostState, seat: number): boolean {
  return (state.letters[seat] ?? 0) >= MAX_LETTERS;
}

/**
 * Which seat opens round `round`.
 *
 * Alternating, rather than the classic "the player after the loser starts",
 * which at two seats means the round's winner opens the next one and opens
 * every one after that if they keep winning. Opening is a real edge in
 * Superghost, since the opener plays into an empty fragment and cannot lose on
 * it, so compounding it onto whoever is already ahead is the wrong direction
 * for a game somebody is meant to learn from.
 */
export function openerOf(round: number): number {
  return round % 2;
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is only sometimes strictly alternating and the contract has to say which. In
 * setup both seats choose at once, and on a reveal either of them may press
 * Next, so two seats can act; on the fragment itself exactly one can. `turn`
 * reports a single seat throughout, which is why it is a hint for the status
 * line and not the thing a control is gated on.
 */
export function canAct(state: GhostState, seat: number): boolean {
  if (seat < 0 || seat >= state.letters.length) return false;
  switch (state.phase) {
    case 'setup':
    case 'round':
      return true;
    case 'playing':
      return state.at === seat;
    case 'over':
      return false;
  }
}

/** The fragment with a letter added, which is the whole of Superghost's rule. */
export function grown(fragment: string, side: GhostSide, letter: string): string {
  return side === 'start' ? letter + fragment : fragment + letter;
}
