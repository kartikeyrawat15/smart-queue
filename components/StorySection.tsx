'use client';

import { useReducedMotion } from 'motion/react';

import { WordReveal, revealTail } from '@/components/ui/word-reveal';
import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';
import { MagicCard } from '@/components/ui/magic-card';

/**
 * The landing story — six chapters, one scroll beat each.
 *
 * ── Pacing ───────────────────────────────────────────────────────────────
 * Every chapter is its own full-viewport block with its content centred, so a
 * chapter arrives alone, is read, and leaves before the next one starts. That
 * is also what buys the camera its room: SeatScene maps scroll position over
 * the whole document onto its waypoints, so lengthening the story lengthens
 * the pull-back with it. No camera or seat value is touched here.
 *
 * ── Reveal ───────────────────────────────────────────────────────────────
 * The chapter label fades in first, the headline arrives word by word, and
 * any supporting copy follows once the last word has landed — staged off
 * `revealTail`, which measures the headline rather than guessing at it.
 *
 * Under reduced motion the whole chapter arrives at once: WordReveal drops its
 * per-word stagger, and the wait `revealTail` computes collapses with it —
 * otherwise the supporting copy would still sit out a two-second pause for a
 * headline that no longer takes two seconds. Only delays change, never the
 * markup, so the server and a reduced-motion client render the same tree.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 * Chapters 01 and 02 are publicly reported events, used as grounding only.
 * Neither is attributed the bug this project fixes: chapter 03 explicitly
 * separates the quiet failure from the famous crashes, and chapter 04 names
 * the general pattern, not any company's code.
 *
 * The numbers in chapter 05 are things this repo demonstrates. 50 winners is
 * the RED gate in route.test.ts (a canary keeps proving the naive pattern
 * still races), 1 winner is the GREEN result re-verified at 50/100/200, and
 * the live count in chapter 06 is read from Postgres on this request.
 *
 * ── Components ───────────────────────────────────────────────────────────
 * WordReveal (headlines), BlurFade (labels and supporting copy), MagicCard
 * (the comparison cards), NumberTicker (every figure). MagicCard defaults to
 * a purple/pink gradient; every gradient prop is overridden with tokens so
 * none of its theme leaks in. ui-ux-pro-max shaped the structure and the
 * reduced-motion / focus rules; its colour output is discarded, per
 * CLAUDE.md — every value below resolves to design-tokens.css.
 */

const NATIVE_RATIO = { from: 'var(--accent)', to: 'var(--bg-2)' };

const LABEL: React.CSSProperties = {
  fontSize: 'var(--label)',
  letterSpacing: 'var(--tracking-label)',
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
};

const HEADLINE: React.CSSProperties = {
  fontSize: 'var(--h1)',
  lineHeight: 1.05,
  maxWidth: '24ch',
  color: 'var(--ink)',
};

/**
 * The copy, kept together so the narrative can be read in one place — and so
 * the reveal staging can measure a headline without it being spread across
 * the markup.
 */
const CHAPTERS = {
  rush: '10:00 AM. Tatkal booking opens. Every seat on the train disappears in under a minute.',
  crash:
    'November 2022. Ticketmaster opens sales for a single tour. Demand is so extreme the site buckles — the sale is paused, then cancelled entirely.',
  quiet:
    'Somewhere in between: a smaller, quieter failure. You clicked a seat. It said available. By the time you paid, it wasn’t. Nobody crashed — the system just lied to two people at once.',
  why: 'This is the class of problem behind every one of these: check if a seat is open, then reserve it — two separate steps. Under real load, two people can pass the check in the same instant. Both are told yes.',
  fix: 'This one runs a single atomic database statement — the check and the write can’t be torn apart.',
  proof: 'Try it — claim a seat, then watch the stress test.',
} as const;

/** The label always leads; the headline follows a beat later. */
const HEADLINE_DELAY = 0.12;

