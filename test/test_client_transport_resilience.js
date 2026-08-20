const assert = require('node:assert/strict');
const { readStaticPage_, extractTransportBlock_, extractShowApiError_ } = require('./helpers/staticPageExtract');

// F3Go30-313u: the static page's POST to the GAS /exec endpoint answers 302 ->
// script.googleusercontent.com/macros/echo, and that second hop is observably unreliable — seen
// live on SIT 2026-07-28 in both directions: a request that never reached GAS (browser reported
// `TypeError: Failed to fetch`, no doPost in Axiom) and a request that GAS executed and answered
// in 668ms whose response never reached the browser (static-signup.spec.js sat on "Checking…"
// until its 15s timeout; the same test passed 3x on re-run).
//
// Neither flake is fixable client-side. What IS fixable is the damage: without a timeout a lost
// response never settles the promise, so `finally` never runs, pendingRequestCount_ never
// decrements, the "Syncing…" indicator spins forever and the submitting button stays disabled —
// with no recovery but a manual reload and no hint that a reload is what is needed.
//
// Extracts the REAL transport block and the REAL showApiError_ (not re-implementations) and runs
// them against injected stand-ins — same extraction pattern as test_session_resume_refresh.js
// (silentResumeRefresh_) and test_dashboard_stale_while_revalidate.js (revalidateDashboard_).
// (F3Go30-lem7: extraction helpers now shared via test/helpers/staticPageExtract.js.)

/**
 * Runs the extracted transport block with injected stand-ins.
 * `fetchImpl(url, opts)` is the stub backing every attempt. Timers are fake and manual: the
 * harness records each scheduled timeout so a test can fire the request timeout deterministically
 * instead of waiting real seconds.
 */
function makeTransportHarness_(fetchImpl) {
  var body = extractTransportBlock_(readStaticPage_());

  var fetchCalls = [];
  var timers = [];
  var clearedIds = [];
  var pageHandlers = {};

  var fakeWindow = {
    addEventListener: function(evt, fn) { (pageHandlers[evt] = pageHandlers[evt] || []).push(fn); },
  };

  var fakeSetTimeout = function(fn, ms) {
    timers.push({ fn: fn, ms: ms, id: timers.length + 1 });
    return timers.length;
  };
  var fakeClearTimeout = function(id) { clearedIds.push(id); };

  var wrappedFetch = function(url, opts) {
    fetchCalls.push({ url: url, opts: opts, body: JSON.parse(opts.body) });
    return fetchImpl(url, opts, fetchCalls.length);
  };

  var factory = new Function(
    'WEBAPP_URL', 'CMD_', 'NS_', 'CONTEXT_DATE_', 'STATIC_BUILD_VERSION_',
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', '$', 'window',
    body +
    '\nreturn { callApi: callApi, pending: function() { return pendingRequestCount_; },' +
    '\n         isUnloading: function() { return pageIsUnloading_; } };'
  );

  // The real updateSyncingIndicator_ comes with the block; this stands in for the element it
  // toggles, so "Syncing…" visibility is observed rather than assumed.
  var syncingHidden = true;
  var syncingNote = { classList: { toggle: function(c, on) { if (c === 'hidden') syncingHidden = !!on; } } };
  var fns = factory(
    'https://example.test/exec', 'checkin', '', '', '2.4.7.6',
    wrappedFetch, fakeSetTimeout, fakeClearTimeout, AbortController,
    function(id) { return id === 'checkinSyncingNote' ? syncingNote : null; },
    fakeWindow
  );

  return {
    callApi: fns.callApi,
    pending: fns.pending,
    isUnloading: fns.isUnloading,
    fetchCalls: fetchCalls,
    timers: timers,
    clearedIds: clearedIds,
    syncingHidden: function() { return syncingHidden; },
    /** Fires every timer scheduled so far (the request timeouts), as the event loop would. */
    fireTimers: function() {
      var due = timers.splice(0, timers.length);
      due.forEach(function(t) { if (clearedIds.indexOf(t.id) === -1) t.fn(); });
    },
    firePageEvent: function(evt) { (pageHandlers[evt] || []).forEach(function(fn) { fn(); }); },
    handlerNames: function() { return Object.keys(pageHandlers); },
  };
}

