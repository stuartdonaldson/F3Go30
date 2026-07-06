/*
 * CheckinSessions.js
 *
 * Bookmarkable check-in link, take two (F3Go30 hardening work, 2026-07). IdentityToken.js's
 * signed token is stateless (no server storage, verified by HMAC alone) but that statelessness
 * is exactly what makes it impossible to embed in a bookmark URL in a single user interaction:
 * the token can only be minted AFTER resolving identity from a POST body, and a POST's body
 * never appears in the resulting address bar, so getting it into a bookmarkable URL needed a
 * second, script-triggered top-level redirect after the fact — the mechanism that kept
 * intermittently failing (see CheckinApp.html/IdentityCore.html's attemptTopRedirect_ history).
 *
 * This module flips the order: a random opaque session id (GUID) is minted BEFORE identity is
 * known — embedded directly into the identify form's own `action` URL at render time — so the
 * address bar is fixed the instant the page loads, regardless of what the subsequent POST
 * resolves to. The trade-off for dropping statelessness is a server-side session store (this
 * file), which — unlike the signed token — needs active pruning so it doesn't grow forever.
 *
 * One PAX can hold many session rows (one per browser/device that's ever completed a typed
 * identify) — sessions are keyed by GUID, not by PAX identity, so there's no uniqueness
 * constraint to enforce there.
 *
 * Cache shape mirrors PaxCache.js's established {roster index, per-row data} pattern, with one
 * deliberate difference: PaxCache's roster index is patched on every write path it's involved
 * in (signup saves, mark-minus-one). A CheckinSessions roster-index patch only happens once per
 * browser/device (first successful typed identify) — "Last Used At" bumps on every subsequent
 * bookmarked revisit are a single-cell sheet write with NO shared-property lock at all, so many
 * PAX checking in concurrently never contend with each other over one hot lock (see
 * touchCheckinSession_'s docstring — this was a deliberate reaction to the tail-latency
 * investigation earlier in the same hardening work).
 *
 * Migration note: IdentityToken.js's signed tokens minted before this rollout are still honored
 * (see resolveCheckinToken_dw_ in dashboardWebapp.js) — this module only ever creates new
 * GUID-keyed sessions going forward. Once Axiom shows checkinWebapp.identify.legacyTokenUsed has
 * stopped appearing for a full token-lifetime's worth of time, IdentityToken.js's verify path
 * can be retired.
 */

var CHECKIN_SESSIONS_SHEET_NAME_ = 'CheckinSessions';
var CHECKIN_SESSIONS_HEADERS_ = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];
var CHECKIN_SESSION_ROSTER_PROPERTY_ = 'CHECKIN_SESSION_ROSTER_INDEX';

// Column indices into CHECKIN_SESSIONS_HEADERS_ — named so the sheet's column order can be
// read without re-counting every time it's touched.
var CHECKIN_SESSION_COL_ID_ = 0;
var CHECKIN_SESSION_COL_F3NAME_ = 1;
var CHECKIN_SESSION_COL_EMAIL_ = 2;
var CHECKIN_SESSION_COL_CREATED_ = 3;
var CHECKIN_SESSION_COL_LAST_USED_ = 4;

// Purge thresholds for cleanupStaleCheckinSessions_ (nightly trigger). A session that was
// created but never revisited (Created At === Last Used At) is almost certainly a one-off typed
// identify whose PAX never actually bookmarked the resulting link — safe to prune much sooner
// than a session that's demonstrably being used as a real bookmark.
var CHECKIN_SESSION_ABANDONED_DAYS_ = 14;
var CHECKIN_SESSION_STALE_DAYS_ = 60;

function _openOrCreateCheckinSessionsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CHECKIN_SESSIONS_SHEET_NAME_);
    sheet.getRange(1, 1, 1, CHECKIN_SESSIONS_HEADERS_.length).setValues([CHECKIN_SESSIONS_HEADERS_]).setFontWeight('bold');
  }
  return sheet;
}

function _getCheckinSessionRosterIndex_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CHECKIN_SESSION_ROSTER_PROPERTY_);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function _setCheckinSessionRosterIndex_(index) {
  try {
    PropertiesService.getScriptProperties().setProperty(CHECKIN_SESSION_ROSTER_PROPERTY_, JSON.stringify(index || {}));
  } catch (e) { /* best-effort — next resolve/cleanup rebuilds it from the live sheet anyway */ }
}

