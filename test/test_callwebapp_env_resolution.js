const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

// F3Go30-krks: --env resolution must never return a deployment ID belonging to a different
// env's script project. Root cause was gas-deploy's resolveEnvDeploymentId() listing
// `clasp deployments` against whatever .clasp.json currently points at (not the target env),
// so the standardChain(settingsId(), soleActiveDeployment()) fallback silently returned the
// WRONG env's sole deployment once settingsId() correctly threw. Fix: tools/callWebapp.js sets
// resolveFromLiveList:false, which makes resolveEnvDeploymentId skip the live-list/clasp branch
// entirely and read straight from local.settings.json's per-env deploymentIdKey.
//
// This test calls resolveEnvDeploymentId directly with a stubbed exec (per the task's
// instruction) so it stays in the network-free node tier — no real clasp/network call is made.
// The stub, if ever invoked, deliberately returns SIT's live-list shape for BOTH envs, which is
// exactly the failure mode being regression-tested against: if resolveFromLiveList:false ever
// regresses back to true (or is removed), this stub would make --env prod wrongly resolve to
// SIT's deployment, and the assertions below would catch it.

const { resolveEnvDeploymentId } = require('gas-deploy/bin/call-webapp.js');
const { config: callWebappConfig } = require('../tools/callWebapp.js');

const FAKE_SETTINGS = {
  testDeploymentId: 'AKfycbzwSIT_FAKE',
  templateDeploymentId: 'AKfycbyGPROD_FAKE',
  // scriptIdKey values must be present too — resolveEnvDeploymentId's live-list branch is only
  // even attempted when `target.scriptIdKey && settings[target.scriptIdKey]` is truthy. Without
  // these, the live-list branch is skipped regardless of resolveFromLiveList, which would make
  // this test pass for the wrong reason (never having exercised the buggy path at all).
  testScriptId: 'script-sit-fake',
  templateScriptId: 'script-prod-fake',
  // claspEnv() throws if this is absent, which would silently fall through to the (correct)
  // stored value and mask the bug entirely — must be present so the live-list branch is
  // actually reached.
  claspAuth: '/fake/clasprc.json',
};

function stubExecThatWouldMisresolve_() {
  let calls = 0;
  const exec = () => {
    calls++;
    // Always reports SIT's project as the live list, regardless of which env is being resolved
    // — the exact condition that let soleActiveDeployment() return the wrong env's ID.
    return Buffer.from(
      '- AKfycbzwSIT_FAKE @3 - TEST-WEB-APP\n'
    );
  };
  exec.callCount = () => calls;
  return exec;
}

describe('F3Go30-krks: callWebapp env resolution', function() {
  it('resolves sit and prod to different, correct deployment IDs', function() {
    const exec = stubExecThatWouldMisresolve_();

    const sitId = resolveEnvDeploymentId(callWebappConfig, 'sit', FAKE_SETTINGS, { exec });
    const prodId = resolveEnvDeploymentId(callWebappConfig, 'prod', FAKE_SETTINGS, { exec });

    assert.equal(sitId, FAKE_SETTINGS.testDeploymentId);
    assert.equal(prodId, FAKE_SETTINGS.templateDeploymentId);
    assert.notEqual(sitId, prodId);
  });

  it('never invokes the live-list exec when resolveFromLiveList is false', function() {
    assert.equal(callWebappConfig.resolveFromLiveList, false,
      'tools/callWebapp.js must set resolveFromLiveList:false — this is the fix for F3Go30-krks');

    const exec = stubExecThatWouldMisresolve_();
    resolveEnvDeploymentId(callWebappConfig, 'sit', FAKE_SETTINGS, { exec });
    resolveEnvDeploymentId(callWebappConfig, 'prod', FAKE_SETTINGS, { exec });

    assert.equal(exec.callCount(), 0,
      'resolveEnvDeploymentId should skip `clasp deployments` entirely under resolveFromLiveList:false');
  });

  it('each env matches its own settings deploymentIdKey', function() {
    for (const envKey of Object.keys(callWebappConfig.envMap)) {
      const target = callWebappConfig.envMap[envKey];
      const resolved = resolveEnvDeploymentId(callWebappConfig, envKey, FAKE_SETTINGS, {
        exec: stubExecThatWouldMisresolve_(),
      });
      assert.equal(resolved, FAKE_SETTINGS[target.deploymentIdKey]);
    }
  });
});
