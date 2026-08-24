import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import { chainLookup } from './chainDictionary.js';
import { vocabQuestion } from './vocabDictionary.js';
import type { VocabQuestion } from './vocabDictionary.js';
import {
  DECK_DEPTH,
  HOST,
  MODE_CAP,
  REVEAL_MS,
  ROUND_MS,
  SETUP_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_MODES,
  canAct,
  isFinished,
  leaders,
} from './vocabDisplay.js';

import type {
  VocabLang,
  VocabMode,
  VocabMove,
  VocabRound,
  VocabState,
} from './vocabDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file and the dictionary ever reach the word lists.
export {
  DECK_DEPTH,
  HOST,
  MODE_CAP,
  MODE_NAME,
  REVEAL_MS,
  ROUND_MS,
  SETUP_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_MODES,
  canAct,
  clockCall,
  formatClock,
  isFinished,
  leadScore,
  leaders,
  msLeftFor,
  outOfTime,
  vocabStats,
} from './vocabDisplay.js';
export type {
  VocabAnswer,
  VocabLang,
  VocabMode,
  VocabMove,
  VocabPhase,
  VocabRound,
  VocabSeatStat,
  VocabState,
  VocabStats,
} from './vocabDisplay.js';

/**
 * Learn Polish or Japanese by racing for it: everyone is shown what a word
 * means and the first to type the word takes the point. Five points wins.
 *
 * The vocabulary is Word Chain's, read from the other side. Those lists are
 * ordered commonest first and carry an English gloss on every Polish and
 * Japanese entry, which is already a deck of flashcards — so "the top hundred
 * words" and "the top thousand" are a slice rather than a new corpus, and this
 * game cost the bundle nothing. `vocabDictionary.ts` is where a gloss becomes
 * a clue.
 *
 * Six things here are worth knowing before changing anything:
 *
 * 1. **One language and one difficulty for the whole room**, chosen by the
 *    seat that opened it. Per-player languages were the obvious design and
 *    they do not survive a shared clue: a clue has to be answerable by
 *    everybody racing for it, and Polish's top hundred and Japanese's top
 *    hundred overlap in *fourteen* meanings — all of them function words. Two
 *    players learning different languages are not in the same race, so the
 *    room picks one.
 *
 * 2. **A wrong answer costs you the round; a word nobody has heard of costs
 *    you nothing.** Those are different mistakes. Typing a real word with the
 *    wrong meaning is a guess, and a race where guessing is free is won by
 *    whoever types fastest rather than by whoever knows the word. Typing
 *    something the list has simply never heard of is usually a typo, or a real
 *    word from outside a subtitle corpus, and ending someone's round for that
 *    would be the dictionary playing rather than the player. See `guess`.
 *
 * 3. **What counts as right is generous, and deliberately wider than the clue
 *    it was cut from.** The clue for `mały` is "small", and a player who
 *    answers with a different Polish word meaning small has answered the
 *    question — `accepts` in the dictionary is every word in the language
 *    filed under any of the clue's senses. The alternative marks a learner
 *    wrong for knowing a synonym, which is the single most discouraging thing
 *    a language game can do.
 *
 * 4. **Accents and romaji spellings are optional**, because `chainLookup` does
 *    the finding: `zolty` reaches **żółty** and `kohii` reaches `koohii`. The
 *    board shows the canonical spelling back, which is the moment the spelling
 *    is taught rather than demanded — and the round records what was actually
 *    typed, so the review can show both.
 *
 * 5. **The reveal is a phase, not a line of text.** Being beaten to a word is
 *    the moment it sticks, and a round that rolled straight into the next clue
 *    would spend that moment showing you something else to read. It is also
 *    the only phase where nobody may act.
 *
 * 6. **The deck is dealt once, at setup, before the language is known.**
 *    `setup` and `applyMove` are the only places this game is handed an rng,
 *    and the round-to-round progression runs through `expire`, which is not.
 *    So `setup` shuffles the ranks 1…1000 and every later draw is a filter
 *    over that fixed order — deterministic, and decidable by a clock with no
 *    randomness anywhere near it. `view()` redacts the deck, because a client
 *    holding it beside a copy of the word list would know every answer before
 *    it was asked.
 */

const seatCount = (state: VocabState): number => state.scores.length;