/**
 * Resolves {row, f3Name, email, createdAt, lastUsedAt} for a session guid, or null if it's
 * never existed or has been pruned. Roster-index fast path (no sheet open at all on a hit);
 * falls back to a live scan on a miss, self-healing the index the same way PaxCache.js's
 * resolvePaxRowIndex_ does — so a stale/missing index entry never produces a false "not found."
 */
function resolveCheckinSession_(spreadsheet, guid) {
  if (!guid) return null;
  // Read-only lookup — must never provision the sheet as a side effect (every invalid/unknown
  // token otherwise passed through here would silently create it). Only
  // createOrTouchCheckinSession_'s write path is allowed to do that.
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) return null;
  var index = _getCheckinSessionRosterIndex_();
  var row = index[guid];
  if (row) {
    var lastRowNum = sheet.getLastRow();
    if (row <= lastRowNum) {
      var cached = sheet.getRange(row, 1, 1, CHECKIN_SESSIONS_HEADERS_.length).getValues()[0];
      if (cached[CHECKIN_SESSION_COL_ID_] === guid) {
        return {
          row: row,
          f3Name: cached[CHECKIN_SESSION_COL_F3NAME_],
          email: cached[CHECKIN_SESSION_COL_EMAIL_],
          createdAt: cached[CHECKIN_SESSION_COL_CREATED_],
          lastUsedAt: cached[CHECKIN_SESSION_COL_LAST_USED_],
        };
      }
    }
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var allValues = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  for (var i = 0; i < allValues.length; i++) {
    if (allValues[i][CHECKIN_SESSION_COL_ID_] === guid) {
      var foundRow = i + 2;
      index[guid] = foundRow;
      _setCheckinSessionRosterIndex_(index);
      return {
        row: foundRow,
        f3Name: allValues[i][CHECKIN_SESSION_COL_F3NAME_],
        email: allValues[i][CHECKIN_SESSION_COL_EMAIL_],
        createdAt: allValues[i][CHECKIN_SESSION_COL_CREATED_],
        lastUsedAt: allValues[i][CHECKIN_SESSION_COL_LAST_USED_],
      };
    }
  }
  return null;
}

/** Single-cell write, no lock — see file header on why this must stay lock-free. */
function touchCheckinSession_(spreadsheet, sessionRow) {
  var sheet = _openOrCreateCheckinSessionsSheet_(spreadsheet);
  sheet.getRange(sessionRow, CHECKIN_SESSION_COL_LAST_USED_ + 1).setValue(new Date().toISOString());
}

/**
 * Binds `guid` to {f3Name, email} the first time it's ever seen (a fresh row, append-only,
 * lock-guarded against a concurrent double-submit racing to create the same guid twice — same
 * convention as PaxCache.js's patchPaxRosterIndex_), or just bumps Last Used At if this exact
 * guid already has a session (a re-submitted form, or a retry after a transient error). Called
 * once per browser/device on its first successful typed identify — NOT on every check-in, so
 * this lock is rarely contended, unlike a shared blob touched on every single authentication.
 *
 * Doubles as the entire migration path for a pre-rollout signed IdentityToken.js token: a
 * caller resolving one of those via its legacy verify fallback passes the token string itself
 * as `guid` here, planting it into this table under its own value — every subsequent request
 * for that same bookmark then resolves via the fast session path and never touches the legacy
 * verify code again. See dashboardWebapp.js's resolveCheckinToken_/handleCheckinIdentify_.
 * @param {string=} createdAtIsoOverride Seeds Created At with this instead of "now" — used only
 *   for that migration case, so a long-bookmarked link's Created At reflects when the PAX
 *   actually got it (the token's own embedded mint time), not the moment it happened to be
 *   migrated into this table. Ignored when the guid already has a session (only Last Used At
 *   changes on a touch).
 */
