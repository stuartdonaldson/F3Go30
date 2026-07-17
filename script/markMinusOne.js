function setupDailyMinusOneTrigger() {
  clearDailyMinusOne();
  
  // Create a new daily trigger for markEmptyCellsAsMinusOne
  ScriptApp.newTrigger('markEmptyCellsAsMinusOne')
    .timeBased()
    .everyDays(1) // Set to trigger daily
    .inTimezone(Session.getScriptTimeZone()) // Use the correct method to get the script's time zone
    .atHour(1) // Specify the hour (1 AM)
    .nearMinute(0) // You can use this to specify the minute, but it's not precise in the hour range
    .create();
}

function clearDailyMinusOne() {
    // First, delete existing triggers for the function to avoid duplicates
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === 'markEmptyCellsAsMinusOne') {
      ScriptApp.deleteTrigger(existingTriggers[i]);
    }
  }
}
/**
 * Daily −1 marking entry point. Resolves the TrackerDB row active for contextDate
 * (default: today) and runs the marking logic against that tracker's own spreadsheet —
 * never the active/bound spreadsheet (ADR-010). Lookup failures (zero or ambiguous
 * TrackerDB matches) propagate as a thrown/logged error rather than silently no-op'ing.
 * @param {Date|string=} contextDate Defaults to now.
 */
function markEmptyCellsAsMinusOne(contextDate) {
  return GasLogger.run('markEmptyCellsAsMinusOne', function() {
    return markEmptyCellsAsMinusOne_(contextDate);
  });
}

function markEmptyCellsAsMinusOne_(contextDate) {
  // Marking happens on (contextDate - 2 days), not today — must dispatch on that date, or a
  // run on the 1st/2nd of a month resolves to the brand-new (wrong) tracker instead of the
  // one that actually has that day's column (month-boundary dispatch bug).
  // Guard against GAS trigger event objects: time-based triggers pass a TriggerEvent as the
  // first arg (truthy non-Date), so `new Date(contextDate)` would produce an Invalid Date.
  var today = contextDate instanceof Date ? contextDate
    : new Date(typeof contextDate === 'string' || typeof contextDate === 'number' ? contextDate : Date.now());
  var thresholdDate = new Date(today);
  thresholdDate.setDate(thresholdDate.getDate() - 2);

  var trackerRow = resolveTrackerForContextDate(thresholdDate);
  GasLogger.log('markEmptyCellsAsMinusOne.dispatch', { contextDate: today.toISOString(), targetDate: thresholdDate.toISOString(), sheetId: trackerRow.sheetId });
  var spreadsheet = SpreadsheetApp.openById(trackerRow.sheetId);
  var markedCount = applyMinusOneToTrackerSheet_(spreadsheet, today);
  refreshPaxDbForTracker_(spreadsheet, trackerRow.sheetId, trackerRow.startDate);
  // The check-in webapp can hold BOTH the current-month and prior-month tracker cached at
  // once (getPriorMonthTailValues_, dashboardWebapp.js), so a nightly refresh must cover both
  // regardless of which single tracker markEmptyCellsAsMinusOne_ actually marked — on a month
  // boundary the marked tracker IS the prior month, and reloading both still covers the
  // current-month cache the webapp is actively serving.
  refreshPaxCacheForCurrentAndPriorMonths_(today);
  return markedCount;
}

/**
 * Repopulates PaxCache's per-PAX tracker rows + roster index, plus the CacheService full-roster
 * blob (trackerValuesCacheKey_), for one tracker sheet from a fresh full-range read — the same
 * bulk-write shape resolveCheckinIdentityFull_ uses on a cold-cache live read
 * (dashboardWebapp.js), so the cache is left warm and verified rather than merely cleared.
 * Falls back to a full wipe (wipePaxCacheAndRelatedCachesForSheet_, PaxCache.js) when the
 * bulk-write helpers aren't loaded (this file's own unit tests) or anything about the read/write
 * fails, so correctness never depends on the repopulate path being wired.
 * @param {string} sheetId
 */
function refreshPaxCacheForSheet_(sheetId) {
  try {
    var spreadsheet = SpreadsheetApp.openById(sheetId);
    var trackerSheet = spreadsheet.getSheetByName('Tracker');
    if (!trackerSheet || trackerSheet.getLastRow() < 4) return;

    var lastRow = trackerSheet.getLastRow();
    var lastCol = trackerSheet.getLastColumn();
    var trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();

    if (typeof setPaxCacheRowsBulk_ === 'function' && typeof paxCacheNormalizeName_ === 'function') {
      var rosterIndex = {};
      var rowsByName = {};
      trackerValues.forEach(function(row, idx) {
        var name = row[0]; // column A — same TRACKER_NAME_COL_ convention as dashboardWebapp.js
        var norm = paxCacheNormalizeName_(name);
        if (!norm) return;
        if (!Object.prototype.hasOwnProperty.call(rosterIndex, norm)) rosterIndex[norm] = idx;
        rowsByName[name] = row;
      });
      setPaxCacheRowsBulk_('tracker', sheetId, rowsByName, rosterIndex);
      if (typeof setCachedSheetValues_ === 'function' && typeof trackerValuesCacheKey_ === 'function') {
        setCachedSheetValues_(trackerValuesCacheKey_(sheetId), trackerValues);
      }
    } else if (typeof wipePaxCacheAndRelatedCachesForSheet_ === 'function') {
      wipePaxCacheAndRelatedCachesForSheet_(sheetId);
    }
  } catch (e) {
    GasLogger.log('markEmptyCellsAsMinusOne.paxCacheRefreshFailed', { sheetId: sheetId, error: e.message });
    if (typeof wipePaxCacheAndRelatedCachesForSheet_ === 'function') wipePaxCacheAndRelatedCachesForSheet_(sheetId);
  }
}

