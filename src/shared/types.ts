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

  setup(playerCount: number, rng: Rng): S;

  /**
   * Validate and apply a move made by `seat`. Never mutates `state`.
   *
   * `rng` only ever runs on the server: the client renders the state it is
   * sent and never applies moves locally, so dice cannot be re-rolled by a
   * player until they like the result.
   */
  applyMove(state: S, move: M, seat: number, rng: Rng): MoveResult<S>;

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
}
