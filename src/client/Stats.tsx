/**
 * The Stats screen: what the account has to show for itself.
 *
 * This was a drawer inside the account menu, and it was the wrong shape for
 * it. A menu row opens something you glance at and close; this is four
 * sections, one of them a list that grows without limit, and pressing one row
 * made the menu three screens tall and pushed everything under it out of
 * reach. So it is a screen of its own, opened the way `Vocabulary` is and
 * returning the same way -- see `Profile`, where the row that leads here
 * deliberately carries no `aria-expanded`, because a row that claims to expand
 * and then navigates is a lie told to a screen reader.
 *
 * It leads with **words known** and **words due**, and carries the level as
 * the smaller figure beside them. That ordering is the argument this whole
 * feature rests on: a level is a number that means something only next to
 * somebody else's, and the two word counts are the ones that mean something on
 * their own. Putting the level first would make this a scoreboard about a game
 * rather than a record of a language.
 *
 * **It renders no word it was not sent.** The client has no dictionary and
 * never may, so every gloss, script and rank on this screen arrived on the row
 * itself. That is what `Known` is carrying all those fields for.
 */
import { useEffect, useRef } from "react";
import type { GameTally, ProfileView, TallyResult } from "../shared/profile.js";
import { dayOf, decided } from "../shared/profile.js";
import { gameEntry } from "../shared/games/manifest.js";
import { LANG_NAME, restingFor } from "./profileDisplay.js";

/** A count and what it counts, as one block. The screen is mostly these. */
function Figure({ n, of, lead }: { n: number; of: string; lead?: boolean }) {
  return (
    <div className={lead ? "figure figure-lead" : "figure"}>
      <span className="figure-n">{n.toLocaleString()}</span>
      <span className="figure-of">{of}</span>
    </div>
  );
}

/**
 * When a game was last played, in the words somebody would use.
 *
 * Days rather than a date for the first fortnight, because "4 days ago" is the
 * answer to the question being asked and "22 Aug" is a lookup. After that the
 * date is the shorter thing to read and nobody is counting any more.
 *
 * Whole days apart on the same UTC boundary the streak uses, so a game
 * finished late last night reads as yesterday rather than as "14 hours".
 */
