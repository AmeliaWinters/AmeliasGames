/**
 * The pieces every Vocab Race screen is built out of: the clock, the live
 * scoreline, the word being spoken, the answer as it is revealed, what the
 * round paid, and the two end-of-game summaries.
 *
 * Split from the board because each of these is a pure function of its props
 * and none of them may reach for the board's state. That is the seam worth
 * keeping: the board decides *what is true* (whose window is open, what the
 * clock says, whether this seat may move) and hands it down, and nothing here
 * re-derives any of it.
 */
import { useEffect } from "react";
import {
  TARGET,
  VOCAB_LANG_NAME,
  clockCall,
  formatClock,
  isPhrases,
  rightTries,
  tryOf,
} from "../../../shared/games/vocabDisplay.js";
import type {
  VocabLang,
  VocabLevel,
  VocabMode,
  VocabRound,
  VocabSeatStat,
  VocabState,
  VocabTry,
} from "../../../shared/games/vocabDisplay.js";
import { hush, speak, useCanSpeak } from "../../speech.js";

import { HOW_WORD, LEVEL_SHORT, SPEAKER, URGENT_MS, count, ordinal, seconds } from "./copy.js";

/**
 * The countdown. The same face Word Hunt and Word Duel use, see `clock.css`.
 *
 * Compact, because on this board the clock is not the point of the screen. The
 * clue is, and a 2rem countdown above a four-word definition would out-shout
 * the thing everybody is reading.
 */
export function Clock({ left, label, call }: { left: number; label?: string; call?: string }) {
  // Two of these can be on screen at once, the round's and this seat's, and
  // `clockCall` is coarse by design, so both would announce the identical
  // "30 seconds left." with nothing to say which was which. The suffix is what
  // keeps them apart for a screen reader; sighted players have the labels.
  const said = clockCall(left, true);
  const spoken = said === "" || call === undefined ? said : `${said.replace(/\.$/, "")} ${call}.`;
  return (
    <p
      className={["clock compact", left <= URGENT_MS ? "urgent" : "", left === 0 ? "done" : ""]
        .filter(Boolean)
        .join(" ")}
      role="timer"
      // Announced only when the wording changes, see `clockCall`. A countdown
      // read out four times a second is unusable with a screen reader on.
      aria-live="off"
    >
      <span className="clock-face">{left === 0 ? "Time" : formatClock(left)}</span>
      <span className="clock-note">{left === 0 ? "gone" : (label ?? "left")}</span>
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </p>
  );
}

/**
 * The running score, and who is still typing.
 *
 * Both facts on one row because they are read together: a player deciding
 * whether to risk a guess is weighing how close somebody is to a hundred
 * against how many of them are still in. Marked with a class rather than by
 * fading the row, because a seat that has finished is still a score you need to
 * see.
 *
 * What it deliberately does *not* draw is what a finished seat scored. That
 * number is redacted on the wire while the round runs, being a function of the
 * word's rank, so there is nothing here to draw even if this wanted to.
 */
