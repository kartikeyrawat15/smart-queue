# Assets — consistency recipe + manifest

## The consistency trick (do this BEFORE generating anything)
Consistency across a set does not come from good individual prompts. It comes from ONE locked
**style anchor** reused for every asset:

1. Write a **STYLE BIBLE** block once — the sentences that fix look, light, palette, medium,
   camera, and mood. Paste it UNCHANGED into every generation; only the subject changes.
2. Lock a **seed** and/or attach the same **style-reference image** to every generation.
3. Seed your `design-tokens.css` palette from the SAME bible, so code visuals match the art.

### STYLE BIBLE (fill once, then reuse verbatim for every asset)
```
Medium / look:  e.g. cinematic night photograph, matte film grain, faint depth haze
Light:          e.g. single warm lantern source, cold moon rim light, deep shadow
Palette:        near-black, blue-charcoal, warm amber, bone white, one vermilion accent
Camera / lens:  e.g. 35mm, low angle, editorial composition, generous negative space
Mood:           e.g. still, reverent, unhurried
Negative:       no text, no people, no logos, no glow, no oversaturation
```
Per asset, append only one line: `SUBJECT: <the single object or scene>`.

## Alpha + format
- Generate cutout subjects on a plain background, then remove it (remove.bg / rembg / Photoshop),
  OR use a native-transparency generator (Recraft). Keep SOFT edges — hard cutouts read as slop.
- Export everything to WebP (Squoosh / cwebp). Relative paths only.

## Manifest  (one row per file — THIS is what Claude Code reads to place them)
| file | role | layer | section | notes |
|------|------|-------|---------|-------|
| plates/hero.webp        | scene plate       | background card | 0    | full-bleed |
| foreground/grass.webp   | foreground cutout | parallax front  | 1–2  | pins, then blurs on handoff |
| foreground/lantern.webp | foreground cutout | parallax front  | 3    | warm, sits near camera |
| plates/moon-card.webp   | scene plate       | editorial card  | 4    | paired with heading |

> role  = scene plate | foreground cutout | texture
> layer = background | card | parallax front
> Claude Code places, pins, and fades assets STRICTLY per this table.
> If an image isn't in this table, it does not exist. If a section needs art that isn't here, add
> the row first, generate it from the same STYLE BIBLE, then build.
