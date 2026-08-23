/**
 * Schema-level guarantees for the `seats` table.
 *
 * These tests assert that the DATABASE rejects illegal rows — not that the
 * application avoids writing them. That distinction is the point: the claim
 * route is about to be stress-tested for a race, and we need to know the
 * storage layer itself cannot hold an incoherent seat.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/** Labels used by this suite; cleaned up after every test. */
const TEST_PREFIX = 'TEST_SCHEMA_';

afterEach(async () => {
  await sql.query(`DELETE FROM seats WHERE label LIKE '${TEST_PREFIX}%'`);
});

/**
 * Attempts an insert and returns the violated constraint name.
 * Fails loudly if the row was ACCEPTED — a silent accept is the bug we care
 * about, and must never be mistaken for a pass.
 */
async function expectRejection(statement: string, params: unknown[] = []) {
  let error: { constraint?: string; code?: string } | undefined;
  try {
    await sql.query(statement, params);
  } catch (e) {
    error = e as { constraint?: string; code?: string };
  }
  if (!error) {
    throw new Error(`Row was ACCEPTED but should have been rejected: ${statement}`);
  }
  return error;
}

describe('seats_claim_consistency', () => {
  // The isolating cases: every `status` below is a VALID enum value, so
  // seats_status_valid is satisfied and cannot be what fires. Any rejection
  // is therefore attributable to seats_claim_consistency alone.

  it('rejects status=claimed with claimed_by NULL', async () => {
    const error = await expectRejection(
      `INSERT INTO seats (label, status, claimed_at) VALUES ($1, 'claimed', now())`,
      [`${TEST_PREFIX}A`],
    );
    expect(error.constraint).toBe('seats_claim_consistency');
    expect(error.code).toBe('23514'); // check_violation
  });

  it('rejects status=claimed with claimed_at NULL', async () => {
    const error = await expectRejection(
      `INSERT INTO seats (label, status, claimed_by) VALUES ($1, 'claimed', 'alice')`,
      [`${TEST_PREFIX}B`],
    );
    expect(error.constraint).toBe('seats_claim_consistency');
  });

  it('rejects status=open that carries a claimant', async () => {
    const error = await expectRejection(
      `INSERT INTO seats (label, status, claimed_by, claimed_at) VALUES ($1, 'open', 'alice', now())`,
      [`${TEST_PREFIX}C`],
    );
    expect(error.constraint).toBe('seats_claim_consistency');
  });

  it('rejects an UPDATE that half-claims an existing open seat', async () => {
    // The failure mode this constraint exists to stop: a write path that sets
    // status without setting the claimant. Insert legally, then try to corrupt.
    await sql.query(`INSERT INTO seats (label) VALUES ($1)`, [`${TEST_PREFIX}D`]);
    const error = await expectRejection(
      `UPDATE seats SET status = 'claimed' WHERE label = $1`,
      [`${TEST_PREFIX}D`],
    );
    expect(error.constraint).toBe('seats_claim_consistency');
  });

  // Positive controls. A constraint that rejected EVERYTHING would pass every
  // test above, so we must also prove it admits the two legal shapes.

  it('accepts a legal open seat', async () => {
    await sql.query(`INSERT INTO seats (label) VALUES ($1)`, [`${TEST_PREFIX}E`]);
    const [row] = await sql.query(
      `SELECT status, claimed_by, claimed_at FROM seats WHERE label = $1`,
      [`${TEST_PREFIX}E`],
    );
    expect(row).toMatchObject({ status: 'open', claimed_by: null, claimed_at: null });
  });

  it('accepts a legal claimed seat', async () => {
    await sql.query(
      `INSERT INTO seats (label, status, claimed_by, claimed_at)
       VALUES ($1, 'claimed', 'alice', now())`,
      [`${TEST_PREFIX}F`],
    );
    const [row] = await sql.query(
      `SELECT status, claimed_by FROM seats WHERE label = $1`,
      [`${TEST_PREFIX}F`],
    );
    expect(row).toMatchObject({ status: 'claimed', claimed_by: 'alice' });
  });
});

describe('seats_status_valid', () => {
  it('rejects a status outside the allowed set', async () => {
    const error = await expectRejection(
      `INSERT INTO seats (label, status) VALUES ($1, 'pending')`,
      [`${TEST_PREFIX}G`],
    );
    expect(error.code).toBe('23514');
    // NOTE: this asserts *a* check violation, deliberately not a constraint
    // name. seats_status_valid cannot be isolated — see the test below.
  });

  it('is subsumed by seats_claim_consistency and can never fire alone', async () => {
    // Any status outside ('open','claimed') fails BOTH constraints, because
    // seats_claim_consistency's two branches each pin status to a literal.
    // Postgres reports whichever it evaluates first, so seats_status_valid is
    // documentation and defence-in-depth, not an independently reachable rule.
    const error = await expectRejection(
      `INSERT INTO seats (label, status, claimed_by, claimed_at)
       VALUES ($1, 'pending', 'alice', now())`,
      [`${TEST_PREFIX}H`],
    );
    expect(error.constraint).toBe('seats_claim_consistency');
  });
});
