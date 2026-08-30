/**
 * The screen before a room: the shelf, the join box, the account bar, and each
 * of the account's own pages.
 *
 * This is the whole of the app that works with no socket open, which is what
 * makes it a file of its own rather than part of the shell.
 */
import { useEffect, useRef, useState } from "react";
import { gameEntry, gameList, shelvedGames } from "../../shared/games/manifest.js";
import { CODE_LENGTH } from "../../shared/roomCode.js";
import { BrandMark } from "../art.js";
import { hasAccount } from "../account.js";
import { play } from "../sfx.js";
import type { Screen } from "../route.js";
import { Profile } from "../Profile.js";
import { ChestButton, PursePill } from "../ChestButton.js";
import { Avatar } from "../avatar/Avatar.js";
import { loadProfileCache } from "../profileCache.js";
import { loadAvatar, saveAvatar } from "../avatar/store.js";
import { levelFraction, toNextLevel } from "../level.js";
import { HeroCard, TableCard } from "./TableShelf.js";
import { JoinBox } from "./JoinBox.js";
import { AccountScreens } from "./AccountScreens.js";
import type { Toasts } from "../toast.js";


/** Which panel under the bar is open, if any. */
/*
  The lobby's one popover, and the account's screens, which are two different
  things and used to be one enum.

  They were `Panel`, and the shared type was the bug: "is the account open"
  had to be written as "the panel is open and it is not the name form", and
  when somebody forgot, the chip told a screen reader it was collapsed while
  Stats sat over the lobby. Every screen is a page with an address of its own
  now, so what is open is answered by the URL and `Screen` lives in
  `route.ts`, beside the paths it names.
*/
type Panel = null | "name";

