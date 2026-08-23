import { NextRequest } from 'next/server';

/**
 * Fixed-window rate limiter.
 *
 * ⚠️ IN-MEMORY AND PER-INSTANCE. State lives in this process only. On any
 * multi-instance deployment (Vercel serverless/edge included) each instance
 * keeps its own counters, so the effective limit is roughly
 * `limit × instanceCount` and a cold start resets it. That is a meaningful
 * weakening, not a rounding error.
 *
 * This is deliberate scaffolding: it closes the "one actor sweeps the entire
 * venue from a single process" hole today without adding infrastructure.
 * Before production this must move to shared storage (Upstash/Redis
 * INCR + EXPIRE, or Vercel KV) so the window is global.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bound memory: drop expired buckets once the map grows past this. */
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. Zero when allowed. */
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size > SWEEP_THRESHOLD) sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client IP.
 *
 * ⚠️ `x-forwarded-for` is client-supplied and trivially spoofed unless a
 * trusted proxy overwrites it. On Vercel the platform sets it, so it is
 * reliable there. Self-hosting behind an untrusted edge makes the per-IP
 * limit bypassable — the per-session limit is the sturdier of the two.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test-only: clears all windows so suites do not leak state into each other. */
export function __resetRateLimits() {
  buckets.clear();
}
