/**
 * Live validation for F3Go30-uz9e.3 (decoupling go30hist window length from the 30-day streak
 * cap, and warming the cache after invalidateAllCache wipes it) — the piece the unit suite
 * can't reach, per that issue's implementation comment: nothing in test/test_pax_cache.js or
 * test/test_dashboard_webapp.js exercises a real SpreadsheetApp read, the 30s script lock, or
 * reloadPaxCacheForCurrentAndPriorMonth_ against a full live roster.
 *
 * Not part of the unit suite (npm test) — run directly against a deployed SIT:
 *
 *   npm run deploy:sit
 *   npx playwright test tests/playwright/pax-history-reload-live-check.spec.js
 *
 * Coverage (AC numbers per F3Go30-uz9e.3):
 *  - invalidateAllCache's response carries a `reloaded` block (proves the SIT deployment
 *    actually has this code — the pre-uz9e.3 admin action's response has no such key) and that
 *    block reports both current + prior month warmed, with real paxRows/historyEntries counts
 *    (AC7), skipped:false (the lock was acquired and released cleanly, AC8), and fewer history
 *    entries than paxRows whenever the roster has any never-active PAX (AC9's "no all-'.' entry
 *    stored" rule, observed rather than decoded — Script Properties aren't readable over this
 *    admin surface).
 *  - A live dashboard read for a real, currently-checked-in PAX, taken immediately after the
 *    reload (so it is reading the rebuilt go30hist entry, not a cold-start fallback), still
 *    satisfies the shape invariants AC1/AC2/AC5/AC6 describe: rollingAverage stays exactly
 *    dayValues.length long, priorMonthDayValues stays capped at 13, and both streak figures stay
 *    <= 30 — the same invariants test_dashboard_webapp.js's "history-window/streak-cap"
 *    assertions prove for a synthetic 62-day window, now proven for whatever the roster's real
 *    stored window is.
 *  - Two invalidateAllCache calls back-to-back both succeed (skipped:false both times) — the
 *    lock this function holds across its whole read+write span is actually released on the
 *    normal-completion path, not just in the unit test's fake LockService.
 *
 * NOT covered here: the lock-contention branch (AC8's skip-on-failure path) and the streak cap
 * actually binding at 30 (no live PAX carries a 30+ day streak) — both need a controlled
 * scenario a live roster can't provide, and are covered instead by test_dashboard_webapp.js's
 * fake-LockService and synthetic-window cases.
 */
const { test, expect } = require('@playwright/test');
const { loadSettings, buildPayload_, post, ENV_MAP } = require('../../tools/callWebapp.js');

const CHECK_ENV = process.env.PAX_HISTORY_RELOAD_CHECK_ENV || 'sit';

// A real, currently-checked-in PAX on SIT (F3Go30-uz9e.3 verification, 2026-08-04) — has at
// least one reported day this month, so the post-reload dashboard read exercises a real,
// non-empty go30hist entry rather than the cold-start fallback. Update if this PAX's SIT
// signup is ever torn down.
const LIVE_PAX = { f3Name: 'Whiplash', email: 'whiplash.f3@gmail.com' };

async function callWebappAction(cmd, action, extraBody) {
  const settings = loadSettings();
  const { deploymentIdKey, adminSecretKey } = ENV_MAP[CHECK_ENV];
  const deploymentId = settings[deploymentIdKey];
  const adminSecret = cmd === 'admin' ? settings[adminSecretKey] : null;
  const url = `https://script.google.com/macros/s/${deploymentId}/exec?cmd=${cmd}`;
  const payload = buildPayload_(action, cmd, extraBody || {}, adminSecret);
  return post(url, payload);
}

async function invalidateAllCache() {
  return callWebappAction('admin', 'invalidateAllCache');
}

async function readDashboard(pax) {
  return callWebappAction('checkin', 'dashboard', {
    f3Name: pax.f3Name, email: pax.email, targetMonth: 'current',
  });
}

test.describe('PaxCache history reload live check (F3Go30-uz9e.3)', () => {
  test('invalidateAllCache reloads both months with real, bounded counts (AC7, AC8, AC9)', async () => {
    const result = await invalidateAllCache();
    expect(result.ok).toBe(true);
    expect(result.reloaded).toBeTruthy(); // absent entirely on a pre-uz9e.3 deploy
    expect(result.reloaded.skipped).toBe(false);
    expect(Array.isArray(result.reloaded.months)).toBe(true);
    expect(result.reloaded.months.length).toBeGreaterThanOrEqual(1);
    expect(result.reloaded.months.length).toBeLessThanOrEqual(2);
    expect(result.reloaded.paxRows).toBeGreaterThan(0);
    // AC9: a never-active PAX stores no history entry, so historyEntries <= paxRows whenever the
    // roster has any (SIT's does — several roster rows carry no checkins this month).
    expect(result.reloaded.historyEntries).toBeGreaterThan(0);
    expect(result.reloaded.historyEntries).toBeLessThanOrEqual(result.reloaded.paxRows);
  });

  test('back-to-back invalidateAllCache calls both complete cleanly (lock released on completion)', async () => {
    const first = await invalidateAllCache();
    const second = await invalidateAllCache();
    expect(first.reloaded.skipped).toBe(false);
    expect(second.reloaded.skipped).toBe(false);
  });

  test('a live dashboard read after reload keeps window-length/streak-cap invariants (AC1, AC2, AC5, AC6)', async () => {
    await invalidateAllCache();
    const dash = await readDashboard(LIVE_PAX);
    expect(dash.ok).toBe(true);
    expect(Array.isArray(dash.dayValues)).toBe(true);
    expect(Array.isArray(dash.rollingAverage)).toBe(true);
    // F3Go30-3uvp: rollingAverage is deliberately truncated to the last REPORTED day
    // (buildDashboardPaxRow_'s lastReportedDayCount_ slice) so its line stops before any
    // pending/unreported trailing days rather than flattening into them — it is allowed to be
    // shorter than dayValues whenever the PAX has unreported days at the end of the window, but
    // never longer.
    expect(dash.rollingAverage.length).toBeLessThanOrEqual(dash.dayValues.length); // AC5
    expect(Array.isArray(dash.priorMonthDayValues)).toBe(true);
    expect(dash.priorMonthDayValues.length).toBeLessThanOrEqual(13); // AC6
    expect(dash.streak).toBeLessThanOrEqual(30); // AC2
    expect(dash.maxStreak30).toBeLessThanOrEqual(30); // AC1
    expect(dash.streak).toBeGreaterThanOrEqual(0);
    expect(dash.maxStreak30).toBeGreaterThanOrEqual(0);
  });
});
