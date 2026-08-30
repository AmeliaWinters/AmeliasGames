/**
 * The Vocabulary screen: which words we are willing to say you know.
 *
 * The whole screen turns on one distinction and the copy has to keep making
 * it. **Learned** is a claim -- ten correct answers in a row, spread across a
 * ladder that reaches ninety days, so it is nearer "right every time for three
 * months" than "right ten times on Tuesday". **Learning** is everything else
 * you have met. A screen that blurred the two would be a longer list and a
 * smaller promise, and the promise is the reason anybody opens it.
 *
 * Two sources, and it says which one it is drawing. A live socket answers
 * `vocab` with the server's copy; the lobby has no socket at all, so it draws
 * `vocabCache.ts` and admits to it. See that file for why a stored copy of a
 * list that only grows is close enough to never wrong.
 *
 * **It renders no word it was not sent.** Same rule as the profile panel and
 * the same reason: the client has no dictionary and never may, so every gloss,
 * script and rank on this screen arrived on the row itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Known, LangView, LearnLang, ProfileView } from "../shared/profile.js";
import { LEARNED_RUN, isLearned } from "../shared/profile.js";
import { loadVocabCache, saveVocabCache } from "./vocabCache.js";
import { LANG_NAME, restingFor } from "./profileDisplay.js";

/** Which half of the ledger is on screen. */
type Shelf = "learned" | "learning";


/**
 * One word's progress towards being learned, as a fraction.
 *
 * Off `run` rather than off `box`, because those two answer different
 * questions and this bar is answering the run's. See `Known.run`: a word can
 * be on the top rung with a run of one, which means it will not be asked for
 * ninety days and is still not something we will claim they know.
 */
function progressOf(word: Known): number {
  return Math.max(0, Math.min(1, word.run / LEARNED_RUN));
}

/**
 * One row.
 *
 * The lemma leads, because the row *is* the lemma -- see `Known` -- and the
 * form last played is a detail underneath it rather than the headline. The
 * script sits beside the lemma for Japanese and is simply absent for the other
 * two, which is why it is stored as an empty string rather than as a flag.
 */
function Row({ word, now }: { word: Known; now: number }) {
  const learned = isLearned(word);
  const due = word.dueAt <= now;
  const left = LEARNED_RUN - word.run;

  return (
    <>
      <span className="vocab-word">
        {word.lemma || word.word}
        {word.script && <span className="vocab-script">{word.script}</span>}
      </span>
      <span className="vocab-gloss">{word.gloss}</span>

      {learned ? (
        <span className="vocab-state">
          Learned{due ? ", due for a check" : `, back ${restingFor(word.box)}`}
        </span>
      ) : (
        <>
          {/* The bar is decoration over a sentence that already says it. A
              screen reader gets the sentence and not the bar, which is why the
              bar is hidden rather than labelled: two readings of one fact is
              worse than one. */}
          <span className="vocab-bar" aria-hidden="true">
            <span
              className="vocab-bar-fill"
              style={{ inlineSize: `${Math.round(progressOf(word) * 100)}%` }}
            />
          </span>
          <span className="vocab-state">
            {word.run === 0
              ? due
                ? "Due now"
                : `Back ${restingFor(word.box)}`
              : `${left} more in a row${due ? ", due now" : ""}`}
          </span>
        </>
      )}
    </>
  );
}

/**
 * How many rows are drawn before the list stops.
 *
 * A ledger of two thousand words is two thousand DOM nodes on a phone, and the
 * screen is a thing people read the top of and search. The cut is announced
 * rather than silent, and the search box is the way past it -- which is also
 * why search filters the whole list and not the drawn part of it.
 */
const PAGE = 200;

