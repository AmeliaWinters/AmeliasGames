/**
 * Reading a profile written by an older build.
 *
 * Its own file because it is the one part of this module that is about the
 * past rather than the present, it grows by a rung every time the shape moves,
 * and it is the code most worth reading in isolation when something has come
 * back wrong.
 *
 * **Never returns null.** A profile that cannot be read is still somebody's
 * vocabulary, so the worst case here is a shape repaired conservatively, not a
 * shape deleted. That is the whole difference between this and
 * `RoomEngine.restore`.
 */
import { LEARN_LANGS, PROFILE_VERSION } from './profileShapes.js';
import type { Known, LearnLang, Profile } from './profileShapes.js';
import { newProfile, tallyShape, xpShape } from './profileQueries.js';

/**
 * One stored word row, brought up to the current shape. See `PROFILE_VERSION`.
 *
 * A version 1 or 2 row has no `run` and no `learnedAt`, and **neither is
 * recoverable**. The row knows `got` and `missed` as lifetime totals with no
 * order between them, so a player who answered right ten times and wrong ten
 * times is indistinguishable from one on a run of ten, and filling `run` from
 * `got` would hand the second player's badge to the first. The whole value of
 * the Vocabulary screen is that its claim is true.
 *
 * So every existing row starts from zero and earns its way up from the next
 * answer, which costs a long-standing player some weeks of re-proving words
 * they do know. That is the price of the list meaning something, and it is
 * paid once.
 */
function wordShape(raw: Partial<Known> | null | undefined): Known {
  const row = (raw ?? {}) as Partial<Known>;
  return {
    lang: (LEARN_LANGS as readonly string[]).includes(String(row.lang)) ? (row.lang as LearnLang) : 'en',
    key: String(row.key ?? ''),
    word: String(row.word ?? ''),
    script: String(row.script ?? ''),
    lemma: String(row.lemma ?? ''),
    gloss: String(row.gloss ?? ''),
    rank: Number(row.rank) || 0,
    seen: Number(row.seen) || 0,
    got: Number(row.got) || 0,
    missed: Number(row.missed) || 0,
    lastAt: Number(row.lastAt) || 0,
    dueAt: Number(row.dueAt) || 0,
    box: Number(row.box) || 0,
    fastestMs: Number(row.fastestMs) || 0,
    run: Number(row.run) || 0,
    learnedAt: Number(row.learnedAt) || 0,
  };
}

/**
 * Bring a stored profile up to the current shape.
 *
 * One rung per version, each doing exactly one step, applied in order from
 * whatever the stored version says. **Never returns null.** A profile that
 * cannot be read is still somebody's vocabulary, so the worst case here is a
 * shape that has been repaired conservatively, not a shape that has been
 * deleted. That is the whole difference between this and `RoomEngine.restore`.
 *
 * Unknown or missing fields are filled from `newProfile`, so a profile written
 * by a *newer* build (a player who used a second device before this one was
 * redeployed) loses nothing it does not have to: the fields this build does not
 * know about ride along untouched.
 */
export function migrate(stored: unknown, now: number): Profile {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Profile>;
  const storedVersion = Number(raw.version) || 1;
  const base = newProfile(String(raw.id ?? ''), String(raw.name ?? ''), Number(raw.createdAt) || now);
  const words = Array.isArray(raw.words) ? raw.words.map(wordShape) : [];

  const profile: Profile = {
    ...base,
    ...raw,
    // Spread first, then repair: the fields below are the ones an older or
    // damaged profile can be missing outright, and a `.reduce` over undefined
    // is a crash on the read path of the one object that must never fail to
    // load.
    id: base.id,
    name: base.name,
    createdAt: base.createdAt,
    words,
    // After `words`, because a version 1 or 2 profile stores one pooled number
    // and the only way to split it is by counting the rows. See `splitXp`.
    xp: xpShape(raw.xp, words),
    streak: {
      days: Number(raw.streak?.days) || 0,
      lastDay: Number(raw.streak?.lastDay) || 0,
      rests: Number(raw.streak?.rests) || 0,
    },
    games: Array.isArray(raw.games) ? raw.games.map(tallyShape) : [],
    applied: Array.isArray(raw.applied) ? raw.applied.filter((id) => typeof id === 'string') : [],
    owned: Array.isArray(raw.owned) ? raw.owned.filter((id) => typeof id === 'string') : [],
    points: Math.max(0, Number(raw.points) || 0),
    playedDay: Math.max(0, Number(raw.playedDay) || 0),
    spent: Math.max(0, Number(raw.spent) || 0),
    opens: Array.isArray(raw.opens) ? raw.opens.filter((id) => typeof id === 'string') : [],
    claimed: Array.isArray(raw.claimed) ? raw.claimed.filter((id) => typeof id === 'string') : [],
    // Filled below rather than here, because it is repaired against `claimed`
    // and not merely type-checked. The subset rule is an invariant of the
    // shape rather than of the one route that writes it, and a profile
    // hand-edited to show a character it never rolled is exactly the case the
    // read path is cheapest at making true again.
    showcase: [],
    version: PROFILE_VERSION,
  };

  // Rungs go here as the shape changes, keyed off `raw.version`. Version 2's
  // is `tallyShape` above and version 3's is `wordShape` and `xpShape`, all
  // three applied unconditionally rather than under a version check: they are
  // idempotent, and a tally missing `lost` is exactly as broken whether the
  // profile claims to be version 1 or has simply been hand-edited.
  //
  // Version 4's rung is the first that **cannot** be idempotent, because it
  // After the spread, so it can read the repaired `claimed`. Capping is
  // deliberately not done here: `SHOWCASE_MAX` lives in `waifu.ts`, this
  // module imports nothing, and a subset of `claimed` is already the half that
  // matters for correctness. The route that writes it does the capping, and
  // `profile.test.ts` holds the two together.
  const held = new Set(profile.claimed);
  for (const id of Array.isArray(raw.showcase) ? raw.showcase : []) {
    if (typeof id === 'string' && held.has(id) && !profile.showcase.includes(id)) {
      profile.showcase.push(id);
    }
  }

  // Version 6 has no rung, and the absence is the decision rather than an
  // oversight. Version 4's rung minted `credits` and charged nothing for them,
  // so the experience they were computed from is still sitting in `xp`
  // untouched: dropping the field above is the whole migration, and it leaves
  // every account with exactly the opens its balance says it has. See
  // `PROFILE_VERSION`.
  //
  // Version 7's rung: the purse stops being the non-English experience total
  // and becomes a field. Seeded from what the old rule said the account held,
  // so nobody's balance falls on the deploy -- and only for a profile stored
  // *before* the split, because after it `points` is authoritative and a
  // second seeding would pay for the same Polish twice. Hence the version
  // check: this is the second rung that cannot be idempotent.
  if (storedVersion < 7) {
    profile.points = LEARN_LANGS.reduce((n, lang) => (lang === 'en' ? n : n + (profile.xp[lang] || 0)), 0);
  }

  // The one exception to the ride-along rule above, and it is deliberate. That
  // rule is for fields *this build does not know about*, so a profile written
  // by a newer one survives a round trip through this one. `credits` is the
  // opposite case: a field this build knows and has removed. Leaving a
  // currency-shaped number sitting in storage that nothing charges against is
  // how it gets wired back up by somebody who finds it and assumes it means
  // something. See `PROFILE_VERSION`.
  delete (profile as { credits?: number }).credits;

  return profile;
}
