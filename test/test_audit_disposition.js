'use strict';

const assert = require('node:assert/strict');

// Covers tools/audit-disposition.js's pure logic (F3Go30-emwk.11 — ADR-0011 disposition
// enforcement): scope selection (--ids / --since) and the two compliance checks (missing
// disposition, malformed disposition). No live `bd` subprocess — every function under test takes
// an already-loaded issue list (list of plain objects, the shape `bd list --json` returns), so
// this file is network-free by construction and runs in the fast tier alongside the rest of
// test/.
//
// Backstop rule (a new assertion must be proven to fail): each check below has a paired "does
// not flag a clean issue" case alongside its "flags a violating issue" case, so a check that
// always returns empty (silently passing everything) would fail the positive case rather than
// passing vacuously.

const {
  filterSince,
  filterIds,
  findMissingDisposition,
  findMalformedDisposition,
  audit,
} = require('../tools/audit-disposition.js');

function issue(id, opts = {}) {
  return {
    id,
    title: opts.title || '[TST] example',
    labels: opts.labels || [],
    description: opts.description || '',
    created_at: opts.created_at || '2026-09-06T00:00:00Z',
  };
}

// --- filterSince / filterIds --------------------------------------------------------------

{
  const issues = [
    issue('old', { created_at: '2026-06-01T00:00:00Z' }),
    issue('new', { created_at: '2026-09-06T00:00:00Z' }),
  ];
  const scoped = filterSince(issues, '2026-09-06');
  assert.deepEqual(scoped.map((i) => i.id), ['new'], 'filterSince excludes pre-cutoff [TST] issues');
}

{
  const issues = [issue('imp', { title: '[IMP] example', created_at: '2026-09-06T00:00:00Z' })];
  assert.deepEqual(filterSince(issues, '2026-09-06'), [], 'filterSince excludes non-[TST] issues even if recent');
}

{
  const issues = [issue('a'), issue('b'), issue('c', { title: '[IMP] not a TST issue' })];
  const scoped = filterIds(issues, ['a', 'c', 'nonexistent']);
  assert.deepEqual(scoped.map((i) => i.id), ['a'], 'filterIds selects only named [TST] issues');
}

// --- findMissingDisposition --------------------------------------------------------------

{
  const scoped = [issue('x', { labels: ['test-framework'] })];
  assert.deepEqual(
    findMissingDisposition(scoped).map((i) => i.id),
    ['x'],
    'flags a [TST] issue with no disp:<n> label'
  );
}

{
  const scoped = [issue('x', { labels: ['disp:2'], description: '## Disposition\nTarget: ...\nBasis: ...' })];
  assert.deepEqual(findMissingDisposition(scoped), [], 'does not flag an issue with a disp label');
}

// --- findMalformedDisposition --------------------------------------------------------------

{
  const scoped = [
    issue('x', { labels: ['disp:1', 'disp:2'], description: '## Disposition\nTarget: ...\nBasis: ...' }),
  ];
  assert.deepEqual(
    findMalformedDisposition(scoped).map((i) => i.id),
    ['x'],
    'flags multiple disp labels'
  );
}

{
  const scoped = [issue('x', { labels: ['disp:2'], description: 'no section here' })];
  assert.deepEqual(
    findMalformedDisposition(scoped).map((i) => i.id),
    ['x'],
    'flags a missing ## Disposition section'
  );
}

{
  const scoped = [issue('x', { labels: ['disp:2'], description: '## Disposition\nTarget: ...\nBasis: ...' })];
  assert.deepEqual(findMalformedDisposition(scoped), [], 'does not flag a single well-formed disposition');
}

{
  // No disp label at all is findMissingDisposition's finding, not this one's — reported once,
  // not twice, for the same bead.
  const scoped = [issue('x', { labels: [], description: '' })];
  assert.deepEqual(
    findMalformedDisposition(scoped),
    [],
    'does not double-report a fully missing disposition'
  );
}

// --- audit (both checks together) --------------------------------------------------------

{
  const scoped = [
    issue('a', { labels: ['disp:0'], description: '## Disposition\nTarget: ...\nBasis: ...' }),
    issue('b', { labels: ['disp:4'], description: '## Disposition\nTarget: ...\nBasis: ...\nReason: ...' }),
  ];
  const { missing, malformed } = audit(scoped);
  assert.deepEqual(missing, [], 'audit returns empty missing on a clean scope');
  assert.deepEqual(malformed, [], 'audit returns empty malformed on a clean scope');
}

{
  const scoped = [
    issue('no-label', { labels: [] }),
    issue('two-labels', { labels: ['disp:1', 'disp:3'], description: '## Disposition\nTarget: ...\nBasis: ...' }),
  ];
  const { missing, malformed } = audit(scoped);
  assert.deepEqual(missing.map((i) => i.id), ['no-label'], 'audit reports the missing violation');
  assert.deepEqual(malformed.map((i) => i.id), ['two-labels'], 'audit reports the malformed violation in the same pass');
}