export default function StorySection({
  claimed,
  total,
}: {
  claimed: number;
  total: number;
}) {
  const reduced = useReducedMotion();
  /** When a chapter's supporting copy enters, given its headline. */
  const after = (headline: string) =>
    reduced ? HEADLINE_DELAY : revealTail(headline, HEADLINE_DELAY);

  return (
    <div className="relative z-10" style={{ paddingInline: 'var(--gutter)' }}>
      {/* The masthead rides above the first chapter rather than becoming a
          seventh beat of its own. */}
      <Chapter label="01 — The Rush" masthead="Smart Queue">
        <WordReveal as="h1" style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.rush}
        </WordReveal>
      </Chapter>

      <Chapter label="02 — The Crash">
        <WordReveal style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.crash}
        </WordReveal>
      </Chapter>

      <Chapter label="03 — The Moment No One Sees">
        <WordReveal style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.quiet}
        </WordReveal>
      </Chapter>

      <Chapter label="04 — Why It Happens">
        <WordReveal style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.why}
        </WordReveal>
      </Chapter>

      {/* 05 — the fix. The comparison is the one already built; only its
          entrance changed, from a fixed ladder of delays to the same staging
          every other chapter uses. */}
      <Chapter label="05 — The Fix">
        <WordReveal style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.fix}
        </WordReveal>

        <BlurFade delay={after(CHAPTERS.fix)} inView>
          <div className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="check-then-write"
              value={50}
              unit="winners"
              note="Read the seat, then write it. Every caller reads “open” before anyone writes."
              tone="fail"
            />
            <StatCard
              label="atomic update"
              value={1}
              unit="winner"
              note="UPDATE … WHERE status = 'open'. The row lock decides it; 49 get a clean rejection."
              tone="pass"
            />
          </div>
        </BlurFade>

        <BlurFade delay={after(CHAPTERS.fix) + 0.1} inView>
          <p
            className="mt-5"
            style={{
              fontSize: 'var(--label)',
              color: 'var(--ink-dim)',
              maxWidth: 'var(--measure)',
              lineHeight: 1.6,
            }}
          >
            Both numbers are measured in this repo&rsquo;s test suite, from 50 simultaneous claims
            on one seat. The naive version isn&rsquo;t a strawman — it stays committed, and a canary
            test keeps proving it still races. The atomic result holds at 50, 100 and 200.
          </p>
        </BlurFade>
      </Chapter>

      {/* 06 — the proof. The call to action into the grid, unchanged apart
          from its entrance. */}
      <Chapter label="06 — The Proof">
        <WordReveal style={HEADLINE} delay={HEADLINE_DELAY}>
          {CHAPTERS.proof}
        </WordReveal>

        <BlurFade delay={after(CHAPTERS.proof)} inView>
          <div className="mt-16 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <a
              href="#grid"
              className="group inline-flex cursor-pointer items-center gap-3 rounded-sm no-underline transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-4"
              style={{ color: 'var(--ink)', outlineColor: 'var(--accent)' }}
            >
              <span style={{ fontSize: 'var(--label)', letterSpacing: 'var(--tracking-label)' }}>
                CLAIM A SEAT BELOW
              </span>
              {/* SVG rather than a glyph arrow, per the design-system checklist. */}
              <svg
                aria-hidden="true"
                width="14"
                height="16"
                viewBox="0 0 14 16"
                fill="none"
                className="transition-transform duration-200 group-hover:translate-y-1 motion-reduce:transform-none"
                style={{ color: 'var(--accent)' }}
              >
                <path
                  d="M7 1v13M1.5 8.5 7 14l5.5-5.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>

            <p style={{ fontSize: 'var(--label)', color: 'var(--ink-dim)' }}>
              <NumberTicker
                value={claimed}
                style={{ color: 'var(--ink)' }}
                className="tabular-nums"
              />
              {` of ${total} seats claimed right now`}
            </p>
          </div>
        </BlurFade>
      </Chapter>
    </div>
  );
}

/**
 * One chapter: a full viewport of its own, content centred in it.
 *
 * The height is what buys the pacing — no two chapters can be read at once —
 * and it is also what the camera spline is stretched across, one composed
 * shot per beat.
 */
function Chapter({
  label,
  masthead,
  children,
}: {
  label: string;
  masthead?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex min-h-screen flex-col justify-center"
      style={{ paddingBlock: 'clamp(48px, 8vh, 96px)' }}
    >
      <BlurFade delay={0.05} inView>
        {masthead ? (
          <p style={{ ...LABEL, color: 'var(--ink)', marginBottom: 'clamp(16px, 3vh, 28px)' }}>
            {masthead}
          </p>
        ) : null}
        <p style={{ ...LABEL, marginBottom: 'clamp(24px, 6vh, 56px)' }}>{label}</p>
      </BlurFade>
      {children}
    </section>
  );
}

/**
 * One side of the comparison, built on MagicUI's MagicCard.
 *
 * MagicCard ships a purple→pink gradient and a light-grey tracking glow. All
 * four gradient props are overridden with design tokens so the component's
 * own theme never reaches the page.
 */
function StatCard({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  note: string;
  tone: 'fail' | 'pass';
}) {
  const emphasis = tone === 'pass' ? 'var(--accent)' : 'var(--ink-dim)';
  // MagicCard takes no `style` prop, so the surface is set with literal
  // utility classes — written out in full rather than composed, so Tailwind
  // can statically extract them.
  const surface =
    tone === 'pass'
      ? 'bg-[var(--bg-2)] border-t-2 border-t-[var(--accent)]'
      : 'bg-[var(--bg-2)] border-t-2 border-t-[var(--ink-dim)]';
  return (
    <MagicCard
      className={`rounded-none p-6 ${surface}`}
      gradientSize={220}
      gradientColor="var(--bg-2)"
      gradientOpacity={0.55}
      gradientFrom={emphasis}
      gradientTo={NATIVE_RATIO.to}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--label)',
          color: 'var(--ink-dim)',
        }}
      >
        {label}
      </p>
      <p className="mt-3 flex items-baseline gap-2">
        <NumberTicker
          value={value}
          className="text-5xl font-medium tabular-nums"
          style={{ color: emphasis }}
        />
        <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--label)' }}>{unit}</span>
      </p>
      <p className="mt-3" style={{ color: 'var(--ink-dim)', fontSize: '14px', lineHeight: 1.5 }}>
        {note}
      </p>
    </MagicCard>
  );
}
