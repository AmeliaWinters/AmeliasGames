/**
 * The browser half of `tint.ts`: a multiply an `<img>` can wear.
 *
 * **Why a filter and not a canvas.** Recolouring a PNG on a canvas means
 * waiting for it to decode, which makes drawing an avatar asynchronous, which
 * makes every consumer of `<Avatar>` asynchronous, for a 64x64 sprite. An SVG
 * `feColorMatrix` is applied by the compositor to whatever the `<img>` has
 * loaded, so the avatar draws on the first frame with the right colours and
 * nothing above this file learns that recolouring exists.
 *
 * **One `<svg>` for the whole document, keyed by colour.** A customiser screen
 * is thirty avatars of fifteen layers, and most of those layers are the same
 * hair in the same colour; a filter per layer would be four hundred elements
 * saying the same six numbers. Filters are global by id, so they are minted
 * once per distinct colour and reused. The lifetime is the page: a couple of
 * dozen tiny elements that nothing has to garbage collect, against a cache
 * that would have to know when a colour stopped being worn.
 *
 * `color-interpolation-filters="sRGB"` is the load bearing attribute here. The
 * SVG default is linearRGB, which is a different multiply and comes out
 * several steps light. See the note in `tint.ts`.
 */

import { tintMatrix } from './tint.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOST_ID = 'avatar-tints';

const minted = new Set<string>();

/** `#8f7f76` -> `avatar-tint-8f7f76`. Ids may not start with a digit. */
function filterId(hex: string): string {
  return `avatar-tint-${hex.replace('#', '').toLowerCase()}`;
}

function host(): SVGSVGElement | null {
  if (typeof document === 'undefined') return null;
  const found = document.getElementById(HOST_ID);
  if (found) return found as unknown as SVGSVGElement;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('id', HOST_ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Not `display: none`: a filter inside an undisplayed subtree is not
  // guaranteed to resolve, and Firefox has historically declined to. Zero
  // sized and out of flow instead, which every browser does resolve.
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  document.body.appendChild(svg);
  return svg;
}

/**
 * The CSS `filter` value that multiplies an image by `hex`, minting the
 * filter if this is the first time the page has asked for that colour.
 *
 * Returns an empty string where there is no document, which is every test
 * that renders an avatar without a DOM and the Node contact sheet. Those get
 * an untinted sprite rather than an exception, which is the same bargain
 * `drawLayered` strikes for a missing layer: half drawn beats not drawn.
 */
export function tintFilter(hex: string): string {
  const id = filterId(hex);
  if (!minted.has(id)) {
    const svg = host();
    if (!svg) return '';
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', tintMatrix(hex));
    filter.appendChild(matrix);
    svg.appendChild(filter);
    minted.add(id);
  }
  return `url(#${id})`;
}
