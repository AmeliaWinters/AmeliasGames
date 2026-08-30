import { useEffect, useRef, useState } from "react";
// The manifest, not the registry: the lobby needs ids and names, and importing
// the registry here would pull every reducer into the client bundle.
import { DEFAULT_GAME_ID, gameEntry } from "../shared/games/manifest.js";
import { makeRoomCode } from "../shared/roomCode.js";
// Every mark and motif this shell draws. See `art.tsx`: none of it reads the
// room, so none of it belongs in the file that runs the room.
import { TopMark } from "./art.js";
import { ownsSeats } from "./games/ownsSeats.js";
import {
  inviteUrl,
  loadLastGame,
  loadName,
  saveLastGame,
  saveName,
  useRoom,
} from "./net.js";
import type { ErrorKind } from "../shared/protocol.js";
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
import { primeSfx, useTableSounds } from "./sfx.js";
import { useTurnNotices } from "./notify.js";
import { Toaster, useToasts, type Toasts } from "./toast.js";
import {
  brokenHashCode,
  brokenLinkMessage,
  codeFromHash,
  lobbyUrl,
  roomUrl,
  screenAt,
  screenUrl,
  type Screen,
} from "./route.js";
// The screens themselves. This file decides which one is showing and what it is
// showing about; what each of them looks like is its own file.
import { Setup } from "./screens/Setup.js";
import {
  GameBoard,
  Lobby,
  NextGame,
  RoomAccount,
  RoomAccountScreen,
  RoomChests,
  Result,
  TableAfter,
  Takings,
  type RoomScreen,
} from "./screens/Room.js";
import {
  earnedBetween,
  loadProfileCache,
  saveProfileCache,
  type Earned,
} from "./profileCache.js";
import type { LearnLang, ProfileView } from "../shared/profile.js";
import { saveVocabCache } from "./vocabCache.js";


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
  /*
    Which screen the address bar is on, or null for the lobby.

    The account used to be a panel with no address: opened from the chip,
    closed by the same chip or by Escape, and invisible to the back button --
    which on a phone is *the* way back, so pressing it from four screens deep
    in the customiser left the app entirely. Then it was one page, `/account`,
    with the screen inside it held in state -- which fixed the back button and
    left "open the chests" unlinkable and Back still meaning "leave", from any
    depth. Each screen has its own path now. See `route.ts`.
  */
  const [screen, setScreen] = useState<Screen | null>(screenAt);
  // How many entries in this history we pushed, so leaving knows whether there
  // is anything of ours to go back through. See `onLeave` below, its only
  // reader.
  const pushedScreens = useRef(0);
  useEffect(() => {
    const onPop = () => {
      const here = screenAt();
      if (!here) pushedScreens.current = 0;
      else if (pushedScreens.current > 0) pushedScreens.current -= 1;
      setScreen(here);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [copied, setCopied] = useState(false);
  /*
    Which account screen is open over a room, or null for the table itself.

    The account is in both headers now, and the room's header is not on the
    account route -- `Setup` is not even mounted while a game is up. Navigating
    there would mean leaving the room, which is the one thing these controls
    must never do: the moment a chest becomes affordable is the moment a game
    just paid for it, and the answer to "you earned a chest" cannot be "leave
    the table". So in here each of them is a layer over the room rather than a
    page, the socket underneath stays connected, and Back puts the board
    straight back.
  */
  const [roomScreen, setRoomScreen] = useState<RoomScreen | null>(null);
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
    vocab,
    requestVocab,
  } = useRoom({
      active: intent === "play" && Boolean(name),
      name,
      code,
      create,
      gameId,
    });

  useChannel(room?.gameId ?? gameId);
  useTableSounds(room, seat, errorSeq);
  // The same event as the `turn` cue, for the player who is not here to hear
  // it. See `notify.ts`.
  useTurnNotices(room, seat);

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
  /*
    The profile the header draws, which is not always the one the socket sent.

    `profile` from `useRoom` is null until the room pushes a summary, and that
    is after the join -- so for the first second of every game the chest pill
    would be absent and then appear, which reads as a bug rather than as news.
    The lobby has drawn from the cache for exactly this reason since it had no
    socket at all; the room takes the same fallback, and the live copy wins the
    moment there is one. See `profileCache.ts`.
  */
  const [cached] = useState(loadProfileCache);
  const shown = profile ?? cached;

  const [earned, setEarned] = useState<Earned | null>(null);
  const lastProfile = useRef<ProfileView | null>(loadProfileCache());
  useEffect(() => {
    if (!profile) return;
    setEarned(earnedBetween(lastProfile.current, profile));
    lastProfile.current = profile;
    saveProfileCache(profile);
  }, [profile]);

  /*
    Refresh the stored ledger the moment there is both a reason and a socket.

    A finished game is the only thing that changes the ledger and the end of
    one is the only time this client is sure of having a socket -- the lobby,
    which is where the Vocabulary screen is actually opened, has none. See
    `vocabCache.ts`, which makes the same argument the summary cache makes one
    size up.

    The language that earned most, and only that one. `earnedBetween` sorts
    nothing, but a game teaches one language in every case that exists today
    (both language games pick a language before they deal), and asking for
    three would be two round trips spent on empty lists plus a race in `net.ts`,
    which keeps only the last answer.
  */
  useEffect(() => {
    const best = earned?.langs.reduce(
      (top, row) => (top === null || row.xp > top.xp ? row : top),
      null as { lang: LearnLang; xp: number } | null,
    );
    if (best) requestVocab(best.lang);
  }, [earned, requestVocab]);

  useEffect(() => {
    if (vocab) saveVocabCache(vocab.lang, vocab.words, Date.now());
  }, [vocab]);

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
    history.replaceState(null, "", lobbyUrl());
    // The entry we replaced was ours, and so is every screen behind it: this
    // is a fresh start on the lobby, so there is nothing left to go back
    // through. Leaving the count standing would make the next ✕ a `go(-2)`
    // out of the app.
    pushedScreens.current = 0;
    setScreen(null);
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
      ? // And no "start whenever you're ready" after it: the Start button is
        // the next thing on the screen, and the sentence was reading it out.
        "Everyone's here."
      : room?.status;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        /* The account screens raise their own toasts -- a thing worn, a key
           taken -- and the stack is up here above every screen, so the push
           is handed down rather than a second Toaster being mounted in
           there. See `AccountScreens`. */
        onToast={toasts.push}
        pendingCode={code}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        sound={sound}
        onToggleSound={toggleSound}
        lastGameId={gameId}
        /*
          The screens, driven by the address rather than by a flag.

          Pushed rather than replaced, so the back button is the way out and
          the screen before is what it goes back to -- which is the whole
          reason each of them has a path: from the chests reached out of the
          customiser, Back now means the customiser, and it used to mean the
          lobby. `setScreen` is still called beside the push because a
          pushState raises no popstate of its own.
        */
        screen={screen}
        onOpenScreen={(to) => {
          history.pushState(null, "", screenUrl(to));
          pushedScreens.current += 1;
          setScreen(to);
        }}
        /*
          Up one, which is what the Back at the foot of every screen means now.

          It could not mean that while the screens shared an address: there was
          one entry for all of them, so "up" and "out" were the same step and
          the chests reached from the customiser needed a flag to tell them
          apart. With a path each, the browser already holds the answer.
        */
        onBack={() => {
          if (pushedScreens.current > 0) {
            history.back();
            return;
          }
          history.replaceState(null, "", lobbyUrl());
          setScreen(null);
        }}
        onLeave={() => {
          /*
            Back through our own entries, replace when there are none.

            `history.back()` off an entry this app never pushed -- somebody who
            typed `/chests` in, or followed a link straight to it -- is a step
            out of the app, onto whatever they were reading before. Replacing
            leaves them on the lobby with no way back to a page they can reopen
            from the chip anyway.

            It is `go(-n)` rather than one step because this is the ✕, which
            means "out of here" and not "up one": pressing it two screens deep
            has to reach the lobby, not the screen behind.
          */
          const back = pushedScreens.current;
          if (back > 0) {
            pushedScreens.current = 0;
            history.go(-back);
            return;
          }
          history.replaceState(null, "", lobbyUrl());
          setScreen(null);
        }}
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
          pushedScreens.current = 0;
          setScreen(null);
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

  /*
    The chest screen, over the room.

    It returns instead of the board rather than on top of it, which sounds like
    the same thing and is not: the room's own components stay unmounted for the
    duration, so nothing on the board is ticking, listening or animating behind
    a screen nobody can see. The socket is a hook up in this component and is
    untouched by any of it, so the game is exactly where it was on the way back.

    See `RoomChests` for why the caches are read here again rather than passed
    down from the lobby: the lobby is not mounted.
  */
  if (roomScreen) {
    return (
      <main className="app acct-page room-chests">
        {roomScreen === "chests" ? (
          <RoomChests
            profile={shown}
            onToast={toasts.push}
            onBack={() => setRoomScreen(null)}
          />
        ) : (
          <RoomAccountScreen
            screen={roomScreen}
            profile={shown}
            vocab={vocab}
            onRequestVocab={requestVocab}
            onBack={() => setRoomScreen(null)}
            onOpenChests={() => setRoomScreen("chests")}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          <button type="button" className="home" onClick={goHome} title="Back to the start">
            <TopMark gameName={room?.gameName} />
          </button>
        </h1>
        {/* Who you are, and everything that belongs to you: the chest, the
            balance, and the chip that opens the account. The code is not here
            any more -- it is at the top of the lobby, at a size somebody can
            read out loud. See `RoomAccount`. */}
        <RoomAccount
          profile={shown}
          name={name}
          onName={(chosen) => {
            saveName(chosen);
            setName(chosen);
          }}
          /* A key that came or went takes the cached summary with it, so the
             purse and the chest have to be redrawn from nothing rather than
             from the last account's balance. */
          onChanged={() => setName(loadName())}
          status={status}
          connectionNote={connectionNote}
          swapLabel={swapLabel}
          onSwapPalette={swapPalette}
          sound={sound}
          onToggleSound={toggleSound}
          onOpen={setRoomScreen}
        />
      </header>

      {connectionNote && <div className="banner">{connectionNote}</div>}

      {/* Not on a table whose board draws the seats itself, see `ownsSeats`,
          and not while the room is filling: the waiting screen has a seat grid
          of its own, which says how many seats there are as well as who is in
          them. Nor once the game is over: `TableAfter` below draws the same
          people at the size the lobby does, and the reason this strip is small
          -- a board underneath it that needs the height, and a turn that is
          about to move -- has stopped being true. */}
      {room && !room.waiting && !room.over && !ownsSeats(room.gameId) && (
        <div className="players">
          {room.players.map((p) => (
            <div
              key={p.seat}
              className={[
                "player",
                `p${p.seat}`,
                room.turn === p.seat ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="chip" />
              <span className="who">{p.name || "Empty seat"}</span>
              {/* No faces here, deliberately. This strip is two to a row on a
                  phone and the comment above it records the bug that settled
                  that: at four players the name was already down to "A..." for
                  Ann, and three portraits would take another 36px off the half
                  that gives. The lobby list is where the showcase is drawn,
                  which is also where somebody is actually looking at who else
                  is in the room. */}
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

      {room?.over && <Result room={room} seat={seat} />}

      {/* No board until the game is dealt. Before that there is no state to
          draw, and a board improvised out of nothing would be showing the
          player a game that does not exist yet. */}
      {room && !room.waiting && <GameBoard room={room} seat={seat} sendMove={sendMove} />}

      {room?.waiting && (
        <>
          <Lobby
            room={room}
            seat={seat}
            copied={copied}
            onCopyCode={copyInvite}
          />
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
          <TableAfter room={room} seat={seat} />
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

