import { describe, expect, it } from 'vitest';
import { baseOf, screenAt } from './route.js';

/**
 * Where the app thinks it is mounted, which is the whole of the routing
 * arithmetic. It is pinned because getting it wrong is silent: a pushState to
 * the wrong path leaves the address bar plausible and the next reload lands on
 * a 404, which is a bug nobody finds while clicking around.
 */
describe('the mount point', () => {
  it('is the root when the app is served from it', () => {
    expect(baseOf('/')).toBe('/');
    expect(baseOf('/index.html')).toBe('/');
  });

  it('strips the screen itself, so opening one twice is idempotent', () => {
    // Somebody who reloads on /chests, or arrives on a link to it, must get
    // the same base as somebody who pressed the chest button on the lobby --
    // or the next press pushes /chests/chests, and that one really is a 404.
    expect(baseOf('/account')).toBe('/');
    expect(baseOf('/account/')).toBe('/');
    expect(baseOf('/chests')).toBe('/');
    expect(baseOf('/waifu')).toBe('/');
    expect(baseOf('/words')).toBe('/');
    expect(baseOf('/stats')).toBe('/');
    expect(baseOf('/customise')).toBe('/');
  });

  it('keeps a subdirectory, with or without the trailing slash', () => {
    // The packaged app is served from a directory rather than a host root.
    expect(baseOf('/games/')).toBe('/games/');
    expect(baseOf('/games')).toBe('/games/');
    expect(baseOf('/games/index.html')).toBe('/games/');
    expect(baseOf('/games/account')).toBe('/games/');
    expect(baseOf('/games/chests')).toBe('/games/');
  });
});

/**
 * Which screen a path names. The lobby answering null is the load-bearing
 * half: every path that is not one of these is a room or the shelf, and a
 * screen drawn over the lobby by accident is the whole app replaced.
 */
describe('the screen a path names', () => {
  it('names each screen', () => {
    expect(screenAt('/account')).toBe('profile');
    expect(screenAt('/chests')).toBe('chests');
    expect(screenAt('/waifu')).toBe('waifu');
    expect(screenAt('/words')).toBe('vocab');
    expect(screenAt('/stats')).toBe('stats');
    expect(screenAt('/customise')).toBe('avatar');
  });

  it('tolerates the trailing slash a browser adds', () => {
    expect(screenAt('/chests/')).toBe('chests');
  });

  it('is null for the lobby and for anything else', () => {
    expect(screenAt('/')).toBe(null);
    expect(screenAt('/index.html')).toBe(null);
    expect(screenAt('/chests/extra')).toBe(null);
  });
});
