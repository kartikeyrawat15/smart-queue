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

  try {
    // ── The atomic claim. One statement, no read-then-write. ──
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
  }
}
