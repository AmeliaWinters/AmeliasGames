import { useEffect, useRef, useState } from "react";
// The manifest, not the registry: the lobby needs ids and names, and importing
// the registry here would pull every reducer into the client bundle.
import {
  DEFAULT_GAME_ID,
  canSeat,
  gameEntry,
  gameList,
  shelvedGames,
  type GameEntry,
} from "../shared/games/manifest.js";
import { CODE_LENGTH, isRoomCode, makeRoomCode, normalizeRoomCode } from "../shared/roomCode.js";
// Every mark and motif this shell draws. See `art.tsx`: none of it reads the
// room, so none of it belongs in the file that runs the room.
import { BrandMark, CardArt, TopMark } from "./art.js";
// Which board draws which game, and the state types that go with them, live in
// `boards.ts`, where the compiler checks the pairing. Nothing here needs to
// know: this file's business with a game is its name.
import { boardFor, ownsSeats } from "./games/boards.js";
import {
  inviteUrl,
  loadLastGame,
  loadName,
  lookupRoom,
  saveLastGame,
  saveName,
  useRoom,
} from "./net.js";
import type { RoomPeek } from "../shared/session.js";
import type { ErrorKind, RoomView } from "../shared/protocol.js";
import {
  applyChannel,
  applyPalette,
  loadPalette,
  otherPalette,
  PALETTES,
  savePalette,
  type Palette,
} from "./palette.js";
import { applySound, loadSound } from "./feel.js";
import { play, primeSfx, useTableSounds } from "./sfx.js";
import { Toaster, useToasts, type Toasts } from "./toast.js";
import { Profile } from "./Profile.js";
import { earnedBetween, loadProfileCache, saveProfileCache, type Earned } from "./profileCache.js";
import type { ProfileView } from "../shared/profile.js";

/**
 * What the tab says before a room is open.
 *
 * Read off the document rather than written out again: `index.html` sets a
 * title built for a search result, and a second copy of it here would be a
 * second copy to keep in step. Captured at module load, which is before
 * anything below has had a chance to change it.
 */
const LOBBY_TITLE = typeof document === "undefined" ? "" : document.title;


/**
 * This page, addressed to a room: path, query, then the code.
 *
 * The order is the whole of it. Written as `#${code}${location.search}` the
 * query lands *after* the hash, and everything after a hash is the fragment. A
 * player who arrived at `?as=b`, or at a link a chat app had decorated with a
 * tracking parameter (which is most links), got a fragment reading `ABCD?as=b`.
 * Nothing broke on the spot, because the code was already in state. It broke on
 * the next reload, where `codeFromHash` no longer recognised four letters,
 * `brokenHashCode` did, and somebody sitting in a game was shown "that link
 * doesn't look complete" and dropped at the setup screen.
 */
function roomUrl(code: string): string {
  return `${location.pathname}${location.search}#${code}`;
}

function codeFromHash(): string | null {
  const raw = location.hash.slice(1).toUpperCase();
  return isRoomCode(raw) ? raw : null;
}

/**
 * A hash that is present but unusable: a link truncated by a chat app, or
 * mangled in the paste. Silently dropping it leaves someone staring at the
 * setup screen wondering why their friend's link did nothing.
 */
function brokenHashCode(): string | null {
  const raw = location.hash.slice(1);
  if (raw.length === 0 || isRoomCode(raw.toUpperCase())) return null;
  // Whatever is in the fragment is somebody else's typing, and it can be any
  // length at all. A toast that quotes it has to quote a readable amount of
  // it: past a couple of codes' worth the quotation is no longer helping the
  // player recognise their own broken link, it is just filling the toast.
  return raw.length > 12 ? `${raw.slice(0, 12)}...` : raw;
}

/** The toast a broken invite link raises, quoting the part that went wrong. */
function brokenLinkMessage(fragment: string): string {
  return (
    `"${fragment}" is not a room code. They're ${CODE_LENGTH} letters. ` +
    "Ask for the link again, or type the code in below."
  );
}

/**
 * Whether a failed join deserves the whole screen.
 *
 * Only one kind does. A wrong code, a full table and a game already dealt are
 * all *moments*: the player is one keystroke from trying again, and taking
 * over the screen to say so put a heading and a "Back to the start" button in
 * front of a typo. Those come back as toasts over the setup screen now.
 *
 * A protocol mismatch is not a moment. This bundle cannot talk to that server
 * until it is reloaded, so every retry fails the same way, and a notice that
 * fades after five seconds would leave the player looking at a form that
 * cannot work. That one keeps its screen, and its reload button.
 */
function needsWholeScreen(kind: ErrorKind | null): boolean {
  return kind === "protocol";
}

