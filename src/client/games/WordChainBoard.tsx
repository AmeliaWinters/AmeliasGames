import { useEffect, useRef, useState } from "react";
// Values from wordChainDisplay.js, which imports nothing that reaches a
// reducer: the board must never pull the three word lists into the client
// bundle. The types below are type-only, so they erase entirely.
import {
  CHAIN_LEVELS,
  LANGS,
  LANG_NAME,
  LEVEL_NAME,
  MIN_LENGTH,
  TURN_MS,
  hintsFor,
  levelOf,
  lockedFor,
  msLeftFor,
  scoreFor,
  turnMsFor,
} from "../../shared/games/wordChainDisplay.js";
import type { WcMove, WcState } from "../../shared/games/wordChainDisplay.js";
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";
import { Choice, ChoiceGroup } from "./Choice.js";
import { namer } from "./names.js";
import { LANG_NATIVE, count, levelBlurb, points, words } from "./wordchain/copy.js";
import {
  Carry,
  Chasing,
  Clock,
  Cooling,
  Hints,
  Link,
  Reveal,
  Scores,
  Stats,
} from "./wordchain/parts.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/wordchain.css";

type Props = BoardProps<WcState, WcMove>;

/** Under this much left, the clock starts shouting about it. */

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

  const nameFor = namer(names, seat);

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
    const myLevel = mine ? levelOf(state, seat) : null;
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

        {/*
          Before the language row rather than after it, because picking a
          language is the move that ends setup: the second one to land starts
          the game. A control below it would be one a player never reaches.
          Said out loud in the note, because a disabled row with no explanation
          reads as a bug.
        */}
        <ChoiceGroup label="How much of your language you have" narrow>
          {CHAIN_LEVELS.map((level) => (
            <Choice
              key={level}
              name={LEVEL_NAME[level]}
              note={levelBlurb(level)}
              chosen={myLevel === level}
              disabled={!canAct}
              onPick={() => onMove({ type: "level", level })}
            />
          ))}
        </ChoiceGroup>
        <p className="wc-note">
          Everybody gets the same minute and the same points. What this changes
          is whether the game helps you find a word while the clock is running:
          first what it means, then its first two letters and how long it is,
          like <strong>ło___</strong>. Set it before you choose a language, that
          being the choice that starts the game.
        </p>

        <ChoiceGroup label="Choose your language" columns={3}>
          {LANGS.map((lang) => (
            <Choice
              key={lang}
              name={LANG_NAME[lang]}
              note={LANG_NATIVE[lang]}
              noteLang={lang}
              chosen={chosen === lang}
              disabled={!canAct}
              onPick={() => onMove({ type: "lang", lang })}
            />
          ))}
        </ChoiceGroup>

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
            {/*
              With the label and the cooldowns rather than beside the chain,
              because it is part of the same instruction: this is what to type,
              this is what you may not end on, and this is the word the game is
              pointing you at. Above the box so it is not hidden by a phone
              keyboard.
            */}
            <Hints steps={hintsFor(state, seat, clock)} lang={myLang} />
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
