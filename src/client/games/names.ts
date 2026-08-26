/**
 * What a board calls a seat.
 *
 * Eleven boards had written this out for themselves, nine of them character for
 * character, and the copies had already started to disagree: two guarded null
 * and the rest did not, and one reached for `??` where the others used `||`,
 * which prints an empty span for a player who joined without typing a name.
 * None of that is a decision an individual board should be making, because the
 * answer is the same on all of them.
 *
 * `namer` returns a function rather than taking the seat at every call, because
 * a board says this twenty times in one render and `nameFor(state.turn)` is the
 * sentence it is building. Threading `names` and `seat` through each of those
 * would have traded one duplication for a noisier one.
 */

/**
 * The name on the seat, never the second person.
 *
 * `||` and not `??`: a seat with no name yet holds `""`, not `undefined`, and
 * an empty span where a name goes is how a board silently loses a player.
 */
export function seatName(names: string[], index: number): string {
  return names[index] || `Player ${index + 1}`;
}

/**
 * How this reader's board addresses a seat: "You" for their own, the name for
 * anyone else's.
 *
 * The returned function takes null because several boards ask about a seat that
 * may not exist yet -- a game with nobody to move -- and the empty string is
 * what reads correctly in the sentences they build around it.
 */
export function namer(names: string[], seat: number | null) {
  return (index: number | null): string =>
    index === null ? "" : index === seat ? "You" : seatName(names, index);
}
