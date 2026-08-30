/**
 * An avatar, at one of two crops.
 *
 * The whole of the compositing: absolutely positioned layers in a fixed z
 * order on a fixed canvas, with the canvas scaled so the wanted rectangle
 * fills the frame. The stage is placed in percentages, so one component serves
 * a 26px chip and a 400px figure with no second set of numbers, and so the art
 * can change resolution without touching this. The layers on it are placed in
 * pixels off the measured stage, which is a later and narrower fix: see
 * `layerBox` for the pixel of daylight it closes.
 *
 * The crop arithmetic, since it is the one thing here worth checking: the
 * stage is sized `canvas / crop` and offset by `-crop.origin / crop`, both as
 * percentages of the frame. `avatar.test.ts` pins it against the bust
 * rectangle each set declares, because a crop that is wrong by ten percent is
 * a chip full of forehead and nobody files that as a bug.
 *
 * **Always `aria-hidden`.** Every place this is drawn already has the player's
 * name beside it in text, and an avatar that announced itself would make the
 * account chip say the name twice.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { setById, starterFor } from './manifest.js';
import { tintFilter } from './tintFilter.js';
import { assetUrl } from './urls.js';
import type { AvatarSet, Loadout, Rect } from './types.js';

export type Crop = 'bust' | 'full';

/**
 * The stage's size and offset, as percentages of the frame.
 *
 * A function, and exported, so the arithmetic can be pinned without a DOM.
 * `avatar.test.ts` checks it against each set's declared bust: a crop wrong by
 * ten percent is a chip full of forehead, and nobody files that as a bug.
 */
export function stageStyle(canvas: { w: number; h: number }, frame: Rect) {
  return {
    width: `${(canvas.w / frame.w) * 100}%`,
    height: `${(canvas.h / frame.h) * 100}%`,
    left: `${(-frame.x / frame.w) * 100}%`,
    top: `${(-frame.y / frame.h) * 100}%`,
  };
}

/** The rectangle of the canvas one crop shows. */
export function cropRect(set: { canvas: { w: number; h: number }; bust: Rect }, crop: Crop): Rect {
  return crop === 'bust' ? set.bust : { x: 0, y: 0, w: set.canvas.w, h: set.canvas.h };
}

/**
 * One layer's box in stage pixels, snapped to the canvas grid.
 *
 * The reason this exists rather than four percentages: a part is two trimmed
 * sprites, a colour mask and the line art over it, and their boxes are
 * deliberately different -- `basehair/bob` is C at 8,3 47x45 and L at 7,2
 * 49x47, because the line is drawn a pixel outside the fill it outlines. At
 * 240px the kit's 64 units scale by 3.75, so C's left lands on 30.0 and L's on
 * 26.25, and `image-rendering: pixelated` then snaps each image's *own* pixel
 * grid to whole device pixels from a different fraction. The two grids
 * disagree and the line comes out one pixel off the hair. It is exact at 256
 * and wrong at nearly every other size, which is why it read as "only when
 * scaled up".
 *
 * So both edges are rounded off the same continuous canvas grid before either
 * image is placed: `round(x * s)` and `round((x + w) * s)`. Every layer then
 * shares its edges with every other layer exactly, at any scale, and the
 * widths stay within a pixel of the art's proportions. Rounding the width
 * instead of the right edge would not do it -- that is two roundings of two
 * different quantities and it drifts.
 *
 * The stage's own position is free to be fractional: it is one box, so every
 * layer inside it carries the same sub-pixel offset and they snap together.
 */
