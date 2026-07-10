'use strict';

const assert = require('assert');

// Pure functions exported for testing. main() is not called on require
// because the module checks require.main === module before calling main().
const { parseArgs_, buildPayload_ } = require('../tools/callWebapp.js');

// --- parseArgs_ ---

function testParseArgsDefaults() {
  const r = parseArgs_(['node', 'callWebapp.js', 'getSmokeStatus']);
  assert.equal(r.action, 'getSmokeStatus');
  assert.equal(r.cmd, 'admin');
  assert.equal(r.env, 'sit');
  assert.deepEqual(r.extraBody, {});
}

function testParseArgsAllFlags() {
  const r = parseArgs_([
    'node', 'callWebapp.js', 'identify',
    '--cmd', 'signup',
    '--env', 'prod',
    '--body', '{"f3Name":"Splinter"}',
  ]);
  assert.equal(r.action, 'identify');
  assert.equal(r.cmd, 'signup');
  assert.equal(r.env, 'prod');
  assert.deepEqual(r.extraBody, { f3Name: 'Splinter' });
}

function testParseArgsBodyMerged() {
  const r = parseArgs_([
    'node', 'callWebapp.js', 'setScriptProperties',
    '--body', '{"properties":{"SMOKE_MODE":"true"}}',
  ]);
  assert.deepEqual(r.extraBody, { properties: { SMOKE_MODE: 'true' } });
}

function testParseArgsNsShorthand() {
  const r = parseArgs_([
    'node', 'callWebapp.js', 'identify',
    '--cmd', 'checkin',
    '--ns', 'smoke-2026-07-09',
    '--body', '{"f3Name":"Splinter","email":"x@y.com"}',
  ]);
  assert.deepEqual(r.extraBody, { ns: 'smoke-2026-07-09', f3Name: 'Splinter', email: 'x@y.com' });
}

function testParseArgsNsShorthandBodyWins() {
  const r = parseArgs_([
    'node', 'callWebapp.js', 'identify',
    '--ns', 'smoke-2026-07-09',
    '--body', '{"ns":"explicit-ns"}',
  ]);
  assert.equal(r.extraBody.ns, 'explicit-ns', '--body ns overrides --ns shorthand');
}

// --- buildPayload_ ---

function testBuildPayloadAdminInjectsSecret() {
  const p = buildPayload_('getSmokeStatus', 'admin', {}, 'secret99');
  assert.deepEqual(p, { action: 'getSmokeStatus', adminSecret: 'secret99' });
}

function testBuildPayloadAdminMergesExtraBody() {
  const p = buildPayload_('cleanupTracker', 'admin', { sheetId: 'abc', trashSpreadsheet: true }, 's3cr3t');
  assert.deepEqual(p, { action: 'cleanupTracker', adminSecret: 's3cr3t', sheetId: 'abc', trashSpreadsheet: true });
}

function testBuildPayloadNonAdminNoSecret() {
  const p = buildPayload_('identify', 'signup', { f3Name: 'Splinter', email: 'x@y.com' }, 'ignored');
  assert.deepEqual(p, { action: 'identify', f3Name: 'Splinter', email: 'x@y.com' });
  assert.ok(!('adminSecret' in p));
}

function testBuildPayloadNonAdminEmptyBody() {
  const p = buildPayload_('feedback', 'signup', {}, null);
  assert.deepEqual(p, { action: 'feedback' });
}

function run() {
  testParseArgsDefaults();
  testParseArgsAllFlags();
  testParseArgsBodyMerged();
  testParseArgsNsShorthand();
  testParseArgsNsShorthandBodyWins();
  testBuildPayloadAdminInjectsSecret();
  testBuildPayloadAdminMergesExtraBody();
  testBuildPayloadNonAdminNoSecret();
  testBuildPayloadNonAdminEmptyBody();
  console.log('test_callwebapp: all tests passed');
}

run();