function makeShowApiErrorHarness_(opts) {
  opts = opts || {};
  var src = readStaticPage_();
  // showApiError_ reads pageIsUnloading_ out of the transport block's scope; the block is
  // prepended so the real declaration (not a test-authored one) is what it closes over.
  var body = extractTransportBlock_(src) + '\n' + extractShowApiError_(src);

  var els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        // Starts hidden, as #apiErrorBanner and #apiErrorContactLink do in the real markup —
        // so "the banner was never shown" is distinguishable from "the banner was shown".
        id: id, textContent: '', href: '', hidden: true,
        classList: {
          add: function(c) { if (c === 'hidden') els[id].hidden = true; },
          remove: function(c) { if (c === 'hidden') els[id].hidden = false; },
          toggle: function(c, on) { if (c === 'hidden') els[id].hidden = !!on; },
        },
      };
    }
    return els[id];
  }

  var factory = new Function(
    'WEBAPP_URL', 'CMD_', 'NS_', 'CONTEXT_DATE_', 'STATIC_BUILD_VERSION_',
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', 'window',
    '$', 'SITE_Q_NAME', 'SITE_Q_EMAIL',
    body +
    '\nreturn { showApiError_: showApiError_, markUnloading: function() { pageIsUnloading_ = true; } };'
  );
  var fns = factory(
    'https://example.test/exec', 'checkin', '', '', '2.4.7.6',
    function() { throw new Error('fetch must not run in the showApiError_ harness'); },
    function() { return 0; }, function() {}, AbortController,
    { addEventListener: function() {} },
    el,
    Object.prototype.hasOwnProperty.call(opts, 'siteQName') ? opts.siteQName : 'Test Q',
    Object.prototype.hasOwnProperty.call(opts, 'siteQEmail') ? opts.siteQEmail : 'q@example.test'
  );
  return { showApiError_: fns.showApiError_, markUnloading: fns.markUnloading, el: el };
}

function transportError_() {
  // Exactly what a browser raises when the request or its response dies below HTTP.
  return new TypeError('Failed to fetch');
}

function okResponse_(json) {
  return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve(json); } });
}

function flush_() {
  return new Promise(function(r) { setImmediate(r); });
}

// ── AC1: a request that never settles is aborted, so the promise always settles ──────────────

(function testUnsettledRequestIsAbortedAndRejects() {
  var signals = [];
  var h = makeTransportHarness_(function(url, opts) {
    // A response lost in flight: the promise only ever settles because the signal aborts it.
    return new Promise(function(_resolve, reject) {
      signals.push(opts.signal);
      opts.signal.addEventListener('abort', function() { reject(new Error('The operation was aborted.')); });
    });
  });

  var settled = null;
  var p = h.callApi('save', { f3Name: 'X' }, 'signup')
    .then(function() { settled = 'resolved'; }, function(err) { settled = err; });

  return flush_().then(function() {
    assert.equal(settled, null, 'the request must still be in flight before its timeout fires');
    assert.ok(h.timers.length >= 1, 'callApi must schedule a request timeout (AC1)');
    h.fireTimers();
    return p;
  }).then(function() {
    assert.ok(settled instanceof Error, 'an unsettled request must reject once the timeout fires (AC1)');
    assert.equal(signals[0].aborted, true, 'the timeout must abort the request, not just give up on it');
    assert.equal(h.pending(), 0,
      'pendingRequestCount_ must return to 0 so the "Syncing…" indicator cannot spin forever (AC1)');
  });
})();

(function testTimeoutIsBoundedAndCancelledOnSuccess() {
  var h = makeTransportHarness_(function() { return okResponse_({ ok: true, matched: true }); });
  return h.callApi('identify', { f3Name: 'X' }).then(function() {
    assert.equal(h.timers.length, 1, 'each attempt must schedule exactly one timeout');
    assert.ok(h.timers[0].ms > 0 && h.timers[0].ms <= 60000,
      'the request timeout must be bounded and human-scale, got ' + h.timers[0].ms + 'ms (AC1)');
    assert.equal(h.clearedIds.length, 1, 'a settled request must clear its pending timeout');
    assert.equal(h.pending(), 0, 'pendingRequestCount_ must return to 0 after a successful call');
  });
})();

