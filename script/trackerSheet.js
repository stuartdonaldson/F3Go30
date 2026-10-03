/*
 * trackerSheet.js — small helpers shared by every code path that writes a tracker spreadsheet:
 * the canonical Tracker sort (with its PaxCache/roster-cache invalidation) and the
 * "Month YYYY" registration label. (Formerly addResponseOnSubmit.js; the HC Form submit pipeline
 * that file was named for was retired by ADR-024.)
 */
var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var trackerSheetPaxCacheModule_ = gasRequire_('./PaxCache.js', ['deletePaxRosterIndex_']);
var deletePaxRosterIndex_ars_ = trackerSheetPaxCacheModule_.deletePaxRosterIndex_;

// F3Go30-mk3a: the full-roster CacheService key builders are dashboardCache.js's — required
// directly (no circularity: dashboardCache.js doesn't depend back on this file).
var trackerSheetCacheModule_ = gasRequire_('./dashboardCache.js', ['trackerValuesCacheKey_', 'responsesValuesCacheKey_']);
var trackerValuesCacheKey_ars_ = trackerSheetCacheModule_.trackerValuesCacheKey_;
var responsesValuesCacheKey_ars_ = trackerSheetCacheModule_.responsesValuesCacheKey_;

var REGISTRATION_MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Drops the full-roster CacheService blobs (Tracker + Responses) for one tracker spreadsheet. */
function invalidateFullRosterCachesForSheet_ars_(sheetId) {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(trackerValuesCacheKey_ars_(sheetId));
    cache.remove(responsesValuesCacheKey_ars_(sheetId));
  } catch (e) { /* best-effort */ }
}

/**
 * Sorts a Tracker sheet's data rows (4+) by column B then column A ascending — the canonical
 * Tracker sort, used by the signup webapp's save path (signupWebapp.js), the admin
 * `renameTeam` action, and callable directly (admin `sortTracker` action, WebApp.js) to re-sort
 * a tracker that was written to by a path that predates this sort being wired up.
 * No-op if the sheet has fewer than 4 rows (header rows only, nothing to sort).
 *
 * Drops PaxCache's Tracker roster index for this spreadsheet afterwards (F3Go30-a2hq). A sort
 * reassigns EVERY row offset, which is exactly what that index caches, so leaving it in place
 * hands the next reader a name->offset map pointing at other PAX's rows. That is not a stale-read
 * nuisance: identify returns the wrong row's f3Name (a cross-PAX identity leak) and
 * handleCheckinSubmit_ writes at rowIndex+4, landing one PAX's check-in on another's row.
 * Invalidation must live HERE rather than at the call sites because every caller
 * (signupWebapp.js's save, WebApp.js's admin `sortTracker`/`renameTeam`) has the same
 * exposure — and the signup path in particular patches the index moments before calling this,
 * so a call-site fix is easy to write in the wrong order. Programmatic sorts never fire onEdit,
 * so TrackerEditTrigger.js's invalidation does not cover this.
 *
 * Only the index is dropped, not the per-PAX row cache: a sort moves rows without changing their
 * contents, and those entries are keyed by name, so they stay valid. The next read pays one
 * name-column scan to rebuild.
 * @param {Sheet} trackerSheet
 */
function sortTrackerSheet_(trackerSheet) {
  var lastRow = trackerSheet.getLastRow();
  if (lastRow < 4) return;
  var lastColumn = trackerSheet.getLastColumn();
  trackerSheet.getRange(4, 1, lastRow - 3, lastColumn)
    .sort([{ column: 2, ascending: true }, { column: 1, ascending: true }]);
  invalidateTrackerRosterIndexAfterSort_ars_(trackerSheet);
}

/**
 * Best-effort PaxCache roster-index drop for the spreadsheet owning `trackerSheet`. Tolerates a
 * sheet mock with no getParent() and an unwired PaxCache (both are normal under test) — a sort
 * must never fail because a cache could not be invalidated, but see the callers' note: a silent
 * skip here restores the F3Go30-a2hq defect, so it is logged.
 */
function invalidateTrackerRosterIndexAfterSort_ars_(trackerSheet) {
  try {
    if (!deletePaxRosterIndex_ars_ || !trackerSheet || typeof trackerSheet.getParent !== 'function') return;
    var parent = trackerSheet.getParent();
    if (!parent || typeof parent.getId !== 'function') return;
    var sheetId = parent.getId();
    if (!sheetId) return;
    deletePaxRosterIndex_ars_('tracker', sheetId);
    invalidateFullRosterCachesForSheet_ars_(sheetId);
  } catch (e) {
    if (typeof GasLogger !== 'undefined' && GasLogger && GasLogger.log) {
      GasLogger.log('sortTrackerSheet_.rosterIndexInvalidateFailed', { error: e.message });
    }
  }
}

function formatRegistrationMonth_(startDate) {
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) return '';
  return REGISTRATION_MONTH_NAMES_[startDate.getMonth()] + ' ' + startDate.getFullYear();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sortTrackerSheet_,
    formatRegistrationMonth_
  };
}