export function Vocabulary({
  profile,
  live,
  onRequest,
  onBack,
}: {
  profile: ProfileView | null;
  /**
   * The last answer a socket gave, if there is a socket. Null in the lobby,
   * which is the ordinary case: see `vocabCache.ts`.
   */
  live?: { lang: LearnLang; words: Known[] } | null;
  /** Ask the socket for a language. Absent where there is no socket. */
  onRequest?: (lang: LearnLang) => void;
  onBack(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [shelf, setShelf] = useState<Shelf>("learned");
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<LearnLang | null>(null);
  const now = Date.now();

  // The first language with anything in it, once the summary has arrived. Not
  // a default in `useState`, because the summary can turn up after the first
  // render and a screen that opened on English for a Polish learner has
  // already asked them to fix it.
  const first = profile?.byLang[0]?.lang ?? null;
  useEffect(() => {
    if (lang === null && first !== null) {
      setLang(first);
      onRequest?.(first);
    }
  }, [lang, first, onRequest]);

  const { words, loading, cachedAt } = useVocab(lang, live ?? null, Boolean(onRequest));

  // Focus lands on the heading, so a screen reader is told which screen this
  // is rather than being left wherever the button that opened it was.
  useEffect(() => void heading.current?.focus(), []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return words.filter((word) => {
      if (isLearned(word) !== (shelf === "learned")) return false;
      if (!needle) return true;
      // The script is searched unfolded, so a Japanese learner can look for a
      // word in the script they actually read it in.
      return (
        word.lemma.toLowerCase().includes(needle) ||
        word.word.toLowerCase().includes(needle) ||
        word.script.includes(needle) ||
        word.gloss.toLowerCase().includes(needle)
      );
    });
  }, [words, shelf, query]);

  const row = profile?.byLang.find((entry) => entry.lang === lang) ?? null;
  const learning = row ? row.words - row.learned : 0;

  return (
    <section className="panel vocab" aria-labelledby="vocab-head">
      <h2 id="vocab-head" ref={heading} tabIndex={-1}>
        Vocabulary
      </h2>

      {profile === null || profile.byLang.length === 0 ? (
        <p className="vocab-none">
          No words yet. Play Vocab Race or Word Chain and the words you meet turn up here.
        </p>
      ) : (
        <>
          {/* Language first, because everything below it is about one language
              and a tab strip that changes meaning silently is the bug this
              ordering avoids. Radios rather than buttons: it is a choice with
              one answer, and that is what a screen reader should be told. */}
          {profile.byLang.length > 1 && (
            <div className="vocab-langs" role="radiogroup" aria-label="Language">
              {profile.byLang.map((entry) => (
                <button
                  key={entry.lang}
                  type="button"
                  role="radio"
                  aria-checked={entry.lang === lang}
                  className={entry.lang === lang ? "vocab-lang on" : "vocab-lang"}
                  onClick={() => {
                    setLang(entry.lang);
                    onRequest?.(entry.lang);
                  }}
                >
                  {LANG_NAME[entry.lang] ?? entry.lang}
                </button>
              ))}
            </div>
          )}

          {row && <Level row={row} />}

          <div className="vocab-shelves" role="radiogroup" aria-label="Which words">
            <button
              type="button"
              role="radio"
              aria-checked={shelf === "learned"}
              className={shelf === "learned" ? "vocab-shelf on" : "vocab-shelf"}
              onClick={() => setShelf("learned")}
            >
              Learned <span className="vocab-shelf-n">{row?.learned ?? 0}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={shelf === "learning"}
              className={shelf === "learning" ? "vocab-shelf on" : "vocab-shelf"}
              onClick={() => setShelf("learning")}
            >
              Still learning <span className="vocab-shelf-n">{learning}</span>
            </button>
          </div>

          <label className="vocab-find">
            <span>Find a word</span>
            <input
              type="search"
              value={query}
              placeholder="word or meaning"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {loading ? (
            <p className="vocab-wait" role="status">
              Fetching your words.
            </p>
          ) : shown.length === 0 ? (
            <p className="vocab-none">
              {query.trim()
                ? "Nothing matches that."
                : shelf === "learned"
                  ? `Nothing learned yet. A word joins this list after ${LEARNED_RUN} correct answers in a row.`
                  : "Nothing on the go. Every word you have met is learned."}
            </p>
          ) : (
            <>
              <ul className="vocab-list">
                {shown.slice(0, PAGE).map((word) => (
                  <li
                    key={`${word.lang}:${word.key}`}
                    className={isLearned(word) ? "vocab-row learned" : "vocab-row"}
                  >
                    <Row word={word} now={now} />
                  </li>
                ))}
              </ul>
              {shown.length > PAGE && (
                <p className="vocab-more">
                  Showing {PAGE} of {shown.length}. Search to find the rest.
                </p>
              )}
            </>
          )}

          {/* Said out loud rather than left for somebody to notice a missing
              word. The lobby genuinely has no socket -- see `vocabCache.ts` --
              and a list quietly a game out of date is worse than one that
              says so. */}
          {cachedAt > 0 && <p className="vocab-stale">Saved on this device after your last game.</p>}
        </>
      )}

      <button type="button" className="vocab-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

/**
 * One language's level, and the figures that outrank it.
 *
 * Words first and the level second, which is the ordering the profile panel
 * argues for and the same argument applies here: a level means something only
 * next to somebody else's, and "412 met, 96 learned" means something on its
 * own.
 */
function Level({ row }: { row: LangView }) {
  const span = Math.max(1, row.nextLevel - row.levelAt);
  const through = Math.max(0, Math.min(1, (row.xp - row.levelAt) / span));

  return (
    <div className="vocab-level">
      <p className="vocab-counts">
        <strong>{row.words.toLocaleString()}</strong> met,{" "}
        <strong>{row.learned.toLocaleString()}</strong> learned
        {row.due > 0 && <>, {row.due.toLocaleString()} due</>}
      </p>
      <p className="vocab-level-n">
        {LANG_NAME[row.lang] ?? row.lang}, level {row.level}
      </p>
      <span className="vocab-level-bar" aria-hidden="true">
        <span
          className="vocab-level-fill"
          style={{ inlineSize: `${Math.round(through * 100)}%` }}
        />
      </span>
      <span className="vocab-level-xp">
        {row.xp.toLocaleString()} / {row.nextLevel.toLocaleString()} XP
      </span>
    </div>
  );
}

/**
 * The rows for one language, live if there is a socket and stored if not.
 *
 * The whole socket-or-cache decision, in one hook, so the screen above does
 * not have to hold an opinion about which it is drawing. Asking is the
 * caller's job because only the caller has the socket; this decides what to
 * show while the answer is in the air, and writes every live answer to the
 * cache on the way past.
 */
export function useVocab(
  lang: LearnLang | null,
  live: { lang: LearnLang; words: Known[] } | null,
  hasSocket: boolean,
): { words: Known[]; loading: boolean; cachedAt: number } {
  const [cached, setCached] = useState<{ words: Known[]; at: number } | null>(null);

  useEffect(() => {
    setCached(lang === null ? null : loadVocabCache(lang));
  }, [lang]);

  useEffect(() => {
    if (lang !== null && live && live.lang === lang) saveVocabCache(lang, live.words, Date.now());
  }, [live, lang]);

  if (lang === null) return { words: [], loading: false, cachedAt: 0 };
  // The language on the answer is checked rather than assumed: two requests in
  // flight must not be drawn under each other's heading.
  if (live && live.lang === lang) return { words: live.words, loading: false, cachedAt: 0 };
  if (cached) return { words: cached.words, loading: false, cachedAt: cached.at };
  // Nothing stored and nothing arrived. Only a live socket will ever change
  // that, so anywhere else this is an empty ledger rather than a wait.
  return { words: [], loading: hasSocket, cachedAt: 0 };
}
