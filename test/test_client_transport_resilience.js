const assert = require('node:assert/strict');
const { readStaticPage_, extractTransportBlock_, extractShowApiError_, makeFakeLocalStorage_ } = require('./helpers/staticPageExtract');

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
    'fetch', 'setTimeout', 'clearTimeout', 'AbortController', '$', 'window', 'localStorage', 'navigator',
    body +
    '\nreturn { callApi: callApi, pending: function() { return pendingRequestCount_; },' +
    '\n         isUnloading: function() { return pageIsUnloading_; },' +
    '\n         captureClientError_: captureClientError_ };'
  );

  // The real updateSyncingIndicator_ comes with the block; this stands in for the element it
  // toggles, so "Syncing…" visibility (and its attempt-numbered label, F3Go30-5c2a.9) is
  // observed rather than assumed.
  var syncingHidden = true;
  var syncingNote = { textContent: '⟳ Syncing…', classList: { toggle: function(c, on) { if (c === 'hidden') syncingHidden = !!on; } } };
  var fakeLocalStorage = makeFakeLocalStorage_();
  var fns = factory(
    'https://example.test/exec', 'checkin', '', '', '2.4.7.6',
    wrappedFetch, fakeSetTimeout, fakeClearTimeout, AbortController,
    function(id) { return id === 'checkinSyncingNote' ? syncingNote : null; },
    fakeWindow, fakeLocalStorage, { onLine: true }
  );

  return {
    callApi: fns.callApi,
    pending: fns.pending,
    isUnloading: fns.isUnloading,
    fetchCalls: fetchCalls,
    timers: timers,
    clearedIds: clearedIds,
    syncingHidden: function() { return syncingHidden; },
    syncingText: function() { return syncingNote.textContent; },
    captureClientError_: fns.captureClientError_,
    /** Every clientTelemetry record still queued (nothing in these tests acks them). */
    telemetry: function() { return JSON.parse(fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1') || '[]'); },
    /** Fires every timer scheduled so far (the request timeouts), as the event loop would. */
    fireTimers: function() {
      var due = timers.splice(0, timers.length);
      due.forEach(function(t) { if (clearedIds.indexOf(t.id) === -1) t.fn(); });
    },
    /** F3Go30-8naq.2: fires ONLY the first live timer scheduled with `ms` (a read's hedge timer is
     * REQUEST_TIMEOUT_MS_, its overall deadline MAX_READ_ATTEMPTS_ x that) — fireTimers() above
     * fires everything, deadline included. */
    fireTimer: function(ms) {
      var i = timers.findIndex(function(t) { return t.ms === ms && clearedIds.indexOf(t.id) === -1; });
      assert.notEqual(i, -1, 'no live timer scheduled with ms=' + ms + ' (have ' + timers.map(function(t) { return t.ms; }) + ')');
      timers.splice(i, 1)[0].fn();
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
    // F3Go30-8naq.2: a read holds two timers - its hedge timer (REQUEST_TIMEOUT_MS_) and the
    // overall deadline (MAX_READ_ATTEMPTS_ x that) - and both must be cancelled once it settles.
    assert.deepEqual(h.timers.map(function(t) { return t.ms; }).sort(function(a, b) { return a - b; }), [12000, 36000],
      'a read must schedule exactly its hedge timer and its overall deadline');
    h.timers.forEach(function(t) {
      assert.ok(t.ms > 0 && t.ms <= 60000, 'timers must be bounded and human-scale, got ' + t.ms + 'ms (AC1)');
    });
    assert.equal(h.clearedIds.length, 2, 'a settled request must clear every pending timer');
    assert.equal(h.pending(), 0, 'pendingRequestCount_ must return to 0 after a successful call');
  });
})();

