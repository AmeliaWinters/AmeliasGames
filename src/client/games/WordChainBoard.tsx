import { useEffect, useRef, useState } from "react";
// Values from wordChainDisplay.js, which imports nothing that reaches a
// reducer: the board must never pull the three word lists into the client
// bundle. The types below are type-only, so they erase entirely.
import {
  LANGS,
  LANG_NAME,
  LIST_SIZE,
  MIN_LENGTH,
  TURN_MS,
  chainStats,
  clockCall,
  formatClock,
  lockedFor,
  msLeftFor,
  scoreFor,
  stoppedSeat,
  targetScore,
  turnMsFor,
  wordPoints,
} from "../../shared/games/wordChainDisplay.js";
import type {
  ActiveCooldown,
  ChainHighlight,
  ChainLang,
  ChainLink,
  ChainMiss,
  SeatStat,
  WcMove,
  WcState,
} from "../../shared/games/wordChainDisplay.js";
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<WcState, WcMove>;

/** Under this much left, the clock starts shouting about it. */
const URGENT_MS = 15 * 1000;

/**
 * Where the clock starts shouting, on a turn that is only `had` long.
 *
 * Never more than half the turn, because the allowance shrinks as the chain
 * grows (see `turnMsFor`) and a flat fifteen seconds would have the clock red
 * from the moment a late turn started, which is a warning that has stopped
 * being one. Half is the same shape of warning the opening minute gets at
 * fifteen: enough time left to do something about it.
 */
function urgentAt(had: number): number {
  return Math.min(URGENT_MS, had / 2);
}

/** What each language is called on its own terms, under the English name. */
const LANG_NATIVE: Record<ChainLang, string> = {
  en: "English",
  pl: "polski",
  ja: "日本語",
};

/** Thousands separated, because `1501 words` reads as a year. */
const count = new Intl.NumberFormat();

/**
 * How long the chain is, in words.
 *
 * One number for both players rather than a tally each: neither seat built the
 * chain alone, and the per-seat tally is the score, which is drawn separately
 * and means something else. See `Scores`.
 */
function words(n: number): string {
  return `${count.format(n)} ${n === 1 ? "word" : "words"}`;
}

/** A score, spoken. Singular at one, because the game reaches one. */
function points(n: number): string {
  return `${count.format(n)} ${n === 1 ? "point" : "points"}`;
}

/**
 * A mean answer time. One decimal, because whole seconds throw away the
 * difference between a word that arrived instantly and one that took a beat,
 * which over a game is the whole of what this number is measuring.
 */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * How common a seat's words were, as a share of their own language's list.
 *
 * A share rather than a mean rank, because the three lists are different sizes
 * and a mean rank compared across them measures the lists. See `LIST_SIZE`.
 * Rounded away from zero: nobody's words average "the top 0% of English", and
 * up is the honest way to round a boast about rarity.
 */
function share(fraction: number): string {
  return `top ${Math.max(1, Math.ceil(fraction * 100))}%`;
}

/**
 * How much of the minute was still there, in whole seconds.
 *
 * Whole, unlike the averages, because this one is a story rather than a
 * measurement: "with two seconds left" is the thing you tell someone
 * afterwards, and "with 2.3s left" is not.
 *
 * `had` is that turn's own allowance, which is not the minute once the chain
 * has run past three words. The deadline it beat is long overwritten by then,
 * so it is recovered from the word's place in the chain instead.
 */
function toSpare(ms: number, had: number): string {
  const left = Math.round((had - ms) / 1000);
  return left === 0 ? "with less than a second left" : `with ${left} second${left === 1 ? "" : "s"} left`;
}