export function Scores({
  state,
  seat,
  nameFor,
}: {
  state: VocabState;
  seat: number | null;
  nameFor: (index: number) => string;
}) {
  const running = state.phase === "asking";
  return (
    <ol className="vr-scores" aria-label="Scores">
      {state.scores.map((score, index) => {
        const done = running ? tryOf(state.round, index) : null;
        return (
          <li
            key={index}
            className={[
              "vr-score",
              index === seat ? "mine" : "",
              done ? "out" : "",
              score >= TARGET ? "won" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-seat={index % 4}
          >
            <span className="vr-score-name">{nameFor(index)}</span>
            {done && (
              <span className={`vr-score-how how-${done.how}`}>
                <span aria-hidden="true">{HOW_WORD[done.how]}</span>
                <span className="sr-only">, {HOW_WORD[done.how]} this round</span>
              </span>
            )}
            <span className="vr-score-points">
              <span aria-hidden="true">{score}</span>
              <span className="sr-only">
                {score} of {TARGET}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A clue you listen to.
 *
 * The whole of a `hear` round's question: a big button that says the word, and
 * nothing else on the screen that could answer it. The four meanings are drawn
 * below by the same code that draws a `pick`'s, since from the options down the
 * two rounds are identical.
 *
 * **It says the word once, by itself, when the clue goes up**, and that is the
 * part worth defending. A round that waited to be pressed would spend its first
 * two seconds teaching the player that this round has a button on it, every
 * time, and the round is thirty seconds long. Keyed on `began` rather than on
 * the word so that a retry of a word already met this game still speaks: the
 * word is the same string, the round is not.
 *
 * Autoplay is allowed here because it is not autoplay in the sense browsers
 * block. Speech synthesis is exempt from the gesture requirement on every
 * engine this runs on once anything on the page has been touched, and by the
 * time a clue is up the player has pressed at least "start". A device that
 * refuses anyway is a device where `speak` returns false and the round has
 * already fallen back to a printed word; see `hearing` in the board.
 */
export function Heard({ word, lang, began }: { word: string; lang: VocabLang; began: number }) {
  useEffect(() => {
    if (word === "") return;
    speak(word, lang);
    return hush;
  }, [began, word, lang]);

  return (
    <button
      type="button"
      className="vr-speak vr-speak-clue"
      onClick={() => speak(word, lang)}
    >
      <span aria-hidden="true">{SPEAKER}</span>
      {/*
        The word is never in the accessible name, which would be handing a
        screen reader the answer this button exists to withhold. What a reader
        gets is what a sighted player gets: a control that plays the clue.
      */}
      <span className="sr-only">Play the word again</span>
    </button>
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
 * form when the word asked about was an inflection, `jestem` shown and `być`
 * learned, which is most of what the Polish list is for.
 */
export function Answer({
  round,
  lang,
  mode,
}: {
  round: VocabRound;
  lang: VocabLang;
  mode: VocabMode;
}) {
  const answer = round.answer;
  const canSpeak = useCanSpeak(lang);

  // Said once, as the reveal opens, on every device that can. This is the
  // moment the word is worth hearing: the meaning is on the screen above it and
  // the player has just found out whether they knew it. It is also the only
  // audio a `say`-only table ever gets, which is most tables, so a fluent
  // player and a beginner both leave a game having heard every word in it.
  //
  // Keyed on the word rather than on the phase so a re-render inside the reveal
  // does not say it again, and hushed on the way out so the next clue does not
  // arrive over the top of the last answer.
  const word = answer?.word ?? "";
  useEffect(() => {
    if (word === "") return;
    speak(word, lang);
    return hush;
  }, [word, lang]);

  if (answer === null) return null;
  return (
    <div className="vr-answer">
      <p className="vr-answer-clue">{round.clue}</p>
      <p className="vr-answer-word" lang={lang}>
        {answer.word}
      </p>
      {/*
        Replay, for the player who was reading the meaning while it played. Not
        drawn at all where there is no voice, rather than drawn and dead: a
        speaker button that does nothing is worse than no speaker button, since
        it reads as the app being broken rather than as the phone being quiet.
      */}
      {canSpeak && (
        <button
          type="button"
          className="vr-speak vr-speak-small"
          onClick={() => speak(answer.word, lang)}
        >
          <span aria-hidden="true">{SPEAKER}</span>
          <span className="sr-only">Hear it again</span>
        </button>
      )}
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
        number, because that is what it is. A band ("common", "rare") says
        less, since #12 and #190 are both "very common" and are nothing like
        each other. It is also now the first term in what the round paid out,
        so it is a number players have a reason to read.
      */}
      {/*
        Not drawn in phrase mode, where the number would be a lie with a
        sentence under it: a phrase's rank is where it was written down in a
        hand-made list, not how common it is, and "#31, the 31st commonest
        Polish word" is false twice about *gdzie jest toaleta?*.
      */}
      {!isPhrases(mode) && (
        <p className="vr-answer-rank">
          <span aria-hidden="true">#{count.format(answer.rank)}</span>
          <span className="sr-only">
            the {ordinal(answer.rank)} commonest {VOCAB_LANG_NAME[lang]} word
          </span>
        </p>
      )}

      {/*
        The other words that would have been taken.

        The reducer has always been this generous -- `accepts` is every word in
        the language filed under any of the clue's senses, so a learner who
        answers "small" with a synonym of the word the clue was cut from is
        marked right -- and until this line existed the only way anybody found
        that out was by accidentally doing it. A player who typed a real Polish
        word for small and was told they were wrong was being told something
        false about the rules.

        Under the answer rather than beside it, and in small type: it is a
        footnote to the word, and the word is still what the six seconds are
        for. Capped at `ALSO_SHOWN` in the dictionary, and absent on a clue with
        no synonyms and in phrase mode, which is most rounds.
      */}
      {answer.also.length > 0 && (
        <p className="vr-answer-also">
          also{" "}
          {answer.also.map((other, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <strong lang={lang}>{other.word}</strong>
              {other.script && (
                <span className="vr-also-script" lang="ja">
                  {" "}
                  {other.script}
                </span>
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * What the round paid, seat by seat, in the order they finished.
 *
 * The scoreboard of the redesign, and the thing that has to be legible for any
 * of it to feel fair: a learner who scored 14 while the fluent speaker who
 * beat them by nine seconds scored 9 should be able to see exactly that, on
 * one screen, without doing arithmetic. So every seat gets a row, including
 * the ones that scored nothing, because "you passed and it cost you nothing"
 * is also worth seeing.
 */
export function Payout({
  round,
  tries,
  lang,
  nameFor,
}: {
  round: VocabRound;
  tries: VocabTry[];
  lang: VocabLang;
  nameFor: (index: number) => string;
}) {
  const best = tries.reduce((high, attempt) => Math.max(high, attempt.points), 0);
  return (
    <ul className="vr-payout" aria-label="What the round paid">
      {tries.map((attempt) => (
        <li
          key={attempt.seat}
          className={[
            "vr-pay",
            `how-${attempt.how}`,
            attempt.points > 0 && attempt.points === best ? "best" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="vr-pay-who">{nameFor(attempt.seat)}</span>
          <span className="vr-pay-what">
            {attempt.how === "right" ? (
              <>
                {/*
                  What they typed, when it is not what the word looks like.
                  This is where the accent folding stops being invisible: a
                  player who typed `zolty` should see that it counted *and* see
                  żółty, which is the moment the spelling is taught rather than
                  demanded.

                  Nothing to show on a pick round: what they "said" there is the
                  clue, which is already the largest thing on the screen.
                */}
                {attempt.ask === "say" &&
                attempt.said !== "" &&
                attempt.said !== round.answer?.word ? (
                  <span lang={lang}>{attempt.said}</span>
                ) : (
                  HOW_WORD.right
                )}
                <span className="vr-pay-ms"> - {seconds(attempt.ms)}</span>
              </>
            ) : (
              <>
                {HOW_WORD[attempt.how]}
                {/*
                  The wrong answer, held back all round and shown now. It is the
                  second most useful thing on this screen: a player who
                  answered "small" with the Polish for "short" has learned
                  something specific, and hiding it would waste the mistake.

                  Tagged `lang` only on a say round. A wrong pick is an English
                  meaning, and telling a screen reader to pronounce "to sleep"
                  as Polish is how that turns into noise.
                */}
                {attempt.how === "wrong" && attempt.said !== "" && (
                  <span className="vr-pay-said">
                    {" "}
                    (
                    {attempt.ask === "say" ? (
                      <span lang={lang}>{attempt.said}</span>
                    ) : (
                      attempt.said
                    )}
                    )
                  </span>
                )}
              </>
            )}
            {/*
              What the answer cost. On the same line as what it paid, because
              the two only mean anything together -- a hinted 5 and a cold 10
              are the same round played two ways, and this is the only screen
              that ever says so.
            */}
            {attempt.hinted && <span className="vr-pay-hinted"> hinted</span>}
          </span>
          <span className="vr-pay-points">
            <span aria-hidden="true">{attempt.points > 0 ? `+${attempt.points}` : "-"}</span>
            <span className="sr-only">
              {attempt.points > 0 ? `scored ${attempt.points}` : "scored nothing"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One row of the review at the end: what was asked, and how the table did. */
export function Review({
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
  const right = rightTries(round);
  return (
    <li className={right.length === 0 ? "vr-review nobody" : "vr-review"}>
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
        {right.length === 0
          ? "nobody"
          : right
              .map(
                (attempt) =>
                  `${nameFor(attempt.seat)} +${attempt.points}${attempt.hinted ? " (hint)" : ""}`,
              )
              .join(", ")}
      </span>
    </li>
  );
}

/** How one seat played. Zero-round seats are drawn, because being beaten to
 * every word is a result and hiding it would flatter the table. */
export function SeatStats({
  stat,
  name,
  level,
}: {
  stat: VocabSeatStat;
  name: string;
  level: VocabLevel;
}) {
  return (
    <li className="vr-stat">
      <span className="vr-stat-name">{name}</span>
      <span className="vr-stat-points">{stat.points}</span>
      <span className="vr-stat-line">
        {stat.won} right
        {stat.won > 0 && `, ${seconds(stat.ms)} each`}
        {stat.missed > 0 && ` - ${stat.missed} wrong`}
        {stat.gaveUp > 0 && ` - ${stat.gaveUp} passed`}
        {/*
          The only number on this line that records a *choice* rather than a
          result. Two players on the same score played differently if one of
          them spent three hints getting there, and the scoreline cannot say so.
        */}
        {stat.hinted > 0 && ` - ${stat.hinted} on a hint`}
        {/*
          What they said they knew, on the same line as what it got them. The
          two are only meaningful together: six right answers means one thing
          from somebody three weeks in and quite another from a native speaker
          scoring half for each of them. It is also the line that settles the
          argument about whether somebody undersold themselves, which is the
          argument this setting invites.
        */}
        {` - ${LEVEL_SHORT[level]}`}
      </span>
    </li>
  );
}
