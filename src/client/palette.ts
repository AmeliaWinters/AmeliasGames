export type Palette = "plum" | "paper";

interface PaletteInfo {
  /** Shown on the switch, naming the palette you'd move to. */
  label: string;
  /** Keeps the Android status bar in step with the page. */
  themeColor: string;
}

export const PALETTES: Record<Palette, PaletteInfo> = {
  plum: { label: "Plum & Rose", themeColor: "#f9eef1" },
  paper: { label: "Paper & Ink", themeColor: "#f4efe6" },
};

const STORAGE_KEY = "ag.palette";

export function loadPalette(): Palette {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "paper" || saved === "plum" ? saved : "plum";
}

export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  localStorage.setItem(STORAGE_KEY, palette);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", PALETTES[palette].themeColor);
}

export function otherPalette(palette: Palette): Palette {
  return palette === "plum" ? "paper" : "plum";
}
