/**
 * What a finished game did to the people who played it.
 *
 * The join between two things that must not know about each other: a game's
 * reducer, which knows what happened, and a profile, which knows nothing about
 * games. `GameDefinition.record()` produces one of these and this module
 * folds it into a `Profile`.
 *
 * **Nothing here may reach a reducer.** The rule is the one `wordChainDisplay.ts`
 * states: not "no imports", but nothing on the path to a game. `profile.js` and
 * `review.js` are leaves, so importing them at runtime is free; a game *state*
 * is plain data, so reading one needs no import at all.
 *
 * The temptation to watch for is folding. `Learned.key` is a folded lemma, and
 * the obvious place to fold it looks like right here — but `fold()` lives in
 * `chainDictionary.ts`, eighty thousand lines of word list follow it, and
 * `bundle.test.ts` fails the build over exactly that. So the key arrives
 * **already folded**, from the reducer, which is the last place in the system
 * holding both the dictionary and the play.
 */
import type { LearnLang, Profile, Known, GameTally } from './profile.js';
import type { Grade } from './review.js';
import { APPLIED_MEMORY, bumpStreak } from './profile.js';
import { XP_PER_GAME, XP_PER_WIN, isMiss, isProduction, schedule, xpFor } from './review.js';

/**
 * How a seat finished.
 *
 * `drew` is not a fourth state nobody reaches: Vocab Race leaves `winner` null
 * when a game runs out of deck with the lead shared, and Word Duel had to grow
 * a tie-break to stop having them. A record that could only say won or lost
 * would have to call one of those a loss for everybody.
 */
export type Result = 'won' | 'lost' | 'drew';

/**
 * One word, and what one seat did with it.
 *
 * Everything the ledger stores is on here, because the ledger cannot look
 * anything up — see the note at the top of `profile.ts`. The reducer is the
 * last place in the system that holds both the dictionary and the play, so it
 * is the only place this can be assembled.
 */
export interface Learned {
  lang: LearnLang;
  /**
   * The folded lemma. **Produced by the reducer, never by this module.**
   *
   * It is the row's identity, so a game that folded it differently would file
   * the same word twice. Word Chain and Vocab Race both reach `fold()` in
   * `chainDictionary.ts` for it, which is the one implementation, and neither
   * this file nor the profile is allowed near it.
   */
  key: string;
  /** The form that was actually on the screen: `jestem`, not `być`. */
  word: string;
  script: string;
  lemma: string;
  gloss: string;
  rank: number;
  grade: Grade;
  /** How long the answer took, in ms. Zero where there was no answer. */
  ms: number;
}

export interface SeatOutcome {
  seat: number;
  result: Result;
  /**
   * Every word this seat met, in the order they met them. One word may appear
   * more than once — a long chain can come back to the same lemma — and
   * `applyRecord` folds them in order, so the last event of a game is the one
   * whose schedule stands.
   */
  learned: Learned[];
}

/** What a game hands back about itself. One entry per seat, in seat order. */
export interface GameRecord {
  gameId: string;
  seats: SeatOutcome[];
}

/**
 * The id of one dealt game, for the idempotency check.
 *
 * `run` is a random id the room mints when it is *created*, not the room code,
 * and that distinction is the whole reason this function exists rather than
 * the callers concatenating two strings. Room codes are four letters and get
 * reused: a room `ABCD` played in March and another `ABCD` played in June would
 * both start counting at one, and the June game's results would be silently
 * dropped as a duplicate of March's. A run id makes the key unique to the room
 * that actually produced it.
 *
 * `n` counts the games dealt inside that run, because a rematch is a new game
 * at the same table and has to be paid for separately.
 */
export function harvestKey(run: string, n: number): string {
  return `${run}#${n}`;
}

/** Keep the first thing that actually said something. See `mergeWord`. */
function firstOf(existing: string, arriving: string): string {
  return existing || arriving;
}

/**
 * Fold one word event into the row it belongs to.
 *
 * Four merge rules, and three of them are about not losing information that
 * arrives unevenly:
 *
 * - **`word` is the newest**, because it is "last seen as", and a learner
 *   reading their own ledger wants to know which form they actually played.
 * - **`lemma`, `script` and `gloss` keep the first non-empty value.** They
 *   arrive unevenly by design: `ChainLink.lemma` is empty when the word played
 *   *is* its own lemma, and Japanese carries a script where Polish does not. A
 *   blind overwrite would let a later, plainer sighting erase the dictionary
 *   form the row was named after.
 * - **`rank` keeps the lowest**, which is the commonest. The row is a lemma
 *   and the game reports the rank of whichever form was played, so of the
 *   several ranks a lemma's inflections carry, the commonest is the closest
 *   thing to the lemma's own frequency.
 */
function mergeWord(row: Known, event: Learned): Known {
  return {
    ...row,
    word: event.word || row.word,
    lemma: firstOf(row.lemma, event.lemma),
    script: firstOf(row.script, event.script),
    gloss: firstOf(row.gloss, event.gloss),
    rank: row.rank > 0 && event.rank > 0 ? Math.min(row.rank, event.rank) : row.rank || event.rank,
  };
}

