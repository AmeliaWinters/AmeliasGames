/**
 * Whether this device has asked for less movement.
 *
 * Read at the moment a movement is about to start rather than subscribed to,
 * because that is when the answer matters: every caller is deciding whether to
 * animate a thing or to jump straight to its resolved state, and a preference
 * changed halfway through a spin should not strand it.
 *
 * Its own module because three places were about to grow their own copy: the
 * Wheel had the first, and the dice tray and its reveal both arrived with a
 * duplicate saying "Matches the Wheel's." in a comment. A comment claiming two
 * things match is not a mechanism for keeping them matching.
 *
 * `typeof matchMedia === 'function'` guards a non-browser render, since tests
 * import board components directly and there is no window there.
 */
export function wantsStillness(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
