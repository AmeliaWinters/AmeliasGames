/**
 * What a player carries between games, as shapes.
 *
 * Split off `profile.ts` for size, and it inherits that file's one rule
 * unchanged: **this module imports nothing.** The client draws the profile
 * screen and has no dictionary, so every word on this object arrives carrying
 * its own gloss, script and rank. One convenience import here of anything that
 * reaches `chainWords.ts` puts sixty thousand Polish inflections on the phone
 * of everybody who opens the lobby, and `bundle.test.ts` builds the real bundle
 * and greps it.
 *
 * Dull on purpose: arrays and numbers, no Maps, no Sets, nothing that does not
 * survive `JSON.parse`. Two adapters persist it very differently and a player
 * can export it to a file they keep.
 *
 * Re-exported from `profile.ts`; import from there.
 */

/**
 * Bumped whenever the persisted shape changes. **It is not `SNAPSHOT_VERSION`
 * and must never be treated like it.**
 *
 * A room snapshot from an older version is *discarded*: `RoomEngine.restore`
 * returns null and the adapter deletes it, which is exactly right, because the
 * thing being thrown away is one game of Yahtzee that nobody was playing any
 * more. Copy those four lines onto a profile and the deploy that adds a field
 * silently deletes a year of somebody's Polish.
 *
 * So a profile is **migrated forward, never discarded**. `migrate` below is a
 * ladder of one step per version and it runs on every read. Adding a version
 * means adding a rung and a fixture; `profile.test.ts` walks a stored profile
 * from every historical version to the current one and fails if a rung is
 * missing.
 *
 * 1: the first shape.
 * 2: `GameTally` grew `lost` and `last`, so the games panel can show a record
 *    rather than two numbers. Neither is recoverable from a version 1 profile
 *    -- a loss was never written down and the individual games are gone -- so
 *    the rung fills them empty and the counts carry on from where they were.
 * 3: experience went **per language**, and `Known` grew `run` and `learnedAt`
 *    so the ledger can say which words are learned rather than only met.
 *    Neither of the new word fields is recoverable: a consecutive-correct run
 *    was never written down, and reconstructing one from `got` and `missed`
 *    would credit somebody who got ten right and ten wrong with a run of ten.
 *    So every existing row restarts at a run of zero on its next answer, and
 *    the rung says so out loud rather than guessing. The old scalar `xp` is
 *    split across languages by word count; see `splitXp`.
 * 4: the wardrobe stopped being derived and started being **stored**. Chests
 *    replaced the unlock thresholds, so what somebody owns is no longer a pure
 *    function of their experience and there is a list of it here: `owned`,
 *    plus `spent` and the `opens` ring that keeps a retried chest from being
 *    charged twice.
 *
 *    The rung owes existing accounts something, and it cannot pay in items.
 *    Working out what a threshold had already unlocked means reading the four
 *    art manifests, and those live on the client precisely so six thousand
 *    image files never reach a Durable Object. So it pays in **chests**:
 *    `credits` is `floor(non-English xp / CHEST_COST)`, banked and spent
 *    before anything else. Honest about what happened, needs no manifest, and
 *    somebody who had earned the pink hair gets a fistful of chests rather
 *    than an argument.
 * 5: the waifu gacha. `claimed` is every character rolled and kept, and
 *    `showcase` is the three on display. The rung fills both empty and that is
 *    the whole of it: there is nothing in a version 4 profile to reconstruct
 *    them from and nothing owed, because the feature did not exist to have
 *    been earned in. It still needs a rung and a fixture, because
 *    `profile.test.ts` walks every historical version forward and a missing
 *    one is the bug this ladder exists to catch.
 * 6: `credits` is gone, and with it the second currency.
 *
 *    There is one purse now and one price: experience earned outside English,
 *    a hundred of it per open, for a chest and for a roll alike. Version 4
 *    banked chests as *chests*, which meant the screen held two numbers in
 *    different units and could only ever say one of them, and neither was the
 *    one somebody wanted.
 *
 *    **The rung pays nothing back, and that is not meanness.** Version 4's
 *    rung minted `floor(spendableEarned / CHEST_COST)` credits and never
 *    charged the balance it computed them from, so a thousand Polish migrated
 *    into ten free chests *plus* a thousand still to spend: twenty opens where
 *    anyone earning the same thousand a week later got ten. It was a
 *    duplicate rather than a debt. Dropping the field removes the copy and
 *    leaves the balance, so every account lands on exactly what the rule says
 *    it has, and none lands under it.
 *
 *    The reason it had to go now rather than whenever: `applyRoll` had started
 *    spending credits too, so the duplicate was quietly buying characters in a
 *    second feature. A migration artefact that spreads is not one that can be
 *    left to age out.
 * 7: goth points are their own currency. `points` is what the purse holds and
 *    `playedDay` is what the once-a-day bonus is checked against.
 *
 *    The purse used to *be* the non-English experience total, which made the
 *    balance a function of a measurement: a night of Backgammon bought
 *    nothing, because a night of Backgammon teaches no Polish. That is the
 *    right answer for a level and the wrong one for a currency, and the two
 *    were the same number, so only one of them could be right at a time.
 *    Splitting them lets `xp` stay a claim about a language and lets the purse
 *    be paid for playing.
 *
 *    The rung seeds `points` from the old non-English total, so nobody's
 *    balance falls on the deploy. It cannot be idempotent -- run twice it
 *    would pay the seed twice -- so it is under a version check, unlike the
 *    three shape repairs above.
 */
