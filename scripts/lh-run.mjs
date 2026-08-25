/**
 * Lighthouse runner.
 *
 * `lhci autorun` cannot finish on this machine: chrome-launcher creates its own
 * temp profile and then fails to delete it (EPERM on Windows), which aborts the
 * run AFTER the audits have already passed. This drives Lighthouse directly with
 * a profile directory we own, so the same numbers can actually be read.
 *
 * Budgets come from lighthouserc.cjs so there is still one source of truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const URL = process.argv[2] ?? 'http://localhost:3001/';
const RUNS = Number(process.argv[3] ?? 3);
const profile = path.join(process.cwd(), '.lh-profile');
fs.mkdirSync(profile, { recursive: true });

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  userDataDir: profile,
  chromePath: process.env.CHROME_PATH,
});

const runs = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse(
      URL,
      { port: chrome.port, output: 'json', logLevel: 'error' },
      { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 }, throttlingMethod: 'simulate' } },
    );
    const lhr = result.lhr;
    runs.push({
      performance: lhr.categories.performance.score,
      accessibility: lhr.categories.accessibility.score,
      bestPractices: lhr.categories['best-practices'].score,
      seo: lhr.categories.seo.score,
      lcp: lhr.audits['largest-contentful-paint'].numericValue,
      cls: lhr.audits['cumulative-layout-shift'].numericValue,
      tbt: lhr.audits['total-blocking-time'].numericValue,
      fcp: lhr.audits['first-contentful-paint'].numericValue,
    });
    fs.writeFileSync(`.lighthouseci/run-${i}.json`, JSON.stringify(lhr));
  }
} finally {
  try {
    await chrome.kill();
  } catch {
    // The EPERM this script exists to work around. The run is already done.
  }
}

const median = (key) => {
  const values = runs.map((r) => r[key]).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};

const report = {
  runs: RUNS,
  performance: median('performance'),
  accessibility: median('accessibility'),
  bestPractices: median('bestPractices'),
  seo: median('seo'),
  fcp: Math.round(median('fcp')),
  lcp: Math.round(median('lcp')),
  cls: +median('cls').toFixed(4),
  tbt: Math.round(median('tbt')),
};
console.log(JSON.stringify({ report, runs }, null, 2));