/** A shuffled run of the ranks a game may ask about. See point 6 above. */
function deal(rng: Rng): number[] {
  const deck = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function roundFrom(question: VocabQuestion): VocabRound {
  return {
    clue: question.clue,
    answer: {
      word: question.word,
      script: question.script,
      lemma: question.lemma,
      rank: question.rank,
    },
    winner: null,
    said: '',
    ms: 0,
    missed: [],
  };
}

/**
 * The next clue this game can ask, reading forward from `drawn`.
 *
 * Three things can disqualify a rank and none of them is an error: it may sit
 * deeper than the difficulty allows, the word there may have no printable
 * gloss (about one in fifteen — see `vocabQuestion`), or its clue may be one
 * this game has already asked. The last is the only one that needs saying:
 * Polish files a lemma and its inflections separately and they are often
 * glossed identically, so without it a game could ask "to have" twice and mark
 * the same answer wrong the second time for being already used. Clues are
 * compared rather than words, because the clue is the thing a player sees.
 *
 * Null means the deck is spent, which ends the game — see `advance`.
 */
function draw(state: VocabState, lang: VocabLang, mode: VocabMode): { round: VocabRound; drawn: number } | null {
  const cap = MODE_CAP[mode];
  const asked = new Set(state.history.map((round) => round.clue));
  if (state.round) asked.add(state.round.clue);
  for (let i = state.drawn; i < state.deck.length; i++) {
    const rank = state.deck[i];
    if (rank > cap) continue;
    const question = vocabQuestion(lang, rank);
    if (question === null || asked.has(question.clue)) continue;
    return { round: roundFrom(question), drawn: i + 1 };
  }
  return null;
}

/**
 * Settle the game, naming a winner only where there is one.
 *
 * A shared lead leaves `winner` null, which is the honest answer and the one
 * the copy is written for. It can only happen when a game runs out of deck —
 * reaching `TARGET` is reaching it first, and one round hands out one point —
 * so it is a rare ending and not one worth inventing a tie-break for.
 */
function finish(state: VocabState): VocabState {
  const best = leaders(state);
  return {
    ...state,
    phase: 'over',
    deadline: null,
    winner: best.length === 1 ? best[0] : null,
  };
}

/**
 * Put the settled round away and deal the next one, or end the game.
 *
 * The two endings are checked in this order on purpose: somebody reaching five
 * ends the game even if the deck still has clues in it, and a spent deck ends
 * it even though nobody got there. Both come through `finish`, so the winner
 * is decided the same way either way.
 */
function advance(state: VocabState, now: number): VocabState {
  const put: VocabState = state.round === null
    ? state
    : { ...state, history: [...state.history, state.round], round: null };

  if (put.lang === null) return finish(put);
  if (put.scores.some((score) => score >= TARGET)) return finish(put);

  const next = draw(put, put.lang, put.mode);
  if (next === null) return finish(put);

  return {
    ...put,
    phase: 'asking',
    round: next.round,
    drawn: next.drawn,
    deadline: now + ROUND_MS,
  };
}

/**
 * Close the round on the table and hold the answer up.
 *
 * `winner` is null when the clock beat everybody, which is the round worth
 * having: nobody at the table knew the word, and it is about to be on the
 * screen for six seconds with its meaning under it.
 */
function settle(state: VocabState, round: VocabRound, now: number): VocabState {
  const scores = state.scores.slice();
  if (round.winner !== null) scores[round.winner] += 1;
  return { ...state, phase: 'reveal', round, scores, deadline: now + REVEAL_MS };
}

/**
 * How long the seat on the clock has taken, as of `now`.
 *
 * Read back out of the deadline rather than kept as a start time, because the
 * deadline is the thing the whole game already agrees on — the board counts
 * down to it and `expire` fires on it — and a second field recording when the
 * round began could drift from it.
 *
 * Clamped at both ends. `now` is the server's, but a restored room or a
 * missing clock can hand this arithmetic a number from anywhere, and a round
 * answered in minus four seconds would poison the mean it feeds.
 */
function tookUntil(state: VocabState, now: number): number {
  if (state.deadline === null) return 0;
  return Math.min(ROUND_MS, Math.max(0, ROUND_MS - (state.deadline - now)));
}

/** Deal the first clue, with the settings the host chose. */
function beginPlay(state: VocabState, lang: VocabLang, mode: VocabMode, now: number): VocabState {
  return advance({ ...state, lang, mode }, now);
}

function isLang(value: unknown): value is VocabLang {
  return typeof value === 'string' && (VOCAB_LANGS as readonly string[]).includes(value);
}

function isMode(value: unknown): value is VocabMode {
  return typeof value === 'string' && (VOCAB_MODES as readonly string[]).includes(value);
}

export const vocab: GameDefinition<VocabState, VocabMove> = {
  ...GAME_MANIFEST.vocab,

  setup(playerCount, rng): VocabState {
    return {
      phase: 'setup',
      // Null rather than a default, so the board can tell "has not chosen" from
      // "chose Polish" and say so on a screen up to eight people are reading.
      lang: null,
      mode: 'normal',
      scores: Array(playerCount).fill(0),
      round: null,
      history: [],
      // Dealt here because here is where the rng is — see point 6 above.
      deck: deal(rng),
      drawn: 0,
      // Null until the room says every seat is filled — see `start`.
      deadline: null,
      winner: null,
    };
  },

  start(state, now) {
    if (state.phase !== 'setup' || state.deadline !== null) return null;
    return { ...state, deadline: now + SETUP_MS };
  },

  deadline(state) {
    return state.deadline;
  },

  applyMove(state, move, seat, _rng: Rng, now): MoveResult<VocabState> {
    const at = now ?? 0;
    if (!canAct(state, seat, now)) return { ok: false, error: 'Not your move.' };

    if (move.type === 'settings') {
      if (!isLang(move.lang)) {
        return { ok: false, error: `${named(move.lang)} is not one of the languages.` };
      }
      if (!isMode(move.mode)) {
        return { ok: false, error: `${named(move.mode)} is not one of the difficulties.` };
      }
      return { ok: true, state: { ...state, lang: move.lang, mode: move.mode } };
    }

    if (move.type === 'begin') {
      // `canAct` has already established this is the host during setup; all
      // that is left is whether they have chosen. No default here, unlike
      // `expire` — a host who is present and pressing buttons should be told
      // what is missing rather than handed a language they did not pick.
      if (state.lang === null) return { ok: false, error: 'Choose a language first.' };
      return { ok: true, state: beginPlay(state, state.lang, state.mode, at) };
    }

    if (move.type !== 'guess') return { ok: false, error: 'No such move.' };

    const { lang, round } = state;
    // Both are guaranteed by `canAct` — it only lets a guess through during
    // `asking`, which cannot be reached without a language or a round. Checked
    // anyway, because the alternative is two non-null assertions holding up a
    // rule that lives in another file.
    if (lang === null || round === null) return { ok: false, error: 'No clue on the table.' };

    const typed = move.word.trim();
    if (typed === '') return { ok: false, error: 'Type a word.' };

    const entry = chainLookup(lang, typed);
    // Not a miss. This is the refusal a player is most likely to think is
    // wrong — the lists hold common words only — and it is far more often a
    // typo than a guess. Naming the language is what makes it arguable rather
    // than baffling. See point 2 above.
    if (!entry) {
      return {
        ok: false,
        error: `${named(typed)} is not in the ${VOCAB_LANG_NAME[lang]} list.`,
      };
    }

    const question = vocabQuestion(lang, round.answer?.rank ?? 0);
    if (question === null) return { ok: false, error: 'No clue on the table.' };

    if (!question.accepts.has(entry.key)) {
      // A real word, and the wrong one: the round is over for this seat. The
      // word they reached for goes nowhere — showing it to the table would
      // hand everyone else a free elimination.
      return {
        ok: true,
        state: { ...state, round: { ...round, missed: [...round.missed, seat] } },
      };
    }

    return {
      ok: true,
      state: settle(
        state,
        { ...round, winner: seat, said: entry.word, ms: tookUntil(state, at) },
        at,
      ),
    };
  },

  /**
   * Drive the clock: start the game the host abandoned, close a round nobody
   * answered, and turn a reveal into the next clue.
   *
   * This game leans on `expire` harder than any other here. It is not only how
   * a round ends, it is how the next one *begins* — the reveal has to finish by
   * itself, with nobody pressing anything — so the game only keeps moving
   * because both adapters re-arm on `deadline()` after every tick. That is
   * already how they work, and `vocab.test.ts` walks a whole game through
   * nothing but `tick` to hold it.
   *
   * One transition per call, and every new deadline is measured from `now`
   * rather than from the one that was missed. The difference only shows up in a
   * room that was woken late — an alarm that slipped, a dev server that was
   * asleep — and it is the difference between coming back to a fresh clue and
   * coming back to find the game has silently burned nine words nobody was
   * there to see. This is a game for learning vocabulary; spending it while the
   * room is empty is the one thing it must not do.
   *
   * Setup is the one phase where running out of time costs nobody anything: an
   * undecided host gets Polish on normal and the game deals, because a player
   * who wandered off before choosing should not strand seven other people on a
   * menu, and a room stuck forever is worse than a language somebody did not
   * pick.
   */
  expire(state, now) {
    if (state.deadline === null || now < state.deadline) return null;

    if (state.phase === 'setup') {
      return beginPlay(state, state.lang ?? 'pl', state.mode, now);
    }
    if (state.phase === 'asking') {
      // Whatever is left of the round is the record of it: nobody won, and
      // `missed` already names everyone who tried.
      return state.round === null ? finish(state) : settle(state, state.round, now);
    }
    if (state.phase === 'reveal') return advance(state, now);
    return null;
  },

  /**
   * A hint for the status line, and nothing more.
   *
   * There is no such thing as whose turn it is here — every seat still in a
   * round may act at once, which is what a race is. So this answers the
   * nearest useful question instead: during setup it names the host, who
   * genuinely is the one seat holding things up, and during play it names
   * whoever is furthest behind, which is the only seat the game could be said
   * to be waiting on. `canAct` is the question every control means.
   */
  turn(state) {
    if (state.phase === 'over') return null;
    if (state.phase === 'setup') return HOST;
    let trailing = 0;
    for (let seat = 1; seat < seatCount(state); seat++) {
      if (state.scores[seat] < state.scores[trailing]) trailing = seat;
    }
    return trailing;
  },

  canAct,

  isOver: isFinished,

  /**
   * The one thing the answer must never appear in.
   *
   * `status` is rendered above every board, including during `asking`, so a
   * clue's answer reaching this string would put it on the screen of everyone
   * racing for it. The round's *clue* is fine and is most of what makes the
   * line useful.
   */
  status(state, names) {
    const who = (seat: number): string => names[seat] ?? `Player ${seat + 1}`;

    if (state.phase === 'over') {
      if (state.winner === null) {
        const shared = leaders(state).map(who);
        return `Game over. ${shared.join(' and ')} tie.`;
      }
      return `${who(state.winner)} wins with ${state.scores[state.winner]}.`;
    }

    if (state.phase === 'setup') {
      if (state.lang === null) return `Waiting for ${who(HOST)} to choose a language.`;
      return `${VOCAB_LANG_NAME[state.lang]}, top ${MODE_CAP[state.mode]}. Waiting for ${who(HOST)} to start.`;
    }

    const language = state.lang === null ? '' : VOCAB_LANG_NAME[state.lang];

    if (state.phase === 'reveal') {
      const word = state.round?.answer?.word ?? '';
      return state.round?.winner == null
        ? `Nobody had it: ${word}.`
        : `${who(state.round.winner)} had it: ${word}.`;
    }

    return `First to say the ${language} for “${state.round?.clue ?? ''}”.`;
  },

  /**
   * Two secrets, and they expire at different times.
   *
   * The **deck** is every question the rest of this game will ask, in order.
   * It never goes to a client at all: the word lists are downloadable by
   * anybody, so a deck in devtools is a game already won. Emptied rather than
   * dropped, so the field's type does not change shape on the wire.
   *
   * The **answer** is a secret only while the round is running, and stops
   * being one the moment the round settles — the reveal is the whole point of
   * the game and the history is what the review screen reads. So it is
   * stripped in exactly one phase.
   *
   * Not redacted: `missed`, and everyone's score. Who is out of the round is
   * public and is most of what the tension is made of, and a player watching
   * two opponents fall out is being told something true about how hard the
   * word is rather than something about the word.
   */
  view(state) {
    const round =
      state.phase === 'asking' && state.round !== null
        ? { ...state.round, answer: null }
        : state.round;
    return { ...state, deck: [], round };
  },
};
