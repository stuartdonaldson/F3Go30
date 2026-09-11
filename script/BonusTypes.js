/*
 * BonusTypes.js
 *
 * Single source of truth for bonus-type rules and the weekly-cap arithmetic they're checked
 * against. Before this module existed, the same per-type facts were duplicated across three
 * places that all had to be updated in lockstep to add a type: bonusWebapp.js's
 * BONUS_TYPE_RULES_ (multiplier/requiresLink, for validation and the client payload),
 * dashboardWebapp.js's BONUS_TYPE_KEY_BY_NAME_ (pill short-code) and BONUS_CAPPED_TYPES_ (which
 * types are weekly-capped) — plus a hardcoded {fe:0,q:0,ins:0,eh:0} default pills shape.
 * bonusWebapp.js and dashboardWebapp.js both now read through BONUS_TYPE_DEFS_ below; adding a
 * bonus type is a single new entry here.
 *
 * The multiplier actually applied on the live spreadsheet is driven by the Controls sheet's
 * UBonus_Multiplier named range (see CreateNewTracker.js's setBonusColumn) — BONUS_TYPE_DEFS_'s
 * multiplier is this code's own mirror of that value, used for client-side display and the
 * dashboard's pill/score-breakdown math, not the sheet formula itself.
 */

/**
 * @typedef {Object} BonusTypeDef
 * @property {string} name Exact "Type" string as entered in the Bonus Tracker sheet.
 * @property {string} pillKey Short code used in dashboard pill/score-breakdown objects.
 * @property {string} label Short display text for the pill chip (static-pages/src/index.html) — distinct
 *   from pillKey, which also doubles as an object key and CSS class name.
 * @property {number} multiplier Points awarded per counted entry.
 * @property {boolean} requiresLink Whether a Slack link is required for the entry to be "Complete".
 * @property {boolean} weeklyCap Whether this type counts at most once per Sun-Sat period,
 *   regardless of how many complete entries land in it.
 */

/** @type {Array<BonusTypeDef>} Add a new bonus type by adding one entry here — every consumer
 *  (validation, client rules payload, pill/score computation, default pill shape, static-pages/src/index.html's
 *  pill chips) derives from this list. The one thing that still needs a manual touch is the new
 *  pillKey's CSS color (static-pages/src/index.html's .bonus-type-code.<pillKey> rule) — chip color isn't a
 *  fact this registry can express, so it stays a by-hand style choice. */
var BONUS_TYPE_DEFS_ = [
  { name: 'Fellowship', pillKey: 'fe', label: 'FE', multiplier: 1, requiresLink: false, weeklyCap: true },
  { name: 'Q Point', pillKey: 'q', label: 'Q', multiplier: 1, requiresLink: true, weeklyCap: true },
  { name: 'Inspire', pillKey: 'ins', label: 'Ins', multiplier: 1, requiresLink: true, weeklyCap: true },
  { name: 'EHing FNG', pillKey: 'eh', label: 'EH', multiplier: 5, requiresLink: true, weeklyCap: false },
];

var BONUS_TYPE_DEFS_BY_NAME_ = BONUS_TYPE_DEFS_.reduce(function(map, def) {
  map[def.name] = def;
  return map;
}, {});

/** @returns {BonusTypeDef|null} */
function bonusTypeDef_(name) {
  return BONUS_TYPE_DEFS_BY_NAME_[name] || null;
}

/** @returns {Array<string>} Every registered bonus type's exact "Type" name. */
function bonusTypeNames_() {
  return BONUS_TYPE_DEFS_.map(function(def) { return def.name; });
}

function bonusTypeRequiresLink_(name) {
  var def = bonusTypeDef_(name);
  return !!(def && def.requiresLink);
}

function bonusTypeMultiplier_(name) {
  var def = bonusTypeDef_(name);
  return def ? def.multiplier : 0;
}

function bonusTypeIsWeeklyCapped_(name) {
  var def = bonusTypeDef_(name);
  return !!(def && def.weeklyCap);
}

function bonusTypePillKey_(name) {
  var def = bonusTypeDef_(name);
  return def ? def.pillKey : null;
}

/**
 * {typeName: {multiplier, requiresLink}} — the shape the check-in client's BONUS_TYPE_RULES_ has
 * always been sent as (the dashboard/monthGrid JSON payload's bonusTypeRules/bonusTypes field,
 * static-pages/src/index.html), kept identical here so the client needs no changes.
 * @returns {Object<string,{multiplier:number,requiresLink:boolean}>}
 */
function bonusTypeClientRules_() {
  var out = {};
  BONUS_TYPE_DEFS_.forEach(function(def) {
    out[def.name] = { multiplier: def.multiplier, requiresLink: def.requiresLink };
  });
  return out;
}

