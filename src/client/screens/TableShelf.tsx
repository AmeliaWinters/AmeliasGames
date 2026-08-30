/**
 * The shelf on the setup screen: one card per game, with the game you last sat
 * down to standing above the rest.
 *
 * A card is a name, a picture and two facts, and none of it reads the room,
 * which is why it can live away from the shell. `Setup.tsx` is the page that
 * arranges them.
 */
import type { GameEntry } from "../../shared/games/manifest.js";
import { CardArt } from "../art.js";


/**
 * How many can play, as a range.
 *
 * It was a row of pips for a while, one per seat with the first `minPlayers`
 * of them filled, on the reasoning that "can the six of us play this" is a
 * question a shape answers faster than a figure. In practice the shape had to
 * be counted before it could be compared, and eight of them at 5px is a
 * smudge; "2-4" is read at a glance and is the wording the games themselves
 * use. A game seating one says so with a single figure rather than "1-1".
 *
 * The word is not in it, so it is put back for anyone listening rather than
 * looking. See `seatLabel`.
 */
function seatRange(table: GameEntry): string {
  return table.minPlayers === table.maxPlayers
    ? `${table.minPlayers}`
    : `${table.minPlayers}-${table.maxPlayers}`;
}

/** The same range, said out loud, for the card's accessible name. */
function seatLabel(table: GameEntry): string {
  // "1 players" was what a fourteenth game seating one turned this into. The
  // figure on the card is a numeral and reads fine either way; this is the
  // string a screen reader says out loud, so it has to be a sentence.
  if (table.minPlayers === table.maxPlayers) {
    return table.minPlayers === 1 ? 'on your own' : `${table.minPlayers} players`;
  }
  return `${table.minPlayers} to ${table.maxPlayers} players`;
}

/**
 * One game on the shelf: its table, mid-play, with a way to sit down at it.
 *
 * A button rather than a radio, and that is the whole change to this screen.
 * The card used to pick a game which a button 957px further down then started,
 * so the label that named your choice ("Start Connect Four") was read at the
 * one moment your choice had scrolled off the top. Pressing the table you want
 * is one act instead of two, and it removes the only control on the screen that
 * had to be hunted for.
 *
 * What that costs is the confirmation step, and the answer to a mis-tap is
 * that a room is free: nothing is spent, nobody is told, and the wordmark is
 * the way back. What it saves is the `.picked` state, the Start button, and
 * the two of them having to agree about which game they meant.
 *
 * Every card is its own tab stop, which is what a list of buttons is. No
 * roving tabindex and no `aria-checked`: there is nothing selected here any
 * more, so there is no selection to model.
 */
export function TableCard({
  table,
  onStart,
}: {
  table: GameEntry;
  onStart(gameId: string): void;
}) {
  return (
    <button className="game" data-game={table.id} onClick={() => onStart(table.id)}>
      <CardArt gameId={table.id} />
      <span className="name">{table.name}</span>
      <span className="blurb">{table.blurb}</span>
      <TableFacts table={table} />
    </button>
  );
}

/**
 * The table you left, laid out the way a table is: wide.
 *
 * The featured card used to be an ordinary card at twice the size, which meant
 * a portrait crop stretched across two columns with its name underneath. A
 * card that is going to be the biggest thing on the screen may as well be the
 * shape of the thing it is showing, so the motif takes one side and the words
 * take the other -- and it gains the one control the shelf does not have: a
 * verb. "Play again" is a different offer from "Connect Four", and it is the
 * offer this card is actually making.
 *
 * The art stays a 5:2 well at phone width, stacked above the words, because
 * that is the crop all thirteen motifs were composed against and a hero is not
 * worth re-drawing them for. Past 560px it takes the right-hand half instead;
 * `picker.css` says what that costs the two motifs drawn in SVG.
 */
export function HeroCard({
  table,
  onStart,
}: {
  table: GameEntry;
  onStart(gameId: string): void;
}) {
  return (
    <button className="game featured" data-game={table.id} onClick={() => onStart(table.id)}>
      <CardArt gameId={table.id} />
      <span className="face">
        <span className="resume">Last played</span>
        <span className="name">{table.name}</span>
        <span className="blurb">{table.blurb}</span>
        <TableFacts table={table} />
        <span className="cta">Play again</span>
      </span>
    </button>
  );
}


/**
 * Who can play, and how long it takes, on one line under the blurb.
 *
 * The seats used to be a chip stamped on the corner of the motif, which was
 * the only place they fitted while the card had nothing else to say. They have
 * company now -- see `minutes` in the manifest -- and two facts about the same
 * game belong on one line in the card body, where neither of them is lying on
 * top of a crop of a board.
 *
 * Both are written in shorthand and both are hidden from anyone listening,
 * because a figure under a person, and a tilde, are notation rather than
 * sentences. The line underneath is the same two facts, said once, in the order they are read.
 */
function TableFacts({ table }: { table: GameEntry }) {
  return (
    <span className="facts">
      <span className="count" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false">
          {/* A bust rather than a full figure: at 11px a body is a smudge, and
              head-and-shoulders survives the size. */}
          <circle cx="8" cy="5" r="2.6" />
          <path d="M2.6 14c0-3 2.4-5 5.4-5s5.4 2 5.4 5z" />
        </svg>
        {seatRange(table)}
      </span>
      <span className="mins" aria-hidden="true">
        ~{table.minutes} min
      </span>
      <span className="sr-only">
        {seatLabel(table)}, about {table.minutes} minutes
      </span>
    </span>
  );
}
