/**
 * journeyCharter.js — the authoritative journey charter (F3Go30-emwk.9; realizes T1, T15, T17,
 * T21, T22 and ADR-0011 §Decision 5; single-source per I6).
 *
 * WHAT THIS IS. One entry per journey — a built Playwright spec that drives a user-visible path
 * end to end. It is the table a `[TST]` author reads before creating a new journey, and what
 * `test-functional` Step 1 selects a disposition against. A `disp:4` (new journey) is justified
 * against a `whySeparate` line here or it is not justified at all.
 *
 * WHY IT IS A MODULE AND NOT PROSE. Until this file existed the charter lived only in
 * `docs/atdd/project-testing-guide.md` §6, with its AC-ids column reading `‹pending›` and its
 * entry-point column written as prose that named no registry key. That made the charter
 * unjoinable: nothing could check that a journey's stated entry point exists, that its stated AC
 * exists, or that the entry points nobody claims are exactly the ones `ENTRY_POINT_DEFERRED`
 * declares deferred. All three are now mechanical (`assertCharterWellFormed()`), and §6 is a
 * **view** of this file guarded by `test/test_journey_charter_view.js` — the same shape §7 already
 * has over `entryPointRegistry.js`.
 *
 * THE JOIN THIS CLOSES. `entryPointRegistry.js`'s covered set was authored: an entry point was
 * "covered" because it was absent from `ENTRY_POINT_DEFERRED`, with nothing asserting a journey
 * actually drives it. `assertDeferralIsComputed()` below now requires
 *
 *     union(every journey's entryPoints)  ===  ENTRY_POINT_REGISTRY \ ENTRY_POINT_DEFERRED
 *
 * exactly. Claiming coverage without a journey, or retiring a journey without deferring what it
 * drove, now fails in the network-free tier instead of drifting silently.
 *
 * WHAT AN AC ID HERE MEANS. That this journey is the *responsible* call-site for that obligation —
 * not that a per-test tag proves it. Per-test AC tagging and the gap-diff that consumes it are
 * F3Go30-emwk.12 (deferred, no stage). Most of the 75 registry ACs are held by the network-free
 * `test/test_*.js` files, which are NOT journeys (T12, one behaviour per file) and are deliberately
 * absent from this charter. Do not read charter membership as suite coverage.
 *
 * MERGE CANDIDATES ARE RECORDED, NEVER ACTED ON HERE. A journey whose AC set is a subset of
 * another's has no defensible reason to exist separately, and `assertNoUnrecordedMergeCandidates()`
 * fails on one. The remedy is an entry in `MERGE_CANDIDATES` carrying a bead — consolidation runs
 * later under its own disposition and the H5 resolution order, never as a side effect of filling
 * this table in.
 *
 * ENUMERATION. `node test/contract/journeyCharter.js` prints one journey key per line; `--acs`
 * prints `journey<TAB>ac-id` pairs; `--json` prints the whole charter.
 */

'use strict';

const {
  ENTRY_POINT_REGISTRY,
  ENTRY_POINT_DEFERRED,
} = require('./entryPointRegistry');
const { AC_REGISTRY } = require('./acRegistry');

/** Tier grades. Two grades of live are recorded and deliberately not split into tiers yet. */
const TIER_LIVE_WEBAPP = 'live (webapp)';
const TIER_LIVE_BROWSER_SESSION = 'live (authenticated Google browser session)';
const TIER_NETWORK_FREE = 'network-free';
const TIER_EXCLUDED = 'excluded';

/**
 * The journeys.
 *
 * `entryPoints` — keys of `ENTRY_POINT_REGISTRY`, the state-modifying call-sites this journey
 *   drives. Read-only routes it also touches (`checkin.dashboard`, `checkin.monthGrid`,
 *   `admin.getConfigValue`, …) are NOT listed: they are in `ENTRY_POINT_READ_ONLY_EXEMPT` and are
 *   not T17 entry points.
 * `acIds` — keys of `AC_REGISTRY` this journey is the responsible call-site for.
 * `invariants` — the system-wide invariant its checkpoints assert (T18), or `null` for "asserts
 *   none", which is the honest answer for all but one journey: this project has no checkpoint
 *   engine to assert one at (harness-design.md §1).
 */
