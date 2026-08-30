export type Palette = "stage" | "daylight";

interface PaletteInfo {
  /** Shown on the switch, naming the palette you'd move to. */
  label: string;
  /** Keeps the Android status bar in step with the page. */
  themeColor: string;
}

export const PALETTES: Record<Palette, PaletteInfo> = {
  stage: { label: "Stage", themeColor: "#0c0c0f" },
  daylight: { label: "Daylight", themeColor: "#f2f1ec" },
};

const STORAGE_KEY = "ag.palette";

/**
 * The palette to open in: the one you last chose, or -- if you have never
 * chosen -- whichever your system asks for.
 *
 * Stage is the design's default and stays the answer when the system has no
 * opinion. But a visitor whose device is set to light and who is handed a
 * near-black page has been ignored, and the switch sits at the bottom of the
 * setup screen where they may not think to look for it.
 *
 * Nothing is written here on purpose: the guess stays a guess, so a visitor
 * who changes their system theme is followed on their next visit rather than
 * being held to a preference they never expressed. Only `savePalette` turns
 * it into a choice.
 */
export function loadPalette(): Palette {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "daylight" || saved === "stage") return saved;
  return matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : "stage";
}

/** Paints the palette. Deliberately does not remember it -- see `savePalette`. */
export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", PALETTES[palette].themeColor);
}

/** Records an explicit choice, which outranks the system preference from then on. */
export function savePalette(palette: Palette): void {
  localStorage.setItem(STORAGE_KEY, palette);
}

export function otherPalette(palette: Palette): Palette {
  return palette === "stage" ? "daylight" : "stage";
}

/**
 * The channel colour, set on the root so every screen below can read it as
 * `--accent` without threading the game id through the tree.
 *
 * Each game takes one of the four signal colours. That accent themes the
 * game's card, the second half of the wordmark, the emphasised word in the
 * status line and the primary button, and nothing else. The colours are the
 * same four the seats use, deliberately: four hues doing two jobs is a palette
 * you can hold in your head, and a fifth set for "game identity" would not be.
 *
 * Past the fourth game they double up rather than growing, by family, since
 * you are never looking at two games at once: Battleships takes the Wheel's
 * ice blue, which is the sea, and Yahtzee takes Backgammon's amber, which is
 * the dice.
 *
 * An unknown id leaves the attribute off, which falls back to plain ink. That
 * matters because the id can arrive from the server, and a game this build has
 * never heard of should look unstyled rather than wrong.
 */
export const CHANNELS: Record<string, true> = {
  connect4: true,
  backgammon: true,
  wheel: true,
  wordle: true,
  battleship: true,
  yahtzee: true,
  liarsdice: true,
  wordhunt: true,
  morris: true,
  ultimate: true,
  letterpress: true,
  wordchain: true,
  vocab: true,
  drill: true,
  ghost: true,
};

export function applyChannel(gameId: string | null): void {
  if (gameId && CHANNELS[gameId]) {
    document.documentElement.dataset.game = gameId;
  } else {
    delete document.documentElement.dataset.game;
  }
}
