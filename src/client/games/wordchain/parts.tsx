/**
 * The pieces Word Chain's screens are built out of: a link in the chain, the
 * letter you are carrying, what is on cooldown, the scoreline, the clock, the
 * reveal and the end-of-game stats.
 *
 * Each is a pure function of its props. The board decides what is true -- whose
 * turn it is, how much clock is left, which letters are locked -- and hands it
 * down; nothing here re-derives any of it against a clock of its own, because
 * two countdowns disagreeing by a frame is a bug that only shows on somebody
 * else's phone.
 */
import {
  LANG_NAME,
  LIST_SIZE,
  chainStats,
  clockCall,
  formatClock,
  stoppedSeat,
  turnMsFor,
  scoreFor,
  targetScore,
  wordPoints,
} from "../../../shared/games/wordChainDisplay.js";
import type {
  ActiveCooldown,
  ChainHighlight,
  ChainHintStep,
  ChainLang,
  ChainLink,
  ChainMiss,
  SeatStat,
  WcState,
} from "../../../shared/games/wordChainDisplay.js";

import {
  count,
  ordinal,
  points,
  seconds,
  share,
  toSpare,
  urgentAt,
  words,
} from "./copy.js";

/**
 * The hints this turn has earned, oldest first.
 *
 * Drawn only for the seat on the clock, and only the rungs the clock has
 * reached: `hintsFor` is the whole rule and this draws whatever it hands back,
 * so a level, a shrinking turn and a language with no glosses in it all arrive
 * here as the same thing, a shorter list.
 *
 * A live region, because it appears under a player who is staring at the input
 * and not at this: a hint nobody notices is a hint that was not given. Polite
 * rather than assertive, the countdown beside it being the only thing on this
 * screen entitled to interrupt.
 */
export function Hints({ steps, lang }: { steps: ChainHintStep[]; lang: ChainLang | null }) {
  if (steps.length === 0) return null;
  return (
    <div className="wc-hints" role="status" aria-live="polite">
      {steps.map((step) => (
        <p key={step.kind} className="wc-hint">
          <span className="wc-hint-label">
            {step.kind === "meaning" ? "A word that works means" : "It looks like"}
          </span>
          {/*
            The masked word carries its own `lang` the way every other word on
            this board does, and the meaning does not: the gloss is English
            whatever the chain is playing in.
          */}
          <strong
            className={step.kind === "shape" ? "wc-hint-shape" : undefined}
            lang={step.kind === "shape" ? (lang ?? undefined) : undefined}
          >
            {step.text}
          </strong>
        </p>
      ))}
    </div>
  );
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
export function Rank({ link }: { link: ChainLink }) {
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
export function Link({ link, mine, name }: { link: ChainLink; mine: boolean; name: string }) {
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
export function Carry({ letter, available }: { letter: string; available: number | null }) {
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
export function Cooling({ locks }: { locks: ActiveCooldown[] }) {
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
export function Scores({
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
export function Chasing({
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
export function Reveal({ miss, name }: { miss: ChainMiss; name: string }) {
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

export function Clock({ left, had }: { left: number; had: number }) {
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
export function Stat({ value, label }: { value: string; label: string }) {
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
export function SeatStats({ stat, name }: { stat: SeatStat; name: string }) {
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
export function Stats({
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