/**
 * Resolves the current-month and prior-month TrackerDB rows relative to `today` and refreshes
 * PaxCache for each (F3Go30-o39s.3) — both, not just whichever single tracker
 * markEmptyCellsAsMinusOne_ marked, since the webapp can be serving either from cache at any
 * time. A month with no tracker yet (e.g. early in a new month before auto-generate) is skipped
 * cleanly — resolveTrackerForContextDate's "no row matches" throw is caught per-month rather
 * than aborting the whole refresh.
 * @param {Date} today
 */
function refreshPaxCacheForCurrentAndPriorMonths_(today) {
  var sheetIds = {};

  try {
    var currentTracker = resolveTrackerForContextDate(today);
    if (currentTracker && currentTracker.sheetId) sheetIds[currentTracker.sheetId] = true;
  } catch (e) {
    GasLogger.log('markEmptyCellsAsMinusOne.currentMonthTrackerNotFound', { error: e.message });
  }

  try {
    // Day 0 of today's month == the last day of the PRIOR month, regardless of today's
    // day-of-month — a reliable way to land resolveTrackerForContextDate in the prior tracker.
    var priorMonthDate = new Date(today.getFullYear(), today.getMonth(), 0);
    var priorTracker = resolveTrackerForContextDate(priorMonthDate);
    if (priorTracker && priorTracker.sheetId) sheetIds[priorTracker.sheetId] = true;
  } catch (e) {
    GasLogger.log('markEmptyCellsAsMinusOne.priorMonthTrackerNotFound', { error: e.message });
  }

  Object.keys(sheetIds).forEach(function(sheetId) {
    refreshPaxCacheForSheet_(sheetId);
  });
}

/**
 * Marks empty, non-formula cells as -1 in the given spreadsheet's Tracker sheet, for the
 * column matching (contextDate - 2 days). Rows with no F3 Name (column A) are left alone.
 * @param {Spreadsheet} spreadsheet Target tracker spreadsheet, resolved via TrackerDB.
 * @param {Date|string=} contextDate Defaults to now.
 */
function applyMinusOneToTrackerSheet_(spreadsheet, contextDate) {
  var sheetName = "Tracker";
  var sheet = spreadsheet.getSheetByName(sheetName);
  var markedCount = 0;

  if (sheet) {
    var currentDate = contextDate instanceof Date ? contextDate
      : new Date(typeof contextDate === 'string' || typeof contextDate === 'number' ? contextDate : Date.now());

    // Calculate the date for thresholdday - Day before yesterday.
    var thresholdday = new Date(currentDate);
    thresholdday.setDate(thresholdday.getDate() - 2);
    var thresholddayString = Utilities.formatDate(thresholdday, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");

    // Find the column index with thresholdday's date
    var lastColumnIndex = sheet.getLastColumn();
    var thresholddayColumnIndex = -1;

    var row3Values = sheet.getRange(3, 1, 1, lastColumnIndex).getValues()[0];
    for (var i = 0; i < row3Values.length; i++) {
      var cellValue = row3Values[i];
      if (cellValue instanceof Date) {
        var cellDateString = Utilities.formatDate(cellValue, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");
        if (cellDateString === thresholddayString) {
          thresholddayColumnIndex = i + 1; // convert 0-based array index to 1-based column number
          break;
        }
      }
    }

    if (thresholddayColumnIndex <= 0) {
      GasLogger.log('markEmptyCellsAsMinusOne.thresholdColumnNotFound', { spreadsheetId: spreadsheet.getId(), thresholdDay: thresholddayString });
      return markedCount;
    }

    var dataRange = sheet.getRange(4, thresholddayColumnIndex, sheet.getLastRow() - 3, 1);
    var values = dataRange.getValues();
    var formulas = dataRange.getFormulas();

    // Iterate through the data in thresholdday's column and mark empty cells as -1 for rows with F3 Name
    // Skip formula cells — they may evaluate to '' for future dates but must not be overwritten
    var columnAValues = sheet.getRange(4, 1, values.length, 1).getValues();
    for (var j = 0; j < values.length; j++) {
      if (values[j][0] === '' && formulas[j][0] === '' && columnAValues[j][0] !== '') {
        values[j][0] = -1;
        markedCount++;
      }
    }

    if (markedCount > 0) {
      dataRange.setValues(values);
      // PaxCache (per-PAX rows + roster index) and the CacheService full-roster blob for this
      // sheet — plus the prior month's, since the webapp can be serving either from cache — are
      // refreshed by the dispatcher (markEmptyCellsAsMinusOne_'s refreshPaxCacheForCurrentAndPriorMonths_
      // call, F3Go30-o39s.3), not here: that needs a full-range read this function doesn't hold
      // in memory (only column A + the single threshold-day column).
    }

    GasLogger.log('markEmptyCellsAsMinusOne.complete', { spreadsheetId: spreadsheet.getId(), thresholdDay: thresholddayString, cellsMarked: markedCount });
  }

  return markedCount;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    markEmptyCellsAsMinusOne_: markEmptyCellsAsMinusOne_,
    applyMinusOneToTrackerSheet_: applyMinusOneToTrackerSheet_,
    refreshPaxCacheForSheet_: refreshPaxCacheForSheet_,
    refreshPaxCacheForCurrentAndPriorMonths_: refreshPaxCacheForCurrentAndPriorMonths_
  };
}