export const PROFILE_VERSION = 7;

/**
 * The languages the ledger can hold a word in.
 *
 * The same three Word Chain plays, spelled out here rather than imported from
 * `wordChainDisplay.ts`, because importing it would tie the persisted shape of
 * a profile to a game's display module: dropping a language from the game
 * would then change what a stored profile is allowed to contain, and the words
 * already in it would stop type-checking. A profile outlives the games that
 * filled it. `profile.test.ts` holds the two lists against each other so they
 * cannot quietly diverge either.
 */
export type LearnLang = 'en' | 'pl' | 'ja';

export const LEARN_LANGS: readonly LearnLang[] = ['en', 'pl', 'ja'];

/**
 * One word you have met, in one language.
 *
 * **The row is the lemma, not the word played.** Polish files `jestem` and
 * `być` as separate entries and the game plays them separately, which is right
 * for the game and wrong for this: a learner who has played six inflections of
 * one verb has learned one verb, and a ledger claiming six is lying to the
 * person using it to decide what to study. `key` is the folded lemma, produced
 * by the game's own `record()` where the dictionary is, and `word` is whichever
 * form was actually on the screen most recently.
 *
 * **Everything the screen shows is stored here rather than looked up.** The
 * gloss, the script, the lemma and the rank cost about eighty bytes a row and
 * they are the only reason a profile can be drawn at all — see the note at the
 * top of this file. It reads as redundant storage right up until you try to
 * render it.
 */
export interface Known {
  lang: LearnLang;
  /** Folded lemma: the identity. Two rows may never share one. */
  key: string;
  /** The form last seen on screen: `żółty`, not `zolty`. */
  word: string;
  /** Japanese in its own script. Empty for the other two. */
  script: string;
  /** The dictionary form, when the word played was an inflection of it. */
  lemma: string;
  /** What it means, in English, as the list gives it. */
  gloss: string;
  /** Position in its own language's frequency list, commonest first. */
  rank: number;

  /** How often it has been in front of you, produced by you, and missed. */
  seen: number;
  got: number;
  missed: number;

