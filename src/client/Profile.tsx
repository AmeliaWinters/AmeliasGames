/**
 * The profile panel: what you have learned, and the key that owns it.
 *
 * It leads with **words known** and **words due**, and carries the level as
 * the smaller figure beside them. That ordering is the argument this whole
 * feature rests on: a level is a number that means something only next to
 * somebody else's, and the two word counts are the ones that mean something on
 * their own. Putting the level first would make this a scoreboard about a game
 * rather than a record of a language.
 *
 * Everything here is drawn from the cached `ProfileView` — see
 * `profileCache.ts` for why the lobby cannot have a live one, and why a stale
 * count is the right trade.
 *
 * **It renders no word it was not sent.** The client has no dictionary and
 * never may, so every gloss, script and rank on this screen arrived on the row
 * itself. That is what `Known` is carrying all those fields for.
 */
import { useEffect, useRef, useState } from "react";
import type { GameTally, ProfileView, TallyResult } from "../shared/profile.js";
import { LEARN_LANGS, dayOf, decided } from "../shared/profile.js";
import { BOXES, levelFor, xpForLevel } from "../shared/review.js";
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
import { gameEntry } from "../shared/games/manifest.js";

/** What to call each language on a screen. Three strings, not worth an import. */
const LANG_NAME: Record<string, string> = { en: "English", pl: "Polish", ja: "Japanese" };

/**
 * How long a word has earned, in words rather than in days.
 *
 * "Back in a week" is a thing somebody can act on; "box 3" is a thing they
 * would have to learn a scheme to read. The rung is still what the scheduler
 * thinks in, and this is the only place it is translated.
 */