/**
 * How many can play, as seats rather than as a figure.
 *
 * It used to read "2 players", which nine of the thirteen cards said, so the
 * smallest type in the lobby spent itself thirteen times on the least
 * interesting fact available. Then it was a bare "2-8" in the corner of the
 * well, which was better -- thirteen figures in one column, comparable down it.
 *
 * This is the same fact drawn instead of set. The question the chip answers is
 * "can the six of us play this", and a range in 0.68rem mono answers it by
 * being read, parsed and compared against a number you are holding in your
 * head. A row of seats answers it by being looked at. It is also the one fact
 * on the card that was being carried by the smallest type in the lobby while
 * the largest thing on it -- the colour -- carried nothing at all.
 *
 * One pip per seat the game can hold, and the first `minPlayers` of them
 * filled: the filled run is what it takes to start, the outlined tail is room
 * left over. Connect Four is two filled and nothing after, which is the whole
 * truth about Connect Four.
 *
 * Filled and open are the *same* colour and differ in shape, which is how
 * everything else in this app that has to survive `--card-well` behind it
 * works -- see Battleships' miss dot in `docs/card-motifs.md`. That is also
 * why this needs no new contrast measurement: `--card-ink` on the chip's scrim
 * is the pairing the figures were already using.
 *
 * The word is gone from the card, so it is put back for anyone listening rather
 * than looking. See `seatLabel`.
 */
function seatPips(table: GameEntry) {
  return Array.from({ length: table.maxPlayers }, (_, i) => (
    <i key={i} className={i < table.minPlayers ? "on" : undefined} />
  ));
}

/** The same range, said out loud, for the card's accessible name. */
function seatLabel(table: GameEntry): string {
  // "1 players" was what a fourteenth game seating one turned this into. The
  // figure on the card is a numeral and reads fine either way; this is the
  // string a screen reader says out loud, so it has to be a sentence.
  if (table.minPlayers === table.maxPlayers) {
    return table.minPlayers === 1 ? 'on your own' : `${table.minPlayers} players`;
  }
  return `${table.minPlayers} to ${table.maxPlayers} players`;
}

/**
 * The palette, and the switch that changes it.
 *
 * Opening is a guess -- your last choice, or your system's preference -- so
 * mounting paints without recording. Pressing the switch is the choice, and is
 * the only thing that writes it down.
 */
function usePalette(): [Palette, () => void] {
  const [palette, setPalette] = useState<Palette>(loadPalette);
  useEffect(() => applyPalette(palette), [palette]);
  return [
    palette,
    () =>
      setPalette((current) => {
        const next = otherPalette(current);
        savePalette(next);
        return next;
      }),
  ];
}

/**
 * Whether the app makes a noise, remembered like the palette is.
 *
 * Off until asked for. A silent game is missing half of itself, and a page that
 * makes a noise the first time you open it on a bus is a page you close. So the
 * switch sits beside the palette switch in the lobby and in the top bar in a
 * room, where it is found rather than buried, and the first sound anyone hears
 * is one they asked for.
 *
 * One switch covers everything: the synthesised dice read the same preference
 * `applySound` writes, and `primeSfx` can only build an audio graph once that
 * preference is on. Turning it off does not need to reach the cues at all.
 */
function useSound(): [boolean, () => void] {
  const [sound, setSound] = useState<boolean>(loadSound);
  useEffect(() => {
    applySound(sound);
    // Order matters: nothing can load until the preference is on. The cue is
    // the switch answering, see `primeSfx`.
    if (sound) primeSfx("tap");
  }, [sound]);
  return [sound, () => setSound((on) => !on)];
}

/**
 * The channel colour, set on the root rather than passed down.
 *
 * The room's own game id wins where there is a room: the lobby's pick is only
 * a preference until the server seats you, and joining someone else's link
 * lands you in a game you never picked.
 */
function useChannel(gameId: string): void {
  useEffect(() => {
    applyChannel(gameId);
  }, [gameId]);
}

/**
 * The toasts outlive the screen they were raised on -- a failed join drops
 * the player back to the setup screen, and the toast saying why has to
 * survive that swap -- so the stack is owned out here, above every screen,
 * and rendered once beside whichever one is showing.
 */
