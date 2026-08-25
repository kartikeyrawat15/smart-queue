import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { mintSession } from '@/lib/session';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { POST as claim } from '@/app/api/seats/[id]/claim/route';

/**
 * POST /api/demo/stress — fire N simultaneous claims at one open seat.
 *
 * This is the live version of the proof in route.test.ts: N callers contend
 * for one seat, exactly one wins, and the rest get a clean 409. Nothing is
 * simulated about the outcome — the real claim handler runs N times against
 * the real database and the tally below is whatever actually happened.
 *
 * ── Why the fan-out is server-side ───────────────────────────────────────
 * Firing N requests from the browser would be N requests from ONE IP, and the
 * per-IP limiter (30 / 10s) would reject most of them long before they reached
 * the seat — the demo would measure the rate limiter, not the atomic UPDATE.
 * Fanning out in-process is also a truer model of the thing being shown: N
 * DIFFERENT people clicking at once, not one person clicking N times.
 *
 * ── This does not weaken the rate limiter ────────────────────────────────
 * Each synthetic claimant gets its own minted session and its own synthetic
 * IP, because each one REPRESENTS a different person; the limiter still
 * applies to all of them, it simply has nothing to catch. What could be abused
 * is this endpoint — one request costs N+ database round-trips — so the
 * endpoint itself is rate limited far more tightly than the claim route, by
 * the caller's real IP and with no synthetic anything.
 *
 * ── Why the pool is warmed first ─────────────────────────────────────────
 * Same reason route.test.ts warms it: the Neon HTTP driver queues concurrent
 * queries onto a cold pool, so N "simultaneous" claims execute effectively
 * serially and even a naive read-then-write route looks correct. Without this
 * the button would report a FALSE pass. The warm-up touches only the pool, not
 * the handler under test.
 *
 * ── Why the response carries a duration ──────────────────────────────────
 * "1 winner, 49 rejected" is what a genuine race produces — but it is ALSO
 * what N claims executed one after another would produce, so the tally alone
 * cannot tell a reviewer which one happened. The elapsed time can: each claim
 * costs 2-3 round-trips, so a serial run of 50 would take tens of seconds,
 * while an overlapping one lands in about the cost of a couple of round-trips.
 * Reporting it lets the number be checked instead of trusted. (The permanent
 * guarantee is still the canary in route.test.ts, which fails the suite if the
 * harness ever stops producing real concurrency.)
 */

// The claim handler reaches node:crypto through lib/session.ts.
export const runtime = 'nodejs';

/** Matches the concurrency the test suite proves the guarantee at. */
const CONCURRENCY = 50;

// One run costs CONCURRENCY claim round-trips plus the warm-up, so this is
// deliberately strict: a handful of demo runs, not a load generator.
const STRESS_WINDOW_MS = 30_000;
const MAX_STRESS_PER_IP = 4;

type Outcome = { status: number };

export async function POST(request: NextRequest) {
  const limited = rateLimit(`stress:${clientIp(request)}`, MAX_STRESS_PER_IP, STRESS_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, {
      status: 429,
      headers: { 'Retry-After': String(limited.retryAfterSeconds) },
    });
  }

  const sessions = Array.from({ length: CONCURRENCY }, () => mintSession());
  const startedAt = Date.now();

  try {
    // Pick the target before warming, so the client is told which seat to
    // visualise even if every claim ends up losing a race with a real user.
    const open = await sql.query(
      `SELECT id, label FROM seats WHERE status = 'open' ORDER BY label LIMIT 1`,
    );

    if (open.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'no_open_seat' },
        { status: 409 },
      );
    }

    const target = open[0] as { id: string; label: string };

    // See the header comment — without this the race is not a race.
    await Promise.all(Array.from({ length: CONCURRENCY }, () => sql.query('SELECT 1')));

    const outcomes: Outcome[] = await Promise.all(
      sessions.map((session, index) => {
        const headers = new Headers();
        headers.set('cookie', session.cookie);
        // A distinct IP per claimant: each one stands for a different person,
        // so collapsing them onto one address would have the limiter reject
        // the very contention this is meant to create.
        headers.set('x-forwarded-for', `203.0.113.${(index % 254) + 1}`);

        const synthetic = new NextRequest(
          new URL(`/api/seats/${target.id}/claim`, request.url),
          { method: 'POST', headers },
        );

        return claim(synthetic, { params: Promise.resolve({ id: target.id }) }).then(
          (response) => ({ status: response.status }),
          // A thrown handler is one failed claimant, not a failed run.
          () => ({ status: 500 }),
        );
      }),
    );

    const tally = outcomes.reduce<Record<string, number>>((counts, outcome) => {
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
      return counts;
    }, {});

    const winners = outcomes.filter((outcome) => outcome.status === 200).length;
    // Measured across the fan-out only — before the cleanup below, which is
    // not part of the race.
    const durationMs = Date.now() - startedAt;

    // Tidy up after the losers. Each one reserved a holdings slot and gave it
    // back, leaving a zero row; the winner's row is left alone because it
    // genuinely holds a seat.
    await sql
      .query(
        `DELETE FROM session_holdings WHERE session_id = ANY($1) AND seats_held = 0`,
        [sessions.map((session) => session.id)],
      )
      .catch(() => {
        // Cosmetic cleanup. A leftover zero row changes no behaviour.
      });

    return NextResponse.json({
      ok: true,
      seatId: target.id,
      label: target.label,
      concurrency: CONCURRENCY,
      winners,
      rejected: CONCURRENCY - winners,
      durationMs,
      tally,
    });
  } catch (error) {
    console.error('[stress] run failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