/** `1st`, `2nd`, `13th`, `742nd`, spoken aloud by the rank, so it has to be right. */
function ordinal(n: number): string {
  const teen = n % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${count.format(n)}${suffix}`;
}

/**
 * How common the word was: its place in its language's frequency list.
 *
 * A bare number, because that is what it is. A band ("common", "rare") was the
 * other option and it says less: `#12` and `#190` are both "very common" and
 * are nothing like each other. The rank is only comparable within a language,
 * so the language is named beside it for the screen reader, the one place there
 * is room to say so.
 */
function Rank({ link }: { link: ChainLink }) {
  return (
    <span className="wc-rank">
      <span aria-hidden="true">#{count.format(link.rank)}</span>
      <span className="sr-only">
        the {ordinal(link.rank)} commonest {LANG_NAME[link.lang]} word{" "}
      </span>
    </span>
  );
}

/**
 * One word in the chain.
 *
 * The gloss is the whole reason to play, so it is not a tooltip or an
 * afterthought: every word that is not English carries its English meaning
 * directly under it, and Japanese carries its own script as well, because a
 * learner who only ever sees `sakura` never learns to read 桜.
 *
 * Polish inflections show the dictionary form beside the gloss: `jestem`
 * played, `być` learned. That pairing is most of what the Polish list is for,
 * and why the reducer carries `lemma` on the wire at all.
 */
function Link({ link, mine, name }: { link: ChainLink; mine: boolean; name: string }) {
  const foreign = link.lang !== "en";
  return (
    <li className={mine ? "wc-link mine" : "wc-link"}>
      {/*
        The trailing spaces are not stray. These sit in separate grid areas, so
        a screen reader runs their text together, "Youżółtyyellow", and a
        space between grid *items* would become an anonymous grid item and
        shift the layout. Inside the span it is free: the grid collapses it and
        the reader gets its word boundary.
      */}
      <span className="wc-who">{name} </span>
      <span className="wc-word" lang={link.lang}>
        {link.word}{" "}
      </span>
      {/*
        What the word scored, which is its length, so this is the same fact
        as the word itself, said in the currency the game is settled in. Beside
        the word rather than under it: it is read while scanning the column,
        and it is the number a player is doing arithmetic with when they are
        behind and choosing what to reach for.
      */}
      <span className="wc-points">
        <span aria-hidden="true">+{wordPoints(link.word)}</span>
        <span className="sr-only">, {points(wordPoints(link.word))} </span>
      </span>
      {link.script && (
        <span className="wc-script" lang="ja">
          {link.script}{" "}
        </span>
      )}
      {foreign && (link.gloss || link.lemma) && (
        <span className="wc-gloss">
          {link.lemma && <em className="wc-lemma">{link.lemma}</em>}
          {link.gloss}
        </span>
      )}
      <Rank link={link} />
    </li>
  );
}

/**
 * The letter the next word has to start with, said once and largely, with the
 * number of words still behind it.
 *
 * The count is the same for both players and shown to both. Not a hint about
 * any particular word, since knowing that 1,501 English words start with A does
 * not put one of them in your head, but it does tell you whether you are being
 * asked something ordinary or something the game has nearly run dry, and
 * watching it fall is most of the late game.
 */
function Carry({ letter, available }: { letter: string; available: number | null }) {
  const n = available === null ? null : count.format(available);
  return (
    <p
      className="wc-carry"
      aria-label={
        n === null
          ? `Next word starts with ${letter.toUpperCase()}`
          : `Next word starts with ${letter.toUpperCase()}. ${n} words left.`
      }
    >
      <span aria-hidden="true">↓</span>
      <strong>{letter.toUpperCase()}</strong>
      {n !== null && (
        <span className="wc-left" aria-hidden="true">
          {n} left
        </span>
      )}
    </p>
  );
}

/**
 * The endings this player has worn out, and how long each is gone for.
 *
 * Yours only, since the server sends a seat nothing but its own cooldowns, and
 * shown on their turn and yours alike: the whole value of knowing E is gone for
 * two turns is having the two turns to plan around it, and a restriction that
 * only appears at the moment it refuses you is a trap rather than a rule.
 *
 * Nothing is drawn when nothing is locked, rather than an empty row saying so.
 * A player with no cooldowns has no condition to be told about, and the
 * absence of the block is the clearest possible way to say it.
 */
function Cooling({ locks }: { locks: ActiveCooldown[] }) {
  if (locks.length === 0) return null;
  return (
    <p
      className="wc-cooling"
      // Read as a sentence rather than as a list of letters and numbers,
      // because a screen reader announcing "E 2 D 1" conveys nothing.
      aria-label={`You cannot end a word on ${locks
        .map((cool) => `${cool.letter.toUpperCase()} for ${cool.turns} more turn${cool.turns === 1 ? "" : "s"}`)
        .join(", or ")}.`}
    >
      <span className="wc-cooling-label" aria-hidden="true">
        Not ending in
      </span>
      <span className="wc-cooling-letters" aria-hidden="true">
        {locks.map((cool) => (
          <span key={cool.letter} className="wc-cool">
            <strong>{cool.letter.toUpperCase()}</strong>
            {/* The number is the point: a letter that is gone for four turns
                is a different fact from one that is back next turn, and the
                letter alone would read as gone for good. */}
            <span className="wc-cool-turns">{cool.turns}</span>
          </span>
        ))}
      </span>
    </p>
  );
}

/**
 * The two scores, side by side, above a chain that scrolls.
 *
 * The one thing on this screen that must never scroll away: from the moment a
 * minute goes it is what the game is decided on, and during a chase it is the
 * only way to read what is happening. Both seats are always drawn, including
 * at nil, because a scoreboard with one number on it is not one.
 *
 * Not a live region. Every change to it is the direct consequence of a word
 * that has just been announced, and a screen reader saying "twelve, seven"
 * after every one of them is chatter on top of the thing it is derived from.
 */
function Scores({
  state,
  seat,
  nameFor,
}: {
  state: WcState;
  seat: number | null;
  nameFor: (index: number) => string;
}) {
  const stopped = stoppedSeat(state);
  return (
    <ul className="wc-scores" aria-label="Score">
      {state.langs.map((_, index) => (
        <li
          key={index}
          className={[
            "wc-score",
            index === seat ? "mine" : "",
            index === stopped ? "out" : "",
            state.phase !== "over" && state.at === index ? "on" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="wc-score-who">{nameFor(index)}</span>
          <span className="wc-score-points">
            <span aria-hidden="true">{count.format(scoreFor(state, index))}</span>
            <span className="sr-only">{points(scoreFor(state, index))}</span>
          </span>
          {/* Said once, here, rather than in the banner as well: a seat that is
              out stays out, and the banner is about what is still to happen. */}
          {index === stopped && <span className="wc-score-out">out</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What is left of the game once one player is out of the chain.
 *
 * The chase is the state of this game most likely to be misread, since a
 * player watching their opponent take turn after turn alone needs telling why,
 * so it says the arithmetic outright: how many points are needed, by whom, and
 * that a draw is not enough. `role="status"` because it appears without anybody
 * pressing anything.
 */
function Chasing({
  state,
  seat,
  nameFor,
}: {
  state: WcState;
  seat: number | null;
  nameFor: (index: number) => string;
}) {
  const stopped = stoppedSeat(state);
  const target = targetScore(state);
  if (stopped === null || target === null) return null;
  const needed = target + 1 - scoreFor(state, state.at);
  const chaser = state.at;
  return (
    <p className="wc-chase" role="status">
      <strong>
        {chaser === seat
          ? `You need ${needed} more ${needed === 1 ? "point" : "points"} to win.`
          : `${nameFor(chaser)} needs ${needed} more ${needed === 1 ? "point" : "points"} to win.`}
      </strong>{" "}
      {nameFor(stopped)} {stopped === seat ? "are" : "is"} out on{" "}
      {points(target)}, and the chain is {chaser === seat ? "yours" : `${nameFor(chaser)}'s`}{" "}
      alone until it is beaten, and level is not beaten.
    </p>
  );
}

/**
 * A minute somebody lost, and the word they could have said.
 *
 * One of these per miss, so a game where both players ran out shows both
 * words. The reveal is the reason to play, and the second one does not get to
 * overwrite the first.
 */
function Reveal({ miss, name }: { miss: ChainMiss; name: string }) {
  const how = miss.gaveUp ? "gave up" : "ran out of time";
  if (!miss.reveal) return null;
  const word = miss.reveal;
  return (
    <>
      {/*
        The visual block below is a label, a large word, a line of Japanese and
        a gloss in four separate boxes, which a screen reader reads as one
        run-on string. This is the same thing said once, properly, and the
        block is hidden from the reader rather than left to garble it:
        `wc-over` is a live region, so what it announces is a sentence or it is
        nothing.
      */}
      <p className="sr-only">
        {name} {how}. The commonest word that would have worked: {word.word}
        {word.script && <span lang="ja">, written {word.script}</span>}
        {word.gloss && `, meaning ${word.gloss}`}.
      </p>
      <div className="wc-reveal" aria-hidden="true">
        <span className="wc-reveal-label">
          {name} {how}, and this is the commonest word that would have worked
        </span>
        <span className="wc-word" lang={word.lang}>
          {word.word}
        </span>
        {word.script && (
          <span className="wc-script" lang="ja">
            {word.script}
          </span>
        )}
        {word.lang !== "en" && (
          <span className="wc-gloss">
            {word.lemma && <em className="wc-lemma">{word.lemma}</em>}
            {word.gloss}
          </span>
        )}
      </div>
    </>
  );
}

function Clock({ left, had }: { left: number; had: number }) {
  return (
    <p
      className={[
        "clock compact",
        left <= urgentAt(had) ? "urgent" : "",
        left === 0 ? "done" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="timer"
      // Announced only when the wording changes, see `clockCall`. A countdown
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

/** One number and what it is. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="wc-stat">
      <span className="wc-stat-value">{value}</span>
      <span className="wc-stat-label">{label}</span>
    </span>
  );
}

/**
 * How one seat played, in five numbers.
 *
 * Averages, with one exception: the loser has had one more turn than the
 * winner, so a total words-said column would report who lost rather than how
 * they played. The exception is the score, which is a total because it is the
 * result, and averaging it would hide the thing the game was settled on.
 *
 * Said twice, once for the screen and once for the reader: the same bargain
 * the reveal makes just above, and for the same reason. Four values and four
 * labels in eight boxes are read as one unbroken string, and `wc-over` is a
 * live region, so what it announces has to be a sentence.
 */
function SeatStats({ stat, name }: { stat: SeatStat; name: string }) {
  const lang = stat.lang ? LANG_NAME[stat.lang] : "";
  return (
    <li className="wc-stat-seat">
      <p className="sr-only">
        {name} scored {points(stat.points)} from {words(stat.said)} in {lang},{" "}
        {stat.letters.toFixed(1)} letters long on average,{" "}
        {share(stat.percentile)} of the {lang} list, taking {seconds(stat.ms)} a
        word.
      </p>
      <div aria-hidden="true">
        <p className="wc-stat-who">
          {name} - {lang}
        </p>
        <div className="wc-stat-row">
          <Stat value={count.format(stat.points)} label={stat.points === 1 ? "point" : "points"} />
          <Stat value={count.format(stat.said)} label={stat.said === 1 ? "word" : "words"} />
          <Stat value={stat.letters.toFixed(1)} label="letters" />
          <Stat value={share(stat.percentile)} label="of the list" />
          <Stat value={seconds(stat.ms)} label="to answer" />
        </div>
      </div>
    </li>
  );
}

/**
 * The end-of-game numbers, under the reveal.
 *
 * Under it on purpose. The reveal is the reason to play and stays the last
 * large thing on the screen; this is what you read afterwards, if you are the
 * sort of person who reads it.
 */
function Stats({
  state,
  nameFor,
}: {
  state: WcState;
  nameFor: (index: number) => string;
}) {
  const stats = chainStats(state);
  // A seat that never got a word in has nothing to average. That is one turn
  // into a game the opener lost, and a row of zeroes beside a real one reads
  // as a thrashing rather than as an empty set.
  const played = stats.seats.filter((s) => s.said > 0);
  // Only worth calling out if it was actually close. The slowest word of a
  // brisk game took eleven seconds and nothing happened; `urgentAt` is where
  // the clock itself starts shouting, so it is the same line the game already
  // draws between comfortable and not, measured against the allowance *that*
  // turn had, since a thirty-second answer is a close call late in a chain and
  // an unhurried one at the start.
  const closestHad = turnMsFor((stats.closest?.turn ?? 1) - 1);
  const close: ChainHighlight | null =
    stats.closest && stats.closest.link.ms >= closestHad - urgentAt(closestHad)
      ? stats.closest
      : null;

  return (
    <div className="wc-stats">
      <h3 className="wc-stats-head">How it went</h3>
      <ul className="wc-stat-seats">
        {played.map((stat) => (
          <SeatStats key={stat.seat} stat={stat} name={nameFor(stat.seat)} />
        ))}
      </ul>
      {/*
        Plain sentences, so the reader gets them as they stand and no second
        copy is needed. The word carries its own `lang` so it is not read as
        English wherever it came from.
      */}
      <ul className="wc-highlights">
        {close && (
          <li className="wc-highlight">
            <strong>Closest call</strong>: {nameFor(close.link.seat)} answered word{" "}
            {close.turn} {toSpare(close.link.ms, closestHad)}:{" "}
            <span lang={close.link.lang}>{close.link.word}</span>.
          </li>
        )}
        {stats.rarest && (
          <li className="wc-highlight">
            <strong>Rarest</strong>: {nameFor(stats.rarest.link.seat)} played{" "}
            <span lang={stats.rarest.link.lang}>{stats.rarest.link.word}</span>, #
            {count.format(stats.rarest.link.rank)} of{" "}
            {count.format(LIST_SIZE[stats.rarest.link.lang])} in{" "}
            {LANG_NAME[stats.rarest.link.lang]}.
          </li>
        )}
        {stats.longest && (
          <li className="wc-highlight">
            <strong>Longest</strong>: {nameFor(stats.longest.link.seat)} played{" "}
            <span lang={stats.longest.link.lang}>{stats.longest.link.word}</span>,{" "}
            {wordPoints(stats.longest.link.word)} letters, which is also the
            most any one word scored.
          </li>
        )}
      </ul>
    </div>
  );
}

export function WordChainBoard({ state, seat, names, canAct, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tail = useRef<HTMLDivElement>(null);

  const clock = useServerNow(now, state.deadline !== null);
  const left = state.deadline === null ? null : msLeftFor(state, clock);
  // How long the turn on the clock was given. Derived from the chain the same
  // way the server derives it (see `turnMsFor`) rather than sent, because it is
  // a function of something both sides already have and a second copy on the
  // wire is a second thing that can disagree. Setup has an empty chain, so it
  // comes out as the full minute there, which is what setup gets.
  const had = turnMsFor(state.chain.length);
  const mine = seat !== null;
  // The clock closes the box the moment it reads zero rather than a round-trip
  // later: the server has already stopped taking words by then, and a field
  // that still accepts one is promising something it cannot deliver.
  const myMove = mine && canAct && left !== 0;

  const nameFor = (index: number): string =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A word that has been accepted is not a draft any more. Keyed on the chain
  // length rather than on the word, so a rejected word stays in the box for the
  // player to edit, the whole point of a rejection that does not end the game.
  useEffect(() => {
    setDraft("");
    input.current?.focus();
  }, [state.chain.length, state.phase]);

  // Follow the chain as it grows. The newest word is the one being answered,
  // and on a phone the list is taller than the screen within a dozen turns.
  useEffect(() => {
    tail.current?.scrollIntoView({ block: "nearest" });
  }, [state.chain.length]);

  function submit() {
    const word = draft.trim();
    if (word.length < MIN_LENGTH) return;
    onMove({ type: "say", word });
  }

  if (state.phase === "setup") {
    const chosen = mine ? state.langs[seat] : null;
    const others = state.langs.flatMap((lang, i) =>
      i === seat ? [] : [{ i, lang }],
    );

    return (
      <div className="board wc-board wc-setup">
        <p className="wc-brief">
          Pick the language you will play in. You each get your own, and the
          chain crosses between them: a Polish word ending in A is answered by
          an English or Japanese one beginning with A. Japanese is typed in
          romaji, and Polish accents are optional, so <em>zolty</em> finds{" "}
          <strong lang="pl">żółty</strong>. Words are {MIN_LENGTH} letters or
          longer, nothing may be said twice, and you have a minute for the
          opening word. After that every word the chain grows takes a second
          off the answer, down to five.
        </p>
        {/*
          The scoring and the chase, said on the setup screen because they are
          what makes the clock survivable: a player who does not know their
          points stand will read a lost minute as a lost game and stop trying.
        */}
        <p className="wc-brief">
          Every word scores a point a letter, so the longer the word the more
          it is worth. Run the clock out, or give up when you know you will,
          and you are out of the chain with what you have scored, but not out
          of the game: the game shows you the word you were reaching for, and
          the other player carries the chain on alone until they have passed
          your score. If they cannot, you win. Level is not passed.
        </p>
        {/*
          Said on the setup screen because it is the one moment it can change
          anybody's mind. Two players in the same language are not stranding
          each other, so the chain stops flattening the accents, which in
          Polish is most of the alphabet's character, and the difference
          between being asked for an L and being asked for an Ł.
        */}
        <p className="wc-note">
          Both pick the same language and the accents count: a word ending in{" "}
          <strong lang="pl">ś</strong> then wants <strong lang="pl">świat</strong>,
          not <em>sen</em>. You still never have to type them.
        </p>

        <div className="wc-langs" role="group" aria-label="Choose your language">
          {LANGS.map((lang) => (
            <button
              type="button"
              key={lang}
              className={chosen === lang ? "wc-lang surface chosen" : "wc-lang surface"}
              disabled={!canAct}
              aria-pressed={chosen === lang}
              onClick={() => onMove({ type: "lang", lang })}
            >
              <span className="wc-lang-name">{LANG_NAME[lang]}</span>
              <span className="wc-lang-native" lang={lang}>
                {LANG_NATIVE[lang]}
              </span>
            </button>
          ))}
        </div>

        <p className="wc-waiting" aria-live="polite">
          {others.map(({ i, lang }) =>
            lang === null
              ? `${nameFor(i)} is still choosing.`
              : `${nameFor(i)} is playing ${LANG_NAME[lang]}.`,
          )}
        </p>

        {left !== null && <Clock left={left} had={had} />}
        <p className="wc-note">
          Nobody loses this bit. If the minute goes, whoever has not chosen
          gets English and the game starts.
        </p>
      </div>
    );
  }

  const over = state.phase === "over";
  // Two seats, so the winner is the other one. Null until there is a loser.
  const winner = state.loser === null ? null : (state.loser + 1) % state.langs.length;
  const myLang = mine ? state.langs[seat] : null;

  return (
    <div className="board wc-board">
      {/*
        The score, above the chain rather than in it, because the chain scrolls
        and this must not scroll away. It is drawn while the game is over too:
        the verdict below is a sentence about these two numbers.
      */}
      <Scores state={state} seat={seat} nameFor={nameFor} />

      {state.phase === "chase" && (
        <>
          <Chasing state={state} seat={seat} nameFor={nameFor} />
          {/*
            The reveal, straight away, rather than held back until the chase
            finishes. It is the reason to play and the reason the give-up
            button exists at all: a player who has just admitted the minute
            was gone should not have to sit through somebody else's run of
            turns to find out what the word was. Shown to both of them: it has
            never been secret, and the chaser is answering the same letter.
          */}
          {state.misses.map((miss) => (
            <Reveal key={miss.seat} miss={miss} name={nameFor(miss.seat)} />
          ))}
        </>
      )}

      {/*
        How far the two of you have got, which is the chain rather than the
        score. See `words`.

        Not a live region. The word just played is announced, and so is whose
        turn it is next; a third announcement every turn saying only that the
        number went up by one is chatter over the top of the two that matter.
      */}
      {!over && state.chain.length > 0 && (
        <p className="wc-count">
          {words(state.chain.length)} so far.
          {/*
            Said only once it is no longer a minute, because until then it is
            not news. It belongs on this line rather than beside the clock: the
            clock says how long is left, and this says what the chain has
            already cost the two of you, which is the same thing the word count
            beside it is saying.
          */}
          {had < TURN_MS && ` ${Math.round(had / 1000)} seconds a turn now.`}
        </p>
      )}

      <ol className="wc-chain" aria-label="The chain so far">
        {state.chain.map((link, i) => (
          <Link key={i} link={link} mine={link.seat === seat} name={nameFor(link.seat)} />
        ))}
        <div ref={tail} />
      </ol>

      {state.chain.length === 0 && (
        <p className="wc-waiting">
          {nameFor(state.at)} open{state.at === seat ? "" : "s"} with any word.
          {/*
            The opening word has no letter to carry, so it gets no `Carry` and
            would be the one turn with no count on the screen. It is also the
            only turn where the count is the whole language, which is worth
            seeing once, being the number every later count is a fraction of.
          */}
          {state.available !== null && ` ${count.format(state.available)} to choose from.`}
        </p>
      )}

      {!over && state.required && (
        <Carry letter={state.required} available={state.available} />
      )}

      {over && (
        <div className="wc-over" role="status">
          {/*
            Who won and by how much, in that order and in one sentence. The
            score is not an afterthought here: with a chase in the rules the
            player who ran out of time first can perfectly well have won, so a
            verdict that only said who lost their minute would be reporting
            the wrong event.
          */}
          <p className="wc-verdict">
            {state.loser === null
              ? "Game over."
              : // "11 points to 9", with the unit said once: it is one
                // comparison, and saying "points" twice makes it read as two
                // numbers that happen to be adjacent.
                `${nameFor(winner as number)} ${winner === seat ? "win" : "wins"}, ${points(
                  scoreFor(state, winner as number),
                )} to ${count.format(scoreFor(state, state.loser))}.`}
          </p>
          {/*
            What the two of you built, said once and plainly. Omitted at zero
            rather than reading "0 words": a minute spent on the opening word
            with nothing to show for it is a thing the verdict already covers,
            and a chain that never started did not reach anywhere.

            Above the reveal, so the reveal stays the last and largest thing on
            the screen. It is the reason to play, and a number should not come
            after it.
          */}
          {state.chain.length > 0 && (
            <p className="wc-count">
              The chain reached {words(state.chain.length)}.
            </p>
          )}
          {/*
            The reveals, and the reason the lists are ordered by frequency at
            all. A minute spent failing to think of a word is the moment the
            answer sticks, so each is shown large and with its meaning rather
            than tucked into a status line, and a game where both players lost
            a minute shows both words, oldest first, because the player who
            went on to win has just as much to learn from theirs.
          */}
          {state.misses.map((miss) => (
            <Reveal key={miss.seat} miss={miss} name={nameFor(miss.seat)} />
          ))}

          {state.chain.length > 0 && <Stats state={state} nameFor={nameFor} />}
        </div>
      )}

      {mine && !over && (
        <>
          {left !== null && <Clock left={left} had={had} />}
          <form
            className="wc-entry"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="wc-label" htmlFor="wc-word">
              {myMove
                ? state.required
                  ? `Your ${myLang ? LANG_NAME[myLang] : ""} word, starting with ${state.required.toUpperCase()}`
                  : `Open with any ${myLang ? LANG_NAME[myLang] : ""} word`
                : `Waiting for ${nameFor(state.at)}`}
            </label>
            {/*
              Directly under the label, because the two are one instruction:
              the label says what the word must start with and this says what
              it may not end on. Split apart, a player reads the first, types a
              word, and finds out about the second by being refused.
            */}
            <Cooling locks={lockedFor(state, seat)} />
            <div className="wc-entry-row">
              <input
                id="wc-word"
                ref={input}
                className="wc-input"
                value={draft}
                disabled={!myMove}
                maxLength={24}
                // Every one of these matters on a phone, where the default is a
                // capitalised, autocorrected, spell-checked mess fighting a
                // player who is trying to type Polish into an English keyboard.
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                lang={myLang ?? undefined}
                placeholder={state.required ? `${state.required}...` : "anything"}
                onChange={(event) =>
                  // Letters only, in any alphabet: Polish accents and a stray
                  // kana are all fine, digits and punctuation never are.
                  setDraft(event.target.value.replace(/[^\p{L}]/gu, ""))
                }
              />
              <button
                type="submit"
                className="wc-submit"
                disabled={!myMove || draft.trim().length < MIN_LENGTH}
              >
                Say it
              </button>
            </div>
          </form>
          {/*
            Losing on purpose, which is a real move here rather than a way out
            of one. The reveal is the point of the game, so a player who knows
            the minute is gone can reach it now instead of watching a clock
            they have already lost to. Only offered on your own turn, because
            that is the only turn you can lose on, the same gate every other
            control here is on.

            Not a confirmation dialogue. It ends a sixty-second round of a word
            game, the wording says plainly what it does, and a modal over a
            running clock would cost the seconds it is meant to protect.
          */}
          {myMove && (
            <button
              type="button"
              className="wc-give-up"
              onClick={() => onMove({ type: "give-up" })}
            >
              Give up and see the word
            </button>
          )}
          {/*
            The one thing a strict game has to say out loud, and only while it
            can still be acted on. A player who types `swiat` for a `ś` and has
            it taken will work the rule out; a player who sees `Ś` and believes
            they need a Polish keyboard just stops.
          */}
          {myMove && state.strict && state.required && (
            <p className="wc-note">
              Accents count in a same-language chain, but type it however you
              like, <em>swiat</em> still finds <strong lang="pl">świat</strong>.
            </p>
          )}
          {!myMove && (
            <p className="wc-waiting" aria-live="polite">
              {left === 0
                ? "Time's up."
                : `${nameFor(state.at)} is ${state.phase === "chase" ? "chasing" : "thinking"}${state.required ? `, a word starting with ${state.required.toUpperCase()}` : ""}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