// A write cannot be retried, so aborting one early would report failure for something that may
// have landed — it must be given a strictly longer leash than a retryable read (AC1 + AC3).
(function testWritesGetALongerTimeoutThanReads() {
  var readTimeout = null;
  var writeTimeout = null;
  var hr = makeTransportHarness_(function() { return okResponse_({ ok: true }); });
  var hw = makeTransportHarness_(function() { return okResponse_({ ok: true }); });
  return hr.callApi('identify', {}).then(function() {
    readTimeout = hr.timers[0].ms;
    return hw.callApi('checkin', {});
  }).then(function() {
    writeTimeout = hw.timers[0].ms;
    assert.ok(writeTimeout > readTimeout,
      'a non-retryable write must wait longer than a retryable read before giving up — got write=' +
      writeTimeout + 'ms read=' + readTimeout + 'ms (AC1/AC3)');
  });
})();

// ── AC2: read-only actions retry once ────────────────────────────────────────────────────────

['identify', 'dashboard', 'bonusList', 'monthGrid'].forEach(function(action) {
  (function testIdempotentActionRetriesOnce() {
    var h = makeTransportHarness_(function(url, opts, attempt) {
      return attempt === 1 ? Promise.reject(transportError_()) : okResponse_({ ok: true, matched: true });
    });
    return h.callApi(action, {}).then(function(res) {
      assert.equal(h.fetchCalls.length, 2, action + ' must be retried once on a transport failure (AC2)');
      assert.equal(res.matched, true, action + ' must resolve with the retry\'s response (AC2)');
      assert.equal(h.pending(), 0, 'pendingRequestCount_ must return to 0 after a retried call');
    });
  })();
});

(function testRetryIsOnlyOnce() {
  var h = makeTransportHarness_(function() { return Promise.reject(transportError_()); });
  return h.callApi('identify', {}).then(function() {
    assert.fail('identify must reject once the retry also fails');
  }, function() {
    assert.equal(h.fetchCalls.length, 2, 'a failing read must be attempted exactly twice, never more (AC2)');
  });
})();

(function testTimeoutAlsoTriggersTheRetry() {
  var h = makeTransportHarness_(function(url, opts, attempt) {
    if (attempt === 1) {
      return new Promise(function(_resolve, reject) {
        opts.signal.addEventListener('abort', function() { reject(new Error('The operation was aborted.')); });
      });
    }
    return okResponse_({ ok: true, matched: true });
  });

  var p = h.callApi('identify', {});
  return flush_().then(function() {
    h.fireTimers();
    return p;
  }).then(function(res) {
    assert.equal(h.fetchCalls.length, 2, 'a timed-out read must be retried, not just failed (AC2)');
    assert.equal(res.matched, true);
  });
})();

// ── AC3: writes are never retried ────────────────────────────────────────────────────────────

[['save', 'signup'], ['checkin', 'checkin'], ['bonusSave', 'checkin'], ['feedback', 'checkin']].forEach(function(pair) {
  (function testWriteActionIsNeverRetried() {
    var action = pair[0];
    var h = makeTransportHarness_(function() { return Promise.reject(transportError_()); });
    return h.callApi(action, {}, pair[1]).then(function() {
      assert.fail(action + ' must reject when the transport fails');
    }, function() {
      assert.equal(h.fetchCalls.length, 1,
        action + ' is a write — a lost response may mean it landed, so it must never be retried (AC3)');
    });
  })();
});

// ── AC4: transport failures are reported in plain language, without Site-Q escalation ────────

(function testTransportErrorIsRewrittenAndFlagged() {
  var h = makeTransportHarness_(function() { return Promise.reject(transportError_()); });
  return h.callApi('identify', {}).then(function() {
    assert.fail('must reject');
  }, function(err) {
    assert.equal(err.isTransport, true, 'a transport failure must be flagged so the banner can adapt (AC4)');
    assert.doesNotMatch(err.message, /Failed to fetch/,
      'the raw browser text must not reach the PAX (AC4)');
    assert.match(err.message, /connection|reach|offline|network/i,
      'the message must name connectivity in plain language, got: ' + err.message);
  });
})();

(function testTransportBannerDropsSiteQEscalation() {
  var h = makeShowApiErrorHarness_();
  var err = new Error('Couldn’t reach the server.');
  err.isTransport = true;
  h.showApiError_('identify', err);

  assert.equal(h.el('apiErrorBanner').hidden, false, 'the banner must still be shown');
  assert.equal(h.el('apiErrorContactLink').hidden, true,
    'a connectivity problem is not the Site Q’s to fix — the escalation link must be hidden (AC4)');
  assert.equal(h.el('apiErrorNetworkGuidance').hidden, false, 'connectivity guidance must be shown (AC4)');
  assert.equal(h.el('apiErrorServerGuidance').hidden, true, 'server/Site-Q guidance must be hidden (AC4)');
})();

