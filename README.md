# Cinematic Site — Claude Code Starter Kit

Claude Code produces "AI slop" when it has to invent **taste** and **technique** on the spot.
This kit removes both decisions *before* it writes a line, so it only executes decisions already
made. Taste lives in tokens + references + the brief. Technique lives in skills. The artwork is a
locked, consistent set with a manifest that tells Claude Code exactly where each piece goes.

## Workflow (per project)

1. **Direction** — collect 3–5 references (Mobbin / awwwards), capture full-page screenshots into
   `references/`, write `BRIEF.md`, and fill `design-tokens.css` from those references.
2. **Art** — lock ONE style anchor (see `assets/ASSETS.md`), generate the whole asset set from it,
   cut the alpha, convert to WebP, and fill the manifest in `assets/ASSETS.md`.
3. **Technique** — keep or adjust the `skills/*.md` files; they're referenced from `CLAUDE.md`.
4. **Build** — point Claude Code at `CLAUDE.md`. It reads the brief, tokens, skills, and asset
   manifest, then builds. Iterate with "change 1–2 things only," never "make it better."
5. **Verify** — run the ship checklist at the bottom of `BRIEF.md`.

## What's in here

- `CLAUDE.md` — the operating agreement: constraints, quality bar, and the do-not-shortcut rules.
- `BRIEF.md` — fill one per project: concept, motion, layout, avoid-list, ship checklist.
- `design-tokens.css` — your taste as concrete values (palette, type, spacing, easing).
- `references/REFERENCES.md` — what each reference is *for* (drop the screenshots beside it).
- `assets/ASSETS.md` — the consistency recipe + a manifest of every plate and cutout.
- `skills/scroll-camera.md` — the scroll-driven spline-camera technique, as a loadable skill.

## The one rule

If Claude Code is guessing at a color, an easing curve, a layout, or which asset goes where —
that's a gap in these files, not a prompt problem. Fill the file; don't argue with the model.
