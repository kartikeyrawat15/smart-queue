import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local');
}

/**
 * Neon HTTP client. Each call is a single round-trip, which is all the claim
 * path needs — the atomicity comes from the statement itself, not from a
 * surrounding transaction.
 */
export const sql = neon(connectionString);
