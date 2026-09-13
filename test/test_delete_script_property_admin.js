const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-bm2m: the deleteScriptProperty admin action is the only way to remove a stuck script
// property through the web app (setScriptProperties can only SET) — discovered during F3Go30-5xmk
// when a stray F3GO30_5XMK_PROBE key on SIT and a stuck F3GO30_TEST_RUN_ID on PROD both needed
// hand-editing in the Apps Script editor to clear. Single key only, never a wildcard/batch —
// the store also holds the entire PaxCache, so a blanket delete is a footgun. Deliberately NOT
// guarded against PROD (contrast setContextDate/setConfigValue): clearing a stuck key on PROD is
// the entire reason this exists. Protected keys (ADMIN_SHARED_SECRET, AXIOM_TOKEN, AXIOM_DATASET,
// GAS_LOGGER_PARENT_FOLDER_ID) refuse outright, since losing any of them breaks the deployment.
//
// GAS globals come from test/helpers/gasEnv.js (F3Go30-taag/F3Go30-emwk.14 convention) rather than
// a hand-rolled double, per this bead's implementation-gate coverage inventory.

global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function(text) {
    return {
      _text: text,
      setMimeType: function() { return this; }
    };
  }
};

var handles = installGasEnv_({
  properties: { ADMIN_SHARED_SECRET: 'test-secret', F3GO30_KEEP_ME: 'value' },
  logger: true,
});

const { handleAdminPost_ } = require('../script/WebApp.js');

function callAdmin_(action, extra) {
  var payload = Object.assign({ action: action, adminSecret: 'test-secret' }, extra || {});
  var response = handleAdminPost_({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response._text);
}

function withDeployTarget_(target, fn) {
  var prev = global.APP_DEPLOY_TARGET;
  global.APP_DEPLOY_TARGET = target;
  try {
    fn();
  } finally {
    global.APP_DEPLOY_TARGET = prev;
  }
}

describe('deleteScriptProperty admin action', function() {
  it('deletes an existing key through the invalidating facade and reports existed:true', function() {
    handles.properties._store.F3GO30_5XMK_PROBE = 'ok';
    var result = callAdmin_('deleteScriptProperty', { key: 'F3GO30_5XMK_PROBE' });
    assert.deepEqual(result, { ok: true, key: 'F3GO30_5XMK_PROBE', existed: true });
    assert.equal(handles.properties.getProperty('F3GO30_5XMK_PROBE'), null, 'key must actually be gone from the store');
  });

  it('a second delete of the same (now-absent) key self-verifies with existed:false, not an error', function() {
    delete handles.properties._store.F3GO30_ALREADY_GONE;
    var result = callAdmin_('deleteScriptProperty', { key: 'F3GO30_ALREADY_GONE' });
    assert.deepEqual(result, { ok: true, key: 'F3GO30_ALREADY_GONE', existed: false });
  });

  it('requires a key and never calls delete when it is missing', function() {
    handles.properties._store.F3GO30_UNTOUCHED = 'still-here';
    var result = callAdmin_('deleteScriptProperty', {});
    assert.deepEqual(result, { ok: false, error: 'key is required' });
    assert.equal(handles.properties.getProperty('F3GO30_UNTOUCHED'), 'still-here');
  });

  ['ADMIN_SHARED_SECRET', 'AXIOM_TOKEN', 'AXIOM_DATASET', 'GAS_LOGGER_PARENT_FOLDER_ID'].forEach(function(protectedKey) {
    it('refuses to delete the protected key ' + protectedKey + ' even with a valid admin secret', function() {
      // ADMIN_SHARED_SECRET doubles as the value handleAdminPost_'s own secret gate reads on
      // THIS call — must stay 'test-secret' so the refusal is a deliberate protected-key
      // refusal, not an incidental auth failure from clobbering the secret first.
      var priorValue = protectedKey === 'ADMIN_SHARED_SECRET' ? 'test-secret' : 'must-not-be-removed';
      handles.properties._store[protectedKey] = priorValue;
      var result = callAdmin_('deleteScriptProperty', { key: protectedKey });
      assert.deepEqual(result, { ok: false, error: 'protected_key' });
      assert.equal(handles.properties.getProperty(protectedKey), priorValue, 'protected key must survive the refused call');
    });
  });

  it('works on PROD (APP_DEPLOY_TARGET === TEMPLATE) — deliberately no PROD guard, unlike setContextDate/setConfigValue', function() {
    withDeployTarget_('TEMPLATE', function() {
      handles.properties._store.F3GO30_PROD_STUCK_KEY = 'stuck';
      var result = callAdmin_('deleteScriptProperty', { key: 'F3GO30_PROD_STUCK_KEY' });
      assert.deepEqual(result, { ok: true, key: 'F3GO30_PROD_STUCK_KEY', existed: true });
    });
  });

  it('logs the deletion via GasLogger', function() {
    handles.logger._logs = [];
    handles.properties._store.F3GO30_LOGGED_DELETE = 'x';
    callAdmin_('deleteScriptProperty', { key: 'F3GO30_LOGGED_DELETE' });
    var matching = handles.logger._logs.filter(function(args) { return args[0] === 'handleAdminPost_.deleteScriptProperty'; });
    assert.equal(matching.length, 1, 'exactly one deleteScriptProperty log event expected');
    assert.deepEqual(matching[0][1], { key: 'F3GO30_LOGGED_DELETE', existed: true });
  });
});
