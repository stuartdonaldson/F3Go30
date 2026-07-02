/*
 * bonusWebapp.js
 *
 * Backend for the Bonus Tracker section of the check-in web app — not a separate ?cmd= route.
 * dashboardWebapp.js's handleCheckinPost_ dispatches its bonusList/bonusAdd/bonusEdit actions
 * here, reusing the identity already established on ?cmd=checkin (same F3-Name-only match as
 * the daily check-in flow, not signup's stricter name+email match — see dashboardWebapp.js's
 * resolveCheckinIdentityLean_).
 *
 * Bonus Tracker column layout (docs/sheet-reference.md §Bonus Tracker) — header row 1, data
 * starts row 2. Everything here reads/writes only the PAX-entered columns; B–E are a single
 * spilled array formula anchored at row 2 that auto-fills every row below it and must never be
 * overwritten by this module:
 *   A Name | B Period(formula) | C Uncapped Points(formula) | D Multiplier(formula)
 *   | E Complete(formula) | F Type | G When | H What/Where/Who | I Slack Link
 *
 * BONUS_TYPE_RULES_ mirrors the Controls sheet's per-type rules (multiplier, link-required).
 * The Controls sheet only exposes Multiplier/Uncapped columns — "link required" only exists
 * today as embedded logic in the Bonus Tracker's column-E Complete formula, so it has no live
 * source of truth to read programmatically. This table is a manual mirror of that formula
 * logic; if Controls' type list or link requirements ever change, update this table by hand.
 */

var BONUS_TYPE_RULES_ = {
  'EHing FNG': { multiplier: 5, requiresLink: true },
  'Fellowship': { multiplier: 1, requiresLink: false },
  'Q Point': { multiplier: 1, requiresLink: true },
  'Inspire': { multiplier: 1, requiresLink: true },
};

var BONUS_TRACKER_HEADER_ROW_ = 1;
var BONUS_TRACKER_NAME_COL_ = 1;   // A
var BONUS_TRACKER_TYPE_COL_ = 6;   // F
var BONUS_TRACKER_WHEN_COL_ = 7;   // G
var BONUS_TRACKER_WHAT_COL_ = 8;   // H
var BONUS_TRACKER_LINK_COL_ = 9;   // I
var BONUS_TRACKER_LAST_ENTERED_COL_ = 9; // I is the last PAX-entered column

var bonusWebappPaxCacheModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./PaxCache.js')
  : null;
var paxCacheNormalizeName_bw_ = (bonusWebappPaxCacheModule_ && bonusWebappPaxCacheModule_.paxCacheNormalizeName_)
  || (typeof globalThis !== 'undefined' && globalThis.paxCacheNormalizeName_);

var BONUS_LINK_PATTERN_ = /^https?:\/\/\S+$/i;

/**
 * Parses a "YYYY-MM-DD" date-only string (what an `<input type=date>` sends) as local midnight,
 * not UTC midnight — same correction dashboardWebapp.js's parseIsoDateLocal_ applies elsewhere
 * in this project. `new Date("YYYY-MM-DD")` parses as UTC, which can land on the previous
 * calendar day once written into a sheet cell and re-read in the script's own timezone.
 * @returns {Date|null} null on anything that isn't a plain YYYY-MM-DD string.
 */
function parseBonusDateLocal_(iso) {
  var parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(function(n) { return isNaN(n); })) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** Formats a Date as a local-midnight "YYYY-MM-DD" string — the inverse of parseBonusDateLocal_,
 *  used instead of toISOString() for exactly the same UTC-shift reason. */