export function App() {
  const toasts = useToasts();
  return (
    <>
      <AppScreens toasts={toasts} />
      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}

function AppScreens({ toasts }: { toasts: Toasts }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState<string | null>(codeFromHash);
  const [intent, setIntent] = useState<"idle" | "play">(codeFromHash() ? "play" : "idle");
  const [create, setCreate] = useState(false);
  /*
    The game the lobby opens on, and the one it draws at twice the size.

    Checked against the manifest rather than trusted, because this is a string
    a browser has been holding since the last visit: a game that has since been
    removed would otherwise put an unknown id into `useRoom`, which is a room
    the server will refuse to build. An id nobody recognises is the same
    situation as a first visit, and gets the same answer.
  */
  const [gameId, setGameId] = useState(() => {
    const last = loadLastGame();
    return last && gameEntry(last) ? last : DEFAULT_GAME_ID;
  });
  const [copied, setCopied] = useState(false);
  const [palette, swapPalette] = usePalette();
  const [sound, toggleSound] = useSound();
  const { push } = toasts;

  // Arriving on a broken link. It reads as an event and not as a state of the
  // form, which is why it is a toast: the remedy -- type the code -- is the
  // screen underneath, and a notice pinned above it was competing with the
  // field it was pointing at.
  useEffect(() => {
    const broken = brokenHashCode();
    if (broken) push(brokenLinkMessage(broken));
  }, [push]);

  useEffect(() => {
    const onHash = () => {
      const next = codeFromHash();
      setCode(next);
      setCreate(false);
      const broken = brokenHashCode();
      if (broken) push(brokenLinkMessage(broken));
      // Without the else, a hash edited to something unusable leaves us with
      // no code, no socket, and no route back to the setup screen.
      setIntent(next ? "play" : "idle");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [push]);

  const {
    room,
    seat,
    status,
    error,
    errorKind,
    errorSeq,
    sendMove,
    requestRematch,
    switchGame,
    startGame,
    dismissError,
    profile,
  } = useRoom({
      active: intent === "play" && Boolean(name),
      name,
      code,
      create,
      gameId,
    });

  useChannel(room?.gameId ?? gameId);
  useTableSounds(room, seat, errorSeq);

  /*
    Cache every summary the server sends, and work out what the last game did.

    Two jobs, one effect, because they are two halves of the same moment: the
    incoming summary is what the lobby will draw next time, and the difference
    between it and the one before is what the end screen draws now. See
    `earnedBetween` for why the delta is subtracted here rather than sent.

    The previous view is held in a ref rather than in state: it is an input to
    a comparison and never something to render, so a re-render on every profile
    message would be a re-render for nothing.
  */
  const [earned, setEarned] = useState<Earned | null>(null);
  const lastProfile = useRef<ProfileView | null>(loadProfileCache());
  useEffect(() => {
    if (!profile) return;
    setEarned(earnedBetween(lastProfile.current, profile));
    lastProfile.current = profile;
    saveProfileCache(profile);
  }, [profile]);

  // A new game clears the last one's takings, so an end screen never opens
  // showing what the *previous* game taught somebody.
  const dealt = room?.waiting === false;
  useEffect(() => {
    if (dealt) setEarned(null);
  }, [dealt, room?.gameId]);

  // What the lobby will open on next time. Written from the room rather than
  // from the pick, so a game somebody else chose still counts as the game you
  // played. Arriving on a link is how half the games here start.
  const playing = room?.gameId;
  useEffect(() => {
    if (playing) saveLastGame(playing);
  }, [playing]);

  // The tab, the other place the two names are read together, and the one
  // `index.html` cannot write, because it can only say what was true before a
  // room was opened.
  const openGame = room?.gameName;
  useEffect(() => {
    document.title = openGame ? `Rebellia Games - ${openGame}` : LOBBY_TITLE;
  }, [openGame]);

  // One way out of a room, shared by the wordmark and the recovery screens, so
  // the hash, the socket and the setup screen can never fall out of step.
  const goHome = () => {
    dismissError();
    history.replaceState(null, "", location.pathname + location.search);
    setCode(null);
    setCreate(false);
    setIntent("idle");
  };

  /*
    Every refusal the server sends becomes one toast, exactly once.

    Keyed on `errorSeq` and not on the message, because two identical
    refusals are two events -- see `useRoom`. `push` and `dismissError` are
    stable, so the effect runs when, and only when, a refusal arrives.

    The second half is the part that used to be a whole screen. A join that
    failed left us retrying a room that was never going to accept us, behind
    a card whose only control was a way back; now the toast carries the
    reason and we take the way back ourselves, which also stops the retry
    loop. `!room` is what distinguishes a *join* failing from a move being
    refused inside a room we are already sitting in.
  */
  useEffect(() => {
    if (errorSeq === 0 || !error) return;
    push(error, errorKind);
    if (!room && !needsWholeScreen(errorKind)) goHome();
    // `error`, `errorKind` and `room` are read at the moment a refusal lands,
    // not watched -- `errorSeq` is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorSeq, push]);

  // Copying the invite is one behaviour with two faces: the code in the
  // topbar, and -- while the room is still filling -- the big code that
  // replaces it. Only ever one of them is on screen, and they must not drift
  // apart, because the confirmation state is shared between them.
  const copyInvite = (roomCode: string) => {
    navigator.clipboard?.writeText(inviteUrl(roomCode));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const swapLabel = PALETTES[otherPalette(palette)].label;

  // The room writes one status for the whole table, so before the deal it names
  // the host: "Ready. Amelia can start whenever you are". Read by everyone else
  // that is exactly right. Read by Amelia it is her own name in the third
  // person, in her own room, telling her about herself.
  //
  // The room cannot fix this, because it does not write per-seat, and it should
  // not start, because one status per room is what makes it cheap to broadcast.
  // The client knows which seat it is, so the second person goes back here.
  const statusLine =
    room?.waiting && seat === 0 && room.canStart
      ? "Everyone's here. Start whenever you're ready."
      : room?.status;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        pendingCode={code}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        sound={sound}
        onToggleSound={toggleSound}
        lastGameId={gameId}
        // Naming yourself is not starting anything: the chip in the bar can be
        // pressed by somebody who only wants to correct their own spelling, and
        // that has to be remembered without opening a room to do it.
        onName={(chosenName) => {
          saveName(chosenName);
          setName(chosenName);
        }}
        onStart={(chosenName, joinCode, chosenGame) => {
          saveName(chosenName);
          setName(chosenName);
          // Null when joining: that room already knows what it is playing, and
          // guessing here would only be a guess the server then corrects.
          if (chosenGame) setGameId(chosenGame);
          // The client picks the code for a new game so the room is
          // addressable from the very first request.
          const target = joinCode ?? makeRoomCode();
          setCreate(joinCode === null);
          setCode(target);
          history.replaceState(null, "", roomUrl(target));
          setIntent("play");
        }}
      />
    );
  }

  // This seat is being played somewhere else. Retrying would take it back off
  // whichever tab has it, which would take it back off us, so we stop and make
  // continuing here an explicit choice.
  if (status === "superseded") {
    return (
      <main className="app setup">
        <h1 className="wordmark">Playing in another window</h1>
        <p className="tagline">
          You opened this game somewhere else, so this window stopped to stay out of its way.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Play here instead
        </button>
      </main>
    );
  }

  // The one refusal that is a state rather than a moment. Everything else that
  // can go wrong with a join is a toast over the setup screen, which the
  // effect above sends us back to; this bundle cannot talk to this server at
  // all, so there is nothing behind a toast worth looking at, and "back to the
  // start" would only re-send the same stale hello and fail the same way. The
  // screen asks for a refresh, and the button has to actually be one.
  if (!room && error && needsWholeScreen(errorKind)) {
    return (
      <main className="app setup">
        <h1 className="wordmark">Time for a refresh</h1>
        <p className="tagline">{error}</p>
        <button className="primary" onClick={() => location.reload()}>
          Refresh the page
        </button>
      </main>
    );
  }

  // One source for the connection wording, so the banner and the status line
  // can never disagree, and "connecting" is never dressed up as "reconnecting"
  // to someone who has not been connected yet.
  const connectionNote =
    status === "open" ? null : room ? "Reconnecting..." : "Connecting...";

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          <button type="button" className="home" onClick={goHome} title="Back to the start">
            <TopMark gameName={room?.gameName} />
          </button>
        </h1>
        <div className="room-meta">
          {/* Not while the room is still filling. Down there the code is the
              whole screen -- the thing you read down a phone -- and the same
              four letters twice on one screen reads as two different codes
              for a moment before it reads as one. */}
          {room && !room.waiting && (
            <button
              className="code"
              title="Copy the invite link"
              /* The visible label is the code, which says what this *is* and
                 not what pressing it does. On a mouse the title covers that;
                 on a phone nothing does, and this is the one control the
                 whole waiting state depends on. Both names keep the visible
                 text inside them, so speaking the label still matches what is
                 on screen. */
              aria-label={copied ? "Invite link copied" : `Copy the invite link, room ${room.code}`}
              onClick={() => copyInvite(room.code)}
            >
              {copied ? "Copied" : room.code}
            </button>
          )}
          <SoundButton on={sound} onToggle={toggleSound} />
          {/* Glanceable rather than read, but a colour alone is not available
              to everyone, and a bare title is available to almost nobody --
              not to a screen reader, and not to a finger. `role="img"` names
              it on demand without announcing itself: the banner and the
              status line already say when the connection drops, and a third
              voice saying it would be the same news three times. */}
          <span
            className={`dot ${status}`}
            role="img"
            aria-label={connectionNote ?? "Connected"}
            title={connectionNote ?? "Connected"}
          />
        </div>
      </header>

      {connectionNote && <div className="banner">{connectionNote}</div>}

      {/* Not on a table whose board draws the seats itself, see `ownsSeats`.
          Only once the game is dealt, though: before that there is no board,
          and the strip is the only thing on the screen saying who has arrived. */}
      {room && (room.waiting || !ownsSeats(room.gameId)) && (
        <div className="players">
          {room.players.map((p) => (
            <div
              key={p.seat}
              className={[
                "player",
                `p${p.seat}`,
                room.turn === p.seat && !room.waiting ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="chip" />
              <span className="who">{p.name || "Empty seat"}</span>
              {p.seat === seat && <span className="note">you</span>}
              {p.name && !p.connected && <span className="note">away</span>}
            </div>
          ))}
        </div>
      )}

      {/* Announced, not just shown: whose turn it is changes without the
          player touching anything, and a turn-based game can sit for hours.
          The live region stays mounted when the game ends: moving the same
          sentence into the result block below would announce it twice, so the
          result borrows it and this hides. */}
      <p className="status" role="status" aria-live="polite">
        {room?.over ? "" : (statusLine ?? connectionNote ?? "")}
      </p>

      {room?.over && (
        <div className="result">
          <p className="who">{room.status}</p>
        </div>
      )}

      {/* No board until the game is dealt. Before that there is no state to
          draw, and a board improvised out of nothing would be showing the
          player a game that does not exist yet. */}
      {room && !room.waiting ? (
        <GameBoard room={room} seat={seat} sendMove={sendMove} />
      ) : (
        <div className="board placeholder" />
      )}

      {room?.waiting && (
        <>
          {/* The code is the only job on this screen, so it is also the
              control: the thing you read out is the thing you press to send.
              It used to be a plain box sitting next to a copy button in the
              corner, which made the code look like a label rather than the
              one thing worth acting on. */}
          <button type="button" className="bigcode" onClick={() => copyInvite(room.code)}>
            <span className="label">{copied ? "Link copied" : "Room code"}</span>
            <span className="value">{room.code}</span>
            <span className="act">Tap to copy the invite link</span>
          </button>
          <p className="hint">
            Send the link, or read the code out. Whoever turns up gets a seat,
            up to {room.capacity} for {room.gameName}.
          </p>
          {/*
            Somebody has to say when everyone is here, because the room no
            longer knows how many to expect. It is the player who opened it:
            seat 0. Everyone else is told what is being waited for rather than
            being shown a button that would only be refused.
          */}
          {seat === 0 ? (
            <button className="primary" disabled={!room.canStart} onClick={startGame}>
              {room.canStart
                ? `Start with ${room.players.length}`
                : /*
                     Not "waiting for <game>'s minimum": two of the nine games
                     are named with a possessive already, and "Nine Men's
                     Morris's minimum" is a sentence nobody should have to
                     read. The plain version says the same thing and says it
                     the same way for every game.
                  */
                  "Waiting for more players"}
            </button>
          ) : null}
          {/*
            No hint here for anyone but seat 0. It used to say "<host> can
            start whenever you are ready." directly beneath a status line
            already reading "Ready. <host> can start whenever you are": the same
            sentence twice, in two wordings, and, both being polite live
            regions, announced twice as well.
          */}
        </>
      )}

      {room?.over && (
        <>
          <Takings earned={earned} />
          <button className="primary" onClick={requestRematch}>
            Play again
          </button>
          <NextGame room={room} onPick={switchGame} />
        </>
      )}
    </main>
  );
}

/**
 * The end of a game is the one moment a room can change what it is playing:
 * everybody is here, nobody is mid-turn, and the alternative is swapping links
 * to reassemble the same people around a different board.
 *
 * Only games that seat exactly this table are offered. The seats are already
 * taken, so a two-handed game in a four-handed room would have to drop two
 * people, and it is better not to offer it than to explain that afterwards.
 * Nothing is shown at all when that leaves no alternatives.
 */
/**
 * What that game taught you, above the rematch button.
 *
 * The moment worth showing somebody, and the reason the server pushes a
 * profile the instant a finished game is filed rather than waiting to be
 * asked. It draws nothing at all for a guest, nothing for the eleven games
 * that teach no vocabulary beyond their small flat payment, and nothing for a
 * player who was away when the summary arrived — which is the honest answer to
 * "what did that game teach you" for somebody who was not there.
 *
 * The words-due line is the one that does the work. It is the same number the
 * lobby badge shows, said at the moment somebody has just finished playing and
 * is deciding whether to go again.
 */
function Takings({ earned }: { earned: Earned | null }) {
  if (!earned) return null;
  return (
    <section className="takings" aria-labelledby="takings-head">
      <h2 id="takings-head">
        {earned.learned > 0
          ? `${earned.learned} new ${earned.learned === 1 ? "word" : "words"}`
          : "Nothing new, but it counted"}
      </h2>
      <p className="takings-xp">+{earned.xp.toLocaleString()} XP</p>
      {earned.streak && <p className="takings-streak">That is today done.</p>}
      {earned.due > 0 && (
        <p className="takings-due">
          {earned.due} {earned.due === 1 ? "word is" : "words are"} due for review.
        </p>
      )}
    </section>
  );
}

function NextGame({ room, onPick }: { room: RoomView; onPick(gameId: string): void }) {
  const others = gameList().filter(
    (game) => game.id !== room.gameId && canSeat(game, room.players.length),
  );
  if (others.length === 0) return null;

  return (
    <section className="next-game" aria-labelledby="next-game-heading">
      <h2 id="next-game-heading">Or play something else</h2>
      <div className="games">
        {others.map((game) => (
          <button
            key={game.id}
            className="game"
            data-game={game.id}
            onClick={() => onPick(game.id)}
          >
            <span className="name">{game.name}</span>
          </button>
        ))}
      </div>
      <p className="hint">Same room, same people, same code.</p>
    </section>
  );
}

/**
 * The board for whatever this room is playing.
 *
 * There is no per-game branching left here: `boardFor` looks the component up
 * in a table the compiler has already checked, so adding a game touches that
 * table and this file not at all. What used to be here was a ten-case switch
 * in which every case cast `room.state` to a game's state type by hand, with
 * nothing checking that the case label and the cast agreed.
 */
function GameBoard({
  room,
  seat,
  sendMove,
}: {
  room: RoomView;
  seat: number | null;
  sendMove(move: unknown): void;
}) {
  // No state means the game is not dealt; no board means this build has never
  // heard of the game, an old tab against a newer server. Neither is a dead
  // end: the status line above still reads.
  const Board = boardFor(room.gameId);
  if (!room.state || !Board) return <div className="board placeholder" />;

  return (
    <Board
      state={room.state as never}
      seat={seat}
      names={room.players.map((p) => p.name)}
      connected={room.players.map((p) => p.connected)}
      canAct={room.canAct}
      now={room.now}
      onMove={sendMove}
    />
  );
}

/**
 * The sound switch, as an icon, for the top bar.
 *
 * The lobby spells the preference out in words because there is room for words
 * there. In a room there is not, so it becomes a speaker -- with the state in
 * `aria-pressed` and in the label, because "is that speaker crossed out?" is a
 * question a 16px glyph should never be the only answer to.
 */
function SoundButton({ on, onToggle }: { on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="mute"
      aria-pressed={on}
      aria-label={`Sound ${on ? "on" : "off"}`}
      title={on ? "Turn sound off" : "Turn sound on"}
      onClick={onToggle}
    >
      {/* One speaker, drawn once: only the waves change, so the two states
          cannot drift apart in size or alignment. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path className="cone" d="M2 6h2.4L7.5 3.2v9.6L4.4 10H2z" />
        {on ? (
          <>
            <path d="M9.9 5.7a3 3 0 0 1 0 4.6" />
            <path d="M11.9 3.8a6 6 0 0 1 0 8.4" />
          </>
        ) : (
          <path d="M10.3 6.3l3.4 3.4M13.7 6.3l-3.4 3.4" />
        )}
      </svg>
    </button>
  );
}

/**
 * One game on the shelf: its table, mid-play, with a way to sit down at it.
 *
 * A button rather than a radio, and that is the whole change to this screen.
 * The card used to pick a game which a button 957px further down then started,
 * so the label that named your choice ("Start Connect Four") was read at the
 * one moment your choice had scrolled off the top. Pressing the table you want
 * is one act instead of two, and it removes the only control on the screen that
 * had to be hunted for.
 *
 * What that costs is the confirmation step, and the answer to a mis-tap is
 * that a room is free: nothing is spent, nobody is told, and the wordmark is
 * the way back. What it saves is the `.picked` state, the Start button, and
 * the two of them having to agree about which game they meant.
 *
 * Every card is its own tab stop, which is what a list of buttons is. No
 * roving tabindex and no `aria-checked`: there is nothing selected here any
 * more, so there is no selection to model.
 */
function TableCard({
  table,
  onStart,
}: {
  table: GameEntry;
  onStart(gameId: string): void;
}) {
  return (
    <button className="game" data-game={table.id} onClick={() => onStart(table.id)}>
      <CardArt gameId={table.id} />
      <span className="name">{table.name}</span>
      <span className="blurb">{table.blurb}</span>
      <TableFacts table={table} />
    </button>
  );
}

/**
 * The table you left, laid out the way a table is: wide.
 *
 * The featured card used to be an ordinary card at twice the size, which meant
 * a portrait crop stretched across two columns with its name underneath. A
 * card that is going to be the biggest thing on the screen may as well be the
 * shape of the thing it is showing, so the motif takes one side and the words
 * take the other -- and it gains the one control the shelf does not have: a
 * verb. "Play again" is a different offer from "Connect Four", and it is the
 * offer this card is actually making.
 *
 * The art stays a 5:2 well at phone width, stacked above the words, because
 * that is the crop all thirteen motifs were composed against and a hero is not
 * worth re-drawing them for. Past 560px it takes the right-hand half instead;
 * `picker.css` says what that costs the two motifs drawn in SVG.
 */
function HeroCard({
  table,
  onStart,
}: {
  table: GameEntry;
  onStart(gameId: string): void;
}) {
  return (
    <button className="game featured" data-game={table.id} onClick={() => onStart(table.id)}>
      <CardArt gameId={table.id} />
      <span className="face">
        <span className="resume">Last played</span>
        <span className="name">{table.name}</span>
        <span className="blurb">{table.blurb}</span>
        <TableFacts table={table} />
        <span className="cta">Play again</span>
      </span>
    </button>
  );
}

/**
 * Who can play, and how long it takes, on one line under the blurb.
 *
 * The seats used to be a chip stamped on the corner of the motif, which was
 * the only place they fitted while the card had nothing else to say. They have
 * company now -- see `minutes` in the manifest -- and two facts about the same
 * game belong on one line in the card body, where neither of them is lying on
 * top of a crop of a board.
 *
 * Both are drawn rather than written, and both are hidden from anyone
 * listening, because a row of pips and a tilde are shapes. The sentence
 * underneath is the same two facts, said once, in the order they are read.
 */
function TableFacts({ table }: { table: GameEntry }) {
  return (
    <span className="facts">
      <span className="count" aria-hidden="true">
        {seatPips(table)}
      </span>
      <span className="mins" aria-hidden="true">
        ~{table.minutes} min
      </span>
      <span className="sr-only">
        {seatLabel(table)}, about {table.minutes} minutes
      </span>
    </span>
  );
}

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

/** Which panel under the bar is open, if any. */
type Panel = null | "name" | "profile";

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
function JoinBox({
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
      <h2>Join a room</h2>
      <CodeCells value={code} field={field} onChange={onCode} />
      {/* Only for somebody this browser has never been told the name of.
          Everybody else is named in the bar above, and asking a returning
          player to type it again in front of a code is the form this screen
          got rid of. */}
      {askName ? (
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Amelia"
            maxLength={20}
          />
        </label>
      ) : (
        <p className="join-as">
          Joining as {trimmed}.{" "}
          <button type="button" className="linky" onClick={onEditName}>
            Not you?
          </button>
        </p>
      )}
      <button className="primary" disabled={!trimmed || !complete}>
        Join
      </button>
      {/* Under the button rather than over it, and absent until there is
          something to say. It used to sit above with 2.4em reserved under a
          line of instructions nobody needed twice, which was a third of the
          card's height spent on a hint. Below the button, appearing costs
          nobody a mis-press: the only control it can move is not there. */}
      {status && (
        <p className="hint" id="code-hint">
          {status}
        </p>
      )}
    </form>
  );
}

function Setup({
  initialName,
  pendingCode,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
  lastGameId,
  onName,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
  lastGameId: string;
  onName(name: string): void;
  onStart(name: string, code: string | null, gameId: string | null): void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(pendingCode ?? "");
  /*
    The screen opens with nothing on it but the shelf.

    The name and the code used to be the first two things on this page, which
    put a form in front of the only thing anybody came here for. Both are still
    here and neither has moved far: they are one press away in the bar, and the
    press is only ever needed by somebody who has something to type. Arriving
    on a link that did not open is the one case that is known in advance, so
    that one opens the code panel itself rather than sending a person holding a
    code off to look for where to put it.
  */
  const [panel, setPanel] = useState<Panel>(null);
  /*
    The last summary this browser was sent, which is all the lobby can have:
    a profile arrives down a socket and the shelf has none. Held in state
    rather than read on every render so that signing in, signing out or
    pasting a key repaints the badge without a reload.
  */
  const [profile, setProfile] = useState(loadProfileCache);
  /*
    The table somebody pressed before this app knew what to call them.

    A seat cannot be taken anonymously -- the server wants a name in `hello`,
    and the people already at the table want to know who just sat down -- so a
    first-time visitor pressing a card is asked, once, on the spot. Holding the
    game here is what makes that one question rather than two: the answer
    starts the game they already chose instead of returning them to the shelf
    to choose it again.
  */
  const [pending, setPending] = useState<string | null>(null);
  /*
    Whether the join box asks for a name as well, decided once on arrival and
    not while somebody is typing.

    Asking for it is right: somebody arriving on a code they were sent may
    never have been here before, and the room needs to be able to say who just
    joined. Asking for it *live* is not. Written as "show the field while there
    is no name", the field vanished on the first letter typed into it, taking
    the cursor with it. One answer per visit.
  */
  const [askName] = useState(!initialName.trim());
  const nameField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  /*
    A panel that opens without the cursor in it is a panel somebody has to find
    their way into after asking for it.

    Which field gets the cursor is the question the panel still has left. Off an
    invite link the code is already filled in, so the cursor belongs in the name
    beside it rather than at the end of four letters nobody has to type.
  */
  useEffect(() => {
    if (panel === "name") nameField.current?.focus();
  }, [panel]);

  /*
    Arriving on an invite link that did not open by itself.

    The join box is on the page either way, so nothing has to be opened for
    them; what is left is the cursor, which belongs in the box that is already
    filled in rather than at the top of the page. Once only, on the first
    render: moving it later would take it out of whatever they have started
    typing.
  */
  useEffect(() => {
    if (pendingCode) codeField.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    The shelf, with the game you last sat down to standing above it.

    Falling back to the head of the list covers a first visit and a stored id
    from a game that has since been removed. Both are "no game on top", and
    neither is worth an empty frame.

    The three shelves come from `shelvedGames`, which also takes the featured
    game out of them -- in the manifest rather than here, so the tally in a
    shelf's heading is counted from the same list the cards under it are drawn
    from.
  */
  const tables = gameList();
  const featured = tables.find((game) => game.id === lastGameId) ?? tables[0];
  const shelves = shelvedGames(featured.id);

  const togglePanel = (which: Exclude<Panel, null>) => {
    setPanel(panel === which ? null : which);
    setPending(null);
  };

  const start = (gameId: string) => {
    if (!trimmed) {
      setPending(gameId);
      setPanel("name");
      return;
    }
    play("tap");
    onStart(trimmed, null, gameId);
  };

  const submitName = () => {
    if (!trimmed) {
      nameField.current?.focus();
      return;
    }
    onName(trimmed);
    const table = pending;
    setPending(null);
    setPanel(null);
    if (table) {
      play("tap");
      onStart(trimmed, null, table);
    }
  };

  const join = () => {
    if (!trimmed || code.length !== CODE_LENGTH) return;
    onStart(trimmed, code, null);
  };

  // Escape closes whichever panel is open, which is what Escape does to
  // anything that opened over the page.
  const onEscape = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setPanel(null);
    setPending(null);
  };

  const pendingName = pending ? gameEntry(pending)?.name : undefined;

  return (
    <main className="app setup">
      {/* The whole of the old left-hand column, folded onto one line: who you
          are, and the one control somebody arriving with a code came for. */}
      <header className="lobby-bar">
        <h1 className="wordmark">
          <BrandMark />
        </h1>
        <button
          type="button"
          className="whoami"
          aria-expanded={panel === "name"}
          onClick={() => togglePanel("name")}
        >
          <span className="av" aria-hidden="true">
            {(trimmed || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="who">{trimmed || "Add your name"}</span>
        </button>

        {/* Anchored under the chip that opened it rather than laid across the
            page. As a block in the flow it was a full-width card that shoved
            the join box, the tagline and the whole shelf down the screen to
            ask for one word; out of flow it costs the page no height at all
            and appears where the press was. */}
        {panel === "name" && (
        <form
          className="panel panel-pop"
          onKeyDown={onEscape}
          onSubmit={(e) => {
            e.preventDefault();
            submitName();
          }}
        >
          <label>
            {/* Naming the table they pressed, because they pressed it a second
                ago and this question arrived on top of it. */}
            {pendingName ? `Sitting down at ${pendingName}. Your name` : "Your name"}
            <input
              ref={nameField}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Amelia"
              maxLength={20}
            />
          </label>
          <button className="primary" disabled={!trimmed}>
            {pendingName ? "Deal me in" : "Save"}
          </button>
        </form>
        )}
      </header>

      {/* The one thing on this screen with a deadline: somebody is holding
          four letters somebody else read out. It sits above the tagline and
          the shelf, and it is never behind a press. */}
      <JoinBox
        code={code}
        onCode={setCode}
        field={codeField}
        name={name}
        onName={setName}
        askName={askName}
        onEditName={() => togglePanel("name")}
        onJoin={join}
      />

      {/* The tagline and the way into your words, on one line.

          The due prompt used to be a full-width dashed bar of its own between
          the two, which read as an empty form field somebody had forgotten to
          fill in -- the loudest shape on the screen for the quietest state it
          has. Paired with the tagline it is a line of lobby furniture instead,
          and it still gets to be loud on the one state that earns it.

          Not in the bar above: three chips do not fit at 375px, and the bar's
          wordmark is the thing that would have lost the characters. That is
          pinned in `css.test.ts`.

          Cached rather than live, because the lobby has no socket. See
          `profileCache.ts` for why a count that can only understate is the
          right trade. */}
      <div className="lobby-meta">
        {/* The tagline's third clause used to be "no accounts", and it was
            true. Accounts exist now and are optional, so it says the thing
            that is still true and is the actual selling point: nobody needs
            one, and a room where nobody has one plays exactly as it always
            has. */}
        <p className="tagline">
          Two to eight players, one link. No ads, no account needed, no catch.
        </p>

        <button
          type="button"
          className={profile && profile.due > 0 ? "myword myword-due" : "myword"}
          aria-expanded={panel === "profile"}
          onClick={() => togglePanel("profile")}
        >
          {profile && profile.due > 0 ? (
            <>
              <span className="myword-n">{profile.due}</span>
              <span className="myword-of">
                {profile.due === 1 ? "word due for review" : "words due for review"}
              </span>
            </>
          ) : (
            <span className="myword-of">
              {profile ? "Your words" : "Keep track of what you learn"}
            </span>
          )}
        </button>
      </div>

      {panel === "profile" && (
        <Profile profile={profile} onChanged={() => setProfile(loadProfileCache())} />
      )}

      {/* One element around the shelf, which `base.css` reads: the two recovery
          screens wear `.app.setup` too, and the desktop layout is for the lobby
          rather than for a wordmark and a button. */}
      <div className="shelves">
        <HeroCard table={featured} onStart={start} />

        {shelves.map((shelf) => (
          <section key={shelf.id} className="shelf" aria-labelledby={`shelf-${shelf.id}`}>
            <h2 className="shelf-head" id={`shelf-${shelf.id}`}>
              {shelf.label}
              {/* For the eye, which is deciding whether this shelf is the one
                  worth reading. Anybody listening has the section's heading and
                  then the cards themselves, which is a better count than a
                  number read out ahead of them. */}
              <span className="tally" aria-hidden="true">
                {shelf.games.length}
              </span>
            </h2>
            <div className="games">
              {shelf.games.map((game) => (
                <TableCard key={game.id} table={game} onStart={start} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="preferences">
        <button className="swap" onClick={onSwapPalette}>
          {swapLabel}
        </button>
        <button className="swap" aria-pressed={sound} onClick={onToggleSound}>
          Sound {sound ? "on" : "off"}
        </button>
      </div>
    </main>
  );
}
