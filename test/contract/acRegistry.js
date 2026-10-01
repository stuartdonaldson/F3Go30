/**
 * acRegistry.js — the authoritative enumeration of this project's acceptance criteria
 * (F3Go30-emwk.7; realizes T24, feeds H10; single-source per I6).
 *
 * WHAT THIS IS. `AC_REGISTRY` is a plain `{id: description}` map. The id is the unit of test
 * obligation (ADR-0011 §Decision 1): one entry per *behaviour a test is obliged to hold*, not
 * one entry per test file, not one per bead, not one per function.
 *
 * ID RULES — these are what keep H11 true, and the only rules a new entry has to obey:
 *
 *   1. An id is BEHAVIOURAL. It reads as a short sentence about the system:
 *      `checkin snapshot-day-boundary`, not `F3Go30-833s.17`, not `test_checkin_snapshot`.
 *   2. An id NEVER contains a tracker id. The bead lives in the *description*, where it is
 *      searchable but cannot leak into a filename, a JUnit property, or a report column.
 *      `assertNoTrackerIdsInAcIds()` below enforces this mechanically — it is not a convention
 *      anyone has to remember.
 *   3. The shape is `<domain> <behaviour-slug>`, lowercase, single space between the two halves,
 *      hyphens inside each half. The domain half is what makes the enumeration readable when
 *      printed one per line, and what a later gap-diff groups on.
 *
 * WHY `AC_SELFTEST_FIXTURES` IS A SEPARATE MAP. The harness's own tests need tags too, and in the
 * reference implementation (GActionSheet `scn/contract.py`) those tags once lived inside
 * `AC_REGISTRY`. They inflated the denominator by 27% — 37 nominal ACs against 27 real ones — and
 * every one of them was permanently reported "uncovered", because no product test ever tags a
 * harness fixture. They are separated here from the first commit rather than after the same
 * mistake. Nothing that computes coverage may read `AC_SELFTEST_FIXTURES`: it is documentation of
 * what the harness exercises about itself, and `listAcIds()` deliberately does not include it.
 *
 * HOME. `test/contract/` is this project's single contract-shape home for test purposes — a
 * recorded deviation from the reference implementation, which co-locates its registry with a
 * generated contract module (`scn/contract.py` from `ContractSchema.json`). F3Go30 has NO
 * machine-readable contract source; its contract is prose in `docs/pax-data-model-and-contract.md`
 * (harness-design.md §10 observation 1). If a contract module is ever extracted, this file moves
 * into it and this paragraph is deleted.
 *
 * ENUMERATION. `node test/contract/acRegistry.js` prints one AC id per line, which is the exact
 * input `$DEVSTANDARD/tools/test-suite-diagnostics.py --ac-list-cmd` wants:
 *
 *     python $DEVSTANDARD/tools/test-suite-diagnostics.py --root . \
 *       --ac-list-cmd "node test/contract/acRegistry.js"
 *
 * `--json` prints the same ids as a JSON array (also accepted by that flag).
 *
 * SCOPE, STATED HONESTLY. This registry enumerates the obligations; it does NOT yet claim which
 * test drains which id. Per-test AC tagging and the gap-diff that consumes it are F3Go30-emwk.12
 * (deferred, no stage — upstream T24 is not fully ratified). Until then this file answers "what
 * must hold", and the charter (docs/atdd/project-testing-guide.md §6) answers "which journey is
 * responsible". Do not infer coverage from membership here.
 */

'use strict';

/**
 * Acceptance criteria — the behaviours this project is obliged to keep true.
 *
 * Sourced 2026-09-06 from the two places obligations actually exist today: the journey charter
 * (docs/atdd/project-testing-guide.md §6) and the behaviour each `test/test_*.js` file was
 * written to hold, read from its own header. Bead ids in the descriptions are provenance, so a
 * reader can find the argument behind an entry; they are not part of the obligation.
 */
