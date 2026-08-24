import { canSeat, getGame } from './games/index.js';
import { named } from './refusal.js';
// Re-exported so the adapters still import room helpers from one place, while
// the client can import roomCode.js directly and never pull in a reducer.
export { CODE_LENGTH, makeRoomCode, isRoomCode, normalizeRoomCode } from './roomCode.js';
import type { GameDefinition, Rng } from './types.js';
import type { RoomView } from './protocol.js';

export interface SeatRecord {
  playerId: string;
  name: string;
}

/**
 * Bumped whenever a persisted shape changes — a game's state, or the snapshot
 * itself. A stored room from an older shape is discarded rather than fed to a
 * reducer that would misread it.
 *
 * Meaning counts as shape. A stored `Toss` is not a record of what the dice
 * showed, it is the throw the boards re-run to find out — so changing the
 * simulation or the size of a die makes an old one land somewhere new, and a
 * game restored across that change would draw dice that disagree with the
 * score beside them. That is the same failure as a misread field and takes the
 * same cure.
 *
 * 15: Backgammon keeps an account of itself. `last` is the move just played,
 * `stats` is what each seat did with the dice, and `race` is the pip lead
 * after every turn — none of which can be recovered from a position, because
 * a hit leaves no trace once the checker comes back in and an unplayable die
 * leaves none at all. A restored game would come back with no `stats` and end
 * on a summary reading `undefined` in every box, and `race` would draw a chart
 * of a game that began at the point it was restored.
 *
 * 14: the Polish word list more than doubled. A frequency list counts strings
 * and Polish spreads a word over strings, so `arbuz` — which only ever appears
 * as `arbuza` — was not in the game at all; the counts are now rolled up onto
 * the lemma and the dictionary's own headwords are admitted below everything
 * anybody actually says. That is meaning, not shape: a `ChainLink` carries the
 * rank it had when it was played and the stats divide it by `LIST_SIZE`, which
 * went from 28,848 to 62,669, so a chain resumed across this deploy would
 * report a common word as a rare one and every letter's answers-left count
 * beside it would be measured against a different list.
 *
 * 13: the wheel stops where it stopped. `travel` was rounded to whole wedges
 * and the board stood the wheel on the wedge's midpoint, so every landing in
 * the game's history was dead-centre; travel is now fractional and the new
 * `rest` field carries the exact resting position the next throw is anchored
 * to. `SPIN_DRAG` and the travel clamps moved with it. A stored spin has no
 * `rest`, and re-run under the new drag it would take half as long to go three
 * times as far — the throw is the record, so this is the `Toss` case again.
 *
 * 12: Word Chain words carry how long they took. A chain restored from before
 * this deploy has links with no `ms` on them, and every average the end-of-game
 * stats are built from would come out `NaN` beside a word that looks perfectly
 * fine — the failure is invisible until the game ends, which is the worst kind
 * to leave restorable.
 *
 * 11: the wheel is thrown rather than dialled. `travel` was wedges of pointer
 * travel, always forwards; it is now signed wedges of *rotation*, positive
 * clockwise, with the pointer running the other way round it — see
 * `wedgeAfter`. Meaning again: a stored spin re-read under the old rule turns
 * the wheel the wrong way and stops it on a wedge nobody spun.
 *
 * 10: Word Chain. Words carry a frequency rank, the state carries how many
 * answers are left and whether the loser gave up, the threshold that refuses a
 * stranding word moved from one answer to a per-language count, and a chain
 * between two players in the same language now links on the accented letter.
 * A stored game would restore without the rank or the count and draw
 * `#undefined` beside every word, and the last one is meaning rather than
 * shape: a Polish chain resumed after this deploy would start asking for `ł`
 * where it had been asking for `l`.
 *
 * 9: the dice became real cubes. `Toss` changed shape — `Rest` was `{x, y, o}`
 * indexing 24 square orientations and is now `{x, y, up, q}` with a full
 * rotation, `spin` is gone, and the simulation that re-runs it is Rapier in
 * the browser rather than a 2.5D solver on the server. Every one of those on
 * its own would need this bump.
 */
export const SNAPSHOT_VERSION = 15;

