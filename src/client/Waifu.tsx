/**
 * The Polycule: the gacha screen, where experience turns into waifus.
 *
 * A panel under the account chip, beside Chests, Vocabulary, Stats and the
 * customiser, reached the same way they are and for the same reason: the lobby
 * has no socket (see `net.ts`), the account menu is the one place a signed-in
 * player can stand without being in a game, and a roll that could only happen
 * mid-game would be a roll nobody made.
 *
 * **Rolling and claiming are one act.** There is no "keep or discard" step,
 * because there is nothing to discard: the polycule is append-only and the
 * three slots are about display. A confirmation would be asking somebody to
 * approve a thing that has already happened and costs them nothing.
 *
 * The screen is three parts stacked, in the order somebody uses them: the
 * showcase they are building, the button that fills it, and the polycule
 * they are choosing from. The showcase is first deliberately. It is the thing
 * the feature is *for*, and putting the button above it would make this a
 * slot machine with a shelf underneath rather than a shelf with a way of
 * filling it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileView } from "../shared/profile.js";
import { purseOf } from "../shared/chest.js";
import { LANG_POINTS_MULTIPLIER, POINTS_FIRST_GAME_OF_DAY } from "../shared/review.js";
import { ROLL_COST, SHOWCASE_MAX, roster, waifuById, type Waifu } from "../shared/waifu.js";
import {
  fetchCollection,
  mintNonce,
  rollWaifu,
  setShowcase,
  type Rolled,
  type WaifuError,
} from "./waifuApi.js";

interface Props {
  profile: ProfileView | null;
  /** Every id rolled, or null for a browser that has not been told yet. */
  claimed: string[] | null;
  /** Hands back the new list and profile so the app can cache both. */
  onRolled(result: Rolled): void;
  /**
   * The collection arrived from its own read. See `fetchCollection`.
   *
   * The profile is nullable because a read is not obliged to carry one, and a
   * summary that did not arrive must never overwrite the one already on
   * screen: that is exactly how a balance read zero here while the header two
   * rows up still said what it had. Callers store the list either way.
   */
  onCollection(claimed: string[], profile: ProfileView | null): void;
  onShowcase(profile: ProfileView): void;
  onBack(): void;
}

/**
 * What the screen is doing, as one value.
 *
 * A union rather than three booleans, because "rolling and also showing the
 * last pull and also holding an error" is a state this screen must never be
 * in, and the type is the cheapest place to say so. `nonce` rides on `failed`
 * because a retry has to reuse it: see `waifuApi.ts`, where minting a fresh one
 * on retry is named as the way to charge somebody twice.
 */
type Phase =
  | { at: "idle" }
  | { at: "rolling" }
  | { at: "rolled"; result: Rolled }
  | { at: "failed"; nonce: string; error: WaifuError };

