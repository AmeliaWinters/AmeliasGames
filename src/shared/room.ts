import { canSeat, getGame } from './games/index.js';
import { named } from './refusal.js';
// Re-exported so the adapters still import room helpers from one place, while
// the client can import roomCode.js directly and never pull in a reducer.
export { CODE_LENGTH, makeRoomCode, isRoomCode, normalizeRoomCode } from './roomCode.js';
import type { GameDefinition, Rng } from './types.js';
import type { StudyLists } from './profile.js';
import type { RoomView } from './protocol.js';
import type { GameRecord } from './harvest.js';

export interface SeatRecord {
  playerId: string;
  name: string;
  /**
   * The account this seat is signed in to, or undefined for a guest.
   *
   * Optional, and it has to stay optional: the app advertises "no accounts" on
   * every share card and the whole charm of it is that a link is enough. A
   * room where nobody has one behaves exactly as it always has, and a guest
   * sitting down beside somebody signed in costs that person nothing.
   *
   * **No `SNAPSHOT_VERSION` bump.** A stored room from before this field comes
   * back with it undefined, which reads as "these seats are guests" — the
   * honest answer, and the same answer the room would give if everybody had
   * signed out. Nothing is misread and no reducer sees it; the cost is that a
   * game already in progress across the deploy is not credited to anybody,
   * which is a fair price for not deleting every live room to add a field.
   */
  accountId?: string;
}

