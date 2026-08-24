import { useEffect, useRef, useState } from "react";
// Values from vocabDisplay.js, which imports nothing that reaches a reducer.
// The boundary matters twice here: the word lists must not reach the browser
// (they are the second largest thing in the repo), and neither must the answer
// to the clue currently on the screen — a board that could resolve a clue
// itself would have ended the race. The types below are type-only and erase.
import {
  MODE_CAP,
  MODE_NAME,
  REVEAL_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_MODES,
  clockCall,
  formatClock,
  msLeftFor,
  vocabStats,
} from "../../shared/games/vocabDisplay.js";
import type {
  VocabLang,
  VocabMode,
  VocabMove,
  VocabRound,
  VocabSeatStat,
  VocabState,
} from "../../shared/games/vocabDisplay.js";
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<VocabState, VocabMove>;

/** Under this much left, the clock starts shouting about it. */
const URGENT_MS = 10 * 1000;

/** What each language is called on its own terms, under the English name. */
const LANG_NATIVE: Record<VocabLang, string> = {
  pl: "polski",
  ja: "日本語",
};

/**
 * What each difficulty actually asks for, said in words rather than as a
 * number nobody can place. "Top 100" means nothing until you know that the top
 * hundred words of a language are the ones you cannot construct a sentence
 * without.
 */
const MODE_BLURB: Record<VocabMode, string> = {
  normal: "The hundred words the language leans on hardest.",
  hard: "The first thousand — where a learner actually lives.",
};

const count = new Intl.NumberFormat();

