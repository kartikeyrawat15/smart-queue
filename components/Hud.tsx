'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  RESET_EVENT,
  SEATS_EVENT,
  STRESS_EVENT,
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
 * ── Honesty ──────────────────────────────────────────────────────────────
 * Neither button animates anything on its own. Each awaits the real API call
 * and hands the server's actual numbers to the scene; if a run somehow
 * produced no winner, the message would say so, because it is printed from
 * the response rather than assumed.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
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

  useEffect(() => {
    const onSeats = (event: Event) => setCounts((event as CustomEvent<SeatsDetail>).detail);
    window.addEventListener(SEATS_EVENT, onSeats);
    return () => window.removeEventListener(SEATS_EVENT, onSeats);
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
      setStatus({
        kind: 'done',
        message: `Seat ${body.label}: ${body.winners} winner, ${body.rejected} rejected of ${body.concurrency} — in ${body.durationMs}ms.`,
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
        message: body.released === 0 ? 'Already all open.' : `Released ${body.released} seat(s).`,
      });
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 pb-8"
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

      <div className="flex flex-wrap items-center justify-center gap-3">
        <HudButton onClick={runStress} disabled={busy} emphasis>
          Run stress test
        </HudButton>
        <HudButton onClick={runReset} disabled={busy}>
          Reset demo
        </HudButton>
      </div>

      {/* Announced, not just drawn: the result of both buttons is text, so a
          screen reader gets the same outcome the particles show. */}
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25em] text-center"
        style={{
          fontSize: 'var(--label)',
          color: status.kind === 'error' ? 'var(--accent)' : 'var(--ink-dim)',
          maxWidth: 'var(--measure)',
        }}
      >
        {status.kind === 'idle' ? '' : status.message}
      </p>
    </div>
  );
}

function HudButton({
  children,
  onClick,
  disabled,
  emphasis = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