// A single-attempt write schedules exactly one timer (its own abort), cancelled on success.
(function testWriteSchedulesOneTimeoutCancelledOnSuccess() {
  var h = makeTransportHarness_(function() { return okResponse_({ ok: true }); });
  return h.callApi('checkin', { day: 'today' }).then(function() {
    assert.equal(h.timers.length, 1, 'a write schedules exactly one timeout (8naq.2 AC5: never hedged)');
    assert.equal(h.clearedIds.length, 1);
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
    readTimeout = Math.min.apply(null, hr.timers.map(function(t) { return t.ms; }));
    return hw.callApi('checkin', {});
  }).then(function() {
    writeTimeout = hw.timers[0].ms;
    assert.ok(writeTimeout > readTimeout,
      'a non-retryable write must wait longer than a retryable read before giving up — got write=' +
      writeTimeout + 'ms read=' + readTimeout + 'ms (AC1/AC3)');
  });
})();

// ── AC2: read-only actions retry (up to 3 attempts since F3Go30-5c2a.9) ───────────────────────

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

(function testReadIsAttemptedAtMostThreeTimes() {
  var h = makeTransportHarness_(function() { return Promise.reject(transportError_()); });
  return h.callApi('identify', {}).then(function() {
    assert.fail('identify must reject once every attempt fails');
  }, function() {
    assert.equal(h.fetchCalls.length, 3,
      'a failing read must be attempted exactly 3 times, never more (F3Go30-5c2a.9 AC3, superseding 313u AC2)');
  });
})();

(function testReadRecoversOnTheThirdAttempt() {
  var h = makeTransportHarness_(function(url, opts, attempt) {
    return attempt < 3 ? Promise.reject(transportError_()) : okResponse_({ ok: true, matched: true });
  });
  return h.callApi('identify', {}).then(function(res) {
    assert.equal(h.fetchCalls.length, 3);
    assert.equal(res.matched, true, 'the third attempt\'s response must be what callApi resolves with (5c2a.9 AC3)');
  });
})();

// F3Go30-8naq.2: REQUEST_TIMEOUT_MS_ no longer aborts a read; it starts the next attempt in
// parallel (see the hedged-read block below).
(function testTimeoutStartsTheNextAttemptInsteadOfAborting() {
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
    h.fireTimer(12000);
    return p;
  }).then(function(res) {
    assert.equal(h.fetchCalls.length, 2, 'a slow read must get a second attempt in parallel (AC2)');
    assert.equal(res.matched, true);
  });
})();

// ── F3Go30-8naq.2: hedged reads ───────────────────────────────────────────────────────────────
// A read attempt that passes REQUEST_TIMEOUT_MS_ is left OPEN and the next attempt starts in
// parallel; the first parsed response wins and every other open attempt is aborted. A fast
// transport failure still starts the next attempt immediately. The overall deadline is
// MAX_READ_ATTEMPTS_ x REQUEST_TIMEOUT_MS_ from the first send.

/** A fetch stub whose every attempt stays open until the test resolves it (or it is aborted). */
function makeControlledFetch_() {
  var attempts = [];
  function impl(url, opts, n) {
    return new Promise(function(resolve, reject) {
      var a = { n: n, signal: opts.signal, resolve: function(json) { resolve({ ok: true, status: 200, json: function() { return Promise.resolve(json); } }); },
                fail: function() { reject(transportError_()); } };
      opts.signal.addEventListener('abort', function() { reject(new Error('The operation was aborted.')); });
      attempts.push(a);
    });
  }
  return { impl: impl, attempts: attempts };
}

function lostRecords_(h) { return h.telemetry().filter(function(r) { return r.kind === 'lostResponse'; }); }

