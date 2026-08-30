/**
 * The join box on the setup screen: four letters, who you are, and what the
 * four letters turn out to be.
 *
 * The lookup it does is the only network anything in this file knows about,
 * and it is advisory; see the note on `JoinBox` itself.
 */
import { useEffect, useState } from "react";
import { CODE_LENGTH, isRoomCode, normalizeRoomCode } from "../../shared/roomCode.js";
import type { RoomPeek } from "../../shared/session.js";
import { lookupRoom } from "../net.js";


/**
 * Four letters, drawn as four boxes, over one real input.
 *
 * The boxes are the whole of why the code came out of the form: somebody is
 * holding four letters that were read out to them across a room, and a 90px
 * text field says "fill this in" where the thing in their hand says "ABCD".
 *
 * One input underneath, not four. Four fields each holding a character is the
 * pattern most one-time-code entries on the web use, and it is the one that
 * breaks paste, breaks backspace at a boundary, and hands a screen reader four
 * unlabelled fields to announce. So the boxes are decoration -- `aria-hidden`,
 * drawn from the value -- and the input is a plain four-character field lying
 * transparently over them, which pastes, corrects and announces the way a
 * field does, because it is one.
 */
function CodeCells({
  value,
  field,
  onChange,
}: {
  value: string;
  field: React.RefObject<HTMLInputElement>;
  onChange(next: string): void;
}) {
  return (
    <div className="cells">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <i key={i} className={i === value.length ? "cell caret" : "cell"} aria-hidden="true">
          {value[i] ?? ""}
        </i>
      ))}
      <input
        ref={field}
        className="cells-field"
        value={value}
        onChange={(e) => onChange(normalizeRoomCode(e.target.value))}
        maxLength={CODE_LENGTH}
        aria-label="Room code"
        aria-describedby="code-hint"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
    </div>
  );
}

/**
 * The join box: a code, who you are, and what the code turns out to be.
 *
 * Open on the page rather than behind a "Have a code?" button. Somebody who
 * was read four letters over a table has exactly one job on this screen, and a
 * button that hides the field for it is a step between them and it. The shelf
 * is still the first thing under it, because everybody else is here to pick a
 * game.
 *
 * What it adds over the old panel is the line under the cells: the code is
 * checked as the fourth letter lands and the box says what it found -- the
 * game, and how many are already sitting down. Four letters read across a room
 * are misheard often enough that "join, connect, fail, come back, retype" was
 * the ordinary path, and the failure arrived on a different screen than the
 * mistake.
 *
 * The lookup is advisory. It cannot seat anybody and it never blocks the
 * button on its own opinion: a lost lookup leaves the code joinable and the
 * socket has the final say, which is the only place that can honestly have it.
 */
export function JoinBox({
  code,
  onCode,
  field,
  name,
  onName,
  askName,
  onEditName,
  onJoin,
}: {
  code: string;
  onCode(next: string): void;
  field: React.RefObject<HTMLInputElement>;
  name: string;
  onName(next: string): void;
  askName: boolean;
  onEditName(): void;
  onJoin(): void;
}) {
  const [found, setFound] = useState<RoomPeek | null>(null);
  const [checking, setChecking] = useState(false);
  const complete = code.length === CODE_LENGTH;
  const trimmed = name.trim();

  /*
    One lookup per completed code, and never one per keystroke: the question
    only has an answer once all four letters are in, and the three prefixes on
    the way there would be three round trips whose answers are all "no".

    Aborting the one in flight is what keeps the box honest when somebody
    backspaces and retypes -- a slower first answer must not land on top of a
    newer code and describe the wrong room.
  */
  useEffect(() => {
    if (!complete || !isRoomCode(code)) {
      setFound(null);
      setChecking(false);
      return;
    }
    const stop = new AbortController();
    setChecking(true);
    let live = true;
    lookupRoom(code, stop.signal).then((answer) => {
      if (!live) return;
      setChecking(false);
      setFound(answer);
    });
    return () => {
      live = false;
      stop.abort();
    };
  }, [code, complete]);

  /*
    One line, and it says the most specific true thing it can.

    "We could not tell" is a real state and it is not a refusal: `lookupRoom`
    answers null for anything that went wrong, including offline, and telling
    somebody their good code is bad is worse than telling them nothing.
  */
  let status: React.ReactNode = null;
  if (complete && checking) {
    status = <span className="join-status">Looking for {code}...</span>;
  } else if (complete && found?.exists) {
    const seated = found.players ?? 0;
    status = (
      <span className="join-status join-found">
        <strong>{found.gameName}</strong>
        {found.full
          ? `, full (${seated} of ${found.capacity} seated)`
          : `, ${seated} ${seated === 1 ? "player" : "players"} waiting`}
      </span>
    );
  } else if (complete && found && !found.exists) {
    status = <span className="join-status join-missing">No room with that code. Check the letters?</span>;
  }

  return (
    <form
      className="joinbox"
      onSubmit={(e) => {
        e.preventDefault();
        onJoin();
      }}
    >
      <h2>Join someone</h2>
      {/*
        Two shapes, and the fork is `askName`, which is decided once on arrival
        and never flips while somebody is typing.

        Known name: the button sits on the end of the code line, because there
        is nothing between the last letter and pressing it. Unknown name: the
        name field comes between them, and the button has to follow the last
        thing it depends on -- a Join sitting above the field it is waiting for
        is a control that looks broken to everyone who has not yet scrolled
        past it.
      */}
      {askName ? (
        <>
          <CodeCells value={code} field={field} onChange={onCode} />
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Amelia"
              maxLength={20}
            />
          </label>
          <button className="primary" disabled={!trimmed || !complete}>
            Join
          </button>
        </>
      ) : (
        <>
          <div className="join-row">
            <CodeCells value={code} field={field} onChange={onCode} />
            <button className="join-go" disabled={!trimmed || !complete}>
              Join <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
          {/* Everybody here is named in the bar above, and asking a returning
              player to type it again in front of a code is the form this
              screen got rid of. */}
          <p className="join-as">
            Joining as {trimmed}.{" "}
            <button type="button" className="linky" onClick={onEditName}>
              Not you?
            </button>
          </p>
        </>
      )}
      {/* Under the control rather than over it, and absent until there is
          something to say. It used to sit above with 2.4em reserved under a
          line of instructions nobody needed twice. Below, appearing costs
          nobody a mis-press: the only control it can move is not there. */}
      {status && (
        <p className="hint" id="code-hint">
          {status}
        </p>
      )}
    </form>
  );
}
