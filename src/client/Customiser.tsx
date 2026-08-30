/**
 * The customiser: pick a part per slot and watch the character assemble.
 *
 * A screen under the account chip, like Vocabulary and Stats and for the same
 * reason -- it is several blocks and a grid that grows, and opened in place it
 * would put the rest of the menu below the fold on a phone.
 *
 * **Locked items stay visible.** That is the whole motivational mechanic and it
 * is the one thing here not to tidy away: seeing what you have not earned is
 * the point, and a wardrobe that only showed what you already had would be a
 * settings screen.
 *
 * What a locked item *costs* is deliberately not written on it. Unlocks come
 * out of gacha chests, so a line saying "60 XP in one language" would be
 * promising a route that no longer exists. The dashed edge says "not yet" and
 * that is the whole of the message this screen is allowed to carry.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileView } from "../shared/profile.js";
import { Avatar, SetCover } from "./avatar/Avatar.js";
import { colourKeyOf, partOf, partsIn, SETS, starterFor } from "./avatar/manifest.js";
import { ownsPart, ownsSet, ownsVariant, wardrobeOf } from "./avatar/unlock.js";
import type { AvatarSet, Loadout, PartId, Slot, Variant } from "./avatar/types.js";

interface Props {
  profile: ProfileView | null;
  /**
   * Every id a chest has handed over. Null while the answer is still coming.
   *
   * Null draws the same as an empty wardrobe, which is the right way round:
   * showing everything locked and then unlocking is a screen settling down,
   * and showing everything unlocked and then taking it away is a screen that
   * lied.
   */
  owned: string[] | null;
  loadout: Loadout;
  onChange(loadout: Loadout): void;
  onBack(): void;
  /** Leads to the chest screen, with this set already chosen. */
  onOpenChests(set: string): void;
}

