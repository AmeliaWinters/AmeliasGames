import type { GameDefinition, MoveResult } from '../types.js';
import type { GameRecord, Learned, SeatOutcome } from '../harvest.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import { fold } from './chainDictionary.js';
import {
  ghostAlive,
  ghostCommonest,
  ghostLeft,
  ghostOuts,
  ghostWord,
} from './ghostDictionary.js';
import {
  GHOST_LANGS,
  MAX_LETTERS,
  canAct,
  ghostAlphabet,
  grown,
  isFinished,
  openerOf,
  spelled,
} from './ghostDisplay.js';
import type {
  GhostLang,
  GhostMove,
  GhostReveal,
  GhostSide,
  GhostState,
} from './ghostDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file and its dictionary ever reach the word lists.
export {
  GHOST_KEY_ROWS,
  GHOST_LANGS,
  GHOST_LANG_NAME,
  GHOST_LANG_NATIVE,
  GHOST_SIDES,
  GHOST_WORD,
  MAX_LETTERS,
  MIN_WORD,
  canAct,
  ghostAlphabet,
  grown,
  isFinished,
  isOut,
  openerOf,
  revealNow,
  spelled,
} from './ghostDisplay.js';
export type {
  GhostLang,
  GhostMove,
  GhostOut,
  GhostPhase,
  GhostReveal,
  GhostSide,
  GhostState,
} from './ghostDisplay.js';

/**
 * Superghost: add a letter to either end of a fragment, and do not be the one
 * who finishes a word.
 *
 * Two rules, and between them there is nothing to do on your turn except hand
 * the other player a worse position than the one you were given. A letter is
 * legal if the fragment it makes is still inside some real word of four letters
 * or more, and it loses the round if it is not, or if it has just made one.
 *
 * Five things worth knowing before changing anything here.
 *
 * 1. **A losing letter is played, not refused.** This is the rule that decides
 *    the shape of the whole game, and it is the one place where the obvious
 *    reading is wrong. Refusing a dead letter with "no word contains that"
 *    would make the game unlosable and hand the player the dictionary a
 *    keystroke at a time: they could sit there trying letters until one was
 *    accepted. So `applyMove` takes any letter on the keyboard, applies it, and
 *    then ends the round against whoever played it. Bluffing exists because of
 *    this and nothing else: you can play a letter with no word behind it and
 *    find out along with everybody else.
 *
 * 2. **Which means almost nothing here is a refusal.** The only `ok: false`
 *    answers are structural (wrong seat, wrong phase, a letter that is not on
 *    the keyboard). Nothing about the position is ever refused, and a board
 *    must never grey a key out.
 *
 * 3. **Both ends, and the fragment is a substring.** Ghost proper appends, so a
 *    fragment is a prefix and a trie answers everything. Superghost grows at
 *    either end, so the fragment is a substring, which is a different index and
 *    a different game: the stem you are building around can arrive letter by
 *    letter from both sides. It is also why this is the variant worth having in
 *    Polish, where the interesting morphology is the ending and a front-only
 *    game locks you out of the stem before you reach it.
 *
 * 4. **The reveal is the point.** Losing a round is the one moment a player is
 *    guaranteed to read a definition, so the reveal carries the word, its
 *    dictionary form, its meaning, how common it is, and the letters that would
 *    have saved them. See `GhostReveal`. `record()` files all of it, so a
 *    Superghost match feeds the same ledger Word Chain and Vocab Race do.
 *
 * 5. **Nobody is on a clock.** Untimed, unlike the other two language games,
 *    because the thinking here is the game rather than a tax on it: the whole
 *    move is deciding whether the position you are about to hand over is worse
 *    than the one you are in. A stalling opponent is a social problem and the
 *    give-up move is the answer to it.
 */

const SIDES: readonly GhostSide[] = ['start', 'end'];

function fresh(lang: GhostLang, round: number, letters: number[], reveals: GhostReveal[]): GhostState {
  return {
    phase: 'playing',
    lang,
    fragment: '',
    letters,
    round,
    at: openerOf(round),
    left: ghostLeft(lang, ''),
    reveals,
    loser: null,
  };
}

/**
 * The state a round loss leaves behind: a letter of GHOST on the loser, the
 * reveal on the table, and the match over if that was their fifth.
 *
 * One function for all three ways of losing, because the three differ only in
 * what the reveal says. Having the scoring in one place is what stops a
 * give-up and a dead end paying differently by accident.
 */