function restingFor(box: number): string {
  const days = BOXES[Math.max(0, Math.min(box, BOXES.length - 1))];
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** A count and what it counts, as one block. The panel is mostly these. */
function Figure({ n, of, lead }: { n: number; of: string; lead?: boolean }) {
  return (
    <div className={lead ? "figure figure-lead" : "figure"}>
      <span className="figure-n">{n.toLocaleString()}</span>
      <span className="figure-of">{of}</span>
    </div>
  );
}

/**
 * Hand the key over as a file.
 *
 * A key is four lines of base64 that has to survive being moved to another
 * device, and the two ways of moving it that people actually have are a file
 * and a clipboard. The clipboard is the one that can fail silently in a
 * WebView, so this is the one that is a button: an object in Downloads can be
 * mailed to yourself, dropped in a password manager, or put on a stick, and it
 * cannot be half-selected.
 *
 * The object URL is revoked on the next frame rather than immediately -- the
 * click has to have been dispatched first -- and never held, because it keeps
 * the key alive in the document for as long as it exists.
 */
function downloadKey(key: string): void {
  const url = URL.createObjectURL(new Blob([key], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  // Dated, because somebody who has done this twice needs to know which file
  // is the account they are still using.
  link.download = `rebellia-key-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The account controls.
 *
 * Separate from the numbers because they are a different kind of thing: the
 * numbers are what you came to look at, and this is the housekeeping under
 * them. It says "keep this somewhere private" and "losing it loses the
 * account" in those words, because that is true and there is nobody to appeal
 * to — no email address and no password on file, which is the same property
 * that makes this system hold no personal data at all.
 */
function Keeping({ onChanged }: { onChanged(): void }) {
  const [showing, setShowing] = useState<"none" | "text" | "qr">("none");
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [failed, setFailed] = useState(false);
  const key = showing === "text" ? exportAccount() : null;
  const code = showing === "qr" ? exportCompact() : null;

  /**
   * One arrival point for a key, however it got here.
   *
   * A scan and a paste differ only in how the text was fetched, and the thing
   * that decides whether text is an account is `importAccount` either way. So
   * the refusal, the cache clear and the reload are written once: a scanned
   * key that fails has to fail exactly as loudly as a pasted one, and two
   * copies of this is how one of them quietly stops doing that.
   */
  async function take(text: string): Promise<void> {
    const account = await importAccount(text);
    if (!account) return setFailed(true);
    // The words on screen belong to the account that just went away.
    clearProfileCache();
    setFailed(false);
    setPasting(false);
    setPaste("");
    onChanged();
  }

  return (
    <section className="prof-keep" aria-labelledby="prof-keep-head">
      <h3 id="prof-keep-head">Keeping this</h3>
      <p>
        This account is a key on this device. There is no email and no password,
        so <strong>if you lose the key you lose the words</strong>. Save the file
        somewhere private.
      </p>

      <div className="prof-keep-row">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const saving = exportAccount();
            if (saving) downloadKey(saving);
          }}
        >
          Download key
        </button>
        <button
          type="button"
          onClick={() => setShowing((was) => (was === "qr" ? "none" : "qr"))}
        >
          {showing === "qr" ? "Hide code" : "Set up another device"}
        </button>
        <button
          type="button"
          onClick={() => setShowing((was) => (was === "text" ? "none" : "text"))}
        >
          {showing === "text" ? "Hide key" : "Show recovery key"}
        </button>
        <button type="button" onClick={() => setPasting((was) => !was)}>
          Use a key from another device
        </button>
      </div>

      {code && (
        <div className="prof-qr">
          <QrCode text={code} alt="Your recovery key, as a QR code" />
          <p>
            On the other device, open this screen and choose{" "}
            <strong>use a key from another device</strong>, then point it here.
            {/* Said plainly, because the code looks like a ticket and is not
                one: it is the account itself, and a photograph of it is as
                good as the key. */}{" "}
            Anyone who photographs this has your words.
          </p>
        </div>
      )}

      {key && (
        <label className="prof-key">
          <span className="sr-only">Your recovery key</span>
          {/* Read-only and selectable rather than a copy button: a clipboard
              write can fail silently on a WebView, and the text being right
              there is the thing that cannot. */}
          <textarea readOnly rows={4} value={key} onFocus={(e) => e.target.select()} />
        </label>
      )}

      {pasting && (
        <form
          className="prof-paste"
          onSubmit={async (e) => {
            e.preventDefault();
            await take(paste);
          }}
        >
          <Scanner onText={take} />
          <label>
            Paste the key from your other device
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
              That is not a key this app wrote. Copy the whole thing, including
              the brackets.
            </p>
          )}
          <button className="primary" disabled={paste.trim().length === 0}>
            Use this key
          </button>
        </form>
      )}
    </section>
  );
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
 * When a game was last played, in the words somebody would use.
 *
 * Days rather than a date for the first fortnight, because "4 days ago" is the
 * answer to the question being asked and "22 Aug" is a lookup. After that the
 * date is the shorter thing to read and nobody is counting any more.
 *
 * Whole days apart on the same UTC boundary the streak uses, so a game
 * finished late last night reads as yesterday rather than as "14 hours".
 */
function playedAgo(at: number, now: number): string {
  if (at === 0) return "";
  const days = dayOf(now) - dayOf(at);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One game's record, written out only as far as there is something to write.
 *
 * Eleven of the thirteen games name no winner, so their rows say how many were
 * played and stop. A permanent "0W 0L" on two thirds of the list would read as
 * a losing record rather than as an absent one -- see `GameTally`, where the
 * counters are documented as not adding up to `played` on purpose.
 */
function recordOf(tally: GameTally): string {
  if (decided(tally) === 0) return `${tally.played} played`;
  const drawn = tally.drew > 0 ? ` · ${tally.drew}D` : "";
  return `${tally.played} played · ${tally.won}W${drawn} · ${tally.lost}L`;
}

/**
 * The last few results, oldest on the left.
 *
 * Pips rather than letters, because the question they answer is "how has it
 * been going lately", which is a shape and is read without reading. They are
 * hidden from a screen reader and spelled out in the row's label instead: a
 * run of coloured dots says nothing out loud, and eight list items saying
 * "won" would drown the counts that matter.
 */
function Form({ last }: { last: TallyResult[] }) {
  if (last.length === 0) return null;
  return (
    <span className="prof-form" aria-hidden="true">
      {last.map((result, i) => (
        <span key={i} className={`prof-pip prof-pip-${result}`} />
      ))}
    </span>
  );
}

/**
 * Every game this account has finished: the record, and how it has been going.
 *
 * Most recently played first, and the ordering is most of what makes this a
 * history rather than a leaderboard. Sorting by how often a game has been
 * played -- which is what this panel did when it was two numbers -- buries
 * what somebody played last night under the game they wore out in March. Ties
 * go to the bigger tally, which only decides anything on a day with two games
 * on it.
 */
function Games({ games }: { games: GameTally[] }) {
  const now = Date.now();
  const played = games.reduce((n, tally) => n + tally.played, 0);

  return (
    <section className="prof-games" aria-labelledby="prof-games-head">
      <h3 id="prof-games-head">
        Games <span className="prof-games-total">{played.toLocaleString()} played</span>
      </h3>
      <ul>
        {[...games]
          .sort((a, b) => b.lastAt - a.lastAt || b.played - a.played)
          .map((tally) => {
            const name = gameEntry(tally.gameId)?.name ?? tally.gameId;
            const ago = playedAgo(tally.lastAt, now);
            const run =
              tally.last.length > 0 ? `. Last ${tally.last.length}: ${tally.last.join(", ")}` : "";
            return (
              <li key={tally.gameId}>
                <span className="prof-game">{name}</span>
                <span
                  className="prof-game-n"
                  aria-label={`${name}. ${recordOf(tally)}${ago ? `, last played ${ago}` : ""}${run}`}
                >
                  <span>{recordOf(tally)}</span>
                  {ago && <em className="prof-game-when">{ago}</em>}
                </span>
                <Form last={tally.last} />
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/**
 * The panel, or the offer of one.
 *
 * A guest is shown what an account is *for* rather than a form. There is no
 * sign-up anywhere in this system — pressing the button makes a key and that
 * is the whole of it, no round trip, nothing that can fail on a train — so the
 * copy has one job, which is to say what starts happening.
 */
export function Profile({
  profile,
  onChanged,
}: {
  profile: ProfileView | null;
  onChanged(): void;
}) {
  const [signed, setSigned] = useState(hasAccount);
  const heading = useRef<HTMLHeadingElement>(null);

  // The panel opens under a button, so the reader's place on the page is now
  // above something that was not there a moment ago.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  if (!signed) {
    return (
      <section className="panel prof" aria-labelledby="prof-head">
        <h2 id="prof-head" ref={heading} tabIndex={-1}>
          Keep what you learn
        </h2>
        <p>
          Word Chain and Vocab Race already know every word you have found and
          every one you have missed. With an account they are written down, and
          the games start asking you the ones you owe a review on.
        </p>
        <p className="prof-quiet">
          No email, no password, nothing to fill in. Everyone you play with can
          carry on without one.
        </p>
        <button
          className="primary"
          type="button"
          onClick={async () => {
            await createAccount();
            setSigned(true);
            onChanged();
          }}
        >
          Start keeping track
        </button>
      </section>
    );
  }

  // Signed in, but nothing filed yet: the account exists the moment the key
  // does, and the profile behind it is created by the first game.
  if (!profile) {
    return (
      <section className="panel prof" aria-labelledby="prof-head">
        <h2 id="prof-head" ref={heading} tabIndex={-1}>
          Nothing yet
        </h2>
        <p>
          Play a game of Word Chain or Vocab Race and the words will land here.
        </p>
        <Keeping onChanged={onChanged} />
      </section>
    );
  }

  const level = levelFor(profile.xp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const through = Math.max(0, Math.min(1, (profile.xp - floor) / Math.max(1, ceiling - floor)));

  return (
    <section className="panel prof" aria-labelledby="prof-head">
      <h2 id="prof-head" ref={heading} tabIndex={-1}>
        {profile.name || "Your words"}
      </h2>

      {/* Words first, level second. See the note at the top of this file. */}
      <div className="prof-figures">
        <Figure n={profile.due} of={profile.due === 1 ? "word due" : "words due"} lead />
        <Figure n={profile.words} of={profile.words === 1 ? "word known" : "words known"} />
        {profile.streak.days > 0 && (
          <Figure n={profile.streak.days} of={profile.streak.days === 1 ? "day" : "day streak"} />
        )}
      </div>

      <div className="prof-level">
        <span className="prof-level-n">Level {level}</span>
        <span className="prof-bar" aria-hidden="true">
          <span className="prof-bar-fill" style={{ inlineSize: `${Math.round(through * 100)}%` }} />
        </span>
        <span className="prof-level-xp">
          {profile.xp.toLocaleString()} / {ceiling.toLocaleString()}
        </span>
      </div>

      {profile.byLang.length > 0 && (
        <ul className="prof-langs">
          {LEARN_LANGS.filter((lang) => profile.byLang.some((row) => row.lang === lang)).map(
            (lang) => {
              const row = profile.byLang.find((entry) => entry.lang === lang);
              if (!row) return null;
              return (
                <li key={lang}>
                  <span className="prof-lang">{LANG_NAME[lang] ?? lang}</span>
                  <span className="prof-lang-n">
                    {row.words} {row.words === 1 ? "word" : "words"}
                    {row.due > 0 && <em>, {row.due} due</em>}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      )}

      {profile.recent.length > 0 && (
        <section className="prof-recent" aria-labelledby="prof-recent-head">
          <h3 id="prof-recent-head">Lately</h3>
          <ul>
            {profile.recent.map((word) => (
              <li key={`${word.lang}:${word.key}`}>
                <span className="prof-word">
                  {word.lemma || word.word}
                  {word.script && <span className="prof-script">{word.script}</span>}
                </span>
                <span className="prof-gloss">{word.gloss}</span>
                <span className="prof-when">
                  {word.dueAt <= Date.now() ? "due now" : `back ${restingFor(word.box)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.games.length > 0 && <Games games={profile.games} />}

      <Keeping onChanged={onChanged} />

      <button
        type="button"
        className="prof-forget"
        onClick={() => {
          if (!confirm("Sign out on this device? Without the recovery key these words are gone.")) {
            return;
          }
          forgetAccount();
          clearProfileCache();
          setSigned(false);
          onChanged();
        }}
      >
        Sign out on this device
      </button>
    </section>
  );
}