/**
 * {key, label} per registered type, in registry order — static-pages/src/index.html's self-tile/board-tile
 * pill chips render from this instead of a hardcoded local mirror of pillKey+label+order.
 * @returns {Array<{key:string,label:string}>}
 */
function bonusTypeDisplayList_() {
  return BONUS_TYPE_DEFS_.map(function(def) { return { key: def.pillKey, label: def.label }; });
}

/**
 * Zero-initialized pill totals, one key per registered type's pillKey — computeBonusPillsAsOf_'s
 * starting point and buildDashboardPaxRow_'s (dashboardWebapp.js) default bonusByType, generated
 * from the registry instead of a hardcoded {fe:0,q:0,ins:0,eh:0} literal so a new type needs no
 * edits at either call site.
 * @returns {Object<string,number>}
 */
function emptyBonusPills_() {
  var pills = {};
  BONUS_TYPE_DEFS_.forEach(function(def) { pills[def.pillKey] = 0; });
  return pills;
}

/**
 * Sun-Sat week-of-month number (1-based), matching the spreadsheet's Periods sheet formula
 * `WEEKNUM(date,1) - WEEKNUM(DATE(YEAR(date),MONTH(date),1),1) + 1` without an ISO-week
 * dependency: day-of-month (0-based) plus the 1st's weekday, bucketed into 7s. A month starting
 * mid-week naturally gets a short first period (start of month through the first Saturday); a
 * month ending mid-week naturally gets a short last period (last Sunday through end of month) —
 * both fall out of this arithmetic without separate boundary-clamping.
 * @param {Date} date
 * @param {Date} monthStart First-of-month date for the tracker date belongs to.
 * @returns {number} 1-based period number.
 */
function weekOfMonth_(date, monthStart) {
  var firstWeekday = monthStart.getDay(); // 0 = Sunday
  var dayOffset = date.getDate() - 1 + firstWeekday;
  return Math.floor(dayOffset / 7) + 1;
}

/**
 * Per-type bonus pill totals for one PAX, as of asOfDate — entries dated after asOfDate are
 * excluded entirely (this is what makes the dashboard's bonus pills accurate when the date-nav
 * arrows are scrubbed to a day before a bonus was logged). Weekly-capped types (BonusTypeDef's
 * weeklyCap) contribute at most one multiplier's worth per Sun-Sat period regardless of how many
 * complete entries land in it; uncapped types (e.g. EHing FNG) don't.
 * @param {Array<{nameNorm:string, date:Date, type:string, complete:boolean}>} entries Every
 *   PAX's Bonus Tracker rows for the tracker's month (see bonusWebapp.js's
 *   readAllBonusEntries_/getAllBonusEntriesCached_).
 * @param {string} f3NameNorm Already-normalized name (paxCacheNormalizeName_) to match.
 * @param {Date} asOfDate
 * @param {Date} monthStart
 * @returns {Object<string,number>} Keyed by pillKey — see emptyBonusPills_.
 */
function computeBonusPillsAsOf_(entries, f3NameNorm, asOfDate, monthStart) {
  var pills = emptyBonusPills_();
  var periodCredited = {};
  (entries || []).forEach(function(entry) {
    if (entry.nameNorm !== f3NameNorm || !entry.complete || entry.date > asOfDate) return;
    var def = bonusTypeDef_(entry.type);
    if (!def) return;
    if (def.weeklyCap) {
      var period = weekOfMonth_(entry.date, monthStart);
      var key = def.name + ':' + period;
      if (periodCredited[key]) return; // already credited this period
      periodCredited[key] = true;
    }
    pills[def.pillKey] += def.multiplier;
  });
  return pills;
}

/**
 * Buckets a month's bonus entries by nameNorm once, so the dashboard's roster loop can hand
 * computeBonusSeriesForPax_ just this PAX's rows instead of re-filtering the whole month's array
 * per PAX per day (F3Go30-ja7d — the name filter was ~97% of the old series cost). Built once per
 * dashboard load, immediately before the roster loop.
 *
 * Null-prototype map, so a nameNorm that happens to spell `__proto__`/`constructor` is an ordinary
 * key rather than a prototype write. Entry order within a bucket is the source array's order,
 * which is what computeBonusPillsAsOf_'s weekly-cap tie-break already relies on.
 * @param {Array<{nameNorm:string}>} entries See computeBonusPillsAsOf_.
 * @returns {Object<string, Array<Object>>} Keyed by nameNorm; missing key means no entries.
 */
