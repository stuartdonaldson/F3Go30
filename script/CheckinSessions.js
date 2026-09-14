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
    // F3Go30-ptbf: read through the per-execution whole-store memo rather than calling
    // PropertiesService directly — the write half below already goes through the invalidating
    // facade (F3Go30-h4xt), so a read via the memo can never serve a value this same execution
    // has already overwritten. This was the one script-properties access in this file that
    // still bypassed the memo.
    var raw = getScriptPropertiesSnapshot_cs_()[CHECKIN_SESSION_ROSTER_PROPERTY_];
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// F3Go30-h4xt: script-properties writes go through ScriptProperties.js's invalidating facade, so
// the per-execution whole-store memo (getScriptPropertiesSnapshot_) can never serve a value this
// same execution has already overwritten. Resolved lazily inside the accessor because in GAS
// these are plain globals whose defining file may evaluate after this one.
var scriptPropertiesModule_cs_ = (typeof require === 'function') ? require('./ScriptProperties.js') : null;
function scriptProps_cs_() {
  return scriptPropertiesModule_cs_ ? scriptPropertiesModule_cs_.scriptPropertiesStore_() : scriptPropertiesStore_();
}
function getScriptPropertiesSnapshot_cs_() {
  return scriptPropertiesModule_cs_ ? scriptPropertiesModule_cs_.getScriptPropertiesSnapshot_() : getScriptPropertiesSnapshot_();
}

function _setCheckinSessionRosterIndex_(index) {
  try {
    scriptProps_cs_().setProperty(CHECKIN_SESSION_ROSTER_PROPERTY_, JSON.stringify(index || {}));
  } catch (e) { /* best-effort — next resolve/cleanup rebuilds it from the live sheet anyway */ }
}

// F3Go30-ptbf: per-execution memo for resolveCheckinSession_, keyed by the `spreadsheet` object
// identity (a WeakMap, so it can never leak across executions/tests the way a plain module-level
// object keyed by guid alone would — the same execution always reuses the same `spreadsheet`
// handle, so keying on it is equivalent to "per execution" without needing an explicit reset).
// Same one-execution-one-request rationale as ScriptProperties.js's whole-store memo and
// dashboardIdentity.js's priorMonthTailContextMemo_ — GAS re-evaluates this file's top-level
// state fresh on every execution, so the memo is discarded with it.
//
// The in-lock re-check inside createOrTouchCheckinSession_ (below) deliberately calls
// resolveCheckinSessionUncached_ directly, NEVER this memoized wrapper — a concurrent create
// racing between the unlocked resolve and the lock acquisition must be seen fresh, not served
// from a memo taken before the lock existed (AC3).
var checkinSessionResolveMemo_ = (typeof WeakMap === 'function') ? new WeakMap() : null;

function checkinSessionResolveMemoBucket_(spreadsheet) {
  if (!checkinSessionResolveMemo_ || !spreadsheet) return null;
  var bucket = checkinSessionResolveMemo_.get(spreadsheet);
  if (!bucket) {
    bucket = {};
    checkinSessionResolveMemo_.set(spreadsheet, bucket);
  }
  return bucket;
}

/**
 * Resolves {row, f3Name, email, createdAt, lastUsedAt} for a session guid, or null if it's
 * never existed or has been pruned. Memoized per (spreadsheet, guid) for the lifetime of one
 * execution (F3Go30-ptbf) — see resolveCheckinToken_dw_ + createOrTouchCheckinSession_'s two
 * independent call sites in one identify, which used to each pay the full resolve cost.
 */
function resolveCheckinSession_(spreadsheet, guid) {
  if (!guid) return null;
  var bucket = checkinSessionResolveMemoBucket_(spreadsheet);
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, guid)) {
    return bucket[guid];
  }
  var result = resolveCheckinSessionUncached_(spreadsheet, guid);
  if (bucket) bucket[guid] = result;
  return result;
}

/**
 * The actual resolution logic, never memoized — called directly by resolveCheckinSession_ (which
 * adds the per-execution memo) and by createOrTouchCheckinSession_'s in-lock re-check, which must
 * always see live state.
 *
 * Roster-index fast path: a hit whose cached entry is already the full {row, f3Name, email,
 * createdAt, lastUsedAt} shape (F3Go30-ptbf) is returned straight from the index — genuinely no
 * Sheets API access at all (AC1), unlike the old design which cached only a row number and still
 * had to open the sheet + getRange to learn the rest. Every write path that can add or move a
 * guid's row (append on create, the live-scan self-heal below, cleanupStaleCheckinSessions_'s
 * rebuild, deleteCheckinSessionsByIdentity_'s rebuild) writes this same full shape, and
 * touchCheckinSession_ patches lastUsedAt into it in place — so a value ever found under a guid
 * key was written for that exact guid; nothing here re-derives an entry by row-position, which is
 * what a wrong hit would require.
 *
 * A miss, or an entry left over from before this widening (the old design's bare row number) —
 * falls back to a live scan (ignoring whatever the stale entry pointed at, rather than trusting
 * its row position), which self-heals the index into the new shape either way. This is the
 * defense against a stale/legacy index entry ever resolving a token to the wrong PAX's identity
 * (AC2): a hit is only ever trusted when it's the fully-shaped object a guid-verified write
 * produced, never a bare row pointer re-read off the sheet.
 */
