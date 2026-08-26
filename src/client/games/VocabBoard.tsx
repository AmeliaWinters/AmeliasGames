import { useEffect, useRef, useState } from "react";
// Values from vocabDisplay.js, which imports nothing that reaches a reducer.
// The boundary matters twice here: the word lists must not reach the browser
// (they are the second largest thing in the repo), and neither must the answer
// to the clue currently on the screen, since a board that could resolve a clue
// itself would have ended the race. The types below are type-only and erase.
import {
  DEFAULT_LEVEL,
  HINT_ALLOWANCE,
  HOST,
  LEVEL_NAME,
  LEVEL_SCALE,
  LEVEL_WINDOW_MS,
  MODE_LABEL,
  MODE_NAME,
  REVEAL_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_LEVELS,
  VOCAB_MODES,
  canAct as seatCanAct,
  canHint as seatCanHint,
  clockCall,
  firstRight,
  formatClock,
  hintOf,
  hintsLeft,
  isPhrases,
  msLeftFor,
  rightTries,
  tryOf,
  vocabStats,
  windowLeft,
  windowMs,
} from "../../shared/games/vocabDisplay.js";
import type {
  VocabHow,
  VocabLang,
  VocabLevel,
  VocabMode,
  VocabMove,
  VocabRound,
  VocabSeatStat,
  VocabState,
  VocabTry,
} from "../../shared/games/vocabDisplay.js";
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";
import { Choice, ChoiceGroup } from "./Choice.js";
import { namer } from "./names.js";

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
  hard: "The first thousand, where a learner actually lives.",
  // The odd one out, and the setup screen is where that has to be said: the
  // other two are depths into one list and this is a different list entirely.
  // Whole sentences, so the box is longer and the hint gives you the first
  // letter of every word in it.
  phrases: "Whole sentences: the coffee, the light, the bill.",
};

/**
 * What each level is honestly claiming, said in the second person.
 *
 * Worth the words because the setting is self-reported and the whole handicap
 * rests on people picking truthfully. Nobody undersells a language on purpose,
 * but plenty of people will read "I speak it" as a boast they are not entitled
 * to make and pick the middle band out of modesty, so the copy names the
 * situation rather than the skill, and says what the choice costs.
 */
const LEVEL_SHORT: Record<VocabLevel, string> = {
  new: "just starting",
  some: "getting there",
  // Not `LEVEL_NAME` lowercased: that one is "I speak it", and the I is a word
  // a blanket `toLowerCase()` ruins on the one line four people read at once.
  fluent: "speaks it",
};

const LEVEL_BLURB: Record<VocabLevel, string> = {
  new: "Weeks in. All the time, all the points.",
  some: "You know some of it. The middle.",
  fluent: "You'd win every round. Less time, half the points.",
};

const count = new Intl.NumberFormat();