export function WaifuGacha({
  profile,
  claimed,
  onRolled,
  onCollection,
  onShowcase,
  onBack,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });

  const spendable = profile?.spendable ?? 0;
  // `purseOf` rather than a comparison, and it is the chest screen's helper on
  // purpose: the two spend one balance, so they have to say the same thing
  // about it in the same units or the second one reads as a different currency.
  const purse = purseOf(spendable, ROLL_COST);
  const affordable = purse.ready > 0;
  const showcase = profile?.showcase ?? [];

  /*
    The collection is its own read, asked for once on arrival. It is not on the
    profile summary for the reason `PLAYER_PATHS.collection` gives: the list
    grows without limit and the summary is pushed after every game. The cache
    is drawn immediately meanwhile, so the grid does not flash empty for
    somebody who has hundreds.
  */
  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await fetchCollection();
      if (live && answer.ok) onCollection(answer.result.claimed, answer.result.profile ?? null);
    })();
    return () => {
      live = false;
    };
    // Once, on arrival. Re-reading on every profile change would re-fetch the
    // list after each roll, which the roll's own response already returned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pull(reuse?: string): Promise<void> {
    if (phase.at === "rolling") return;
    const nonce = reuse ?? mintNonce();
    setPhase({ at: "rolling" });
    const answer = await rollWaifu(nonce);
    if (!answer.ok) {
      setPhase({ at: "failed", nonce, error: answer.error });
      return;
    }
    setPhase({ at: "rolled", result: answer.result });
    onRolled(answer.result);
  }

  async function show(ids: string[]): Promise<void> {
    // Sent, not assumed. The server repairs whatever it is given, so the
    // profile that comes back is the authority on what is actually on show.
    const answer = await setShowcase(ids);
    if (answer.ok) onShowcase(answer.result.profile);
  }

  /** Tap a waifu to put her on show, or tap her again to take her off. */
  function toggle(id: string): void {
    if (showcase.includes(id)) {
      void show(showcase.filter((one) => one !== id));
      return;
    }
    // Full means the oldest slot gives way, rather than the press doing
    // nothing. A tap that appears to be ignored is read as a broken control,
    // and the alternative -- making somebody empty a slot first -- is two
    // presses for the one thing everybody wants to do.
    const next = showcase.length >= SHOWCASE_MAX ? showcase.slice(1) : showcase;
    void show([...next, id]);
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

  /*
    Newest first, and deduplicated for display only.

    The stored list keeps every pull including repeats, because that is a true
    record of what somebody spent. A grid that drew the same face four times
    would be reporting the ledger rather than the collection, so the count
    rides on the tile instead.
  */
  const collection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of claimed ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
      .reverse()
      .flatMap(([id, times]) => {
        const one = waifuById(id);
        // An id the roster no longer has. The ingest script can be rerun with
        // a different depth while somebody's collection still names her, and
        // that is a tile quietly left out rather than a crash on the screen
        // they opened to look at their favourites.
        return one ? [{ one, times }] : [];
      });
  }, [claimed]);

  return (
    <section className="waifu" aria-label="The Polycule">
      <header className="waifu-head">
        <h2 ref={heading} tabIndex={-1}>
          The Polycule
        </h2>
        {/* The balance and what it buys, on one line and in that order, which
            is the shape the chest screen settled on: a total on its own is
            never the number somebody is after, and the number they are after
            is how far off the next one is. */}
        <p className="waifu-balance">
          <b>{spendable.toLocaleString()}</b> GP
          <span className="waifu-worth">
            {purse.ready > 0
              ? ` = ${purse.ready} ${purse.ready === 1 ? "roll" : "rolls"}`
              : `, ${purse.toNext} to your next roll`}
          </span>
        </p>
        {/* The rule, said once. It claimed to be word for word what the chest
            screen says, on the grounds that it is the same balance, and it had
            not been for two versions: it was still describing the pre-v7 rule
            where English bought nothing and points came per *word*. Points come
            per finished game, every game pays, and a language game pays five
            times more -- so the old copy was telling anybody who reached this
            screen through the account menu that half their evening had earned
            nothing. Now it is actually the same three facts, from the same
            three constants. */}
        <p className="waifu-rule">
          Every game you finish earns GP, and your first game each day earns{" "}
          {POINTS_FIRST_GAME_OF_DAY}. A game in a language you are learning pays{" "}
          {LANG_POINTS_MULTIPLIER}x. {ROLL_COST} GP pulls one waifu, out of the
          same GP chests cost.
        </p>
      </header>

      <Showcase showcase={showcase} onRemove={(id) => void show(showcase.filter((one) => one !== id))} />

      <div className="waifu-act">
        <button
          type="button"
          className="primary waifu-roll"
          disabled={!affordable || phase.at === "rolling"}
          onClick={() => void pull()}
        >
          {phase.at === "rolling" ? "Rolling..." : `Roll, ${ROLL_COST}`}
        </button>
      </div>

      {phase.at === "rolled" && (
        <Pulled
          result={phase.result}
          showing={showcase.includes(phase.result.pulled?.id ?? "")}
          full={showcase.length >= SHOWCASE_MAX}
          onShow={() => phase.result.pulled && toggle(phase.result.pulled.id)}
          onDismiss={() => setPhase({ at: "idle" })}
        />
      )}

      {phase.at === "failed" && (
        <p className="waifu-error" role="status">
          {phase.error === "no-account"
            ? "You need an account for this. Make one from the menu."
            : phase.error === "offline"
              ? "That did not reach the server."
              : "That did not work."}{" "}
          {phase.error !== "no-account" && (
            <button type="button" className="waifu-retry" onClick={() => void pull(phase.nonce)}>
              Try again
            </button>
          )}
        </p>
      )}

      <h3 className="waifu-sub">
        {collection.length > 0
          ? `Yours, ${collection.length} of ${roster().length}`
          : `${roster().length} waifus waiting`}
      </h3>

      {collection.length === 0 ? (
        <p className="waifu-empty">
          Roll to pull your first waifu. Everyone you pull is yours for keeps;
          the three above are just the ones you are showing off.
        </p>
      ) : (
        <ul className="waifu-grid">
          {collection.map(({ one, times }) => (
            <li key={one.id}>
              <Tile
                one={one}
                times={times}
                showing={showcase.includes(one.id)}
                onPress={() => toggle(one.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="prof-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

/**
 * The three slots.
 *
 * Empty slots are drawn rather than hidden, because the gap is the message:
 * three outlines say "there are three of these and you have one" without a
 * sentence, and a showcase that grew as it filled would never say it at all.
 */
function Showcase({
  showcase,
  onRemove,
}: {
  showcase: string[];
  onRemove(id: string): void;
}) {
  const slots = Array.from({ length: SHOWCASE_MAX }, (_, at) => showcase[at] ?? null);

  return (
    <ol className="waifu-showcase" aria-label={`Showcase, ${showcase.length} of ${SHOWCASE_MAX}`}>
      {slots.map((id, at) => {
        const one = id ? waifuById(id) : undefined;
        return (
          <li key={id ?? `empty-${at}`} className="waifu-slot">
            {one ? (
              <button
                type="button"
                className="waifu-slot-full"
                onClick={() => onRemove(one.id)}
                aria-label={`${one.name}, on show. Take her off.`}
              >
                <Portrait one={one} />
                <span className="waifu-slot-name">{one.name}</span>
              </button>
            ) : (
              <span className="waifu-slot-empty" aria-label="An empty slot">
                <span aria-hidden="true">+</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What came out.
 *
 * **Nothing goes on show automatically.** A roll that silently replaced one of
 * the three would be taking something away to give something, and the whole
 * shape of this feature is that a roll only ever adds. So the pull is shown,
 * and showing her is a press.
 *
 * The animation this wants is deliberately not here. The Browser pane cannot
 * composite frames, so anything driven by `requestAnimationFrame` cannot be
 * checked at all (see CLAUDE.md); a CSS transition on this element can be
 * measured by `css.test.ts` instead, which is why the class is on the wrapper
 * and the reveal is a state change rather than a timeline.
 */
function Pulled({
  result,
  showing,
  full,
  onShow,
  onDismiss,
}: {
  result: Rolled;
  showing: boolean;
  full: boolean;
  onShow(): void;
  onDismiss(): void;
}) {
  // A refusal is not nothing happening. The server can say no to a press this
  // screen believed in, most often a balance spent in another tab, and a press
  // that appears to do nothing is read as a broken button and pressed again.
  if (!result.pulled) {
    return (
      <div className="waifu-reveal waifu-reveal-no" role="status">
        <p className="waifu-pull-name">
          {result.refusal === "too-poor"
            ? "Not enough to spend yet. Nothing was taken."
            : "There is nobody to roll for right now."}
        </p>
        <div className="waifu-pull-acts">
          <button type="button" onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="waifu-reveal" role="status">
      <Portrait one={result.pulled} />
      <p className="waifu-pull-name">{result.pulled.name}</p>
      <p className="waifu-pull-series">{result.pulled.series}</p>

      {/* What it cost, said on the screen where it was spent. A duplicate that
          quietly charged less would be a kindness nobody noticed. */}
      {result.duplicate && (
        <p className="waifu-pull-note">
          Already yours, so she cost {result.paid} GP instead of {ROLL_COST}.
        </p>
      )}
      {result.repeat && <p className="waifu-pull-note">You had already rolled this one.</p>}

      <div className="waifu-pull-acts">
        <button type="button" className="primary" onClick={onShow}>
          {showing ? "Take her off" : full ? "Show her instead" : "Put her on show"}
        </button>
        <button type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * One waifu in the grid.
 *
 * The whole tile is the button rather than a button beside a picture, because
 * the thing somebody wants to press is the face. `aria-pressed` carries the
 * on-show state, which is what it is: a toggle rather than a link.
 */
function Tile({
  one,
  times,
  showing,
  onPress,
}: {
  one: Waifu;
  times: number;
  showing: boolean;
  onPress(): void;
}) {
  return (
    <button
      type="button"
      className={`waifu-tile${showing ? " waifu-tile-on" : ""}`}
      aria-pressed={showing}
      onClick={onPress}
    >
      <Portrait one={one} />
      <span className="waifu-tile-name">{one.name}</span>
      <span className="waifu-tile-series">{one.series}</span>
      {times > 1 && (
        <span className="waifu-tile-times" aria-label={`Rolled ${times} times`}>
          x{times}
        </span>
      )}
    </button>
  );
}

/**
 * The picture, and the one place the art is fetched.
 *
 * `image` is an absolute URL on the source's CDN rather than a file in this
 * repo. See `scripts/build-waifu.ts` for why that is deliberate, and change
 * this function and that script together if the art is ever mirrored locally.
 *
 * Lazy, because a collection runs to a screenful of faces and none of them is
 * the reason anybody opened the app. `alt` is empty and the name is beside it
 * as text: a screen reader announcing "Emilia" twice is worse than a picture
 * announced as decorative next to its own caption.
 */
function Portrait({ one }: { one: Waifu }) {
  return (
    <img className="waifu-art" src={one.image} alt="" loading="lazy" decoding="async" />
  );
}
