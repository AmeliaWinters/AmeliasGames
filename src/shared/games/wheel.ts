import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { pick } from './random.js';

/**
 * Wheel of Fortune, for two to four.
 *
 * A hidden phrase, a wheel, and three rounds. On your turn you may spin and
 * name a consonant, buy a vowel out of the money you have won this round, or
 * try to solve. Getting it right keeps the turn — up to three letters, then it
 * moves on anyway; getting it wrong hands it over on the spot. Most money
 * after three rounds wins.
 *
 * The reducer is written for however many seats it is handed. `setup` is given
 * the room's real player count, so nothing here assumes two — `state.bank` is
 * as long as there are players, and the turn walks round it.
 *
 * ── The part that matters ──────────────────────────────────────────────
 *
 * This is the first game here with something to hide, and `view()` is the
 * whole reason it is playable. `state.answer` holds the real phrase, and the
 * server masks it on the way out to each client. Nothing else would do: the
 * client is sent the state, so an answer that reaches it is an answer anyone
 * can read out of devtools. The mask preserves length and punctuation — a
 * player is meant to know the shape of the phrase — and reveals a letter only
 * once someone has called it.
 *
 * The answer becomes public the moment the round ends, which is what lets the
 * board show what it was.
 *
 * `PUZZLES` is the second half of the same problem: masking the current answer
 * achieves nothing if the client is holding the list it was drawn from, since
 * the shape of the phrase would pick it out. It stays out of the browser
 * because no client module imports a runtime binding from this file: the board
 * takes its values from `wheelDisplay.js` and its types type-only, the lobby
 * reads `manifest.js` rather than the registry, and the room-code helpers live
 * in `roomCode.js` so `App.tsx` never pulls in `room.js` and the registry
 * behind it.
 *
 * That is structure, not bundler luck — an earlier version relied on Rollup
 * shaking the answers back out of a graph that did reach them, which held, but
 * only until someone added one value import. `wheel.bundle.test.ts` builds the
 * client and greps it, so the guarantee is now checked rather than asserted.
 */

// Constants and the money formatter live in wheelDisplay.ts, which imports
// nothing, so the board can reach them without reaching PUZZLES. Re-exported
// here so the reducer and its tests still import from one place.
import {
  ALPHABET,
  BLANK,
  CONSONANTS,
  FINDS_PER_TURN,
  ROUNDS,
  SOLVE_BONUS,
  VOWELS,
  VOWEL_COST,
  WHEEL,
  money,
  spinTravel,
  wedgeName,
} from './wheelDisplay.js';
import type { Wedge } from './wheelDisplay.js';

export {
  ALPHABET,
  BLANK,
  CONSONANTS,
  FINDS_PER_TURN,
  ROUNDS,
  SOLVE_BONUS,
  VOWELS,
  VOWEL_COST,
  WEDGE_ARC,
  WHEEL,
  money,
  spinTravel,
  wedgeLabel,
  wedgeName,
} from './wheelDisplay.js';
export type { Wedge } from './wheelDisplay.js';

/** A hostile client is not owed an unbounded string to normalise. */
const MAX_GUESS = 200;

export interface Puzzle {
  category: string;
  answer: string;
}

export interface Note {
  /** Who did the thing, so the board can name them. */
  seat: number;
  /** Reads as a sentence after a name: "Ann spun Bankrupt." */
  text: string;
}

export interface WofState {
  /** 1-based, up to ROUNDS. */
  round: number;
  category: string;
  /**
   * The phrase. Masked by `view()` for as long as the round is running — this
   * is the one field in the project that is not safe to broadcast as it is.
   */
  answer: string;
  /** Answers already played, so one match never sets the same puzzle twice. */
  used: string[];
  /** Letters called this round, right or wrong, in the order they were called. */
  called: string[];
  /** Who opened the current round. Rounds rotate on from here. */
  starter: number;
  turn: number;
  /** `call` means the wheel has stopped and a consonant is owed. */
  phase: 'spin' | 'call';
  /**
   * The cash wedge backing a consonant the player still owes, or null when
   * nothing is owed. This is the *entitlement*, and it is spent — cleared when
   * the letter is called, and when the turn moves on.
   */
  wedge: Wedge | null;
  /**
   * Which wedge the wheel physically stopped on, as an index into `WHEEL`, or
   * null before the first spin of a round.
   *
   * Deliberately not the same field as `wedge` above, and deliberately not
   * cleared when the turn passes: this is where the pointer is, and the board
   * animates to it. Bankrupt ends a turn, and the wheel still has to be seen
   * landing on Bankrupt. Two identical $300 wedges are also why this is an
   * index and not the wedge itself — the board cannot tell them apart, and
   * must spin to the right one.
   */
  wedgeAt: number | null;
  /**
   * Spins so far this game, only ever going up. The board watches it to know
   * a spin has happened at all: two spins running can land on the same wedge,
   * and without this the wheel would sit still on the second one.
   */
  spins: number;
  /**
   * Wedges the last spin travelled, so the board can turn the wheel the
   * distance it was actually thrown rather than a stock number of rotations.
   *
   * On the state rather than worked out on the client that flicked, because
   * everyone at the table watches the same spin: the player who threw it is
   * the only one who knows how hard, and the other three would otherwise see a
   * different wheel reach the same wedge. Zero before the first spin.
   */
  travel: number;
  /**
   * Correct letters found by the player to move, this turn. Reset whenever the
   * turn changes hands. At FINDS_PER_TURN the turn moves on — a hot streak is
   * worth having, not worth keeping the wheel for the whole round.
   *
   * There is no counter for the other way a turn ends, because there is
   * nothing to count: one wrong guess and the turn is over.
   */
  finds: number;
  /** Money won this round, lost entirely to Bankrupt. One entry per seat. */
  bank: number[];
  /** Money banked from rounds already won. Bankrupt cannot touch it. */
  score: number[];
  /** What just happened, for the board to narrate. */
  note: Note | null;
  roundOver: boolean;
  over: boolean;
}

