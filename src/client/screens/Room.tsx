/**
 * What a room draws once you are in one: the table, the seats around it, the
 * chest that opens over it, and the two controls that belong to the room
 * rather than to the shell.
 *
 * Split out of `App.tsx` when that file reached 2,300 lines. Nothing in here
 * reads the socket. Everything arrives as a prop from `AppScreens`, which is
 * the one place that knows there is a connection at all, and that is the line
 * the split was made along: this file is what a room looks like, not how it
 * works.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { canSeat, gameList } from "../../shared/games/manifest.js";
import type { RoomView } from "../../shared/protocol.js";
import type { Known, LearnLang, ProfileView } from "../../shared/profile.js";
import { waifuById } from "../../shared/waifu.js";
import { boardFor } from "../games/boards.js";
import type { Earned } from "../profileCache.js";
import { saveProfileCache } from "../profileCache.js";
import { Chests } from "../Chests.js";
import { Profile } from "../Profile.js";
import { Stats } from "../Stats.js";
import { Vocabulary } from "../Vocabulary.js";
import { Customiser } from "../Customiser.js";
import { ChestButton, PursePill } from "../ChestButton.js";
import { levelFraction, toNextLevel } from "../level.js";
import { WaifuGacha } from "../Waifu.js";
import type { ChestOpened } from "../chestApi.js";
import type { Rolled } from "../waifuApi.js";
import { loadCollection, saveCollection } from "../waifuCache.js";
import { loadWardrobe, saveWardrobe } from "../wardrobeCache.js";
import { loadAvatar, parseLoadout, saveAvatar, starter } from "../avatar/store.js";
import { Avatar } from "../avatar/Avatar.js";
import { equipDrop } from "../avatar/equip.js";
import type { Toasts } from "../toast.js";

/**
 * The characters one player has on show, beside their name.
 *
 * **This is the only place the showcase is seen by anybody but its owner**,
 * and it is the reason the showcase exists. Three slots in your own account
 * menu are wallpaper; three faces on the seat list are the feature advertising
 * itself, every game, to the person who has not rolled yet.
 *
 * Ids in, art out. `waifuById` misses for an id the roster no longer has --
 * `build-waifu.ts` can be rerun at a different depth while somebody's showcase
 * still names her -- and that is one face quietly left out rather than a seat
 * list that throws.
 *
 * Drawn on the lobby seat list and on the same list after a game, and nowhere
 * else. The in-game strip is two to a row on a phone and has already lost a
 * name to a badge once; the two lobbies are both roomier and are the screens
 * somebody is actually reading, which is the moment this has to do its work.
 */
