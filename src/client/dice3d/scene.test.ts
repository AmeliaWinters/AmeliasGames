/**
 * The camera, checked without a screen.
 *
 * Almost nothing in `scene.ts` can be tested: it needs a WebGL context, and the
 * Browser pane this project develops against runs as a hidden document where a
 * canvas cannot be screenshotted and, unlike the CSS dice this replaced,
 * cannot be measured through the DOM either, because there is no DOM inside a
 * canvas.
 *
 * three's *maths* has no such problem. It is plain arithmetic and runs in Node,
 * so the framing and the projection are reachable here even though the picture
 * is not. That is the seam `aimCamera` exists on.
 */

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { aimCamera, frameTray } from './scene.js';
import { trayInPhysics } from './engine.js';
import { YAHTZEE_TRAY } from '../../shared/games/yahtzeeDisplay.js';
import { BACKGAMMON_TRAY } from '../../shared/games/backgammon.js';
import { LIARSDICE_TRAY } from '../../shared/games/liarsDiceDisplay.js';

/** The shapes a tray is actually seen at, phone first. */
const VIEWPORTS = [
  ['320px phone', 320],
  ['375px phone', 375],
  ['390px phone', 390],
  ['tablet', 768],
  ['laptop', 1280],
] as const;

const TRAYS = [
  ["Yahtzee's", YAHTZEE_TRAY],
  ["Backgammon's", BACKGAMMON_TRAY],
  ["Liar's Dice's", LIARSDICE_TRAY],
] as const;

describe('the camera', () => {
  it('frames the whole tray, in every tray and at every width', () => {
    /*
      Measured rather than looked at, which is this project's rule for anything
      geometric, and here it is not even a preference: a die cropped off the
      end of the tray is a number the player cannot read, and there is no
      screenshot available that would show it.

      The corners of the tray floor are projected through the real camera and
      have to land inside the clip cube. A die is two units across, so the
      check is run at the corners *and* half a die in from them.
    */
    for (const [what, tray] of TRAYS) {
      const { w, h } = trayInPhysics(tray);
      for (const [where, width] of VIEWPORTS) {
        // The tray keeps the aspect ratio its own units give it.
        const aspect = tray.w / tray.h;
        const camera = new PerspectiveCamera();
        aimCamera(camera, w, h, aspect);

        for (const x of [-w / 2, 0, w / 2]) {
          for (const z of [-h / 2, 0, h / 2]) {
            // On the floor, and at the top of a die standing on it.
            for (const y of [0, 2]) {
              const at = new Vector3(x, y, z).project(camera);
              expect(
                Math.abs(at.x),
                `${what} corner (${x}, ${y}, ${z}) fell off the side at ${where} (${width}px)`,
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(at.y),
                `${what} corner (${x}, ${y}, ${z}) fell off the top or bottom at ${where} (${width}px)`,
              ).toBeLessThanOrEqual(1);
              // In front of the camera, not behind it.
              expect(at.z).toBeGreaterThan(-1);
              expect(at.z).toBeLessThan(1);
            }
          }
        }
      }
    }
  });

  it('is ready to be projected through the moment it has been aimed', () => {
    /*
      The regression this file was written for.

      `lookAt` sets a camera's rotation and nothing else. `matrixWorldInverse`,
      which is what `Vector3.project` reads, is refreshed by three inside
      `render()`, so a camera that has been aimed but not rendered through
      still projects as though it were at the origin looking down -z. `draw`
      projects each die *before* it renders, so on the first frame after a
      mount every die's button was placed through an identity camera: hundreds
      of pixels outside the tray, on a canvas that was drawing the dice
      perfectly. It survived a page reload, which is exactly the case with one
      draw and no second frame to quietly correct it.

      So: aim it, project immediately, and it must already be right.
    */
    const { w, h } = trayInPhysics(YAHTZEE_TRAY);
    const camera = new PerspectiveCamera();
    aimCamera(camera, w, h, YAHTZEE_TRAY.w / YAHTZEE_TRAY.h);

    // Straight away: no render, no updateMatrixWorld, nothing in between.
    const middle = new Vector3(0, 1, 0).project(camera);
    expect(Math.abs(middle.x)).toBeLessThan(0.05);
    expect(Math.abs(middle.y)).toBeLessThan(0.35);

    // And an unaimed camera really would have got it wrong, or the assertion
    // above proves nothing.
    const naive = new PerspectiveCamera();
    naive.position.set(0, 36, 13);
    naive.lookAt(0, 0, 0);
    naive.updateProjectionMatrix();
    const stale = new Vector3(0, 1, 0).project(naive);
    expect(Math.abs(stale.y)).toBeGreaterThan(0.9);
  });

  it('puts the far end of the tray further away than the near end', () => {
    // The whole reason for the change: there is perspective now. A tray drawn
    // orthographically would give these two the same depth, and a cube would
    // look like a square with a number on it.
    const { w, h } = trayInPhysics(YAHTZEE_TRAY);
    const camera = new PerspectiveCamera();
    aimCamera(camera, w, h, YAHTZEE_TRAY.w / YAHTZEE_TRAY.h);
    const near = camera.position.distanceTo(new Vector3(0, 1, h / 2));
    const far = camera.position.distanceTo(new Vector3(0, 1, -h / 2));
    expect(far).toBeGreaterThan(near * 1.05);
  });
});

describe('framing', () => {
  it('holds the camera back far enough for whichever dimension is tighter', () => {
    // A long thin tray is limited by its width; a squarer one by its depth.
    // Backgammon's is the extreme case: a strip a third as tall as it is wide.
    const wide = frameTray(40, 4, 4);
    const square = frameTray(40, 40, 1);
    expect(square.distance).toBeGreaterThan(wide.distance);
    for (const framed of [wide, square]) {
      expect(framed.height).toBeGreaterThan(0);
      expect(framed.back).toBeGreaterThan(0);
      // Steep: the camera is far more above the tray than in front of it,
      // because the game is read off the tops of the dice.
      expect(framed.height).toBeGreaterThan(framed.back * 2);
    }
  });

  it('moves further back as the view gets narrower', () => {
    // A phone in portrait is the narrow case, and the one that crops first.
    const narrow = frameTray(35, 15, 1.2);
    const wide = frameTray(35, 15, 3);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });
});