/**
 * Bumped whenever a persisted shape changes: a game's state, or the snapshot
 * itself. A stored room from an older shape is discarded rather than fed to a
 * reducer that would misread it.
 *
 * Meaning counts as shape. A stored `Toss` is not a record of what the dice
 * showed, it is the throw the boards re-run to find out, so changing the
 * simulation or the size of a die makes an old one land somewhere new and a
 * restored game draws dice that disagree with the score beside them. Same
 * failure as a misread field, same cure.
 *
 * 24: Vocab Race hears words, and asks the ones nobody got again. `VocabAsk`
 * gained `hear`, so a restored round's `asks` may hold a value the old code
 * reads as neither `say` nor `pick`; `VocabRound` gained `retry` and `answer`
 * gained `also`; and the state carries a `retry` queue. Meaning as well as
 * shape, in the direction that matters most here: a stored `hear` restored
 * under a build that does not know the word is a secret would print the answer
 * above the four options.
 *
 * 23: Vocab Race's handicap moved off the clock and the scoreline and onto the
 * question. A round's `ask` became a per-seat `asks`, a try records the
 * direction it answered, and a hint carries when it may be shown and whether
 * it was bought. A stored round holds neither the new fields nor a level that
 * means what it used to, so a restored game would deal one seat a question it
 * cannot answer.
 *
 * 22: Word Chain prices an ending by how thin it is, not by how often you have
 * used it. `LetterCooldown` lost `used`, the ladder it counted being gone, and
 * a lock is now worth up to five of your turns depending on how many words are
 * left ending on that letter. Shape and meaning: a restored state carries locks
 * charged under the old rule and a `used` field nothing reads, and the reveal
 * filters the loser's word on those locks, so a resumed chain would refuse and
 * hide words the rule it is playing under allows.
 *
 * 21: Vocab Race asks every third clue the other way round, and sells hints.
 * `VocabRound` gained `ask`, `options` and `hints`, `VocabTry` gained `hinted`,
 * and the state carries a per-seat `hints` allowance. Meaning, not just shape,
 * and in the direction that matters: a stored round with no `ask` reads as
 * `undefined`, which is neither `say` nor `pick`, so a restored recognition
 * round is redrawn as a production one with an empty clue and a text box,
 * asking nothing and answerable by nobody. A restored `hints` of `undefined` also
 * hands every seat an allowance of zero, silently, mid-game.
 *
 * 20: Vocab Race stops being a race one person can win. Everybody still in a
 * round answers and everybody who gets it scores, so `VocabRound` swapped
 * `winner`, `said`, `ms` and `missed` for a per-seat `tries` array, gained
 * `began`, and scores points rather than rounds (first to 100, not 5). A
 * seat's `levels` entry now buys a shorter window and a smaller share of the
 * points instead of a delay. Shape and meaning throughout: no `tries` means
 * `undefined` in every review box, a restored `scores` array counts rounds
 * against a hundred-point target and so can never end, and a restored round
 * has no `began`, which is the clock the new deadline arithmetic measures
 * from.
 *
 * 19: Word Chain keeps score, and a lost minute stops being the end of it.
 * Words score their letters, the allowance falls a second a word to a floor of
 * five (was a second every three to a floor of ten), the English list doubled
 * to fifty thousand, and `gaveUp` and `reveal` became `misses`, one entry per
 * minute anybody lost, with a new `chase` phase after the first. Shape *and*
 * meaning: no `misses` leaves the end screen with no word to show, a chain
 * restored mid-game gets a clock the ramp disagrees with, and a stored `rank`
 * was a position in a list half the size that the end-of-game percentages
 * divide by `LIST_SIZE`.
 *
 * 18: Word Chain taxes a repeated ending. Each seat carries `cooldowns` (the
 * letters they have ended words on, how often, and the turn each comes back)
 * and a word ending on a locked letter is refused. Shape and meaning both: a
 * restored game has no `cooldowns`, so a resumed chain lets a player replay
 * the ending they were just charged for, and reveals on losing a word the new
 * rule would not have taken.
 *
 * 16: Word Duel has no draws. Players who spend the same guesses are split by
 * who got there first, so the state carries `guessedAt` (when each seat's
 * latest guess landed) and dropped `draw`. Shape and meaning both: without
 * `guessedAt` every tiebreak compares `undefined` and hands the game to the
 * lower seat, and a board restored the other way reads a `draw` flag nothing
 * sets.
 *
 * 15: Backgammon keeps an account of itself. `last` is the move just played,
 * `stats` what each seat did with the dice, `race` the pip lead after every
 * turn. None of it can be recovered from a position: a hit leaves no trace
 * once the checker comes back in, and an unplayable die leaves none at all. A
 * restored game ends on a summary reading `undefined` in every box, and `race`
 * draws a chart of a game that began where it was restored.
 *
 * 14: the Polish word list more than doubled. A frequency list counts strings
 * and Polish spreads a word over strings, so `arbuz` (which only ever appears
 * as `arbuza`) was not in the game at all. Counts are now rolled up onto the
 * lemma, with the dictionary's own headwords admitted below everything anybody
 * actually says. Meaning, not shape: a `ChainLink` carries the rank it had
 * when played and the stats divide it by `LIST_SIZE`, which went from 28,848
 * to 62,669, so a resumed chain reports a common word as a rare one.
 *
 * 13: the wheel stops where it stopped. `travel` was rounded to whole wedges
 * and the board stood the wheel on the midpoint, so every landing in the
 * game's history was dead-centre. Travel is now fractional and `rest` carries
 * the exact resting position the next throw anchors to, with `SPIN_DRAG` and
 * the travel clamps moved to match. A stored spin has no `rest`, and re-run
 * under the new drag it takes half as long to go three times as far. The throw
 * is the record, so this is the `Toss` case again.
 *
 * 12: Word Chain words carry how long they took. An older chain has links
 * with no `ms`, so every end-of-game average comes out `NaN` beside a word
 * that looks perfectly fine. Invisible until the game ends, which is the worst
 * kind to leave restorable.
 *
 * 11: the wheel is thrown rather than dialled. `travel` was wedges of pointer
 * travel, always forwards; it is now signed wedges of *rotation*, positive
 * clockwise, with the pointer running the other way round it (see
 * `wedgeAfter`). Meaning again: a stored spin re-read under the old rule turns
 * the wheel the wrong way and stops on a wedge nobody spun.
 *
 * 10: Word Chain. Words carry a frequency rank, the state carries answers
 * left and whether the loser gave up, the stranding threshold moved from one
 * answer to a per-language count, and two players in the same language now
 * link on the accented letter. A stored game restores without the rank or the
 * count and draws `#undefined` beside every word, and the last one is meaning
 * rather than shape: a resumed Polish chain starts asking for `ł` where it had
 * been asking for `l`.
 *
 * 9: the dice became real cubes. `Rest` was `{x, y, o}` indexing 24 square
 * orientations and is now `{x, y, up, q}` with a full rotation, `spin` is
 * gone, and the simulation that re-runs it is Rapier in the browser rather
 * than a 2.5D solver on the server. Any one of those alone would need the
 * bump.
 */
export const SNAPSHOT_VERSION = 24;