export type WofMove =
  /**
   * `power` is how hard the wheel was flicked, 0 to 1 — see `spinTravel`. It
   * is optional because the Spin button has no flick behind it: a keyboard, a
   * screen reader and a player who would rather tap all reach the wheel that
   * way, and for them the wheel decides, as it always did.
   */
  | { type: 'spin'; power?: number }
  | { type: 'letter'; letter: string }
  | { type: 'solve'; answer: string }
  | { type: 'next' };

// ── The puzzles ────────────────────────────────────────────────────────

/**
 * Everyday phrases, so the game turns on spotting the shape of a sentence
 * rather than on trivia. Uppercase A–Z, spaces and apostrophes only; the tests
 * hold the bank to that, because the mask assumes it.
 */
export const PUZZLES: readonly Puzzle[] = [
  { category: 'Phrase', answer: 'BETTER LATE THAN NEVER' },
  { category: 'Phrase', answer: 'A PIECE OF CAKE' },
  { category: 'Phrase', answer: 'BREAK THE ICE' },
  { category: 'Phrase', answer: 'ONCE IN A BLUE MOON' },
  { category: 'Phrase', answer: 'THE EARLY BIRD' },
  { category: 'Phrase', answer: 'BACK TO SQUARE ONE' },
  { category: 'Phrase', answer: 'SPILL THE BEANS' },
  { category: 'Phrase', answer: 'UNDER THE WEATHER' },
  { category: 'Phrase', answer: 'COSTS AN ARM AND A LEG' },
  { category: 'Phrase', answer: 'HIT THE NAIL ON THE HEAD' },
  { category: 'Phrase', answer: 'A BLESSING IN DISGUISE' },
  { category: 'Phrase', answer: 'CROSSING MY FINGERS' },
  { category: 'Phrase', answer: 'SAVED BY THE BELL' },
  { category: 'Phrase', answer: "A BAKER'S DOZEN" },
  { category: 'Phrase', answer: 'THE LAST WORD' },
  { category: 'Phrase', answer: 'BOB IS YOUR UNCLE' },
  { category: 'Phrase', answer: 'CHALK AND CHEESE' },
  { category: 'Phrase', answer: 'SWINGS AND ROUNDABOUTS' },
  { category: 'Phrase', answer: 'RAINING CATS AND DOGS' },
  { category: 'Phrase', answer: 'OVER THE MOON' },
  { category: 'Phrase', answer: 'A DAMP SQUIB' },
  { category: 'Phrase', answer: 'PULL YOUR SOCKS UP' },
  { category: 'Phrase', answer: 'MIND THE GAP' },
  { category: 'Phrase', answer: 'FULL OF BEANS' },
  { category: 'Phrase', answer: 'A STORM IN A TEACUP' },
  { category: 'Phrase', answer: 'GOING FOR A SONG' },
  { category: 'Phrase', answer: 'PLENTY MORE FISH' },
  { category: 'Phrase', answer: 'NONE THE WISER' },
  { category: 'Phrase', answer: 'SIXES AND SEVENS' },
  { category: 'Phrase', answer: 'ROUND THE HOUSES' },
  { category: 'Phrase', answer: 'ON YOUR BIKE' },
  { category: 'Phrase', answer: 'A BIT OF A FAFF' },
  { category: 'Phrase', answer: 'EASY DOES IT' },
  { category: 'Phrase', answer: 'CHEAP AND CHEERFUL' },
  { category: 'Phrase', answer: 'HORSES FOR COURSES' },
  { category: 'Phrase', answer: 'THE PENNY DROPPED' },
  { category: 'Phrase', answer: 'PUT THE KETTLE ON' },
  { category: 'Phrase', answer: 'FIRST THINGS FIRST' },
  { category: 'Phrase', answer: 'THE LONG GAME' },
  { category: 'Phrase', answer: 'A CLEAN SLATE' },
  { category: 'Phrase', answer: 'SLEEP ON IT' },
  { category: 'Phrase', answer: 'WORTH A PUNT' },
  { category: 'Phrase', answer: 'BITS AND BOBS' },
  { category: 'Phrase', answer: 'ODDS AND ENDS' },
  { category: 'Phrase', answer: 'FAIR AND SQUARE' },
  { category: 'Phrase', answer: 'ALL IN GOOD TIME' },
  { category: 'Phrase', answer: 'THE DONE THING' },
  { category: 'Phrase', answer: 'A FLASH IN THE PAN' },
  { category: 'Phrase', answer: 'MAKING A MEAL OF IT' },
  { category: 'Phrase', answer: 'A SIGHT FOR SORE EYES' },

  { category: 'Thing', answer: 'A CUP OF TEA' },
  { category: 'Thing', answer: 'THE MORNING PAPER' },
  { category: 'Thing', answer: 'A ROLLING SUITCASE' },
  { category: 'Thing', answer: 'GARDEN SHED' },
  { category: 'Thing', answer: 'KITCHEN TABLE' },
  { category: 'Thing', answer: 'A BOX OF CHOCOLATES' },
  { category: 'Thing', answer: 'WINDOW SEAT' },
  { category: 'Thing', answer: 'OLD PHOTOGRAPHS' },
  { category: 'Thing', answer: 'A TATTY UMBRELLA' },
  { category: 'Thing', answer: 'WELLINGTON BOOTS' },
  { category: 'Thing', answer: 'A HOT WATER BOTTLE' },
  { category: 'Thing', answer: 'THE TELLY REMOTE' },
  { category: 'Thing', answer: 'A BUS TIMETABLE' },
  { category: 'Thing', answer: 'TARTAN BLANKET' },
  { category: 'Thing', answer: 'A LOYALTY CARD' },
  { category: 'Thing', answer: 'JIGSAW PUZZLE' },
  { category: 'Thing', answer: 'A PACK OF CARDS' },
  { category: 'Thing', answer: 'RUSTY BICYCLE' },
  { category: 'Thing', answer: 'THE SPARE KEY' },
  { category: 'Thing', answer: 'A WOOLLY JUMPER' },
  { category: 'Thing', answer: 'BIRTHDAY CANDLES' },
  { category: 'Thing', answer: 'A TIN OF BISCUITS' },
  { category: 'Thing', answer: 'THE GOOD SCISSORS' },
  { category: 'Thing', answer: 'A PAPER ROUND' },
  { category: 'Thing', answer: 'A CRACKLING FIRE' },

  { category: 'Place', answer: 'THE BOTTOM OF THE GARDEN' },
  { category: 'Place', answer: 'A QUIET LIBRARY' },
  { category: 'Place', answer: 'THE SOUTH COAST' },
  { category: 'Place', answer: 'MOUNTAIN VILLAGE' },
  { category: 'Place', answer: 'THE CORNER SHOP' },
  { category: 'Place', answer: 'THE LOCAL PUB' },
  { category: 'Place', answer: 'A SEASIDE PIER' },
  { category: 'Place', answer: 'THE VILLAGE GREEN' },
  { category: 'Place', answer: 'A COUNTRY LANE' },
  { category: 'Place', answer: 'THE LAKE DISTRICT' },
  { category: 'Place', answer: 'A CROWDED PLATFORM' },
  { category: 'Place', answer: 'THE HIGH STREET' },
  { category: 'Place', answer: 'A CASTLE ON A HILL' },
  { category: 'Place', answer: 'THE ALLOTMENTS' },
  { category: 'Place', answer: 'THE SCOTTISH BORDERS' },
  { category: 'Place', answer: 'A MARKET TOWN' },
  { category: 'Place', answer: 'THE BACK GARDEN' },
  { category: 'Place', answer: 'A WINDSWEPT MOOR' },
  { category: 'Place', answer: 'THE GARDEN CENTRE' },
  { category: 'Place', answer: 'A CANAL TOWPATH' },

  { category: 'People', answer: 'MY OLDEST FRIEND' },
  { category: 'People', answer: 'THE NEW NEIGHBOURS' },
  { category: 'People', answer: 'A FAMILY OF FIVE' },
  { category: 'People', answer: 'THE SUNDAY CROWD' },
  { category: 'People', answer: 'A GOOD LISTENER' },
  { category: 'People', answer: 'THE QUIZ TEAM' },
  { category: 'People', answer: 'MY LITTLE BROTHER' },
  { category: 'People', answer: 'THE EARLY RISERS' },
  { category: 'People', answer: 'A HOUSE FULL OF COUSINS' },
  { category: 'People', answer: 'THE VILLAGE CHOIR' },

  { category: 'Occupation', answer: 'LIGHTHOUSE KEEPER' },
  { category: 'Occupation', answer: 'FLYING INSTRUCTOR' },
  { category: 'Occupation', answer: 'BOOKBINDER' },
  { category: 'Occupation', answer: 'PASTRY CHEF' },
  { category: 'Occupation', answer: 'DRY STONE WALLER' },
  { category: 'Occupation', answer: 'PIANO TUNER' },
  { category: 'Occupation', answer: 'FISHMONGER' },
  { category: 'Occupation', answer: 'BLACKSMITH' },
  { category: 'Occupation', answer: 'PARK RANGER' },
  { category: 'Occupation', answer: 'TRAIN DRIVER' },
  { category: 'Occupation', answer: 'CLOCKMAKER' },
  { category: 'Occupation', answer: 'BEEKEEPER' },
  { category: 'Occupation', answer: 'SIGN WRITER' },
  { category: 'Occupation', answer: 'MARKET TRADER' },
  { category: 'Occupation', answer: 'RIVER PILOT' },

  { category: 'Food & Drink', answer: 'STRAWBERRIES AND CREAM' },
  { category: 'Food & Drink', answer: 'HOT BUTTERED TOAST' },
  { category: 'Food & Drink', answer: 'A POT OF COFFEE' },
  { category: 'Food & Drink', answer: 'SUNDAY ROAST' },
  { category: 'Food & Drink', answer: 'LEMON MERINGUE PIE' },
  { category: 'Food & Drink', answer: 'FISH AND CHIPS' },
  { category: 'Food & Drink', answer: 'BEANS ON TOAST' },
  { category: 'Food & Drink', answer: 'A BACON SANDWICH' },
  { category: 'Food & Drink', answer: 'STICKY TOFFEE PUDDING' },
  { category: 'Food & Drink', answer: "SHEPHERD'S PIE" },
  { category: 'Food & Drink', answer: 'A CREAM TEA' },
  { category: 'Food & Drink', answer: 'TOAD IN THE HOLE' },
  { category: 'Food & Drink', answer: 'BANGERS AND MASH' },
  { category: 'Food & Drink', answer: "A PLOUGHMAN'S LUNCH" },
  { category: 'Food & Drink', answer: 'CRUMPETS AND JAM' },
  { category: 'Food & Drink', answer: 'RHUBARB CRUMBLE' },
  { category: 'Food & Drink', answer: 'A PINT OF BITTER' },
  { category: 'Food & Drink', answer: 'ELDERFLOWER CORDIAL' },
  { category: 'Food & Drink', answer: 'CHEESE AND PICKLE' },
  { category: 'Food & Drink', answer: 'A CHIP BUTTY' },
  { category: 'Food & Drink', answer: 'CUSTARD AND JELLY' },
  { category: 'Food & Drink', answer: 'A SAUSAGE ROLL' },
  { category: 'Food & Drink', answer: 'JAM ROLY POLY' },

  { category: 'Around the House', answer: 'THE KITCHEN SINK' },
  { category: 'Around the House', answer: 'A CREAKING FLOORBOARD' },
  { category: 'Around the House', answer: 'THE SPARE ROOM' },
  { category: 'Around the House', answer: 'THE LINEN CUPBOARD' },
  { category: 'Around the House', answer: 'THE AIRING CUPBOARD' },
  { category: 'Around the House', answer: 'A DRAUGHTY HALLWAY' },
  { category: 'Around the House', answer: 'THE WASHING LINE' },
  { category: 'Around the House', answer: 'UNDER THE STAIRS' },
  { category: 'Around the House', answer: 'THE FRONT DOORSTEP' },
  { category: 'Around the House', answer: 'A CLUTTERED LOFT' },
  { category: 'Around the House', answer: 'THE BATHROOM MIRROR' },
  { category: 'Around the House', answer: 'A LEAKY RADIATOR' },
  { category: 'Around the House', answer: 'THE JUNK DRAWER' },
  { category: 'Around the House', answer: 'NET CURTAINS' },

  { category: 'What Are You Doing?', answer: 'READING BY THE WINDOW' },
  { category: 'What Are You Doing?', answer: 'WALKING THE LONG WAY HOME' },
  { category: 'What Are You Doing?', answer: 'LEARNING TO SAIL' },
  { category: 'What Are You Doing?', answer: 'WATCHING THE RAIN' },
  { category: 'What Are You Doing?', answer: 'QUEUEING PATIENTLY' },
  { category: 'What Are You Doing?', answer: 'MOWING THE LAWN' },
  { category: 'What Are You Doing?', answer: 'MAKING A ROUND OF TEA' },
  { category: 'What Are You Doing?', answer: 'HAVING A LIE IN' },
  { category: 'What Are You Doing?', answer: 'DOING THE CROSSWORD' },
  { category: 'What Are You Doing?', answer: 'FEEDING THE DUCKS' },
  { category: 'What Are You Doing?', answer: 'PAINTING THE FENCE' },
  { category: 'What Are You Doing?', answer: 'CATCHING THE LAST TRAIN' },
  { category: 'What Are You Doing?', answer: 'PACKING A PICNIC' },
  { category: 'What Are You Doing?', answer: 'PUTTING THE BINS OUT' },
  { category: 'What Are You Doing?', answer: 'WAITING FOR THE BUS' },

  { category: 'Nature', answer: 'A FIELD OF BLUEBELLS' },
  { category: 'Nature', answer: 'FROST ON THE GRASS' },
  { category: 'Nature', answer: 'AN ANCIENT OAK TREE' },
  { category: 'Nature', answer: 'THE DAWN CHORUS' },
  { category: 'Nature', answer: 'A HEDGEROW IN SPRING' },
  { category: 'Nature', answer: 'CONKERS ON THE PATH' },
  { category: 'Nature', answer: 'A ROBIN IN WINTER' },
  { category: 'Nature', answer: 'MIST OVER THE FIELDS' },
  { category: 'Nature', answer: 'FALLING LEAVES' },
  { category: 'Nature', answer: 'A ROCK POOL' },
  { category: 'Nature', answer: 'HEATHER ON THE HILLS' },

  { category: 'Weather', answer: 'A BRIGHT SPELL' },
  { category: 'Weather', answer: 'SCATTERED SHOWERS' },
  { category: 'Weather', answer: 'A HARD FROST' },
  { category: 'Weather', answer: 'GALES ON THE COAST' },
  { category: 'Weather', answer: 'MUGGY AND CLOSE' },
  { category: 'Weather', answer: 'DRIZZLE ALL DAY' },
  { category: 'Weather', answer: 'A BLUSTERY MORNING' },
  { category: 'Weather', answer: 'SUNNY INTERVALS' },

  { category: 'Pastime', answer: 'PUB QUIZ NIGHT' },
  { category: 'Pastime', answer: 'A LONG COUNTRY WALK' },
  { category: 'Pastime', answer: 'BIRD WATCHING' },
  { category: 'Pastime', answer: 'SUNDAY LEAGUE FOOTBALL' },
  { category: 'Pastime', answer: 'BAKING A SPONGE CAKE' },
  { category: 'Pastime', answer: 'A CAR BOOT SALE' },
  { category: 'Pastime', answer: 'A GAME OF DARTS' },
  { category: 'Pastime', answer: 'KNITTING BY THE FIRE' },
  { category: 'Pastime', answer: 'SEA SWIMMING' },
  { category: 'Pastime', answer: 'A BRASS BAND CONCERT' },
];