function blankRow(event: Learned, now: number): Known {
  return {
    lang: event.lang,
    key: event.key,
    word: event.word,
    script: event.script,
    lemma: event.lemma,
    gloss: event.gloss,
    rank: event.rank,
    seen: 0,
    got: 0,
    missed: 0,
    lastAt: now,
    dueAt: now,
    box: 0,
    fastestMs: 0,
  };
}

/** One word event, applied. Returns the new row and what it earned. */
function applyGrade(row: Known, event: Learned, now: number): { row: Known; xp: number } {
  const merged = mergeWord(row, event);
  const placement = schedule(merged.box, event.grade, now);

  const next: Known = {
    ...merged,
    seen: merged.seen + 1,
    got: merged.got + (isProduction(event.grade) ? 1 : 0),
    missed: merged.missed + (isMiss(event.grade) ? 1 : 0),
    // A sighting must not move the schedule. `schedule` returns null for it
    // rather than "stays where it is", because an evening of watching an
    // opponent's words would otherwise push every review the player had
    // actually earned out by however long their current rung is.
    lastAt: placement === null ? merged.lastAt : now,
    dueAt: placement?.dueAt ?? merged.dueAt,
    box: placement?.box ?? merged.box,
    fastestMs:
      isProduction(event.grade) && event.ms > 0 && (merged.fastestMs === 0 || event.ms < merged.fastestMs)
        ? event.ms
        : merged.fastestMs,
  };

  // Paid on the rung reached, so the review that comes back after five weeks
  // is worth more than the one that comes back tomorrow. See `xpFor`.
  return { row: next, xp: xpFor(event.grade, next.box) };
}

function bumpTally(games: GameTally[], gameId: string, result: Result, now: number): GameTally[] {
  const found = games.find((game) => game.gameId === gameId);
  const base: GameTally = found ?? { gameId, played: 0, won: 0, drew: 0, lastAt: 0 };
  const next: GameTally = {
    ...base,
    played: base.played + 1,
    won: base.won + (result === 'won' ? 1 : 0),
    drew: base.drew + (result === 'drew' ? 1 : 0),
    lastAt: now,
  };
  return found ? games.map((game) => (game === found ? next : game)) : [...games, next];
}

/**
 * Apply one finished game to one profile. Pure; never mutates its argument.
 *
 * **Idempotent on `key`, and that is not a nicety.** The room hands its results
 * to the player objects and only then writes down that it has, so a crash
 * between the two re-sends the same harvest — deliberately, because
 * at-least-once delivery into a receiver that recognises a repeat is the only
 * exactly-once anybody actually builds. This is the half that recognises it,
 * and without it the commonest failure in the whole system is somebody's XP
 * quietly doubling.
 *
 * A seat with no outcome in the record gets nothing, silently. That is the
 * ordinary case for a guest who has no account and for a room where only one
 * player is signed in.
 */
export function applyRecord(
  profile: Profile,
  record: GameRecord,
  seat: number,
  key: string,
  now: number,
): Profile {
  if (profile.applied.includes(key)) return profile;

  const outcome = record.seats.find((entry) => entry.seat === seat);
  if (!outcome) return profile;

  const words = [...profile.words];
  // An index over the rows, built for the duration of one harvest. Thirty
  // events against a few thousand rows is not worth a different data
  // structure on the persisted object, but it is very much worth not being
  // quadratic here: a long Word Chain plus its reveals is a hundred events.
  const at = new Map<string, number>();
  words.forEach((row, i) => at.set(`${row.lang}:${row.key}`, i));

  let earned = 0;
  let reviewed = false;

  for (const event of outcome.learned) {
    if (!event.key) continue;
    const id = `${event.lang}:${event.key}`;
    const found = at.get(id);

    if (found === undefined) {
      // A word only watched go past never creates a row. Counting every word
      // an opponent said as a word you have met would inflate every number on
      // the profile, and the profile's only job is to be worth trusting.
      if (event.grade === 'seen') continue;
      const { row, xp } = applyGrade(blankRow(event, now), event, now);
      at.set(id, words.length);
      words.push(row);
      earned += xp;
      reviewed = true;
      continue;
    }

    const { row, xp } = applyGrade(words[found], event, now);
    words[found] = row;
    earned += xp;
    if (event.grade !== 'seen') reviewed = true;
  }

  return {
    ...profile,
    xp: profile.xp + earned + XP_PER_GAME + (outcome.result === 'won' ? XP_PER_WIN : 0),
    // A day counts when a word was actually graded. Finishing a game of
    // Connect Four is not a day of study and must not hold a streak up, or the
    // streak stops being a claim about learning anything.
    streak: reviewed ? bumpStreak(profile.streak, now) : profile.streak,
    games: bumpTally(profile.games, record.gameId, outcome.result, now),
    words,
    applied: [...profile.applied, key].slice(-APPLIED_MEMORY),
  };
}
