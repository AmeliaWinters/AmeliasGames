import { useEffect, useRef, useState } from "react";
// Values from vocabDisplay.js, which imports nothing that reaches a reducer.
// The boundary matters twice here: the word lists must not reach the browser
// (they are the second largest thing in the repo), and neither must the answer
// to the clue currently on the screen, since a board that could resolve a clue
// itself would have ended the race. The types below are type-only and erase.
import {
  MODE_LABEL,
  VOCAB_LANG_NAME,
  canAct as seatCanAct,
  askIn,
  autoHinted,
  canHint as seatCanHint,
  choosing,
  firstRight,
  gradeOf,
  hintOf,
  hintsLeft,
  isPhrases,
  msLeftFor,
  tryOf,
  windowLeft,
  windowMs,
} from "../../shared/games/vocabDisplay.js";
import type { VocabMove, VocabState } from "../../shared/games/vocabDisplay.js";
import { useServerNow } from "../clock.js";
import { loadProfileCache } from "../profileCache.js";
import { XpPops, rowsFor, useXpPops, xpPreview } from "../xpPop.js";
import { useCanSpeak } from "../speech.js";

import type { BoardProps } from "./boards.js";
import { namer } from "./names.js";
import { VocabOver } from "./vocab/Over.js";
import { VocabSetup } from "./vocab/Setup.js";
import { seconds } from "./vocab/copy.js";
import { Answer, Clock, Heard, Payout, Scores } from "./vocab/parts.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/vocab.css";

type Props = BoardProps<VocabState, VocabMove>;