const AC_REGISTRY = {
  // ── check-in: the daily write path ────────────────────────────────────────────────────────
  'checkin identify-returns-month-state':
    'cmd=checkin identify returns the PAX identity plus the current month\'s day values and navigation payload (dashboardWebapp.js handleCheckinIdentify_)',
  'checkin identify-paxdb-fallback':
    'identify resolves a PAX from PaxDB when the PaxCache row is cold or absent, rather than reporting an unknown PAX (F3Go30-xj1q.1)',
  'checkin submit-writes-day':
    'cmd=checkin checkin writes the requested day\'s value to the tracker row for that PAX and reports the stored value back',
  'checkin write-through-overlay':
    'a check-in the client just made is visible in the client\'s own board state before the round trip resolves, and survives an in-flight prefetch landing afterwards (F3Go30-5nfj.5)',
  'checkin saving-label-recovers':
    'a day button\'s "Saving…" label always resolves back to its true state after a re-render — it can never stick with the disabled state and status note correct (F3Go30-5c2a.5)',
  'checkin concurrency-cap-holds':
    'rapid cross-day tapping stays within the client\'s global concurrency cap and the per-button saving flag survives a re-render mid-flight',
  'checkin snapshot-day-boundary':
    'the instant-paint snapshot never paints yesterday\'s status under a TODAY heading recomputed from a newer clock (F3Go30-833s.17)',
  'checkin session-resume-refresh':
    'a PWA resumed from background refetches PAX data rather than serving state parked from an earlier day (F3Go30-833s.14)',
  'checkin month-grid-request':
    'cmd=checkin monthGrid returns a whole-month grid for the requested month, independent of the day-nav view date',
  'checkin advanced-grid-selection':
    'the whole-month grid\'s multi-day selection panel submits exactly the selected days and re-renders from the response',
  'checkin sitefeedback-live-send':
    'the settings-menu Send Feedback flow posts a real report to the live server and the UI reports it sent, with SIT\'s Email Test Mode redirecting delivery rather than reaching a real inbox (F3Go30-y8j7.1)',

  // ── dashboard: the read path the PAX judges the app by ────────────────────────────────────
  'dashboard renders-from-cache-then-revalidates':
    'a cached month renders immediately and is then revalidated in place — never a blocking spinner when a cached copy exists (F3Go30-833s.13)',
  'dashboard streak-from-server-history':
    'rendered streak and 30-day max streak come from the server\'s history values, not recomputed from this-month-only day values (F3Go30-5uk2)',
  'dashboard rolling-average-denominator':
    'the rolling-average denominator is anchored at the PAX\'s first active day, so a mid-month joiner is not scored against days before they enrolled',
  'dashboard board-shows-bonus-chips':
    'the all-teams board row shows a PAX\'s bonus chips when nonzero, in addition to the own-team tile grid (F3Go30-y55y)',
  'dashboard render-telemetry-emitted':
    'every dashboard render attempt emits one telemetry record distinguishing a lost response from a genuinely empty one, with the payload length fields (F3Go30-5p3z)',
  'dashboard pax-history-window-rebuild':
    'the PaxCache history window rebuilds correctly after a full cache invalidation, under the script lock, for a full roster',

  // ── signup: creating and re-identifying a PAX ─────────────────────────────────────────────
  'signup identify-requires-name-and-email':
    'cmd=signup identify matches only when F3 name AND email both match — a name alone never discloses a stored record (anti-enumeration, contract §6.1)',
  'signup save-persists-goals':
    'cmd=signup save persists team, goals and profile for the target month and reports the saved record back',
  'signup info-step-validates':
    'the signup info step blocks Continue until team and goals are supplied, rather than saving a blank record (F3Go30-9u68)',
  'signup team-match-precedence':
    'team resolution tries AO match (case-insensitively, canonical casing wins), then goal match, then preserves an "other" value verbatim',
  'signup reuse-last-month-goals':
    'a returning PAX offered last month\'s goals gets them applied only on an affirmative choice, and the flow completes when no prior tracker exists',
  'signup done-url-bookmarkable':
    'the signup done card leaves a bookmarkable URL — the signup routing params are cleared when the identity token is installed (F3Go30-1f75)',
  'signup next-month-checkin-link':
    'a next-month signup still returns the personal check-in link, even though there is nothing to check into yet (F3Go30-1f75 follow-up)',
  'signup legacy-link-never-dead-ends':
    'every already-distributed signup link — bookmarks, Slack posts, short URLs — still lands the PAX on the current signup surface (F3Go30-833s.11)',
  'signup confirmation-email-leads-with-checkin':
    'the confirmation email leads with the personal, bookmarkable check-in link and demotes the tracker sheet to a fallback',
  'signup feedback-round-trip':
    'cmd=signup feedback accepts a site-feedback report and is idempotent under a hand-retried resubmission of the identical report (F3Go30-5c2a.3)',
  'signup feedback-writes-and-rejects-unmatched':
    'cmd=signup feedback writes rating/comment onto a matched row and is rejected with signup_not_found for an f3Name/email pair with no Responses row (F3Go30-y8j7.1)',

  // ── bonus points ──────────────────────────────────────────────────────────────────────────
  'bonus add-entry-credits-points':
    'a bonus entry is appended at the next free row and credits its type\'s points for the period it falls in',
  'bonus weekly-period-boundaries':
    'weekly bonus periods are bounded by the tracker month — a short first or last period is not padded into the adjacent month',
  'bonus already-credited-tells-pax':
    'an entry that lands counts=false because the period is already credited says so at save time, not only by looking subdued in the list (F3Go30-833s.16)',
  'bonus month-nav-independent':
    'the bonus page pages months on its own state, not the check-in day-nav view date (F3Go30-5ire)',
  'bonus edit-by-identity':
    'editing a bonus entry locates it by identity rather than a stale row index, including when the entry belongs to another month',
  'bonus live-add-and-edit-via-ui':
    'adding then editing a bonus entry through the settings-menu UI actually appends and updates a durable Bonus Tracker row, reflected back in the bonus list (F3Go30-y8j7.1)',

  // ── scorecard ─────────────────────────────────────────────────────────────────────────────
  'scorecard roster-only-when-unranked':
    'a month with no meaningful scores renders the roster board only — never a podium or ladder — decided from the data, not a calendar heuristic (F3Go30-csfe.2)',
  'scorecard podium-hidden-stays-hidden':
    'the loading-UI teardown never re-reveals a podium that the render deliberately hid, leaving a previous month\'s content on screen (F3Go30-iwms)',
  'scorecard default-month-early-in-month':
    'scorecard opens on the previous month during the first days of a new month, unless no previous month exists (F3Go30-enwp.1)',
  'scorecard tie-breaks-on-streak':
    'tied scores break on longest streak first and only then on name (F3Go30-enwp.2)',
  'scorecard back-returns-to-origin':
    'the header Back button returns to the step the PAX opened scorecard from, not a hardcoded dashboard (F3Go30-izly)',
  'scorecard renders-real-roster-shape':
    'the ladder and top-teams render correctly against a real multi-team roster payload, not a synthesised one',

  // ── tracker lifecycle: create, edit, age out ──────────────────────────────────────────────
  'tracker create-for-explicit-month':
    'a tracker can be created for an explicitly named month, with its TrackerDB row, linked form and short URL',
  'tracker auto-generate-next-month':
    'the monthly trigger generates the next month\'s tracker and notifies Site Q; the operator-driven copyAndInit path does not send that email',
  'tracker short-url-repair':
    'an existing signup short URL is reused when it already points at the expected target, repaired with a warning when it points elsewhere or cannot be resolved',
  'tracker edit-trigger-fires-on-human-edit':
    'the onEdit handler runs against a genuine Sheets-UI edit and updates the PAX row — API writes never fire it (ADR-013)',
  'tracker trigger-lifecycle-sync':
    'active tracker rows are backfilled with an edit trigger exactly once, and rows older than the previous month are cleaned up',
  'tracker form-submit-resolves-own-spreadsheet':
    'a form submission resolves to the spreadsheet its own event range belongs to, never to whichever spreadsheet is active (F3Go30-5bc5)',
  'tracker mark-minus-one-dispatch':
    'the minus-one sweep resolves its target through TrackerDB and openById, not the active spreadsheet (ADR-010)',
  'tracker scan-preserves-untouched-rows':
    'a TrackerDB scan upserts scanned rows and leaves rows it did not scan — and their lifecycle timestamps — unchanged',
  'tracker copy-template-safe-defaults':
    'a copied Template forces Email Test Mode on and starts with blank lineage/lifecycle fields, whatever the folder is called',

  // ── namespaces and environment isolation (ADR-014) ────────────────────────────────────────
  'namespace resolves-only-when-registered':
    'a namespace resolves only when NamespaceDB registers it — a string that merely looks like a spreadsheet id never resolves (ADR-014 D2)',
  'namespace teardown-removes-registration-first':
    'tearing down a provisioned environment removes its NamespaceDB row before trashing anything, so the namespace is unresolvable immediately (ADR-014 D6)',
  'contextdate precedence-and-prod-guard':
    'context date resolves as PROD guard > explicit override > Config sheet > real now; PROD always uses the real date (F3Go30-31w5.1)',
  'contextdate menu-blocks-on-prod':
    'the Set Test Context Date menu action validates the date format and refuses on PROD before prompting or calling admin (F3Go30-31w5.2)',

  // ── caching ───────────────────────────────────────────────────────────────────────────────
  'paxcache write-through-on-checkin':
    'a check-in patches the PAX\'s cached row in place rather than invalidating and re-reading the whole roster',
  'paxcache invalidation-clears-related-keys':
    'invalidating a sheet\'s PaxCache also clears the dashboard\'s full-roster cache keys for the same sheet',
  'paxcache stale-purge-bounded':
    'the stale-cache purge removes only entries past their age bound and leaves warm entries intact',

  // ── notification and email ────────────────────────────────────────────────────────────────
  'nag checkin-page-is-primary-cta':
    'the nag email leads with the check-in page as a bookmarkable CTA and demotes the tracker sheet to the older interface',
  'nag dispatch-resolves-tracker-row':
    'nag dispatch resolves its spreadsheet through TrackerDB and returns early on a missing sheet rather than throwing (F3Go30-3sqo)',
  'email body-only-caller-supported':
    'a caller supplying a plain body with no HTML body still produces a sendable message (F3Go30-ckq7)',
  'email response-settings-sent-once':
    'a form submission produces exactly one settings/goal-reuse email, not one per writer touching the row',
  'slack signup-message-carries-tracker-link':
    'the Slack signup message leads with the signup link and always carries the tracker link, mentioning the HC form only as a fallback',

  // ── logging, telemetry and PII ────────────────────────────────────────────────────────────
  'logging masks-pii':
    'names and emails are masked in logs — first and last character kept for names, local part only for emails',
  'logging stamps-version-and-target':
    'a log entry carries its own version and deploy target, so SIT and PROD stay distinguishable in one dataset; unstamped entries default rather than mislabel',
  'logging request-body-never-logged':
    'the doPost entry log carries the client build version but never postData.contents (F3Go30-833s.15)',
  'telemetry client-record-deduped':
    'an uploaded client telemetry record is logged under its own tag and not double-logged when the client retries an upload it never got an ack for (F3Go30-xyri)',
  'telemetry reconnect-poll-recorded':
    'the background reconnect poll records its outcome, including under a localStorage quota failure (F3Go30-n40u)',
  'telemetry live-upload-and-dedupe':
    'a real browser session\'s clientTelemetry flush uploads a batch that the server logs, and an identical resend of that batch is deduped rather than logged twice (F3Go30-y8j7.1)',

  // ── transport: the client/server boundary ─────────────────────────────────────────────────
  'transport retries-lost-response':
    'a request whose response is lost on the googleusercontent echo hop is retried or surfaced as a transport failure — never silently rendered as an empty result (F3Go30-313u)',
  'transport abort-on-timeout':
    'an in-flight request is aborted at its timeout and the failure is reported as transport, not as an assertion about data',
  'transport hedged-slow-attempt-wins':
    'a read whose first attempt answers after the hedge interval renders from that attempt, aborts the hedge that was started meanwhile, and shows no error (F3Go30-8naq.2)',
  'transport hedged-second-attempt-wins':
    'a read whose first attempt never answers renders from the hedge attempt started at the hedge interval, and the hung first attempt is aborted (F3Go30-8naq.2)',
  'transport hedged-deadline-surfaces-error':
    'a read for which no attempt ever answers aborts every attempt at the overall deadline and shows the transport error banner (F3Go30-8naq.2)',
  'transport cors-boundary-holds':
    'the static page\'s cross-origin POST to the live /exec succeeds from a genuinely different origin',

  // ── static page build and deploy verification ─────────────────────────────────────────────
  'staticbuild stamps-env-webapp-url':
    'the built page\'s /exec URL is derived from the requested environment\'s deployment id, and a missing id fails the build loudly',
  'staticbuild placeholder-required':
    'a source missing the webapp or version placeholder is a build error, guarding against silent drift when index.html is edited',
  'staticbuild csp-hash-matches-browser':
    'inline-script CSP hashes are computed over HTML5-preprocessed bytes, so a script containing a NUL is not permanently blocked (F3Go30-ah3v)',
  'deploy version-route-needs-no-secret':
    'cmd=version returns the stamped build identity on GET and POST with no secret, so it works on an anonymous deployment before bootstrap (gas-deploy RECOMMENDATION §3.2)',
  'deploy static-page-propagation-detectable':
    'the deployed static page\'s version stamp is readable, and an unstamped or stale page is distinguishable from a propagated one',

  // ── admin surface ─────────────────────────────────────────────────────────────────────────
  'admin secret-gated':
    'every cmd=admin action requires the admin secret, supplied in the POST body only — never in argv, the query string, or a log',
  'admin config-write-refused-on-prod':
    'setContextDate and setConfigValue refuse outright on PROD, failing loudly at write time rather than storing a value that would be ignored',
  'admin cleanup-removes-row-and-artifacts':
    'cleanupTracker removes the TrackerDB and PaxDB rows and trashes the spreadsheet and its linked form when asked to',

  // ── announcements ─────────────────────────────────────────────────────────────────────────
  'announce splash-renders-above-content':
    'a configured Announce.<day> row renders as a splash in a real browser, with the real stylesheet cascade — the defect class is source order',
};