// AC1: a first attempt answering after REQUEST_TIMEOUT_MS_ still wins; attempt 2 (started at the
// hedge timer) is aborted.
(function testSlowFirstAttemptStillWinsAndTheHedgeIsAborted() {
  var c = makeControlledFetch_();
  var h = makeTransportHarness_(c.impl);
  var p = h.callApi('identify', {});
  return flush_().then(function() {
    assert.equal(c.attempts.length, 1);
    h.fireTimer(12000);
    return flush_();
  }).then(function() {
    assert.equal(c.attempts.length, 2, 'attempt 2 starts at the hedge timer, attempt 1 stays open');
    assert.equal(c.attempts[0].signal.aborted, false, 'the slow attempt must NOT be aborted at REQUEST_TIMEOUT_MS_');
    assert.equal(h.syncingText(), '⟳ Syncing-2…', 'Syncing-N shows the highest attempt launched');
    c.attempts[0].resolve({ ok: true, who: 'first' });
    return p;
  }).then(function(res) {
    assert.equal(res.who, 'first', 'the 13s answer is the result');
    assert.equal(c.attempts[1].signal.aborted, true, 'the losing hedge is aborted');
    assert.equal(h.pending(), 0);
    assert.equal(h.syncingText(), '⟳ Syncing…');
    return flush_();
  }).then(function() {
    assert.equal(lostRecords_(h).length, 0, 'AC6: an attempt aborted because another won is NOT a lost response');
    var win = h.telemetry().filter(function(r) { return r.kind === 'hedgedRead'; });
    assert.equal(win.length, 1, 'AC6: win telemetry recorded');
    assert.deepEqual([win[0].ctx.winningAttempt, win[0].ctx.hedged], [1, true]);
    assert.equal(h.timers.filter(function(t) { return h.clearedIds.indexOf(t.id) === -1; }).length, 0, 'every timer cancelled after the win');
  });
})();

// AC2: attempt 2 answering first wins; attempt 1 is aborted.
(function testSecondAttemptCanWinAndTheFirstIsAborted() {
  var c = makeControlledFetch_();
  var h = makeTransportHarness_(c.impl);
  var p = h.callApi('dashboard', {});
  return flush_().then(function() {
    h.fireTimer(12000);
    return flush_();
  }).then(function() {
    c.attempts[1].resolve({ ok: true, who: 'second' });
    return p;
  }).then(function(res) {
    assert.equal(res.who, 'second');
    assert.equal(c.attempts[0].signal.aborted, true, 'the superseded first attempt is aborted');
    return flush_();
  }).then(function() {
    assert.equal(lostRecords_(h).length, 0, 'AC6: superseded attempt is not reported lost');
    var win = h.telemetry().filter(function(r) { return r.kind === 'hedgedRead'; })[0];
    assert.deepEqual([win.ctx.winningAttempt, win.ctx.hedged], [2, true]);
  });
})();

// AC3: a fast transport failure starts the next attempt immediately - no timer fired.
(function testFastTransportFailureStartsNextAttemptImmediately() {
  var c = makeControlledFetch_();
  var h = makeTransportHarness_(c.impl);
  var p = h.callApi('identify', {});
  return flush_().then(function() {
    c.attempts[0].fail();
    return flush_();
  }).then(function() {
    assert.equal(c.attempts.length, 2, 'attempt 2 starts immediately on a fast failure (AC3)');
    c.attempts[1].resolve({ ok: true, who: 'second' });
    return p;
  }).then(function(res) {
    assert.equal(res.who, 'second');
    assert.equal(lostRecords_(h).length, 1, 'the attempt that really failed is still recorded');
  });
})();

// AC4: no response by MAX_READ_ATTEMPTS_ x REQUEST_TIMEOUT_MS_ -> everything aborted, rejects with
// the same transport-error shape (isTransport + attempts count).
(function testDeadlineAbortsEverythingAndRejectsAsTransport() {
  var c = makeControlledFetch_();
  var h = makeTransportHarness_(c.impl);
  var p = h.callApi('identify', {});
  return flush_().then(function() {
    h.fireTimer(12000); return flush_();
  }).then(function() {
    h.fireTimer(12000); return flush_();
  }).then(function() {
    assert.equal(c.attempts.length, 3, 'three attempts launched, each hedge 12s after the last');
    h.fireTimer(12000 * 3);
    return p.then(function() { assert.fail('must reject at the deadline'); }, function(err) {
      assert.equal(err.isTransport, true);
      assert.equal(err.ctx.attempts, 3, 'the rejection carries the attempts count');
      assert.ok(c.attempts.every(function(a) { return a.signal.aborted; }), 'every open attempt aborted at the deadline');
      assert.equal(h.pending(), 0);
      return flush_();
    });
  }).then(function() {
    var lost = lostRecords_(h);
    assert.equal(lost.length, 3, 'attempts that really timed out are each recorded');
    lost.forEach(function(r) { assert.equal(r.ctx.mode, 'timeout'); });
    assert.equal(c.attempts.length, 3, 'never more than MAX_READ_ATTEMPTS_ attempts');
  });
})();