function resolveCheckinSessionUncached_(spreadsheet, guid) {
  var index = _getCheckinSessionRosterIndex_();
  var entry = index[guid];
  if (entry && typeof entry === 'object' && entry.row) {
    return {
      row: entry.row,
      f3Name: entry.f3Name,
      email: entry.email,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
    };
  }

  // Read-only lookup — must never provision the sheet as a side effect (every invalid/unknown
  // token otherwise passed through here would silently create it). Only
  // createOrTouchCheckinSession_'s write path is allowed to do that.
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var allValues = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  for (var i = 0; i < allValues.length; i++) {
    if (allValues[i][CHECKIN_SESSION_COL_ID_] === guid) {
      var found = {
        row: i + 2,
        f3Name: allValues[i][CHECKIN_SESSION_COL_F3NAME_],
        email: allValues[i][CHECKIN_SESSION_COL_EMAIL_],
        createdAt: allValues[i][CHECKIN_SESSION_COL_CREATED_],
        lastUsedAt: allValues[i][CHECKIN_SESSION_COL_LAST_USED_],
      };
      index[guid] = found;
      _setCheckinSessionRosterIndex_(index);
      return found;
    }
  }
  return null;
}

/** Test-only: drops the per-execution resolve memo. Production never needs this — GAS
 *  re-evaluates this file's top-level state fresh on every execution (see the memo's docstring). */
function resetCheckinSessionResolveMemo_() {
  checkinSessionResolveMemo_ = (typeof WeakMap === 'function') ? new WeakMap() : null;
}

function normalizeCheckinIdentityField_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/** Builds a roster-index full-shape entry (F3Go30-ptbf) from a raw CheckinSessions sheet row. */
function _checkinSessionIndexEntryFromRow_(row, rowNumber) {
  return {
    row: rowNumber,
    f3Name: row[CHECKIN_SESSION_COL_F3NAME_],
    email: row[CHECKIN_SESSION_COL_EMAIL_],
    createdAt: row[CHECKIN_SESSION_COL_CREATED_],
    lastUsedAt: row[CHECKIN_SESSION_COL_LAST_USED_],
  };
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
  var removedGuids = [];
  values.forEach(function(row) {
    var matches = normalizeCheckinIdentityField_(row[CHECKIN_SESSION_COL_F3NAME_]) === wantName &&
      normalizeCheckinIdentityField_(row[CHECKIN_SESSION_COL_EMAIL_]) === wantEmail;
    if (matches) {
      removedGuids.push(row[CHECKIN_SESSION_COL_ID_]);
    } else {
      keepRows.push(row);
    }
  });
  var removed = removedGuids.length;
  if (!removed) return 0;

  // F3Go30-ptbf: a removed guid must not keep resolving from this execution's per-execution memo
  // (checkinSessionResolveMemo_) — nothing calls resolveCheckinSession_ again for a just-deleted
  // guid on any current PAX-facing path, but this keeps the memo's own invariant ("never serves a
  // value this same execution has already invalidated") true regardless of caller.
  var memoBucket = checkinSessionResolveMemoBucket_(spreadsheet);
  if (memoBucket) removedGuids.forEach(function(guid) { memoBucket[guid] = null; });

  sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).clearContent();
  if (keepRows.length) {
    sheet.getRange(2, 1, keepRows.length, CHECKIN_SESSIONS_HEADERS_.length).setValues(keepRows);
  }
  var newIndex = {};
  keepRows.forEach(function(row, i) { newIndex[row[CHECKIN_SESSION_COL_ID_]] = _checkinSessionIndexEntryFromRow_(row, i + 2); });
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
    touchCheckinSession_(spreadsheet, existing.row, existing.guid);
    return existing.guid;
  }
  GasLogger.log('checkinSession.resolveOrCreate.noExistingSession', { level: 'warn' });
  if (typeof Utilities === 'undefined' || !Utilities.getUuid) return null;
  var guid = Utilities.getUuid();
  createOrTouchCheckinSession_(spreadsheet, guid, f3Name, email);
  return guid;
}