export function Setup({
  initialName,
  pendingCode,
  onToast,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
  lastGameId,
  screen,
  onOpenScreen,
  onBack,
  onLeave,
  onName,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  /** Raise a transient message. The stack lives above every screen in
      `App`, so this is `useToasts().push` handed down. */
  onToast: Toasts["push"];
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
  lastGameId: string;
  /** Which screen the address bar is on, or null for the lobby. The page
      below draws itself instead of the lobby when it is set: these are
      routes, not layers. */
  screen: Screen | null;
  onOpenScreen(to: Screen): void;
  /** Up one screen, or out to the lobby when there is nothing above. */
  onBack(): void;
  /** Out of the screens entirely, however deep in they are. */
  onLeave(): void;
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
    Whether the account menu is dropped under the chip.

    Not a `Panel`, even though it is the second thing in this bar that opens
    under a button: the name popover is a form that answers one question and
    closes, and this is a menu whose rows navigate. Sharing one enum would have
    meant every reader of `panel` asking which of the two it was holding.
  */
  const [menu, setMenu] = useState(false);
  /*
    What this browser has on, read once. Null until somebody opens the
    customiser, and null is meaningful: it is what keeps the initial in the
    chip for a player who has never chosen a character. Prototype storage that
    belongs on the profile later; see `avatar/store.ts`.
  */
  const [avatar, setAvatar] = useState(loadAvatar);
  /*
    The last summary this browser was sent, which is all the lobby can have:
    a profile arrives down a socket and the shelf has none. Held in state
    rather than read on every render so that signing in, signing out or
    pasting a key repaints the badge without a reload.
  */
  const [profile, setProfile] = useState(loadProfileCache);
  /*
    Whether there is a key, held as state rather than read at render.

    The account and the profile are not the same fact and the difference is
    visible for as long as it takes to play one game: the key exists the moment
    you press the button, the profile is written by the first word you find. So
    the panel's `onChanged` refreshing the cache alone left `null` where there
    was already `null`, React re-rendered nothing, and the bar went on offering
    to create the account somebody had just created.
  */
  const [signed, setSigned] = useState(hasAccount);
  const refreshAccount = () => {
    setProfile(loadProfileCache());
    setSigned(hasAccount());
  };
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

  /*
    The chip, which is a disclosure again.

    It was a plain link to `/account` for a while, and that was one step too
    far: the account page is right for the *screens* behind it -- the words,
    the stats, a customiser with forty five items in one grid -- but the menu
    that lists them is six rows and a name, and sending somebody to a whole
    page to read six rows is what no other site with an account chip does.
    So the menu drops from the chip the way YouTube's, Reddit's and Facebook's
    do, and only the screens are pages.

    `aria-expanded` is honest now in a way it was not the last time this was a
    disclosure: what it describes is drawn directly under the chip and lives
    exactly as long as `menu` does. The bug that made us give up on it -- the
    chip reading "collapsed" with Stats full-screen over the lobby -- cannot
    come back, because pressing a row closes the menu on its way to the page.
  */
  const pressAccount = () => {
    setPending(null);
    setPanel(null);
    setMenu((was) => !was);
  };

  /*
    Leaving the menu for one of the screens behind it.

    Closing first and navigating second, in that order: the menu is anchored to
    a bar that is about to unmount, and a popover outliving its anchor is how
    the `aria-expanded` above went wrong before.
  */
  const goTo = (to: Screen) => {
    setMenu(false);
    onOpenScreen(to);
  };

  /*
    Back, from a screen.

    One step up the history, which is the same thing as "where I pressed the
    row", and it is honest from anywhere: the chests opened from the customiser
    go back to the customiser, the chests opened from the bar go back to the
    lobby, and neither needs this component to remember which happened. That
    memory used to be `chestFocus` doing a second job.
  */
  const leaveAccount = onBack;

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

  // Escape closes the name popover, which is what Escape does to anything
  // that opened over the page.
  const onEscape = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setPanel(null);
    setPending(null);
  };

  const pendingName = pending ? gameEntry(pending)?.name : undefined;

  const chipRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  /*
    The two ways out of a dropdown that are not a row: Escape, and pressing
    somewhere else.

    Bound to the document rather than to the card, because "somewhere else" is
    by definition not inside it, and `pointerdown` rather than `click` so a
    press that lands on the shelf closes this before the card underneath acts
    on it. The chip itself is inside `accountRef`, which is what leaves its own
    toggle to do the closing -- without that, the press closes the menu here
    and the chip's `onClick` immediately opens it again.

    Focus goes back to the chip on Escape only. A pointer press has already
    put focus wherever it landed, and stealing it back is how a dropdown eats
    somebody's tap.
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

  /*
    Focus goes back to the chip on the way back from the account.

    The lobby is unmounted while the account page is up, so returning to it
    leaves focus on `<body>` and the next Tab starts at the top of the
    document -- which for somebody who tabbed to the chip in the first place
    is the whole lobby again. It is the other half of the pattern the screens
    in there already do on the way in, where each one focuses its own heading.

    A ref rather than a state flag, so this fires on the *edge* and never
    steals focus from a lobby that is merely re-rendering.
  */
  const wasOnAccount = useRef(screen !== null);
  useEffect(() => {
    if (wasOnAccount.current && screen === null) chipRef.current?.focus();
    wasOnAccount.current = screen !== null;
  }, [screen]);


  /*
    The account, as its own page at `/account`.

    It returns *instead of* the lobby rather than over it. As an overlay it
    needed a dialog role, a focus trap, a press-away handler and an Escape
    key, and every one of those was scaffolding holding up a page that was
    pretending to be a menu -- while the one control a phone player actually
    reaches for, Back, walked out of the app. A route needs none of it: the
    lobby is not underneath, so there is nothing to trap focus away from.

    Each screen has its own path, and they are siblings of `/account` rather
    than children of it, because `wrangler.toml` hands `/account/*` to the
    worker for the chest API and a sub-path would 404 before the app ever saw
    it. See `route.ts`.
  */
  if (screen) {
    return (
      <AccountScreens
        screen={screen}
        profile={profile}
        onProfile={setProfile}
        avatar={avatar}
        onAvatar={(chosen) => {
          setAvatar(chosen);
          saveAvatar(chosen);
        }}
        name={name}
        onName={(chosen) => {
          setName(chosen);
          onName(chosen);
        }}
        onOpenScreen={onOpenScreen}
        onToast={onToast}
        onBack={leaveAccount}
        onLeave={onLeave}
        onChanged={refreshAccount}
        swapLabel={swapLabel}
        onSwapPalette={onSwapPalette}
        sound={sound}
        onToggleSound={onToggleSound}
      />
    );
  }

  return (
    <main className="app setup">
      {/* The whole of the old left-hand column, folded onto one line: who you
          are, and the one control somebody arriving with a code came for. */}
      <header className="lobby-bar">
        <h1 className="wordmark">
          <BrandMark />
        </h1>
        {/* One control at the far end of the bar, and it is the account.

            It was two, stacked: a chip that opened a one-field name form, and
            a link under it that opened the words. Two controls for one idea,
            and the split was ours rather than anybody's expectation -- the
            thing that shows your name is the thing you press to get at your
            account, everywhere else on the web. So the name form moved inside
            the panel and this is what is left. One line again, which is what
            the card was stacked to avoid: with the link gone the bar is back
            to a chip beside the lockup at 320px. */}
        <div className="account" ref={accountRef}>
          {/* The balance, then the chest: a readout and the control that
              spends it, in reading order and as two objects.

              They were briefly one pill with a progress bar inside it, which
              drew the currency as a thing that was loading and made a press on
              the number and a press on the chest into the same press wearing
              two faces. Neither appears before a profile has arrived: a wallet
              saying zero to somebody who has never played is the app opening
              with a bill. See `ChestButton.tsx`. */}
          <PursePill profile={profile} />
          <ChestButton profile={profile} onPress={() => goTo("chests")} />
          {/* A disclosure again: the menu drops directly under this, so both
              `aria-expanded` and `aria-haspopup` describe something that is
              really there. See `pressAccount` for why the page lost the menu
              but kept the screens. */}
          <button
            ref={chipRef}
            type="button"
            className="whoami"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={pressAccount}
          >
            {/* The bust crop, or the initial for somebody who has never
                opened the customiser. Both are `aria-hidden`: the name is
                already the label of this button.

                Full height of the chip now rather than a 26px dot beside the
                type, because the stack to its right is three rows tall and an
                avatar sized to one of them reads as a bullet point. */}
            <Avatar
              loadout={avatar}
              crop="bust"
              initial={(trimmed || "?").slice(0, 1).toUpperCase()}
              className="av"
            />
            {/* Name, level, bar: one column, in that order, each line about
                the one above it. The level is the caption of the name and the
                bar is the gauge of the level, so nothing here needs a rule
                between it and its neighbour to say what it belongs to.

                The bar is drawn rather than written for the same reason it
                always was -- the chip is capped and a second number is what
                pushes a name into an ellipsis. The words are on the button's
                accessible label, once, below. */}
            <span className="whocol">
              {/* The name is the label when there is one. Before that the
                  chip has to say what it is for, and "Account" is the honest
                  version: the panel behind it asks for the name on its first
                  row. */}
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
              {signed ? ". Your account" : ". No account on this device"}
              {profile
                ? `. Level ${profile.rank.level}, ${toNextLevel(profile).toLocaleString()} experience to level ${
                    profile.rank.level + 1
                  }. ${profile.spendable.toLocaleString()} goth points to spend on chests`
                : ""}
            </span>
          </button>

          {/* The menu, hung off the chip that opened it.

              Out of flow and as tall as it needs to be, which is the shape
              every account menu on the web has and the shape this one lost
              when it became a page: `.acct-pop` is `absolute` under a bar that
              is not sticky, so there is no scroll listener to keep it in step
              and nothing underneath it has to move to make room.

              Rendered only while open rather than hidden, so the rows inside
              are out of the tab order when they are out of sight -- the two
              are the same fact and a `hidden` popover is how they stop being
              one. */}
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
                onName={(chosen) => {
                  setName(chosen);
                  onName(chosen);
                }}
                onChanged={refreshAccount}
                swapLabel={swapLabel}
                onSwapPalette={onSwapPalette}
                sound={sound}
                onToggleSound={onToggleSound}
              />
            </div>
          )}
        </div>

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

      {/* Two columns on a wide lobby: the code and the copy on the left, the
          shelf on the right. As one column the join box, the tagline and the
          reminder were three full-width bands stacked above the games, and on
          a laptop that is most of the first screen spent on the thing almost
          nobody came for. On a phone `.lobby-cols` is still one column and the
          order is unchanged. */}
      <div className="lobby-cols">
        <div className="lobby-aside">
          {/* The one thing on this screen with a deadline: somebody is holding
              four letters somebody else read out. It is never behind a press. */}
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

          {/* Six words for the whole product, in the order it happens.

              It used to list three things this is not -- no ads, no account,
              no catch -- which is a defence, and nobody had accused it of
              anything yet. The accounts line in particular was arguing with a
              feature the page now offers two controls for. */}
          <p className="tagline">Pick a game, send the link, play.</p>

          {/* The due prompt is gone, and nothing replaces it.

              It was the loudest thing in this column and it was a debt: a
              count of what you owe, in a box, on the page you land on. What is
              due is still tracked and the review still happens inside
              Vocabulary; it just is not something this app greets anybody
              with. The same line came out of the account menu and the
              end-of-game takings on the same pass, so there is one answer
              rather than three. */}

          {/* The reminder, and it deliberately does not repeat the button that
              opens it. "Create an account" up in the bar says what pressing it
              does; this says what the account is for, and the words are only
              half of that -- the streaks and the tallies are the half the old
              copy never mentioned. Absent once there is an account, because
              then it is describing something you already have. */}
          {!signed && (
            <p className="acct-why">
              An account remembers the words you have found and the ones you
              owe a review on, and keeps your stats and streaks across every
              game. No email, nothing to fill in.
            </p>
          )}

        </div>

      {/* One element around the shelf, which `base.css` reads: the two recovery
          screens wear `.app.setup` too, and the desktop layout is for the lobby
          rather than for a wordmark and a button. */}
      <div className="shelves">
        {/* The other half of the fork, and it had never been named.

            "Join someone" names the other half, and this one is set to match
            it exactly, with the rule between them. Two headings of equal
            weight is what makes the lobby read as a choice rather than as a
            form with a shop underneath it: people arriving with a code were
            reading the code line as a caption and starting a room instead.
            Both sit a step above the shelf labels below, which name kinds of
            game rather than the thing you are doing. */}
        <h2 className="start-head">Start a new game</h2>
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
