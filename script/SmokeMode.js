/*
 * SmokeMode.js
 *
 * Single seam for "what is the smoke tracker." Every other file asks this module for the
 * smoke tracker's identity rather than reading the SMOKE_MODE/SMOKE_TRACKER_ID Script
 * Properties directly — so if the smoke strategy ever changes (e.g. an isolated smoke
 * Template with its own TrackerDB instead of a same-project row — see F3Go30-31w5), only
 * this file's two functions need to change, not every TrackerDB-resolution call site that
 * currently has to know how to exclude or select the smoke tracker.
 *
 * Deliberately just identity lookups (a boolean and a sheetId) — no row-filtering or
 * row-selection logic lives here. Callers combine these plain values with their own
 * (already pure, already unit-tested) row-matching logic, the same way they already take an
 * explicit `today`/`contextDate` parameter rather than reading `new Date()` internally. That
 * keeps this module GAS-only (PropertiesService) while the resolution logic it feeds stays
 * plain-data and testable without mocking Script Properties.
 */

function smokeModeActive_() {
  return PropertiesService.getScriptProperties().getProperty('SMOKE_MODE') === 'true';
}

/** @returns {string|null} The active smoke tracker's sheetId, or null if none is set. */
function getSmokeTrackerId_() {
  return PropertiesService.getScriptProperties().getProperty('SMOKE_TRACKER_ID') || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    smokeModeActive_: smokeModeActive_,
    getSmokeTrackerId_: getSmokeTrackerId_,
  };
}