// AC5 (writes unchanged): never hedged - the write timeout aborts it and it is sent once.
(function testWriteIsNeverHedged() {
  var c = makeControlledFetch_();
  var h = makeTransportHarness_(c.impl);
  var p = h.callApi('checkin', { day: 'today' });
  return flush_().then(function() {
    assert.deepEqual(h.timers.map(function(t) { return t.ms; }), [25000], 'a write schedules only WRITE_TIMEOUT_MS_');
    h.fireTimer(25000);
    return p.then(function() { assert.fail('must reject'); }, function(err) {
      assert.equal(err.isTransport, true);
      assert.equal(c.attempts.length, 1, 'never hedged');
      assert.equal(c.attempts[0].signal.aborted, true, 'a write is still aborted at its own timeout');
    });
  });
})();

// ── F3Go30-5c2a.9: a non-JSON response is a lost response, not a server answer ────────────────
// Live PROD 2026-09-29: after doPost has already run, Google either 404s the echo leg with a
// Drive "unable to open the file" page, or bounces the POST back to /exec as a GET, whose doGet
// renders the Check-In HTML page with HTTP 200. Neither is the server's answer.

var ECHO_URL_ = 'https://script.googleusercontent.com/macros/echo?user_content_key=abc&lib=x';
var EXEC_URL_ = 'https://script.google.com/macros/s/AKfy/exec?cmd=checkin';