// Deliberately NOT an AC, recorded so the omission is a decision rather than an oversight:
// "a spec that overwrites a live Config row captures the original first and restores it exactly"
// (project-testing-guide.md §4, the announcement-splash near-miss). That is fixture discipline —
// an obligation on the *suite*, not a behaviour of the system — and ADR-0011 scopes an AC to the
// latter. No product test can ever drain it, so registering it would put a permanently uncovered
// row in the denominator for the same reason AC_SELFTEST_FIXTURES is a separate map. It is
// tracked where it belongs, as the missing T19 run-identity scoping: F3Go30-emwk.13.

/**
 * Harness self-test tags — NOT acceptance criteria, and NOT part of any coverage computation.
 *
 * These name what the harness asserts about *itself* (tests/harness/outcomes.js, F3Go30-emwk.6).
 * They are listed so the harness's own obligations are written down somewhere, and kept out of
 * `AC_REGISTRY` so they cannot inflate a denominator. `listAcIds()` never returns them; nothing
 * that computes coverage may read this map.
 */
const AC_SELFTEST_FIXTURES = {
  'selftest classify-pass': 'classifyExecution() returns pass for a clean execution record',
  'selftest classify-assertion-failure':
    'classifyExecution() returns assertion_failure for a failure matching no boundary signature',
  'selftest classify-boundary-signature':
    'classifyExecution() returns boundary_fault on a curated BOUNDARY_SIGNATURES match',
  'selftest classify-boundary-probe':
    'an unhealthy once-per-run boundary probe reclassifies a live-tier failure as boundary_fault',
  'selftest retry-live-only':
    'retriesFor() throws when a non-live tier is given a non-zero retry count',
  'selftest retry-bounded':
    'retriesFor() throws when a policy exceeds MAX_RETRIES',
  'selftest summary-fields':
    'summarize()/formatSummary() emit the counts, failure rate, boundary share and retry count the H8 row claims',
};

