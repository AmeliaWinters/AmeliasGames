import { useState } from "react";
import {
  GHOST_KEY_ROWS,
  GHOST_LANGS,
  GHOST_LANG_NAME,
  GHOST_LANG_NATIVE,
  GHOST_SIDES,
  GHOST_WORD,
  MIN_WORD,
  openerOf,
  revealNow,
  spelled,
} from "../../shared/games/ghostDisplay.js";
import type {
  GhostMove,
  GhostReveal,
  GhostSide,
  GhostState,
} from "../../shared/games/ghostDisplay.js";
import { Choice, ChoiceGroup } from "./Choice.js";
import type { BoardProps } from "./boards.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/ghost.css";

/**
 * Superghost: a fragment with two open ends, and a keyboard.
 *
 * The board's whole job is to make one decision cheap, and it is not "which
 * letter": it is "which end". A player who has spotted that `ł` in front is the
 * move has to be able to play it without first hunting for a mode switch, so
 * the two ends of the fragment *are* the switch. You tap the end you mean, it
 * lights up, and the keyboard plays into it. The choice sits on the thing you
 * are already looking at rather than in a control bar above it.
 *
 * **No key is ever disabled while a round is running, and that is the game.**
 * Whether a letter is safe is the whole question, and the answer is behind
 * thirty thousand Polish words on the server. A board that greyed out the
 * losing keys would be a board playing for you, and it could not do it anyway
 * without shipping the dictionary. See rule 2 in `ghost.ts`.
 */
export function GhostBoard({
  state,
  names,
  canAct,
  onMove,
}: BoardProps<GhostState, GhostMove>) {
  const [side, setSide] = useState<GhostSide>("end");
  const reveal = revealNow(state);
  const nameFor = (at: number) => names[at] ?? `Player ${at + 1}`;

  if (state.phase === "setup") {
    return (
      <div className="gh">
        <ChoiceGroup label="Choose a language" columns={2}>
          {GHOST_LANGS.map((lang) => (
            <Choice
              key={lang}
              name={GHOST_LANG_NAME[lang]}
              note={GHOST_LANG_NATIVE[lang]}
              noteLang={lang}
              chosen={state.lang === lang}
              disabled={!canAct}
              onPick={() => onMove({ type: "lang", lang })}
            />
          ))}
        </ChoiceGroup>
        <p className="gh-note">
          One fragment, both of you. Add a letter to either end, and don't be
          the one who finishes a real word. Words under {MIN_WORD} letters are
          free, so nobody loses on the second letter. Play a letter with nothing
          behind it and you lose the round on the spot, which is what makes
          bluffing worth anything.
        </p>
        <p className="gh-note">
          Lose five rounds and you have spelled {GHOST_WORD}.
        </p>
        <button
          type="button"
          className="primary"
          disabled={!canAct}
          onClick={() => onMove({ type: "begin" })}
        >
          Start
        </button>
      </div>
    );
  }

  const playing = state.phase === "playing";

  return (
    <div className="gh">
      <div className="gh-score" role="group" aria-label="Rounds lost">
        {state.letters.map((_, at) => (
          <div key={at} className={at === state.at && playing ? "gh-seat on" : "gh-seat"}>
            <span className="gh-who">{nameFor(at)}</span>
            <span className="gh-ghost" aria-label={`${spelled(state, at).length} of ${GHOST_WORD.length}`}>
              {[...GHOST_WORD].map((letter, i) => (
                <i key={i} className={i < spelled(state, at).length ? "lit" : ""} aria-hidden="true">
                  {letter}
                </i>
              ))}
            </span>
          </div>
        ))}
      </div>

      <FragmentRow
        fragment={state.fragment}
        side={side}
        setSide={setSide}
        live={playing && canAct}
        played={reveal?.played ?? null}
      />

      {playing && (
        <p className="gh-left" aria-live="polite">
          {state.fragment === ""
            ? `${nameFor(state.at)} opens round ${state.round + 1}.`
            : `${state.left} ${state.left === 1 ? "word has" : "words have"} this in them.`}
        </p>
      )}

      {reveal && <Reveal reveal={reveal} lang={state.lang} nameFor={nameFor} />}

      {playing && (
        <>
          <Keyboard
            rows={GHOST_KEY_ROWS[state.lang]}
            lang={state.lang}
            disabled={!canAct}
            side={side}
            onLetter={(letter) => onMove({ type: "play", side, letter })}
          />
          <button
            type="button"
            className="gh-give-up"
            disabled={!canAct}
            onClick={() => onMove({ type: "give-up" })}
          >
            Give up the round
          </button>
        </>
      )}

      {state.phase === "round" && (
        <button
          type="button"
          className="primary"
          disabled={!canAct}
          onClick={() => onMove({ type: "next" })}
        >
          Round {state.round + 2}, {nameFor(openerOf(state.round + 1))} opens
        </button>
      )}
    </div>
  );
}

/**
 * The fragment, with a tappable slot at each end.
 *
 * The slots are the side switch, which is why they are buttons and not
 * decoration: pressing one is how you say "in front", and it reads as a place
 * to put a letter rather than as a setting. They stay pressable when the
 * fragment is empty, where the two ends are the same thing and choosing is
 * harmless.
 *
 * `played` marks the letter a round ended on, so the reveal underneath is
 * about a letter the eye can find.
 */
