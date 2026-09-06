#!/usr/bin/env node
/**
 * audit-disposition.js — Mechanical audit for ADR-0011 disposition compliance (F3Go30-emwk.11).
 *
 * Mechanizes the two ad hoc `bd`/`jq` commands documented in `~/.claude/skills/bd/SKILL.md`
 * §"Disposition on `[TST]` Issues" into one reusable, scriptable check: every `[TST]` bead in
 * scope must carry exactly one `disp:<n>` label (n in 0-4) and a `## Disposition` section in its
 * description. Prints nothing and exits 0 on a clean scope; prints each violation and exits 1
 * otherwise. Reference implementation: `../GActionSheet/scripts/audit_disposition.py`, ported to
 * Node to match this project's tooling (`tools/*.js`, CommonJS, no external deps).
 *
 * Scope, not the whole tracker, is what merge-gate's Step 2.5 ("For every [TST] bead in
 * scope...") actually needs audited. Two ways to select it:
 *
 *   --ids ID,ID,...   Explicit bead ids — this is the merge-gate wiring: the reviewer (or a
 *                     hook) passes the [TST] beads closed/touched by the diff under review, and
 *                     only those are checked.
 *   --since DATE      Whole-tracker forward-binding audit (default: this project's ADR-0011
 *                     effective date, DISPOSITION_EFFECTIVE_DATE below) — `created_at >= DATE`.
 *                     This is the periodic health check; it deliberately does not flag
 *                     pre-adoption [TST] beads, per docs/atdd/project-testing-guide.md §9's
 *                     "dispositions bind forward from 2026-09-06; closed [TST] items are not
 *                     re-litigated" rule.
 *
 * --ids and --since are mutually exclusive; --ids wins if both are given. With neither, --since
 * defaults to DISPOSITION_EFFECTIVE_DATE.
 *
 * Usage:
 *   node tools/audit-disposition.js                          # whole-tracker, forward-binding
 *   node tools/audit-disposition.js --since 2026-09-06
 *   node tools/audit-disposition.js --ids F3Go30-emwk.12,F3Go30-emwk.13
 */

'use strict';

const { execFileSync } = require('child_process');

const DISPOSITION_EFFECTIVE_DATE = '2026-09-06';
const DISP_LABELS = ['disp:0', 'disp:1', 'disp:2', 'disp:3', 'disp:4'];
const TST_TITLE_PREFIX = '[TST]';

function isTst(issue) {
  return String((issue && issue.title) || '').startsWith(TST_TITLE_PREFIX);
}

function dispLabels(issue) {
  return ((issue && issue.labels) || []).filter((l) => l.startsWith('disp:'));
}

/** [TST] issues created on or after sinceDate (ISO date, compared as string prefix). */
function filterSince(issues, sinceDate) {
  return issues.filter((i) => isTst(i) && String(i.created_at || '') >= sinceDate);
}

/** [TST] issues whose id is in the given set. */
function filterIds(issues, ids) {
  const idSet = new Set(ids);
  return issues.filter((i) => isTst(i) && idSet.has(i.id));
}

/** [TST] issues in scope carrying no disp:<n> label at all. */
function findMissingDisposition(scopedTstIssues) {
  return scopedTstIssues.filter((i) => dispLabels(i).length === 0);
}

/**
 * [TST] issues in scope carrying more than one disp:<n> label, or missing the '## Disposition'
 * description section (checked only for issues that have at least one disp label — a fully
 * missing disposition is findMissingDisposition's finding, not this one's, to avoid double-
 * reporting the same bead twice).
 */
function findMalformedDisposition(scopedTstIssues) {
  const out = [];
  for (const i of scopedTstIssues) {
    const labels = dispLabels(i);
    if (labels.length === 0) continue;
    const noSection = !String(i.description || '').includes('## Disposition');
    if (labels.length > 1 || noSection) out.push(i);
  }
  return out;
}

/** Every issue bd knows about, [TST]-titled or not — callers filter. */
function loadAllIssues() {
  const out = execFileSync('bd', ['list', '--status', 'all', '--limit', '1000', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/**
 * Run both checks over an already-scoped [TST] issue list. Returns {missing, malformed} — both
 * empty on a clean scope.
 */
function audit(scopedTstIssues) {
  return {
    missing: findMissingDisposition(scopedTstIssues),
    malformed: findMalformedDisposition(scopedTstIssues),
  };
}

function printViolations({ missing, malformed }) {
  for (const i of missing) {
    console.log(`MISSING\t${i.id}\t${i.title}`);
  }
  for (const i of malformed) {
    const labels = dispLabels(i);
    const reason = labels.length > 1 ? 'multiple disp labels' : 'no ## Disposition section';
    console.log(`MALFORMED (${reason})\t${i.id}\t${i.title}`);
  }
}

function parseArgs(argv) {
  const out = { ids: null, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--ids') out.ids = argv[++i];
    else if (a === '--since') out.since = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const allIssues = loadAllIssues();

  let scoped;
  if (args.ids) {
    const ids = args.ids.split(',').map((s) => s.trim()).filter(Boolean);
    scoped = filterIds(allIssues, ids);
    // Any explicitly requested id that bd doesn't know, or that isn't a [TST] issue, is a caller
    // error worth surfacing rather than silently dropping.
    const foundIds = new Set(scoped.map((i) => i.id));
    const unresolved = ids.filter((x) => !foundIds.has(x));
    if (unresolved.length) {
      console.error(`WARNING: not found or not [TST]-titled: ${unresolved.join(', ')}`);
    }
  } else {
    const since = args.since || DISPOSITION_EFFECTIVE_DATE;
    scoped = filterSince(allIssues, since);
  }

  const result = audit(scoped);
  printViolations(result);
  return result.missing.length || result.malformed.length ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DISPOSITION_EFFECTIVE_DATE,
  DISP_LABELS,
  TST_TITLE_PREFIX,
  isTst,
  dispLabels,
  filterSince,
  filterIds,
  findMissingDisposition,
  findMalformedDisposition,
  audit,
};
