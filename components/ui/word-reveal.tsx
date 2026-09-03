'use client';

import { memo, useMemo } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';

/**
 * A word-by-word text reveal, in the shape of MagicUI's TextAnimate.
 *
 * ── Why not TextAnimate itself ───────────────────────────────────────────
 * TextAnimate derives its stagger as `duration / segments.length`, so the gap
 * between words shrinks as a line gets longer — a six-chapter story would
 * accelerate from chapter to chapter, which is the opposite of composed. It
 * also splits on `/(\s+)/`, animating every space as its own segment (so the
 * real per-word gap is double the configured one), hard-codes 0.3s/0.4s
 * transitions with motion's default easing, and does not read
 * prefers-reduced-motion.
 *
 * This keeps TextAnimate's API shape and swaps those four things: a FIXED
 * per-word interval, spaces carried inside their word, every duration and
 * curve read from design-tokens.css, and a reduced-motion path.
 *
 * ── Tokens ───────────────────────────────────────────────────────────────
 * --reveal-stagger  the gap between consecutive words
 * --reveal          one word's own fade + rise
 * --ease            the curve, for every part of it
 * Nothing here picks a colour; the caller styles the element.
 *
 * ── Reduced motion ───────────────────────────────────────────────────────
 * The stagger is dropped to zero, so every word arrives together and the line
 * reads as one block fading in — and `.reveal-word` in globals.css strips the
 * rise and the blur, leaving a plain opacity fade.
 *
 * Note the split: the JS decides only the TRANSITION, and CSS decides the
 * travel. It has to be that way. Motion serialises the `hidden` variant into
 * the server-rendered style attribute, and `useReducedMotion()` is null on the
 * server and true on a reduced-motion client — so branching the markup or the
 * variants on it renders one tree on the server and a different one on the
 * client. That is a hydration mismatch (React #418), thrown at exactly the
 * users this branch exists to serve. A transition is not markup, so switching
 * only that is safe; the rest belongs in a media query.
 *
 * ── Accessibility ────────────────────────────────────────────────────────
 * Splitting a sentence into inline-block spans makes some screen readers
 * announce it word-by-word too. The full string is carried once in a visually
 * hidden span and the animated words are hidden from the tree, so the reading
 * experience is a sentence while the visual one is a reveal.
 */

/** Read once, at module scope: the ease token as motion's cubic-bezier array. */
const EASE = [0.22, 0.61, 0.36, 1] as const;

/** Fraction of the line that must be on screen before it starts arriving. */
const REVEAL_AT = 0.35;

/** Seconds, from design-tokens.css. Both are read at runtime, once per line. */
const cssSeconds = (name: string, fallback: number) => {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith('ms') ? value / 1000 : value;
};

/**
 * When a line started at `delay` will have finished its LAST word.
 *
 * A chapter's supporting copy has to enter after its headline lands, and the
 * headline's length decides when that is — a four-word line finishes in a
 * fraction of the time a thirty-word one does. Callers stage on this rather
 * than on a guessed constant, so the lag stays the same beat in every chapter.
 * Includes `--reveal-lag`, the deliberate pause between the two.
 */
export const revealTail = (text: string, delay = 0) => {
  const words = text.split(' ').filter(Boolean).length;
  return (
    delay +
    Math.max(0, words - 1) * cssSeconds('--reveal-stagger', 0.05) +
    cssSeconds('--reveal', 0.6) +
    cssSeconds('--reveal-lag', 0.18)
  );
};

type WordRevealProps = {
  /** The line. Split on spaces; each word animates, in order. */
  children: string;
  /** Element to render. Chapter headlines are h2s, the page title an h1. */
  as?: 'h1' | 'h2' | 'p' | 'span';
  className?: string;
  style?: React.CSSProperties;
  /** Seconds to wait before the first word. Used to stage a chapter. */
  delay?: number;
  /** Fires when the line has scrolled into view; only ever plays once. */
  once?: boolean;
};

const WordRevealBase = ({
  children,
  as: Component = 'h2',
  className,
  style,
  delay = 0,
  once = true,
}: WordRevealProps) => {
  const reduced = useReducedMotion();

  // The trailing space rides along inside its word, so a space is never its
  // own animated segment and `whitespace-pre` keeps the gap at the right width.
  const words = useMemo(() => children.split(' ').filter(Boolean), [children]);

  const { stagger, duration } = useMemo(
    () => ({
      stagger: cssSeconds('--reveal-stagger', 0.05),
      duration: cssSeconds('--reveal', 0.6),
    }),
    [],
  );

  const MotionComponent = motion[Component];

  // The only thing reduced motion changes here: every word starts at once.
  const container: Variants = {
    hidden: {},
    show: {
      transition: { delayChildren: delay, staggerChildren: reduced ? 0 : stagger },
    },
  };

  // Rise and un-blur together, on the project curve. No spring, no overshoot:
  // this has to sit still next to a camera that never snaps.
  const word: Variants = {
    hidden: { opacity: 0, y: '0.42em', filter: 'blur(6px)' },
    show: {
      opacity: 1,
      y: '0em',
      filter: 'blur(0px)',
      transition: { duration, ease: EASE },
    },
  };

  return (
    <MotionComponent
      className={className}
      style={style}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount: REVEAL_AT }}
    >
      <span className="sr-only">{children}</span>
      {words.map((value, index) => (
        <motion.span
          // Words repeat within a line, so the index has to be part of the key.
          key={`${index}-${value}`}
          variants={word}
          aria-hidden="true"
          // `reveal-word` is the reduced-motion hook, not a style. motion sets
          // will-change for the duration of the animation itself; setting it
          // here would pin a compositor layer per word for the life of the
          // page, on ~200 words.
          className="reveal-word inline-block whitespace-pre"
        >
          {index === words.length - 1 ? value : `${value} `}
        </motion.span>
      ))}
    </MotionComponent>
  );
};

export const WordReveal = memo(WordRevealBase);