function playedAgo(at: number, now: number): string {
  if (at === 0) return "";
  const days = dayOf(now) - dayOf(at);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One game's record, written out only as far as there is something to write.
 *
 * Eleven of the thirteen games name no winner, so their rows say how many were
 * played and stop. A permanent "0W 0L" on two thirds of the list would read as
 * a losing record rather than as an absent one -- see `GameTally`, where the
 * counters are documented as not adding up to `played` on purpose.
 */
function recordOf(tally: GameTally): string {
  if (decided(tally) === 0) return `${tally.played} played`;
  const drawn = tally.drew > 0 ? ` · ${tally.drew}D` : "";
  return `${tally.played} played · ${tally.won}W${drawn} · ${tally.lost}L`;
}

/**
 * The last few results, oldest on the left.
 *
 * Pips rather than letters, because the question they answer is "how has it
 * been going lately", which is a shape and is read without reading. They are
 * hidden from a screen reader and spelled out in the row's label instead: a
 * run of coloured dots says nothing out loud, and eight list items saying
 * "won" would drown the counts that matter.
 */
function Form({ last }: { last: TallyResult[] }) {
  if (last.length === 0) return null;
  return (
    <span className="prof-form" aria-hidden="true">
      {last.map((result, i) => (
        <span key={i} className={`prof-pip prof-pip-${result}`} />
      ))}
    </span>
  );
}

/**
 * Every game this account has finished: the record, and how it has been going.
 *
 * Most recently played first, and the ordering is most of what makes this a
 * history rather than a leaderboard. Sorting by how often a game has been
 * played -- which is what this panel did when it was two numbers -- buries
 * what somebody played last night under the game they wore out in March. Ties
 * go to the bigger tally, which only decides anything on a day with two games
 * on it.
 */
function Games({ games }: { games: GameTally[] }) {
  const now = Date.now();
  const played = games.reduce((n, tally) => n + tally.played, 0);

  return (
    <section className="prof-games" aria-labelledby="prof-games-head">
      <h3 id="prof-games-head">
        Games <span className="prof-games-total">{played.toLocaleString()} played</span>
      </h3>
      <ul>
        {[...games]
          .sort((a, b) => b.lastAt - a.lastAt || b.played - a.played)
          .map((tally) => {
            const name = gameEntry(tally.gameId)?.name ?? tally.gameId;
            const ago = playedAgo(tally.lastAt, now);
            const run =
              tally.last.length > 0 ? `. Last ${tally.last.length}: ${tally.last.join(", ")}` : "";
            return (
              <li key={tally.gameId}>
                <span className="prof-game">{name}</span>
                <span
                  className="prof-game-n"
                  aria-label={`${name}. ${recordOf(tally)}${ago ? `, last played ${ago}` : ""}${run}`}
                >
                  <span>{recordOf(tally)}</span>
                  {ago && <em className="prof-game-when">{ago}</em>}
                </span>
                <Form last={tally.last} />
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/**
 * One language's progress, one block each.
 *
 * One block per language rather than one level for the account. The curve is
 * per language now, and it has to be: somebody four hundred words into Polish
 * and three words into Japanese is not level anything in general. Words met
 * and words known are both here because they are different claims -- see
 * `LangView`, where the weak one is documented as the weak one -- and the bar
 * underneath is the language's own.
 */
function Langs({ rows }: { rows: ProfileView["byLang"] }) {
  return (
    <ul className="prof-langs">
      {rows.map((row) => {
        const through = Math.max(
          0,
          Math.min(1, (row.xp - row.levelAt) / Math.max(1, row.nextLevel - row.levelAt)),
        );
        return (
          <li key={row.lang}>
            <span className="prof-lang">{LANG_NAME[row.lang] ?? row.lang}</span>
            <span className="prof-lang-n">
              {row.learned} known of {row.words}
              {row.due > 0 && <em>, {row.due} due</em>}
            </span>
            <span className="prof-level">
              <span className="prof-level-n">Level {row.level}</span>
              <span className="prof-bar" aria-hidden="true">
                <span
                  className="prof-bar-fill"
                  style={{ inlineSize: `${Math.round(through * 100)}%` }}
                />
              </span>
              <span className="prof-level-xp">
                {row.xp.toLocaleString()} / {row.nextLevel.toLocaleString()}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Stats({ profile, onBack }: { profile: ProfileView | null; onBack(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The screen replaces the menu under the same chip, so the reader's place on
  // the page is now inside something that was not there a moment ago.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="panel prof prof-page" aria-labelledby="prof-stats-head">
      <h2 id="prof-stats-head" ref={heading} tabIndex={-1}>
        Stats
      </h2>

      {profile ? (
        <>
          {/* Words first, levels second. See the note at the top of this file:
              the counts mean something on their own and a level only means
              something beside somebody else's. */}
          <div className="prof-figures">
            <Figure n={profile.due} of={profile.due === 1 ? "word due" : "words due"} lead />
            <Figure n={profile.learned} of={profile.learned === 1 ? "word known" : "words known"} />
            {profile.streak.days > 0 && (
              <Figure
                n={profile.streak.days}
                of={profile.streak.days === 1 ? "day" : "day streak"}
              />
            )}
          </div>

          {profile.byLang.length > 0 && <Langs rows={profile.byLang} />}

          {profile.recent.length > 0 && (
            <section className="prof-recent" aria-labelledby="prof-recent-head">
              <h3 id="prof-recent-head">Lately</h3>
              <ul>
                {profile.recent.map((word) => (
                  <li key={`${word.lang}:${word.key}`}>
                    <span className="prof-word">
                      {word.lemma || word.word}
                      {word.script && <span className="prof-script">{word.script}</span>}
                    </span>
                    <span className="prof-gloss">{word.gloss}</span>
                    <span className="prof-when">
                      {word.dueAt <= Date.now() ? "due now" : `back ${restingFor(word.box)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.games.length > 0 && <Games games={profile.games} />}
        </>
      ) : (
        /* Signed in with nothing filed yet: the account exists the moment the
           key does, and the profile is written by the first game. Said here
           rather than by refusing to open the screen, because a row that leads
           to a dead end is worse than a screen that says what to do. */
        <p className="prof-quiet prof-empty">
          Nothing yet. Play a game of Word Chain or Vocab Race and the words will land here.
        </p>
      )}

      <button type="button" className="prof-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}