function groupBonusEntriesByPax_(entries) {
  var byPax = Object.create(null);
  (entries || []).forEach(function(entry) {
    if (!entry) return;
    var key = entry.nameNorm;
    if (!byPax[key]) byPax[key] = [];
    byPax[key].push(entry);
  });
  return byPax;
}

/**
 * Smallest index in an ascending date array at which `date` is no longer in the future — i.e. the
 * first day column whose computeBonusPillsAsOf_ would stop excluding an entry dated `date` via its
 * `entry.date > asOfDate` test. -1 when the date is past every column (entry never appears).
 * Binary search; `date > days[mid]` is monotone across an ascending array, and a missing/invalid
 * date compares false throughout, landing at index 0 — the same "counted from the first day"
 * behaviour the linear scan had.
 * @param {Array<Date>} ascendingDays
 * @param {Date} date
 * @returns {number}
 */
function firstDayIndexIncluding_(ascendingDays, date) {
  var lo = 0;
  var hi = ascendingDays.length - 1;
  var found = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (date > ascendingDays[mid]) lo = mid + 1;
    else { found = mid; hi = mid - 1; }
  }
  return found;
}

/**
 * One computeBonusPillsAsOf_-equivalent result per date in dayDates, aligned 1:1 — lets the client
 * scrub the date-nav arrows locally against a per-day series, the same pattern already used for
 * dayValues/daySegments, instead of re-deriving pill totals with a server round trip per day.
 *
 * Forward sweep (F3Go30-ja7d): each entry is placed at the one day column where it first counts,
 * then the pill totals and the weekly-cap ledger accumulate across days — O(paxEntries·log days +
 * days) instead of the old O(days × allEntries) rebuild. Output is identical to the per-day
 * computeBonusPillsAsOf_ it replaces: as-of totals depend only on *which* (type, period) pairs
 * have at least one complete entry dated on or before the day, not on which entry of a shared
 * period got credited, and every entry of a shared period carries the same multiplier.
 * computeBonusPillsAsOf_ itself is unchanged, for its single-point callers.
 *
 * Emits a fresh pills object per day (never a shared reference), same as before.
 * @param {Array<Object>} paxEntries This PAX's entries only — see groupBonusEntriesByPax_.
 * @param {Array<Date>} dayDates Calendar dates for this month's day columns, normally ascending.
 * @param {Date} monthStart
 * @returns {Array<Object<string,number>>}
 */
function computeBonusSeriesForPax_(paxEntries, dayDates, monthStart) {
  if (arguments.length > 3) {
    // Loud rather than silent: the old (entries, f3NameNorm, dayDates, monthStart) signature would
    // otherwise read f3NameNorm as dayDates and quietly return an empty series.
    throw new Error('computeBonusSeriesForPax_ takes (paxEntries, dayDates, monthStart) — bucket with groupBonusEntriesByPax_ first');
  }
  var days = dayDates || [];
  if (!days.length) return [];

  // The sweep needs ascending days. Day columns already arrive in calendar order; an out-of-order
  // caller is swept in date order and written back to its own positions rather than mis-summed.
  var order = null;
  for (var k = 1; k < days.length; k++) {
    if (days[k] < days[k - 1]) {
      order = days.map(function(_, i) { return i; })
        .sort(function(a, b) { return days[a] - days[b]; });
      break;
    }
  }
  var ascending = order ? order.map(function(i) { return days[i]; }) : days;

  var arrivals = new Array(ascending.length);
  (paxEntries || []).forEach(function(entry) {
    if (!entry || !entry.complete) return;
    var at = firstDayIndexIncluding_(ascending, entry.date);
    if (at < 0) return; // dated after every reported day column
    if (!arrivals[at]) arrivals[at] = [];
    arrivals[at].push(entry);
  });

  var pills = emptyBonusPills_();
  var periodCredited = {};
  var series = new Array(days.length);
  for (var i = 0; i < ascending.length; i++) {
    (arrivals[i] || []).forEach(function(entry) {
      var def = bonusTypeDef_(entry.type);
      if (!def) return;
      if (def.weeklyCap) {
        var key = def.name + ':' + weekOfMonth_(entry.date, monthStart);
        if (periodCredited[key]) return; // already credited this period
        periodCredited[key] = true;
      }
      pills[def.pillKey] += def.multiplier;
    });
    series[order ? order[i] : i] = Object.assign({}, pills);
  }
  return series;
}

