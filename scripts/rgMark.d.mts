/**
 * Declarations for the mark's grid, which is a `.mjs` because it is run by
 * Node directly and imported by the icon scripts beside it.
 *
 * `rgMark.test.ts` imports it to hold the checked-in copy in `src/client` to
 * the generator's own shape, and without this `tsc -p tsconfig.client.json`
 * fails the whole `typecheck` script on an implicit `any`. Written by hand
 * rather than by porting the script: the script is what the build runs, and a
 * build step that has to be compiled before it can draw a logo is the worse
 * trade.
 */
export const R: string[];
export const G: string[];
export const GAP: number;
export const MARK_W: number;
export const MARK_H: number;
export const DAYLIGHT: { ground: string; ink: string };
export const STAGE: { ground: string; ink: string };
export function runs(): { x: number; y: number; len: number }[];
