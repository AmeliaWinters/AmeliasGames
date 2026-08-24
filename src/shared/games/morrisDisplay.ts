/**
 * The parts of Nine Men's Morris the board may know — see the boundary note in
 * `types.ts`. Nothing is hidden in Morris, so the reason here is not secrecy:
 * board and reducer must agree exactly on where the twenty-four points are,
 * which touch, and which lines are mills. Two copies of that geometry would be
 * a board offering moves the rules refuse.
 */

/** Three concentric squares of eight points. */
export const RINGS = 3;
export const SPOTS = 8;
export const POINTS = RINGS * SPOTS;

/** Men each player starts with, which is where the game gets its name. */
export const MEN = 9;

/** Two men cannot make three in a row, so a player down to two has lost. */
export const MIN_MEN = 3;

/** Seat index of the man on the point, or null for an empty one. */
export type Cell = 0 | 1 | null;

/**
 * Points are numbered ring by ring, outermost first, and within a ring
 * clockwise from the top-left corner:
 *
 * ```
 *   0 ────────── 1 ────────── 2      ring 0, the outer square
 *   │            │            │
 *   │    8 ───── 9 ───── 10   │      ring 1
 *   │    │       │        │   │
 *   │    │   16 ─17─ 18   │   │      ring 2, the inner square
 *   │    │    │       │   │   │
 *   7 ── 15 ──23     19 ──11──3
 *   │    │    │       │   │   │
 *   │    │   22 ─21─ 20   │   │
 *   │    │       │        │   │
 *   │   14 ──── 13 ───── 12   │
 *   │            │            │
 *   6 ────────── 5 ────────── 4
 * ```
 *
 * The scheme makes every rule below arithmetic rather than a table:
 * neighbours are the next spot round, and spokes pass through exactly the odd
 * spots. Corners have no spoke — the one thing here that surprises people.
 */
export function ring(point: number): number {
  return Math.floor(point / SPOTS);
}

export function spot(point: number): number {
  return point % SPOTS;
}

export function pointAt(ring: number, spot: number): number {
  return ring * SPOTS + spot;
}

export function isPoint(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < POINTS;
}

/** The edge midpoints: the only spots a spoke passes through. */
const MIDPOINTS = [1, 3, 5, 7] as const;
/** The corners, where a ring's two edges meet and its mills are centred. */
const CORNERS = [0, 2, 4, 6] as const;

function buildAdjacency(): number[][] {
  const adjacent: number[][] = Array.from({ length: POINTS }, () => []);
  const join = (a: number, b: number) => {
    adjacent[a].push(b);
    adjacent[b].push(a);
  };
  // Round each ring: every spot touches the next one.
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SPOTS; s++) join(pointAt(r, s), pointAt(r, (s + 1) % SPOTS));
  }
  // Never outer straight to inner: the middle ring is in the way, and a man
  // standing there blocks the road.
  for (const s of MIDPOINTS) {
    join(pointAt(0, s), pointAt(1, s));
    join(pointAt(1, s), pointAt(2, s));
  }
  return adjacent.map((list) => list.sort((a, b) => a - b));
}

/** Which points a man may step to, ignoring what is standing on them. */
export const ADJACENCY: ReadonlyArray<readonly number[]> = buildAdjacency();

function buildMills(): number[][] {
  const mills: number[][] = [];
  // Twelve along the edges: a corner, the midpoint after it, the next corner.
  for (let r = 0; r < RINGS; r++) {
    for (const s of CORNERS) {
      mills.push([pointAt(r, s), pointAt(r, (s + 1) % SPOTS), pointAt(r, (s + 2) % SPOTS)]);
    }
  }
  // Four along the spokes: outer, middle and inner at the same midpoint.
  for (const s of MIDPOINTS) {
    mills.push([pointAt(0, s), pointAt(1, s), pointAt(2, s)]);
  }
  return mills;
}

/**
 * Sixteen lines of three: twelve along the edges, four along the spokes. The
 * corner diagonals do *not* count — those belong to a different game played on
 * the same drawing.
 */
export const MILLS: ReadonlyArray<readonly number[]> = buildMills();

/** The mills each point belongs to. Every point is in exactly two of them. */
export const MILLS_AT: ReadonlyArray<ReadonlyArray<readonly number[]>> = Array.from(
  { length: POINTS },
  (_, point) => MILLS.filter((mill) => mill.includes(point)),
);

/**
 * Where a point sits, in a square running -3 to 3 with y downward: outer ring
 * at ±3, middle ±2, inner ±1. Not pixels — the board scales these to whatever
 * width it is given, and the lobby card motif draws them smaller.
 */
const OFFSET: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], // 0  top left
  [0, -1], //  1  top
  [1, -1], //  2  top right
  [1, 0], //   3  right
  [1, 1], //   4  bottom right
  [0, 1], //   5  bottom
  [-1, 1], //  6  bottom left
  [-1, 0], //  7  left
];

export function pointXY(point: number): { x: number; y: number } {
  const reach = RINGS - ring(point);
  const [dx, dy] = OFFSET[spot(point)];
  return { x: dx * reach, y: dy * reach };
}

const RING_NAMES = ['outer', 'middle', 'inner'] as const;
const SPOT_NAMES = [
  'top left',
  'top',
  'top right',
  'right',
  'bottom right',
  'bottom',
  'bottom left',
  'left',
] as const;

