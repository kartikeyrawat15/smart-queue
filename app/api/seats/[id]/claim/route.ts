import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

/**
 * POST /api/seats/:id/claim — claim a seat for a user.
 *
 * ── Why this is a single statement ───────────────────────────────────────
 * The claim decision and the write are the SAME statement:
 *
 *     UPDATE ... WHERE id = $1 AND status = 'open'
 *
 * Postgres evaluates that WHERE clause and performs the write under one row
 * lock, so there is no window between "is it open?" and "take it". Concurrent
 * callers serialise on the row: the first flips it to 'claimed', and every
 * other UPDATE then matches zero rows because `status = 'open'` no longer
 * holds. RETURNING tells us which of those two happened — a returned row
 * means we won, no row means we lost.
 *
 * The naive alternative (SELECT, then UPDATE) leaves a gap in which every
 * caller reads 'open' and all of them write. Measured at 50/50 winners; see
 * the canary in route.test.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_USER_ID_LENGTH = 200;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Guard before touching the database: a non-UUID would make Postgres raise
  // invalid_text_representation (22P02), which would surface as a 500.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_seat_id' }, { status: 400 });
  }

  let userId: unknown;
  try {
    userId = (await request.json())?.userId;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  if (typeof userId !== 'string' || userId.trim() === '' || userId.length > MAX_USER_ID_LENGTH) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  // ── The atomic claim. One statement, one round-trip, no read-then-write. ──
  const claimed = await sql.query(
    `UPDATE seats
        SET status     = 'claimed',
            claimed_by = $2,
            claimed_at = now()
      WHERE id = $1
        AND status = 'open'
      RETURNING id, label, status, claimed_by, claimed_at`,
    [id, userId],
  );

  if (claimed.length === 1) {
    return NextResponse.json({ ok: true, seat: claimed[0] }, { status: 200 });
  }

  // Zero rows means either the seat does not exist, or someone else holds it.
  // This read only chooses which error to report — the claim outcome was
  // already decided atomically above, so no race is reintroduced here.
  const existing = await sql.query(`SELECT 1 FROM seats WHERE id = $1`, [id]);

  if (existing.length === 0) {
    return NextResponse.json({ ok: false, error: 'seat_not_found' }, { status: 404 });
  }

  // Deliberately does not disclose who holds the seat.
  return NextResponse.json({ ok: false, error: 'seat_already_claimed' }, { status: 409 });
}
