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

export function loadPalette(): Palette {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "daylight" || saved === "stage" ? saved : "stage";
}

export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  localStorage.setItem(STORAGE_KEY, palette);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", PALETTES[palette].themeColor);
}

export function otherPalette(palette: Palette): Palette {
  return palette === "stage" ? "daylight" : "stage";
}

/**
 * The channel colour, set on the root so every screen below can read it as
 * `--accent` without threading the game id through the tree.
 *
 * Each game owns one of the four signal colours. That accent themes the
 * game's card, the second half of the wordmark, the emphasised word in the
 * status line and the primary button — and nothing else. The colours are the
 * same four the seats use, deliberately: four hues doing two jobs is a palette
 * you can hold in your head, and a fifth set for "game identity" would not be.
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
};

export function applyChannel(gameId: string | null): void {
  if (gameId && CHANNELS[gameId]) {
    document.documentElement.dataset.game = gameId;
  } else {
    delete document.documentElement.dataset.game;
  }
}
