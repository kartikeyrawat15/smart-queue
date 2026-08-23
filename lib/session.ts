import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Anonymous, server-issued identity.
 *
 * There is no login. On first request the server mints a random identifier and
 * returns it in an HTTP-only cookie; every later request is identified by that
 * cookie. The client never supplies its own identity.
 *
 * ── Why the cookie is signed ─────────────────────────────────────────────
 * HttpOnly only stops browser JavaScript from reading the cookie. It does not
 * stop anyone from sending an arbitrary `Cookie:` header with curl. An
 * unsigned session id would therefore be exactly as forgeable as the
 * body-supplied `userId` this replaces. The value is `<id>.<hmac>`, and a
 * token whose HMAC does not verify is discarded and replaced with a fresh
 * session rather than trusted.
 *
 * ── What this does and does not prevent ──────────────────────────────────
 * Prevents: impersonating a SPECIFIC existing identity (you cannot forge a
 * signature without the secret).
 * Does NOT prevent: minting unlimited NEW anonymous identities — that is
 * inherent to anonymous access and is bounded by rate limiting, not here.
 *
 * ── CSRF ─────────────────────────────────────────────────────────────────
 * SameSite=Lax means the browser does not attach this cookie to cross-site
 * POSTs, so a forged cross-origin claim arrives with no session and cannot
 * act as the victim. That covers this route's CSRF exposure; a dedicated
 * CSRF token is deferred and only becomes necessary if a route ever needs to
 * accept cross-site state-changing requests.
 */

export const SESSION_COOKIE = 'sq_session';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ID_PATTERN = /^[0-9a-f]{64}$/;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  }
  return value;
}

function sign(id: string): string {
  return createHmac('sha256', secret()).update(id).digest('base64url');
}

function signatureMatches(id: string, provided: string): boolean {
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(provided);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export type Session = {
  /** Opaque, server-generated identifier. Safe to persist as the claimant. */
  id: string;
  /** True when this request had no valid session and one was just minted. */
  isNew: boolean;
};

/** Returns the caller's verified session, minting a new one if absent or forged. */
export function getSession(request: NextRequest): Session {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;

  if (raw) {
    const separator = raw.lastIndexOf('.');
    if (separator > 0) {
      const id = raw.slice(0, separator);
      const signature = raw.slice(separator + 1);
      if (ID_PATTERN.test(id) && signatureMatches(id, signature)) {
        return { id, isNew: false };
      }
    }
  }

  return { id: randomBytes(32).toString('hex'), isNew: true };
}

/** Attaches the Set-Cookie header when a session was newly minted. */
export function attachSession<T>(
  response: NextResponse<T>,
  session: Session,
): NextResponse<T> {
  if (!session.isNew) return response;

  response.cookies.set(SESSION_COOKIE, `${session.id}.${sign(session.id)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}
