const assert = require('node:assert/strict');
const test = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-61ln.1 (ADR-024): new trackers carry no HC Form.
installGasEnv_({ logger: true });

const { buildTrackerOnboardingEmailOptions_ } = require('../script/CreateNewTracker.js');
const { buildOnboardingEmailTemplate_ } = require('../script/onboardingEmail.js');

// retireCopiedHcForm_ moved to hcFormRetirement.js — tested in test_hc_form_retirement.js.

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