export function Customiser({ owned, loadout, onChange, onBack, onOpenChests }: Props) {
  const wardrobe = useMemo(() => wardrobeOf(owned), [owned]);
  const set = SETS.find((candidate) => candidate.id === loadout.set) ?? SETS[0];
  const [tab, setTab] = useState<Slot>(set.slots[0].id);

  const slot = set.slots.find((spec) => spec.id === tab) ?? set.slots[0];
  const items = partsIn(set, slot.id);
  const chosen = loadout.parts[slot.id];
  const variants = partOf(set, chosen)?.variants ?? [];
  const painted = loadout.variants[colourKeyOf(slot)] ?? slot.fallback ?? "#000000";

  const equip = (id: PartId | undefined) => {
    onChange({ ...loadout, parts: { ...loadout.parts, [slot.id]: id } });
  };

  /**
   * A shade picked from the art's own list, stored against the slot that owns it.
   *
   * Same indirection as `paint` below and for the same reason: makowka draws
   * the head, the face and the ears as three tabs sharing one skin palette, so
   * all three write `body`. Writing the tab's own slot instead shipped a face
   * one shade off the neck under it, which is exactly the bug `colourKey`
   * exists to stop and which the free picker was already safe from.
   */
  const recolour = (variant: Variant) => {
    onChange({ ...loadout, variants: { ...loadout.variants, [colourKeyOf(slot)]: variant.id } });
  };

  /**
   * A colour a picker chose, stored against the slot that owns it.
   *
   * `colourKey` is the whole of the indirection: the fringe tab and the back
   * hair tab both write `hair`, because three hair depths are one head of
   * hair and nobody wants to discover that on the third tab. See `SlotSpec`.
   */
  const paint = (hex: string) => {
    onChange({ ...loadout, variants: { ...loadout.variants, [colourKeyOf(slot)]: hex } });
  };

  const switchTo = (next: AvatarSet) => {
    const fresh = starterFor(next);
    onChange(fresh);
    setTab(next.slots[0].id);
  };

  /*
    The screen takes focus on arrival, as `Profile`, `Stats` and `Vocabulary`
    do. The row that opened this is unmounted by the press, so without it focus
    falls to `<body>` and the next Tab starts at the top of the document --
    which, on a page drawn over the whole lobby, is a silent jump to controls
    nobody can see.
  */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="panel prof prof-page cust" aria-labelledby="cust-head">
      <h2 id="cust-head" ref={heading} tabIndex={-1}>
        Your character
      </h2>

      <div className="cust-figure">
        <Avatar loadout={loadout} crop="full" initial="?" className="cust-full" />
      </div>

      <div className="cust-sets" role="group" aria-label="Sets">
        {SETS.map((candidate) => {
          const open = ownsSet(candidate.id, wardrobe);
          const current = candidate.id === set.id;
          return (
            <button
              key={candidate.id}
              type="button"
              className="cust-set"
              /* It stopped being disabled when it became a way in, and the
                 dashed border that said "not yet" went with it, so an unowned
                 set has been drawn as an owned one ever since. See
                 `avatar.css`: the styling is keyed to this now. */
              data-locked={open ? undefined : "yes"}
              aria-pressed={current}
              /* A locked set is not disabled any more, it is a way in. Under
                 thresholds there was nothing to press it for; now one chest
                 hands over the whole floor, so the button that used to be
                 greyed out is the button that starts the set. */
              onClick={() => (open ? switchTo(candidate) : onOpenChests(candidate.id))}
              title={open ? candidate.name : `${candidate.name}, open a chest to start it`}
            >
              <SetCover set={candidate} className="cust-thumb" />
              <span className="cust-set-name">{candidate.name}</span>
              <span className="cust-set-by">by {candidate.artist}</span>
            </button>
          );
        })}
      </div>

      <div className="cust-tabs" role="tablist" aria-label="Parts">
        {set.slots.map((spec) => (
          <button
            key={spec.id}
            type="button"
            role="tab"
            className="cust-tab"
            aria-selected={spec.id === slot.id}
            onClick={() => setTab(spec.id)}
          >
            {spec.label}
          </button>
        ))}
      </div>

      {/* Two kinds of colour control, and which one a slot gets is the art's
          decision rather than this screen's. A set that ships five hair
          colours as five files can only offer five; a set drawn as a grey
          mask can offer any, and pretending otherwise would throw away the
          reason that art was worth wiring up. See `SlotSpec.colour`. */}
      {slot.colour === "free" && (
        <div className="cust-swatches" role="group" aria-label="Colour">
          {(slot.swatches ?? []).map((hex) => (
            <button
              key={hex}
              type="button"
              className="cust-swatch"
              aria-pressed={hex.toLowerCase() === painted.toLowerCase()}
              onClick={() => paint(hex)}
            >
              <span className="cust-chip" style={{ background: hex }} />
              <span className="sr-only">{hex}</span>
            </button>
          ))}
          {/* The picker itself, last, because it is the escape hatch and not
              the offer. A native colour input: it is already the right thing
              on a phone, on a desktop and from a keyboard, and a hand rolled
              wheel would be none of the three. */}
          <label className="cust-swatch cust-any">
            <span className="cust-chip" style={{ background: painted }} />
            <span className="sr-only">Any colour</span>
            <input type="color" value={painted} onChange={(event) => paint(event.target.value)} />
          </label>
        </div>
      )}

      {/*
        Locked is a way in, in here as well.

        The set buttons at the top of this screen stopped being disabled when
        one chest started handing over a whole set's floor: there was suddenly
        something to press them *for*. The two grids below them did not follow,
        so the screen ended up saying two different things about the same word
        -- a locked set was a door and a locked hair clip was a dead end -- and
        the dead ends are the ninety per cent. Somebody looking at the one item
        they want has no way from it to the thing that sells it.

        So both grids route a locked press to the chest screen, led with this
        set. `aria-pressed` comes off with the lock, because a locked control
        is not a toggle in some other state, it is a different control: it goes
        somewhere. The title says which.
      */}
      {slot.colour !== "free" && variants.length > 0 && (
        <div className="cust-swatches" role="group" aria-label="Colour">
          {variants.map((variant) => {
            const has = ownsVariant(set.id, colourKeyOf(slot), variant, wardrobe);
            const current = (loadout.variants[colourKeyOf(slot)] ?? variants[0].id) === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                className="cust-swatch"
                data-locked={has ? undefined : "yes"}
                aria-pressed={has ? current : undefined}
                onClick={() => (has ? recolour(variant) : onOpenChests(set.id))}
                title={has ? variant.name : `${variant.name}, locked. Open a chest for it.`}
              >
                {/* The one hex in this feature, and it is a picture of the art
                    rather than chrome. See the note on `Variant`. */}
                <span className="cust-chip" style={{ background: variant.swatch }} />
                <span className="sr-only">
                  {has ? variant.name : `${variant.name}, locked. Open a chest for it.`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="cust-grid">
        {slot.optional && (
          <button
            type="button"
            className="cust-item"
            aria-pressed={chosen === undefined}
            onClick={() => equip(undefined)}
          >
            <Avatar
              loadout={{ ...loadout, parts: { ...loadout.parts, [slot.id]: undefined } }}
              crop="bust"
              initial="?"
              className="cust-thumb"
            />
            <span className="cust-item-name">None</span>
          </button>
        )}
        {items.map((part) => {
          const has = ownsPart(set.id, part, wardrobe);
          return (
            <button
              key={part.id}
              type="button"
              className="cust-item"
              data-locked={has ? undefined : "yes"}
              aria-pressed={has ? (part.id === chosen) : undefined}
              onClick={() => (has ? equip(part.id) : onOpenChests(set.id))}
              /* The swatches above have said "locked" out loud since they were
                 written; these did not, so the grid that is half the point of
                 this screen -- see the note at the top on seeing what you have
                 not earned -- read out as forty five names with nothing to
                 tell them apart. Greying out is not a label. */
              title={has ? part.name : `${part.name}, locked. Open a chest for it.`}
            >
              {/* The thumbnail is the rest of the loadout with this one part
                  swapped in, rather than the part on its own. A fringe drawn
                  against nothing is unreadable, and the question somebody is
                  actually asking is what it looks like on the character they
                  have already built. */}
              <Avatar
                loadout={{ ...loadout, parts: { ...loadout.parts, [slot.id]: part.id } }}
                crop="bust"
                initial="?"
                className="cust-thumb"
              />
              <span className="cust-item-name" aria-hidden="true">
                {part.name}
              </span>
              <span className="sr-only">
                {has ? part.name : `${part.name}, locked. Open a chest for it.`}
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="prof-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}


