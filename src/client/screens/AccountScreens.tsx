/**
 * The account's own pages: the words, the stats, the customiser, the shop, the
 * gacha, and the menu that lists them.
 *
 * These were an early return inside `Setup`, and the return was the seam: the
 * setup page below it and the screens in here share the bar and almost nothing
 * else. What each half touched says so. The wardrobe, the collection and which
 * set the shop leads with are read in this file and nowhere else, so they are
 * held here rather than passed in, and what does cross the boundary is what
 * the bar itself draws: who you are, what you are wearing, what you have
 * earned.
 *
 * No socket, on purpose. Every screen behind the chip has to work from the
 * lobby, where there is no room and no connection, so the caches are the
 * source and `/account/*` over plain HTTP is the only network. See `Chests.tsx`.
 */

import { useState } from "react";
import type { ProfileView } from "../../shared/profile.js";
import type { Screen } from "../route.js";
import { Profile } from "../Profile.js";
import { Vocabulary } from "../Vocabulary.js";
import { Stats } from "../Stats.js";
import { Customiser } from "../Customiser.js";
import { Chests } from "../Chests.js";
import { WaifuGacha } from "../Waifu.js";
import type { ChestOpened } from "../chestApi.js";
import type { Rolled } from "../waifuApi.js";
import { loadCollection, saveCollection } from "../waifuCache.js";
import { loadWardrobe, saveWardrobe } from "../wardrobeCache.js";
import type { Loadout } from "../avatar/types.js";
import { saveAvatar, starter } from "../avatar/store.js";
import { equipDrop } from "../avatar/equip.js";
import type { Toasts } from "../toast.js";

