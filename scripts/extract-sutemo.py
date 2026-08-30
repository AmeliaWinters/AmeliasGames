"""
Turn Sutemo's layered PSD into the PNG set and layer table the avatar renderer
eats.

Rerunnable on purpose: the next set arrives the same way, as one PSD with
everything switched off, and exporting eleven expressions by hand in an image
editor is how a set ends up half updated. Point the tables below at the new
layer names and run it again.

  pip install psd-tools pillow
  python scripts/extract-sutemo.py path/to/sprite.psd

Two things it does that are not obvious:

- **Layers are trimmed to their own ink and the offset is written down.** A
  full canvas PNG per part is mostly nothing, and an expression is a face sized
  hole in a 1011x1145 sheet. The renderer places by percentage, so trimming
  costs no accuracy and saves most of the bytes.
- **Blush is baked into the body.** It is a separate layer in the PSD sitting
  under the costume, but nothing between the two ever covers it, and a bare
  base body reads as ill rather than as neutral.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/client/avatar/sets/sutemo"

# LANCZOS, spelled as the int Pillow has always used for it, so this file needs
# no enum import and runs against whatever Pillow psd-tools dragged in.
LANCZOS = 3

# Half size. The fullest this art is ever drawn is a 320px column on a phone
# and a 400px figure on a desktop customiser, so 505px wide is still two device
# pixels per drawn one.
SCALE = 0.5

# Five hair colours, and the PSD spells them five different ways: a trailing
# space, a lowercase d, and "Blond" where every other group says "Blondie".
# Matched loosely below rather than corrected here, because the next PSD will
# be untidy in some new way.
HAIR_COLOURS = ["blondie", "silver", "pink", "brown", "dark"]

# Front and back are separate groups drawn at separate depths, which is the
# whole reason this set was picked, so a style names both. Two styles share a
# back and two share a front: the PSD says so in its group names ("Long Hair /
# Hime Cut"), and pairing them wrongly puts a hime cut's fringe on a ponytail.
HAIR_STYLES = {
    "bob": ("Hair behind>Short Bob", "Hair front>Short Bob"),
    "hime": ("Hair behind>Long Hair / Hime Cut", "Hair front>Hime Cut"),
    "long": ("Hair behind>Long Hair / Hime Cut", "Hair front>Long Hair"),
    "twintail": ("Hair behind>Twin Tail", "Hair front>Twin tail / Short Hair"),
    "short": ("Hair behind>Short Hair", "Hair front>Twin tail / Short Hair"),
}

OUTFITS = {
    "seifuku-1": "Costume>seifuku 1",
    "seifuku-2": "Costume>seifuku 2",
    "summer-dress": "Costume>Summer Dress",
    "swimsuit": "Costume>Sswimsuit",
    "towel": "Costume>Towel",
    "hoodie": "Costume>Hoodie 1",
    "pe": "Costume>PE uniform",
    "winter": "Costume>Winter outfit",
    "pajama": "Costume>Pajama",
}

FACES = {
    "normal": "Expression>normal",
    "smile": "Expression>Smile",
    "smile-2": "Expression>Smile 2",
    "delighted": "Expression>Delighted",
    "laugh": "Expression>Laugh",
    "smug": "Expression>Smug",
    "annoyed": "Expression>Annoyed",
    "angry": "Expression>Angry",
    "sad": "Expression>Sad",
    "sleepy": "Expression>Sleepy",
    "shocked": "Expression>Shocked",
}

ACCESSORIES = {
    "glasses-black": "Accessories>Black Glasses",
    "glasses-red": "Accessories>Red Glasses",
    "glasses-circle": "Accessories>Circle Glasses",
    "flower": "Accessories>Flower",
    "choker": "Accessories>Choker",
}


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def find(node, path):
    """Walk a layer path. Names are matched loosely: see above.

    Separated by `>` rather than `/`, because two of the group names in this
    file contain a slash themselves.
    """
    here = node
    for step in path.split(">"):
        want = norm(step)
        hit = None
        for child in here:
            if norm(child.name) == want:
                hit = child
                break
        if hit is None:
            raise KeyError("no layer " + path + " (stuck at " + step + ")")
        here = hit
    return here


def colour_of(group, colour):
    """The one child of a hair group holding this colour.

    Prefix matching in both directions, because "Blond" and "Blondie" are the
    same colour and this file uses both.
    """
    for child in group:
        got = norm(child.name)
        if got == colour or got.startswith(colour) or colour.startswith(got):
            return child
    raise KeyError("no " + colour + " in " + group.name)


def leaves(layer, out):
    """Every pixel layer under this one, bottom first."""
    if layer.is_group():
        for child in layer:
            leaves(child, out)
    else:
        out.append(layer)
    return out


def place(image, x, y, name, png_dir):
    """Trim, scale, write, and describe where it goes on the full canvas."""
    box = image.getbbox()
    if box is None:
        raise ValueError(name + " is entirely transparent")
    left, top, right, bottom = box
    cut = image.crop(box)
    if SCALE != 1:
        cut = cut.resize(
            (max(1, round(cut.width * SCALE)), max(1, round(cut.height * SCALE))),
            resample=LANCZOS,
        )
    cut.save(png_dir / (name + ".png"), optimize=True)
    return {
        "file": name + ".png",
        "x": x + left,
        "y": y + top,
        "w": right - left,
        "h": bottom - top,
    }


def stack(layers, name, png_dir):
    """Paste a stack of layers onto one sheet and write it out.

    Stacked by hand rather than through `composite()`, which returns an empty
    image for a layer that ships switched off however the visible flag is
    forced, and every part in this file ships switched off. `topil` reads a
    leaf's own pixels and does not care. Every layer here is Normal at full
    opacity, so pasting in order is the arithmetic Photoshop would do.

    The sheet is sized to the ink rather than to the canvas, because two hair
    backs hang three pixels below the 1145px frame and a canvas sized sheet
    cannot hold them.
    """
    flat = []
    for layer in layers:
        leaves(layer, flat)
    flat = [(leaf, leaf.topil()) for leaf in flat]
    flat = [(leaf, pixels) for leaf, pixels in flat if pixels is not None]
    if not flat:
        raise ValueError(name + " has no pixels")
    left = min(leaf.offset[0] for leaf, _ in flat)
    top = min(leaf.offset[1] for leaf, _ in flat)
    right = max(leaf.offset[0] + pixels.width for leaf, pixels in flat)
    bottom = max(leaf.offset[1] + pixels.height for leaf, pixels in flat)
    sheet = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    for leaf, pixels in flat:
        sheet.alpha_composite(
            pixels.convert("RGBA"), (leaf.offset[0] - left, leaf.offset[1] - top)
        )
    return place(sheet, left, top, name, png_dir)


def export(layer, name, seen, png_dir):
    """Stack one part once, however many slots point at it."""
    if name in seen:
        return seen[name]
    seen[name] = stack([layer], name, png_dir)
    return seen[name]


def main():
    if len(sys.argv) < 2 or not Path(sys.argv[1]).exists():
        raise SystemExit("usage: extract-sutemo.py <sprite.psd>")
    psd = PSDImage.open(Path(sys.argv[1]))

    png_dir = OUT / "png"
    png_dir.mkdir(parents=True, exist_ok=True)
    for old in png_dir.glob("*.png"):
        old.unlink()

    seen = {}
    layers = {}

    def take(key, path, name):
        layers[key] = export(find(psd, path), name, seen, png_dir)

    # The body carries the blush; see the module note.
    layers["body/default"] = stack(
        [find(psd, "Base Body"), find(psd, "Blush>1")], "body", png_dir
    )

    for style, (back_path, front_path) in HAIR_STYLES.items():
        back_group = find(psd, back_path)
        front_group = find(psd, front_path)
        for colour in HAIR_COLOURS:
            # Named for the *group* rather than the style, so the two styles
            # sharing a back share one file instead of exporting it twice.
            back_name = "hair-back-" + norm(back_group.name) + "-" + colour
            front_name = "hair-front-" + norm(front_group.name) + "-" + colour
            layers["hair/" + style + "/" + colour + "/back"] = export(
                colour_of(back_group, colour), back_name, seen, png_dir
            )
            layers["hair/" + style + "/" + colour + "/front"] = export(
                colour_of(front_group, colour), front_name, seen, png_dir
            )

    for key, path in OUTFITS.items():
        take("outfit/" + key, path, "outfit-" + key)
    for key, path in FACES.items():
        take("face/" + key, path, "face-" + key)
    for key, path in ACCESSORIES.items():
        take("accessory/" + key, path, "accessory-" + key)

    # A TypeScript module rather than JSON, and not for the types. A JSON
    # import needs an import attribute under Node and none under Vite, and this
    # table is read through both: by the app through Vite, and by
    # scripts/render-avatars.ts through tsx. A module is the one shape neither
    # argues with.
    rows = "".join(
        "  " + json.dumps(key) + ": " + json.dumps(layers[key], sort_keys=True) + ",\n"
        for key in sorted(layers)
    )
    (OUT / "layers.ts").write_text(
        "// GENERATED by scripts/extract-sutemo.py. Do not edit: rerun it.\n"
        "import type { LayerTable } from '../../layered.js';\n\n"
        "export const SUTEMO_LAYERS: LayerTable = {\n"
        "  canvas: { w: " + str(psd.width) + ", h: " + str(psd.height) + " },\n"
        "  layers: {\n" + rows + "  },\n};\n",
        encoding="utf8",
    )
    total = sum(p.stat().st_size for p in png_dir.glob("*.png"))
    print(str(len(seen) + 1) + " images, " + str(round(total / 1024)) + "KB, "
          + str(len(layers)) + " placements")


if __name__ == "__main__":
    main()