/** Everything needed to rebuild a room. This is what gets persisted. */
export interface RoomSnapshot {
  version: number;
  code: string;
  gameId: string;
  /**
   * Null until the game is dealt. A room exists before its game does (see the
   * note on `RoomEngine`), and there is no honest state to store for a game
   * that has not been set up yet.
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
 * nothing about sockets, which is what lets the Node dev server and the
 * Cloudflare Durable Object share it verbatim.
 *
 * **A room has two phases.** It opens empty and gathers people; then somebody
 * starts it and the game is dealt. That split is the whole of open seating.
 * Before it, the host fixed the table size before anyone had turned up, and a
 * third friend arriving at a room opened for two was told "That game is full"
 * with no way in but everybody abandoning the code. Now the room takes whoever
 * comes, up to the game's own ceiling, and deals when the people here say they
 * are ready.
 *
 * The deal is deferred rather than re-run, which matters more than it looks:
 * `setup(playerCount)` is called once, with the number of people actually
 * sitting down. No reducer had to learn what an empty seat is.
 */
export class RoomEngine {
  readonly code: string;
  /**
   * Not readonly: a room outlives the game it was opened with. `switchGame`
   * swaps the reducer under the same code and seats, which is the whole point
   * of playing something else without regrouping.
   */
  def: GameDefinition<any, any>;
  /** Null until `start` deals. See the class note. */
  private state: unknown;
  private seats: SeatRecord[];
  /**
   * What each seat is due to review, in seat order, as of the last time an
   * adapter said. Handed to `setup` at every deal; see `GameDefinition.setup`.
   *
   * **Deliberately not in `RoomSnapshot`.** It is a cache of somebody else's
   * data with a shelf life of about a minute, it is the adapter's job to
   * refill before a deal, and a room that comes back from storage without it
   * deals exactly the game it dealt before this existed. Persisting it would
   * buy nothing and cost a `SNAPSHOT_VERSION` bump, which deletes every live
   * room on deploy.
   */
  private study: StudyLists[] = [];

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
   * is a return value, not an exception.
   *
   * No player count: the room opens with no seats and grows as people arrive.
   * The table size is settled by who shows up, and not before.
   */
  static create(code: string, gameId: string): RoomEngine | null {
    const def = getGame(gameId);
    if (!def) return null;
    return new RoomEngine(code, def, null, []);
  }

  /**
   * Rebuild a persisted room, or null if it can no longer be trusted: a
   * snapshot from an older shape, or for a game that no longer exists. Treat
   * null as "this room is gone" and delete it, rather than throwing on every
   * subsequent message forever.
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

  /** True before anyone has ever taken a seat. Used to detect code collisions. */
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

  /**
   * Whether the game in this room is finished.
   *
   * Here rather than left to the adapters reading `viewFor(...).over`, because
   * both of them now have to ask it *twice* around every action — once before
   * and once after — to catch the moment a game ends, and building a whole
   * `RoomView` per seat to answer a yes-or-no question is the wrong shape for
   * a thing called on every message.
   */
  isOver(): boolean {
    return this.started() && this.def.isOver(this.state);
  }

  /**
   * What this finished game says about the people who played it, or null if it
   * is not finished.
   *
   * A game that implements no `record` still produces one: every seat, played,
   * **result null**. That is not a formality. Eleven of the thirteen games are
   * in that case, and if they reported nothing at all a profile would look
   * completely dead to somebody who mostly plays Backgammon — which is exactly
   * the failure the small per-game payment exists to prevent.
   *
   * The result is null rather than a guess, because the room genuinely cannot
   * tell: the contract has `isOver` and a `status` string, and nothing anywhere
   * that names a winner. Calling them all draws was the first version of this
   * and it is a lie that compounds into a profile claiming two hundred drawn
   * games of Connect Four. See `Outcome`.
   */
  record(): GameRecord | null {
    if (!this.isOver()) return null;
    const told = this.def.record?.(this.state, this.seats.length);
    if (told) return told;
    return {
      gameId: this.def.id,
      seats: this.seats.map((_, seat) => ({ seat, result: null, learned: [] })),
    };
  }

  /**
   * The seats that are signed in, and to what.
   *
   * Guests are simply absent from the list rather than present with a null, so
   * the adapters loop over "people to pay" instead of looping over every seat
   * and remembering to skip. The commonest room has nobody in this list.
   */
  accounts(): Array<{ seat: number; accountId: string }> {
    return this.seats.flatMap((seat, i) =>
      seat.accountId ? [{ seat: i, accountId: seat.accountId }] : [],
    );
  }

