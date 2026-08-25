/**
 * Drawing the dice: three.js, a real camera, and light that falls on things.
 *
 * The tray it replaces was CSS. Six `<span>`s per die under `preserve-3d`,
 * turned by writing a `matrix3d` onto a parent, and deliberately **no
 * `perspective`**, which meant the camera was orthographic, a die at the edge
 * of the tray was drawn exactly as square as one in the middle, and height
 * moved a die nowhere at all. That was the right call for what it was: it fixed
 * a bug where five dice at rest each appeared tipped a different way. But it
 * also meant nothing had depth and nothing caught light, and a flat shape with
 * a number on it is what "the dice look fake" was about.
 *
 * So: WebGL. One canvas per tray, a perspective camera steep enough to read
 * the tops of the dice, one directional light casting a soft shadow onto a
 * plane, and dice that are actually cubes.
 *
 * What this file may and may not do
 *
 * It **only ever reads**. Every position and rotation comes from `engine.ts`,
 * which knows nothing about three.js and can therefore be run in Node by the
 * tests and by `render-throw3d`. If drawing ever starts deciding where a die
 * is, the simulation stops being checkable outside a browser and the contact
 * sheet stops being evidence.
 *
 * Verifying it
 *
 * Almost nothing here can be seen from the tooling: the Browser pane runs as a
 * hidden document, so `requestAnimationFrame` never fires and a WebGL canvas
 * cannot be screenshotted, and unlike the CSS dice it cannot be measured
 * through the DOM either, because there is no DOM inside a canvas. What is left
 * is arithmetic, so the framing is a pure function (`frameTray`) that
 * `scene.test.ts` checks by projecting the tray's own corners and asserting
 * they land inside the viewport. Everything else needs eyes on a real screen.
 */

import * as THREE from 'three';
import type { Tray } from '../../shared/games/dice.js';
import { DIE_HALF, trayInPhysics } from './engine.js';
import { dieGeometry } from './dieGeometry.js';

/**
 * The die's own colours, which are literals here for the reason `styles/dice.css`
 * gives for the same ones: this is the colour of an object under a light, not
 * of the interface, so it does not follow the palette and does not change with
 * the theme. A real die is the colour of a real die in both of them.
 */
const BODY = 0xf5f1e8;
const PIP = 0x0c0c0f;

/**
 * How steep the camera is, and how long its lens.
 *
 * Steep because the game is read off the tops of the dice and a low camera
 * hides them behind one another. Long, meaning a narrow field of view pulled
 * far back, because a wide one bends the tray's straight edges and makes five
 * dice at the near corner much bigger than five at the far one, the distortion
 * that reads as a cheap toy. Close to the orthographic view this replaces,
 * deliberately, with just enough perspective that a cube looks like a cube.
 */
const PITCH = (70 * Math.PI) / 180;
const FOV = 24;
/** A little air around the whole thing, so nothing sits exactly on the edge. */
const MARGIN = 1.03;

