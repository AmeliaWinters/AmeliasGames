/**
 * What a player carries between games.
 *
 * This module imports **nothing**, and that is load-bearing rather than tidy.
 * The profile screen is drawn on the client, the client has no dictionary and
 * may never have one (`bundle.test.ts` builds the real bundle and greps it),
 * and every word on this object therefore has to arrive carrying its own gloss,
 * script and rank. One convenience import here of anything that reaches
 * `chainWords.ts` would put sixty thousand Polish inflections on the phone of
 * everybody who opens the lobby. See `Known` for the same point said again in
 * the place somebody would be tempted to undo it.
 *
 * The shape here is deliberately dull: arrays and numbers, no Maps, no Sets,
 * nothing that does not survive `JSON.parse`. It is persisted by two adapters
 * that store it very differently, and it is exported to a file the player
 * keeps.
 */

/*
  The shapes, the queries, the migration and the view are their own files now.
  This one is the door: the comment above is the reason the module exists and
  it holds for all four, so there is one import path to keep honest rather than
  four. Everything else in the app names this file.
*/
export * from './profileShapes.js';
export * from './profileQueries.js';
export * from './profileMigrate.js';
export * from './profileView.js';