// ── Small pure helpers ─────────────────────────────────────────────────


/** How many seats this game was set up for. Derived, so it cannot disagree. */
export function seatCount(state: WofState): number {
  return state.bank.length;
}

/** Replace every letter nobody has called with BLANK. Spaces and punctuation stay. */
export function mask(answer: string, called: readonly string[]): string {
  const known = new Set(called);
  return [...answer]
    .map((ch) => (ALPHABET.includes(ch) && !known.has(ch) ? BLANK : ch))
    .join('');
}

/**
 * Letters only, so a solver is judged on the phrase rather than on their
 * punctuation and spacing: "A BAKER'S DOZEN" accepts "a bakers dozen".
 */
export function normalize(text: string): string {
  return text.slice(0, MAX_GUESS).toUpperCase().replace(/[^A-Z]/g, '');
}

export function occurrences(answer: string, letter: string): number {
  let found = 0;
  for (const ch of answer) if (ch === letter) found++;
  return found;
}

/** Letters from `pool` that are still available. */
export function remaining(pool: string, called: readonly string[]): string[] {
  return [...pool].filter((ch) => !called.includes(ch));
}

/** Seats holding the top score. More than one means nobody has won outright. */
export function leaders(state: WofState): number[] {
  const best = Math.max(...state.score);
  return state.score.flatMap((value, seat) => (value === best ? [seat] : []));
}