/** Everything needed to rebuild a room — this is what gets persisted. */
export interface RoomSnapshot {
  version: number;
  code: string;
  gameId: string;
  /**
   * Null until the game is dealt. A room now exists before its game does —
   * see the note on `RoomEngine` — and there is no honest state to store for
   * a game that has not been set up yet.
   */
  state: unknown;
  /** Only the people actually here. No holes: the list grows as they arrive. */
  seats: SeatRecord[];
}

export type JoinResult =
  | { ok: true; seat: number; reclaimed: boolean }
  /**
   * `kind` travels with the refusal because the two ways in are not the same
   * problem, and the heading the player reads should not say "full" about a
   * room with six empty seats.
   */
  | { ok: false; kind: 'full' | 'started'; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Transport-agnostic room logic. It knows about seats, turns and rules but
 * nothing about sockets — which is what lets the Node dev server and the
 * Cloudflare Durable Object share it verbatim.
 *
 * **A room has two phases.** It opens empty and gathers people; then somebody
 * starts it and the game is dealt. That split is the whole of open seating,
 * and it replaced a model where the table size was chosen by the host before
 * anyone had turned up and fixed for the life of the room.
 *
 * The old way had one failure that could not be recovered from inside the
 * product: a third friend arriving at a room opened for two was told "That
 * game is full", and the only way to include them was for everybody to abandon
 * the code and start again. Now the room takes whoever comes, up to whatever
 * ceiling the game itself has, and the deal happens when the people who are
 * here say they are ready.
 *
 * The deal is deferred rather than re-run, which matters more than it looks:
 * `setup(playerCount)` is called once, with the number of people actually
 * sitting down. No reducer had to learn what an empty seat is.
 */
export class RoomEngine {
  readonly code: string;
  /**
   * Not readonly: a room outlives the game it was opened with. `switchGame`
   * swaps the reducer under the same code and the same seats, which is the
   * whole point of being able to play something else without regrouping.
   */
  def: GameDefinition<any, any>;
  /** Null until `start` deals. See the class note. */
  private state: unknown;
  private seats: SeatRecord[];

  private constructor(
    code: string,
    def: GameDefinition<any, any>,
    state: unknown,
    seats: SeatRecord[],
  ) {
    this.code = code;
    this.def = def;
    this.state = state;
    this.seats = seats;
  }

  /**
   * Build a fresh room, or null if there is no such game. Callers are on a
   * socket and must answer the client rather than throw, so an unknown game id
   * is a return value here, not an exception.
   *
   * No player count: the room opens with no seats at all and grows as people
   * arrive. What size table this turns out to be is settled by who shows up,
   * and not before.
   */
  static create(code: string, gameId: string): RoomEngine | null {
    const def = getGame(gameId);
    if (!def) return null;
    return new RoomEngine(code, def, null, []);
  }

  /**
   * Rebuild a persisted room, or null if it can no longer be trusted — a
   * snapshot from an older shape, or for a game that no longer exists. Callers
   * should treat null as "this room is gone" and delete it, rather than
   * throwing on every subsequent message forever.
   */
  static restore(snapshot: RoomSnapshot): RoomEngine | null {
    if (snapshot?.version !== SNAPSHOT_VERSION) return null;
    const def = getGame(snapshot.gameId);
    if (!def) return null;
    return new RoomEngine(snapshot.code, def, snapshot.state ?? null, snapshot.seats ?? []);
  }

  snapshot(): RoomSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      code: this.code,
      gameId: this.def.id,
      state: this.state,
      seats: this.seats,
    };
  }

  /** True before anyone has ever taken a seat — used to detect code collisions. */
  isFresh(): boolean {
    return this.seats.length === 0;
  }

  seatOf(playerId: string): number {
    return this.seats.findIndex((s) => s.playerId === playerId);
  }

  /** Whether the game has been dealt. Before this, there is no state at all. */
  started(): boolean {
    return this.state !== null;
  }

  /** How many people are sitting here. */
  get size(): number {
    return this.seats.length;
  }

  /** The most this game will seat. The room's ceiling is the game's. */
  get capacity(): number {
    return this.def.maxPlayers;
  }

  /** How many more are needed before this game could be started at all. */
  private short(): number {
    return Math.max(0, this.def.minPlayers - this.seats.length);
  }

  /**
   * Whether the game can be dealt right now: enough people, and not already
   * under way. Sent to the client so the host's start control knows whether to
   * offer itself, and re-checked here because a client is never the authority.
   */
  canStart(): boolean {
    return !this.started() && this.short() === 0;
  }

  join(playerId: string, name: string): JoinResult {
    // An existing player always gets their own seat back, so a dropped
    // connection is recoverable rather than fatal. Checked before anything
    // else, so reconnecting into a game already under way still works.
    const existing = this.seatOf(playerId);
    if (existing !== -1) {
      this.seats[existing] = { playerId, name };
      return { ok: true, seat: existing, reclaimed: true };
    }
    // Arriving after the deal. The alternative — seating them anyway — hands
    // the reducer a seat index its arrays were never sized for, and every
    // move in the room fails from then on.
    if (this.started()) {
      return {
        ok: false,
        kind: 'started',
        error: `${this.def.name} in room ${this.code} has already started.`,
      };
    }
    if (this.seats.length >= this.capacity) {
      return {
        ok: false,
        kind: 'full',
        error: `Room ${this.code} is full — ${this.def.name} seats ${this.capacity}.`,
      };
    }
    this.seats.push({ playerId, name });
    return { ok: true, seat: this.seats.length - 1, reclaimed: false };
  }

  /**
   * Deal the game to the people who are here.
   *
   * Somebody has to say when, and it is seat 0 — whoever opened the room. The
   * alternative, starting the moment the minimum is met, deals a friend who is
   * still loading the page out of a game they were invited to, which is the
   * failure this whole change exists to remove.
   *
   * This is also where a timed game's clock starts: `tick` runs immediately
   * after the deal, so the round is already running by the time the first
   * view goes out rather than a message later.
   */
  start(seat: number, rng: Rng = Math.random, now: number = Date.now()): ActionResult {
    if (this.started()) {
      return { ok: false, error: `${this.def.name} is already under way in room ${this.code}.` };
    }
    if (seat !== 0) {
      const host = this.seats[0]?.name;
      return {
        ok: false,
        error: host
          ? `Only ${host}, who opened the room, can start.`
          : 'Only the player who opened the room can start.',
      };
    }
    if (this.short() > 0) {
      const more = this.short();
      return {
        ok: false,
        error: `${this.def.name} needs ${more} more player${more === 1 ? '' : 's'}.`,
      };
    }
    this.state = this.def.setup(this.seats.length, rng, now);
    this.tick(now);
    return { ok: true };
  }

  /**
   * A move is refused until the game has been dealt. There is no state to
   * apply it to, which is a blunter version of the rule this replaced — moves
   * used to be turned away while the room was short a player, with an
   * exception (`allowsEarlyMove`) so Battleships could set out its fleet
   * while waiting. That exception is gone with the thing it worked around:
   * once a room starts, everybody in it is already sitting down, so placing
   * happens in an ordinary dealt game like everything else.
   */
  move(seat: number, move: unknown, rng: Rng = Math.random, now: number = Date.now()): ActionResult {
    if (!this.started()) {
      return { ok: false, error: `${this.def.name} has not been dealt yet.` };
    }
    // A move that arrives after the whistle meets a game that is already over,
    // rather than one that is still open because no timer happened to have
    // fired yet. The clock decides, not the scheduler.
    this.tick(now);
    const result = this.def.applyMove(this.state, move, seat, rng, now);
    if (!result.ok) return { ok: false, error: result.error };
    this.state = result.state;
    return { ok: true };
  }

  /**
   * When this room's game must be settled by, or null if it is not on a clock.
   * The adapters read it to arm a timer at the right moment instead of waiting
   * for the next housekeeping sweep.
   */
  deadline(): number | null {
    if (!this.started()) return null;
    return this.def.deadline?.(this.state) ?? null;
  }

  /**
   * Bring the room's clock up to date: start a timed game's round, and settle
   * it once its time is up. Returns whether anything changed, so a caller
   * knows whether to broadcast.
   *
   * Safe to call as often as you like — a game that is not timed, not yet
   * dealt, or not yet out of time says no and does nothing. Both halves run in
   * order, so a room that starts and expires between two ticks still ends up
   * settled rather than stuck half-started.
   */
  tick(now: number = Date.now()): boolean {
    if (!this.started()) return false;
    let changed = false;
    const started = this.def.start?.(this.state, now);
    if (started) {
      this.state = started;
      changed = true;
    }
    const settled = this.def.expire?.(this.state, now);
    if (settled) {
      this.state = settled;
      changed = true;
    }
    return changed;
  }

  rematch(rng: Rng = Math.random, now: number = Date.now()): ActionResult {
    if (!this.started()) {
      return { ok: false, error: `${this.def.name} has not been dealt yet.` };
    }
    if (!this.def.isOver(this.state)) {
      return { ok: false, error: `This game of ${this.def.name} is still in progress.` };
    }
    // Whoever is actually here, which may not be who was here last time: a
    // rematch is dealt for the table as it stands.
    this.state = this.def.setup(this.seats.length, rng, now);
    // The table is already sitting there, so a timed rematch starts running
    // the moment it is dealt.
    this.tick(now);
    return { ok: true };
  }

  /**
   * Play a different game with the same people, at the same table.
   *
   * Gated on the current game being over for the same reason a rematch is:
   * otherwise any seat could wipe a game in progress that the others were
   * still playing. The table is these people, so a game that cannot seat this
   * many is refused rather than silently dropping somebody.
   */
  switchGame(gameId: string, rng: Rng = Math.random, now: number = Date.now()): ActionResult {
    if (!this.started()) {
      return { ok: false, error: `${this.def.name} has not been dealt yet.` };
    }
    if (!this.def.isOver(this.state)) {
      return { ok: false, error: `This game of ${this.def.name} is still in progress.` };
    }
    const next = getGame(gameId);
    if (!next) return { ok: false, error: `There is no game called ${named(gameId)}.` };
    if (next.id === this.def.id) return this.rematch(rng, now);
    if (!canSeat(next, this.seats.length)) {
      return {
        ok: false,
        error:
          `${next.name} doesn't play with ${this.seats.length} — ` +
          `it seats ${next.minPlayers}` +
          `${next.maxPlayers === next.minPlayers ? '' : ` to ${next.maxPlayers}`}.`,
      };
    }
    this.def = next;
    this.state = next.setup(this.seats.length, rng, now);
    this.tick(now);
    return { ok: true };
  }

  /** Build the payload for one seat, redacted by the game's `view` if it has one. */
  viewFor(seat: number, connected: ReadonlySet<number>, now: number = Date.now()): RoomView {
    const waiting = !this.started();
    const names = this.seats.map((s, i) => s.name || `Player ${i + 1}`);
    return {
      code: this.code,
      gameId: this.def.id,
      gameName: this.def.name,
      players: this.seats.map((s, i) => ({
        seat: i,
        name: s.name,
        connected: connected.has(i),
      })),
      // Null while the room is still gathering. There is no game to look at
      // yet, and a board handed a made-up state would draw a lie.
      state: waiting ? null : this.def.view ? this.def.view(this.state, seat) : this.state,
      turn: waiting ? null : this.def.turn(this.state),
      // Nobody may act before the deal, and nobody at all is at seat -1 — a
      // spectator socket would otherwise be handed a true by a game whose
      // `canAct` only range-checks the seat it was given.
      canAct: waiting || seat < 0 ? false : this.def.canAct(this.state, seat, now),
      status: waiting ? this.lobbyStatus() : this.def.status(this.state, names),
      over: waiting ? false : this.def.isOver(this.state),
      waiting,
      canStart: this.canStart(),
      capacity: this.capacity,
      // The server's clock, sent so a timed game's countdown is measured
      // against the clock that ends it rather than the player's, which may be
      // wrong by minutes and would otherwise show a timer that disagrees with
      // the game.
      now,
    };
  }

  /**
   * What the room says about itself before it is dealt. Two different waits,
   * and telling them apart is the difference between "go and find somebody"
   * and "we are only waiting on a tap".
   */
  private lobbyStatus(): string {
    const more = this.short();
    if (more > 0) {
      return `Waiting for ${more} more player${more === 1 ? '' : 's'}…`;
    }
    const host = this.seats[0]?.name || 'Player 1';
    return `Ready — ${host} can start whenever you are`;
  }
}
