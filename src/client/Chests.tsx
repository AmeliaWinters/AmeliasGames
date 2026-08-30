/**
 * The chest screen: where experience turns into a wardrobe.
 *
 * A page at `/chests`, reached from the balance in the lobby bar and from the
 * same button inside a room. That is not an arbitrary home. **The lobby has no
 * socket** (see `net.ts`), so a shop that needed one could only be opened
 * mid-game, and a chest that could only be opened mid-game would be a chest
 * nobody opened. `/account/chest` is plain HTTP precisely so this screen works
 * from here.
 *
 * **Buying and opening are one act.** There is no inventory of unopened
 * chests, no "buy 10", and nothing to decide between paying and pressing. A
 * chest costs a hundred and gives one thing, so a two-step flow would be a
 * confirmation dialog wearing a costume. The one exception is `credits`, which
 * are chests the version 4 migration already paid for, and those are spent
 * silently before the balance is touched: the button says the same thing
 * either way, because from where the player is standing it is the same act.
 *
 * A press here and a press in the gacha dialog spend the same purse on the
 * same act, and they used to move like two different apps: the pull cycled
 * portraits behind a blur, this one pulsed a border and then had the item.
 * Both now spin through what is actually in the box and slow into the answer,
 * out of `roll.ts` and `roll.css`. See `Spinning` below.
 *
 * The screen is a grid over `SETS` rather than four hand-placed cards, so a
 * fifth set costs a folder of art and a manifest line here as well. The gacha
 * is the one card that is not a set: it leads the grid because it spends the
 * same purse, and hiding it under the collection it fills made the shop look
 * like it sold one thing. See `GachaCard`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileView } from "../shared/profile.js";
import { CHEST_COST, ownedIn, purseOf, wardrobeSet } from "../shared/chest.js";
import { ROLL_COST, roster, waifuById } from "../shared/waifu.js";
import { LANG_POINTS_MULTIPLIER, POINTS_FIRST_GAME_OF_DAY } from "../shared/review.js";
import { Avatar, SetCover } from "./avatar/Avatar.js";
import { partOf, partsIn, SETS, starterFor } from "./avatar/manifest.js";
import { bareId, isColourId } from "./avatar/wardrobeSplit.js";
import { mintNonce, openChest, type ChestError, type ChestOpened } from "./chestApi.js";
import { WaifuRoll } from "./WaifuRoll.js";
import type { Rolled } from "./waifuApi.js";
import type { AvatarSet, Loadout, PartId, Slot } from "./avatar/types.js";
import { SPIN_MS, spinFace, startSpin } from "./roll.js";
import { wantsStillness } from "./motion.js";

interface Props {
  profile: ProfileView | null;
  owned: string[] | null;
  /** Every character rolled, or null for a browser that has not been told. */
  claimed: string[] | null;
  /** Which set's card to scroll to, when the customiser sent them here. */
  focus: string | null;
  /** Hands back the new owned list and profile so the app can cache both. */
  onOpened(result: ChestOpened): void;
  onBack(): void;
  /** Wear the thing that just came out. Never automatic; see `Reveal`. */
  onEquip(set: string, drop: string): void;
  /** Open The Polycule, the shelf a pull lands on. See `App.tsx` for why
      that is a route on the lobby and a layer over a room. */
  onOpenWaifu(): void;
  /** A pull happened in the dialog. Carries the whole claimed list back. */
  onRolled(result: Rolled): void;
}

/**
 * What the screen is doing, as one value.
 *
 * A union rather than three booleans, because "busy and also showing the last
 * drop and also holding an error" is a state this screen must never be in and
 * the type is the cheapest place to say so. `nonce` rides on `failed` because
 * a retry has to reuse it: see `chestApi.ts`, where minting a fresh one on retry
 * is named as the way to charge somebody twice.
 */
type Phase =
  | { at: "idle" }
  | { at: "opening"; set: string }
  | { at: "opened"; set: string; result: ChestOpened }
  | { at: "failed"; set: string; nonce: string; error: ChestError };