/** Tracker-id shape for this project. `H11`: an AC id may never contain one. */
const TRACKER_ID_PATTERN = /F3Go30-[a-z0-9]+/i;

/** The registry's ids, sorted — the enumeration a report or gap-diff consumes. */
function listAcIds() {
  return Object.keys(AC_REGISTRY).sort();
}

/**
 * Mechanical H11 guard. Throws naming every offender rather than returning a boolean, so a
 * violation cannot be logged and ignored. Called by test/test_ac_registry.js.
 */
function assertNoTrackerIdsInAcIds() {
  const offenders = Object.keys(AC_REGISTRY).filter((id) => TRACKER_ID_PATTERN.test(id));
  if (offenders.length) {
    throw new Error(
      'H11 violation — AC id(s) encode a tracker id; the bead belongs in the description, ' +
        'never in the id: ' + offenders.join(', ')
    );
  }
}

/**
 * The self-test tags must never leak back into AC_REGISTRY (the 27%-denominator mistake this
 * file's header records). Throws naming the overlap.
 */
function assertSelftestFixturesAreSeparate() {
  const overlap = Object.keys(AC_SELFTEST_FIXTURES).filter((id) =>
    Object.prototype.hasOwnProperty.call(AC_REGISTRY, id)
  );
  if (overlap.length) {
    throw new Error(
      'harness self-test tag(s) present in AC_REGISTRY — they inflate the coverage denominator ' +
        'and are permanently uncovered: ' + overlap.join(', ')
    );
  }
}

module.exports = {
  AC_REGISTRY,
  AC_SELFTEST_FIXTURES,
  TRACKER_ID_PATTERN,
  listAcIds,
  assertNoTrackerIdsInAcIds,
  assertSelftestFixturesAreSeparate,
};

// Enumeration entry point for `--ac-list-cmd`: one id per line, or `--json` for a JSON array.
if (require.main === module) {
  const ids = listAcIds();
  process.stdout.write(
    process.argv.includes('--json') ? JSON.stringify(ids) + '\n' : ids.join('\n') + '\n'
  );
}
