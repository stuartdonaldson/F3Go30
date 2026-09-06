/**
 * Tier markers (F3Go30-emwk.2, realizes H3 — approved design, plan escalation E3).
 *
 * The single place both this project's runners read the tier classification from. Two markers
 * only: NO_LIVE_SESSION and LIVE. LIVE is the default by construction — a spec not explicitly
 * listed under NO_LIVE_SESSION_SPECS is classified LIVE. This is why H3 is recorded `declined`,
 * not `conformant` (docs/atdd/harness-design.md §9a): H3 exists to stop an unmarked test leaking
 * into the *fast* gate, and a live-by-default classification makes that leak directionally
 * impossible — a forgotten marker can only make the live tier slower, never smuggle a live spec
 * into the network-free one.
 *
 * Classification is the adoption plan's E3 read-back (escalation E3, approved 2026-09-06; the
 * staging doc that recorded it is retired per `staged-plan` Mode C — see EPIC `F3Go30-emwk`'s
 * close reason) — every spec's `page.goto` targets, route handlers and imports were read
 * directly. It is NOT the `-live-check` filename suffix, which is wrong for 5 of 11 specs and is
 * decoration only (project-testing-guide.md §2).
 *
 * demo-screenshots.spec.js is deliberately absent from both classifications below: it is a
 * purpose exclusion, not a tier member (see PURPOSE_EXCLUDED). It stays runnable via its own
 * `pnpm run demo:screenshots` script and is not selected by test:local, test:live or
 * test:regression.
 */

'use strict';

const NO_LIVE_SESSION = 'no_live_session';
const LIVE = 'live';

/** The only network-free spec today — every request intercepted, nothing here can fail because
 * SIT is having a bad minute (the exact failure mode it defends against). */
const NO_LIVE_SESSION_SPECS = ['transport-resilience.spec.js'];

/** Purpose exclusions: real specs that are neither tier's member, for a stated reason. Not run by
 * any declared tier; kept directly runnable by their own script. */
const PURPOSE_EXCLUDED = {
  'demo-screenshots.spec.js':
    'produces demo screenshots headed; asserts nothing a regression run needs — stays runnable via `pnpm run demo:screenshots` (plan escalation E3)',
};

/** Two grades of "live" exist (plan escalation E3), recorded here for a later test:prep/auth-setup
 * stage to act on — not split into separate tiers yet. Specs in this set need an authenticated
 * Google *browser* session (the Apps Script editor or Sheets UI), not just the live webapp. */
const LIVE_GRADE_BROWSER_SESSION = new Set([
  'copy-and-init.spec.js',
  'tracker-edit-trigger-live-check.spec.js',
]);

/**
 * Classify one spec filename (basename, e.g. 'static-checkin.spec.js').
 * Returns NO_LIVE_SESSION, LIVE, or null for a purpose exclusion (not a tier member).
 */
function classify(specFilename) {
  if (Object.prototype.hasOwnProperty.call(PURPOSE_EXCLUDED, specFilename)) {
    return null;
  }
  return NO_LIVE_SESSION_SPECS.includes(specFilename) ? NO_LIVE_SESSION : LIVE;
}

module.exports = {
  NO_LIVE_SESSION,
  LIVE,
  NO_LIVE_SESSION_SPECS,
  PURPOSE_EXCLUDED,
  LIVE_GRADE_BROWSER_SESSION,
  classify,
};