export function Chests({
  profile,
  owned,
  claimed,
  focus,
  onOpened,
  onBack,
  onEquip,
  onOpenWaifu,
  onRolled,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  /* Whether the gacha dialog is up. Not part of `Phase`: that union is about
     the chest a card is opening, and a roll is a different purse-spend that
     must never look like one of them. */
  const [rolling, setRolling] = useState(false);
  const wardrobe = useMemo(() => new Set(owned ?? []), [owned]);

  const spendable = profile?.spendable ?? 0;
  const purse = purseOf(spendable, CHEST_COST);
  const affordable = purse.ready > 0;
  /* The roll's own arithmetic, because the two prices are separate constants
     even though they are the same number today. A card saying "ready" off the
     chest's sum would start lying the day one of them moves. */
  const rollPurse = purseOf(spendable, ROLL_COST);
  const rollable = rollPurse.ready > 0;

  async function open(setId: string, reuse?: string): Promise<void> {
    if (phase.at === "opening") return;
    const nonce = reuse ?? mintNonce();
    setPhase({ at: "opening", set: setId });

    const began = Date.now();
    const answer = await openChest(setId, nonce);
    /* The same floor the pull waits out, and the reason it is here is that
       this screen did not have one. A chest is a single request and the server
       answers in a few milliseconds, so the spin below would start and stop
       inside one frame -- which is what the old border pulse did, and why the
       cheaper-feeling of these two hundred-GP presses was this one.

       Only ever the remainder: a server slower than the spin has already paid
       for the drama, and nothing is added on top of a slow answer. A failure
       waits it out too, on purpose -- an error that appears instantly while a
       success takes two seconds teaches that the fast answer is the bad one.

       Not applied when the movement is unwanted: `Spinning` never starts its
       ticker for somebody who asked for less motion, and a floor with nothing
       moving behind it is a screen that has simply stopped. */
    if (!wantsStillness()) {
      const left = Math.max(0, SPIN_MS - (Date.now() - began));
      await new Promise((done) => setTimeout(done, left));
    }

    if (!answer.ok) {
      setPhase({ at: "failed", set: setId, nonce, error: answer.error });
      return;
    }
    setPhase({ at: "opened", set: setId, result: answer.result });
    onOpened(answer.result);
  }

  /*
    The screen takes focus on arrival, as every other account screen does. The
    row that opened this is gone by the time it draws, so without it focus
    falls to `<body>` and Tab restarts at the top of the document.
  */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="chests" aria-label="Chests">
      <header className="chest-head">
        <h2 ref={heading} tabIndex={-1}>
          Chests
        </h2>
        {/* The balance and what it buys, on one line and in that order.
            Before this it said one of two things -- a total, or a count of
            banked chests -- and never the number somebody was actually after,
            which is how far off the next one is. */}
        <p className="chest-balance">
          <b>{spendable.toLocaleString()}</b> GP
          <span className="chest-worth">
            {purse.ready > 0
              ? ` = ${purse.ready} ${purse.ready === 1 ? "chest" : "chests"}`
              : ` = ${purse.toNext} more for a chest`}
          </span>
        </p>
        {/* How close the next one is, drawn rather than left to be worked out.
            Full and still when one is ready, because a bar that sits full is a
            clearer "yes" than an empty one restarting would be. */}
        <div
          className="chest-bar chest-next"
          role="progressbar"
          aria-valuenow={affordable ? CHEST_COST : CHEST_COST - purse.toNext}
          aria-valuemin={0}
          aria-valuemax={CHEST_COST}
          aria-label={
            affordable
              ? "A chest is ready to open"
              : `${purse.toNext} goth points until the next chest`
          }
        >
          <span
            style={{
              width: affordable
                ? "100%"
                : `${((CHEST_COST - purse.toNext) / CHEST_COST) * 100}%`,
            }}
          />
        </div>
        {/* The rule, said once, where somebody can read it before they wonder
            what their last game paid. Three sentences: what earns, what a
            language game is worth, and what it costs. The old copy explained
            why English bought nothing, which stopped being true in version 7 --
            everything pays now, language games just pay five times more. */}
        <p className="chest-rule">
          Every game you finish earns GP, and your first game each day earns{" "}
          {POINTS_FIRST_GAME_OF_DAY}. A game in a language you are learning pays{" "}
          {LANG_POINTS_MULTIPLIER}x. {CHEST_COST} GP opens a chest.
        </p>
      </header>

      <div className="chest-grid">
        {/*
          The gacha, first in the grid rather than a row in a menu.

          It was reachable from one place: the account menu, under the
          collection it fills. That is backwards -- the collection is the
          *record* of the thing, and a shop that hides one of the two things it
          sells behind a list of what you already own sells one thing. Both
          spend the same GP out of the same purse (see `ROLL_COST`), so the
          only honest place to choose between them is beside each other, and
          the grid is where somebody is standing when they decide.

          First and not last because it is a hundred for a face rather than a
          hundred for a hair clip: it is the offer with the widest appeal on a
          screen somebody opened with money in their hand.
        */}
        <GachaCard
          claimed={claimed}
          affordable={rollable && phase.at !== "opening"}
          onOpen={() => setRolling(true)}
          onShelf={onOpenWaifu}
        />
        {SETS.map((set) => (
          <ChestCard
            key={set.id}
            set={set}
            wardrobe={wardrobe}
            /* Not just this card's own balance: while any card is opening,
               `open` refuses at the top and returns, so pressing a second card
               did nothing at all -- no spinner, no error, no chest. One
               request at a time is right, and a press that is going to be
               ignored has to look ignorable before it is made. */
            affordable={affordable && phase.at !== "opening"}
            focused={focus === set.id}
            phase={phase}
            onOpen={() => void open(set.id)}
            onRetry={(nonce) => void open(set.id, nonce)}
            onEquip={onEquip}
            onDismiss={() => setPhase({ at: "idle" })}
          />
        ))}
      </div>

      {/* The pull, over the shop rather than through a door out of it.
          Pressing the card used to navigate to The Polycule -- a shelf with a
          roll button at the top -- so the press and the thing it bought were
          two screens apart and the shop lost whoever took it. See
          `WaifuRoll.tsx`. */}
      {rolling && (
        <WaifuRoll
          profile={profile}
          claimed={claimed}
          onRolled={onRolled}
          onOpenPolycule={() => {
            setRolling(false);
            onOpenWaifu();
          }}
          onClose={() => setRolling(false)}
        />
      )}

      <button type="button" className="prof-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

/**
 * The gacha's card.
 *
 * Deliberately the same shape as a set's: art, name, a count of what is owned
 * out of what exists, a bar, and one button with the price on it. Anything
 * else -- a banner, a different size, its own colour -- would have made it an
 * advertisement sitting in a grid of shops, and the thing it is competing with
 * for the same hundred GP is the card next to it.
 *
 * The art is the last waifu claimed, falling back to the first of the roster
 * for somebody who has never rolled. A face rather than a chest, since the
 * face is what the hundred buys, and `Portrait` is not reused from
 * `Waifu.tsx` for one `<img>` with a different class.
 *
 * Two ways out, and the sizes say which is which. The button rolls, in a
 * dialog over this screen; the link under it goes to the shelf. It used to be
 * one control doing the second thing while saying the first.
 */
function GachaCard({
  claimed,
  affordable,
  onOpen,
  onShelf,
}: {
  claimed: string[] | null;
  affordable: boolean;
  onOpen(): void;
  onShelf(): void;
}) {
  const all = roster();
  // Distinct, because the stored list keeps repeats: it is a ledger of what
  // was spent, and "12 of 300" counting the same face four times would be a
  // number nobody could reconcile with the grid on the other screen.
  const mine = useMemo(() => new Set(claimed ?? []), [claimed]);
  const have = mine.size;
  const total = all.length;
  const newest = [...mine].reverse().map((id) => waifuById(id)).find(Boolean);
  const cover = newest ?? all[0];
  const first = have === 0;

  return (
    <article className="chest-card chest-card-gacha">
      {cover?.image ? (
        <img className="chest-art" src={cover.image} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="chest-art" aria-hidden="true" />
      )}

      <div className="chest-meta">
        <h3>Waifus</h3>
        <p className="chest-artist">The gacha</p>
        <p className="chest-count">
          {first ? `${total} waiting` : `${have} of ${total} yours`}
        </p>
        <div
          className="chest-bar"
          role="progressbar"
          aria-valuenow={have}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Waifus, ${have} of ${total} pulled`}
        >
          <span style={{ width: `${total ? (have / total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* It rolls, in a dialog over this screen, and the dialog says what is
          in the pool before it spends anything. This used to navigate to The
          Polycule instead -- a shelf with a roll button at the top of it --
          so the button said "Roll" and did "go somewhere else", and the shop
          lost everybody it sent. */}
      <button
        type="button"
        className="primary chest-open"
        /* Gated on the balance, like every other card in this grid. It was the
           one control here that stayed lit with nothing to spend: it opened
           the dialog, and the dialog's own Roll button was the thing that was
           greyed out -- so the shop's answer to "can I afford this" was a
           press, a dialog and a second dead button. */
        disabled={!affordable}
        onClick={onOpen}
      >
        {first ? `Pull your first waifu, ${ROLL_COST}` : `Roll a waifu, ${ROLL_COST}`}
      </button>

      {/* The shelf, quietly. Arranging who is on show is a different errand
          from spending a hundred, and it is the smaller of the two. */}
      <button type="button" className="chest-shelf" onClick={onShelf}>
        {first ? "See the polycule" : `Your polycule, ${have}`}
      </button>
    </article>
  );
}

function ChestCard({
  set,
  wardrobe,
  affordable,
  focused,
  phase,
  onOpen,
  onRetry,
  onEquip,
  onDismiss,
}: {
  set: AvatarSet;
  wardrobe: Set<string>;
  affordable: boolean;
  focused: boolean;
  phase: Phase;
  onOpen(): void;
  onRetry(nonce: string): void;
  onEquip(set: string, drop: string): void;
  onDismiss(): void;
}) {
  const pool = wardrobeSet(set.id);
  const total = pool?.pool.length ?? 0;
  const have = pool ? ownedIn(pool, wardrobe) : 0;
  const complete = total > 0 && have >= total;
  // A set nothing is owned in has never had a chest opened, so its first one
  // hands over the whole floor. Worth saying on the button, because "39 items
  // and a roll" is a very different offer from "one hair clip".
  const first = pool !== undefined && !pool.floor.some((id) => wardrobe.has(id));

  const mine = phase.at !== "idle" && phase.set === set.id;
  const busy = mine && phase.at === "opening";

  return (
    <article
      className={`chest-card${focused ? " chest-card-focus" : ""}${busy ? " chest-card-opening" : ""}`}
    >
      <SetCover set={set} className="chest-art" />

      <div className="chest-meta">
        <h3>{set.name}</h3>
        <p className="chest-artist">{set.artist}</p>
        <p className="chest-count">
          {complete ? "You have everything here" : `${have} of ${total}`}
        </p>
        {!complete && (
          <div
            className="chest-bar"
            role="progressbar"
            aria-valuenow={have}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={`${set.name}, ${have} of ${total} owned`}
          >
            <span style={{ width: `${total ? (have / total) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      {complete ? (
        <p className="chest-done">Nothing left to find.</p>
      ) : (
        <button
          type="button"
          className="primary chest-open"
          disabled={!affordable || busy}
          onClick={onOpen}
        >
          {/* The price is on the button rather than only in the header,
              because the button is what somebody is looking at when they
              decide. "Start this set" carries it too: a first chest costs the
              same hundred and hands over the whole floor with it. */}
          {busy
            ? "Opening..."
            : first
              ? `Start this set, ${CHEST_COST}`
              : `Open a chest, ${CHEST_COST}`}
        </button>
      )}

      {/* The wait, spent on the contents rather than on a border. See
          `Spinning`: it stands exactly where the reveal is about to, so the
          answer replaces it in place. */}
      {busy && <Spinning set={set} />}

      {mine && phase.at === "opened" && (
        <Reveal set={set} result={phase.result} onEquip={onEquip} onDismiss={onDismiss} />
      )}

      {mine && phase.at === "failed" && (
        <p className="chest-error" role="status">
          {phase.error === "no-account"
            ? "You need an account for this. Make one from the menu."
            : phase.error === "offline"
              ? "That did not reach the server."
              : "That did not work."}{" "}
          {phase.error !== "no-account" && (
            <button type="button" className="chest-retry" onClick={() => onRetry(phase.nonce)}>
              Try again
            </button>
          )}
        </p>
      )}
    </article>
  );
}

/**
 * The wait, spent showing what is in the box.
 *
 * A chest is one request and on a good connection it answers in a few
 * milliseconds, so the press used to have no beat at all: a border pulsed for
 * a frame or two and then the item was simply there. The gacha, which costs
 * the same hundred, spun through faces for the best part of two seconds. The
 * cheaper-feeling of the two was the one with more in it.
 *
 * So this cycles pieces out of the set being opened -- real parts, drawn by
 * the same `Avatar` the reveal draws its drop with -- and it slows as it goes,
 * on `roll.ts`'s schedule, which is the schedule the pull uses. Anything that
 * lands could genuinely come out of this chest, so the spin is not decoration:
 * it is the answer to "what is in here", asked at the only moment somebody is
 * definitely wondering.
 *
 * It is stopped by unmounting, which is what `phase` leaving `opening` does,
 * so there is no cancel to get wrong -- the effect's own teardown is it.
 */
function Spinning({ set }: { set: AvatarSet }) {
  /* One loadout per part, the starter wearing that part. Not every drop is a
     part -- a colour is a drop too -- but a swatch flicking past at speed is a
     square changing colour, which reads as a glitch rather than as contents. */
  const faces = useMemo(() => {
    const base = starterFor(set);
    return set.parts.map((part) => ({
      ...base,
      parts: { ...base.parts, [part.slot]: part.id },
    })) as Loadout[];
  }, [set]);

  const [step, setStep] = useState(0);
  /* Asked once, as the pull asks it: a preference that changes mid-request is
     not worth a subscription. When it is set the spin never starts, so the box
     is one still piece of the set with the line under it, which is the honest
     shape of "this is being opened" without anything moving. */
  const [still] = useState(wantsStillness);
  useEffect(() => {
    if (still || faces.length === 0) return;
    return startSpin(setStep);
  }, [still, faces.length]);

  if (faces.length === 0) return null;
  /* Hidden from a screen reader, all of it. The button beside this already
     says "Opening..." and is the thing that was pressed; a second live region
     saying the same word, over a picture whose whole point is that it is not
     the answer yet, is noise. The gacha's stage is silent for the same reason
     -- its faces carry an empty `alt`. */
  return (
    <div className="chest-spin" aria-hidden="true">
      <Avatar
        loadout={faces[spinFace(step, faces.length)]}
        crop="bust"
        initial="?"
        className={`chest-drop-art${still ? "" : " roll-art-spin"}`}
      />
    </div>
  );
}

/**
 * What came out.
 *
 * **Nothing is equipped automatically.** A chest that silently changed the
 * face somebody had built would be taking something away to give something,
 * and the whole point of the no-duplicates rule is that a chest only ever
 * adds. So the drop is shown, and wearing it is a press.
 *
 * The animation this wants is deliberately not here. The Browser pane cannot
 * composite frames, so anything driven by `requestAnimationFrame` cannot be
 * checked at all (see CLAUDE.md); a CSS transition on this element can be
 * measured by `css.test.ts` instead, which is why the class is on the wrapper
 * and the reveal is a state change rather than a timeline.
 */
function Reveal({
  set,
  result,
  onEquip,
  onDismiss,
}: {
  set: AvatarSet;
  result: ChestOpened;
  onEquip(set: string, drop: string): void;
  onDismiss(): void;
}) {
  // A refusal is not nothing happening. The server can say no to a press this
  // screen believed in -- a balance spent in another tab, a set finished
  // somewhere else, a set the art no longer has -- and the old code returned
  // null here, so the button un-busied and the screen said nothing at all. A
  // press that appears to do nothing is read as a broken button and pressed
  // again, which is the worst thing this particular screen could teach.
  if (!result.drop) return <Refused refusal={result.refusal} onDismiss={onDismiss} />;
  const named = describe(set, result.drop);
  const pool = wardrobeSet(set.id);
  const left = pool ? pool.pool.length - ownedIn(pool, new Set(result.owned)) : 0;

  return (
    <div className="chest-reveal roll-panel" role="status">
      {named.preview && (
        <Avatar
          loadout={named.preview}
          crop="bust"
          initial="?"
          className="chest-drop-art roll-land"
        />
      )}
      {named.swatch && (
        <span className="chest-drop-chip roll-land" style={{ background: named.swatch }} />
      )}

      <p className="chest-drop-name roll-say">{named.name}</p>
      {/* What the drop cost the pool. The number is the point of the screen and
          it was only ever on the card behind the reveal, where it is covered at
          the exact moment somebody wants it. */}
      <p className="chest-drop-note roll-say-late">
        {left === 0
          ? `That was the last of ${set.name}.`
          : `${left} left in ${set.name}.`}
      </p>
      {result.repeat && (
        <p className="chest-drop-note roll-say-late">You already had this one open.</p>
      )}
      {result.granted.length > 0 && (
        <p className="chest-drop-note roll-say-late">
          And the {result.granted.length} pieces {set.name} starts with.
        </p>
      )}

      <div className="chest-drop-acts roll-say-late">
        {named.wearable && (
          <button
            type="button"
            className="primary"
            /* Closing on the way out. The account screen navigates to the
               customiser and this unmounts anyway, but the copy of this
               screen that opens over a room does not go anywhere, and there
               the reveal used to sit on the card afterwards saying "Wear it"
               about a thing already being worn. */
            onClick={() => {
              onEquip(set.id, result.drop!);
              onDismiss();
            }}
          >
            Wear it
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * The server said no.
 *
 * Worth a component rather than a line, because each of these is a different
 * instruction and only one of them is worth retrying. None of them cost
 * anything -- `applyChest` refuses before it charges -- and saying so is the
 * whole job, since somebody who has just watched a button do nothing will
 * assume it took their hundred.
 */
function Refused({
  refusal,
  onDismiss,
}: {
  refusal: ChestOpened["refusal"];
  onDismiss(): void;
}) {
  const said =
    refusal === "too-poor"
      ? "Not enough to spend yet. Nothing was taken."
      : refusal === "complete"
        ? "You already have everything in this set."
        : "That set is not here any more.";

  return (
    /* No `roll-panel` and no stagger. A refusal is not a present and is not
       paced like one: it is the answer to a question, so it arrives at once.
       It used to carry a `chest-reveal-no` class whose only job was to cancel
       three animations this element no longer asks for, so the class went with
       them. */
    <div className="chest-reveal" role="status">
      <p className="chest-drop-name">{said}</p>
      <div className="chest-drop-acts">
        <button type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Turn a drop id back into something a person can look at.
 *
 * The ids are deliberately dumb -- `wardrobeSplit.ts` mints them from slots and
 * part names and the server never learns what they mean -- so this is the one
 * place that reads them back, and it has to cope with an id the current art no
 * longer has. A set can be re-extracted with fewer items while somebody's
 * profile still lists one that went; that is a line of text saying the name is
 * unknown, never a crash on the screen they opened to see a present.
 */
function describe(
  set: AvatarSet,
  drop: string,
): {
  name: string;
  /** Whether "Wear it" is offered. A colour counts: `equipDrop` places one. */
  wearable: boolean;
  preview: Loadout | null;
  swatch: string | null;
} {
  const bare = bareId(drop);
  if (isColourId(drop)) {
    const [slotPart, variantId] = bare.slice(1).split(":");
    const slot = slotPart as Slot;
    const variant = partsIn(set, slot)
      .flatMap((part) => part.variants)
      .find((candidate) => candidate.id === variantId);
    return {
      name: variant ? `${variant.name}, for ${labelOf(set, slot)}` : "A colour",
      wearable: variant !== undefined,
      preview: null,
      swatch: variant?.swatch ?? null,
    };
  }

  const part = partOf(set, bare as PartId);
  if (!part) return { name: "Something new", wearable: false, preview: null, swatch: null };

  const base = starterFor(set);
  return {
    name: `${part.name}, ${labelOf(set, part.slot).toLowerCase()}`,
    wearable: true,
    preview: { ...base, parts: { ...base.parts, [part.slot]: part.id } },
    swatch: null,
  };
}

function labelOf(set: AvatarSet, slot: Slot): string {
  return set.slots.find((spec) => spec.id === slot)?.label ?? slot;
}