  /** When it was last graded, and when it comes back. Server clock, both. */
  lastAt: number;
  /**
   * When this word is next worth asking about.
   *
   * Stored as a deadline rather than as an interval, for the same reason
   * `LetterCooldown.until` is: nothing has to remember to decrement it, and a
   * profile restored from storage cannot come back with a tick already spent.
   * It is also the single number the whole feature is for — "18 words due" on
   * the lobby is a count over this field.
   */
  dueAt: number;
  /** Rung on the ladder. See `BOXES` in `review.ts`. */
  box: number;
  /** The quickest you have ever produced it, in ms. Zero until you have. */
  fastestMs: number;

  /**
   * How many times in a row it has been answered correctly. Any miss zeroes it.
   *
   * A separate count from `box` because the two answer different questions and
   * conflating them was the first version of this. `box` is *when to ask
   * again*, and it is deliberately forgiving: a hinted answer climbs, a
   * recognised one holds, and `gave-up` only falls to rung one. `run` is
   * *whether we are sure*, and it is deliberately not forgiving, because it is
   * the claim the Vocabulary screen makes on the player's behalf. A word can
   * sit on the top rung with a run of one, and that is not a contradiction: it
   * means we will not ask for ninety days, and we are not yet willing to say
   * they know it.
   */
  run: number;

  /**
   * When the run first reached `LEARNED_RUN`, or zero. See `isLearned`.
   *
   * **It latches.** Once a word is learned it stays learned, and a later miss
   * drops it back down the ladder for review without taking it out of the
   * Vocabulary list. The alternative was tried on paper and it is worse: a list
   * you can be demoted from is a list you check nervously, and one bad answer
   * on a Tuesday deleting a word you spent two months on reads as the app
   * having taken something away. The ladder is where a miss is supposed to
   * hurt, and it already does.
   */
  learnedAt: number;
}

/**
 * Correct answers in a row before the ledger will say somebody knows a word.
 *
 * Ten, and the number is doing less work than it looks like: because a word is
 * only asked when it comes back round, ten in a row is spread across the whole
 * ladder and is closer to "right every time for three months" than to ten
 * turns in an evening. That is the bar the word *learned* has to clear to be
 * worth printing, and a lower one would fill the screen with words somebody
 * would fail if you asked them tomorrow.
 */
export const LEARNED_RUN = 10;

/** Whether the ledger is willing to say this word is known. See `learnedAt`. */
export function isLearned(word: Known): boolean {
  return word.learnedAt > 0;
}

/**
 * How many of a game's results one tally remembers individually.
 *
 * Ten is a strip of pips somebody can read at a glance without counting, and
 * it is the number that answers the question a total cannot: whether the last
 * few went the way the lifetime record says they should. Longer would be a
 * chart, and a chart of Connect Four is not what anybody opened this panel
 * for. Thirteen games at ten results is under a kilobyte on the profile.
 */
export const FORM = 10;

/**
 * What one game did, kept per game rather than as one running total.
 *
 * `played` counts every finished game; `won`, `lost` and `drew` count only the
 * ones the game could say something about. **They do not have to add up**, and
 * nothing here should be written as if they did: eleven of the thirteen games
 * implement no `record` and the room declines to guess, so a hundred games of
 * Connect Four is `played: 100` and three zeroes. See `Outcome` in
 * `harvest.ts` for why guessing was rejected.
 */
export interface GameTally {
  gameId: string;
  played: number;
  won: number;
  /** Games lost outright. Only the games that name a winner produce these. */
  lost: number;
  /** Games that ended with no single winner. Not every game can produce one. */
  drew: number;
  /**
   * The last few decided results, oldest first, capped at `FORM`.
   *
   * The history the totals cannot hold. Results the game did not decide are
   * left out rather than stored as a gap: a run of Connect Four would
   * otherwise be ten blanks pretending to be a form guide.
   */
  last: TallyResult[];
  lastAt: number;
}

/**
 * How a game finished, from one seat.
 *
 * Spelled out here rather than imported from `harvest.ts` for the reason
 * `LearnLang` is: this is a persisted shape, and it must not move because a
 * module about folding results into profiles changed its mind. `harvest.ts`
 * holds the two against each other.
 */
