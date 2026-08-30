import { describe, expect, it } from "vitest";
import { isDeal, isTurnNotice, type RoomPulse } from "./notify.js";

/**
 * The half of the turn notification that does not need a browser.
 *
 * Everything expensive about this feature -- the worker, the permission, the
 * shade -- is untestable here and uninteresting anyway. What is interesting is
 * *when* it fires, and the two ways it can be wrong are both quiet: a
 * notification for a turn the player is already looking at, and a pile of
 * notifications for a game they have just rejoined.
 */
const pulse = (over: Partial<RoomPulse> = {}): RoomPulse => ({
  code: "ABCD",
  waiting: false,
  over: false,
  canAct: false,
  ...over,
});

describe("isTurnNotice", () => {
  it("fires when the seat gains the move while the page is hidden", () => {
    expect(isTurnNotice(pulse(), pulse({ canAct: true }), true)).toBe(true);
  });

  it("says nothing while the table is on screen", () => {
    expect(isTurnNotice(pulse(), pulse({ canAct: true }), false)).toBe(false);
  });

  it("says nothing on the first view of a room", () => {
    // The rejoin case: the first view of a room describes everything that has
    // already happened in it, including that it is your turn, and announcing
    // that is not a reminder, it is a surprise about nothing.
    expect(isTurnNotice(null, pulse({ canAct: true }), true)).toBe(false);
  });

  it("treats a different room as a first view", () => {
    expect(isTurnNotice(pulse({ code: "WXYZ" }), pulse({ canAct: true }), true)).toBe(false);
  });

  it("does not repeat itself while the turn is still yours", () => {
    // Every move by anyone at the table pushes a fresh view. A turn that is
    // still yours is not news twice.
    expect(isTurnNotice(pulse({ canAct: true }), pulse({ canAct: true }), true)).toBe(false);
  });

  it("stays quiet in a room that has not been dealt", () => {
    // `canAct` is false all through the lobby, so this only guards against a
    // future server answering it true before the deal. Cheap insurance on a
    // field two other layers already trust.
    const lobby = pulse({ waiting: true });
    expect(isTurnNotice(lobby, pulse({ waiting: true, canAct: true }), true)).toBe(false);
  });

  it("stays quiet once the game is over", () => {
    expect(isTurnNotice(pulse(), pulse({ over: true, canAct: true }), true)).toBe(false);
  });
});

describe("isDeal", () => {
  it("is the moment waiting stops, and only that moment", () => {
    expect(isDeal(pulse({ waiting: true }), pulse())).toBe(true);
    expect(isDeal(pulse(), pulse())).toBe(false);
    // Not on arriving into a game already in progress: nobody pressed
    // anything, so there is no gesture to spend a permission prompt on.
    expect(isDeal(null, pulse())).toBe(false);
    expect(isDeal(pulse({ code: "WXYZ", waiting: true }), pulse())).toBe(false);
  });
});
