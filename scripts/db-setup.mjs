/**
 * Applies db/schema.sql and seeds a small set of seats.
 * Idempotent: safe to re-run.
 *
 *   node scripts/db-setup.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'db', 'schema.sql');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Split on semicolons at end-of-statement, dropping comments and blanks.
const statements = readFileSync(schemaPath, 'utf8')
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.split('\n').every((l) => l.trim().startsWith('--')));

for (const statement of statements) {
  await sql.query(statement);
  console.log('applied:', statement.split('\n')[0].slice(0, 60));
}

const SEATS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
for (const label of SEATS) {
  await sql.query(
    `INSERT INTO seats (label) VALUES ($1) ON CONFLICT (label) DO NOTHING`,
    [label],
  );
}

const rows = await sql.query(`SELECT label, status FROM seats ORDER BY label`);
console.log('\nseats:');
console.table(rows);