export type TallyResult = 'won' | 'lost' | 'drew';

/**
 * Days in a row with at least one word reviewed.
 *
 * A day is a UTC day number, `floor(ms / 86_400_000)`, decided on the server.
 * That is wrong by up to half a day for somebody in New Zealand and it is
 * still the right call: the alternative is trusting a client's timezone, and a
 * player who wants a longer streak could then simply claim to be somewhere
 * else. A boundary that is occasionally inconvenient beats one that can be
 * chosen.
 *
 * `rests` is the forgiving part, and it is here from the start rather than
 * added later after somebody loses a hundred-day streak to a bad week. See
 * `bumpStreak`.
 */
export interface Streak {
  /** How many days long, counting today if today is done. */
  days: number;
  /** UTC day number of the last day with a review in it. */
  lastDay: number;
  /** Rest days already spent inside the current streak. See `bumpStreak`. */
  rests: number;
}

export interface Profile {
  version: number;
  /** The account id. See `account.ts`; opaque here on purpose. */
  id: string;
  name: string;
  createdAt: number;

  /**
   * Experience, per language, and the one field on this object that is a
   * scoreboard rather than a measurement.
   *
   * It is paid for words and only incidentally for games. See `xpFor` in
   * `review.ts` for the whole argument, which is not really about arithmetic:
   * Vocab Race already halves a fluent speaker's points so that a learner is
   * not farmed, and an XP curve that paid for wins would reverse that decision
   * from outside the reducer while the reducer's comments still claimed
   * otherwise.
   *
   * **Per language, because a level is a claim about a language.** One pooled
   * total told somebody halfway through their first month of Japanese that
   * they were level nine, which was true about the account and false about the
   * only thing they wanted to know. Splitting it costs one migration rung and
   * makes the number mean what people already read it as meaning.
   *
   * The consequence to be honest about: a game that taught no words pays
   * nothing here. `XP_PER_GAME` is credited to the language a game's words
   * were in, and eleven of the thirteen games have none, so a night of
   * Backgammon moves no bar. That is the correct answer to "how much Polish
   * did that teach you" and the games panel is where a night of Backgammon is
   * supposed to show up.
   *
   * A plain object rather than a Map, like everything else here: it is
   * persisted, exported and migrated, and it has to survive `JSON.parse`.
   */
  xp: Record<LearnLang, number>;
  streak: Streak;
  games: GameTally[];

  /**
   * Every word met, in no particular order.
   *
   * An array rather than a keyed object because it is persisted, exported and
   * migrated, and an array of records is the shape all three of those are
   * easiest to reason about. Lookups build a Map for the duration of one
   * harvest, which touches thirty rows out of a few thousand and is not worth
   * a different data structure.
   */
  words: Known[];

  /**
   * Harvest keys already applied, newest last. The idempotency record.
   *
   * A room hands its results to the player objects and *then* writes down that
   * it has done so, so a crash between the two re-sends the same harvest. That
   * is deliberate — at-least-once delivery into a receiver that can recognise a
   * repeat is the only exactly-once anybody actually builds — and this is the
   * half that recognises it.
   *
   * Trimmed to `APPLIED_MEMORY`, because a duplicate is a retry and arrives
   * within seconds; keeping every key a player has ever earned would grow the
   * profile forever to defend against a collision that cannot happen. The keys
   * carry a random per-room run id rather than just the room code for exactly
   * that reason — see `harvestKey`.
   */
  applied: string[];

  /**
   * Every part and colour a chest has handed over, plus the floors granted.
   *
   * **Stored, and that is the change version 4 is for.** Under the old
   * thresholds this was a pure function of `xp` and there was nothing to keep:
   * nothing to reconcile after a sync, and nothing a console could edit to
   * award a hat nobody had earned. A chest is a roll rather than a comparison,
   * so the roll's outcome has to be written down, and this is the list.
   *
   * Ids only, never art. They are `slot/name` for a part and `#slot:variant`
   * for a colour; `wardrobeSplit.ts` mints both and is the only thing that
   * knows what they point at.
   */
  owned: string[];