/**
 * Single-cell write, no lock — see file header on why this must stay lock-free. When `guid` is
 * given (every real caller has it), also patches the roster index's cached lastUsedAt for that
 * guid in place (F3Go30-ptbf) — an unlocked read-modify-write of the index blob, same as the
 * live-scan self-heal below; a lost update here only means one revisit's lastUsedAt is a beat
 * stale, never a wrong identity, so it doesn't need the create-path's lock. Without this the
 * widened index (which now answers resolveCheckinSession_ hits without touching the sheet) would
 * go stale on the very first bookmarked revisit and firstUse would wrongly read true forever
 * after.
 */
function touchCheckinSession_(spreadsheet, sessionRow, guid) {
  var sheet = _openOrCreateCheckinSessionsSheet_(spreadsheet);
  var nowIso = new Date().toISOString();
  sheet.getRange(sessionRow, CHECKIN_SESSION_COL_LAST_USED_ + 1).setValue(nowIso);
  if (!guid) return;
  try {
    var index = _getCheckinSessionRosterIndex_();
    var entry = index[guid];
    if (entry && typeof entry === 'object' && entry.row) {
      entry.lastUsedAt = nowIso;
      _setCheckinSessionRosterIndex_(index);
    }
  } catch (e) { /* best-effort — a stale/missing index entry self-heals on next resolve */ }
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
    touchCheckinSession_(spreadsheet, existing.row, guid);
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
    // between the unlocked resolve above and acquiring the lock. Deliberately the UNCACHED
    // resolver (F3Go30-ptbf AC3): this must see live state, never a pre-lock memo entry that
    // would defeat the whole point of the re-check.
    var raced = resolveCheckinSessionUncached_(spreadsheet, guid);
    if (raced) {
      touchCheckinSession_(spreadsheet, raced.row, guid);
      // The unlocked resolve at the top of this function ran before this guid existed and
      // memoized that miss (F3Go30-ptbf) — correct it now so anything later in this same
      // execution that asks resolveCheckinSession_ for this guid sees the real session a
      // concurrent request just created, not the stale pre-lock "not found".
      var racedBucket = checkinSessionResolveMemoBucket_(spreadsheet);
      if (racedBucket) racedBucket[guid] = raced;
      return;
    }
    var now = new Date().toISOString();
    var createdAt = createdAtIsoOverride || now;
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, CHECKIN_SESSIONS_HEADERS_.length).setValues([[guid, f3Name, email, createdAt, now]]);
    var index = _getCheckinSessionRosterIndex_();
    var created = { row: newRow, f3Name: f3Name, email: email, createdAt: createdAt, lastUsedAt: now };
    index[guid] = created;
    _setCheckinSessionRosterIndex_(index);
    // Same correction as the raced branch above: the top-of-function memoized miss must not
    // outlive the row this call just created, for the rest of this execution.
    var createdBucket = checkinSessionResolveMemoBucket_(spreadsheet);
    if (createdBucket) createdBucket[guid] = created;
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
  keepRows.forEach(function(row, i) { newIndex[row[CHECKIN_SESSION_COL_ID_]] = _checkinSessionIndexEntryFromRow_(row, i + 2); });
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

/**
 * Returns the set of F3 Names (normalized) currently holding a CheckinSessions row — i.e. still
 * "active" per that sheet's own nightly prune (cleanupStaleCheckinSessions_ above). Used by
 * PaxCache.js's purgeStalePaxCache_ (F3Go30-440b.2) as an activity-based staleness signal for
 * per-PAX cache rows on sheets too recent to qualify for its own tracker-age wipe: since every
 * identify (dashboardWebapp.js's handleCheckinIdentify_) and every signup
 * (signupWebapp.js's resolveOrCreateCheckinSessionGuid_) creates or touches a session, a PAX
 * absent here hasn't been seen in at least CHECKIN_SESSION_STALE_DAYS_ — reusing that already-
 * pruned store as the activity signal instead of re-deriving a second staleness window in
 * PaxCache.js. Read-only: never provisions the sheet.
 * @returns {Object<string, boolean>} {normalizedF3Name: true}
 */
function listActiveCheckinSessionF3Names_(spreadsheet) {
  var names = {};
  var sheet = spreadsheet.getSheetByName(CHECKIN_SESSIONS_SHEET_NAME_);
  if (!sheet) return names;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return names;
  var values = sheet.getRange(2, 1, lastRow - 1, CHECKIN_SESSIONS_HEADERS_.length).getValues();
  values.forEach(function(row) {
    var norm = normalizeCheckinIdentityField_(row[CHECKIN_SESSION_COL_F3NAME_]);
    if (norm) names[norm] = true;
  });
  return names;
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
    listActiveCheckinSessionF3Names_: listActiveCheckinSessionF3Names_,
    resolveCheckinSessionUncached_: resolveCheckinSessionUncached_,
    resetCheckinSessionResolveMemo_: resetCheckinSessionResolveMemo_,
    _getCheckinSessionRosterIndex_: _getCheckinSessionRosterIndex_,
    _setCheckinSessionRosterIndex_: _setCheckinSessionRosterIndex_,
  };
}