function htmlResponse_(status, url) {
  return Promise.resolve({
    ok: status >= 200 && status < 300, status: status, url: url, redirected: true,
    json: function() { return Promise.reject(new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON')); },
  });
}

[[200, EXEC_URL_, 'exec'], [404, ECHO_URL_, 'echo'], [502, 'https://example.test/other', 'other']].forEach(function(c) {
  (function testHtmlBodyOnAWriteIsATransportClassLoss() {
    var h = makeTransportHarness_(function() { return htmlResponse_(c[0], c[1]); });
    return h.callApi('checkin', { day: 'today', value: 1 }).then(function() {
      assert.fail('a lost response must reject');
    }, function(err) {
      assert.equal(err.isTransport, true, 'HTTP ' + c[0] + ' + HTML body must be transport-class (5c2a.9 AC1)');
      assert.doesNotMatch(err.message, /Unexpected token|Server returned/, 'raw parse/HTTP text must not reach the PAX (AC1)');
      assert.equal(err.ctx && err.ctx.lostResponse, c[2], 'mode must be classified from res.url (AC1)');
      assert.equal(err.ctx.httpStatus, c[0], 'the HTTP status must be carried (AC1)');
      assert.equal(h.fetchCalls.length, 1, 'a write is still never retried, even on a lost response (AC3)');
    });
  })();
});

(function testHtmlBodyOnAReadIsRetried() {
  var h = makeTransportHarness_(function(url, opts, attempt) {
    return attempt === 1 ? htmlResponse_(200, EXEC_URL_) : okResponse_({ ok: true, matched: true });
  });
  return h.callApi('paxGoals', {}).then(function(res) {
    assert.equal(h.fetchCalls.length, 2, 'a read that got an HTML page must be re-asked (5c2a.9 AC3)');
    assert.equal(res.matched, true);
  });
})();

(function testSyncingLabelCarriesTheAttemptNumber() {
  var releaseSecond;
  var h = makeTransportHarness_(function(url, opts, attempt) {
    if (attempt === 1) return htmlResponse_(404, ECHO_URL_);
    return new Promise(function(resolve) { releaseSecond = function() { resolve({ ok: true, status: 200, json: function() { return Promise.resolve({ ok: true }); } }); }; });
  });
  var p = h.callApi('identify', {});
  assert.equal(h.syncingText(), '⟳ Syncing…', 'first attempt keeps the plain label (5c2a.9 AC4)');
  return flush_().then(function() {
    assert.equal(h.syncingHidden(), false);
    assert.equal(h.syncingText(), '⟳ Syncing-2…', 'a retry in flight must show its attempt number (AC4)');
    releaseSecond();
    return p;
  }).then(function() {
    assert.equal(h.syncingHidden(), true, 'nothing pending → hidden (AC4)');
    assert.equal(h.syncingText(), '⟳ Syncing…', 'label resets once no retry is in flight (AC4)');
  });
})();

(function testEveryLostAttemptIsRecordedEvenWhenRecovered() {
  var h = makeTransportHarness_(function(url, opts, attempt) {
    if (attempt === 1) return htmlResponse_(200, EXEC_URL_);
    if (attempt === 2) return Promise.reject(transportError_());
    return okResponse_({ ok: true });
  });
  return h.callApi('identify', {}).then(function() {
    var lost = h.telemetry().filter(function(r) { return r.kind === 'lostResponse'; });
    assert.equal(lost.length, 2, 'one lostResponse record per failed attempt, recovered or not (5c2a.9 AC5)');
    assert.equal(lost[0].action, 'identify');
    assert.deepEqual([lost[0].ctx.mode, lost[0].ctx.httpStatus, lost[0].ctx.attempt], ['exec', 200, 1]);
    assert.deepEqual([lost[1].ctx.mode, lost[1].ctx.httpStatus, lost[1].ctx.attempt], ['network', null, 2]);
    assert.equal(typeof lost[0].ctx.elapsedMs, 'number');
    lost.forEach(function(r) {
      ['lostResponse', 'mode', 'httpStatus', 'attempt'].forEach(function(k) {
        assert.ok(!(k in r) || k === 'kind', k + ' must live under ctx, not top-level (u7nk field budget, AC5)');
      });
    });
  });
})();

(function testTimeoutIsRecordedAsTimeoutMode() {
  // An attempt the overall deadline aborts did fail: recorded as a timeout loss (a write, whose
  // own timer is its deadline, is the single-attempt case).
  var h = makeTransportHarness_(function(url, opts) {
    return new Promise(function(_resolve, reject) {
      opts.signal.addEventListener('abort', function() { reject(new Error('The operation was aborted.')); });
    });
  });
  var p = h.callApi('checkin', {});
  return flush_().then(function() { h.fireTimers(); return p; }).then(function() { assert.fail('must reject'); }, function() {
    var lost = h.telemetry().filter(function(r) { return r.kind === 'lostResponse'; });
    assert.equal(lost.length, 1);
    assert.equal(lost[0].ctx.mode, 'timeout', 'our own abort must be recorded as timeout (5c2a.9 AC5)');
  });
})();

(function testFinalErrorRecordCarriesTheLostResponseCtx() {
  var h = makeTransportHarness_(function() { return htmlResponse_(404, ECHO_URL_); });
  return h.callApi('checkin', { day: 'today', value: 1 }).then(function() { assert.fail('must reject'); }, function(err) {
    h.captureClientError_('checkin', err);
    var rec = h.telemetry().filter(function(r) { return r.kind === 'error'; })[0];
    assert.ok(rec, 'captureClientError_ must queue an error record');
    assert.equal(rec.isTransport, true);
    assert.equal(rec.ctx && rec.ctx.lostResponse, 'echo', 'the final error record must carry the lost-response ctx (AC5)');
    assert.equal(rec.ctx.httpStatus, 404);
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