  /**
   * Goth points earned, for ever. The purse's numerator; `spent` is what has
   * come off it.
   *
   * **Paid for playing, not for learning, and that is the whole point of it
   * being a separate number from `xp`.** Every finished game pays, a game that
   * taught a language pays five times as much, and the first game of any day
   * pays a lump on top. See `pointsFor` in `review.ts` for the arithmetic and
   * the argument.
   *
   * A lifetime total rather than a running balance, for the same reason `xp`
   * is: a number that goes down when you buy a hat is a number people stop
   * spending. `spendable()` does the subtraction.
   */
  points: number;

  /**
   * The UTC day the last game was harvested on. The once-a-day bonus's memory.
   *
   * Its own field rather than read off `streak.lastDay`, which looks like the
   * same number and is not: a streak day is a day something was *studied*, so
   * an evening of Backgammon leaves it alone deliberately. Sharing them would
   * either pay the daily bonus every night to somebody who never studies, or
   * hold a study streak up for a game that taught nothing. Both were tried in
   * the same afternoon.
   */
  playedDay: number;

  /**
   * Experience committed to chests. **Pooled, and never subtracted from `xp`.**
   *
   * Two decisions in one number. The first: `xp` stays a lifetime record, so
   * levels never move backwards. `unlock.ts` made that argument against this
   * whole feature -- subtract a hoodie and somebody's headline figure falls
   * after a good week -- and keeping the spend separate is how the argument
   * survives being overruled. What a chest costs comes off `spendable()`, and
   * `rankOf` never sees it.
   *
   * The second: pooled rather than per language, which is the opposite of what
   * `xp` does and is deliberate. Splitting `xp` was right because **a level is
   * a claim about a language** and a pooled one lied. A balance claims nothing
   * about anything, so splitting it would buy no honesty and would cost
   * somebody studying two languages a chest they had plainly earned: 60 Polish
   * and 70 Japanese is 130 and would have bought nothing.
   */
  spent: number;

  /**
   * Recent chest nonces, oldest first. The idempotency record for opening.
   *
   * `applied` exists because a harvest is retried; this exists because a chest
   * **has no natural key**. A dropped response plus a retry would open two
   * chests and spend two hundred, so the client mints a nonce, this remembers
   * it, and the second request returns the first drop. Trimmed to
   * `CHEST_MEMORY` for the same reason `applied` is trimmed.
   */
  opens: string[];


  /**
   * Every character rolled and kept, oldest first. **Append-only.**
   *
   * The counterpart to `owned`, and it is a list for the same reason: a roll
   * is a roll rather than a comparison, so its outcome has to be written down.
   * What is different is that this one can hold the same id twice, because a
   * roll repeats where a chest does not. See `waifu.ts`; the duplicate is
   * refunded rather than dropped, and it is kept here so a collection can say
   * how many times somebody pulled the one they were after.
   *
   * Nothing ever removes an entry. The showcase is three slots and the
   * pressure of the whole feature is in choosing between them, but that
   * pressure has to be about display: deleting a collection to make room would
   * turn a good roll into a thing you can lose, in an app that took a hundred
   * experience for it.
   */
  claimed: string[];

  /**
   * The three on show, in the player's own order. A subset of `claimed`.
   *
   * Order is kept because the first slot is the one that travels: it rides on
   * `ProfileView` and appears beside the player's name in a room, which is
   * what makes the third roll worth caring about. A private list nobody else
   * ever sees would not.
   *
   * `legalShowcase` in `waifu.ts` is the only thing that should write this,
   * and it re-derives the subset rule from `claimed` rather than trusting what
   * arrived.
   */
  showcase: string[];
}