function lost(state: GhostState, reveal: GhostReveal): GhostState {
  const letters = state.letters.slice();
  letters[reveal.seat] = (letters[reveal.seat] ?? 0) + 1;
  const out = letters[reveal.seat] >= MAX_LETTERS;
  return {
    ...state,
    phase: out ? 'over' : 'round',
    fragment: reveal.fragment,
    letters,
    left: ghostLeft(state.lang, reveal.fragment),
    reveals: [...state.reveals, reveal],
    loser: out ? reveal.seat : null,
  };
}

/**
 * What the loser is shown, for the two reasons that are the same reason: they
 * were in a position and threw it away.
 *
 * The word comes from the position *before* the losing letter, because that is
 * the position they were actually in. Reading it off the dead fragment would
 * answer nothing, there being no word containing it, which is what made it
 * dead.
 */
function missed(
  lang: GhostLang,
  from: string,
  fragment: string,
  seat: number,
  reason: 'dead-end' | 'gave-up',
  played: GhostReveal['played'],
): GhostReveal {
  const entry = ghostCommonest(lang, from);
  return {
    seat,
    reason,
    fragment,
    played,
    word: entry?.word ?? '',
    gloss: entry?.gloss ?? '',
    lemma: entry?.lemma ?? '',
    rank: entry?.rank ?? 0,
    outs: ghostOuts(lang, from),
  };
}