/**
 * How much more than the tray floor has to be in shot.
 *
 * The framing used to solve for the floor rectangle alone, which is not what
 * is on the screen: a die is a solid two units on a side standing *on* that
 * rectangle, it can rest against a wall with its far half hanging over the
 * edge of it, it can come to rest on top of another one, and on the way there
 * it is in the air. Measured against the shipped lens, dice at rest reached
 * 0.95 to 1.00 of the way to the edge of the canvas, Backgammon's crossing it,
 * and in flight they reached 1.15 to 1.24, which is a die you cannot see and,
 * at rest, a number you cannot read.
 *
 * So the camera frames a *box*: the floor grown by half a die on every side,
 * and `HEADROOM` tall.
 *
 * It costs size, the tray being drawn 15-25% smaller than it was depending on
 * its shape, and that is the trade: a smaller die you can read beats a bigger
 * one with its top cropped off.
 *
 * Why three dice, and not the highest a die goes
 *
 * Both are written in terms of `DIE_HALF` rather than as bare numbers, because
 * they used to be bare numbers in an abstract unit and the rescale to real
 * centimetres silently made them mean something else. Half a die of margin and
 * three dice of height is what they say now, and what they will still say
 * after the next rescale.
 *
 * Three is not the ceiling of the throw. Dice bouncing off *each other* go far
 * higher (a measured p99 of 6.3 dice and a worst case over 6.6) and framing for
 * that would cost everybody a permanently smaller tray to accommodate a freak. What matters is not how high one die once went but how much of the
 * throw is spent up there, which `scripts/measure-throw.ts` reports directly.
 * Over 200 Yahtzee throws, the share of die-frames above a given height:
 *
 *     1 die    8.43%
 *     2 dice   0.50%
 *     3 dice   0.21%   <- here
 *     4 dice   0.09%
 *
 * So this crops about one die-frame in five hundred, for a fraction of a frame
 * each time, and buys back the size of every throw that does not. Going to four
 * dice would halve an already invisible number and cost real legibility on a
 * phone.
 */
const ROOM = DIE_HALF;
const HEADROOM = DIE_HALF * 6;

/**
 * Where to put the camera so the whole tray, and everything standing on it, is
 * in frame.
 *
 * Pure, and exported, because it is the one thing in this file a test can
 * check without a screen; see the note at the top about why that matters.
 *
 * Why this is solved rather than derived
 *
 * It used to be two lines of trigonometry: the tray's width against the
 * horizontal half-angle, its depth against the vertical one after the tilt had
 * foreshortened it, further of the two wins. That is exact for a *rectangle
 * lying flat*, and the thing being framed is not one: it is a box with height,
 * seen from a tilt, so its near-top corners are much closer to the camera than
 * its far-bottom ones and project much further out. No closed form for that is
 * worth writing down, and the one that was there quietly under-framed by a
 * fifth (see `HEADROOM`).
 *
 * So the box's corners are projected, and the camera is pushed back until the
 * worst of them lands on the edge of the frame. The projection is scaled by
 * `1/distance` to first order and the iteration converges in a few steps; it
 * is capped anyway, because a framing that has not converged is still a
 * framing and a resize that never returns is not.
 */
export function frameTray(w: number, h: number, aspect: number): { distance: number; height: number; back: number } {
  const tv = Math.tan((FOV * Math.PI) / 360);
  const th = tv * Math.max(aspect, 0.0001);
  const hw = w / 2 + ROOM;
  const hh = h / 2 + ROOM;

  // The corners, plus the middles of the edges. A tilted box's worst point is
  // not always a corner, and nine points a level is cheap.
  const box: Array<[number, number, number]> = [];
  for (const x of [-hw, 0, hw]) for (const z of [-hh, 0, hh]) for (const y of [0, HEADROOM]) box.push([x, y, z]);

  // Start from the flat-rectangle answer, which is always too close, and walk
  // out from there.
  let distance = Math.max(hw / th, (hh * Math.sin(PITCH)) / tv);
  for (let i = 0; i < 24; i++) {
    const eyeY = Math.sin(PITCH) * distance;
    const eyeZ = Math.cos(PITCH) * distance;
    // The camera's own axes: it sits above and in front, looking at the origin,
    // and has no roll, so `right` is +x and `up` is whatever is left.
    const fwd = [0, -Math.sin(PITCH), -Math.cos(PITCH)];
    const up = [0, Math.cos(PITCH), -Math.sin(PITCH)];
    let worst = 0;
    for (const [px, py, pz] of box) {
      const dy = py - eyeY;
      const dz = pz - eyeZ;
      const depth = dy * fwd[1] + dz * fwd[2];
      if (depth <= 0.001) {
        worst = Math.max(worst, 2);
        continue;
      }
      worst = Math.max(worst, Math.abs(px / depth / th), Math.abs((dy * up[1] + dz * up[2]) / depth / tv));
    }
    if (Math.abs(worst - 1) < 0.0005) break;
    distance *= worst;
  }
  distance *= MARGIN;

  return {
    distance,
    height: Math.sin(PITCH) * distance,
    back: Math.cos(PITCH) * distance,
  };
}

