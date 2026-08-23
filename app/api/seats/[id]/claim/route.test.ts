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
import { createHmac, randomBytes } from 'node:crypto';
import { POST } from './route';
import { SESSION_COOKIE } from '@/lib/session';
import { __resetRateLimits } from '@/lib/rate-limit';

const sql = neon(process.env.DATABASE_URL!);

const CONCURRENCY = 50;
const TEST_PREFIX = 'TEST_CLAIM_';

/** Force the HTTP pool to open ~CONCURRENCY sockets so requests truly overlap. */
async function warmPool() {
  await Promise.all(Array.from({ length: CONCURRENCY }, () => sql.query('SELECT 1')));
}

async function createOpenSeat(): Promise<string> {
  const label = `${TEST_PREFIX}${crypto.randomUUID()}`;
  const [row] = await sql.query(`INSERT INTO seats (label) VALUES ($1) RETURNING id`, [label]);
  return row.id as string;
}

/** Mints a cookie the server will accept — same construction as lib/session.ts. */
function validSessionCookie(id = randomBytes(32).toString('hex')) {
  const sig = createHmac('sha256', process.env.SESSION_SECRET!).update(id).digest('base64url');
  return { id, cookie: `${SESSION_COOKIE}=${id}.${sig}` };
}

type CallOptions = { cookie?: string; ip?: string };

/** Invokes the route handler exactly as Next would. */
function claim(seatId: string, options: CallOptions = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.cookie) headers.set('cookie', options.cookie);
  // Distinct IPs by default so the per-IP limit does not confound tests that
  // are about something else.
  headers.set('x-forwarded-for', options.ip ?? `10.0.0.${Math.floor(Math.random() * 254) + 1}`);

  const request = new NextRequest(`http://localhost/api/seats/${seatId}/claim`, {
    method: 'POST',
    headers,
  });
  return POST(request, { params: Promise.resolve({ id: seatId }) });
}

const cleanup = () => sql.query(`DELETE FROM seats WHERE label LIKE '${TEST_PREFIX}%'`);

beforeEach(async () => {
  __resetRateLimits();
  await cleanup();
});
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

    // 50 distinct sessions from 50 distinct IPs — genuinely different people.
    const sessions = Array.from({ length: CONCURRENCY }, () => validSessionCookie());
    const settled = await Promise.allSettled(
      sessions.map((s, i) => claim(seatId, { cookie: s.cookie, ip: `10.1.${i >> 8}.${i % 254}` })),
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

    expect(winners.length, `expected exactly 1 winner — got ${summary}`).toBe(1);
    expect(threw.length, `handler threw for ${threw.length} requests`).toBe(0);
    expect(other.length, `unexpected statuses: [${other.join(',')}]`).toBe(0);
    expect(conflicts.length).toBe(CONCURRENCY - 1);

    // The database agrees with whoever we told they won.
    const [seat] = await sql.query(
      `SELECT status, claimed_by, claimed_at FROM seats WHERE id = $1`,
      [seatId],
    );
    expect(seat.status).toBe('claimed');
    expect(seat.claimed_at).not.toBeNull();

    const winnerBody = await responses.find((r) => r.status === 200)!.json();
    expect(seat.claimed_by).toBe(winnerBody.seat.claimed_by);
    // The claimant is a server-issued session id, and it belongs to a real
    // session we minted — not anything the caller supplied.
    expect(sessions.map((s) => s.id)).toContain(seat.claimed_by);
  });

  it('reports the same claimant to every late caller', async () => {
    const seatId = await createOpenSeat();
    await claim(seatId, { cookie: validSessionCookie().cookie });
    const [before] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);

    await warmPool();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        claim(seatId, { cookie: validSessionCookie().cookie, ip: `10.2.0.${i + 1}` }),
      ),
    );
    expect(responses.every((r) => r.status === 409)).toBe(true);

    const [after] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);
    expect(after.claimed_by).toBe(before.claimed_by);
  });
});

