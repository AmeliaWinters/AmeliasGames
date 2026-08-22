/**
 * The contract every game implements. Pure functions only: no I/O, no
 * randomness that isn't passed in, no framework imports. This is what makes
 * the rules testable in milliseconds and runnable on both client and server.
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

  /**
   * `now` is epoch milliseconds, supplied for the same reason `rng` is: a game
   * on a clock has to stamp its deadline, and reading one itself would make
   * `setup` untestable. Untimed games ignore it, which is most of them.
   */
  setup(playerCount: number, rng: Rng, now?: number): S;

  /**
   * Validate and apply a move made by `seat`. Never mutates `state`.
   *
   * `rng` only ever runs on the server: the client renders the state it is
   * sent and never applies moves locally, so dice cannot be re-rolled by a
   * player until they like the result.
   *
   * `now` is there so a timed game can refuse a move that arrives after the
   * whistle. The server's clock is the only one that counts — a client's may
   * be wrong or lying.
   */
  applyMove(state: S, move: M, seat: number, rng: Rng, now?: number): MoveResult<S>;

  /** Seat whose turn it is, or null if the game is over. */
  turn(state: S): number | null;

  isOver(state: S): boolean;

  /** One-line human-readable status, e.g. "Amelia's turn". */
  status(state: S, names: string[]): string;

  /**
   * Redact state before sending it to `seat`. Identity for open-information
   * games; this is the hook that makes hidden-hand games (Hearts) possible
   * without leaking cards to the wrong client.
   */
  view?(state: S, seat: number): S;


  /**
   * Start a timed game's clock, or null if there is nothing to start.
   *
   * Called by the room the moment every seat is filled, because that is when
   * play can actually begin — the room turns moves away until then, so a clock
   * started when the room was *opened* would run down while the second player
   * was still reading the invite.
   *
   * Must be idempotent: a player reconnecting fills the room again, and that
   * is not a reason to hand everybody a fresh two minutes.
   */
  start?(state: S, now: number): S | null;

  /**
   * When this game must be settled by, in epoch milliseconds, or null if it is
   * not on a clock.
   *
   * The room reads this to arm a timer, so a timed game ends on time even if
   * every player has wandered off — which is the whole point of a timer, and
   * something no amount of client-side counting can promise.
   */
  deadline?(state: S): number | null;

  /**
   * Settle a game whose clock has run out, or null if there was nothing to
   * settle. Called by the room when a deadline passes, and again before any
   * move that arrives late.
   *
   * Separate from `applyMove` because nobody made this move: it is the clock
   * that ended the game, and there may well be no one connected to blame.
   */
  expire?(state: S, now: number): S | null;
}