function ShowcaseFaces({ ids }: { ids: string[] }) {
  const shown = ids.flatMap((id) => {
    const one = waifuById(id);
    return one && one.image ? [one] : [];
  });
  if (shown.length === 0) return null;
  return (
    <span className="seat-showcase">
      {/* Named for a screen reader, once, beside the seat. The pictures
          themselves are decorative: three `alt` texts would read the same
          three names again. */}
      <span className="sr-only">
        {`Showing ${shown.map((one) => one.name).join(", ")}`}
      </span>
      {shown.map((one) => (
        <img
          key={one.id}
          className="seat-face"
          src={one.image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      ))}
    </span>
  );
}

/**
 * The figure one player built, at the head of their seat.
 *
 * The other half of what the seat list is for. An avatar was a thing you made
 * and then only ever saw in your own account chip, which is the same problem
 * the showcase had before PROTOCOL_VERSION 10 put it on the wire: something
 * built to be seen that nobody else could see.
 *
 * The loadout arrives as JSON somebody else's browser wrote, so it goes
 * through `parseLoadout`, which drops anything naming art this build cannot
 * draw -- an older client meeting a newer one's set, most likely -- and that
 * falls back to the initial rather than to a figure with a missing head. See
 * the note on `PROTOCOL_VERSION` 11 for why the server relays a string it
 * cannot check.
 */
function SeatFigure({ avatar, name }: { avatar: string | null; name: string }) {
  return (
    <Avatar
      className="seat-figure"
      loadout={parseLoadout(avatar)}
      crop="bust"
      /* The initial, for somebody who has never opened the customiser. An
         empty circle where a letter used to be is a regression. */
      initial={(name.trim()[0] ?? "?").toUpperCase()}
    />
  );
}

/**
 * One seat: the figure, the name, and the three characters.
 *
 * The order is the answer to "make these more prominent", and it is an order
 * rather than a size: the two things a player made are the ends of the row and
 * the name is between them, so a seat reads as somebody's rather than as a row
 * of text with decorations. The figure is a `bust` crop at 44 -- the touch
 * floor this file's stylesheet is full of, reused as a measurement -- and the
 * faces are 34, which is nearly twice what they were when they had to fit two
 * seats to a phone row. They no longer do; see `.seats`.
 */
function Seat({
  player,
  index,
  minimum,
  seat,
}: {
  player: RoomView["players"][number] | null;
  index: number;
  minimum: number;
  seat: number | null;
}) {
  return (
    <li
      className={["player", "seat", `p${index}`, player ? "taken" : index < minimum ? "needed" : "open"].join(" ")}
    >
      {player ? (
        <SeatFigure avatar={player.avatar} name={player.name || `Player ${index + 1}`} />
      ) : (
        /* An empty seat keeps the chip it always had. There is no figure to
           draw and a placeholder person would read as somebody who is here. */
        <span className="chip" />
      )}
      <span className="who">
        {player ? player.name || `Player ${index + 1}` : index < minimum ? "Needed" : "Free seat"}
      </span>
      {player && <ShowcaseFaces ids={player.showcase} />}
      {player && player.seat === seat && <span className="note">you</span>}
      {player && !player.connected && <span className="note">away</span>}
    </li>
  );
}

/**
 * Everybody at the table, as figures rather than as names.
 *
 * Shared by the two lobbies, which is what makes it worth being a component:
 * the room after a game is the same people in the same seats, and it is the
 * one moment they are all looking at the screen at once with nothing to press
 * yet. Drawing a different, smaller seat list there was throwing away the
 * better half of the two screens this is for.
 */
export function SeatRoster({
  players,
  minimum,
  seat,
  label,
}: {
  players: (RoomView["players"][number] | null)[];
  minimum: number;
  seat: number | null;
  label: string;
}) {
  return (
    <ol className="seats" aria-label={label}>
      {players.map((p, i) => (
        <Seat key={i} player={p} index={i} minimum={minimum} seat={seat} />
      ))}
    </ol>
  );
}

/**
 * The seat list after the final move, above the rematch button.
 *
 * The in-game strip at the top of the screen goes away when a game ends (see
 * `App.tsx`) and this takes its place, because the constraint that made that
 * strip small is gone: nobody is mid-turn, nothing is about to move, and the
 * board no longer needs the height. It is the lobby list again, and it is here
 * for the same reason it is there -- this is the screen where somebody who has
 * not rolled yet finds out that the thing is collectable.
 */
export function TableAfter({ room, seat }: { room: RoomView; seat: number | null }) {
  return (
    <section className="waitroom after" aria-labelledby="after-head">
      <h2 className="waitroom-head" id="after-head">
        Who played
      </h2>
      <SeatRoster
        players={room.players}
        minimum={room.players.length}
        seat={seat}
        label="Who played"
      />
    </section>
  );
}

/**
 * The waiting room: who is here, how many seats there are, and how many of
 * them have to be filled before anything can happen.
 *
 * This used to be an empty board-shaped box with the room code underneath it
 * at display size. The box drew nothing -- a game that does not exist yet has
 * no state to draw -- so the one screen where the only question is "is anybody
 * else coming" spent most of a phone on a blank rectangle, and the code was
 * on screen twice, once in the header and once below the hole.
 *
 * The code is drawn once, here, at the top and at display size, and the seats
 * get the rest of the screen. Two columns on a phone, because a seat is a chip
 * and a short name and one per row wasted half the width.
 *
 * Which empty seats are drawn is the part that carries the minimum. Every seat
 * the minimum still needs is drawn, so a room that cannot start yet always
 * shows the gap it is waiting on; past that, one spare seat, and only while
 * the game has room for it. Drawing all eight of Word Duel's would say the
 * room is waiting for eight people, which is not what a room seating two to
 * eight is waiting for.
 */
export function Lobby({
  room,
  seat,
  copied,
  onCopyCode,
}: {
  room: RoomView;
  seat: number | null;
  /** Whether the invite was just copied. Shared with nothing now; see `App.tsx`. */
  copied: boolean;
  onCopyCode(code: string): void;
}) {
  const here = room.players.length;
  const shown = Math.min(room.capacity, Math.max(room.minimum, here + 1));
  const slots = Array.from({ length: shown }, (_, i) => room.players[i] ?? null);
  return (
    <section className="waitroom" aria-labelledby="waitroom-head">
      {/* The code, at display size, at the top of the room it opens.

          It was in the header, small, beside the wordmark, which is the right
          place for it in a game that has started and the wrong one for a room
          whose only job is to be joined: the header now carries the account,
          and the one thing everybody in a waiting room is trying to read
          should not be the smallest thing on the screen. Still one code in one
          place -- the header does not draw it any more. */}
      <button
        className="bigcode"
        title="Copy the invite link"
        /* The visible text is the code, which says what this *is* rather than
           what pressing it does, so both names carry it inside them and
           speaking the label still matches the screen. */
        aria-label={copied ? "Invite link copied" : `Copy the invite link, room ${room.code}`}
        onClick={() => onCopyCode(room.code)}
      >
        {copied ? "Copied" : room.code}
      </button>
      <h2 className="waitroom-head" id="waitroom-head">
        Players
        {/* The ceiling, not the number of seats drawn below, which is a
            different number on purpose. */}
        <span className="tally">
          {here}/{room.capacity}
        </span>
      </h2>
      <SeatRoster players={slots} minimum={room.minimum} seat={seat} label="Players" />
    </section>
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
 * The words-due line used to sit under the XP and it is deliberately gone: a
 * review debt read as a bill at the one moment somebody was deciding whether
 * to play again. What is owed is still counted; it is simply not something
 * this app tells anybody about. See the lobby and the account menu, where the
 * same line was taken out for the same reason.
 */
export function Takings({ earned }: { earned: Earned | null }) {
  if (!earned) return null;
  return (
    <section className="takings" aria-labelledby="takings-head">
      <h2 id="takings-head">
        {earned.learned > 0
          ? `${earned.learned} new ${earned.learned === 1 ? "word" : "words"}`
          : "Nothing new, but it counted"}
      </h2>
      {/* The purse, first and largest, and announced as "goth points" rather
          than as GP: the abbreviation is what fits on a pill in the header,
          not what a screen reader should be made to spell out. */}
      {earned.points > 0 && (
        <p className="takings-points">
          <span aria-hidden="true">+{earned.points.toLocaleString()} GP</span>
          <span className="sr-only">{`Plus ${earned.points.toLocaleString()} goth points`}</span>
        </p>
      )}
      {/* Named, not implied. The bonus is fifteen ordinary games in one lump
          and it is the reason to come back tomorrow, so it says both what it
          was and what it was for. See `Earned.daily`. */}
      {earned.daily > 0 && (
        <p className="takings-daily">{`${earned.daily.toLocaleString()} of that for showing up today`}</p>
      )}
      {earned.xp > 0 && <p className="takings-xp">+{earned.xp.toLocaleString()} XP</p>}
      {earned.streak && <p className="takings-streak">That is today done.</p>}
    </section>
  );
}

/**
 * Who won, at the top of the end screen: their figure, their name, and the
 * three characters they have on show.
 *
 * The end of a game was a hero-sized *sentence*. The sentence is still here --
 * it is the line that says how, and for a draw or a tie it is the whole panel
 * -- but the thing somebody actually wants to see at the end of a game is the
 * person who won, drawn the way they built themselves.
 *
 * Everything here is already on the wire and nothing is looked up: the figure
 * and the showcase ride on `PlayerView` (PROTOCOL_VERSION 10 and 11), and the
 * seat comes from `RoomView.winner` (12). The showcase is the reason this is
 * worth the pixels -- it is the second screen where somebody who has not
 * rolled yet finds out the app has characters in it at all, and it is the one
 * where the collection is attached to having *won*.
 *
 * Falls back to the sentence alone whenever there is nobody to draw: a draw, a
 * tie at the top, Drill, and an older server that sends no `winner` at all.
 * Never a portrait for nobody. See `GameDefinition.winner`.
 */
export function Result({ room, seat }: { room: RoomView; seat: number | null }) {
  const won = room.winner === null ? null : (room.players.find((p) => p.seat === room.winner) ?? null);
  if (!won) {
    return (
      <div className="result">
        <p className="who">{room.status}</p>
      </div>
    );
  }
  const name = won.name || `Player ${won.seat + 1}`;
  return (
    <div className="result result-won">
      <WinnerFigure avatar={won.avatar} name={name} />
      <p className="who">
        {name}
        {/* "You win" is the one thing the status sentence underneath cannot
            say, because the server writes it once for everybody in the room. */}
        {won.seat === seat && <span className="result-you">you</span>}
      </p>
      <p className="why">{room.status}</p>
      <WinnerFaces ids={won.showcase} />
    </div>
  );
}

/** The winner's figure, at hero size. `SeatFigure` one size up and full-length,
 *  because this is the one screen with the room for the whole of it. */
function WinnerFigure({ avatar, name }: { avatar: string | null; name: string }) {
  return (
    <Avatar
      className="result-figure"
      loadout={parseLoadout(avatar)}
      crop="bust"
      initial={(name.trim()[0] ?? "?").toUpperCase()}
    />
  );
}

/** The winner's three, larger than a seat's and no longer overlapped: there is
 *  a whole panel of width here, and a fan is what the seat row does to fit. */
function WinnerFaces({ ids }: { ids: string[] }) {
  const shown = ids.flatMap((id) => {
    const one = waifuById(id);
    return one && one.image ? [one] : [];
  });
  if (shown.length === 0) return null;
  return (
    <div className="result-showcase">
      <span className="sr-only">{`Showing ${shown.map((one) => one.name).join(", ")}`}</span>
      {shown.map((one) => (
        <img
          key={one.id}
          className="result-face"
          src={one.image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}

export function NextGame({ room, onPick }: { room: RoomView; onPick(gameId: string): void }) {
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
export function GameBoard({
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

  /*
    Every board is a `lazy` chunk, so the first render of a dealt room suspends
    while it arrives. The fallback is the same `.placeholder` box the two lines
    above return, which is the point: an undealt room, an unknown game and a
    board still on the wire are the same shape and the same reserved height, so
    the arrival of the chunk does not move the status line above it. Reserving
    it is not decoration -- CLS is a scored metric and this is the one element
    on the page whose existence is now a network round trip.

    The boundary is here rather than around the whole room on purpose. Above it
    are the seat strip, the status line and the account bar, all of which have
    their state already and none of which should blank because a board is
    loading.
  */
  return (
    <Suspense fallback={<div className="board placeholder" />}>
      <Board
        state={room.state as never}
        seat={seat}
        names={room.players.map((p) => p.name)}
        connected={room.players.map((p) => p.connected)}
        canAct={room.canAct}
        now={room.now}
        onMove={sendMove}
      />
    </Suspense>
  );
}

/** The screens the room's account menu can open over the table. */
export type RoomScreen = "chests" | "vocab" | "stats" | "avatar" | "waifu";

/**
 * Who you are, in the room's header: the chest, the purse, and the chip that
 * opens the account.
 *
 * The room used to show the code here and nothing about the player at all, so
 * the one header somebody sits in front of for a whole game was the one header
 * with no face, no balance and no way into their own account. The code has
 * gone down into the lobby, where it is the thing being read, and this took
 * its place.
 *
 * Deliberately the same three objects in the same wrapper as the lobby's bar,
 * `.account` and all: a control that looked different in a room would be a
 * control people stopped recognising, and the caps that hold that card
 * together at 320px are already measured and pinned in `css.test.ts`.
 *
 * The connection dot rides on the avatar rather than sitting beside it. It is
 * a fact about *you* -- whether this browser is still talking to the room --
 * and on a bar this narrow a loose dot beside three pills reads as punctuation
 * between them.
 *
 * The mute lives inside the panel this opens, beside the palette swap, which
 * is where the lobby has always kept it. It was a speaker icon in this bar
 * until the bar had something better to carry.
 */
export function RoomAccount({
  profile,
  name,
  onName,
  onChanged,
  status,
  connectionNote,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
  onOpen,
}: {
  profile: ProfileView | null;
  name: string;
  onName(name: string): void;
  /** An account came or went, so anything drawn from it is stale. */
  onChanged(): void;
  /** The socket's state, which is what the dot is coloured by. */
  status: string;
  /** What is wrong with the connection, or null when nothing is. */
  connectionNote: string | null;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
  onOpen(screen: RoomScreen): void;
}) {
  const [menu, setMenu] = useState(false);
  const [avatar] = useState(loadAvatar);
  const chipRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const trimmed = name.trim();

  /*
    Escape and a press somewhere else, exactly as the lobby does it: bound to
    the document because "somewhere else" is by definition not inside the card,
    and `pointerdown` so a press on the board closes this before the board acts
    on it. The chip is inside `accountRef`, which leaves its own toggle to do
    the closing -- without that the press closes the menu here and the chip's
    `onClick` opens it straight back up.
  */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      chipRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Closing first and opening second: the panel is anchored to a bar that is
  // about to be replaced by a layer, and a popover outliving its anchor is how
  // the chip's `aria-expanded` went wrong the last time this was a disclosure.
  const goTo = (to: RoomScreen) => {
    setMenu(false);
    onOpen(to);
  };

  return (
    <div className="account" ref={accountRef}>
      {/* Chest first, purse second, which is the other way round from the
          lobby: in a room the chest is the thing that just became affordable
          and the balance is the caption of it. */}
      <ChestButton profile={profile} onPress={() => goTo("chests")} />
      <PursePill profile={profile} />
      <button
        ref={chipRef}
        type="button"
        className="whoami"
        aria-expanded={menu}
        aria-haspopup="menu"
        onClick={() => setMenu((was) => !was)}
      >
        {/* Glanceable rather than read, but a colour alone is not available to
            everyone and a bare title is available to almost nobody.
            `role="img"` names it on demand without announcing itself: the
            banner and the status line already say when the connection drops,
            and a third voice would be the same news three times. */}
        <span
          className={`dot ${status}`}
          role="img"
          aria-label={connectionNote ?? "Connected"}
          title={connectionNote ?? "Connected"}
        />
        <Avatar
          loadout={avatar}
          crop="bust"
          initial={(trimmed || "?").slice(0, 1).toUpperCase()}
          className="av"
        />
        <span className="whocol">
          <span className="who">{trimmed || "Account"}</span>
          {profile && (
            <>
              <span className="rank-lv" aria-hidden="true">
                Level {profile.rank.level}
              </span>
              <span
                className="rank-bar"
                aria-hidden="true"
                style={{ ["--fill" as string]: `${levelFraction(profile)}%` }}
              />
            </>
          )}
        </span>
        <span className="sr-only">
          . Your account. {connectionNote ?? "Connected"}
          {profile
            ? `. Level ${profile.rank.level}, ${toNextLevel(profile).toLocaleString()} experience to level ${
                profile.rank.level + 1
              }. ${profile.spendable.toLocaleString()} goth points to spend on chests`
            : ""}
        </span>
      </button>

      {menu && (
        <div className="acct-pop">
          <Profile
            profile={profile}
            onOpenVocab={() => goTo("vocab")}
            onOpenStats={() => goTo("stats")}
            onOpenAvatar={() => goTo("avatar")}
            onOpenWaifu={() => goTo("waifu")}
            avatar={avatar}
            name={name}
            onName={onName}
            onChanged={onChanged}
            swapLabel={swapLabel}
            onSwapPalette={onSwapPalette}
            sound={sound}
            onToggleSound={onToggleSound}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The account screens, as the room reaches them.
 *
 * Same bargain as `RoomChests` below and for the same reason: these are routes
 * in the lobby, and taking a route out of a live room is leaving the table. So
 * each one is a layer over the room instead, the socket underneath stays
 * connected, and Back puts the board straight back.
 *
 * The words screen gets the socket's last answer, because unlike the lobby
 * this side has a socket; everything else reads the same caches the lobby
 * reads. See `vocabCache.ts` and `profileCache.ts`.
 */
export function RoomAccountScreen({
  screen,
  profile,
  vocab,
  onRequestVocab,
  onBack,
  onOpenChests,
}: {
  screen: Exclude<RoomScreen, "chests">;
  profile: ProfileView | null;
  vocab: { lang: LearnLang; words: Known[] } | null;
  onRequestVocab(lang: LearnLang): void;
  onBack(): void;
  /** The customiser's way to the shop, which is the layer next door. */
  onOpenChests(): void;
}) {
  const [owned] = useState<string[] | null>(loadWardrobe);
  const [claimed, setClaimed] = useState<string[] | null>(loadCollection);
  const [avatar, setAvatar] = useState(loadAvatar);

  // The summary is optional: a read that did not carry one leaves the balance
  // where it was rather than blanking it. See `WaifuGacha`'s `onCollection`.
  const keep = (list: string[], next: ProfileView | null) => {
    setClaimed(list);
    saveCollection(list);
    if (next) saveProfileCache(next);
  };

  return (
    <div className="acct-sheet">
      {screen === "vocab" && (
        <Vocabulary profile={profile} live={vocab} onRequest={onRequestVocab} onBack={onBack} />
      )}
      {screen === "stats" && <Stats profile={profile} onBack={onBack} />}
      {screen === "avatar" && (
        <Customiser
          profile={profile}
          owned={owned}
          loadout={avatar ?? starter()}
          onChange={(next) => {
            setAvatar(next);
            saveAvatar(next);
          }}
          onBack={onBack}
          onOpenChests={onOpenChests}
        />
      )}
      {screen === "waifu" && (
        <WaifuGacha
          profile={profile}
          claimed={claimed}
          onRolled={(result: Rolled) => keep(result.claimed, result.profile)}
          onCollection={(list, next) => keep(list, next)}
          onShowcase={(next) => saveProfileCache(next)}
          onBack={onBack}
        />
      )}
    </div>
  );
}

/**
 * The chest screen as the room reaches it, with its own copy of the two
 * caches it needs.
 *
 * The lobby's copies live in `Setup`, which is unmounted while a game is up,
 * so they cannot be handed down. They cannot drift either: both sides read the
 * same `localStorage`, both write it on every chest, and `Setup` is remounted
 * from scratch on the way back to the lobby. The duplication is two `useState`
 * initialisers, and the alternative was hoisting a wardrobe, a loadout and a
 * profile into the shell to be threaded through a screen that does not use
 * them.
 *
 * Equipping is the one thing this cannot finish: the customiser is an account
 * screen, and sending somebody out of a live game to put a hat on is worse
 * than making them do it afterwards. So the drop is worn where it lands and
 * the loadout is saved, with no navigation.
 *
 * The gacha is the same shape again. Its card is in the grid here as it is
 * everywhere else -- the two spend one balance and a shop that shows half of
 * what it sells is the thing this change was about -- but pressing it swaps
 * this layer rather than navigating, for the reason the layer exists at all:
 * `/waifu` is a route, and taking a route out of a live room is leaving the
 * table.
 */
export function RoomChests({
  profile,
  onToast,
  onBack,
}: {
  profile: ProfileView | null;
  /** Raise a transient message. See `App`: one stack, above every screen. */
  onToast: Toasts["push"];
  onBack(): void;
}) {
  const [owned, setOwned] = useState<string[] | null>(loadWardrobe);
  const [claimed, setClaimed] = useState<string[] | null>(loadCollection);
  const [rolling, setRolling] = useState(false);
  const [avatar, setAvatar] = useState(loadAvatar);
  /* The profile the server last sent, overwritten by what a chest hands back:
     a chest spends the balance this screen is drawn from, so without this the
     header would still be offering the chest that was just opened. */
  const [view, setView] = useState<ProfileView | null>(profile);
  useEffect(() => {
    if (profile) setView(profile);
  }, [profile]);

  // The summary is optional: a read that did not carry one leaves the balance
  // where it was rather than blanking it. See `WaifuGacha`'s `onCollection`.
  const keep = (list: string[], next: ProfileView | null) => {
    setClaimed(list);
    saveCollection(list);
    if (!next) return;
    setView(next);
    saveProfileCache(next);
  };

  if (rolling) {
    return (
      <div className="acct-sheet">
        <WaifuGacha
          profile={view}
          claimed={claimed}
          onRolled={(result: Rolled) => keep(result.claimed, result.profile)}
          onCollection={(list, next) => keep(list, next)}
          onShowcase={(next) => {
            setView(next);
            saveProfileCache(next);
          }}
          onBack={() => setRolling(false)}
        />
      </div>
    );
  }

  return (
    <div className="acct-sheet">
      <Chests
        profile={view}
        owned={owned}
        claimed={claimed}
        focus={null}
        onOpened={(result: ChestOpened) => {
          setOwned(result.owned);
          saveWardrobe(result.owned);
          setView(result.profile);
          saveProfileCache(result.profile);
        }}
        onEquip={(set: string, drop: string) => {
          const worn = equipDrop(avatar ?? starter(), set, drop);
          if (worn) {
            setAvatar(worn);
            saveAvatar(worn);
          }
          /* The one press in this app with nothing at all to show for it.
             The account's copy of this screen at least navigated to the
             customiser afterwards; here there is nowhere to go -- see the
             header comment -- so the drop went on, the loadout was saved,
             and the screen sat exactly as it was. */
          onToast(
            worn ? "You are wearing it now." : "That one cannot be worn any more.",
            null,
            worn ? "success" : "warn",
          );
        }}
        onOpenWaifu={() => setRolling(true)}
        /* A pull in the shop's dialog carries the same two things a pull on
           the shelf does, so it is kept the same way. */
        onRolled={(result: Rolled) => keep(result.claimed, result.profile)}
        onBack={onBack}
      />
    </div>
  );
}
