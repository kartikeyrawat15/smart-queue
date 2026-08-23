'use client';

import Image from 'next/image';
import { TextAnimate } from '@/components/ui/text-animate';
import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';

/**
 * The landing story.
 *
 * Every number and claim below is something this repository actually
 * demonstrates:
 *  - 50 winners from check-then-write is the RED gate measured in
 *    route.test.ts, and the canary test keeps asserting the naive pattern
 *    still races.
 *  - 1 winner from the atomic UPDATE is the GREEN result, re-verified at 50,
 *    100 and 200 simultaneous claims.
 *  - The live count is read from Postgres on this request.
 * No claim is made about the stress-test visualisation or the HUD, which are
 * described in BRIEF.md but not built yet.
 */
export default function StorySection({
  claimed,
  total,
}: {
  claimed: number;
  total: number;
}) {
  return (
    <section
      className="relative flex min-h-screen flex-col justify-center"
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

      {/* 1 — The problem, stated plainly. */}
      <h1
        className="mt-6 font-medium"
        style={{
          fontSize: 'var(--h1)',
          lineHeight: 1.05,
          // Wide enough to keep the sentence to a few lines; at 18ch it ate
          // the whole viewport on a short window and pushed the CTA off-screen.
          maxWidth: '24ch',
          color: 'var(--ink)',
        }}
      >
        <TextAnimate animation="blurInUp" by="word" once as="span" duration={0.5}>
          Two people click book on the same seat at the same moment. One should win.
        </TextAnimate>
      </h1>

      {/* 2 — The mechanism, one sentence, plus the measured contrast. */}
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
        <div className="mt-12 flex flex-col items-start gap-6 lg:flex-row lg:items-stretch">
          <div className="grid w-full max-w-2xl grid-cols-1 gap-px sm:grid-cols-2">
            <Panel
              label="check-then-write"
              value={50}
              unit="winners"
              note="Read the seat, then write it. Every caller reads “open” before anyone writes."
              tone="fail"
            />
            <Panel
              label="atomic update"
              value={1}
              unit="winner"
              note="UPDATE … WHERE status = 'open'. The row lock decides it; 49 get a clean rejection."
              tone="pass"
            />
          </div>
          <AccentCard
            src="/story/card-mechanism.png"
            alt="A single illuminated block held in a spotlight against darkness."
            width={168}
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

      {/* 3 — The call to action, with a live figure from this request. */}
      <BlurFade delay={0.75} inView>
        <div className="mt-16 flex flex-wrap items-end gap-x-10 gap-y-6">
          <AccentCard
            src="/story/card-proof.png"
            alt="Two blocks under one spotlight — one lit, one left dark."
            width={132}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <a
            href="#grid"
            className="group inline-flex items-baseline gap-3 no-underline"
            style={{ color: 'var(--ink)' }}
          >
            <span style={{ fontSize: 'var(--label)', letterSpacing: 'var(--tracking-label)' }}>
              CLAIM A SEAT BELOW
            </span>
            <span
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-y-1"
              style={{ color: 'var(--accent)' }}
            >
              ↓
            </span>
          </a>
          <span style={{ fontSize: 'var(--label)', color: 'var(--ink-dim)' }}>
            <NumberTicker
              value={claimed}
              style={{ color: 'var(--ink)' }}
              className="tabular-nums"
            />
            {` of ${total} seats claimed right now`}
          </span>
          </div>
        </div>
      </BlurFade>
    </section>
  );
}

/**
 * Editorial accent still.
 *
 * The sources are large PNGs (853 KB / 980 KB, 1122x1402), so they go through
 * next/image rather than a plain <img>: it serves a resized WebP/AVIF at the
 * rendered width, which is what keeps the payload — and the Lighthouse
 * performance score — where it was. width/height are passed so the box is
 * reserved before load and CLS stays at zero.
 */
function AccentCard({
  src,
  alt,
  width,
}: {
  src: string;
  alt: string;
  width: number;
}) {
  const NATIVE = { w: 1122, h: 1402 };
  const height = Math.round((width * NATIVE.h) / NATIVE.w);
  return (
    <figure
      className="m-0 shrink-0 self-start p-2"
      style={{
        background: 'var(--bg-2)',
        // Same rule treatment as the stat panels above.
        borderTop: '2px solid var(--accent)',
        // Derived from a token rather than a new hex, so the palette stays
        // the single source of truth.
        borderInline: '1px solid color-mix(in srgb, var(--ink-dim) 16%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--ink-dim) 16%, transparent)',
      }}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={`${width}px`}
        className="block h-auto w-full"
      />
    </figure>
  );
}

function Panel({
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
  return (
    <div
      className="p-6"
      style={{ background: 'var(--bg-2)', borderTop: `2px solid ${emphasis}` }}
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
    </div>
  );
}
