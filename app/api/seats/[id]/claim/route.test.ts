/**
 * The core correctness guarantee of Smart Queue:
 *
 *   A seat can be claimed by exactly one person, even when many people
 *   claim it at the same instant.
 *
 * Runs against the real Neon database. Mocking the DB here would defeat the
 * purpose: the race lives in the interleaving of real round-trips.
 *
 * ── Why warmPool() exists ────────────────────────────────────────────────
 * The Neon HTTP driver issues each query over fetch/undici. On a cold
 * connection pool, 50 "concurrent" queries queue onto ~1 socket and execute
 * effectively SERIALLY — which makes even a naive read-then-write route look
 * correct. Measured directly: the first 50-way race after a cold start
 * produced 1 winner, while an identical race moments later on a warm pool
 * produced 50. Without warm-up this suite reports a false GREEN.
 *
 * warmPool() opens enough sockets up front that the race is genuine. It
 * touches only the test's own client — the route under test is untouched.
 * The `canary` test below permanently guards this property.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { POST } from './route';

const sql = neon(process.env.DATABASE_URL!);

const CONCURRENCY = 50;
const TEST_PREFIX = 'TEST_CLAIM_';

/** Force the HTTP pool to open ~CONCURRENCY sockets so requests truly overlap. */
async function warmPool() {
  await Promise.all(Array.from({ length: CONCURRENCY }, () => sql.query('SELECT 1')));
}

/** A fresh, known-open seat, so each test is independent. */
async function createOpenSeat(): Promise<string> {
  const label = `${TEST_PREFIX}${crypto.randomUUID()}`;
  const [row] = await sql.query(`INSERT INTO seats (label) VALUES ($1) RETURNING id`, [label]);
  return row.id as string;
}

/** Invokes the route handler exactly as Next would. */
function claim(seatId: string, userId: string) {
  const request = new NextRequest(`http://localhost/api/seats/${seatId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return POST(request, { params: Promise.resolve({ id: seatId }) });
}

const cleanup = () => sql.query(`DELETE FROM seats WHERE label LIKE '${TEST_PREFIX}%'`);

beforeEach(cleanup);
afterAll(cleanup);

describe('claim-race harness', () => {
  it('canary: the harness can actually detect a lost-update race', async () => {
    // Runs the naive read-then-write pattern the route must NOT use. Under a
    // genuine race this produces many winners. If this ever reports 1, the
    // harness has stopped exercising concurrency and every other result in
    // this file is untrustworthy — fail loudly rather than pass quietly.
    await warmPool();
    const seatId = await createOpenSeat();

    let naiveWinners = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) => {
        const rows = await sql.query(`SELECT status FROM seats WHERE id = $1`, [seatId]);
        if (rows[0].status !== 'open') return;
        await sql.query(
          `UPDATE seats SET status='claimed', claimed_by=$2, claimed_at=now() WHERE id=$1`,
          [seatId, `naive-${i}`],
        );
        naiveWinners++;
      }),
    );

    expect(
      naiveWinners,
      'harness is not producing real concurrency — results in this file cannot be trusted',
    ).toBeGreaterThan(1);
  });
});

describe(`POST /api/seats/[id]/claim — ${CONCURRENCY} simultaneous claims`, () => {
  it('lets exactly one caller win and rejects the rest cleanly', async () => {
    await warmPool();
    const seatId = await createOpenSeat();

    const settled = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) => claim(seatId, `user-${i}`)),
    );

    type ClaimResult = Awaited<ReturnType<typeof claim>>;
    const threw = settled.filter((r) => r.status === 'rejected');
    const responses = settled
      .filter((r): r is PromiseFulfilledResult<ClaimResult> => r.status === 'fulfilled')
      .map((r) => r.value);

    const statuses = responses.map((r) => r.status);
    const winners = statuses.filter((s) => s === 200);
    const conflicts = statuses.filter((s) => s === 409);
    const other = statuses.filter((s) => s !== 200 && s !== 409);

    const summary =
      `winners=${winners.length} conflicts=${conflicts.length} ` +
      `other=[${other.join(',')}] threw=${threw.length}`;

    // (1) Exactly one winner.
    expect(winners.length, `expected exactly 1 winner — got ${summary}`).toBe(1);

    // (2) Everyone else is turned away *cleanly* — a 409, not a crash or 500.
    expect(threw.length, `handler threw for ${threw.length} requests`).toBe(0);
    expect(other.length, `unexpected statuses: [${other.join(',')}]`).toBe(0);
    expect(conflicts.length).toBe(CONCURRENCY - 1);

    // (3) The database agrees with whoever we told they won.
    const [seat] = await sql.query(
      `SELECT status, claimed_by, claimed_at FROM seats WHERE id = $1`,
      [seatId],
    );
    expect(seat.status).toBe('claimed');
    expect(seat.claimed_at).not.toBeNull();

    const winnerBody = await responses.find((r) => r.status === 200)!.json();
    expect(seat.claimed_by).toBe(winnerBody.seat.claimed_by);
  });

  it('reports the same claimant to every late caller', async () => {
    const seatId = await createOpenSeat();
    await claim(seatId, 'first-user');
    const [before] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);

    await warmPool();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claim(seatId, `late-${i}`)),
    );
    expect(responses.every((r) => r.status === 409)).toBe(true);

    const [after] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);
    expect(after.claimed_by).toBe(before.claimed_by);
  });
});

describe('POST /api/seats/[id]/claim — input handling', () => {
  it('404s for a seat that does not exist', async () => {
    const response = await claim(crypto.randomUUID(), 'nobody');
    expect(response.status).toBe(404);
  });

  it('400s for a malformed seat id rather than crashing', async () => {
    // A non-UUID reaches Postgres as invalid_text_representation (22P02) and
    // would surface as a 500 if not guarded before the query.
    const response = await claim('not-a-uuid', 'someone');
    expect(response.status).toBe(400);
  });

  it('400s when userId is blank', async () => {
    const seatId = await createOpenSeat();
    const request = new NextRequest(`http://localhost/api/seats/${seatId}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: '   ' }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: seatId }) });
    expect(response.status).toBe(400);

    const [seat] = await sql.query(`SELECT status FROM seats WHERE id = $1`, [seatId]);
    expect(seat.status).toBe('open');
  });

  it('400s when userId is missing', async () => {
    const seatId = await createOpenSeat();
    const request = new NextRequest(`http://localhost/api/seats/${seatId}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: Promise.resolve({ id: seatId }) });
    expect(response.status).toBe(400);
  });
});