  /**
   * Tell the room what one seat is due to review, before it deals.
   *
   * Called by the adapters, which are the only things here that can reach a
   * profile store, and called at the deal rather than at sign-in because
   * "due" is a comparison against the clock: an answer cached when somebody
   * joined is stale by the time anybody presses start.
   *
   * Sparse on purpose. A guest never gets one, an account with nothing due
   * hands back an empty object, and a fetch that failed simply does not call
   * this. All three arrive at `setup` as "no study list for that seat",
   * which every game must already survive.
   */
  setStudy(seat: number, lists: StudyLists): void {
    if (seat < 0) return;
    this.study[seat] = lists;
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

  join(playerId: string, name: string, accountId?: string): JoinResult {
    // An existing player always gets their own seat back, so a dropped
    // connection is recoverable rather than fatal. Checked before anything
    // else, so reconnecting into a game already under way still works.
    const existing = this.seatOf(playerId);
    if (existing !== -1) {
      // The account is taken from the newest hello rather than kept from the
      // first, so somebody who signs in mid-game is credited for the rest of
      // it. It cannot be used to *steal* a seat: the seat is found by
      // `playerId`, which is this browser's own secret, and the account had to
      // prove itself before `readHello` would pass it on.
      this.seats[existing] = { playerId, name, accountId };
      return { ok: true, seat: existing, reclaimed: true };
    }
    // Arriving after the deal. Seating them anyway would hand the reducer a
    // seat index its arrays were never sized for, and every move in the room
    // would fail from then on.
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
        error: `Room ${this.code} is full. ${this.def.name} seats ${this.capacity}.`,
      };
    }
    this.seats.push({ playerId, name, accountId });
    return { ok: true, seat: this.seats.length - 1, reclaimed: false };
  }

  /**
   * Deal the game to the people who are here.
   *
   * Somebody has to say when, and it is seat 0, whoever opened the room.
   * Starting the moment the minimum is met would deal a friend who is still
   * loading the page out of a game they were invited to, which is the failure
   * this whole change exists to remove.
   *
   * Also where a timed game's clock starts: `tick` runs straight after the
   * deal, so the round is running by the time the first view goes out.
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
          ? `${host} opened the room, so starting is their call.`
          : 'Only whoever opened the room can start.',
      };
    }
    if (this.short() > 0) {
      const more = this.short();
      return {
        ok: false,
        error: `${this.def.name} needs ${more} more player${more === 1 ? '' : 's'}.`,
      };
    }
    this.state = this.def.setup(this.seats.length, rng, now, this.study);
    this.tick(now);
    return { ok: true };
  }

  /**
   * A move is refused until the game has been dealt, because there is no state
   * to apply it to. Moves used to be turned away while the room was short a
   * player, with an exception (`allowsEarlyMove`) so Battleships could set out
   * its fleet while waiting. That exception went with the thing it worked
   * around: once a room starts, everybody in it is already sitting down.
   */
  move(seat: number, move: unknown, rng: Rng = Math.random, now: number = Date.now()): ActionResult {
    if (!this.started()) {
      return { ok: false, error: `${this.def.name} has not been dealt yet.` };
    }
    // A move arriving after the whistle meets a game that is already over,
    // rather than one still open because no timer happened to fire. The clock
    // decides, not the scheduler.
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
   * Safe to call as often as you like: a game that is not timed, not yet
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
    this.state = this.def.setup(this.seats.length, rng, now, this.study);
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
          `${next.name} doesn't play with ${this.seats.length}. It ` +
          `seats ${next.minPlayers}` +
          `${next.maxPlayers === next.minPlayers ? '' : ` to ${next.maxPlayers}`}.`,
      };
    }
    this.def = next;
    this.state = next.setup(this.seats.length, rng, now, this.study);
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
      // Nobody may act before the deal, and nobody at all is at seat -1. A
      // spectator socket would otherwise be handed a true by a game whose
      // `canAct` only range-checks the seat it was given.
      canAct: waiting || seat < 0 ? false : this.def.canAct(this.state, seat, now),
      status: waiting ? this.lobbyStatus() : this.def.status(this.state, names),
      over: waiting ? false : this.def.isOver(this.state),
      waiting,
      canStart: this.canStart(),
      capacity: this.capacity,
      // The server's clock, sent so a timed countdown is measured against the
      // clock that ends it rather than the player's, which may be wrong by
      // minutes.
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
      return `Waiting for ${more} more player${more === 1 ? '' : 's'}...`;
    }
    const host = this.seats[0]?.name || 'Player 1';
    return `Ready. ${host} can start whenever you are`;
  }
}