const JOURNEY_CHARTER = {
  'static-signup': {
    theme:
      'Registration + goal capture through the static front end, cross-origin',
    entryPoints: ['signup.identify', 'signup.save', 'signup.feedback'],
    acIds: [
      'signup identify-requires-name-and-email',
      'signup save-persists-goals',
      'signup info-step-validates',
      'signup done-url-bookmarkable',
      'signup next-month-checkin-link',
      'signup feedback-writes-and-rejects-unmatched',
    ],
    invariants: null,
    whySeparate:
      'The only signup E2E coverage since DR-04 removed `SignupApp.html`; check-in journeys never create a PAX',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'static-checkin': {
    theme:
      'Cross-origin check-in from a genuinely different origin against the live `/exec`',
    entryPoints: [
      'route.doPost', 'checkin.identify', 'checkin.checkin',
      'checkin.bonusAdd', 'checkin.bonusEdit', 'checkin.siteFeedback',
    ],
    acIds: [
      'transport cors-boundary-holds',
      'checkin identify-returns-month-state',
      'checkin submit-writes-day',
      'checkin write-through-overlay',
      'dashboard renders-from-cache-then-revalidates',
      'bonus live-add-and-edit-via-ui',
      'checkin sitefeedback-live-send',
    ],
    invariants: null,
    whySeparate:
      'Proves the CORS boundary itself — a header/CORS regression surfaces here and nowhere else. The only journey that drives `route.doPost` as its subject rather than as transport',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'checkin-advanced-grid': {
    theme: 'Whole-month check-in grid: calendar + unified selection panel',
    entryPoints: ['checkin.checkin', 'checkin.clientTelemetry'],
    acIds: [
      'checkin advanced-grid-selection',
      'checkin month-grid-request',
      'checkin submit-writes-day',
      'telemetry live-upload-and-dedupe',
    ],
    invariants: null,
    whySeparate:
      'Multi-day selection state is a client-state failure domain the single-day journey cannot reach; it also holds the direct-API write contract (invalid day, out-of-range date, the -1 past-only rule)',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'checkin-concurrency-live-check': {
    theme:
      'Cross-day rapid-tap burst; global concurrency cap and the `dataset.saving` flag surviving a re-render',
    entryPoints: ['checkin.checkin'],
    acIds: ['checkin concurrency-cap-holds', 'checkin saving-label-recovers'],
    invariants: null,
    whySeparate:
      'Concurrency is only observable under real interleaved in-flight POSTs; instruments the network without mocking it',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'pax-history-reload-live-check': {
    theme:
      '`PaxCache` history-window rebuild after `invalidateAllCache`; the 30 s script lock against a full roster',
    entryPoints: ['admin.invalidateAllCache', 'checkin.identify'],
    acIds: [
      'dashboard pax-history-window-rebuild',
      'dashboard streak-from-server-history',
      'paxcache invalidation-clears-related-keys',
    ],
    invariants:
      'the only journey that asserts one: after a full invalidation, every rebuilt PAX history window is bounded to its declared length and no reported streak exceeds that window (spec AC1/AC2/AC5/AC6, asserted over the whole roster, not one fixture)',
    whySeparate:
      'Needs a real `SpreadsheetApp` read and a real lock — unreachable from the node suite by construction',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'scorecard-live-check': {
    theme:
      'Scorecard render (HIM Ladder + Top Teams) from a real multi-team roster payload',
    entryPoints: [],
    acIds: [
      'scorecard renders-real-roster-shape',
      'scorecard back-returns-to-origin',
    ],
    invariants: null,
    whySeparate:
      'Renders from cached dashboard state, so its failure domain is presentation against *real* roster shape, not an endpoint — it is the one journey that drives no state-modifying entry point at all',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'announcement-splash-live-check': {
    theme: 'Announcement splash: real CSS cascade in a real browser',
    entryPoints: ['admin.setConfigValue'],
    acIds: ['announce splash-renders-above-content'],
    invariants: null,
    whySeparate:
      'The defect class is stylesheet source order — invisible to a synthetic DOM stand-in. Mutates a live Config row and restores it (§4)',
    tier: TIER_LIVE_WEBAPP,
    status: 'built',
  },

  'tracker-edit-trigger-live-check': {
    theme: '`onEdit` handler against a genuine human Sheets-UI edit',
    entryPoints: ['handleTrackerEdit_'],
    acIds: ['tracker edit-trigger-fires-on-human-edit'],
    invariants: null,
    whySeparate:
      '`onEdit` never fires for API writes (ADR-013), so no other path can prove it',
    tier: TIER_LIVE_BROWSER_SESSION,
    status: 'built',
  },

  'copy-and-init': {
    theme:
      '`copyAndInit()` driven through the Apps Script editor: new month tracker, short URL, notification',
    entryPoints: ['copyAndInit'],
    acIds: ['tracker create-for-explicit-month'],
    invariants: null,
    whySeparate:
      'Tracker creation is a destructive/lifecycle domain (`T22` risk order) and is driven from the GAS editor UI — the only journey that runs a menu entry point',
    tier: TIER_LIVE_BROWSER_SESSION,
    status: 'built',
  },

  'transport-resilience': {
    theme:
      'Transport failure handling with real `fetch`, real `AbortController`, real timers; failures injected by routing',
    entryPoints: [],
    acIds: ['transport retries-lost-response', 'transport abort-on-timeout'],
    invariants: null,
    whySeparate:
      'The **only** network-free spec. Deliberately cannot fail because SIT is having a bad minute — that is the failure mode it defends against',
    tier: TIER_NETWORK_FREE,
    status: 'built',
  },

  'demo-screenshots': {
    theme: 'Demo screenshot capture for `docs/Go30-Demo-Script.md`',
    entryPoints: [],
    acIds: [],
    invariants: null,
    whySeparate:
      '**Not a tier member — a purpose exclusion.** It produces screenshots headed and asserts nothing a regression run needs (plan E3, following GActionSheet\'s `doc_export_wip` precedent). Stays runnable via `pnpm run demo:screenshots`',
    tier: TIER_EXCLUDED,
    status: 'built',
  },
};

/**
 * Journeys whose AC set is a subset of another journey's, recorded rather than merged.
 *
 * Shape: `'<journey>': '<reason> — <bead id>'`. Empty today: the subset check was run at
 * F3Go30-emwk.9 against all 10 tiered journeys and found no subset pair. An entry here is a
 * declaration that a merge candidate is KNOWN and TRACKED, never a licence to leave it unrecorded;
 * consolidation itself runs later under its own disposition and the H5 resolution order.
 */
const MERGE_CANDIDATES = {};

/** The tier grades a journey may declare. */
const TIER_ORDER = [
  TIER_LIVE_WEBAPP,
  TIER_LIVE_BROWSER_SESSION,
  TIER_NETWORK_FREE,
  TIER_EXCLUDED,
];

/** Journeys that are tier members — i.e. everything but a purpose exclusion. */
function tieredJourneys() {
  return Object.keys(JOURNEY_CHARTER)
    .filter((key) => JOURNEY_CHARTER[key].tier !== TIER_EXCLUDED)
    .sort();
}

/** Every entry-point key any journey claims to drive. */
function claimedEntryPoints() {
  const claimed = new Set();
  for (const journey of Object.values(JOURNEY_CHARTER)) {
    for (const key of journey.entryPoints) claimed.add(key);
  }
  return [...claimed].sort();
}

/** The registry's covered set — registered and not deferred. */
function coveredEntryPoints() {
  return Object.keys(ENTRY_POINT_REGISTRY)
    .filter((key) => !Object.prototype.hasOwnProperty.call(ENTRY_POINT_DEFERRED, key))
    .sort();
}

/** Counts the guide §6 view states. */
function charterCounts() {
  const acs = new Set();
  for (const journey of Object.values(JOURNEY_CHARTER)) {
    for (const id of journey.acIds) acs.add(id);
  }
  return {
    journeys: Object.keys(JOURNEY_CHARTER).length,
    tiered: tieredJourneys().length,
    acIds: acs.size,
    entryPoints: claimedEntryPoints().length,
    invariants: Object.values(JOURNEY_CHARTER).filter((j) => j.invariants).length,
  };
}

/**
 * Structural self-checks. Throw naming every offender rather than returning a verdict, so a
 * violation cannot be logged and ignored. Called by test/test_journey_charter_view.js.
 */
function assertCharterWellFormed() {
  const problems = [];

  for (const [key, journey] of Object.entries(JOURNEY_CHARTER)) {
    if (!TIER_ORDER.includes(journey.tier)) {
      problems.push(`${key}: tier "${journey.tier}" is not one of the declared grades`);
    }
    if (!journey.whySeparate || journey.whySeparate.trim().length < 30) {
      problems.push(
        `${key}: no defensible "why separate" line — a journey without one is a merge candidate ` +
          'and must be recorded in MERGE_CANDIDATES with a bead, not left blank'
      );
    }
    if (!journey.theme || journey.theme.trim().length < 10) {
      problems.push(`${key}: no theme / failure domain stated`);
    }
    if (!Array.isArray(journey.entryPoints)) problems.push(`${key}: entryPoints is not an array`);
    if (!Array.isArray(journey.acIds)) problems.push(`${key}: acIds is not an array`);
    if (!('invariants' in journey)) {
      problems.push(
        `${key}: does not state its invariants — use null to say "asserts none" explicitly ` +
          '(the AC requires the statement, not the value)'
      );
    }

    for (const epKey of journey.entryPoints || []) {
      if (!Object.prototype.hasOwnProperty.call(ENTRY_POINT_REGISTRY, epKey)) {
        problems.push(`${key}: entry point "${epKey}" is not in ENTRY_POINT_REGISTRY`);
      }
      if (Object.prototype.hasOwnProperty.call(ENTRY_POINT_DEFERRED, epKey)) {
        problems.push(
          `${key}: entry point "${epKey}" is claimed by a journey AND declared deferred — ` +
            'remove the deferral or the claim'
        );
      }
    }
    for (const acId of journey.acIds || []) {
      if (!Object.prototype.hasOwnProperty.call(AC_REGISTRY, acId)) {
        problems.push(`${key}: AC id "${acId}" is not in AC_REGISTRY`);
      }
    }

    const seenEp = new Set();
    for (const epKey of journey.entryPoints || []) {
      if (seenEp.has(epKey)) problems.push(`${key}: entry point "${epKey}" listed twice`);
      seenEp.add(epKey);
    }
    const seenAc = new Set();
    for (const acId of journey.acIds || []) {
      if (seenAc.has(acId)) problems.push(`${key}: AC id "${acId}" listed twice`);
      seenAc.add(acId);
    }
  }

  for (const [key, reason] of Object.entries(MERGE_CANDIDATES)) {
    if (!JOURNEY_CHARTER[key]) problems.push(`${key}: recorded as a merge candidate but is not a journey`);
    if (!/F3Go30-[a-z0-9]+(\.\d+)?/.test(reason)) {
      problems.push(`${key}: merge candidate carries no tracking bead id`);
    }
  }

  if (problems.length) {
    throw new Error('journey charter is malformed:\n  - ' + problems.join('\n  - '));
  }
}

/**
 * The join that turns ENTRY_POINT_DEFERRED from an authored list into a computed one: an entry
 * point is covered exactly when some journey claims to drive it.
 */
function assertDeferralIsComputed() {
  const claimed = new Set(claimedEntryPoints());
  const covered = new Set(coveredEntryPoints());

  const coveredButUnclaimed = [...covered].filter((k) => !claimed.has(k));
  const claimedButDeferred = [...claimed].filter((k) => !covered.has(k));

  const problems = [];
  if (coveredButUnclaimed.length) {
    problems.push(
      'registered, not deferred, and no journey drives it — either add it to a journey\'s ' +
        'entryPoints or defer it with a reason and a bead: ' + coveredButUnclaimed.join(', ')
    );
  }
  if (claimedButDeferred.length) {
    problems.push(
      'claimed by a journey but absent from the covered set: ' + claimedButDeferred.join(', ')
    );
  }
  if (problems.length) {
    throw new Error(
      'the charter and the entry-point registry disagree about what is covered:\n  - ' +
        problems.join('\n  - ')
    );
  }
}

/**
 * A journey whose AC set is a subset of another's has no defensible reason to exist separately.
 * Fails naming the pair; the remedy is a MERGE_CANDIDATES entry with a bead, NOT a merge here.
 * Journeys with no ACs at all (the purpose exclusion, and any journey whose obligations are not
 * yet enumerated) are skipped — an empty set is a subset of everything and would report noise.
 */
function assertNoUnrecordedMergeCandidates() {
  const keys = tieredJourneys().filter((k) => JOURNEY_CHARTER[k].acIds.length > 0);
  const found = [];

  for (const a of keys) {
    if (Object.prototype.hasOwnProperty.call(MERGE_CANDIDATES, a)) continue;
    const setA = new Set(JOURNEY_CHARTER[a].acIds);
    for (const b of keys) {
      if (a === b) continue;
      const setB = new Set(JOURNEY_CHARTER[b].acIds);
      if (setA.size > setB.size) continue;
      if ([...setA].every((id) => setB.has(id))) {
        found.push(`${a} ⊆ ${b}`);
        break;
      }
    }
  }

  if (found.length) {
    throw new Error(
      'journey AC set(s) are a subset of another journey\'s — a merge candidate must be RECORDED ' +
        '(an entry in MERGE_CANDIDATES with a bead id), never merged here; consolidation runs ' +
        'later under its own disposition and the H5 resolution order: ' + found.join(', ')
    );
  }
}

module.exports = {
  JOURNEY_CHARTER,
  MERGE_CANDIDATES,
  TIER_LIVE_WEBAPP,
  TIER_LIVE_BROWSER_SESSION,
  TIER_NETWORK_FREE,
  TIER_EXCLUDED,
  TIER_ORDER,
  tieredJourneys,
  claimedEntryPoints,
  coveredEntryPoints,
  charterCounts,
  assertCharterWellFormed,
  assertDeferralIsComputed,
  assertNoUnrecordedMergeCandidates,
};

if (require.main === module) {
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(JOURNEY_CHARTER, null, 2) + '\n');
  } else if (process.argv.includes('--acs')) {
    for (const key of Object.keys(JOURNEY_CHARTER).sort()) {
      for (const id of JOURNEY_CHARTER[key].acIds) process.stdout.write(`${key}\t${id}\n`);
    }
  } else if (process.argv.includes('--counts')) {
    const c = charterCounts();
    process.stdout.write(
      `journeys\t${c.journeys}\ntiered\t${c.tiered}\nac-ids\t${c.acIds}\n` +
        `entry-points\t${c.entryPoints}\ninvariants\t${c.invariants}\n`
    );
  } else {
    process.stdout.write(Object.keys(JOURNEY_CHARTER).sort().join('\n') + '\n');
  }
}