describe('POST /api/seats/[id]/claim — identity', () => {
  it('issues an HttpOnly SameSite session cookie to a first-time caller', async () => {
    const seatId = await createOpenSeat();
    const response = await claim(seatId);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).toContain('path=/');
  });

  it('ignores any identity supplied in the request body', async () => {
    const seatId = await createOpenSeat();
    const { id, cookie } = validSessionCookie();

    const headers = new Headers({ 'content-type': 'application/json', cookie });
    headers.set('x-forwarded-for', '10.3.0.1');
    const request = new NextRequest(`http://localhost/api/seats/${seatId}/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'ceo@victim-corp.example' }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: seatId }) });
    expect(response.status).toBe(200);

    const [seat] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);
    expect(seat.claimed_by).toBe(id);
    expect(seat.claimed_by).not.toBe('ceo@victim-corp.example');
  });

  it('rejects a forged cookie and issues a fresh session instead', async () => {
    const seatId = await createOpenSeat();
    const forgedId = randomBytes(32).toString('hex');

    const response = await claim(seatId, {
      cookie: `${SESSION_COOKIE}=${forgedId}.not-a-valid-signature`,
    });
    expect(response.status).toBe(200);

    const [seat] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);
    // The forged identity was discarded, not honoured.
    expect(seat.claimed_by).not.toBe(forgedId);
    expect(response.headers.get('set-cookie')).toContain(SESSION_COOKIE);
  });

  it('honours a valid cookie without reissuing one', async () => {
    const seatId = await createOpenSeat();
    const { id, cookie } = validSessionCookie();

    const response = await claim(seatId, { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();

    const [seat] = await sql.query(`SELECT claimed_by FROM seats WHERE id = $1`, [seatId]);
    expect(seat.claimed_by).toBe(id);
  });
});

describe('POST /api/seats/[id]/claim — rate limiting', () => {
  it('429s a single session that floods the endpoint', async () => {
    const { cookie } = validSessionCookie();
    const seatIds = await Promise.all(Array.from({ length: 15 }, () => createOpenSeat()));

    const statuses: number[] = [];
    for (const seatId of seatIds) {
      statuses.push((await claim(seatId, { cookie, ip: '10.4.0.1' })).status);
    }

    const blocked = statuses.filter((s) => s === 429);
    expect(blocked.length, `expected some 429s, got [${statuses.join(',')}]`).toBeGreaterThan(0);
  });

  it('sends Retry-After with a 429', async () => {
    const { cookie } = validSessionCookie();
    const seatIds = await Promise.all(Array.from({ length: 15 }, () => createOpenSeat()));

    let limited: Response | null = null;
    for (const seatId of seatIds) {
      const r = await claim(seatId, { cookie, ip: '10.4.0.2' });
      if (r.status === 429) { limited = r; break; }
    }

    expect(limited).not.toBeNull();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('limits by IP even across different sessions', async () => {
    const seatIds = await Promise.all(Array.from({ length: 40 }, () => createOpenSeat()));

    const statuses: number[] = [];
    for (const seatId of seatIds) {
      // Fresh session every time, but the same IP.
      statuses.push((await claim(seatId, { cookie: validSessionCookie().cookie, ip: '10.5.0.9' })).status);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('POST /api/seats/[id]/claim — input handling', () => {
  it('404s for a seat that does not exist', async () => {
    const response = await claim(crypto.randomUUID());
    expect(response.status).toBe(404);
  });

  it('400s for a malformed seat id rather than crashing', async () => {
    // A non-UUID reaches Postgres as invalid_text_representation (22P02) and
    // would surface as a 500 if not guarded before the query.
    const response = await claim('not-a-uuid');
    expect(response.status).toBe(400);
  });

  it('succeeds with no body at all — the body is not an input any more', async () => {
    const seatId = await createOpenSeat();
    const response = await claim(seatId);
    expect(response.status).toBe(200);
  });
});