function isSolved(state: WofState): boolean {
  const known = new Set(state.called);
  for (const ch of state.answer) {
    if (ALPHABET.includes(ch) && !known.has(ch)) return false;
  }
  return true;
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

function count(n: number): string {
  return NUMBERS[n] ?? String(n);
}

function clone(state: WofState): WofState {
  return {
    ...state,
    used: [...state.used],
    called: [...state.called],
    // Arrays and objects survive a spread as the same reference. Leaving any of
    // them shared means a derived state can write through to the snapshot it
    // came from.
    bank: [...state.bank],
    score: [...state.score],
    wedge: state.wedge === null ? null : ({ ...state.wedge } as Wedge),
    note: state.note === null ? null : { ...state.note },
  };
}

function drawPuzzle(used: readonly string[], rng: Rng): Puzzle {
  const pool = PUZZLES.filter((puzzle) => !used.includes(puzzle.answer));
  // The bank is far larger than ROUNDS, so this cannot run dry — but a reducer
  // that could hand back undefined is a reducer that eventually does.
  const source = pool.length > 0 ? pool : PUZZLES;
  return source[pick(rng, source.length)];
}

/**
 * Hand over to the next seat round the table. The wedge goes with the turn: it
 * means "what the player to move spun", so leaving it in place would show the
 * next player someone else's $900.
 */
function passTurn(state: WofState): void {
  state.phase = 'spin';
  state.wedge = null;
  // `wedgeAt` deliberately survives: it is where the wheel is standing, and
  // the next player watches it spin away from there.
  state.finds = 0;
  state.turn = (state.turn + 1) % seatCount(state);
}

/**
 * A wrong guess: a letter that is not there, a vowel that is not there, or a
 * failed attempt at the phrase. The turn ends on it, the way it does on the
 * show — a guess costs the wheel, which is what makes naming a letter you are
 * only half sure of a decision worth making.
 *
 * `what` is the sentence so far; this appends what it cost. `passTurn` clears
 * the spin as it goes: a wedge means "what the player to move spun".
 */
function strike(state: WofState, seat: number, what: string): void {
  state.note = { seat, text: `${what} The turn moves on.` };
  passTurn(state);
}

/**
 * A letter that was there: bank the find, and hand the wheel on once the
 * player has had `FINDS_PER_TURN` of them.
 *
 * Without this a good turn was the whole round — find a letter, spin again,
 * find another, and the player who got going never gave the wheel back while
 * everyone else watched. The cap is the same three as `strike`'s on purpose: a
 * turn is three letters, and it ends whichever way you spend them.
 *
 * Only called on a round still running. Finishing the puzzle on your third
 * find takes the round, and "the turn moves on" is not a thing to say about a
 * round that has ended — so the caller checks `roundOver` first. Like
 * `strike`, this appends to the note already standing rather than replacing
 * it: the player still needs to read what their letter paid.
 */
function credit(state: WofState, seat: number): void {
  state.finds += 1;
  if (state.finds < FINDS_PER_TURN) return;
  const sentence = state.note === null ? '' : `${state.note.text} `;
  state.note = {
    seat,
    text: `${sentence}That is ${count(FINDS_PER_TURN)} — the turn moves on.`,
  };
  passTurn(state);
}

/**
 * Close the round out. `seat` is whoever finished the puzzle.
 *
 * Two rules live here, and they are the ones that decide what the game feels
 * like:
 *
 * 1. **Solving pays `SOLVE_BONUS`**, on top of whatever the round already won.
 *    Spotting the phrase is the skill this game is about, so it is the thing
 *    worth the most.
 *
 * 2. **Everybody banks what they won**, not only the solver. That money was
 *    won letter by letter and it is theirs; taking it away because somebody
 *    else saw the phrase first made every round a write-off from second place,
 *    and made calling letters for a player who was behind pointless.
 *
 * Bankrupt still takes a bank to nothing, which is what keeps it frightening —
 * it just no longer has a rival in "somebody else solved it".
 */
function awardRound(state: WofState, seat: number): void {
  state.bank[seat] += SOLVE_BONUS;
  state.score = state.score.map((banked, index) => banked + state.bank[index]);
  state.roundOver = true;
  state.phase = 'spin';
  state.wedge = null;
  state.finds = 0;

  if (state.round >= ROUNDS) {
    state.over = true;
    return;
  }
  // The next round opens with the next player round the table, so taking one
  // round does not compound into the first spin of the next.
  state.starter = (state.starter + 1) % seatCount(state);
  state.turn = state.starter;
}

/**
 * A correct call that fills in the last letter takes the round. There is
 * nothing left to solve, and no state worth having where the board is complete
 * and the game is still waiting to be told so.
 */
function finishIfSolved(state: WofState, seat: number): void {
  if (!isSolved(state)) return;
  if (state.note) state.note = { seat, text: `${state.note.text} That's the puzzle.` };
  awardRound(state, seat);
}

function beginRound(state: WofState, rng: Rng): WofState {
  const used = [...state.used, state.answer];
  const puzzle = drawPuzzle(used, rng);
  return {
    ...clone(state),
    round: state.round + 1,
    category: puzzle.category,
    answer: puzzle.answer,
    used,
    called: [],
    turn: state.starter,
    phase: 'spin',
    wedge: null,
    // A fresh puzzle gets a fresh wheel, standing where it was left.
    wedgeAt: null,
    travel: 0,
    finds: 0,
    bank: state.bank.map(() => 0),
    note: null,
    roundOver: false,
  };
}

// ── Moves ──────────────────────────────────────────────────────────────

/**
 * How far a flick may miss what it aimed at, in wedges either way.
 *
 * The point of a grabbable wheel is that the throw decides, so this is small —
 * but it is not nothing. Without it the curve in `spinTravel` is a lookup
 * table, and a player with a steady hand and a slow-motion screen recording
 * could learn to land on the wedge they wanted. Five wedges of scatter is
 * fifty degrees, which no thumb can correct for, and still leaves a hard throw
 * plainly further round than a gentle one.
 */
const FLICK_DRIFT = 2;

/**
 * `power` is the flick, 0 to 1, or undefined when the wheel was spun by the
 * button and nobody threw it.
 *
 * Two paths on purpose, and they differ in which end is decided first. A
 * button spin picks the wedge and works out a plausible journey to it, which
 * is what the game has always done and what every seeded test here relies on.
 * A flick picks the journey — that is what the player did — and finds out
 * where it ended up. Both consume exactly one draw from `rng`, so neither can
 * shift the other's sequence.
 */
function spin(state: WofState, seat: number, rng: Rng, power?: number): MoveResult<WofState> {
  if (state.phase !== 'spin') return { ok: false, error: 'Name your consonant first.' };

  // Where the pointer is standing now. Null means the wheel has never been
  // spun this round, and the board draws it at wedge zero.
  const from = state.wedgeAt ?? 0;
  let at: number;
  let travel: number;
  if (power === undefined) {
    at = pick(rng, WHEEL.length);
    // Three whole turns and then round to the wedge. The board needs a
    // distance either way, and a button press has none of its own.
    travel = 3 * WHEEL.length + (((at - from) % WHEEL.length) + WHEEL.length) % WHEEL.length;
  } else {
    travel = Math.max(1, spinTravel(power) + pick(rng, FLICK_DRIFT * 2 + 1) - FLICK_DRIFT);
    at = (from + travel) % WHEEL.length;
  }
  const wedge = WHEEL[at];
  const next = clone(state);
  next.wedge = wedge;
  // Where the pointer now is, and the fact that it moved at all — the board
  // needs both to spin the wheel to the right place.
  next.wedgeAt = at;
  next.travel = travel;
  next.spins += 1;

  if (wedge.kind === 'bankrupt') {
    const lost = next.bank[seat];
    next.bank[seat] = 0;
    next.note = {
      seat,
      text: lost > 0 ? `spun Bankrupt and lost ${money(lost)}.` : 'spun Bankrupt.',
    };
    passTurn(next);
    return { ok: true, state: next };
  }

  if (wedge.kind === 'lose-turn') {
    next.note = { seat, text: `spun ${wedgeName(wedge)}.` };
    passTurn(next);
    return { ok: true, state: next };
  }

  // Every consonant already called would otherwise strand the player in a
  // phase whose only legal move no longer exists.
  if (remaining(CONSONANTS, state.called).length === 0) {
    next.note = { seat, text: `spun ${money(wedge.value)}, but every consonant is gone.` };
    passTurn(next);
    return { ok: true, state: next };
  }

  next.phase = 'call';
  next.note = { seat, text: `spun ${money(wedge.value)}.` };
  return { ok: true, state: next };
}

function callConsonant(state: WofState, seat: number, letter: string): MoveResult<WofState> {
  const wedge = state.wedge;
  // Unreachable while `phase` and `wedge` agree — and checked anyway, because a
  // reducer that trusts its own invariants is one refactor from a crash.
  if (!wedge || wedge.kind !== 'cash') return { ok: false, error: 'Spin the wheel first.' };

  const hits = occurrences(state.answer, letter);
  const next = clone(state);
  next.called = [...state.called, letter];

  if (hits === 0) {
    strike(next, seat, `called ${letter}. There is no ${letter}.`);
    return { ok: true, state: next };
  }

  const won = hits * wedge.value;
  next.bank[seat] += won;
  // The spin is spent whether or not it paid; another consonant needs another spin.
  next.phase = 'spin';
  next.wedge = null;
  next.note = {
    seat,
    text: `found ${count(hits)} ${letter}${hits === 1 ? '' : "'s"} — ${money(won)}.`,
  };
  finishIfSolved(next, seat);
  if (!next.roundOver) credit(next, seat);
  return { ok: true, state: next };
}

function buyVowel(state: WofState, seat: number, letter: string): MoveResult<WofState> {
  if (state.bank[seat] < VOWEL_COST) {
    return { ok: false, error: `A vowel costs ${money(VOWEL_COST)}. Spin for it first.` };
  }

  const next = clone(state);
  next.called = [...state.called, letter];
  // Charged either way: the money buys the question, not the answer.
  next.bank[seat] -= VOWEL_COST;

  const hits = occurrences(state.answer, letter);
  if (hits === 0) {
    strike(next, seat, `bought ${letter}. There is no ${letter}.`);
    return { ok: true, state: next };
  }

  next.note = {
    seat,
    text:
      hits === 1
        ? `bought ${letter}. Just the one.`
        : `bought ${letter} — ${count(hits)} of them.`,
  };
  finishIfSolved(next, seat);
  if (!next.roundOver) credit(next, seat);
  return { ok: true, state: next };
}

function solve(state: WofState, seat: number, guess: string): MoveResult<WofState> {
  if (state.phase !== 'spin') return { ok: false, error: 'Name your consonant first.' };

  const attempt = normalize(guess);
  if (!attempt) return { ok: false, error: 'Type an answer to solve with.' };

  const next = clone(state);
  if (attempt !== normalize(state.answer)) {
    strike(next, seat, 'guessed, and got it wrong.');
    return { ok: true, state: next };
  }

  // Fill the board in, so the round ends showing the whole phrase.
  next.called = [
    ...new Set([...state.called, ...state.answer].filter((ch) => ALPHABET.includes(ch))),
  ];
  next.note = { seat, text: 'solved it.' };
  awardRound(next, seat);
  return { ok: true, state: next };
}

// ── The definition ─────────────────────────────────────────────────────

export const wheel: GameDefinition<WofState, WofMove> = {
  id: GAME_MANIFEST.wheel.id,
  name: GAME_MANIFEST.wheel.name,
  minPlayers: GAME_MANIFEST.wheel.minPlayers,
  maxPlayers: GAME_MANIFEST.wheel.maxPlayers,

  setup(playerCount, rng): WofState {
    // However many seats the room was opened for. Clamped rather than trusted:
    // this is the one place the rest of the app's arithmetic gets baked in, and
    // a zero here would make `% seats` divide by nothing.
    const seats = Math.min(
      Math.max(Math.trunc(playerCount) || GAME_MANIFEST.wheel.minPlayers, GAME_MANIFEST.wheel.minPlayers),
      GAME_MANIFEST.wheel.maxPlayers,
    );
    // Nobody has an opening advantage: who starts is decided by the wheel.
    const starter = pick(rng, seats);
    const puzzle = drawPuzzle([], rng);
    return {
      round: 1,
      category: puzzle.category,
      answer: puzzle.answer,
      used: [],
      called: [],
      starter,
      turn: starter,
      phase: 'spin',
      wedge: null,
      wedgeAt: null,
      spins: 0,
      travel: 0,
      finds: 0,
      bank: Array<number>(seats).fill(0),
      score: Array<number>(seats).fill(0),
      note: null,
      roundOver: false,
      over: false,
    };
  },

  applyMove(state, move, seat, rng): MoveResult<WofState> {
    if (state.over) return { ok: false, error: 'The game is already over.' };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };
    if (!move || typeof move !== 'object') return { ok: false, error: 'Unknown move.' };

    if (state.roundOver) {
      if (move.type !== 'next') return { ok: false, error: 'That round is finished.' };
      return { ok: true, state: beginRound(state, rng) };
    }
    if (move.type === 'next') return { ok: false, error: 'This round is still going.' };

    if (move.type === 'spin') {
      // Anything but a number means "no flick" — the button, an old client, or
      // one making things up. `spinTravel` clamps the range; this is only
      // deciding which of the two spins happened.
      const power = typeof move.power === 'number' ? move.power : undefined;
      return spin(state, seat, rng, power);
    }

    if (move.type === 'letter') {
      const letter = String(move.letter ?? '').toUpperCase();
      if (letter.length !== 1 || !ALPHABET.includes(letter)) {
        return { ok: false, error: 'That is not a letter.' };
      }
      if (state.called.includes(letter)) {
        return { ok: false, error: `${letter} has already been called.` };
      }

      const vowel = VOWELS.includes(letter);
      if (state.phase === 'call') {
        if (vowel) return { ok: false, error: 'You spun for a consonant — name one.' };
        return callConsonant(state, seat, letter);
      }
      if (!vowel) return { ok: false, error: 'Spin the wheel before naming a consonant.' };
      return buyVowel(state, seat, letter);
    }

    if (move.type === 'solve') return solve(state, seat, String(move.answer ?? ''));

    return { ok: false, error: 'Unknown move.' };
  },

  /**
   * Everything a client is allowed to know. The answer is the only secret in
   * the project, and this is the only thing keeping it — the server sends
   * whatever comes back from here.
   */
  view(state) {
    // Every seat sees the same board: what is hidden is hidden from everyone.
    // Once the round is over the phrase is public, which is what lets the board
    // show what it was.
    // A copy either way. Returning `state` itself here would hand a caller a
    // live reference to reducer state on exactly one branch -- harmless while
    // every caller serialises the result, and a trap the first time one does
    // not. The two branches should differ in what they mask, not in that.
    if (state.roundOver) return { ...state };
    return { ...state, answer: mask(state.answer, state.called) };
  },

  turn(state) {
    return state.over ? null : state.turn;
  },

  canAct(state, seat) {
    return !state.over && state.turn === seat;
  },

  isOver(state) {
    return state.over;
  },

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.over) {
      const top = leaders(state);
      const best = money(state.score[top[0]]);
      if (top.length > 1) {
        const tied = top.map(nameFor);
        return `A tie at ${best} — ${tied.slice(0, -1).join(', ')} and ${tied[tied.length - 1]}`;
      }
      return `${nameFor(top[0])} wins with ${best}`;
    }
    if (state.roundOver) return `${nameFor(state.turn)} to start round ${state.round + 1}`;

    // Letters left in the streak is worth saying out loud once the player has
    // found any: it is the only part of the turn's shape that is not obvious
    // from the board, since the other way a turn ends takes exactly one guess.
    const left = FINDS_PER_TURN - state.finds;
    const tail = left < FINDS_PER_TURN ? ` — ${count(left)} left` : '';
    if (state.phase === 'call') return `${nameFor(state.turn)} to name a consonant${tail}`;
    return `${nameFor(state.turn)} to spin or solve${tail}`;
  },
};
