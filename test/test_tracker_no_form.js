const assert = require('node:assert/strict');
const test = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-61ln.1 (ADR-024): new trackers carry no HC Form.
const env = installGasEnv_({ logger: true });
const formCalls = [];
const trashed = [];
globalThis.FormApp = {
  openByUrl: (url) => {
    if (url === 'broken') throw new Error('no access');
    return { getId: () => 'form-' + url, removeDestination: () => formCalls.push('unlink:' + url) };
  },
};
globalThis.DriveApp = { getFileById: (id) => ({ setTrashed: (v) => trashed.push(id + ':' + v) }) };

const { retireCopiedHcForm_, buildTrackerOnboardingEmailOptions_ } = require('../script/CreateNewTracker.js');
const { buildOnboardingEmailTemplate_ } = require('../script/onboardingEmail.js');

test('retireCopiedHcForm_: a copy with no linked Form is left alone', () => {
  assert.deepEqual(retireCopiedHcForm_({ getFormUrl: () => null }), { retired: false });
});

test('retireCopiedHcForm_: the Form that came with the copy is unlinked and trashed', () => {
  formCalls.length = 0; trashed.length = 0;
  assert.deepEqual(retireCopiedHcForm_({ getFormUrl: () => 'u1' }), { retired: true, formId: 'form-u1' });
  assert.deepEqual(formCalls, ['unlink:u1']);
  assert.deepEqual(trashed, ['form-u1:true']);
});

test('retireCopiedHcForm_: a failure is reported and logged, never thrown (tracker creation must not fail on it)', () => {
  const result = retireCopiedHcForm_({ getFormUrl: () => 'broken' });
  assert.equal(result.retired, false);
  assert.equal(result.error, 'no access');
  assert.ok(env.logger._logs.some((e) => /retireCopiedHcForm_/.test(e[0])), 'logged');
});

test('AC3 buildTrackerOnboardingEmailOptions_: shared by both creation paths; no Form URL, step or checklist item', () => {
  const opts = buildTrackerOnboardingEmailOptions_({
    trackerName: '2026-11-T Go30', siteName: 'Site', trackerUrl: 'https://t', ownerAccount: 'Q',
    expiredTrackerName: null, slackReadyMessage: 'msg', contactEmail: 'q@x', appVersion: '9',
  });
  assert.equal(opts.formUrl, undefined);
  assert.equal(opts.trackerUrl, 'https://t');
  assert.equal(opts.slackReadyMessage, 'msg');
  assert.ok(opts.postCopyChecklist.length > 0);
  opts.initSteps.concat(opts.postCopyChecklist).forEach((line) => assert.ok(!/\bform\b/i.test(line), line));
  const email = buildOnboardingEmailTemplate_(opts);
  assert.ok(!/HC Form/i.test(email.body));
});
