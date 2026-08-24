import { useEffect, useRef, useState } from "react";
// Values from wordChainDisplay.js, which imports nothing that reaches a
// reducer — the board must never pull the three word lists into the client
// bundle. The types below are type-only, so they are erased entirely.
import {
  LANGS,
  LANG_NAME,
  MIN_LENGTH,
  clockCall,
  formatClock,
  msLeftFor,
} from "../../shared/games/wordChainDisplay.js";
import type {
  ChainLang,
  ChainLink,
  WcMove,
  WcState,
} from "../../shared/games/wordChainDisplay.js";
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<WcState, WcMove>;

/** Under this much left, the clock starts shouting about it. */
const URGENT_MS = 15 * 1000;

/** What each language is called on its own terms, under the English name. */
const LANG_NATIVE: Record<ChainLang, string> = {
  en: "English",
  pl: "polski",
  ja: "日本語",
};

/**
 * One word in the chain.
 *
 * The gloss is the whole reason to play, so it is not a tooltip or an
 * afterthought: every word that is not English carries its English meaning
 * directly under it, and Japanese carries its own script as well, because a
 * learner who only ever sees `sakura` never learns to read 桜.
 *
 * Polish inflections show the dictionary form beside the gloss — `jestem`
 * played, `być` learned. That pairing is most of what the Polish list is for,
 * and it is why the reducer carries `lemma` on the wire at all.
 */
function Link({ link, mine, name }: { link: ChainLink; mine: boolean; name: string }) {
  const foreign = link.lang !== "en";
  return (
    <li className={mine ? "wc-link mine" : "wc-link"}>
      {/*
        The trailing spaces are not stray. These sit in separate grid areas, so
        a screen reader runs their text together — "Youżółtyyellow" — and a
        space between grid *items* would become an anonymous grid item and
        shift the layout. Inside the span it is free: the grid collapses it and
        the reader gets its word boundary.
      */}
      <span className="wc-who">{name} </span>
      <span className="wc-word" lang={link.lang}>
        {link.word}{" "}
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
    </li>
  );
}

/** The letter the next word has to start with, said once and largely. */
function Carry({ letter }: { letter: string }) {
  return (
    <p className="wc-carry" aria-label={`Next word starts with ${letter.toUpperCase()}`}>
      <span aria-hidden="true">↓</span>
      <strong>{letter.toUpperCase()}</strong>
    </p>
  );
}

function Clock({ left }: { left: number }) {
  return (
    <p
      className={[
        "clock compact",
        left <= URGENT_MS ? "urgent" : "",
        left === 0 ? "done" : "",
      ]
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

export function WordChainBoard({ state, seat, names, canAct, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tail = useRef<HTMLDivElement>(null);

  const clock = useServerNow(now, state.deadline !== null);
  const left = state.deadline === null ? null : msLeftFor(state, clock);
  const mine = seat !== null;
  // The clock closes the box the moment it reads zero rather than a round-trip
  // later: the server has already stopped taking words by then, and a field
  // that still accepts one is promising something it cannot deliver.
  const myMove = mine && canAct && left !== 0;

  const nameFor = (index: number): string =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A word that has been accepted is not a draft any more. Keyed on the chain
  // length rather than on the word, so a rejected word stays in the box for
  // the player to edit — which is the whole point of a rejection that does not
  // end the game.
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
          romaji, and Polish accents are optional — <em>zolty</em> finds{" "}
          <strong lang="pl">żółty</strong>. Words are {MIN_LENGTH} letters or
          longer, nothing may be said twice, and you have a minute a turn.
          Running out is the only way to lose.
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

        {left !== null && <Clock left={left} />}
        <p className="wc-note">
          Nobody loses this bit — if the minute goes, whoever has not chosen
          gets English and the game starts.
        </p>
      </div>
    );
  }

  const over = state.phase === "over";
  const myLang = mine ? state.langs[seat] : null;

  return (
    <div className="board wc-board">
      <ol className="wc-chain" aria-label="The chain so far">
        {state.chain.map((link, i) => (
          <Link key={i} link={link} mine={link.seat === seat} name={nameFor(link.seat)} />
        ))}
        <div ref={tail} />
      </ol>

      {state.chain.length === 0 && (
        <p className="wc-waiting">
          {nameFor(state.at)} open{state.at === seat ? "" : "s"} with any word.
        </p>
      )}

      {!over && state.required && <Carry letter={state.required} />}

      {over && (
        <div className="wc-over" role="status">
          <p className="wc-verdict">
            {state.loser === null
              ? "Game over."
              : state.loser === seat
                ? "Your minute went."
                : `${nameFor(state.loser)} ran out of time.`}
          </p>
          {/*
            The reveal, and the reason the lists are ordered by frequency at
            all. A minute spent failing to think of a word is the moment the
            answer sticks, so it is shown large and with its meaning, not
            tucked into a status line.
          */}
          {state.reveal && (
            <>
              {/*
                The visual block below is a label, a large word, a line of
                Japanese and a gloss in four separate boxes, which a screen
                reader reads as one run-on string. This is the same thing said
                once, properly, and the block is hidden from the reader rather
                than left to garble it — `wc-over` is a live region, so what it
                announces is a sentence or it is nothing.
              */}
              <p className="sr-only">
                The commonest word that would have worked: {state.reveal.word}
                {state.reveal.script && (
                  <span lang="ja">, written {state.reveal.script}</span>
                )}
                {state.reveal.gloss && `, meaning ${state.reveal.gloss}`}.
              </p>
              <div className="wc-reveal" aria-hidden="true">
                <span className="wc-reveal-label">
                  The commonest word that would have worked
                </span>
                <span className="wc-word" lang={state.reveal.lang}>
                  {state.reveal.word}
                </span>
                {state.reveal.script && (
                  <span className="wc-script" lang="ja">
                    {state.reveal.script}
                  </span>
                )}
                {state.reveal.lang !== "en" && (
                  <span className="wc-gloss">
                    {state.reveal.lemma && (
                      <em className="wc-lemma">{state.reveal.lemma}</em>
                    )}
                    {state.reveal.gloss}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {mine && !over && (
        <>
          {left !== null && <Clock left={left} />}
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
                placeholder={state.required ? `${state.required}…` : "anything"}
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
          {!myMove && (
            <p className="wc-waiting" aria-live="polite">
              {left === 0
                ? "Time is up."
                : `${nameFor(state.at)} is thinking${state.required ? ` of a word starting with ${state.required.toUpperCase()}` : ""}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