/** "middle top right" — how a point is said aloud, for the screen reader. */
export function pointName(point: number): string {
  return `${RING_NAMES[ring(point)]} ${SPOT_NAMES[spot(point)]}`;
}

/** How a game ended, so the status line can say more than "wins". */
export type MmEnding = 'starved' | 'blocked' | 'repetition' | 'quiet';

export type MmLast =
  | { type: 'place'; to: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'take'; at: number };

export type MmMove =
  | { type: 'place'; to: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'take'; at: number };

export interface MmState {
  /** One cell per point, indexed as above. */
  board: Cell[];
  /** Men each seat has still to place. */
  hand: [number, number];
  turn: 0 | 1;
  /**
   * The seat that closed a mill and owes itself a man, or null. A move of its
   * own, not a field on the move that closed the mill: the player must look at
   * the board first, the choice can be refused, and a client guessing for them
   * would guess at the most consequential decision in the game. `turn` stays
   * with them while this is set.
   */
  taking: 0 | 1 | null;
  winner: 0 | 1 | null;
  draw: boolean;
  ending: MmEnding | null;
  lastMove: MmLast | null;
  /** The mill just closed, for the board to light up. */
  closed: number[] | null;
  /**
   * Plies since the last man was taken, counted only once both hands are
   * empty. See QUIET_LIMIT.
   */
  quiet: number;
  /**
   * Positions seen since the last take. Cleared by a take, which makes every
   * earlier position unreachable — otherwise this grows all game.
   */
  seen: Record<string, number>;
}

/**
 * Plies without a take before a draw — fifty moves each, counted as chess does.
 * Two careful players can walk men back and forth forever, and a room that
 * never finishes is one nobody leaves gracefully. Threefold repetition catches
 * the tight loops; this catches the wandering ones.
 */
export const QUIET_LIMIT = 100;

/** How often a position may come round before the game is drawn. */
export const REPETITION_LIMIT = 3;

export function menOnBoard(board: readonly Cell[], seat: number): number {
  return board.reduce((count: number, cell) => (cell === seat ? count + 1 : count), 0);
}

/**
 * In hand and on the board together — the total the losing condition is
 * measured against. Two on the board with five in hand is not beaten.
 */
export function menLeft(state: MmState, seat: number): number {
  return state.hand[seat] + menOnBoard(state.board, seat);
}

/** While a seat has men in hand it places them; it may not move one yet. */
export function mustPlace(state: MmState, seat: number): boolean {
  return state.hand[seat] > 0;
}

/**
 * Whether a seat's men may jump to any empty point rather than step. The
 * standard mercy rule: three men who can go anywhere can still close a mill,
 * where three that must step are walled in and lost on the spot.
 */
export function canFly(state: MmState, seat: number): boolean {
  return state.hand[seat] === 0 && menOnBoard(state.board, seat) === MIN_MEN;
}

/** The complete mills the man on `point` stands in. Empty if it is in none. */
export function millsThrough(
  board: readonly Cell[],
  point: number,
): ReadonlyArray<readonly number[]> {
  const owner = board[point];
  if (owner === null || owner === undefined) return [];
  return MILLS_AT[point].filter((mill) => mill.every((p) => board[p] === owner));
}

export function inMill(board: readonly Cell[], point: number): boolean {
  return millsThrough(board, point).length > 0;
}

/**
 * A man in a mill is protected — unless every man they have left is in one,
 * or a player whose men were all milled could never be taken from again.
 */
export function takeable(board: readonly Cell[], victim: number): number[] {
  const theirs: number[] = [];
  for (let point = 0; point < POINTS; point++) {
    if (board[point] === victim) theirs.push(point);
  }
  const exposed = theirs.filter((point) => !inMill(board, point));
  return exposed.length > 0 ? exposed : theirs;
}

/** Where the man on `from` may go, given whose he is and how many they hold. */
export function destinations(state: MmState, from: number): number[] {
  const owner = state.board[from];
  if (owner === null) return [];
  if (mustPlace(state, owner)) return [];
  const empty = (point: number) => state.board[point] === null;
  if (canFly(state, owner)) {
    return Array.from({ length: POINTS }, (_, point) => point).filter(empty);
  }
  return ADJACENCY[from].filter(empty);
}

/** The seat's men that have somewhere to go. */
export function movers(state: MmState, seat: number): number[] {
  const found: number[] = [];
  for (let point = 0; point < POINTS; point++) {
    if (state.board[point] === seat && destinations(state, point).length > 0) found.push(point);
  }
  return found;
}

/**
 * Whether a seat has any legal move. One with men in hand always does —
 * eighteen men on twenty-four points leaves six empty however the game went —
 * so only a player out of men to place can be walled in.
 *
 * Deliberately *not* `canAct`, which asks "may this seat move right now" and
 * would be false for the player not on turn. This asks the losing condition,
 * about the seat that is about to receive the turn.
 */
export function hasMove(state: MmState, seat: number): boolean {
  if (mustPlace(state, seat)) return state.board.some((cell) => cell === null);
  return movers(state, seat).length > 0;
}

/**
 * Position plus who is to play. The same board with the other player to move
 * is a different problem; merging them would draw games still going somewhere.
 */
export function positionKey(state: MmState): string {
  return `${state.board.map((cell) => (cell === null ? '.' : cell)).join('')}:${state.turn}`;
}