function FragmentRow({
  fragment,
  side,
  setSide,
  live,
  played,
}: {
  fragment: string;
  side: GhostSide;
  setSide(side: GhostSide): void;
  live: boolean;
  played: { side: GhostSide; letter: string } | null;
}) {
  const letters = [...fragment];
  // Which index the losing letter landed on, so it can be marked rather than
  // described. A letter played on the front is index 0 and one played on the
  // back is the last, which is the whole of the arithmetic.
  const marked = played === null ? -1 : played.side === "start" ? 0 : letters.length - 1;

  return (
    <div className="gh-frag" role="group" aria-label="The fragment">
      <End side="start" chosen={side === "start"} live={live} onPick={setSide} />
      <span className="gh-letters" aria-live="polite" aria-label={fragment || "empty"}>
        {letters.map((letter, i) => (
          <i key={i} className={i === marked ? "played" : ""}>
            {letter}
          </i>
        ))}
      </span>
      <End side="end" chosen={side === "end"} live={live} onPick={setSide} />
    </div>
  );
}

function End({
  side,
  chosen,
  live,
  onPick,
}: {
  side: GhostSide;
  chosen: boolean;
  live: boolean;
  onPick(side: GhostSide): void;
}) {
  return (
    <button
      type="button"
      className={chosen ? "gh-end surface chosen" : "gh-end surface"}
      disabled={!live}
      aria-pressed={chosen}
      aria-label={side === "start" ? "Add letters to the front" : "Add letters to the back"}
      onClick={() => onPick(side)}
    >
      <span aria-hidden="true">_</span>
    </button>
  );
}

/**
 * Every letter, always live. See the note on the component above: a disabled
 * key here would be the board answering the only question the game asks.
 *
 * Polish gets a fourth row of accented letters rather than a folded keyboard,
 * because folding is the one thing this game must not do to Polish. The row is
 * nine keys against the ten above it, so it lines up on its own track rather
 * than stretching to fill.
 */
function Keyboard({
  rows,
  lang,
  disabled,
  side,
  onLetter,
}: {
  rows: readonly string[];
  lang: string;
  disabled: boolean;
  side: GhostSide;
  onLetter(letter: string): void;
}) {
  const where = side === "start" ? "on the front" : "on the back";
  return (
    <div className="gh-keys" role="group" aria-label="Letters" lang={lang}>
      {rows.map((row) => (
        <div className="gh-keys-row" key={row}>
          {[...row].map((letter) => (
            <button
              type="button"
              key={letter}
              className="gh-key surface"
              disabled={disabled}
              aria-label={`${letter} ${where}`}
              onClick={() => onLetter(letter.toLowerCase())}
            >
              {letter}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** How many escapes are worth drawing before the count says it better. */
const SHOWN_OUTS = 12;

const WHY: Record<GhostReveal["reason"], string> = {
  completed: "finished a word",
  "dead-end": "played into nothing",
  "gave-up": "gave the round up",
};

/**
 * What the round was for.
 *
 * Losing is the one moment somebody is guaranteed to read a definition, so this
 * is the screen the whole game is built to arrive at: the word, what it means,
 * its dictionary form where Polish has one, how common it is, and the letters
 * that would have kept them alive. The outs are the half a definition cannot
 * give, and on a give-up they are the sharper half, since a folded position
 * with a dozen moves in it is a different mistake from a lost one.
 */
function Reveal({
  reveal,
  lang,
  nameFor,
}: {
  reveal: GhostReveal;
  lang: string;
  nameFor(seat: number): string;
}) {
  return (
    <div className="gh-reveal" aria-live="polite">
      <p className="gh-why">
        {nameFor(reveal.seat)} {WHY[reveal.reason]}.
      </p>

      {reveal.word !== "" && (
        <p className="gh-word">
          <strong lang={lang}>{reveal.word}</strong>
          {reveal.lemma !== "" && reveal.lemma !== reveal.word && (
            <span className="gh-lemma" lang={lang}>
              {reveal.lemma}
            </span>
          )}
          {reveal.gloss !== "" && <span className="gh-gloss">{reveal.gloss}</span>}
          {reveal.rank > 0 && <span className="gh-rank">#{reveal.rank}</span>}
        </p>
      )}

      {reveal.reason !== "completed" &&
        (reveal.outs.length === 0 ? (
          <p className="gh-outs">Nothing would have worked. That position was already lost.</p>
        ) : (
          <div className="gh-outs-block">
            <p className="gh-outs-head">
              {reveal.outs.length === 1
                ? "One letter was left."
                : reveal.outs.length > SHOWN_OUTS
                  ? // An early fragment can have sixty escapes, and sixty chips
                    // is a wall rather than a lesson. At that size the number is
                    // the news and a handful of them is the example.
                    `${reveal.outs.length} letters were still there, among them:`
                  : `${reveal.outs.length} letters were still there:`}
            </p>
            {GHOST_SIDES.map((side) => {
              // Split by end rather than tagged with an underscore. `E_` next
              // to `_U` is a puzzle before it is a hint, and which end a letter
              // goes on is the one thing a Superghost player has to hold in
              // their head. Two headings say it in words instead.
              const mine = reveal.outs.filter((out) => out.side === side).slice(0, SHOWN_OUTS);
              if (mine.length === 0) return null;
              return (
                <p className="gh-outs" key={side}>
                  <span className="gh-outs-label">
                    {side === "start" ? "In front" : "On the end"}
                  </span>
                  {mine.map((out) => (
                    <i key={out.letter} lang={lang}>
                      {out.letter}
                    </i>
                  ))}
                </p>
              );
            })}
          </div>
        ))}
    </div>
  );
}
