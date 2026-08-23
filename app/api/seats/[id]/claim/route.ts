import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession, attachSession } from '@/lib/session';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/seats/:id/claim — claim a seat for the calling session.
 *
 * ── Concurrency ──────────────────────────────────────────────────────────
 * The claim decision and the write are the SAME statement:
 *
 *     UPDATE ... WHERE id = $1 AND status = 'open'
 *
 * Postgres evaluates that predicate and performs the write under one row
 * lock, so there is no window between "is it open?" and "take it". Concurrent
 * callers serialise on the row; the first flips it, and every other UPDATE
 * then matches zero rows. RETURNING is the verdict. The naive read-then-write
 * alternative measured 50/50 winners — see the canary in route.test.ts.
 *
 * ── Identity ─────────────────────────────────────────────────────────────
 * The claimant is the server-issued session id, never anything the caller
 * sends. The request body is ignored entirely, which removes the input
 * surface rather than validating it. See lib/session.ts.
 */

// node:crypto in lib/session.ts requires the Node runtime.
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WINDOW_MS = 10_000;
const MAX_CLAIMS_PER_SESSION = 10;
const MAX_CLAIMS_PER_IP = 30; // higher: shared NATs and offices sit behind one IP

/**
 * How many seats one session may hold at once.
 *
 * Rate limiting caps the RATE of claims; it does not cap TOTAL HOLDINGS. On a
 * venue smaller than the rate limit (the seeded venue is 6 seats, the limit is
 * 10 per 10s) a single session could take every seat without ever being
 * throttled. This is the control that actually prevents an inventory sweep.
 */
const MAX_SEATS_PER_SESSION = 2;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Identity first, so every response below — including failures — carries
  // the Set-Cookie that gives a first-time caller an identity.
  const session = getSession(request);

  const respond = (body: unknown, status: number, headers?: HeadersInit) =>
    attachSession(NextResponse.json(body, { status, headers }), session);

  // Rate limit before any database work, so a flood costs us nothing.
  const bySession = rateLimit(`session:${session.id}`, MAX_CLAIMS_PER_SESSION, WINDOW_MS);
  const byIp = rateLimit(`ip:${clientIp(request)}`, MAX_CLAIMS_PER_IP, WINDOW_MS);
  const limited = !bySession.allowed ? bySession : !byIp.allowed ? byIp : null;

  if (limited) {
    return respond({ ok: false, error: 'rate_limited' }, 429, {
      'Retry-After': String(limited.retryAfterSeconds),
    });
  }

  // Guard before the query: a non-UUID would make Postgres raise
  // invalid_text_representation (22P02) and surface as a 500.
  if (!UUID_RE.test(id)) {
    return respond({ ok: false, error: 'invalid_seat_id' }, 400);
  }

  let reservedSlot = false;
  let claimSucceeded = false;

  try {
    // ── 1. Reserve a holdings slot. Single atomic conditional UPDATE. ──
    // ON CONFLICT DO UPDATE takes a row lock, so concurrent claims by the
    // SAME session serialise here and cannot both see headroom. Zero rows
    // back means the cap is already reached.
    const reserved = await sql.query(
      `INSERT INTO session_holdings (session_id, seats_held)
            VALUES ($1, 1)
       ON CONFLICT (session_id) DO UPDATE
              SET seats_held = session_holdings.seats_held + 1
            WHERE session_holdings.seats_held < $2
        RETURNING seats_held`,
      [session.id, MAX_SEATS_PER_SESSION],
    );

    if (reserved.length === 0) {
      return respond(
        { ok: false, error: 'claim_limit_reached', limit: MAX_SEATS_PER_SESSION },
        403,
      );
    }
    reservedSlot = true;

    // ── 2. The atomic claim. One statement, no read-then-write. ──
    const claimed = await sql.query(
      `UPDATE seats
          SET status     = 'claimed',
              claimed_by = $2,
              claimed_at = now()
        WHERE id = $1
          AND status = 'open'
        RETURNING id, label, status, claimed_by, claimed_at`,
      [id, session.id],
    );

    if (claimed.length === 1) {
      claimSucceeded = true;
      return respond({ ok: true, seat: claimed[0] }, 200);
    }

    // Zero rows means the seat is missing or already held. This read only
    // chooses which error to report — the outcome was already decided
    // atomically above, so it introduces no race.
    const existing = await sql.query(`SELECT 1 FROM seats WHERE id = $1`, [id]);

    if (existing.length === 0) {
      return respond({ ok: false, error: 'seat_not_found' }, 404);
    }

    // Deliberately does not disclose who holds the seat.
    return respond({ ok: false, error: 'seat_already_claimed' }, 409);
  } catch (error) {
    // Detail stays server-side; the caller gets nothing actionable.
    console.error('[claim] database error', {
      seatId: id,
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond({ ok: false, error: 'internal_error' }, 500);
  } finally {
    // Give the slot back if we reserved one but did not end up holding a seat.
    // Worst case is a crash between reserve and release, which leaks a slot
    // (the session can hold fewer seats than the cap) rather than a seat. The
    // counter is derivable from `seats`, so it can be reconciled if that
    // becomes a real problem.
    if (reservedSlot && !claimSucceeded) {
      try {
        await sql.query(
          `UPDATE session_holdings
              SET seats_held = seats_held - 1
            WHERE session_id = $1 AND seats_held > 0`,
          [session.id],
        );
      } catch (releaseError) {
        console.error('[claim] failed to release holdings slot', {
          sessionId: session.id,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }
  }
}