function createOrTouchCheckinSession_(spreadsheet, guid, f3Name, email, createdAtIsoOverride) {
  var existing = resolveCheckinSession_(spreadsheet, guid);
  if (existing) {
    touchCheckinSession_(spreadsheet, existing.row);
    return;
  }
  var sheet = _openOrCreateCheckinSessionsSheet_(spreadsheet);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('createOrTouchCheckinSession_.lockFailed', { error: e.message });
    return;
  }
  try {
    // Re-check inside the lock — a concurrent request could have created this exact guid's row
    // between the unlocked resolve above and acquiring the lock.
    var raced = resolveCheckinSession_(spreadsheet, guid);
    if (raced) {
      touchCheckinSession_(spreadsheet, raced.row);
      return;
    }
    var now = new Date().toISOString();
    var createdAt = createdAtIsoOverride || now;
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, CHECKIN_SESSIONS_HEADERS_.length).setValues([[guid, f3Name, email, createdAt, now]]);
    var index = _getCheckinSessionRosterIndex_();
    index[guid] = newRow;
    _setCheckinSessionRosterIndex_(index);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Nightly cleanup (see setupCheckinSessionCleanupTrigger_, onOpen.js's wiring): purges rows
 * never revisited past CHECKIN_SESSION_ABANDONED_DAYS_, or unused at all for
 * CHECKIN_SESSION_STALE_DAYS_ regardless of history — then rebuilds the roster index from
 * whatever's left, which is simpler and safer than patching every remaining row's index entry
 * by hand after a batch delete shifts row numbers.
 * @param {Date=} now Injectable for tests; defaults to the real current time.
 */
function cleanupStaleCheckinSessions_(now) {
  now = now || new Date();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _openOrCreateCheckinSessionsSheet_(spreadsheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { checked: 0, purged: 0, kept: 0 };

  var values = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  var staleMs = CHECKIN_SESSION_STALE_DAYS_ * 24 * 60 * 60 * 1000;
  var abandonedMs = CHECKIN_SESSION_ABANDONED_DAYS_ * 24 * 60 * 60 * 1000;
  var keepRows = [];
  var purged = 0;

  values.forEach(function(row) {
    var createdAtIso = row[CHECKIN_SESSION_COL_CREATED_];
    var lastUsedAtIso = row[CHECKIN_SESSION_COL_LAST_USED_];
    var ageSinceUsedMs = now.getTime() - new Date(lastUsedAtIso).getTime();
    var neverRevisited = createdAtIso === lastUsedAtIso;
    var isStale = ageSinceUsedMs > staleMs || (neverRevisited && ageSinceUsedMs > abandonedMs);
    if (isStale) {
      purged++;
    } else {
      keepRows.push(row);
    }
  });

  sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).clearContent();
  if (keepRows.length) {
    sheet.getRange(2, 1, keepRows.length, CHECKIN_SESSIONS_HEADERS_.length).setValues(keepRows);
  }

  var newIndex = {};
  keepRows.forEach(function(row, i) { newIndex[row[CHECKIN_SESSION_COL_ID_]] = i + 2; });
  _setCheckinSessionRosterIndex_(newIndex);

  GasLogger.log('cleanupStaleCheckinSessions_', { checked: values.length, purged: purged, kept: keepRows.length });
  return { checked: values.length, purged: purged, kept: keepRows.length };
}

/** GasLogger-wrapped entry point for the nightly trigger (see onOpen.js). */
function cleanupStaleCheckinSessions() {
  return GasLogger.run('cleanupStaleCheckinSessions', function() {
    return cleanupStaleCheckinSessions_();
  });
}

function clearCheckinSessionCleanupTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'cleanupStaleCheckinSessions') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Installs the nightly session-cleanup trigger exactly once — mirrors markMinusOne.js's
 *  setupDailyMinusOneTrigger convention (clear-then-recreate, so re-running this is idempotent). */
function setupCheckinSessionCleanupTrigger_() {
  clearCheckinSessionCleanupTrigger_();
  ScriptApp.newTrigger('cleanupStaleCheckinSessions')
    .timeBased()
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .atHour(3)
    .nearMinute(0)
    .create();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHECKIN_SESSIONS_SHEET_NAME_: CHECKIN_SESSIONS_SHEET_NAME_,
    CHECKIN_SESSIONS_HEADERS_: CHECKIN_SESSIONS_HEADERS_,
    resolveCheckinSession_: resolveCheckinSession_,
    touchCheckinSession_: touchCheckinSession_,
    createOrTouchCheckinSession_: createOrTouchCheckinSession_,
    cleanupStaleCheckinSessions_: cleanupStaleCheckinSessions_,
  };
}
