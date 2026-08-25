/**
 * The contract every game implements. Pure functions only: no I/O, no
 * randomness that isn't passed in, no framework imports. That is what makes
 * the rules testable in milliseconds and runnable on both client and server.
 *
 * ## The display-module boundary
 *
 * Each game splits its constants, state shape and pure predicates into a
 * `*Display.ts` leaf that the board imports instead of the reducer. The rule
 * is not "no imports" but *nothing that reaches a reducer*; type-only imports
 * are erased and are fine. Taking the reducer would drag `applyMove`, the
 * registry and any dictionary behind it into the client bundle, and
 * `bundle.test.ts` fails the build over it. Each reducer re-exports its
 * display module, so rules and tests still name a game from one place.
 *
 * Every display module says only why *its* game needs the split beyond that.
 */

/** Returns a float in [0, 1), like Math.random. Injectable so tests are exact. */
export type Rng = () => number;

export type MoveResult<S> =
  | { ok: true; state: S }
  | { ok: false; error: string };

export interface GameDefinition<S = unknown, M = unknown> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;

  /** `now` is injected for the reason `rng` is: reading a clock here would make
   * `setup` untestable. Most games ignore it. */
  setup(playerCount: number, rng: Rng, now?: number): S;

  /**
   * Validate and apply a move by `seat`. Never mutates `state`.
   *
   * `rng` runs only on the server, so dice cannot be re-rolled until a player
   * likes the result. `now` lets a timed game refuse a late move, since a
   * client's clock may be wrong or lying.
   */
  applyMove(state: S, move: M, seat: number, rng: Rng, now?: number): MoveResult<S>;

  /**
   * A hint for the status line, nothing more. It assumes one active seat,
   * which four games here are not (Word Duel, Word Hunt and Battleships'
   * placing phase are free-simultaneous), and those answer with whoever the
   * game is most obviously waiting on.
   *
   * **Never gate a control on this.** `canAct` is the question the UI means.
   */
  turn(state: S): number | null;

  /**
   * Whether `seat` may move right now, the one predicate a board gates on.
   * On the contract rather than derived from `turn` because for a
   * free-simultaneous game `turn` is a guess and this is the answer;
   * alternating games implement it as exactly `turn(state) === seat`.
   *
   * Not a permission check: `applyMove` re-decides and its answer counts. This
   * is what the *player* is shown, so the greyed-out control and the refused
   * move can no longer disagree.
   */
  canAct(state: S, seat: number, now?: number): boolean;

  isOver(state: S): boolean;

  /** One-line human-readable status, e.g. "Amelia's turn". */
  status(state: S, names: string[]): string;

  /** Redact before sending to `seat`. Identity for open games; the hook that
   * keeps hidden-hand games from leaking to the wrong client. */
  view?(state: S, seat: number): S;


  /**
   * Start a timed game's clock, or null if there is nothing to start. Called
   * when the last seat fills, not when the room opens, or the clock runs down
   * while the second player is still reading the invite. Must be idempotent:
   * a reconnect refills the room and must not hand out fresh time.
   */
  start?(state: S, now: number): S | null;

  /**
   * Epoch ms this game must be settled by, or null if untimed. The room arms a
   * timer on it, so a timed game ends on time even if everyone wandered off,
   * which no amount of client-side counting can promise.
   */
  deadline?(state: S): number | null;

  /**
   * Settle a game whose clock ran out, or null if there was nothing to settle.
   * Separate from `applyMove` because nobody made this move: the clock ended
   * it, and there may be no one connected at all.
   */
  expire?(state: S, now: number): S | null;
}
