const assert = require('node:assert/strict');

// F3Go30-qi26.3: renderCheckinPage_'s first-paint doGet must never open the CheckinSessions
// sheet just to decode a saved-link guid into a personalized page <title> — that sheet open
// measured a 3.6s doGet server think. buildCheckinPageOutput_ must resolve the title from
// CacheService only (CheckinSessions.js's getCachedCheckinSessionTitle_), falling back to the
// generic namespace title on a cache miss instead of falling back to a sheet open.

function fakeTemplate_() {
  var captured = {};
  var proxy = new Proxy(captured, {
    set: function(target, prop, value) { target[prop] = value; return true; },
    get: function(target, prop) {
      if (prop === 'evaluate') {
        return function() {
          var output = {
            title: null,
            setTitle: function(t) { output.title = t; return output; },
            setFaviconUrl: function() { return output; },
            addMetaTag: function() { return output; },
            __captured: captured,
          };
          return output;
        };
      }
      return target[prop];
    }
  });
  return proxy;
}

global.HtmlService = {
  createTemplateFromFile: function() { return fakeTemplate_(); },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; }
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return 'https://example.com/exec'; } }; } };
global.APP_VERSION = '9.9.9';
global.getConfigValue_ = function(spreadsheet, key) {
  if (key === 'NameSpace') return { primary: 'F3 Go30' };
  return {};
};
global.Utilities = { getUuid: function() { return 'fake-uuid'; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };

var fakeCacheStore_;
global.CacheService = {
  getScriptCache: function() {
    return {
      get: function(key) { return Object.prototype.hasOwnProperty.call(fakeCacheStore_, key) ? fakeCacheStore_[key] : null; },
      put: function(key, value) { fakeCacheStore_[key] = value; },
      remove: function(key) { delete fakeCacheStore_[key]; },
    };
  }
};
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

// A spreadsheet stub that throws if anything ever tries to open the CheckinSessions sheet from
// this first-paint path — the exact regression this issue fixes.
function fakeSpreadsheetNoCheckinSessionsOpen_() {
  return {
    getSheetByName: function(name) {
      if (name === 'CheckinSessions') {
        throw new Error('must not open CheckinSessions sheet on the first-paint doGet path');
      }
      return null;
    },
  };
}

const { buildCheckinPageOutput_ } = require('../script/dashboardWebapp.js');
const { getCachedCheckinSessionTitle_ } = require('../script/CheckinSessions.js');

(function testCachedTitleIsUsedWithoutOpeningCheckinSessionsSheet() {
  fakeCacheStore_ = {};
  fakeCacheStore_['checkinSessionTitle_guid-cached'] = 'Anchor';

  var spreadsheet = fakeSpreadsheetNoCheckinSessionsOpen_();
  var output = buildCheckinPageOutput_('guid-cached', null, 'guid-cached', spreadsheet, null, null);
  assert.equal(output.title, 'F3 Go30: Anchor');
})();

(function testCacheMissFallsBackToGenericTitleWithoutOpeningCheckinSessionsSheet() {
  fakeCacheStore_ = {};

  var spreadsheet = fakeSpreadsheetNoCheckinSessionsOpen_();
  var output = buildCheckinPageOutput_('guid-uncached', null, 'guid-uncached', spreadsheet, null, null);
  assert.equal(output.title, 'F3 Go30', 'a cache miss must fall back to the generic namespace title, not a sheet open');
})();

(function testTypedIdentifyResultTitleStillTakesPriorityOverCache() {
  fakeCacheStore_ = {};
  fakeCacheStore_['checkinSessionTitle_guid-x'] = 'Stale Cached Name';

  var spreadsheet = fakeSpreadsheetNoCheckinSessionsOpen_();
  var output = buildCheckinPageOutput_(null, { f3Name: 'Fresh Name' }, 'guid-x', spreadsheet, null, null);
  assert.equal(output.title, 'F3 Go30: Fresh Name');
})();

(function testGetCachedCheckinSessionTitleReadsThroughSameCacheKey() {
  fakeCacheStore_ = {};
  fakeCacheStore_['checkinSessionTitle_guid-direct'] = 'Direct Read';
  assert.equal(getCachedCheckinSessionTitle_('guid-direct'), 'Direct Read');
})();

console.log('test_checkin_title_cache.js: all assertions passed');