export function AccountScreens({
  screen,
  profile,
  onToast,
  onProfile,
  avatar,
  onAvatar,
  name,
  onName,
  onOpenScreen,
  onBack,
  onLeave,
  onChanged,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
}: {
  /** Which screen the address bar is on. Never null: the caller only draws
      this file when there is one. */
  screen: Screen;
  profile: ProfileView | null;
  /** Raise a transient message. See `App`: one stack, above every screen. */
  onToast: Toasts["push"];
  onProfile(next: ProfileView): void;
  avatar: Loadout | null;
  onAvatar(next: Loadout): void;
  name: string;
  onName(next: string): void;
  onOpenScreen(to: Screen): void;
  /** Up one screen. */
  onBack(): void;
  /** Out of the account entirely, from however deep in. */
  onLeave(): void;
  /** A key was made, pasted or dropped: re-read what this browser has. */
  onChanged(): void;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
}) {
  /*
    What the account owns, and which chest card to lead with.

    Read from the cache rather than fetched on mount, because the lobby has no
    socket and this screen must draw with no network at all. It is refreshed by
    the one act that changes it: every `/account/chest` response carries the
    whole list back, so nothing here polls. The cost is a wardrobe opened on
    another device not showing until the next chest, which understates rather
    than overstates and is the right way for this to be wrong.
  */
  const [owned, setOwned] = useState<string[] | null>(loadWardrobe);
  /* Which set the customiser sent them to buy for, or null for the plain menu. */
  const [chestFocus, setChestFocus] = useState<string | null>(null);
  /*
    Every character rolled. The same bargain as `owned` one paragraph up, and
    the same fallback: `/account/waifu` carries the whole list back, so the act
    that changes it is the act that refreshes it. Unlike the wardrobe it also
    has its own read, because a collection is unbounded and cannot ride on the
    profile summary; the screen asks once on arrival. See `waifuCache.ts`.
  */
  const [claimed, setClaimed] = useState<string[] | null>(loadCollection);

  return (
    <main className="app acct-page">
      {/* The way out of the page, as opposed to the way back up it.

          Every screen in here already has a Back at the foot of it, and it
          means one step up: the customiser, for chests opened from it. Out
          is a different act and it is the one somebody wants from anywhere
          on a long scroll, so it is pinned at the top and stays there. It
          navigates, the same number of entries it came in through, because
          the browser's own Back is the other way out and the two must not
          leave the address bar disagreeing with the page. */}
      <button type="button" className="acct-close" onClick={onLeave}>
        <span aria-hidden="true">✕</span>
        <span className="sr-only">Back to the games</span>
      </button>
      <div className="acct-sheet">
        {/* A screen rather than a drawer, so it replaces the profile panel
            instead of growing underneath it. Back returns to the panel it
            was opened from, which is the only place it can have come from.

            No socket here -- the lobby has none -- so `live` and `onRequest`
            are both absent and the screen draws the stored copy and says so.
            See `vocabCache.ts`. */}
        {screen === "vocab" && (
          <Vocabulary profile={profile} onBack={onBack} />
        )}

        {/* Same bargain as Vocabulary: a screen under the same chip rather
            than a drawer inside the menu, so a record that grows without
            limit cannot push the rest of the menu off a phone. Cached like
            everything else the lobby draws. */}
        {screen === "stats" && (
          <Stats profile={profile} onBack={onBack} />
        )}

        {/* Same bargain again. It is a figure, a set of tabs and a grid that
            runs to forty five items in one of them, which is a screen rather
            than a drawer. */}
        {screen === "avatar" && (
          <Customiser
            profile={profile}
            owned={owned}
            loadout={avatar ?? starter()}
            onChange={(chosen) => {
              onAvatar(chosen);
              saveAvatar(chosen);
            }}
            onBack={onBack}
            onOpenChests={(set) => {
              setChestFocus(set);
              onOpenScreen("chests");
            }}
          />
        )}

        {/* Same bargain as the customiser, and it sits next to it on
            purpose: one screen shows what you have and the other is where
            the rest comes from. It works here, with no socket, because
            `/account/chest` is plain HTTP. See `Chests.tsx`. */}
        {screen === "chests" && (
          <Chests
            profile={profile}
            owned={owned}
            focus={chestFocus}
            onOpened={(result: ChestOpened) => {
              // The response carries the whole owned list and a fresh
              // summary, so opening a chest is also the moment both caches
              // are refreshed. Nothing else has to ask.
              setOwned(result.owned);
              saveWardrobe(result.owned);
              onProfile(result.profile);
            }}
            onEquip={(set: string, drop: string) => {
              // "Wear it" has to actually wear it. Equipping happens here
              // rather than in the chest screen because the loadout is this
              // component's state, and the drop may belong to a set the
              // player is not currently in -- which is the ordinary case,
              // since the chest that hands over a set's floor is the first
              // one they open in it.
              const worn = equipDrop(avatar ?? starter(), set, drop);
              if (worn) {
                onAvatar(worn);
                saveAvatar(worn);
              }
              // Said out loud, both ways. The press used to change the
              // loadout and navigate, and that was the entire report: the
              // customiser opens on a figure that looks much as it did, so
              // somebody who pressed Wear it had no way to tell whether it
              // had worked. The refusal was worse -- `equipDrop` returns
              // null for a drop this art no longer has, and that case took
              // you to the customiser and changed nothing at all.
              onToast(
                worn
                  ? "You are wearing it now."
                  : "That one cannot be worn any more.",
                null,
                worn ? "success" : "warn",
              );
              onOpenScreen("avatar");
            }}
            /* Up one, and the history is what knows where that is. The
               round trip out of the customiser -- go and buy for this set,
               come back and wear it -- used to be reconstructed from
               `chestFocus`, which meant a chest opened from the bar and one
               opened from the customiser were told apart by which set was
               being led with. */
            onBack={onBack}
            /* The gacha, as a card in the grid. See `Chests.tsx`: the roll
               spends the same balance as a chest, so hiding it behind a menu
               row made the shop look like it sold one thing. */
            claimed={claimed}
            onOpenWaifu={() => onOpenScreen("waifu")}
            /* The roll happens in a dialog over the shop now, so the shop
               is a second place a pull can land. Same caches, same reason:
               the response carries the whole list and a fresh summary. */
            onRolled={(result: Rolled) => {
              setClaimed(result.claimed);
              saveCollection(result.claimed);
              onProfile(result.profile);
            }}
          />
        )}

        {/* Beside the chests rather than under them, because they spend one
            balance: the two screens are the two things experience buys, and
            a player choosing between them has to be able to see both from
            the same menu. Works here with no socket for the same reason the
            chests do. See `Waifu.tsx`. */}
        {screen === "waifu" && (
          <WaifuGacha
            profile={profile}
            claimed={claimed}
            onRolled={(result: Rolled) => {
              // The response carries the whole claimed list and a fresh
              // summary, so a roll is also the moment both caches are
              // refreshed. Nothing else has to ask.
              setClaimed(result.claimed);
              saveCollection(result.claimed);
              onProfile(result.profile);
            }}
            onCollection={(list, view) => {
              setClaimed(list);
              saveCollection(list);
              // Only when there is one. A read that answered with the ids
              // alone must not blank the balance the header is drawing.
              if (view) onProfile(view);
            }}
            // The showcase is the server's answer rather than the press, so
            // the profile that comes back is what the screen redraws from.
            onShowcase={onProfile}
            onBack={onBack}
          />
        )}

        {/* The menu, as a page, and it is the one thing on this route that
            is not the way in.

            Pressing the chip drops the menu under it now, so nothing in the
            app navigates here. What does arrive here is somebody who typed
            `/account`, followed a link to it, or came back to a bookmark --
            and they have to land on something. It is the same component the
            dropdown draws, so there is one menu with two frames rather than
            two menus. */}
        {screen === "profile" && (
          <Profile
            profile={profile}
            onOpenVocab={() => onOpenScreen("vocab")}
            onOpenStats={() => onOpenScreen("stats")}
            onOpenAvatar={() => onOpenScreen("avatar")}
            onOpenWaifu={() => onOpenScreen("waifu")}
            avatar={avatar}
            name={name}
            onName={onName}
            onChanged={onChanged}
            swapLabel={swapLabel}
            onSwapPalette={onSwapPalette}
            sound={sound}
            onToggleSound={onToggleSound}
          />
        )}
      </div>
    </main>
  );
}
