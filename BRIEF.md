# Build brief — &lt;PROJECT NAME&gt;

> Fill every section. The power is in the constraints and the AVOID list, not the feature count.

## Concept
One paragraph. What is this, what feeling should it leave, and what is it explicitly NOT
(e.g. "an editorial art-book moving through a live 3D world, not a product landing page").

## Experience
- Environmental layer: full-viewport Three.js canvas; what is built procedurally at runtime.
- Camera: one continuous scroll-driven path; each section a composed shot, not a hard cut.
- Post: name the exact effects, restrained (fog for depth; CSS vignette + grain over the canvas).

## Layout &amp; type
- Section order (hero → … → footer).
- Type system: heading scale, display type, labels, chapter numbers, negative space (use tokens).
- Foreground layers: which cutouts, how they enter / pin / fade-blur on section handoff.

## Motion
- Reveal rules (word-by-word headings, staggered elements).
- Transition feel (slow, eased camera interpolation, subtle parallax).
- What responds to the active section (nav, chapter rail, cards, foreground).
- Reduced-motion behavior that KEEPS the full reading experience.

## Palette &amp; tokens
Point to `design-tokens.css`. Every value used must exist there.

## AVOID  (spend real time here — this section does the anti-slop work)
- No frameworks / build tooling unless the project truly needs app features.
- No generic glassmorphism, no excessive glow, no decorative motion without narrative purpose.
- No placeholder imagery, no remote fonts, no trackers.
- No effect that doesn't serve the story.

## Ship checklist (definition of done)
- [ ] Works at desktop AND ~390×844 mobile.
- [ ] Zero 404s on assets; every inline script parses; console is clean.
- [ ] One full scroll + navigation pass tested end to end.
- [ ] Relative asset paths (works under a subpath, e.g. GitHub Pages).
- [ ] `prefers-reduced-motion` path verified.
- [ ] Total page weight sane (target: images aside, well under ~1 MB of code + engine).
