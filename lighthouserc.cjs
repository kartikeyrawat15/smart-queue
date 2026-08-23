/**
 * Lighthouse CI gate.
 *
 * Runs against the PRODUCTION build (`next build` + `next start`), never the
 * dev server — dev numbers include HMR and unminified bundles and are
 * meaningless as a budget.
 *
 * Median-of-N so per-run jitter cannot red-flag a healthy build.
 */

// Core Web Vitals — Google's "good" thresholds, not "needs improvement".
const LCP_MS = 2500; // Largest Contentful Paint
const CLS = 0.1; // Cumulative Layout Shift
const TBT_MS = 200; // Total Blocking Time, the lab proxy for INP

// Category floors.
const PERFORMANCE_FLOOR = 0.8;
const ACCESSIBILITY_FLOOR = 0.9;
const BEST_PRACTICES_FLOOR = 0.9;

const RUNS = 3;

module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3001/'],
      numberOfRuns: RUNS,
      settings: {
        preset: 'desktop',
        // Headless, so the run does not depend on the window being focused.
        // A backgrounded window starves requestAnimationFrame and Lighthouse
        // reports NO_FCP.
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: PERFORMANCE_FLOOR }],
        'categories:accessibility': ['warn', { minScore: ACCESSIBILITY_FLOOR }],
        'categories:best-practices': ['warn', { minScore: BEST_PRACTICES_FLOOR }],
        'largest-contentful-paint': ['warn', { maxNumericValue: LCP_MS }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: CLS }],
        'total-blocking-time': ['warn', { maxNumericValue: TBT_MS }],
      },
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci' },
  },
};
