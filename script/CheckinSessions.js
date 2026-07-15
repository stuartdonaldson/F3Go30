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

// CacheService's max — write-through target for a bookmarked guid's f3Name, kept warm on every
// identify (createOrTouchCheckinSession_) so a later doGet on that same bookmark can produce a
// personalized page <title> without opening the CheckinSessions sheet at all (F3Go30-qi26.3).
// A cache miss (expiry, or a bookmark that was minted before this rollout) just falls back to
// the generic namespace title — see dashboardWebapp.js's buildCheckinPageOutput_.
var CHECKIN_SESSION_TITLE_CACHE_TTL_SECONDS_ = 21600;

function checkinSessionTitleCacheKey_(guid) {
  return 'checkinSessionTitle_' + guid;
}

/** Best-effort — a failed write just means the next doGet falls back to the generic title. */
function cacheCheckinSessionTitle_(guid, f3Name) {
  try {
    CacheService.getScriptCache().put(checkinSessionTitleCacheKey_(guid), String(f3Name || ''), CHECKIN_SESSION_TITLE_CACHE_TTL_SECONDS_);
  } catch (e) { /* best-effort */ }
}

/**
 * Cache-only lookup for a bookmarked guid's f3Name — never opens a spreadsheet. Returns null on
 * a miss (never cached, or expired), which callers must treat as "no personalized title
 * available" rather than an error.
 */
function getCachedCheckinSessionTitle_(guid) {
  if (!guid) return null;
  try {
    return CacheService.getScriptCache().get(checkinSessionTitleCacheKey_(guid)) || null;
  } catch (e) {
    return null;
  }
}

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

function normalizeCheckinIdentityField_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/**
 * Reverse lookup: find the session a given PAX already holds, keyed by their {f3Name, email}
 * rather than by guid. Scans bottom-up and returns the most recent (last-written) match, so a
 * PAX with several device sessions gets handed their newest one. Case-insensitive on both
 * fields; both must match. Returns {guid, row, f3Name, email, createdAt, lastUsedAt} or null.
 *
 * Unlike resolveCheckinSession_'s guid path there's no roster-index fast lane here — the index
 * is keyed by guid, not identity — but this is only ever called off the (rare) confirmation-email
 * path, never per check-in, so a full scan is fine. Read-only: never provisions the sheet.
 */
function findCheckinSessionByIdentity_(spreadsheet, f3Name, email) {
  var wantName = normalizeCheckinIdentityField_(f3Name);
  var wantEmail = normalizeCheckinIdentityField_(email);
  if (!wantName || !wantEmail) return null;
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var r = values[i];
    if (normalizeCheckinIdentityField_(r[CHECKIN_SESSION_COL_F3NAME_]) === wantName &&
        normalizeCheckinIdentityField_(r[CHECKIN_SESSION_COL_EMAIL_]) === wantEmail) {
      return {
        guid: r[CHECKIN_SESSION_COL_ID_],
        row: i + 2,
        f3Name: r[CHECKIN_SESSION_COL_F3NAME_],
        email: r[CHECKIN_SESSION_COL_EMAIL_],
        createdAt: r[CHECKIN_SESSION_COL_CREATED_],
        lastUsedAt: r[CHECKIN_SESSION_COL_LAST_USED_],
      };
    }
  }
  return null;
}

/**
 * Removes every session row bound to {f3Name, email} (case-insensitive, same matching as
 * findCheckinSessionByIdentity_), rebuilding the roster index from what's left. Test-support
 * utility only — exposed via the resetCheckinSession admin action (WebApp.js) so an automated
 * spec that needs to assert exact createdAt-vs-lastUsedAt "first use" semantics (see
 * dashboardWebapp.js's handleCheckinIdentify_) can start a fixture PAX from a clean slate on
 * every run, instead of perpetually reusing whatever session an earlier run already touched.
 * Never called from any PAX-facing flow. Returns the number of rows removed.
 */
function deleteCheckinSessionsByIdentity_(spreadsheet, f3Name, email) {
  var wantName = normalizeCheckinIdentityField_(f3Name);
  var wantEmail = normalizeCheckinIdentityField_(email);
  if (!wantName || !wantEmail) return 0;
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  var keepRows = [];
  var removed = 0;
  values.forEach(function(row) {
    var matches = normalizeCheckinIdentityField_(row[CHECKIN_SESSION_COL_F3NAME_]) === wantName &&
      normalizeCheckinIdentityField_(row[CHECKIN_SESSION_COL_EMAIL_]) === wantEmail;
    if (matches) {
      removed++;
    } else {
      keepRows.push(row);
    }
  });
  if (!removed) return 0;

  sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).clearContent();
  if (keepRows.length) {
    sheet.getRange(2, 1, keepRows.length, CHECKIN_SESSIONS_HEADERS_.length).setValues(keepRows);
  }
  var newIndex = {};
  keepRows.forEach(function(row, i) { newIndex[row[CHECKIN_SESSION_COL_ID_]] = i + 2; });
  _setCheckinSessionRosterIndex_(newIndex);

  GasLogger.log('deleteCheckinSessionsByIdentity_', { f3Name: f3Name, removed: removed });
  return removed;
}

/**
 * Returns a bookmarkable session guid for {f3Name, email} — the existing one if this PAX already
 * has a session (bumping its Last Used At so handing it back out as an emailed bookmark keeps it
 * from being pruned), otherwise mints a fresh session and returns its guid. The confirmation
 * email uses this so the check-in/edit links it sends are already bound to a real session and
 * skip the name/email form on first tap.
 *
 * A miss is expected on a brand-new PAX's very first signup, but on an *edit/reconfirm* it can
 * mean their session was pruned or their identity drifted — worth a warning either way (never
 * fatal: we create one regardless). Returns null only when identity is incomplete or the guid
 * source (Utilities) isn't available (e.g. Node without GAS globals).
 */
function resolveOrCreateCheckinSessionGuid_(spreadsheet, f3Name, email) {
  if (!normalizeCheckinIdentityField_(f3Name) || !normalizeCheckinIdentityField_(email)) return null;
  var existing = findCheckinSessionByIdentity_(spreadsheet, f3Name, email);
  if (existing) {
    touchCheckinSession_(spreadsheet, existing.row);
    return existing.guid;
  }
  GasLogger.log('checkinSession.resolveOrCreate.noExistingSession', { level: 'warn' });
  if (typeof Utilities === 'undefined' || !Utilities.getUuid) return null;
  var guid = Utilities.getUuid();
  createOrTouchCheckinSession_(spreadsheet, guid, f3Name, email);
  return guid;
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
    cacheCheckinSessionTitle_(guid, f3Name);
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
      cacheCheckinSessionTitle_(guid, f3Name);
      return;
    }
    var now = new Date().toISOString();
    var createdAt = createdAtIsoOverride || now;
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, CHECKIN_SESSIONS_HEADERS_.length).setValues([[guid, f3Name, email, createdAt, now]]);
    var index = _getCheckinSessionRosterIndex_();
    index[guid] = newRow;
    _setCheckinSessionRosterIndex_(index);
    cacheCheckinSessionTitle_(guid, f3Name);
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
    findCheckinSessionByIdentity_: findCheckinSessionByIdentity_,
    deleteCheckinSessionsByIdentity_: deleteCheckinSessionsByIdentity_,
    resolveOrCreateCheckinSessionGuid_: resolveOrCreateCheckinSessionGuid_,
    cacheCheckinSessionTitle_: cacheCheckinSessionTitle_,
    getCachedCheckinSessionTitle_: getCachedCheckinSessionTitle_,
  };
}
