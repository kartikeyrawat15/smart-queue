# CLAUDE.md — operating agreement

You are building a cinematic, scroll-driven web experience. Read these before writing any code:
`BRIEF.md` (what this project is), `design-tokens.css` (exact visual values),
`assets/ASSETS.md` (the artwork and where each piece goes), and the relevant file(s) in `skills/`.

## How to work
- Load the matching `skills/*.md` FIRST and follow it. Do not reinvent a technique it already encodes.
- Use ONLY the values in `design-tokens.css` for color, type, spacing, and easing. Never invent a
  hex code or a timing number — if one is missing, ask; do not guess.
- Place assets exactly as described in `assets/ASSETS.md` (role, layer, depth, section). Do not
  invent imagery or add images that aren't in the manifest.
- Build the 3D and animation in code; treat images as flat layers composited over the live scene.

## Quality bar
- Frame-rate-independent motion only: ease toward targets with `1 - exp(-rate*dt)`. Never tie
  animation to frame count or assume a fixed 60fps.
- The camera moves along a spline; each section is a composed shot, not a hard scene swap.
- Fully responsive; verify desktop AND ~390×844. Honor `prefers-reduced-motion` while keeping the
  complete reading experience.
- Stay small: no framework, no build step, no runtime network calls. WebP assets, relative paths.

## Skill boundary
`ui-ux-pro-max` may generate the design system for HUD/chrome/dashboard elements
(buttons, panels, forms, counts). It must NOT decide colors, style, or effects for the
3D scene, camera, or hero layer — those come only from `design-tokens.css` and this
project's `BRIEF.md`. If it suggests a palette or style for the cinematic layer, ignore it.

## Do NOT (this list is what actually prevents slop)
- No generic glassmorphism, no blanket drop-shadows, no neon glow, no gradient-on-everything.
- No motion without narrative purpose. No decorative parallax that fights the scroll.
- No placeholder/lorem imagery, no remote fonts, no analytics or trackers.
- Do not fake the hard parts. A real spline camera and real alpha compositing, not cheap substitutes.

## Definition of done
Run the ship checklist in `BRIEF.md`. Not done until every box passes on a live URL.
