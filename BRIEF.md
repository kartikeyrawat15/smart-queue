# Build brief — Smart Queue

## Concept
A concurrency-safe seat/slot booking system. It solves the real production bug behind
overselling — two people claiming the same seat at once — using a single atomic database
operation instead of a check-then-write race. It is an engineering demo wrapped in a
cinematic 3D interface, not a form with a submit button.

## Landing / Story (new — this is the showcase moment)
Above the 3D grid, a short story section that walks a reviewer through the problem before
they touch anything:
1. **The problem**, told plainly: "Two people click 'book' on the same seat at the same
   time. One should win. Most systems get this wrong." Real text, real craft — a headline
   reveal, not a wall of paragraph copy.
2. **The mechanism**, in one sentence with visual weight: "This one runs a single atomic
   database statement — the check and the write can't be torn apart." Pair with a small
   animated stat or diagram beat (e.g. a live counter of claims resolved, or a two-column
   before/after: "check-then-write" vs "atomic update").
3. **The proof**, as a call to action into the grid below: "Try it — claim a seat, then
   watch the stress test." Leads the eye down into the 3D scene.
This section is real frontend craft — text reveal, a stat block, restrained motion — using
MagicUI/SmoothUI components pulled individually where useful (e.g. a number-ticker for a
live stat, a text-reveal for the headline). This is chrome, same rule as the HUD: pull
components here freely. It also gives the page real painted content, fixing the
screen-reader/crawler/Lighthouse gap.

## Experience
- Full-viewport Three.js canvas below the story section: a 3D grid of seats/slots
  rendered as extruded blocks.
- Ambient camera: a slow orbit/drift over the layout (damped-easing, same approach as the
  scroll-camera skill, applied to autonomous motion instead of scroll position).
- Post: soft depth fog, restrained bloom on claimed seats only. No glow-everything.

## Layout & type
- HUD: live counts (open / claimed), a "claim a random seat" button, and the stress-test
  trigger. Built from `ui-ux-pro-max` + MagicUI/SmoothUI components — chrome only.
- The seat grid itself is the hero of the interactive section. Minimal surrounding UI,
  generous negative space.

## Motion
- Claiming a seat: brief particle-burst + camera micro-shake, keyed off the real API
  response — never a canned animation that fires before the server confirms.
- Stress-test mode: 50 simultaneous requests visualized as particles converging on one
  seat; 49 "bounce off" (a quick deflect/red-flash), exactly 1 lands and lights up.
- Reduced-motion: keep the state changes (seat lights up / doesn't), drop the particles.

## Palette & tokens
Use `design-tokens.css`. Suggested base: near-black background, one accent color for
"claimed," a second for the stress-test failure flash. Commit to these, don't drift.

## AVOID
- No optimistic "looks claimed" UI before the server actually confirms it — the whole
  point of this project is that the visual state IS the real state.
- No generic glassmorphism, no gradient-on-everything, no decorative motion.
- No client-side-only "success" — every claim must round-trip through the real API.
- No pulled-in 3D scene template — the seat grid is hand-built, matching the camera/scene
  approach from the scroll-camera skill. (The story section above it may use pulled
  components — that boundary is intentional, see Landing/Story above.)
- The story section must not overstate what's proven — no vague marketing claims. Every
  sentence should map to something actually true of this build.

## Ship checklist
- [ ] Two browser tabs claiming the same seat live — exactly one wins.
- [ ] Stress-test button fires real concurrent requests, shows 1 success / N-1 failures.
- [ ] `security-review` skill run against the claim API route.
- [ ] `tdd-workflow`: concurrency test written and failing BEFORE the atomic UPDATE existed.
- [ ] Reset-demo button works so this can be replayed for a reviewer.
- [ ] Works at desktop and ~390×844 mobile.
- [ ] `frontend-lighthouse` run before calling it done — should now score, since the story
      section provides real contentful paint.
      
    