export function VocabBoard({ state, seat, names, canAct, now, onMove }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const clock = useServerNow(now, state.deadline !== null && state.phase !== "over");
  // Asked here, at the top, because hooks may not sit behind the setup and
  // game-over returns further down. `state.lang` is null until the host has
  // chosen and Polish is the default the host would time out into, so this asks
  // about the language the table is most likely to end up in and re-asks when
  // it turns out to be the other one.
  const canSpeak = useCanSpeak(state.lang ?? "pl");
  const left = state.deadline === null ? null : msLeftFor(state, clock);
  const mine = seat !== null;
  // Whether the room is answering with sentences. It changes the question's
  // wording, how long the box is, and which characters it will take.
  const phrasing = isPhrases(state.mode);
  // How long this seat's own box stays open, ticking. The same thirty seconds
  // for everybody now, but still read per seat: the round's own clock pulls in
  // as people finish (see `roundDeadline`) and this one does not.
  const myWindow = seat === null ? 0 : windowLeft(state, seat, clock);
  const myTry = seat === null ? null : tryOf(state.round, seat);

  /*
    "+7 XP", once per round, at the reveal.

    **At the reveal rather than at the submit**, which is a beat later than it
    sounds like it should be and is the only moment the number can be right.
    A `say` round holds the meaning on the client and the *word* only in the
    answer, and a `pick` round redacts the clue outright -- so until the reveal
    opens there is nothing on this client to look the word's rung up by, and a
    pop fired on the submit would price every review as a first sighting. See
    `xpPop.tsx` for what that lookup can and cannot promise.

    It is also the moment the board already celebrates in words, so the number
    lands on the beat rather than inventing a second one.

    Keyed on `round.began`, which is unique per round and survives the
    re-renders inside a reveal. A ref rather than state: it gates an effect and
    is never drawn, so changing it must not repaint anything.
  */
  const { pops, pop } = useXpPops();
  const popped = useRef(0);
  const answered = state.round?.answer ?? null;
  useEffect(() => {
    if (seat === null || answered === null || myTry === null) return;
    const round = state.round;
    if (!round || popped.current === round.began) return;
    popped.current = round.began;
    // `timeout` is not a grade -- see `gradeOf` -- and nothing is paid for a
    // miss, so both fall out of `xpPreview` as zero and `pop` stays silent.
    if (myTry.how === "timeout") return;
    const grade = gradeOf(myTry, askIn(round, seat), windowMs(state, seat));
    const lang = state.lang;
    if (lang === null) return;
    pop(xpPreview(rowsFor(loadProfileCache(), lang), answered.word, grade, Date.now()));
  }, [answered, myTry, seat, state, pop]);
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
  /*
    A beginner's free hint is sent down the moment the clue goes up, with the
    time it is due on it, because `view()` has no clock to withhold it by (see
    `FREE_HINT_MS`). Holding it here is the other half of that bargain: until
    `at`, this board has the shape and does not draw it.

    Which does mean the honest thing to say is that a determined player could
    read it out of devtools five seconds early. That is the trade the server
    made deliberately, and it is worth reading the comment there before
    "fixing" it here -- it is one player's own first letter, on a round the
    game has already decided to hand it to them, worth the same either way.
  */
  const hintDue = myHint !== null && clock >= myHint.at;
  // Whether this seat buys its hints or is given them. Read off the level
  // rather than off the hint on the round, because the copy under the box has
  // to promise the free one *before* it arrives.
  const autoHint = seat !== null && autoHinted(state, seat);
  const freeHint = myHint?.free === true;
  // The shape arrives already masked -- the board is never sent the word on a
  // say round -- so the letter count is read back out of the mask.
  const hintShape = myHint === null || myHint.shown === "" || !hintDue ? "" : myHint.shown;
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
  // Setup, the end, and a round are three different screens rather than three
  // branches of one, and they live in `vocab/`. The hooks above run for all
  // three -- they must, they are hooks -- so what follows is only the drawing.
  if (state.phase === "setup") {
    return (
      <VocabSetup
        state={state}
        seat={seat}
        canAct={canAct}
        left={left}
        nameFor={nameFor}
        onMove={onMove}
      />
    );
  }

  const lang = state.lang ?? "pl";

  if (state.phase === "over") {
    return <VocabOver state={state} seat={seat} lang={lang} nameFor={nameFor} />;
  }

  // A round
  const round = state.round;
  const revealing = state.phase === "reveal";
  // Which half of the round is the question, *for this seat*. On a pick round
  // the word is sent and the clue is not, which is the reverse of every other
  // round, so this decides what goes in the big type as well as which controls
  // are drawn. Per seat because the round is: the player beside you may be
  // typing the same word you are choosing the meaning of. A spectator with no
  // seat is sent the say view, which is `askIn`'s default and the only one of
  // the two that is safe to be wrong about.
  const ask = askIn(round, seat ?? -1);
  const picking = !revealing && choosing(ask);
  // A listening round this device can actually ask. `useCanSpeak` is the whole
  // of the fallback: with no voice for the language the word is drawn instead
  // of spoken, which makes it a plain `pick`, which is a question this seat
  // could have been asked anyway. So a phone with no Polish voice plays a
  // slightly easier game rather than a broken one, and nothing about that
  // reaches the server. See `HEAR_SCALE` for what it costs.
  const hearing = !revealing && ask === "hear" && canSpeak;
  // Everyone's result, in the order they finished, with the seats that never
  // answered on the end. `settle` writes those in, so this is the whole table.
  const payout = revealing && round ? round.tries : [];
  const first = revealing && round ? firstRight(round) : null;

  return (
    <div className="board vr-board">
      {/* Anchored to the board rather than to the answer, because the answer
          block is not on screen for every kind of round and a reward that
          sometimes has nowhere to appear is a reward people report as broken.
          Positioned by `xp.css`, out of flow, so it moves nothing. */}
      <XpPops pops={pops} />
      <Scores state={state} seat={seat} nameFor={nameFor} />

      <p className="vr-round">
        Round {state.history.length + 1} - {VOCAB_LANG_NAME[lang]},{" "}
        {MODE_LABEL[state.mode]}
      </p>

      {/*
        Said out loud, because a word turning up twice with nothing to mark it
        reads as the deck repeating itself rather than as a second chance. Drawn
        during the reveal too, so the payout line is read as a retry's payout.
      */}
      {round?.retry && (
        <p className="vr-retry">Nobody got this one. Here it is again.</p>
      )}

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
          {hearing ? (
            <>
              <p className="vr-clue-label">What does this mean?</p>
              {/*
                The question is a button, because the question is a sound and a
                sound the player cannot replay is a question asked once at
                somebody who may have been looking away. Unlimited replays: the
                word is not information being rationed, it is the clue, and the
                thirty seconds are the cost.

                Deliberately no spelling anywhere on this screen. Drawing the
                word beside the speaker would answer the question with the eye
                and turn the round back into a `pick`, which is the round this
                seat would have had anyway. See `Heard`.
              */}
              <Heard word={round?.answer?.word ?? ""} lang={lang} began={round?.began ?? 0} />
            </>
          ) : picking ? (
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
                    {/*
                      Live, and it has to be: the free one appears five seconds
                      in with nobody having pressed anything, which is the one
                      case on this board where a hint arrives unannounced.
                    */}
                    {freeHint ? "Free hint" : "Your hint"}: it starts with{" "}
                    {[...hintShape][0]} and is {hintLetters} letters long
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

                Not drawn at all for a seat that gets its hints free. There is
                nothing to decide there and a disabled button explaining that
                would be a control whose whole job is to say it is not a
                control; the line under the box says it in words instead.
              */}
              {autoHint ? (
                <p className="vr-hint-free">
                  {hintShape === ""
                    ? "Stuck? The first letter turns up in a few seconds, free."
                    : "That one was free - it costs you nothing."}
                </p>
              ) : (
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
              )}

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
              up. The answer is coming.
            </p>
          )}
          {!mine && <p className="vr-waiting">Watching. Take a seat to play.</p>}
        </>
      )}
    </div>
  );
}