/**
 * Point the camera at the tray, and leave it ready to be projected through.
 *
 * Separate from `createScene` and exported so `scene.test.ts` can check it,
 * which is worth the seam: three's maths runs perfectly well in Node, and this
 * is the only part of the renderer a test can reach at all.
 */
export function aimCamera(
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  aspect: number,
): ReturnType<typeof frameTray> {
  camera.aspect = aspect;
  /*
    And the lens, here rather than only at construction.

    `scene.test.ts` builds its own camera to check the framing, and three's
    default field of view is 50 deg, more than twice this one. So the test was
    measuring a camera nobody ships, and passed comfortably while the real one
    cropped the dice. Setting it here means a camera this function has aimed is
    the camera the app draws through, whoever made it.
  */
  camera.fov = FOV;
  const framed = frameTray(w, h, aspect);
  camera.position.set(0, framed.height, framed.back);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  /*
    And the world matrix, by hand.

    `lookAt` sets the camera's rotation and nothing else; `matrixWorld`, and
    with it `matrixWorldInverse` which is what `Vector3.project` actually reads,
    is only refreshed by three during `render()`. Since `draw` projects
    each die *before* it renders, leaving this out meant the first draw after a
    mount projected everything through an identity camera: the dice were drawn
    correctly and their buttons landed hundreds of pixels outside the tray. It
    survived a reload, because a reload is exactly the case where there is one
    draw and no second frame to quietly correct it.
  */
  camera.updateMatrixWorld(true);
  return framed;
}

/** One die's worth of what the scene needs to draw it. */
export interface Placed {
  x: number;
  y: number;
  z: number;
  q: readonly [number, number, number, number];
}

/** Where a die ended up on screen, so a button can be put over it. */
export interface OnScreen {
  /** Centre, in CSS pixels from the tray's top-left corner. */
  x: number;
  y: number;
  /** Roughly how wide the die is there, since it shrinks with distance. */
  size: number;
}

export interface DiceScene {
  /** Re-frame after the tray changes size. Cheap; safe to call often. */
  resize(): void;
  /**
   * Draw these dice, in physics units, and say where each one landed on
   * screen.
   *
   * The screen positions are not decoration. A die used to be a `<button>` with
   * its own `aria-label`, its own 44px target and its own place in the tab
   * order, and a canvas has no DOM inside it to hang any of that on. So the
   * buttons stay and ride on top of the canvas at the coordinates this returns:
   * the picture is WebGL and the *interface* is still HTML.
   */
  draw(
    dice: readonly Placed[],
    look?: {
      held?: readonly boolean[];
      spent?: readonly boolean[];
      /**
       * How brightly the dice are lit from inside, 0 to 1. Nought on every
       * ordinary frame; driven by a flourish's envelope in `beats.ts`, which
       * is the only thing that ever turns it up.
       */
      glow?: number;
    },
  ): Array<OnScreen | null>;
  /** Give back the GPU. A WebGL context that is dropped rather than released
   *  counts against a small per-page limit, and two trays plus a rematch is
   *  enough to reach it. */
  dispose(): void;
}

/**
 * The six faces, as canvas textures.
 *
 * Drawn rather than modelled. Pips as geometry means either boolean-subtracting
 * six dimples out of a cube at load time or stacking sixty little spheres per
 * die, and this is one 128x128 canvas per face, shared by every die in the
 * tray and by every tray on the screen.
 *
 * Built once and cached at module scope: Liar's Dice puts a tray on screen per
 * player, and there is no sense in six canvases per tray when the dice are the
 * same dice.
 */
let faces: THREE.CanvasTexture[] | null = null;