export function layerBox(
  layer: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
  canvas: { w: number; h: number },
  /**
   * Device pixels per CSS pixel. The grid that matters is the screen's, not
   * the stylesheet's: at 1.5x an integer CSS pixel is still half a device
   * pixel, and two layers a CSS pixel apart snap to two different device
   * grids, which is the same bug one step down.
   */
  dpr = 1,
) {
  const sx = (size.w / canvas.w) * dpr;
  const sy = (size.h / canvas.h) * dpr;
  const snap = (v: number) => Math.round(v) / dpr;
  const left = snap(layer.x * sx);
  const top = snap(layer.y * sy);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${snap((layer.x + layer.w) * sx) - left}px`,
    height: `${snap((layer.y + layer.h) * sy) - top}px`,
  };
}

/** The same box as percentages, for the render before the stage is measured. */
export function layerPercent(
  layer: { x: number; y: number; w: number; h: number },
  canvas: { w: number; h: number },
) {
  return {
    left: `${(layer.x / canvas.w) * 100}%`,
    top: `${(layer.y / canvas.h) * 100}%`,
    width: `${(layer.w / canvas.w) * 100}%`,
    height: `${(layer.h / canvas.h) * 100}%`,
  };
}

/**
 * The stage's size in CSS pixels, or null until it has been laid out.
 *
 * An observer rather than a one-off measure, because the same avatar is a 26px
 * chip and a 400px figure and the popover it lives in resizes under it.
 */
function useStageSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number; dpr: number } | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (box.width <= 0 || box.height <= 0) return;
      setSize((was) =>
        was && was.w === box.width && was.h === box.height && was.dpr === dpr
          ? was
          : { w: box.width, h: box.height, dpr },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // Dragging a window between two displays changes the device grid without
    // changing the box, and the observer never fires for it.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, [ref]);
  return size;
}

interface Props {
  loadout: Loadout | null;
  crop: Crop;
  /**
   * The letter to fall back to. Somebody who has never opened the customiser
   * has no avatar, and an empty circle where their initial used to be is a
   * regression rather than a feature.
   */
  initial: string;
  className?: string;
}

export function Avatar({ loadout, crop, initial, className }: Props) {
  const stageRef = useRef<HTMLSpanElement>(null);
  const size = useStageSize(stageRef);
  const set = loadout ? setById(loadout.set) : undefined;
  if (!loadout || !set) {
    return (
      <span className={className} aria-hidden="true">
        {initial}
      </span>
    );
  }

  const drawn = set.draw(loadout);
  const canvas = drawn.canvas;
  const frame = cropRect(set, crop);
  const stage = stageStyle(canvas, frame);

  // The frame is the shape of the crop, said by the art rather than by the
  // stylesheet. The stage fills its frame in both directions, so a frame of
  // the wrong shape does not letterbox, it stretches: the 64x64 kit in the
  // customiser's 7/8 figure box came out 240x274, a vertical unit of 4.29px
  // against a horizontal 3.75px. Pixel art on two grids at once is the line
  // art and the colour under it disagreeing by a pixel.
  //
  // Only ever the *shape*. Every caller still sets the size, and one that
  // sets both width and height, like the 44px thumbnails, overrides this by
  // the ordinary rules.
  const shape = { aspectRatio: `${frame.w} / ${frame.h}` };

  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      data-crop={crop}
      data-set={set.id}
      aria-hidden="true"
      style={shape}
    >
      <span className="avatar-stage" style={stage} ref={stageRef}>
        {drawn.layers.map((layer) => {
          if (layer.kind === 'fill') {
            return (
              <span
                key={layer.key}
                className="avatar-fill"
                style={{ background: `var(${layer.token})` }}
              />
            );
          }
          return (
            <img
              key={layer.key}
              className="avatar-layer"
              alt=""
              src={assetUrl(layer.file)}
              // The customiser draws one whole avatar per item in the open
              // tab, and the widest tab in the Picrew sets is sixty-three
              // tops: a hundred thumbnails of fourteen layers each is nine
              // hundred requests on opening a tab, most of them below the
              // fold. Deferring the offscreen ones is the difference between
              // a scroll and a stall on a phone, and costs nothing on the
              // three-layer thumbnails the pixel sets draw.
              loading="lazy"
              decoding="async"
              style={{
                // Pixels off the measured stage once there is one, so the line
                // art and the mask under it land on the same grid. See
                // `layerBox`. Percentages for the first paint, which is one
                // frame and is what the art used to do all the time.
                ...(size
                  ? layerBox(layer, size, canvas, size.dpr)
                  : layerPercent(layer, canvas)),
                // A mask rather than a picture: multiplied by the colour
                // somebody chose, on the GPU, before it has finished loading.
                // See `tintFilter.ts` for why it is a filter and not a canvas.
                ...(layer.tint ? { filter: tintFilter(layer.tint) } : {}),
              }}
            />
          );
        })}
      </span>
    </span>
  );
}

/**
 * A set's card picture: the maker's own cover art, or its starter avatar.
 *
 * Both places a set is offered -- the picker and the chest -- want the same
 * thing, and neither wants to know which sets ship a cover. `aria-hidden` for
 * the same reason `Avatar` is: the set's name and artist sit beside it.
 */
export function SetCover({ set, className }: { set: AvatarSet; className?: string }) {
  if (!set.thumb) {
    return <Avatar loadout={starterFor(set)} crop="bust" initial="?" className={className} />;
  }
  return <img className={className} src={assetUrl(set.thumb)} alt="" aria-hidden="true" />;
}
