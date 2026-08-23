import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Tests talk to the real Neon database; load the same env the app uses.
config({ path: '.env.local' });

export default defineConfig({
  resolve: {
    // Mirror the `@/*` alias from tsconfig.json so route handlers importing
    // `@/lib/db` resolve under Vitest exactly as they do under Next.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Neon is a network round-trip and the concurrency test fires 50 at once.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These tests mutate shared rows in a single shared database. Running
    // files in parallel would let one suite's cleanup clobber another's
    // fixtures and produce phantom pass/fail. Keep it strictly serial.
    fileParallelism: false,
  },
});