// ── AC5: no banner while the page is being unloaded ──────────────────────────────────────────

(function testTransportBlockListensForUnload() {
  var h = makeTransportHarness_(function() { return okResponse_({ ok: true }); });
  assert.ok(h.handlerNames().indexOf('pagehide') !== -1,
    'the page must observe pagehide so a navigation-aborted request is not reported as a failure (AC5)');
  assert.equal(h.isUnloading(), false, 'the unloading flag must start false');
  h.firePageEvent('pagehide');
  assert.equal(h.isUnloading(), true, 'pagehide must set the unloading flag');
})();

(function testNoBannerOnceUnloading() {
  var h = makeShowApiErrorHarness_();
  h.markUnloading();
  h.showApiError_('identify', new Error('Failed to fetch'));
  assert.equal(h.el('apiErrorBanner').hidden, true,
    'a request killed by the page unloading must raise no banner in the doomed document (AC5)');
})();

// ── AC6: server-reported errors are unchanged ────────────────────────────────────────────────

(function testHttpErrorKeepsItsMessageAndIsNotRetried() {
  var h = makeTransportHarness_(function() {
    return Promise.resolve({ ok: false, status: 500, json: function() { return Promise.resolve({}); } });
  });
  return h.callApi('identify', {}).then(function() {
    assert.fail('must reject');
  }, function(err) {
    assert.equal(err.message, 'Server returned HTTP 500', 'HTTP error text must be unchanged (AC6)');
    assert.ok(!err.isTransport, 'an HTTP response is not a transport failure (AC6)');
    assert.equal(h.fetchCalls.length, 1, 'a server that answered must not be re-asked automatically (AC6)');
  });
})();

(function testServerReportedErrorKeepsItsMessage() {
  var h = makeTransportHarness_(function() {
    return okResponse_({ ok: false, error: 'that entry no longer belongs to you' });
  });
  return h.callApi('identify', {}).then(function() {
    assert.fail('must reject');
  }, function(err) {
    assert.equal(err.message, 'that entry no longer belongs to you', 'server error text must be unchanged (AC6)');
    assert.ok(!err.isTransport, 'a server-reported error is not a transport failure (AC6)');
    assert.equal(h.fetchCalls.length, 1, 'a server-reported error must not be retried (AC6)');
  });
})();

(function testServerErrorBannerKeepsSiteQEscalation() {
  var h = makeShowApiErrorHarness_();
  h.showApiError_('checkin', new Error('Server returned HTTP 500'));
  assert.equal(h.el('apiErrorContactLink').hidden, false, 'server errors keep the Site-Q contact link (AC6)');
  assert.equal(h.el('apiErrorServerGuidance').hidden, false, 'server errors keep the existing guidance (AC6)');
  assert.match(h.el('apiErrorDetail').textContent, /Action: checkin/, 'the detail block is unchanged (AC6)');
  assert.match(h.el('apiErrorDetail').textContent, /Server returned HTTP 500/);
})();

// ── Payload shape is unchanged by the rewrite ────────────────────────────────────────────────

(function testRequestShapeAndCmdRoutingSurvive() {
  var h = makeTransportHarness_(function() { return okResponse_({ ok: true }); });
  return h.callApi('identify', { f3Name: 'X' }, 'signup').then(function() {
    var call = h.fetchCalls[0];
    assert.equal(call.url, 'https://example.test/exec?cmd=signup', 'per-call cmd routing must survive');
    assert.equal(call.opts.method, 'POST');
    assert.equal(call.opts.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(call.body.action, 'identify');
    assert.equal(call.body.f3Name, 'X');
    assert.equal(call.body.clientVersion, '2.4.7.6');
    assert.ok('ns' in call.body && 'contextDate' in call.body, 'ns/contextDate must still round-trip');
  });
})();

// Several assertions above are async, and settle after this file finishes executing — a plain
// console.log here would announce success before they have run (verified: with the retry
// whitelist mutated to miss, the process still exits 1, but printed "passed" first). Node exits
// non-zero on an unhandled rejection, so reporting from the exit code is the honest signal.
process.on('exit', function(code) {
  if (code === 0) console.log('test_client_transport_resilience.js: all assertions passed');
});