function formatBonusDateLocal_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Validates a bonus entry payload ({type, whenIso, message, link}) against BONUS_TYPE_RULES_.
 * Pure — no Sheet access — so it's the single gate both the client (for instant feedback) and
 * the server (the real gate — never trust the client's own validation) can share the same rules
 * against, without duplicating the link-required table in two places.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function validateBonusEntry_(payload) {
  var p = payload || {};
  var rules = BONUS_TYPE_RULES_[p.type];
  if (!rules) return { ok: false, error: 'invalid_type' };

  var when = parseBonusDateLocal_(p.whenIso);
  if (!when || isNaN(when.getTime())) return { ok: false, error: 'invalid_when' };

  if (!String(p.message || '').trim()) return { ok: false, error: 'message_required' };

  if (rules.requiresLink) {
    var link = String(p.link || '').trim();
    if (!link) return { ok: false, error: 'link_required' };
    if (!BONUS_LINK_PATTERN_.test(link)) return { ok: false, error: 'invalid_link' };
  }

  return { ok: true };
}

/** Dates aren't JSON-safe — same convention as PaxCache.js's paxCacheSerializeRow_. */
function formatBonusRowForClient_(rowValues, rowIndex) {
  var row = rowValues || [];
  var when = row[6]; // G, zero-based index 6
  return {
    rowIndex: rowIndex,
    type: row[5] || '',   // F
    whenIso: when instanceof Date ? formatBonusDateLocal_(when) : (when || null),
    message: row[7] || '', // H
    link: row[8] || '',    // I
    complete: !!row[4],    // E
  };
}

/**
 * Reads Bonus Tracker's full A:I range and returns this PAX's own entries only — a PAX can
 * never list or edit another PAX's rows. No PaxCache here: Bonus Tracker is small relative to
 * Tracker/Responses, and this reads once per bonus-section open, not per lookup.
 * @returns {Array<Object>} formatted via formatBonusRowForClient_, in sheet order.
 */
function listBonusEntriesForPax_(bonusSheet, f3Name) {
  var norm = paxCacheNormalizeName_bw_(f3Name);
  var lastRow = bonusSheet.getLastRow();
  if (!norm || lastRow < 2) return [];

  var values = bonusSheet.getRange(2, 1, lastRow - 1, BONUS_TRACKER_LAST_ENTERED_COL_).getValues();
  var entries = [];
  values.forEach(function(row, idx) {
    if (paxCacheNormalizeName_bw_(row[0]) === norm) {
      entries.push(formatBonusRowForClient_(row, idx + 2)); // +2: 1-based, header row offset
    }
  });
  return entries;
}

/**
 * Finds the first unused Bonus Tracker row (blank Name in column A) within the sheet's actual
 * row count. Bonus Tracker is pre-formatted with one spilled array formula in B2:E2 that
 * auto-fills every row down to the sheet's last physical row (see docs/sheet-reference.md
 * §Bonus Tracker) — that formatting makes bonusSheet.getLastRow() report the sheet's full
 * pre-formatted extent even when no PAX has entered anything yet, so it cannot be used to find
 * an append point: treating it as "already full of data" would compute a next row one past the
 * sheet's actual row count and getRange() would throw ("coordinates ... outside the dimensions
 * of the sheet") — see F3Go30-yj53. Scanning column A directly for the first blank cell is the
 * only reliable way to find where to write.
 * @returns {number|null} 1-based row index, or null if every pre-formatted row is already used.
 */
function findNextBonusRow_(bonusSheet) {
  var maxRows = bonusSheet.getMaxRows();
  if (maxRows < 2) return null;
  var names = bonusSheet.getRange(2, BONUS_TRACKER_NAME_COL_, maxRows - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) {
    if (!names[i][0]) return i + 2; // +2: 1-based, header row offset
  }
  return null;
}

/**
 * Appends a new Bonus Tracker row for f3Name into the first unused pre-formatted row. B:E
 * (Period/Uncapped Points/Multiplier/Complete) need no writing here — they're a single spilled
 * array formula anchored at B2 that recalculates automatically as soon as this row's
 * PAX-entered columns are filled in.
 * @returns {{ok:true, rowIndex:number}|{ok:false, error:string}}
 */
function addBonusEntry_(bonusSheet, f3Name, payload) {
  var validation = validateBonusEntry_(payload);
  if (!validation.ok) return validation;

  var nextRow = findNextBonusRow_(bonusSheet);
  if (!nextRow) return { ok: false, error: 'bonus_sheet_full' };

  writeBonusEnteredColumns_(bonusSheet, nextRow, f3Name, payload);
  return { ok: true, rowIndex: nextRow };
}

/**
 * Overwrites an existing Bonus Tracker row's entered columns in place. Refuses to touch a row
 * whose current Name doesn't match the identified PAX — guards a stale rowIndex the client held
 * onto across a row shift (another PAX's add/delete), and prevents editing someone else's entry.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function editBonusEntry_(bonusSheet, f3Name, rowIndex, payload) {
  var validation = validateBonusEntry_(payload);
  if (!validation.ok) return validation;

  if (!rowIndex || rowIndex < 2 || rowIndex > bonusSheet.getMaxRows()) {
    return { ok: false, error: 'not_found' };
  }
  var currentName = bonusSheet.getRange(rowIndex, BONUS_TRACKER_NAME_COL_).getValue();
  if (paxCacheNormalizeName_bw_(currentName) !== paxCacheNormalizeName_bw_(f3Name)) {
    return { ok: false, error: 'not_your_entry' };
  }

  writeBonusEnteredColumns_(bonusSheet, rowIndex, f3Name, payload);
  return { ok: true };
}

function writeBonusEnteredColumns_(bonusSheet, row, f3Name, payload) {
  bonusSheet.getRange(row, BONUS_TRACKER_NAME_COL_).setValue(f3Name);
  bonusSheet.getRange(row, BONUS_TRACKER_TYPE_COL_).setValue(payload.type);
  bonusSheet.getRange(row, BONUS_TRACKER_WHEN_COL_).setValue(parseBonusDateLocal_(payload.whenIso));
  bonusSheet.getRange(row, BONUS_TRACKER_WHAT_COL_).setValue(String(payload.message || '').trim());
  bonusSheet.getRange(row, BONUS_TRACKER_LINK_COL_).setValue(String(payload.link || '').trim());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BONUS_TYPE_RULES_: BONUS_TYPE_RULES_,
    validateBonusEntry_: validateBonusEntry_,
    formatBonusRowForClient_: formatBonusRowForClient_,
    listBonusEntriesForPax_: listBonusEntriesForPax_,
    findNextBonusRow_: findNextBonusRow_,
    addBonusEntry_: addBonusEntry_,
    editBonusEntry_: editBonusEntry_,
  };
}
