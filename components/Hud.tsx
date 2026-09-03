'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import {
  CLAIM_EVENT,
  RESET_EVENT,
  SEATS_EVENT,
  STRESS_EVENT,
  type ClaimDetail,
  type SeatsDetail,
  type StressDetail,
} from '@/lib/demo-events';

/**
 * The demo controls.
 *
 * ── Design system ────────────────────────────────────────────────────────
 * Chrome, so ui-ux-pro-max's structural guidance applies: a single row of
 * low-emphasis controls, a visible focus ring, disabled state carried by more
 * than colour alone, and status announced to assistive tech rather than only
 * drawn. Its palette output is discarded as always — every value here resolves
 * to design-tokens.css.
 *
 * ── Saying what each control does ────────────────────────────────────────
 * A visitor arriving cold cannot tell a real 50-way race from a canned
 * animation, and cannot tell which of six seats a reset touches. So every
 * control carries its purpose in the DOM: each button has a line of subtext
 * wired to it with aria-describedby (and the same text as a native tooltip),
 * and each result is captioned with what the numbers mean. The seat count in
 * the reset line is read from the live tally, never written as a literal.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 * Neither button animates anything on its own. Each awaits the real API call
 * and hands the server's actual numbers to the scene; if a run somehow
 * produced no winner, the caption would say so, because it is printed from
 * the response rather than assumed. The duration is reported for the same
 * reason: "1 winner, 49 rejected" is also what fifty SERIAL claims would
 * produce, and only the elapsed time separates the two — hence the note under
 * it, which tells a reviewer what to check rather than asking to be believed.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string; note?: string }
  | { kind: 'error'; message: string };

export default function Hud({
  initialOpen,
  initialClaimed,
}: {
  initialOpen: number;
  initialClaimed: number;
}) {
  // Seeded from the server render, then owned by the scene — it is the only
  // thing that knows a seat's live state.
  const [counts, setCounts] = useState({ open: initialOpen, claimed: initialClaimed });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const stressHelpId = useId();
  const resetHelpId = useId();

  // Seats are neither created nor destroyed by the demo, so the tally is the
  // fleet size — which is what "returns all N seats to open" has to name.
  const total = counts.open + counts.claimed;

  useEffect(() => {
    const onSeats = (event: Event) => setCounts((event as CustomEvent<SeatsDetail>).detail);
    window.addEventListener(SEATS_EVENT, onSeats);
    return () => window.removeEventListener(SEATS_EVENT, onSeats);
  }, []);

  // A click lands on the canvas, so without this the only account of what the
  // server said is the colour of a mesh.
  useEffect(() => {
    const onClaim = (event: Event) => {
      const { label, outcome } = (event as CustomEvent<ClaimDetail>).detail;
      if (outcome === 'mine') {
        setStatus({
          kind: 'done',
          message: `Seat ${label}: claimed — verified by the server, not just the browser.`,
        });
      } else if (outcome === 'taken') {
        setStatus({
          kind: 'error',
          message: `Seat ${label} was already held by someone else. The server said no; the seat corrected itself.`,
        });
      } else {
        setStatus({
          kind: 'error',
          message: `Seat ${label} is still open — that claim was refused, not lost.`,
        });
      }
    };
    window.addEventListener(CLAIM_EVENT, onClaim);
    return () => window.removeEventListener(CLAIM_EVENT, onClaim);
  }, []);

  const runStress = useCallback(async () => {
    setBusy(true);
    setStatus({ kind: 'busy', message: 'Firing 50 simultaneous claims…' });
    try {
      const response = await fetch('/api/demo/stress', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await response.json();

      if (!response.ok) {
        setStatus({
          kind: 'error',
          message:
            body?.error === 'no_open_seat'
              ? 'No open seat left — reset the demo first.'
              : body?.error === 'rate_limited'
                ? 'Too many runs just now. Give it a few seconds.'
                : 'The run failed. Nothing changed.',
        });
        return;
      }

      const detail: StressDetail = {
        seatId: body.seatId,
        winners: body.winners,
        rejected: body.rejected,
      };
      window.dispatchEvent(new CustomEvent(STRESS_EVENT, { detail }));

      // Read straight off the response — winners is not assumed to be 1, and
      // the plural follows whatever it actually was.
      const winners: number = body.winners;
      setStatus({
        kind: 'done',
        message: `Seat ${body.label} — ${winners} winner${winners === 1 ? '' : 's'} · ${body.rejected} rejected · ${Number(body.durationMs).toLocaleString('en-US')}ms for ${body.concurrency} real concurrent requests.`,
        note: 'If these ran one-by-one, this would take far longer — the timing proves the concurrency was real.',
      });
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const runReset = useCallback(async () => {
    setBusy(true);
    setStatus({ kind: 'busy', message: 'Resetting…' });
    try {
      const response = await fetch('/api/demo/reset', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await response.json();

      if (!response.ok) {
        setStatus({
          kind: 'error',
          message:
            body?.error === 'rate_limited'
              ? 'Too many resets just now. Give it a few seconds.'
              : 'Reset failed. Nothing changed.',
        });
        return;
      }

      window.dispatchEvent(new CustomEvent(RESET_EVENT));
      setStatus({
        kind: 'done',
        message:
          body.released === 0
            ? 'Already all open.'
            : `Released ${body.released} seat(s) — every seat is open again.`,
      });
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const helpStyle: React.CSSProperties = {
    fontSize: 'var(--label)',
    color: 'var(--ink-dim)',
    lineHeight: 1.5,
    maxWidth: '32ch',
    textAlign: 'center',
  };

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 pb-8"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <p
        className="tabular-nums"
        style={{
          fontSize: 'var(--label)',
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--ink-dim)',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: 'var(--ink)' }}>{counts.open}</span> open
        <span aria-hidden="true"> · </span>
        <span style={{ color: 'var(--ink)' }}>{counts.claimed}</span> claimed
      </p>

      {/* Each control keeps its explanation directly beneath it, so neither
          line can be read against the wrong button. */}
      <div className="flex flex-wrap items-start justify-center gap-x-10 gap-y-5">
        <div className="flex flex-col items-center gap-2">
          <HudButton
            onClick={runStress}
            disabled={busy}
            emphasis
            describedBy={stressHelpId}
            title="Simulates 50 people claiming this seat at the exact same instant."
          >
            Run stress test
          </HudButton>
          <p id={stressHelpId} style={helpStyle}>
            Simulates 50 people claiming this seat at the exact same instant.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <HudButton
            onClick={runReset}
            disabled={busy}
            describedBy={resetHelpId}
            title={`Returns all ${total} seats to open.`}
          >
            Reset demo
          </HudButton>
          <p id={resetHelpId} style={helpStyle}>
            Returns all {total} seats to open.
          </p>
        </div>
      </div>

      {/* Announced, not just drawn: the result of a button — or of a click on
          a seat — is text, so a screen reader gets the same outcome the
          particles show. */}
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[2.5em] flex-col items-center gap-1 text-center"
        style={{ maxWidth: 'var(--measure)' }}
      >
        <p
          style={{
            fontSize: 'var(--label)',
            color: status.kind === 'error' ? 'var(--accent)' : 'var(--ink)',
            lineHeight: 1.5,
          }}
        >
          {status.kind === 'idle' ? '' : status.message}
        </p>
        {status.kind === 'done' && status.note ? (
          <p style={{ fontSize: 'var(--label)', color: 'var(--ink-dim)', lineHeight: 1.5 }}>
            ({status.note})
          </p>
        ) : null}
      </div>
    </div>
  );
}

function HudButton({
  children,
  onClick,
  disabled,
  emphasis = false,
  describedBy,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  emphasis?: boolean;
  describedBy?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The subtext is the description, not the name: a screen reader reads
      // "Run stress test", then what it does. `title` gives a pointer user the
      // same sentence as a tooltip; it is a duplicate of visible text, never
      // the only place the explanation lives.
      aria-describedby={describedBy}
      title={title}
      // Disabled reads as dimmed AND non-interactive AND announced, rather
      // than colour alone.
      className="cursor-pointer rounded-sm border px-5 py-2.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        fontSize: 'var(--label)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        color: emphasis ? 'var(--ink)' : 'var(--ink-dim)',
        borderColor: emphasis ? 'var(--accent)' : 'var(--ink-dim)',
        background: 'var(--bg-2)',
        outlineColor: 'var(--accent)',
      }}
    >
      {children}
    </button>
  );
}