/**
 * Marks each of one PAX's Bonus Tracker entries with whether it actually counts toward score,
 * mirroring computeBonusPillsAsOf_'s per-period cap so the bonus-list UI can tell a PAX "this
 * one's extra" without duplicating the cap logic. Entries are annotated in the order given —
 * listBonusEntriesForPax_ (bonusWebapp.js) returns sheet order, so the earliest-entered row wins
 * a shared period, same tie-break computeBonusPillsAsOf_ uses.
 * @param {Array<Object>} entries listBonusEntriesForPax_ shape (rowIndex/type/whenIso/message/link/complete).
 * @param {Date} monthStart
 * @returns {Array<Object>} same entries, each with an added `counts` boolean (only meaningful
 *   when entry.complete — an incomplete entry doesn't count regardless of `counts`).
 */
function annotateBonusEntryCountStatus_(entries, monthStart) {
  var periodCredited = {};
  return (entries || []).map(function(entry) {
    var counts = true;
    var def = bonusTypeDef_(entry.type);
    if (entry.complete && def && def.weeklyCap) {
      var when = parseIsoDateLocal_bt_(entry.whenIso);
      if (when && !isNaN(when.getTime())) {
        var key = def.name + ':' + weekOfMonth_(when, monthStart);
        if (periodCredited[key]) counts = false;
        else periodCredited[key] = true;
      }
    }
    return Object.assign({}, entry, { counts: counts });
  });
}

/**
 * Marks each of one PAX's Bonus Tracker entries with whether its Slack Link duplicates an
 * earlier entry's link within the same Sun-Sat period + type (F3Go30-6faz.1) — mirrors the
 * sheet's own `=UNIQUE('Bonus Tracker'!A:F)` dedup (bonusWebapp.js's header comment: Uncapped
 * Points echoes the Slack Link for uncapped types, so a reused link collapses two rows into one
 * counted entry there) so the bonus-list UI can give a PAX the same "this one's extra" signal
 * annotateBonusEntryCountStatus_ gives for a weekly-cap repeat, but for a duplicated link
 * instead. Detection only, same as that function — never changes what counts; see this file's
 * header and F3Go30-fkox for why the sheet's dedup itself is intentional and untouched here.
 * Entries with no link, or an unparseable date, are never flagged (nothing to compare against).
 * Applies to every type, not just weekly-capped ones — a duplicate link is silently dropped by
 * the sheet's dedup even for an uncapped type like EHing FNG.
 * @param {Array<Object>} entries listBonusEntriesForPax_ shape (rowIndex/type/whenIso/message/link/complete).
 * @param {Date} monthStart
 * @returns {Array<Object>} same entries, each with an added `duplicateLink` boolean (only
 *   meaningful when entry.complete, same convention as `counts`).
 */
function annotateBonusEntryDuplicateLinkStatus_(entries, monthStart) {
  var seenByKey = {};
  return (entries || []).map(function(entry) {
    var link = String(entry.link || '').trim();
    var duplicateLink = false;
    if (link) {
      var when = parseIsoDateLocal_bt_(entry.whenIso);
      if (when && !isNaN(when.getTime())) {
        var key = entry.type + ':' + weekOfMonth_(when, monthStart) + ':' + link.toLowerCase();
        if (seenByKey[key]) duplicateLink = true;
        else seenByKey[key] = true;
      }
    }
    return Object.assign({}, entry, { duplicateLink: duplicateLink });
  });
}

/** Parses a "YYYY-MM-DD" date-only string as local midnight, not UTC midnight — same correction
 *  bonusWebapp.js's parseBonusDateLocal_/dashboardWebapp.js's parseIsoDateLocal_ apply elsewhere;
 *  duplicated locally (rather than required) to keep this module dependency-free. */
function parseIsoDateLocal_bt_(iso) {
  var parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(function(n) { return isNaN(n); })) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BONUS_TYPE_DEFS_: BONUS_TYPE_DEFS_,
    bonusTypeDef_: bonusTypeDef_,
    bonusTypeNames_: bonusTypeNames_,
    bonusTypeRequiresLink_: bonusTypeRequiresLink_,
    bonusTypeMultiplier_: bonusTypeMultiplier_,
    bonusTypeIsWeeklyCapped_: bonusTypeIsWeeklyCapped_,
    bonusTypePillKey_: bonusTypePillKey_,
    bonusTypeClientRules_: bonusTypeClientRules_,
    bonusTypeDisplayList_: bonusTypeDisplayList_,
    emptyBonusPills_: emptyBonusPills_,
    weekOfMonth_: weekOfMonth_,
    computeBonusPillsAsOf_: computeBonusPillsAsOf_,
    groupBonusEntriesByPax_: groupBonusEntriesByPax_,
    computeBonusSeriesForPax_: computeBonusSeriesForPax_,
    annotateBonusEntryCountStatus_: annotateBonusEntryCountStatus_,
    annotateBonusEntryDuplicateLinkStatus_: annotateBonusEntryDuplicateLinkStatus_,
  };
}
