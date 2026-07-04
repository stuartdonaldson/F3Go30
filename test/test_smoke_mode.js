const assert = require('node:assert/strict');

// In-memory stand-in for PropertiesService.getScriptProperties() — SmokeMode.js's only
// dependency, so this is the entire fixture needed to test it.
var fakeProps;
global.PropertiesService = {
  getScriptProperties: function() { return fakeProps; },
};

const { smokeModeActive_, getSmokeTrackerId_ } = require('../script/SmokeMode.js');

function resetProps_(values) {
  var store = Object.assign({}, values);
  fakeProps = {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  };
}

// Inactive by default — no properties set.
resetProps_({});
assert.equal(smokeModeActive_(), false);
assert.equal(getSmokeTrackerId_(), null);

// Active, with a tracker id recorded.
resetProps_({ SMOKE_MODE: 'true', SMOKE_TRACKER_ID: 'sheet-smoke' });
assert.equal(smokeModeActive_(), true);
assert.equal(getSmokeTrackerId_(), 'sheet-smoke');

// SMOKE_MODE cleared (teardown) but SMOKE_TRACKER_ID left behind (e.g. a failed teardown) —
// smokeModeActive_ reflects only the flag; getSmokeTrackerId_ reflects only the id. Callers
// that need "is there currently a smoke tracker to exclude/select" should key off
// getSmokeTrackerId_() directly (as the resolution call sites in go30tools.js/signupWebapp.js
// do), not smokeModeActive_(), so a stale id left over from an incomplete teardown still gets
// excluded from ambiguity rather than silently trusted once SMOKE_MODE flips off.
resetProps_({ SMOKE_TRACKER_ID: 'sheet-smoke' });
assert.equal(smokeModeActive_(), false);
assert.equal(getSmokeTrackerId_(), 'sheet-smoke');

// Any non-'true' string (including '') reads as inactive — matches the === 'true' string
// comparison every other Script-Property boolean flag in this codebase uses.
resetProps_({ SMOKE_MODE: '' });
assert.equal(smokeModeActive_(), false);

console.log('test_smoke_mode.js: PASS');