/** A time to a right answer. One decimal: whole seconds throw away the race. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `1st`, `2nd`, `13th`, `742nd`, read aloud by the rank, so it has to be right. */
function ordinal(n: number): string {
  const teen = n % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${count.format(n)}${suffix}`;
}

/**
 * How a seat's round ended, in one word.
 *
 * Said the same way in three places (the live scoreline, the reveal and the
 * end-of-game review) because a player learning what "gave up" costs should not
 * have to learn it twice under two names.
 */
const HOW_WORD: Record<VocabHow, string> = {
  right: "had it",
  wrong: "wrong",
  "gave-up": "passed",
  timeout: "ran out",
};

/**
 * The countdown. The same face Word Hunt and Word Duel use, see `clock.css`.
 *
 * Compact, because on this board the clock is not the point of the screen. The
 * clue is, and a 2rem countdown above a four-word definition would out-shout
 * the thing everybody is reading.
 */
function Clock({ left, label, call }: { left: number; label?: string; call?: string }) {
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
function Scores({
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
function Answer({
  round,
  lang,
  mode,
}: {
  round: VocabRound;
  lang: VocabLang;
  mode: VocabMode;
}) {
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
function Payout({
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
                {round.ask === "say" &&
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
                    {round.ask === "say" ? (
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
function SeatStats({
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

export function VocabBoard({ state, seat, names, canAct, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const clock = useServerNow(now, state.deadline !== null && state.phase !== "over");
  const left = state.deadline === null ? null : msLeftFor(state, clock);
  const mine = seat !== null;
  // Whether the room is answering with sentences. It changes the question's
  // wording, how long the box is, and which characters it will take.
  const phrasing = isPhrases(state.mode);
  // How long this seat's own box stays open, ticking. Not the same as the
  // round clock on a mixed table: the fluent player's fifteen seconds run out
  // with half the round still to go, and theirs is the number they need.
  const myWindow = seat === null ? 0 : windowLeft(state, seat, clock);
  const myTry = seat === null ? null : tryOf(state.round, seat);
  /*
    The one board here that does not gate on the `canAct` prop, and the reason
    is the window. `RoomView.canAct` is the server's answer *as of the message
    that carried it*, which is fine for every game whose permissions only
    change when somebody moves. But a window closes on the clock, with no
    message to announce it, so a seat whose fifteen seconds ran out would go on
    being offered a box the server has already stopped taking answers from.

    So the same predicate is run here against the ticking clock. It is the one
    the server will consult when the guess arrives, imported from the display
    module rather than reimplemented, which is what keeps the two honest. The
    `canAct` prop is still what decides it during setup, below.
  */
  const myMove = mine && seatCanAct(state, seat, clock) && left !== 0;
  // Gated on its own predicate for the same reason as `myMove`: an allowance
  // and a window both run out, and one of them runs out on the clock with no
  // message to announce it. `canHint` is the question the server will ask when
  // the move lands, imported rather than reimplemented.
  const myHintMove = mine && seatCanHint(state, seat, clock) && left !== 0;
  const myHint = seat === null ? null : hintOf(state.round, seat);
  const myHintsLeft = seat === null ? 0 : hintsLeft(state, seat);
  // The shape arrives already masked -- the board is never sent the word on a
  // say round -- so the letter count is read back out of the mask.
  const hintShape = myHint === null || myHint.shown === "" ? "" : myHint.shown;
  // Counted off the mask rather than off the answer, which the board does not
  // have: every letter is either shown or an underscore, and everything else in
  // there is the spacing `maskWord` added. The old `split(" ").length` counted
  // those too, which was harmless on a one-word answer and is nonsense on a
  // phrase.
  const hintLetters = [...hintShape].filter((ch) => ch === "_" || /\p{L}/u.test(ch)).length;
  const hintWords = hintShape === "" ? 0 : hintShape.split("   ").length;

  const nameFor = namer(names, seat);

  // A new clue is a new question, so the box is emptied and taken. Keyed on the
  // round count and the phase rather than on the clue text, so a refused word
  // (one the list has never heard of, which costs nothing) stays in the box for
  // the player to fix.
  useEffect(() => {
    setDraft("");
    if (state.phase === "asking") input.current?.focus();
  }, [state.history.length, state.phase]);

  function submit() {
    const word = draft.trim();
    if (word === "") return;
    onMove({ type: "guess", word });
  }

  // Setup
  if (state.phase === "setup") {
    // Setup is open to every seat now, because every seat has one control here,
    // its own level. The other two are still the host's, and the prop says only
    // that this socket may act at all.
    const host = mine && canAct && seat === HOST;
    const myLevel = seat === null ? null : (state.levels[seat] ?? null);
    return (
      <div className="board vr-board vr-setup">
        <p className="vr-brief">
          Everybody gets the same clue, what a word means, and types the word.
          Everyone who gets there scores, so being beaten to it does not put you
          out: the clue stays up until the whole table is done. Points go on how
          rare the word was and how quickly you had it. First to {TARGET} wins.
          Accents and spellings are optional: <em>zolty</em> finds{" "}
          <strong lang="pl">żółty</strong>, and <em>kohii</em> finds{" "}
          <strong lang="ja">koohii</strong>. A word we have never heard of costs
          you nothing, so a typo is not fatal, but a real word with the wrong
          meaning ends your round. Then the answer goes up for{" "}
          {Math.round(REVEAL_MS / 1000)} seconds with its meaning under it,
          which is the part you are here for.
        </p>

        {/*
          The two things a player has to know before the third round rather than
          during it: that the question turns around, and that they are holding
          three of something. Both are cheap to explain here and expensive to
          discover mid-clock.
        */}
        <p className="vr-brief">
          Every third round comes the other way about: the word goes up and you
          pick which of four meanings is right. Easier, so it pays half, and it
          is the round you can still play on a word you could never have spelled.
          You also get <strong>{HINT_ALLOWANCE} hints</strong> for the whole
          game. One buys you the first letter and the length of the word you are
          reaching for, and halves what that answer pays. Spending them is the
          only real decision in a round, so spend them on the words you nearly
          know.
        </p>

        <ChoiceGroup label="Language">
          {VOCAB_LANGS.map((lang) => (
            <Choice
              key={lang}
              name={VOCAB_LANG_NAME[lang]}
              note={LANG_NATIVE[lang]}
              noteLang={lang}
              chosen={state.lang === lang}
              disabled={!host}
              onPick={() => onMove({ type: "settings", lang, mode: state.mode })}
            />
          ))}
        </ChoiceGroup>

        {/*
          English is not on that list, and the setup screen is where anyone who
          came looking for it will look. Saying why costs two lines and stops it
          reading as an oversight, which it would, in an app whose other word
          game offers all three.
        */}
        <p className="vr-note">
          The clues are written in English, so English is the one language you
          cannot learn here. A word like <em>the</em> has no description to
          give you.
        </p>

        <ChoiceGroup label="Difficulty">
          {VOCAB_MODES.map((mode) => (
            <Choice
              key={mode}
              name={
                <>
                  {/*
                    The depth belongs beside the name where it is one, and
                    "Phrases - everyday phrases" is the name said twice. The
                    blurb under it is what tells that mode apart.
                  */}
                  {MODE_NAME[mode]}
                  {!isPhrases(mode) && ` - ${MODE_LABEL[mode]}`}
                </>
              }
              note={MODE_BLURB[mode]}
              chosen={state.mode === mode}
              disabled={!host}
              onPick={() =>
                state.lang !== null && onMove({ type: "settings", lang: state.lang, mode })
              }
            />
          ))}
        </ChoiceGroup>

        {/*
          The handicap, and the only thing on this screen each player sets for
          themselves. Placed under the room's two settings rather than above
          them, because it is the answer to a question the host's choices have
          just raised: how much Polish you have is not a thing you can say
          until you know it is Polish.

          Spectators get the block drawn and dead rather than hidden: somebody
          about to take a seat should be able to see the game has a handicap.
        */}
        <ChoiceGroup label="How much you already know" narrow>
          {VOCAB_LEVELS.map((level) => (
            <Choice
              key={level}
              name={LEVEL_NAME[level]}
              note={LEVEL_BLURB[level]}
              chosen={myLevel === level}
              disabled={!mine || !canAct}
              onPick={() => onMove({ type: "level", level })}
            >
              {/*
                The actual terms, in figures, under the sentence that describes
                them. The handicap is the one thing in this game a player can
                reasonably feel cheated by, and "half the points" is a claim
                they are entitled to see as a number before they agree to it.
              */}
              <span className="vr-choice-terms">
                {Math.round(LEVEL_WINDOW_MS[level] / 1000)}s -{" "}
                {LEVEL_SCALE[level] === 1 ? "full points" : `x${LEVEL_SCALE[level]} points`}
              </span>
            </Choice>
          ))}
        </ChoiceGroup>

        {/*
          What that setting actually does, in one sentence, because a number on
          a button is a rule nobody will believe until they have seen it, and a
          player whose box closes at fifteen seconds with no warning will think
          the game is broken.
        */}
        <p className="vr-note">
          Everyone answers the same clue and nobody waits to start. Saying you
          know the language buys you less time to answer in and scores you less
          for it, which is what lets somebody three weeks in take a word off
          you by being nine seconds slower.
        </p>

        {/* Who has claimed what, so the table can argue about it before the
            first clue rather than after the fifth. */}
        <ul className="vr-levels-said" aria-label="What everyone says they know">
          {state.levels.map((level, index) => (
            <li key={index} className="vr-level-said">
              <span className="vr-level-who">{nameFor(index)}</span>
              <span className="vr-level-what">{LEVEL_NAME[level]}</span>
            </li>
          ))}
        </ul>

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
                : `Start: ${VOCAB_LANG_NAME[state.lang]}, ${MODE_LABEL[state.mode]}`}
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
              : `${nameFor(0)} has picked ${VOCAB_LANG_NAME[state.lang]}, ${MODE_LABEL[state.mode]}.`}
          </p>
        )}

        {left !== null && <Clock left={left} />}
        <p className="vr-note">
          Nobody loses this bit. If the clock goes, the room gets Polish on
          normal and the first clue is dealt.
        </p>
      </div>
    );
  }

  const lang = state.lang ?? "pl";

  // The end
  if (state.phase === "over") {
    const stats = vocabStats(state);
    const rounds = state.round === null ? state.history : [...state.history, state.round];
    const ranked = [...stats.seats].sort((a, b) => b.points - a.points);
    return (
      <div className="board vr-board vr-end">
        <div className="vr-over" role="status">
          <p className="vr-verdict">
            {state.winner === null
              ? "Nobody got there. It's a tie."
              : state.winner === seat
                ? `You win, ${state.scores[state.winner]}-${Math.max(
                    ...state.scores.filter((_, i) => i !== state.winner),
                  )}.`
                : `${nameFor(state.winner)} wins with ${state.scores[state.winner]}.`}
          </p>
        </div>

        {/*
          Sorted by points rather than by seat, which the live scoreline is
          not. At the end the question is who won and by how much; during a
          round it is where *you* are, and a table that reorders itself under
          the player's eye every time somebody scores is unreadable.
        */}
        <ul className="vr-stat-seats">
          {ranked.map((stat) => (
            <SeatStats
              key={stat.seat}
              stat={stat}
              name={nameFor(stat.seat)}
              level={state.levels[stat.seat] ?? DEFAULT_LEVEL}
            />
          ))}
        </ul>

        {stats.quickest && (
          <p className="vr-highlight">
            <strong>Quickest</strong>: {nameFor(stats.quickest.attempt.seat)} had{" "}
            <span lang={lang}>{stats.quickest.round.answer?.word}</span> in{" "}
            {seconds(stats.quickest.attempt.ms)}.
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
          All {rounds.length} {rounds.length === 1 ? "round" : "rounds"}:{" "}
          {VOCAB_LANG_NAME[lang]}, {MODE_LABEL[state.mode]}
        </h3>
        <ol className="vr-reviews">
          {rounds.map((round, i) => (
            <Review key={i} round={round} lang={lang} nameFor={nameFor} />
          ))}
        </ol>
      </div>
    );
  }

  // A round
  const round = state.round;
  const revealing = state.phase === "reveal";
  // Which half of the round is the question. On a pick round the word is sent
  // and the clue is not, which is the reverse of every other round, so this
  // decides what goes in the big type as well as which controls are drawn.
  const picking = !revealing && round?.ask === "pick";
  // Everyone's result, in the order they finished, with the seats that never
  // answered on the end. `settle` writes those in, so this is the whole table.
  const payout = revealing && round ? round.tries : [];
  const first = revealing && round ? firstRight(round) : null;

  return (
    <div className="board vr-board">
      <Scores state={state} seat={seat} nameFor={nameFor} />

      <p className="vr-round">
        Round {state.history.length + 1} - {VOCAB_LANG_NAME[lang]},{" "}
        {MODE_LABEL[state.mode]}
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
            {first === null
              ? "Nobody had it."
              : first.seat === seat
                ? `You had it first, in ${seconds(first.ms)}.`
                : `${nameFor(first.seat)} had it first, in ${seconds(first.ms)}.`}
          </p>
          <Answer round={round} lang={lang} mode={state.mode} />
          <Payout round={round} tries={payout} lang={lang} nameFor={nameFor} />
          {left !== null && (
            <p className="vr-next" aria-hidden="true">
              Next clue in {Math.max(1, Math.ceil(left / 1000))}...
            </p>
          )}
        </>
      ) : (
        <>
          {/*
            The question, whichever half of the round that is. On a say round it
            is the clue and the word is not on the wire at all; on a pick round
            it is the word and the clue is the thing being withheld. Both go in
            `.vr-clue`, because the rule this board is built on is that exactly
            one thing on it is worth reading and it should be unmistakable which.
          */}
          {picking ? (
            <>
              <p className="vr-clue-label">What does this mean?</p>
              <p className="vr-clue" lang={lang}>
                {round?.answer?.word}
              </p>
              {/*
                The script under the romaji, the same pairing the reveal uses.
                A learner who only ever picks meanings off `sakura` never learns
                to read the thing, and a recognition round is the one place
                there is room to show both without crowding the question.
              */}
              {round?.answer?.script && (
                <p className="vr-word-script" lang="ja">
                  {round.answer.script}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="vr-clue-label">
                {phrasing
                  ? `How do you say this in ${VOCAB_LANG_NAME[lang]}?`
                  : `What is the ${VOCAB_LANG_NAME[lang]} for`}
              </p>
              <p className="vr-clue">{round?.clue}</p>
            </>
          )}

          {/*
            Two clocks, and only when they differ. The round's is how long the
            clue stays up; this seat's is how long its own box is open, which
            on a mixed table runs out first and is the one that governs. Drawing
            both always would be noise for the seat that has the full round, so
            the personal one appears only when it is shorter.
          */}
          {left !== null && <Clock left={left} label="on the clue" call="on the clue" />}
          {mine && myTry === null && myWindow > 0 && myWindow < (left ?? 0) && (
            <Clock left={myWindow} label="yours" call="in your window" />
          )}

          {picking ? (
            <div className="vr-entry">
              {/*
                Four meanings, one right. A list rather than a bare row of
                buttons so a screen reader announces how many there are before
                reading them, which is the difference between four options and
                an unknown number of them.

                The move carries the index and not the meaning: the correct one
                is the round's clue and the clue is redacted while the round
                runs, so this board could not name the right answer if it tried.
              */}
              <ul className="vr-options" aria-label="What it means">
                {round?.options.map((option, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="vr-option surface"
                      disabled={!myMove}
                      onClick={() => onMove({ type: "choose", option: index })}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="vr-give-up"
                disabled={!myMove}
                onClick={() => onMove({ type: "pass" })}
              >
                I don't know it
              </button>
            </div>
          ) : (
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
                  // A sentence needs the room a word does not. Sized off the
                  // longest phrase in the list with a little air, rather than
                  // generously, because the cap is also what stops the box
                  // being a place to paste an essay.
                  maxLength={phrasing ? 64 : 24}
                  // Every one of these matters on a phone, where the default is a
                  // capitalised, autocorrected, spell-checked mess fighting a
                  // player trying to type Polish on an English keyboard.
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  lang={lang}
                  placeholder={
                    myTry !== null
                      ? "done this round"
                      : !myMove
                        ? "time's up"
                        : lang === "ja"
                          ? phrasing
                            ? "the whole phrase, in romaji"
                            : "in romaji"
                          : phrasing
                            ? "the whole phrase"
                            : "in Polish"
                  }
                  onChange={(event) =>
                    // Letters only, in any alphabet: Polish accents and a stray
                    // kana are fine, digits and punctuation never are. A phrase
                    // needs the spaces and the apostrophe as well, and gets the
                    // question mark too -- not because the answer is checked
                    // against it (the fold drops all three) but because a
                    // player typing *gdzie jest toaleta?* should not watch the
                    // box eat the keys as they go.
                    setDraft(
                      event.target.value.replace(
                        phrasing ? /[^\p{L}\s'?,!.-]/gu : /[^\p{L}]/gu,
                        "",
                      ),
                    )
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

              {/*
                The shape of the word, once it has been paid for. Drawn as
                spaced underscores and read out as prose, because a screen
                reader handed the mask itself says "z underscore underscore
                underscore underscore", which is the hint destroyed by being
                announced. The visual is hidden from it and the sentence is
                hidden from everyone else.
              */}
              {hintShape !== "" && (
                <p className="vr-hint">
                  <span className="vr-hint-shape" lang={lang} aria-hidden="true">
                    {hintShape}
                  </span>
                  <span className="sr-only" aria-live="polite">
                    Your hint: it starts with {[...hintShape][0]} and is{" "}
                    {hintLetters} letters long
                    {/*
                      A phrase's hint is the first letter of every word in it,
                      so the shape a sighted player reads has a fact in it that
                      "starts with z" does not carry. Said rather than left to
                      the underscores, which are hidden from a screen reader on
                      purpose.
                    */}
                    {hintWords > 1 && `, in ${hintWords} words`}.
                  </span>
                </p>
              )}

              {/*
                Buying one. Between the box and "I don't know it" because that
                is the order the decision is actually made in: try, then spend,
                then give up. It says what it costs on its face, since a control
                that halves your score without warning is one nobody presses
                twice.
              */}
              <button
                type="button"
                className="vr-hint-buy"
                disabled={!myHintMove}
                onClick={() => onMove({ type: "hint" })}
              >
                {myHint !== null
                  ? "Hint taken, half points"
                  : myHintsLeft === 0
                    ? "No hints left"
                    : `Hint (${myHintsLeft} left), half points`}
              </button>

              {/*
                Giving up, which is a real move rather than an escape hatch: the
                round now ends when the last seat is done, so this is the button
                that gets the table to the answer. Outside the row and quieter
                than the submit, because it must never be the thing a player hits
                by reflex while reaching for it.
              */}
              <button
                type="button"
                className="vr-give-up"
                disabled={!myMove}
                onClick={() => onMove({ type: "pass" })}
              >
                I don't know it
              </button>
            </form>
          )}

          {/*
            Why the box is dead, said plainly. Being out of a round with no
            explanation reads as the app having broken, and the two rules that
            put you there are the two a new player will not have guessed.
          */}
          {myTry !== null && (
            <p className="vr-waiting" aria-live="polite">
              {myTry.how === "right"
                ? "That's it. Waiting for the others, then the answer."
                : myTry.how === "wrong"
                  ? picking
                    ? "Not that one, so that's your round. The answer is coming."
                    : "Wrong word, so that's your round. The answer is coming."
                  : myTry.how === "gave-up"
                    ? "Passed. Waiting for the others, then the answer."
                    : "Your time went. The answer is coming."}
            </p>
          )}
          {mine && myTry === null && !myMove && (
            <p className="vr-waiting" aria-live="polite">
              Your {Math.round(windowMs(state, seat ?? 0) / 1000)} seconds are
              up, and you said you knew the language. The answer is coming.
            </p>
          )}
          {!mine && <p className="vr-waiting">Watching. Take a seat to play.</p>}
        </>
      )}
    </div>
  );
}