/** Pip positions on a face's own 3x3, in units of half the face. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

function faceTextures(): THREE.CanvasTexture[] {
  if (faces) return faces;
  const S = 128;
  faces = [1, 2, 3, 4, 5, 6].map((face) => {
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const art = canvas.getContext('2d')!;
    art.fillStyle = '#' + BODY.toString(16).padStart(6, '0');
    art.fillRect(0, 0, S, S);
    art.fillStyle = '#' + PIP.toString(16).padStart(6, '0');
    for (const [u, v] of PIPS[face]) {
      art.beginPath();
      art.arc(S / 2 + u * S * 0.26, S / 2 + v * S * 0.26, S * 0.082, 0, Math.PI * 2);
      art.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // The dice are small on a phone and seen at a slant, exactly the case a
    // mipmap chain is for. Without one the pips crawl as a die tumbles.
    texture.anisotropy = 4;
    return texture;
  });
  return faces;
}

/**
 * `BoxGeometry` groups its faces in the order +x, -x, +y, -y, +z, -z, and
 * `FACE_AXES` in `dice.ts` says which number lives on each of those. Getting
 * this wrong draws a die that is internally consistent and shows the wrong
 * number, which nothing downstream would catch: `faceUp` reads the rotation,
 * not the picture.
 */
const FACE_ORDER = [3, 4, 1, 6, 2, 5];

