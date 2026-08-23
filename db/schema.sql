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
