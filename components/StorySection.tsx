'use client';

import { TextAnimate } from '@/components/ui/text-animate';
import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';
import { MagicCard } from '@/components/ui/magic-card';

/**
 * The landing story.
 *
 * ── Design system ────────────────────────────────────────────────────────
 * Structure, motion and hierarchy follow the ui-ux-pro-max recommendation for
 * this product ("Dark Mode (OLED)", stagger reveal 300–450ms, visible focus,
 * reduced-motion respected, SVG icons rather than glyph arrows).
 *
 * Its COLOUR and TYPE output is deliberately discarded: it proposed a slate/
 * green palette (accent #22C55E) and remote Google fonts, both of which would
 * override design-tokens.css. Per CLAUDE.md the skill may shape chrome but
 * must not decide colour. Every value below resolves to a token.
 *
 * ── Components ───────────────────────────────────────────────────────────
 * MagicUI: TextAnimate (headline reveal), MagicCard (the two comparison
 * cards), NumberTicker (all three figures), BlurFade (staged entrances).
 * MagicCard defaults to a purple/pink gradient — every gradient prop is
 * overridden with tokens so none of its theme leaks in.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 * Every number is something this repo demonstrates: 50 winners is the RED
 * gate in route.test.ts (a canary test keeps proving the naive pattern still
 * races), 1 winner is the GREEN result re-verified at 50/100/200, and the
 * live count is read from Postgres on this request. Nothing is claimed about
 * the stress-test visualisation or the HUD; neither is built.
 */

const NATIVE_RATIO = { from: 'var(--accent)', to: 'var(--bg-2)' };

export default function StorySection({
  claimed,
  total,
}: {
  claimed: number;
  total: number;
}) {
  return (
    <section
      className="relative z-10 flex min-h-screen flex-col justify-center"
      style={{ paddingInline: 'var(--gutter)', paddingBlock: 'clamp(48px, 8vh, 96px)' }}
    >
      <BlurFade delay={0.05} inView>
        <p
          style={{
            fontSize: 'var(--label)',
            letterSpacing: 'var(--tracking-label)',
            color: 'var(--ink-dim)',
            textTransform: 'uppercase',
          }}
        >
          Smart Queue
        </p>
      </BlurFade>

      {/* 1 — The problem. */}
      <h1
        className="mt-6 font-medium"
        style={{
          fontSize: 'var(--h1)',
          lineHeight: 1.05,
          maxWidth: '24ch',
          color: 'var(--ink)',
        }}
      >
        <TextAnimate animation="blurInUp" by="word" once as="span" duration={0.5}>
          Two people click book on the same seat at the same moment. One should win.
        </TextAnimate>
      </h1>

      {/* 2 — The mechanism. */}
      <BlurFade delay={0.35} inView>
        <p
          className="mt-8"
          style={{ maxWidth: 'var(--measure)', color: 'var(--ink-dim)', lineHeight: 1.6 }}
        >
          This one runs a{' '}
          <span style={{ color: 'var(--ink)' }}>single atomic database statement</span> — the
          check and the write can&rsquo;t be torn apart.
        </p>
      </BlurFade>

      <BlurFade delay={0.5} inView>
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

      <BlurFade delay={0.6} inView>
        <p
          className="mt-5"
          style={{ fontSize: 'var(--label)', color: 'var(--ink-dim)', maxWidth: 'var(--measure)' }}
        >
          Both numbers are measured in this repo&rsquo;s test suite, from 50 simultaneous claims
          on one seat. The naive version isn&rsquo;t a strawman — it stays committed, and a canary
          test keeps proving it still races. The atomic result holds at 50, 100 and 200.
        </p>
      </BlurFade>

      {/* 3 — The call to action. */}
      <BlurFade delay={0.75} inView>
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