export function createScene(host: HTMLElement, tray: Tray): DiceScene {
  const { w, h } = trayInPhysics(tray);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'dice-canvas';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 4000);

  /*
    Two lights and no more. A key from over the player's shoulder, which is
    where every shadow in this app's stylesheet is thrown from, and a hemisphere
    fill so the faces turned away from it are dark rather than black. Anything
    more is a lighting rig for a product shot, on an object the size of a
    thumbnail.
  */
  const key = new THREE.DirectionalLight(0xfff6e8, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0015;
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2a33, 1.1));

  /*
    The shadows land on this and nothing else does: `ShadowMaterial` is
    transparent except where something is shadowing it, so the tray's own CSS
    background shows through and the canvas can sit over it without having to
    match its colour, its gradient, or whichever of the two palettes is on.
  */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 4, h * 4),
    new THREE.ShadowMaterial({ opacity: 0.34 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const geometry = dieGeometry();
  const textures = faceTextures();
  const skins: THREE.MeshStandardMaterial[] = FACE_ORDER.map(
    (face) =>
      new THREE.MeshStandardMaterial({
        map: textures[face - 1],
        roughness: 0.42,
        metalness: 0,
        /*
          Off at rest: `emissiveIntensity` is driven to zero on every ordinary
          frame, and this is only the colour it takes when it is not.

          Warm rather than the accent token, and for the same reason the body
          and the pips are literals: this is light coming off an object, not a
          piece of interface, and a die that glowed a different colour in each
          palette would stop reading as a die at the one moment everybody is
          looking straight at it.
        */
        emissive: new THREE.Color(0xffcf6a),
        emissiveIntensity: 0,
      }),
  );
  /*
    And a seventh, for the rounded edges and corners.

    `dieGeometry` puts the whole shell in one group because there are no pips on
    it, so it needs one plain material in the die's own body colour, the same
    literal the pip canvases are painted on, so the roundover reads as the same
    piece of plastic rather than as trim.

    Slightly smoother than the faces on purpose. A real die's edges are the part
    that has been tumbled and handled, and they carry a brighter, tighter
    highlight than the flats do; it is a small thing and it is most of what
    makes the bevel read as a bevel rather than as a shading artefact.
  */
  skins.push(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(BODY),
      roughness: 0.3,
      metalness: 0,
      emissive: new THREE.Color(0xffcf6a),
      emissiveIntensity: 0,
    }),
  );
  /*
    A die already played: dimmed, not hidden. Backgammon's, and only
    Backgammon's.

    A *held* die is not this and must never be drawn as this. Held means the
    player chose to keep it, which is a thing they did on purpose and want to
    see; spent means the die has been used up. Dimming both would say the same
    thing about two opposite states. Held is marked by the button over the top
    of the die instead, which is where it was before and where the ring, the
    focus outline and `aria-pressed` all already live.
  */
  const dimmed = skins.map((skin) => {
    const copy = skin.clone();
    copy.color = new THREE.Color(0x8d8a83);
    return copy;
  });

  const cubes: THREE.Mesh[] = [];
  function cubeAt(i: number): THREE.Mesh {
    while (cubes.length <= i) {
      const cube = new THREE.Mesh(geometry, skins);
      cube.castShadow = true;
      scene.add(cube);
      cubes.push(cube);
    }
    return cubes[i];
  }

  function resize(): void {
    const box = host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    // Capped, because the dice are the most expensive thing on the screen and
    // a 3x phone panel is three times the fragments for a difference nobody
    // can see on a shape this size.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(box.width, box.height, false);

    const framed = aimCamera(camera, w, h, box.width / box.height);

    // The light travels with the frame, so a tall phone tray and a wide desktop
    // one are lit the same way rather than one of them from the side.
    const reach = Math.max(w, h);
    key.position.set(reach * 0.4, framed.height * 0.9, reach * 0.5);
    key.target.position.set(0, 0, 0);
    key.target.updateMatrixWorld();
    const shadow = key.shadow.camera as THREE.OrthographicCamera;
    shadow.left = -reach * 0.75;
    shadow.right = reach * 0.75;
    shadow.top = reach * 0.75;
    shadow.bottom = -reach * 0.75;
    shadow.near = 1;
    shadow.far = framed.height * 3;
    shadow.updateProjectionMatrix();
  }

  const spot = new THREE.Vector3();

  function draw(
    dice: readonly Placed[],
    look?: { held?: readonly boolean[]; spent?: readonly boolean[]; glow?: number },
  ): Array<OnScreen | null> {
    const box = host.getBoundingClientRect();
    /*
      A celebrating die lights up from the inside.

      Emissive rather than another lamp, because a lamp lights the tray and the
      shadows too, and what is being said is "these dice", not "this table".
      Written on every draw rather than only when it changes: the value comes
      from a parabola sampled per frame, so there is no frame where it is the
      same as the last one, and a comparison to skip the write would cost more
      than the write.
    */
    const glow = look?.glow ?? 0;
    for (const skin of skins) skin.emissiveIntensity = glow;
    for (const skin of dimmed) skin.emissiveIntensity = glow;
    const at: Array<OnScreen | null> = [];
    for (let i = 0; i < Math.max(dice.length, cubes.length); i++) {
      const die = dice[i];
      const cube = cubeAt(i);
      /*
        A cube with no die behind it is *hidden*, not left where it was. The
        CSS tray had to learn this twice: Backgammon draws a double as four
        moves but only ever throws two cubes, and the two spare ones sat at the
        identity in the corner of the board showing ones. A hole is something
        you go and look at; a wrong number is not.
      */
      if (!die) {
        cube.visible = false;
        if (i < dice.length) at.push(null);
        continue;
      }
      cube.visible = true;
      cube.position.set(die.x, die.y, die.z);
      cube.quaternion.set(die.q[1], die.q[2], die.q[3], die.q[0]);
      cube.material = look?.spent?.[i] ? dimmed : skins;

      // Where that came out on screen, for the button that goes over it.
      spot.set(die.x, die.y, die.z).project(camera);
      const size = (DIE_HALF * 2 * box.height) / (2 * Math.tan((FOV * Math.PI) / 360) * camera.position.distanceTo(cube.position));
      at.push({
        x: ((spot.x + 1) / 2) * box.width,
        y: ((1 - spot.y) / 2) * box.height,
        size,
      });
    }
    renderer.render(scene, camera);
    return at;
  }

  function dispose(): void {
    geometry.dispose();
    for (const skin of [...skins, ...dimmed]) skin.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  resize();
  return { resize, draw, dispose };
}