export const ghost: GameDefinition<GhostState, GhostMove> = {
  id: GAME_MANIFEST.ghost.id,
  name: GAME_MANIFEST.ghost.name,
  minPlayers: GAME_MANIFEST.ghost.minPlayers,
  maxPlayers: GAME_MANIFEST.ghost.maxPlayers,

  // No rng: there is nothing random in this game, the position being whatever
  // the two of them have built.
  setup(playerCount): GhostState {
    return {
      phase: 'setup',
      // Polish rather than English, because this app is a Polish course with
      // games on it. Set rather than null so that a table who do not care can
      // press Start and be playing, and either seat can change it first.
      lang: 'pl',
      fragment: '',
      letters: Array<number>(playerCount).fill(0),
      round: 0,
      at: 0,
      left: 0,
      reveals: [],
      loser: null,
    };
  },

  applyMove(state, move, seat): MoveResult<GhostState> {
    if (isFinished(state)) return { ok: false, error: 'The game is already over.' };
    if (!move || typeof move !== 'object') return { ok: false, error: 'Unknown move.' };
    if (!canAct(state, seat)) return { ok: false, error: "It's not your turn." };

    switch (move.type) {
      case 'lang': {
        if (state.phase !== 'setup') {
          return { ok: false, error: 'The language is settled once the game starts.' };
        }
        if (!GHOST_LANGS.includes(move.lang)) {
          return { ok: false, error: `There is no ${named(move.lang)} list.` };
        }
        return { ok: true, state: { ...state, lang: move.lang } };
      }

      case 'begin': {
        if (state.phase !== 'setup') return { ok: false, error: 'Already started.' };
        return { ok: true, state: fresh(state.lang, 0, state.letters, state.reveals) };
      }

      case 'next': {
        if (state.phase !== 'round') return { ok: false, error: 'No round to leave.' };
        return {
          ok: true,
          state: fresh(state.lang, state.round + 1, state.letters, state.reveals),
        };
      }

      case 'give-up': {
        if (state.phase !== 'playing') return { ok: false, error: 'No round to give up.' };
        return {
          ok: true,
          state: lost(
            state,
            missed(state.lang, state.fragment, state.fragment, seat, 'gave-up', null),
          ),
        };
      }

      case 'play': {
        if (state.phase !== 'playing') return { ok: false, error: 'No round to play into.' };
        if (!SIDES.includes(move.side)) {
          return { ok: false, error: `There is no ${named(move.side)} of the fragment.` };
        }
        // Case-folded rather than refused, because a board that sends `A` and a
        // board that sends `a` are both saying the same thing and only one of
        // them is this one.
        const letter = String(move.letter ?? '').toLowerCase();
        if (!ghostAlphabet(state.lang).includes(letter) || [...letter].length !== 1) {
          // The only unreachable branch on this move: every letter a player can
          // tap is on the keyboard the server chose. Only a client sending its
          // own strings gets here, so the string it sent is the useful thing to
          // say back.
          return { ok: false, error: `${named(move.letter)} is not a letter you can play.` };
        }

        const played = { side: move.side, letter };
        const next = grown(state.fragment, move.side, letter);

        // Order matters, and only in one direction: a completed word is by
        // definition still inside a word (its own), so asking whether it is
        // alive first would never end a round on the rule players actually
        // recognise.
        const finished = ghostWord(state.lang, next);
        if (finished) {
          return {
            ok: true,
            state: lost(state, {
              seat,
              reason: 'completed',
              fragment: next,
              played,
              word: finished.word,
              gloss: finished.gloss,
              lemma: finished.lemma,
              rank: finished.rank,
              // The question does not arise: they had somewhere to go and went
              // somewhere else. `outs` from here would list the moves that were
              // available instead, which reads as a reproach rather than a
              // lesson.
              outs: [],
            }),
          };
        }

        if (!ghostAlive(state.lang, next)) {
          return {
            ok: true,
            state: lost(
              state,
              missed(state.lang, state.fragment, next, seat, 'dead-end', played),
            ),
          };
        }

        return {
          ok: true,
          state: {
            ...state,
            fragment: next,
            at: seat === 0 ? 1 : 0,
            left: ghostLeft(state.lang, next),
          },
        };
      }

      default:
        return { ok: false, error: 'Unknown move.' };
    }
  },

  turn(state) {
    return state.phase === 'playing' ? state.at : null;
  },

  canAct,

  isOver: isFinished,

  winner(state) {
    if (state.loser === null) return null;
    return state.loser === 0 ? 1 : 0;
  },

  status(state, names) {
    const nameFor = (at: number) => names[at] ?? `Player ${at + 1}`;
    switch (state.phase) {
      case 'setup':
        return 'Pick a language and start.';
      case 'playing':
        return state.fragment
          ? `${nameFor(state.at)} is on ${state.fragment.toUpperCase()}`
          : `${nameFor(state.at)} opens round ${state.round + 1}`;
      case 'round': {
        const last = state.reveals[state.reveals.length - 1];
        if (!last) return `Round ${state.round + 1}`;
        return `${nameFor(last.seat)} has ${spelled(state, last.seat)}`;
      }
      case 'over':
        return state.loser === null
          ? 'Over.'
          : `${nameFor(state.loser)} spelled GHOST. ${nameFor(state.loser === 0 ? 1 : 0)} wins`;
    }
  },

  /**
   * Every word either of them was shown, filed against both.
   *
   * `shown` for the player who lost the round and `seen` for the other, which
   * is the same pair Word Chain uses for its reveals and for the same reason:
   * both players read the same end-of-round screen, and only one of them had
   * just failed to find anything on it. A completed word is filed as `shown`
   * too, which is not a slip: finishing a word by accident is exactly the case
   * where somebody has met a word without producing it on purpose.
   *
   * The key is the folded **lemma** where Polish knows one, so six inflections
   * of one verb are one row in a profile rather than six. `fold` lives in
   * `chainDictionary.ts` with eighty thousand lines of word list behind it and
   * the ledger may never reach either, which is why this is assembled here.
   * See `linkLearned` in `wordChain.ts`, the other half of the same rule.
   */
  record(state, seats): GameRecord {
    const outcomes: SeatOutcome[] = [];
    for (let seat = 0; seat < seats; seat++) {
      const learned: Learned[] = state.reveals.flatMap((reveal): Learned[] =>
        reveal.word === ''
          ? []
          : [
              {
                lang: state.lang,
                key: fold(reveal.lemma || reveal.word),
                word: reveal.word,
                script: '',
                lemma: reveal.lemma,
                gloss: reveal.gloss,
                rank: reveal.rank,
                grade: reveal.seat === seat ? 'shown' : 'seen',
                // Nobody was on a clock, so there is no answer time to report.
                ms: 0,
              },
            ],
      );
      outcomes.push({
        seat,
        result: state.loser === null ? 'drew' : state.loser === seat ? 'lost' : 'won',
        learned,
      });
    }
    return { gameId: ghost.id, seats: outcomes };
  },
};
