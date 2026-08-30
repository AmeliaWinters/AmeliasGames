/**
 * The screen before the first clue: what the game is, what the room is playing,
 * and the one setting each player makes for themselves.
 *
 * A whole screen rather than a component of one, and it is the longest stretch
 * of prose in the app on purpose. The handicap is self-reported and it is the
 * one thing here a player can reasonably feel cheated by, so every rule it
 * changes is spelled out before the clock starts rather than discovered from a
 * scoreline in round five.
 *
 * It takes `left` rather than reading the clock, because the board above it is
 * already ticking one and two countdowns disagreeing by a frame is a bug that
 * only shows up on somebody else's phone.
 */
import {
  HINT_ALLOWANCE,
  HOST,
  LEVEL_NAME,
  MODE_LABEL,
  MODE_NAME,
  REVEAL_MS,
  ROUND_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_LEVELS,
  VOCAB_MODES,
  isPhrases,
} from "../../../shared/games/vocabDisplay.js";
import type { VocabMove, VocabState } from "../../../shared/games/vocabDisplay.js";

import { Choice, ChoiceGroup } from "../Choice.js";
import { LANG_NATIVE, LEVEL_BLURB, MODE_BLURB, levelTerms } from "./copy.js";
import { Clock } from "./parts.js";

export function VocabSetup({
  state,
  seat,
  canAct,
  left,
  nameFor,
  onMove,
}: {
  state: VocabState;
  seat: number | null;
  canAct: boolean;
  left: number | null;
  nameFor: (index: number) => string;
  onMove: (move: VocabMove) => void;
}) {
  const mine = seat !== null;
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
        Some rounds come the other way about: the word goes up and you pick
        which of four meanings is right. Easier, so it pays half, and it is
        the round you can still play on a word you could never have spelled.
        How often that happens is the one thing you choose for yourself,
        below. You also get <strong>{HINT_ALLOWANCE} hints</strong> for the
        whole game. One buys you the first letter and the length of the word
        you are reaching for, and halves what that answer pays. Spending them
        is the only real decision in a round, so spend them on the words you
        nearly know - unless you're just starting, in which case they turn up
        free and you keep all three.
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
              reasonably feel cheated by, and a mix is a claim they are
              entitled to see as a number before they agree to it.
            */}
            <span className="vr-choice-terms">{levelTerms(level)}</span>
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
        Everyone gets the same clue, the same {Math.round(ROUND_MS / 1000)}{" "}
        seconds and the same points. What changes is the question: say you're
        new and most rounds come as four meanings to choose from, with the
        first letter turning up free if you're stuck. Say you speak it and you
        type every single one. Choosing is worth half, so the beginner catches
        up on the rounds they type.
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
