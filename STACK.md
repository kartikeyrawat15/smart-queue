# Stack notes: visuals + security + skills

Three layers, in priority order, for Smart Queue and Last-Mile Dispatch.

## 1. Look amazing
- ThreeUI (MIT): shader-driven UI components. github.com/MengTo/threeui
- Your own scene mechanics (spline camera, clip-plane build, particles) from
  `skills/scroll-camera.md` and the cut-plane demo, applied to each project's theme.

## 2. Be secure (ECC, cherry-picked — do NOT full-install)
Two skills, vendored locally in `skills/vendor/`. Install narrowly:
```
git clone https://github.com/affaan-m/ECC.git /tmp/ECC
mkdir -p ~/.claude/skills
cp -r /tmp/ECC/skills/security-review ~/.claude/skills/
cp -r /tmp/ECC/skills/tdd-workflow ~/.claude/skills/
```
Only ever clone from `github.com/affaan-m/ECC` directly — the maintainer's own README
warns third-party mirrors of this repo may be malicious. Don't run the full plugin
install, hooks, or memory vault for a 1-day build; you don't need the overhead or the
added attack surface.

**How to use them on these two projects:**
- `tdd-workflow`: write the concurrency test FIRST — "fire 50 simultaneous claims at
  one seat, expect exactly 1 success" — confirm it FAILS against a naive check-then-write
  version, then implement the atomic `UPDATE ... WHERE status='open'`, confirm it PASSES.
  That fail-then-pass pair is your proof artifact for the interview, not just a claim.
- `security-review`: run it against every API route before shipping — it triggers
  specifically on "creating new API endpoints" and "payment/sensitive features," which is
  exactly the claim/order/assignment routes in both projects. Checks secrets management,
  input validation (schema-based), and more.

## 3. Other skills that can help (install only if genuinely useful, same narrow method)
From ECC, relevant to this stack specifically:
- `api-design` — REST conventions, pagination, error responses (both projects have APIs)
- `postgres-patterns` — optimization patterns directly relevant to the atomic-UPDATE work
- `database-migrations` — clean schema migration patterns (Drizzle/Prisma)
- `e2e-testing` — Playwright patterns, useful once the stress-test UI needs automated proof

Skip everything else in the 286-skill catalog for now — it's general-purpose across many
stacks/languages you're not using (Django, Kotlin, Rust, investor decks, etc.). Add more
only when a specific need shows up, same cherry-pick method, never the full profile.

## 4. agentic-awesome-skills (sickn33) — cherry-pick ONLY, never full-install
This is an aggregator of 1,900+ skills from ~150+ unrelated third-party repos, most
single-person projects with no vetting. The `provenance` column in CATALOG.md tells you
who's actually accountable for a skill — `community`/`self` means no one is. Some skills
in this catalog touch real-world side effects (SSH credentials, crypto transactions,
telephony) — treat the whole repo as higher-risk than ECC or ui-ux-pro-max, and never run
its `npx agentic-awesome-skills` full/bulk installer.

Only take skills with a NAMED, checkable source. For this stack:
```
git clone --depth 1 https://github.com/sickn33/agentic-awesome-skills.git /tmp/AAS
cp -r /tmp/AAS/skills/neon-postgres                .claude/skills/  # neondatabase (official)
cp -r /tmp/AAS/skills/deploy-to-vercel              .claude/skills/  # vercel-labs (official)
cp -r /tmp/AAS/skills/browser-testing-with-devtools .claude/skills/  # addyosmani/agent-skills
cp -r /tmp/AAS/skills/frontend-lighthouse           .claude/skills/  # stareezy-1/frontend-architecture-skill
cp -r /tmp/AAS/skills/emil-design-eng               .claude/skills/  # emilkowalski/skills
rm -rf /tmp/AAS
```
Deliberately skipped: `3d-web-experience`, `premium-3d-website`, and similar — these hand
your creative decisions to a rules engine, which undercuts the taste you're building
yourself. Never take a skill tagged `community` or `self` from this repo without reading
its source file first.

## 5. Component libraries (not skills — install per-component, on demand)
Three MIT-licensed shadcn-compatible component registries, for HUD/chrome elements only
(buttons, stats blocks, list animations, hero sections) — never the 3D scene or camera.

| Repo | Status | Use for |
|---|---|---|
| magicuidesign/magicui | Solid — 21.2k stars, established team | animated lists, showcase sections, backgrounds |
| educlopez/smoothui | Solid — Vercel OSS-backed, named author | buttons, stylish text effects, hero blocks |
| leovvx/unlumen-ui-docs | Small/unproven — 1 star, single maintainer; Pro tier is a separate private repo | only if a specific public component is genuinely needed |

Install ONE component at a time, only when the build actually calls for it — don't bulk-
install any of these on day one:
```
npx shadcn@latest add @magicui/<component-name>
npx shadcn@latest add @smoothui/<component-name>   # or: npx smoothui-cli add <name>
npx shadcn@latest add @unlumen/<component-name>
```
Same skill boundary as `ui-ux-pro-max`: these style the chrome around the experience.
The cinematic core (camera, scene, the one signature moment) stays hand-built from
`design-tokens.css` and this project's own skills — never a pulled-in component.
