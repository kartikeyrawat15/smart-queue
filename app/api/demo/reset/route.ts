import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/demo/reset — return every seat to open.
 *
 * This exists so the demo can be replayed for a reviewer, which is a checklist
 * item in BRIEF.md. It is the same two statements the manual reset script runs.
 *
 * ── This is a demo affordance, and it is not access-controlled ───────────
 * Anyone who can reach the deployment can wipe the seat map. That is
 * acceptable ONLY because the data is a throwaway six-seat demo with no real
 * bookings behind it — releasing a seat costs nobody anything here. If this
 * venue ever held something real, this route needs to go, or sit behind an
 * admin identity; a rate limit is not authorization and is not pretending to
 * be. It is here so the endpoint cannot be used to hammer the database.
 */

export const runtime = 'nodejs';

const RESET_WINDOW_MS = 10_000;
const MAX_RESETS_PER_IP = 6;

export async function POST(request: NextRequest) {
  const limited = rateLimit(`reset:${clientIp(request)}`, MAX_RESETS_PER_IP, RESET_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, {
      status: 429,
      headers: { 'Retry-After': String(limited.retryAfterSeconds) },
    });
  }

  try {
    // Both columns are cleared alongside the status because
    // seats_claim_consistency makes a half-reset row unrepresentable.
    const seats = await sql.query(
      `UPDATE seats
          SET status = 'open', claimed_by = NULL, claimed_at = NULL
        WHERE status <> 'open'
      RETURNING id`,
    );

    // Holdings are derived from seats, so releasing every seat means every
    // session now holds nothing. Leaving these would keep sessions pinned at
    // their cap against seats that no longer exist as claims.
    await sql.query(`DELETE FROM session_holdings`);

    return NextResponse.json({ ok: true, released: seats.length });
  } catch (error) {
    console.error('[reset] failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
