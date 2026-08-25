import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * ── Why there is no Content-Security-Policy here ─────────────────────────
 * Deliberately deferred, not overlooked. Next's App Router injects inline
 * bootstrap and flight-payload scripts, so a useful `script-src` needs a
 * per-request nonce threaded through middleware and every inline style — and
 * getting it wrong fails closed: a blank page in production that local dev
 * will not reproduce. A policy loose enough to avoid that (`'unsafe-inline'`,
 * `'unsafe-eval'`) neutralises most of what CSP is for, so it would be
 * security theatre rather than security.
 *
 * The judgement is that for a six-seat portfolio demo with no user-generated
 * content, no third-party scripts and no `dangerouslySetInnerHTML` anywhere,
 * the XSS surface CSP would defend does not currently exist. The three headers
 * below are the ones that carry real value at zero risk of breaking the app.
 * If this ever renders untrusted content, CSP stops being optional and the
 * nonce work has to happen first.
 */
const securityHeaders = [
  // Stop the browser from re-interpreting a response as a type we did not
  // send — the classic way a JSON endpoint becomes a script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Clickjacking. SAMEORIGIN rather than DENY so the page can still be framed
  // by itself, which is how the 390x844 viewport check in SeatScene works.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // The modern equivalent, for browsers that prefer CSP's version. Kept in
  // step with the line above; this is the only CSP directive set, because it
  // cannot break script or style loading.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },

  // Send the full URL to ourselves, origin-only to other HTTPS sites, and
  // nothing at all on a downgrade to HTTP.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