/** A time to a right answer. One decimal: whole seconds throw away the race. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `1st`, `2nd`, `13th`, `742nd` — read aloud by the rank, so it has to be right. */
function ordinal(n: number): string {
  const teen = n % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${count.format(n)}${suffix}`;
}

/**
 * The countdown. The same face Word Hunt and Word Duel use — see `clock.css`.
 *
 * Compact, because on this board the clock is not the point of the screen. The
 * clue is, and a 2rem countdown above a four-word definition would out-shout
 * the thing everybody is reading.
 */
function Clock({ left }: { left: number }) {
  return (
    <p
      className={["clock compact", left <= URGENT_MS ? "urgent" : "", left === 0 ? "done" : ""]
        .filter(Boolean)
        .join(" ")}
      role="timer"
      // Announced only when the wording changes — see `clockCall`. A countdown
      // read out four times a second is unusable with a screen reader on.
      aria-live="off"
    >
      <span className="clock-face">{left === 0 ? "Time" : formatClock(left)}</span>
      <span className="clock-note">{left === 0 ? "gone" : "left"}</span>
      <span className="sr-only" aria-live="polite">
        {clockCall(left, true)}
      </span>
    </p>
  );
}

/**
 * The running score, and who is still in this round.
 *
 * Both facts on one row because they are read together: a player deciding
 * whether to risk a guess is weighing how close somebody is to five against
 * how many of them are left to beat. Marked with a class rather than by fading
 * the row — a seat that has missed is still a score you need to see.
 */
function Scores({
  state,
  seat,
  nameFor,
}: {
  state: VocabState;
  seat: number | null;
  nameFor: (index: number) => string;
}) {
  const out = state.phase === "asking" ? (state.round?.missed ?? []) : [];
  return (
    <ol className="vr-scores" aria-label="Scores">
      {state.scores.map((score, index) => (
        <li
          key={index}
          className={[
            "vr-score",
            index === seat ? "mine" : "",
            out.includes(index) ? "out" : "",
            score >= TARGET ? "won" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-seat={index % 4}
        >
          <span className="vr-score-name">{nameFor(index)}</span>
          <span className="vr-score-points">
            <span aria-hidden="true">{score}</span>
            <span className="sr-only">
              {score} of {TARGET}
              {out.includes(index) ? ", out of this round" : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The answer, held up.
 *
 * This is the game. Everything else on the board exists to produce six seconds
 * where a word, its script and its meaning are on the screen together and the
 * player has just discovered they did not know it.
 *
 * Japanese carries its own script under the romaji, because a learner who only
 * ever sees `sakura` never learns to read 桜. Polish carries its dictionary
 * form when the word asked about was an inflection — `jestem` shown, `być`
 * learned — which is most of what the Polish list is for.
 */
function Answer({ round, lang }: { round: VocabRound; lang: VocabLang }) {
  const answer = round.answer;
  if (answer === null) return null;
  return (
    <div className="vr-answer">
      <p className="vr-answer-clue">{round.clue}</p>
      <p className="vr-answer-word" lang={lang}>
        {answer.word}
      </p>
      {answer.script && (
        <p className="vr-answer-script" lang="ja">
          {answer.script}
        </p>
      )}
      {answer.lemma && answer.lemma !== answer.word && (
        <p className="vr-answer-lemma">
          from <strong lang={lang}>{answer.lemma}</strong>
        </p>
      )}
      {/*
        How common the word is: its place in its own frequency list. A bare
        number, because that is what it is — a band ("common", "rare") says
        less, since #12 and #190 are both "very common" and are nothing like
        each other.
      */}
      <p className="vr-answer-rank">
        <span aria-hidden="true">#{count.format(answer.rank)}</span>
        <span className="sr-only">
          the {ordinal(answer.rank)} commonest {VOCAB_LANG_NAME[lang]} word
        </span>
      </p>
    </div>
  );
}

/** One row of the review at the end: what was asked, and who got it. */
function Review({
  round,
  lang,
  nameFor,
}: {
  round: VocabRound;
  lang: VocabLang;
  nameFor: (index: number) => string;
}) {
  const answer = round.answer;
  if (answer === null) return null;
  return (
    <li className={round.winner === null ? "vr-review nobody" : "vr-review"}>
      <span className="vr-review-word" lang={lang}>
        {answer.word}
        {answer.script && (
          <span className="vr-review-script" lang="ja">
            {answer.script}
          </span>
        )}
      </span>
      <span className="vr-review-clue">{round.clue}</span>
      <span className="vr-review-who">
        {round.winner === null ? "nobody" : `${nameFor(round.winner)}, ${seconds(round.ms)}`}
      </span>
    </li>
  );
}

/** How one seat played. Zero-round seats are drawn, because being beaten to
 * every word is a result and hiding it would flatter the table. */
function SeatStats({ stat, name }: { stat: VocabSeatStat; name: string }) {
  return (
    <li className="vr-stat">
      <span className="vr-stat-name">{name}</span>
      <span className="vr-stat-line">
        {stat.won} taken
        {stat.won > 0 && `, ${seconds(stat.ms)} each`}
        {stat.missed > 0 && ` · ${stat.missed} wrong`}
      </span>
    </li>
  );
}

export function VocabBoard({ state, seat, names, canAct, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const clock = useServerNow(now, state.deadline !== null && state.phase !== "over");
  const left = state.deadline === null ? null : msLeftFor(state, clock);
  const mine = seat !== null;
  // The clock closes the box the moment it reads zero rather than a round-trip
  // later: the server has already stopped taking answers by then, and a field
  // that still accepts one is promising something it cannot deliver.
  const myMove = mine && canAct && left !== 0;

  const nameFor = (index: number): string =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A new clue is a new question, so the box is emptied and taken. Keyed on the
  // round count and the phase rather than on the clue text, so that a refused
  // word — one the list has never heard of, which costs nothing — stays in the
  // box for the player to fix.
  useEffect(() => {
    setDraft("");
    if (state.phase === "asking") input.current?.focus();
  }, [state.history.length, state.phase]);

  function submit() {
    const word = draft.trim();
    if (word === "") return;
    onMove({ type: "guess", word });
  }

  // ── Setup ────────────────────────────────────────────────────────────
  if (state.phase === "setup") {
    const host = mine && canAct;
    return (
      <div className="board vr-board vr-setup">
        <p className="vr-brief">
          Everybody gets the same clue — what a word means — and the first to
          type the word takes the point. First to {TARGET} wins. Accents and
          spellings are optional: <em>zolty</em> finds{" "}
          <strong lang="pl">żółty</strong>, and <em>kohii</em> finds{" "}
          <strong lang="ja">koohii</strong>. A word we have never heard of costs
          you nothing, so a typo is not fatal — but a real word with the wrong
          meaning puts you out for the rest of the round. Whoever wins it, the
          answer goes up for {Math.round(REVEAL_MS / 1000)} seconds with its
          meaning under it, which is the part you are here for.
        </p>

        <div className="vr-choices" role="group" aria-label="Language">
          {VOCAB_LANGS.map((lang) => (
            <button
              type="button"
              key={lang}
              className={state.lang === lang ? "vr-choice surface chosen" : "vr-choice surface"}
              disabled={!host}
              aria-pressed={state.lang === lang}
              onClick={() => onMove({ type: "settings", lang, mode: state.mode })}
            >
              <span className="vr-choice-name">{VOCAB_LANG_NAME[lang]}</span>
              <span className="vr-choice-note" lang={lang}>
                {LANG_NATIVE[lang]}
              </span>
            </button>
          ))}
        </div>

        {/*
          English is not on that list, and the setup screen is where anyone who
          came looking for it will look. Saying why costs two lines and stops it
          reading as an oversight — which it would, in an app whose other word
          game offers all three.
        */}
        <p className="vr-note">
          The clues are written in English, so English is the one language you
          cannot learn here — a word like <em>the</em> has no description to
          give you.
        </p>

        <div className="vr-choices" role="group" aria-label="Difficulty">
          {VOCAB_MODES.map((mode) => (
            <button
              type="button"
              key={mode}
              className={state.mode === mode ? "vr-choice surface chosen" : "vr-choice surface"}
              disabled={!host}
              aria-pressed={state.mode === mode}
              onClick={() =>
                state.lang !== null && onMove({ type: "settings", lang: state.lang, mode })
              }
            >
              <span className="vr-choice-name">
                {MODE_NAME[mode]} · top {count.format(MODE_CAP[mode])}
              </span>
              <span className="vr-choice-note">{MODE_BLURB[mode]}</span>
            </button>
          ))}
        </div>

        {host ? (
          <>
            <button
              type="button"
              className="primary vr-begin"
              disabled={state.lang === null}
              onClick={() => onMove({ type: "begin" })}
            >
              {state.lang === null
                ? "Pick a language"
                : `Start — ${VOCAB_LANG_NAME[state.lang]}, top ${count.format(MODE_CAP[state.mode])}`}
            </button>
            <p className="vr-note">
              You are choosing for the table. Everyone races the same clue, so
              there is one language and one difficulty for the room.
            </p>
          </>
        ) : (
          <p className="vr-waiting" aria-live="polite">
            {state.lang === null
              ? `${nameFor(0)} is choosing a language and difficulty.`
              : `${nameFor(0)} has picked ${VOCAB_LANG_NAME[state.lang]}, top ${count.format(MODE_CAP[state.mode])}.`}
          </p>
        )}

        {left !== null && <Clock left={left} />}
        <p className="vr-note">
          Nobody loses this bit — if the clock goes, the room gets Polish on
          normal and the first clue is dealt.
        </p>
      </div>
    );
  }

  const lang = state.lang ?? "pl";

  // ── The end ──────────────────────────────────────────────────────────
  if (state.phase === "over") {
    const stats = vocabStats(state);
    const rounds = state.round === null ? state.history : [...state.history, state.round];
    return (
      <div className="board vr-board vr-end">
        <div className="vr-over" role="status">
          <p className="vr-verdict">
            {state.winner === null
              ? "Nobody got there. It's a tie."
              : state.winner === seat
                ? `You win, ${state.scores[state.winner]}–${Math.max(
                    ...state.scores.filter((_, i) => i !== state.winner),
                  )}.`
                : `${nameFor(state.winner)} wins with ${state.scores[state.winner]}.`}
          </p>
        </div>

        <ul className="vr-stat-seats">
          {stats.seats.map((stat) => (
            <SeatStats key={stat.seat} stat={stat} name={nameFor(stat.seat)} />
          ))}
        </ul>

        {stats.quickest && (
          <p className="vr-highlight">
            <strong>Quickest</strong> — {nameFor(stats.quickest.round.winner ?? 0)} had{" "}
            <span lang={lang}>{stats.quickest.round.answer?.word}</span> in{" "}
            {seconds(stats.quickest.round.ms)}.
          </p>
        )}

        {/*
          The words nobody got, called out above the full list. This is the one
          thing on the screen that is worth writing down, and burying it among
          twenty rounds the table did know would waste it.
        */}
        {stats.missedByAll.length > 0 && (
          <p className="vr-highlight">
            <strong>Nobody knew</strong>{" "}
            {stats.missedByAll.map((round, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span lang={lang}>{round.answer?.word}</span> ({round.clue})
              </span>
            ))}
            .
          </p>
        )}

        <h3 className="vr-review-head">
          All {rounds.length} {rounds.length === 1 ? "round" : "rounds"} —{" "}
          {VOCAB_LANG_NAME[lang]}, top {count.format(MODE_CAP[state.mode])}
        </h3>
        <ol className="vr-reviews">
          {rounds.map((round, i) => (
            <Review key={i} round={round} lang={lang} nameFor={nameFor} />
          ))}
        </ol>
      </div>
    );
  }

  // ── A round ──────────────────────────────────────────────────────────
  const round = state.round;
  const revealing = state.phase === "reveal";
  const iMissed = mine && (round?.missed.includes(seat) ?? false);

  return (
    <div className="board vr-board">
      <Scores state={state} seat={seat} nameFor={nameFor} />

      <p className="vr-round">
        Round {state.history.length + 1} · {VOCAB_LANG_NAME[lang]}, top{" "}
        {count.format(MODE_CAP[state.mode])}
      </p>

      {revealing && round ? (
        <>
          {/*
            The verdict before the word, because it is the shorter of the two
            and the word is what should be left on the screen. A live region:
            it is the one moment in a round where the board changes without
            anybody having pressed anything.
          */}
          <p className="vr-verdict" role="status">
            {round.winner === null
              ? "Nobody had it."
              : round.winner === seat
                ? `You had it in ${seconds(round.ms)}.`
                : `${nameFor(round.winner)} had it in ${seconds(round.ms)}.`}
            {/*
              What the winner typed, when it was not what the word looks like.
              This is where the folding stops being invisible: a player who
              typed `zolty` should see that it counted *and* see żółty.
            */}
            {round.winner !== null &&
              round.said !== "" &&
              round.answer !== null &&
              round.said !== round.answer.word && (
                <span className="vr-said"> They typed {round.said}.</span>
              )}
          </p>
          <Answer round={round} lang={lang} />
          {left !== null && (
            <p className="vr-next" aria-hidden="true">
              Next clue in {Math.max(1, Math.ceil(left / 1000))}…
            </p>
          )}
        </>
      ) : (
        <>
          {/*
            The clue. Large, alone, and the only thing on the wire about this
            round until it settles — the answer is not sent to anybody while
            they are racing for it.
          */}
          <p className="vr-clue-label">
            What is the {VOCAB_LANG_NAME[lang]} for
          </p>
          <p className="vr-clue">{round?.clue}</p>

          {left !== null && <Clock left={left} />}

          <form
            className="vr-entry"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="sr-only" htmlFor="vr-word">
              Your answer in {VOCAB_LANG_NAME[lang]}
            </label>
            <div className="vr-entry-row">
              <input
                id="vr-word"
                ref={input}
                className="vr-input"
                value={draft}
                disabled={!myMove}
                maxLength={24}
                // Every one of these matters on a phone, where the default is a
                // capitalised, autocorrected, spell-checked mess fighting a
                // player trying to type Polish on an English keyboard.
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                lang={lang}
                placeholder={iMissed ? "out this round" : lang === "ja" ? "in romaji" : "in Polish"}
                onChange={(event) =>
                  // Letters only, in any alphabet: Polish accents and a stray
                  // kana are fine, digits and punctuation never are.
                  setDraft(event.target.value.replace(/[^\p{L}]/gu, ""))
                }
              />
              <button
                type="submit"
                className="vr-submit"
                disabled={!myMove || draft.trim() === ""}
              >
                Say it
              </button>
            </div>
          </form>

          {/*
            Why the box is dead, said plainly. Being out of a round with no
            explanation reads as the app having broken — and the rule that put
            you there is the one rule of this game a new player will not have
            guessed.
          */}
          {iMissed && (
            <p className="vr-waiting" aria-live="polite">
              Wrong word — you are out of this round. The answer is coming.
            </p>
          )}
          {!mine && (
            <p className="vr-waiting">Watching. Take a seat to play.</p>
          )}
        </>
      )}
    </div>
  );
}
