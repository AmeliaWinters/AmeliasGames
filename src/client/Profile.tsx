/**
 * The account menu: who you are, where the rest of it is, and the key that
 * owns the lot.
 *
 * It is a menu and only a menu. What used to be laid out in here -- the
 * figures, the levels, the games -- is `Stats.tsx`, and the words are
 * `Vocabulary.tsx`; two rows lead there and neither of them opens anything in
 * place. What is left in here is what fits a drawer: one field, one paragraph,
 * one code.
 *
 * The one thing it draws itself is the identity block. A count of words due
 * used to sit under it and was taken out on purpose: it is a debt, and a menu
 * that opens with what you owe is a menu people stop opening. The review is
 * still there, inside Vocabulary, for anybody who goes looking.
 *
 * Everything here is drawn from the cached `ProfileView` — see
 * `profileCache.ts` for why the lobby cannot have a live one, and why a stale
 * count is the right trade.
 */
import { useEffect, useRef, useState } from "react";
import type { ProfileView } from "../shared/profile.js";
import {
  createAccount,
  exportAccount,
  exportCompact,
  forgetAccount,
  hasAccount,
  importAccount,
} from "./account.js";
import { QrCode } from "./qr.js";
import { canScan, scanQr, type Scan } from "./scan.js";
import { clearProfileCache } from "./profileCache.js";
import { SHOWCASE_MAX, roster, waifuById, type Waifu } from "../shared/waifu.js";
import { Avatar } from "./avatar/Avatar.js";
import type { Loadout } from "./avatar/types.js";

/**
 * Hand the key over as a file.
 *
 * The key is short enough to write down now, which is the better backup, and
 * the file stays anyway: a clipboard write can fail silently in a WebView, and
 * an object in Downloads can be mailed to yourself, dropped in a password
 * manager or put on a stick, and cannot be half-selected.
 *
 * Text or JSON depending on which the key is, because accounts minted before
 * seeds existed still export the old pair, and a `.txt` full of braces is a
 * file somebody will fail to feed back in. `exportAccount` decides; this only
 * has to name what it was handed.
 *
 * The object URL is revoked on the next frame rather than immediately, since
 * the click has to have been dispatched first, and never held, because it
 * keeps the key alive in the document for as long as it exists.
 */
