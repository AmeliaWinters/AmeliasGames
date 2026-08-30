# Where the avatar art came from

One entry per set. Add one when you add a set, and say what the licence
actually permits rather than linking to it, because the link is the thing that
rots.

## sutemo

**Female Character Sprite for Visual Novel**, by Sutemo.
<https://sutemo.itch.io/female-character>

Downloaded 26 August 2026, the free tier: `Female Sprite by Sutemo.zip`,
7MB, one PSD at 1011x1145. A paid V2 exists at $2 with more hairstyles,
more costumes and three more hair colours, and it would drop in here through
the same script.

**Licence, in the artist's words on the store page:** usable in personal or
commercial projects; the sprite may not be resold on its own. Credit is not
required. It is credited anyway, in the customiser's footer, because the art is
most of what this feature is.

The set was picked for one property: **the front and back of the hair are
separate layers**, so the body and the outfit sit between them. That is what
makes this a layered avatar rather than a paper doll, and it is preserved
through `layers.ts` and asserted in `avatar.test.ts`.

The PNGs under `sutemo/png/` and `sutemo/layers.ts` are **generated**. Do not
edit them:

```
pip install psd-tools pillow
python scripts/extract-sutemo.py "Female Sprite by Sutemo.psd"
```

The PSD itself is not in the repo. It is 11MB of source that nothing builds
from on a normal day, and re-downloading it takes a minute; the script's header
says what to point it at.

## kit

**Character Kit**, the sprite folder in `CharacterCreator/` at the repository
root.

**Artist and licence: not yet recorded, and this is the one gap in this file.**
The art arrived as a folder rather than as a download, so there is no store
page to quote and no licence text to summarise. Somebody who knows where it
came from should replace this paragraph and the `artist` field in
`sets/kit/index.ts`, which currently says "Unknown" and puts that word under
the set's card in the customiser. If it turns out the licence does not permit
use here, the whole set comes out by deleting `sets/kit/` and the one line in
`manifest.ts` that names it.

The PNGs under `kit/png/` and `kit/layers.ts` are **generated**. Do not edit
them:

```
npm run extract:kit
```

`scripts/extract-kit.ts` documents what it knows about the art, which is worth
reading before touching the set: the file name suffixes are a contract, and
they are how 378 sprites become sixteen recolourable slots rather than a paper
doll. The `CharacterCreator/` folder itself is the source and is not read at
run time.

The set was picked, like Sutemo, for one property: **every recolourable part
ships a grey mask and its line art as separate files.** That is what makes the
colour picker possible at all, and it is what `tint.ts` and `tint.test.ts`
exist to protect.

## snake

**snakeinajar's OC maker**, Picrew image maker 2863746, exported to
`CharacterCreator/2863746/` at the repository root.

<https://www.instagram.com/snakeinajar> and
<https://www.tiktok.com/@snakeinajar>

**Licence, in the artist's words in the export's `info.json`:** personal,
non-commercial use only. Using a result as a profile picture is explicitly
allowed. The artist's `@` need not be shown *unless the watermark is not
visible*, which is why the frame category is drawn as `base` in `data.ts` and
cannot be taken off: the watermark stays, so the condition is met without
asking the app to carry a handle in its chrome. The credit line in the
customiser footer says so anyway.

This app is a personal, non-commercial learning tool and that is the whole of
the basis for the set being here. **If it ever becomes anything else, this set
and `makowka` come out first**, by deleting `sets/snake/` and the one line in
`manifest.ts` that names it.

The WebP under `snake/webp/` and `snake/data.ts` are **generated**. Do not edit
them:

```
npx tsx scripts/extract-picrew.ts snake
```

The export is 207MB of 600x600 PNGs across 49 categories. What ships is 2,355
files and 7MB, because the script resamples to 128, writes lossless WebP, and
keeps 24 of the 49 categories. The dropped ones are the second copies the maker
offers so you can wear two of something (`necklaces 2`, `tats 2`, `scars 2`),
plus the filters, the frames and the confetti. `scripts/extract-picrew.ts`
lists exactly what survives and why.

## makowka

**makowka character maker II**, Picrew image maker 644129, exported to
`CharacterCreator/644129/` at the repository root.

**Licence, in the artist's words in the export's `info.json`:** non-commercial
use only, explicitly not for advertising, album covers, book illustrations or
business accounts; usable as a personal profile picture; do not claim the art
as your own; **do not edit the picture**, and credit the artist if the
signature is cropped out.

Two of those shape the code. The signature and the paper grain are drawn as
`base` and cannot be removed, so nothing this app produces is ever missing the
mark. And "do not edit the picture" is why the two Picrew sets take their
colour from a `Variant` list rather than through `tint.ts`: every sprite is
composited exactly as the artist exported it, resampled and no more. The same
caveat as `snake` applies about this being a personal project.

The WebP under `makowka/webp/` and `makowka/data.ts` are **generated**:

```
npx tsx scripts/extract-picrew.ts makowka
```

39MB and 45 categories in, 3,808 files and 9MB out, keeping 25 categories.

The set was picked for one property the other three do not have: **sixty-eight
hairstyles and a hundred and twenty tops**, which is what makes it the far end
of the unlock ladder rather than a fourth of the same thing.

## The two cover pictures

`snake/png/thumb.png` and `makowka/png/thumb.png` are results the makers
published of their own makers, saved from Picrew and used as the set card in
the customiser and on the chest. They are the maker's picture of what the set
can do, which is what somebody is deciding from; the starter loadout is item
zero of every menu and flatters neither set.

Both carry the artist's signature in the image, so the condition both licences
put on this -- the mark stays visible -- is met by the picture itself. They are
resampled to 256px and otherwise untouched: makowka's terms say not to edit the
result, so scaling is the only thing done to them, and nothing is cropped,
recoloured or drawn over.
