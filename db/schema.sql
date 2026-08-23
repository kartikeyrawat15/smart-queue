-- Smart Queue — seats schema
--
-- Correctness notes:
--   * `status` is constrained to the two legal states; anything else is rejected
--     by the database, not just by application code.
--   * `seats_claim_consistency` makes a half-claimed row unrepresentable: a seat
--     is either open with no claimant, or claimed with both claimant and time.
--     This is the invariant the concurrency test ultimately protects.

CREATE TABLE IF NOT EXISTS seats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL UNIQUE,
  status     text        NOT NULL DEFAULT 'open',
  claimed_by text,
  claimed_at timestamptz,

  CONSTRAINT seats_status_valid
    CHECK (status IN ('open', 'claimed')),

  CONSTRAINT seats_claim_consistency
    CHECK (
      (status = 'open'    AND claimed_by IS NULL     AND claimed_at IS NULL)
      OR
      (status = 'claimed' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
    )
);

-- Supports "show me what's still available", the most common read.
CREATE INDEX IF NOT EXISTS seats_status_idx ON seats (status);

-- How many seats each session currently holds.
--
-- Why a counter row rather than COUNT(*) over seats: the cap has to be
-- enforced atomically, and counting inside the claim UPDATE does not do that.
-- Two concurrent claims for DIFFERENT seats never touch the same seat row, so
-- they do not block each other, and under READ COMMITTED each reads the tally
-- from its own snapshot — both see headroom and both succeed. Measured: a
-- session at 1 of 2 took a third seat.
--
-- Incrementing one row per session forces those claims to serialise on that
-- row, which is the same single-atomic-conditional-UPDATE trick the seat claim
-- itself uses. Crucially it adds contention only BETWEEN claims of the same
-- session, so the cross-session race behaviour is untouched.
CREATE TABLE IF NOT EXISTS session_holdings (
  session_id text PRIMARY KEY,
  seats_held integer NOT NULL DEFAULT 0,

  CONSTRAINT session_holdings_non_negative CHECK (seats_held >= 0)
);