function downloadKey(key: string): void {
  const json = key.trimStart().startsWith("{");
  const url = URL.createObjectURL(
    new Blob([key], { type: json ? "application/json" : "text/plain" }),
  );
  const link = document.createElement("a");
  link.href = url;
  // Dated, because somebody who has done this twice needs to know which file
  // is the account they are still using.
  const day = new Date().toISOString().slice(0, 10);
  link.download = `rebellia-key-${day}.${json ? "json" : "txt"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The camera half of the handover, when there is a camera to have.
 *
 * Renders nothing at all where `BarcodeDetector` or `getUserMedia` is missing
 * -- an older desktop browser, iOS Safari, or the plain-http LAN address this
 * app gets tested on, which is not a secure context and so has no camera.
 * That is why the paste box below it never went away: this is a shortcut past
 * the typing, not a replacement for it.
 *
 * The stream is stopped on unmount as well as on a hit, because the one thing
 * worse than a scanner that will not start is a camera light that stays on
 * after the panel has closed.
 */
function Scanner({ onText }: { onText(text: string): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!live || !video.current) return;
    let scan: Scan | null = null;
    let dropped = false;
    scanQr(video.current, onText)
      .then((started) => {
        // Unmounted while the permission prompt was up: the stream arrived for
        // nobody and has to be handed back.
        if (dropped) started.stop();
        else scan = started;
      })
      .catch(() => {
        setRefused(true);
        setLive(false);
      });
    return () => {
      dropped = true;
      scan?.stop();
    };
    // Deliberately only `live`: `onText` is rebuilt every render, and depending
    // on it would tear the camera down and ask for it back on every keystroke
    // in the box below.
  }, [live]);

  if (!canScan()) return null;

  return (
    <div className="prof-scan">
      {!live && (
        <button type="button" onClick={() => setLive(true)}>
          Scan the code from your other device
        </button>
      )}
      {/* Kept mounted rather than conditional: `scanQr` is handed this element
          the moment the effect runs, and an element React has not drawn yet is
          not one a camera can be attached to. */}
      <video ref={video} className={live ? "prof-scan-live" : "sr-only"} />
      {refused && (
        <p className="prof-bad" role="alert">
          No camera here. Paste the key instead.
        </p>
      )}
    </div>
  );
}

/**
 * One row of the account menu.
 *
 * The value lives on the label rather than off to the right -- "Appearance:
 * Daylight", not "Appearance" with a note beside it -- because that is the one
 * shape that reads the same at 320px as at 1280 without a second column to
 * keep. A row either does its thing on the press or opens underneath itself,
 * and `aria-expanded` is present only on the second kind, so a screen reader
 * is not told that "Download key" is a collapsed anything.
 */
function Row({
  label,
  value,
  faces,
  open,
  goes,
  sub,
  danger,
  onPress,
}: {
  label: string;
  value?: string;
  /**
   * A strip of portraits drawn before the chevron. Decorative on purpose: the
   * value beside them already names the state in words, and a screen reader
   * reading three names inside "The Polycule, 2 of 3 on show" would be worse
   * than silence. See `rowFaces`.
   */
  faces?: RowFace[];
  open?: boolean;
  /** Leads to a screen of its own. Draws the chevron; never `aria-expanded`. */
  goes?: boolean;
  /** Nested under a row that opened it, and indented to say so. */
  sub?: boolean;
  danger?: boolean;
  onPress(): void;
}) {
  const kind = [
    "prof-row",
    sub ? "prof-row-sub" : "",
    danger ? "prof-row-danger" : "",
    goes ? "prof-row-goes" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={kind}
      aria-expanded={open === undefined ? undefined : open}
      onClick={onPress}
    >
      <span className="prof-row-label">{label}</span>
      {value && <span className="prof-row-value">{value}</span>}
      {faces && faces.length > 0 && (
        <span className="prof-row-faces" aria-hidden="true">
          {faces.map((face, at) =>
            face.one ? (
              <img
                key={face.one.id}
                className={`prof-row-face${face.teaser ? " prof-row-face-teaser" : ""}`}
                src={face.one.image}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span key={`empty-${at}`} className="prof-row-face prof-row-face-empty" />
            ),
          )}
        </span>
      )}
      {/* Two marks, and they are different promises: a chevron leaves, a caret
          opens underneath. Hidden from a screen reader, which is told the same
          thing properly by `aria-expanded` or by the absence of it. */}
      {goes && (
        <span className="prof-row-mark prof-row-chev" aria-hidden="true">
          ›
        </span>
      )}
      {open !== undefined && (
        <span className="prof-row-mark prof-row-caret" aria-hidden="true">
          ⌄
        </span>
      )}
    </button>
  );
}

/**
 * A row that is a switch rather than a door.
 *
 * Sound was a row that reported "On" or "Off" in the value slot and flipped it
 * on the press, which is a button drawn as a label: nothing on it said it was
 * the kind of thing that flips, and a screen reader was told only that a
 * button had been pressed. As a `switch` the state is the control, and it is
 * announced with the row rather than as a word beside it.
 *
 * Only Sound. Appearance is next to it and stays an ordinary row, because a
 * switch has to have an off and the palette does not: it is two named things,
 * and "Appearance, switch, on" is a sentence that means nothing to anybody who
 * cannot see which way round it is. The row names the palette you are in and
 * changes that name on the press, which is the same state said honestly.
 */
function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="prof-row prof-row-switch"
      onClick={onPress}
    >
      <span className="prof-row-label">{label}</span>
      <span className="prof-switch" aria-hidden="true">
        <span className="prof-switch-dot" />
      </span>
    </button>
  );
}

/**
 * Your name, changed where the rest of your account is.
 *
 * The bar used to carry two controls at its far end, one for the name and one
 * for the account, which is two answers to a question people only ask once:
 * they press the thing that says their name. So the field moved in here, under
 * a row of the menu, and the bar is down to one button. The one-question
 * popover the lobby still shows when you press a game card without a name is a
 * different thing and stays where it is.
 *
 * Seeded once and kept locally, because a field that reads its value back from
 * the app as you type is a field that fights the cursor. `saved` is only there
 * to say the press did something: nothing else in this menu moves when a name
 * changes, and a button that visibly does nothing gets pressed again.
 */
function NameField({ name, onName }: { name: string; onName(name: string): void }) {
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(false);
  const trimmed = draft.trim();

  return (
    <form
      className="prof-name"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        onName(trimmed);
        setSaved(true);
      }}
    >
      <label>
        <span className="sr-only">Your name</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="Amelia"
          maxLength={20}
        />
      </label>
      <button className="primary" disabled={!trimmed || trimmed === name}>
        Save
      </button>
      {/* Polite rather than assertive: it arrives while the cursor is still in
          the field, and the field is not what it is talking about. */}
      <span className="prof-saved" role="status">
        {saved && trimmed === name ? "Saved" : ""}
      </span>
    </form>
  );
}


/**
 * Everything the account panel used to be, laid out the way an account menu is.
 *
 * This was two controls in the bar and a page under each: a name chip that
 * opened a one-field form, and a link beside it that opened the words. They
 * are one button now, and this is what it opens -- an identity block, then
 * rows in groups, which is the shape anybody has already learned from every
 * other account menu they have ever opened. Nothing was dropped in the merge;
 * the parts that were pages are what the rows open.
 *
 * **A drawer is for a glance, not for a section.** Stats used to open in here
 * and it was four blocks tall with a list on the end of it, which put the
 * bottom half of the menu below the fold on a phone for as long as it was
 * open. It is `Stats.tsx` now, a screen reached the way Vocabulary is. What is
 * left as a drawer is the set of things that are one field, one paragraph or
 * one code -- a glance and a press, and the row above it still on screen.
 *
 * Only one drawer is open at a time. They are alternatives rather than a form
 * to work down, and two of them open a key: a recovery key and a QR of the
 * same key on screen together is twice as much of the thing this panel spends
 * a paragraph telling you to keep private.
 *
 * The appearance controls are drawn for a guest too. They are the one part of
 * this menu that has nothing to do with having an account, and the switches in
 * the lobby footer stay where they are, because somebody who has never opened
 * this menu still has to be able to turn the lights on.
 */
type Open = "none" | "name" | "key" | "qr" | "paste";

export function Profile({
  profile,
  name,
  onName,
  onChanged,
  onOpenVocab,
  onOpenStats,
  onOpenAvatar,
  onOpenWaifu,
  avatar,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
}: {
  profile: ProfileView | null;
  name: string;
  onName(name: string): void;
  onChanged(): void;
  /** Open the Vocabulary screen. See `Vocabulary.tsx`. */
  onOpenVocab(): void;
  /** Open the Stats screen. See `Stats.tsx`. */
  onOpenStats(): void;
  /** Open the gacha. See `Waifu.tsx`. */
  onOpenWaifu(): void;
  /** Open the customiser. See `Customiser.tsx`. */
  onOpenAvatar(): void;
  /** What this browser has on, or null for somebody who has chosen nothing. */
  avatar: Loadout | null;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
}) {
  const [signed, setSigned] = useState(hasAccount);
  const [open, setOpen] = useState<Open>("none");
  /*
    The key section, which is a group that folds rather than a drawer with
    something in it. Its own flag rather than a sixth `Open`, because the rows
    inside it are `Open` values and a section that closed itself the moment you
    opened one of its own rows would be unusable.
  */
  const [keys, setKeys] = useState(false);
  const [paste, setPaste] = useState("");
  const [failed, setFailed] = useState(false);
  /*
    What just happened, for the presses in here that change everything and
    show nothing.

    Three of them: making an account, taking a key from another device, and
    saving the file. All three redraw a menu that looks the same afterwards --
    the same rows, the same handle, the same summary line -- so the report was
    left entirely to the world outside the app, which for a download is a
    notification tray somebody may not see and for the other two is nothing at
    all. Same bargain as `saved` in `NameField`, one paragraph up: a control
    that visibly does nothing gets pressed again, and this menu is the wrong
    place to learn that habit.

    One line rather than one per row, because only one of these can be the
    last thing you did, and it is cleared by opening any row so it can never
    be read as a report on the row underneath it.
  */
  const [said, setSaid] = useState<string | null>(null);
  /* True while `createAccount` is in flight. It is the one await in this menu
     and the button sat live across it, so a second press started a second
     account over the first. */
  const [making, setMaking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // The menu opens under a button, so the reader's place on the page is now
  // above something that was not there a moment ago.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const key = open === "key" ? exportAccount() : null;
  const code = open === "qr" ? exportCompact() : null;
  const toggle = (which: Open) => {
    setSaid(null);
    setOpen((was) => (was === which ? "none" : which));
  };

  /**
   * One arrival point for a key, however it got here.
   *
   * A scan and a paste differ only in how the text was fetched, and the thing
   * that decides whether text is an account is `importAccount` either way. So
   * the refusal, the cache clear and the reload are written once: a scanned
   * key that fails has to fail exactly as loudly as a pasted one, and two
   * copies of this is how one of them quietly stops doing that.
   *
   * **Asked first when there is already an account here.** `importAccount`
   * overwrites the stored key, which is the same act as signing out plus
   * arriving as somebody else, and signing out asks. It has to be asked here
   * rather than inside `importAccount`, for the same reason `createAccount`
   * leaves it to its caller: the guest half of this menu is the one place
   * where overwriting nothing is the whole point, and a prompt there would be
   * a question about a key that does not exist. The scanner makes it
   * load-bearing -- it fires this on any code that comes into frame, so
   * without the gate a camera pointed at the wrong QR is somebody's words
   * gone with no press at all.
   */
  async function take(text: string): Promise<void> {
    if (
      hasAccount() &&
      !confirm(
        "Use this key instead? The account on this device is replaced, and without its own recovery key its words are gone.",
      )
    ) {
      return;
    }
    const account = await importAccount(text);
    if (!account) return setFailed(true);
    // The words on screen belong to the account that just went away.
    clearProfileCache();
    setFailed(false);
    setOpen("none");
    setPaste("");
    setSaid("That key is this device's account now.");
    onChanged();
  }

  /*
    Arriving with a key from somewhere else, offered in both halves of the
    menu.

    A guest needs it because it is the other way to have an account, and
    somebody already signed in needs it because it is how a second device joins
    the first. Same row, same form, same refusal, written once: two copies of
    this is how one of them quietly stops clearing the cache.
  */
  const takeAKey = (sub: boolean) => (
    <>
      <Row
        label="Use a key from another device"
        sub={sub}
        open={open === "paste"}
        onPress={() => {
          setFailed(false);
          toggle("paste");
        }}
      />
      {open === "paste" && (
        <form
          className="prof-paste"
          onSubmit={async (e) => {
            e.preventDefault();
            await take(paste);
          }}
        >
          <Scanner onText={take} />
          <label>
            Type or paste the key from your other device
            <textarea
              rows={4}
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setFailed(false);
              }}
            />
          </label>
          {failed && (
            <p className="prof-bad" role="alert">
              That is not a key this app wrote. Check it for a wrong character,
              and copy the whole thing.
            </p>
          )}
          <button className="primary" disabled={paste.trim().length === 0}>
            Use this key
          </button>
        </form>
      )}
    </>
  );

  /*
    The line under the name, which is the handle's slot in every menu this one
    is shaped like and so is the one place a summary is read without being
    looked for. It carries the two figures the panel leads with, and says the
    plain thing when there are none, because "Level 0, 0 words" is a worse
    answer to "what is in here" than "no words yet" is.
  */
  const summary = !signed
    ? "No account on this device"
    : profile && profile.words > 0
      ? `${profile.learned.toLocaleString()} known · ${profile.words.toLocaleString()} met`
      : "No words yet";

  const streak = signed && profile ? profile.streak.days : 0;

  return (
    <section className="panel prof prof-menu" aria-labelledby="prof-head">
      {/* The identity block: who this is, and what is in the account. It is
          the heading as well as the picture, so the focus the panel takes on
          opening lands on the name rather than on the first row. */}
      <header className="prof-me">
        {/* The bust here too rather than the fuller figure: this is a 44px
            block beside two lines of type, and the figure belongs on the
            screen that is about it. Still `aria-hidden`, since the name is the
            heading immediately beside it. */}
        <Avatar
          loadout={avatar}
          crop="bust"
          initial={(name.trim() || profile?.name || "?").slice(0, 1).toUpperCase()}
          className="prof-me-av"
        />
        <span className="prof-me-who">
          <h2 id="prof-head" ref={heading} tabIndex={-1}>
            {name.trim() || profile?.name || "Your account"}
          </h2>
          <span className="prof-me-sub">{summary}</span>
        </span>
      </header>

      {/* What is left of the hero row: the streak, on its own.

          A count of words due used to lead here as a loud button. It came out
          with the lobby's copy of it -- a review debt is not a welcome. The
          streak stays because it is the opposite kind of number: it reports
          something already earned, and it is absent on day one for the same
          reason "0 days" would be worth less than the space. */}
      {streak > 0 && (
        <div className="prof-hero">
          <p className="prof-streak">
            <span className="prof-streak-n">{streak.toLocaleString()}</span>
            {streak === 1 ? " day in a row" : " days in a row"}
          </p>
        </div>
      )}

      <div className="prof-group">
        <Row label="Change name" open={open === "name"} onPress={() => toggle("name")} />
        {open === "name" && <NameField name={name} onName={onName} />}

        {/* Above Stats, because it is the thing this account is *for*. Both
            are screens of their own, so both carry `goes` and neither carries
            `open` -- a row that claims to expand and then navigates is a lie
            told to a screen reader. */}
        <Row
          label="Vocabulary"
          value={profile && profile.learned > 0 ? `${profile.learned.toLocaleString()} learned` : undefined}
          goes
          onPress={onOpenVocab}
        />

        {/* Under the two rows about what you have learned, because it is what
            those two pay for and it reads as a reward rather than as a
            setting. */}
        <Row label="Your character" goes onPress={onOpenAvatar} />
        {/* The chests left this menu -- they are a header control now, see
            `ChestButton` -- and the collection stayed, because the two are not
            the same kind of thing: one is a purchase to make and the other is
            a record of what you already have. A record belongs in the account.
            The rolling followed the chests out for the same reason and is a
            card in the shop's grid now (see `GachaCard`); this row is the way
            back to what it produced, which is why it leads with faces and not
            with a price.
            The value is the showcase rather than a count of rolls: what
            somebody wants to know before opening this is who is on it. */}
        {/* The faces are the row's whole point. Every other reward surface in
            this app shows art and this one was a word next to a chevron, so
            the one feature built entirely out of pictures advertised itself in
            prose. `rowFaces` draws a stranger for somebody who has never
            rolled, which is the only version of this row that says what is
            behind it rather than reporting that it is empty. */}
        <Row
          label="The Polycule"
          value={collectionValue(profile)}
          faces={rowFaces(profile)}
          goes
          onPress={onOpenWaifu}
        />

        <Row label="Stats" goes onPress={onOpenStats} />
      </div>

      {/* The two controls in the menu that change something on the press
          instead of opening something, and they are drawn differently on
          purpose. Sound has an off, so it is a switch. Appearance has two named
          palettes and no off, so it stays a row that says which one you are in:
          `swapLabel` names the one you would move to, so this has to name the
          other. */}
      <div className="prof-group">
        <Row
          label="Appearance"
          value={swapLabel === "Daylight" ? "Stage" : "Daylight"}
          onPress={onSwapPalette}
        />
        <Toggle label="Sound" on={sound} onPress={onToggleSound} />
      </div>

      {/* The key, and the four things anybody ever does with one. Absent
          entirely for a guest, who has no key for these rows to be about.

          Folded behind one row, because four rows about a key is most of the
          menu given over to the part of it nobody opens twice: you set a
          second device up once, and you save the key once. Open, it is a group
          with its own warning at the top, which is where that paragraph wanted
          to be anyway -- it was being read by everybody as the price of
          scrolling past it to Sign out. */}
      {signed ? (
        <div className="prof-group">
          <Row
            label="Recovery key"
            value="Back up, add a device"
            open={keys}
            onPress={() => {
              setKeys((was) => !was);
              // Leaving a key on screen under a section that is closing is the
              // one way this fold could make the panel less private.
              setOpen("none");
            }}
          />

          {keys && (
            <div className="prof-keys">
              <p className="prof-keep-why">
                This account is a key on this device. There is no email and no
                password, so <strong>if you lose the key you lose the words</strong>.
                It is 52 characters, so you can write it on paper. Keep it somewhere
                private.
              </p>

              <Row
                label="Download key"
                sub
                onPress={() => {
                  const saving = exportAccount();
                  // A download is the one act in here whose whole result
                  // happens outside the app, in a tray this app cannot see
                  // and a WebView may not draw at all.
                  if (saving) {
                    downloadKey(saving);
                    setSaid("Key saved to your downloads.");
                  } else {
                    setSaid("There is no key on this device to save.");
                  }
                }}
              />

              <Row
                label="Set up another device"
                sub
                open={open === "qr"}
                onPress={() => toggle("qr")}
              />
              {code && (
                <div className="prof-qr">
                  <QrCode text={code} alt="Your recovery key, as a QR code" />
                  <p>
                    On the other device, open this menu and choose{" "}
                    <strong>use a key from another device</strong>, then point it here.
                    {/* Said plainly, because the code looks like a ticket and is not
                        one: it is the account itself, and a photograph of it is as
                        good as the key. */}{" "}
                    Anyone who photographs this has your words.
                  </p>
                </div>
              )}

              <Row
                label="Show recovery key"
                sub
                open={open === "key"}
                onPress={() => toggle("key")}
              />
              {key && (
                <label className="prof-key">
                  <span className="sr-only">Your recovery key</span>
                  {/* Read-only and selectable rather than a copy button: a clipboard
                      write can fail silently on a WebView, and the text being right
                      there is the thing that cannot. */}
                  {/* Two rows, because the key is one line of 64 characters and a
                      legacy JSON pair is four. Wrapping is on either way. */}
                  <textarea readOnly rows={3} value={key} onFocus={(e) => e.target.select()} />
                </label>
              )}

              {takeAKey(true)}
            </div>
          )}

          {/* In the same group as the key rather than alone under a rule of its
              own. Signing out is the last thing you can do to the key, and a
              group holding one destructive row was a rule drawn to make that
              row look like a decision. */}
          <Row
            label="Sign out on this device"
            danger
            onPress={() => {
              if (
                !confirm(
                  "Sign out on this device? Without the recovery key these words are gone.",
                )
              ) {
                return;
              }
              forgetAccount();
              clearProfileCache();
              setSigned(false);
              setKeys(false);
              setOpen("none");
              onChanged();
            }}
          />
        </div>
      ) : (
        /* The guest's half of the menu. There is no sign-up anywhere in this
           system: pressing the button makes a key and that is the whole of it,
           no round trip, nothing that can fail on a train. So the copy has one
           job, which is to say what starts happening. */
        <div className="prof-group">
          <p className="prof-keep-why">
            Word Chain and Vocab Race already know every word you have found and
            every one you have missed. With an account they are written down,
            and the games start asking you the ones you owe a review on. No
            email, no password, nothing to fill in.
          </p>
          <button
            className="primary prof-make"
            type="button"
            disabled={making}
            onClick={async () => {
              if (making) return;
              setMaking(true);
              try {
                await createAccount();
                setSigned(true);
                setSaid("Account made. Your words are being kept now.");
                onChanged();
              } finally {
                setMaking(false);
              }
            }}
          >
            {making ? "Making it..." : "Start keeping track"}
          </button>
          {takeAKey(false)}
        </div>
      )}

      {/* Under both halves of the menu rather than inside either, because the
          press that raises it can be the press that swaps them: making an
          account redraws this whole section, and a note living in the guest
          half would be unmounted by the thing it was reporting on.

          Polite, for the reason `NameField`'s is: it arrives beside a control
          somebody is still looking at, and an assertive region would cut
          across whatever the reader was on. */}
      {said && (
        <p className="prof-said" role="status" aria-live="polite">
          {said}
        </p>
      )}
    </section>
  );
}

/**
 * What the collection row says without being opened.
 *
 * The showcase filled out of three, rather than the size of the collection.
 * The collection only grows and a number that only goes up says nothing about
 * what to do next; "2 of 3 on show" is the one figure that does, and it is the
 * whole of what the feature asks somebody to think about.
 *
 * "Roll for one" rather than "0 of 3" for somebody who has never rolled, so
 * the row is an invitation rather than a report of nothing.
 */
function collectionValue(profile: ProfileView | null): string {
  // A number for somebody who has never rolled reports nothing and invites
  // nothing. The size of the roster does both: it is the only figure on this
  // row that says what is actually behind it.
  if (!profile || profile.claimed === 0) return `${roster().length} waifus waiting`;
  return `${profile.showcase.length} of ${SHOWCASE_MAX} on show`;
}

/** One slot in the row's strip. `one` is null for a slot nobody is in. */
interface RowFace {
  one: Waifu | null;
  /** Somebody not owned, drawn dimmed. Only ever the never-rolled case. */
  teaser?: boolean;
}

/**
 * The faces on the collection row.
 *
 * Three slots for an account that has rolled, filled from the showcase and
 * outlined where they are not, which is the same shape the gacha screen draws
 * and for the same reason: the gap is the message.
 *
 * An account that has never rolled gets a stranger instead of three empty
 * outlines. Three holes advertise an empty feature; one face advertises the
 * feature. She is dimmed and the row does not claim she is yours, and the
 * choice is fixed rather than random because a row that showed a different
 * person on every render would read as a carousel somebody has to wait on.
 */
function rowFaces(profile: ProfileView | null): RowFace[] {
  if (!profile || profile.claimed === 0) {
    const teaser = roster()[0];
    return teaser ? [{ one: teaser, teaser: true }] : [];
  }
  return Array.from({ length: SHOWCASE_MAX }, (_, at) => ({
    one: waifuById(profile.showcase[at] ?? "") ?? null,
  }));
}

