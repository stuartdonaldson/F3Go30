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
 * Per-type rules (multiplier, link-required, weekly cap) live in BonusTypes.js's
 * BONUS_TYPE_DEFS_, the single registry both this module's validation and dashboardWebapp.js's
 * pill/score computation read through — see that file's header for why "link required" has no
 * live spreadsheet source of truth and must be kept in sync by hand.
 */

var bonusWebappBonusTypesModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./BonusTypes.js')
  : null;
var bonusTypeDef_bw_ = (bonusWebappBonusTypesModule_ && bonusWebappBonusTypesModule_.bonusTypeDef_)
  || (typeof globalThis !== 'undefined' && globalThis.bonusTypeDef_);
var bonusTypeClientRules_bw_ = (bonusWebappBonusTypesModule_ && bonusWebappBonusTypesModule_.bonusTypeClientRules_)
  || (typeof globalThis !== 'undefined' && globalThis.bonusTypeClientRules_);

/** {typeName: {multiplier, requiresLink}} — kept as a plain object (not a function call) since
 *  this is also what's sent to the check-in client as-is (CheckinApp.html's bonusTypesJson). */
var BONUS_TYPE_RULES_ = bonusTypeClientRules_bw_();

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
 * Validates a bonus entry payload ({type, whenIso, message, link}) against BonusTypes.js's
 * registry. Pure — no Sheet access — so it's the single gate both the client (for instant
 * feedback, via BONUS_TYPE_RULES_ below) and the server (the real gate — never trust the
 * client's own validation) can share the same rules against, without duplicating the
 * link-required table in two places.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function validateBonusEntry_(payload) {
  var p = payload || {};
  var def = bonusTypeDef_bw_(p.type);
  if (!def) return { ok: false, error: 'invalid_type' };

  var when = parseBonusDateLocal_(p.whenIso);
  if (!when || isNaN(when.getTime())) return { ok: false, error: 'invalid_when' };

  if (!String(p.message || '').trim()) return { ok: false, error: 'message_required' };

  if (def.requiresLink) {
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

var BONUS_ENTRIES_CACHE_TTL_SECONDS_ = 21600; // CacheService's max — same as dashboardWebapp.js's
                                               // trackerLayoutCacheKey_; write paths below
                                               // invalidate explicitly, so a long TTL is safe.

function bonusEntriesCacheKey_(sheetId) {
  return 'go30dash:bonusEntries:' + sheetId;
}

function bonusRowsCacheKey_(sheetId) {
  return 'go30dash:bonusRows:' + sheetId;
}

/**
 * Cache-aware full read of every Bonus Tracker row (all PAX), in the client-facing shape
 * (rowIndex/type/whenIso/message/link/complete, plus name/nameNorm) — one CacheService entry per
 * tracker sheet, shared across every PAX and every caller (bonus-list view, edit row-relocation,
 * dashboard pill computation via readAllBonusEntries_'s own separate cache). whenIso is already
 * a string via formatBonusRowForClient_, so unlike readAllBonusEntries_/
 * serializeBonusEntriesForCache_ there's no Date round-trip to worry about.
 *
 * The Bonus Tracker's pre-formatted extent makes bonusSheet.getLastRow() report its full
 * ~890-row physical extent even when almost none of it has real data (see findNextBonusRow_'s
 * doc / F3Go30-yj53) — every uncached read of this sheet costs the same regardless of actual PAX
 * count, so without this cache, simply reopening the bonus page (no write in between) paid that
 * full read cost every single time.
 *
 * invalidateBonusEntriesCache_ clears this alongside the pill-shape cache on every write, so
 * staleness is bounded by "since the last write to this sheet," not by the TTL.
 */
function getAllBonusRowsCached_(bonusSheet, sheetId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = bonusRowsCacheKey_(sheetId);
  var cached;
  try { cached = cache.get(cacheKey); } catch (e) { cached = null; }
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* corrupt — fall through to a fresh read */ }
  }

  var lastRow = bonusSheet.getLastRow();
  var values = lastRow < 2 ? [] : bonusSheet.getRange(2, 1, lastRow - 1, BONUS_TRACKER_LAST_ENTERED_COL_).getValues();
  var rows = values.map(function(row, idx) {
    var formatted = formatBonusRowForClient_(row, idx + 2); // +2: 1-based, header row offset
    formatted.name = row[0];
    formatted.nameNorm = paxCacheNormalizeName_bw_(row[0]);
    return formatted;
  });

  try { cache.put(cacheKey, JSON.stringify(rows), BONUS_ENTRIES_CACHE_TTL_SECONDS_); } catch (e) { /* payload too large or cache unavailable — the read above still succeeded */ }
  return rows;
}

/**
 * This PAX's own Bonus Tracker rows only — a PAX can never list or edit another PAX's rows.
 * Reads through getAllBonusRowsCached_ rather than re-scanning the sheet directly; see that
 * function's doc for why an uncached read here was the actual bottleneck behind "the bonus page
 * is slow every time, even with nobody else touching anything."
 * @returns {Array<Object>} formatted via formatBonusRowForClient_, in sheet order.
 */
function listBonusEntriesForPax_(bonusSheet, f3Name, sheetId) {
  var norm = paxCacheNormalizeName_bw_(f3Name);
  if (!norm) return [];
  return getAllBonusRowsCached_(bonusSheet, sheetId)
    .filter(function(r) { return r.nameNorm === norm; })
    .map(function(r) { return { rowIndex: r.rowIndex, type: r.type, whenIso: r.whenIso, message: r.message, link: r.link, complete: r.complete }; });
}

/**
 * Parses the full Bonus Tracker sheet into plain entries for every PAX — the shape
 * dashboardWebapp.js's date-scoped/capped pill computation needs (name/date/type/complete;
 * date as a real Date object, and rows with no valid date dropped entirely — neither of which
 * getAllBonusRowsCached_'s client-facing shape, used by listBonusEntriesForPax_, can offer
 * without a lossy string round-trip, hence the separate read/cache here rather than sharing one).
 * `complete` is read straight from the sheet's own column-E spilled formula rather than
 * re-derived from the link-required rule here — one source of truth, and it stays correct if
 * the Controls sheet's rules ever change without a matching code update.
 * @returns {Array<{name:string, nameNorm:string, date:Date, type:string, complete:boolean}>}
 */
function readAllBonusEntries_(bonusSheet) {
  var lastRow = bonusSheet.getLastRow();
  if (lastRow < 2) return [];

  var values = bonusSheet.getRange(2, 1, lastRow - 1, BONUS_TRACKER_LAST_ENTERED_COL_).getValues();
  var entries = [];
  values.forEach(function(row) {
    var name = row[0];
    if (!String(name || '').trim()) return;
    var when = row[6]; // G
    if (!(when instanceof Date) || isNaN(when.getTime())) return;
    entries.push({
      name: name,
      nameNorm: paxCacheNormalizeName_bw_(name),
      date: when,
      type: row[5] || '', // F
      complete: !!row[4], // E
    });
  });
  return entries;
}

/** Dates aren't JSON-safe for CacheService — same convention as dashboardWebapp.js's
 *  serializeRow3ForCache_/PaxCache.js's paxCacheSerializeRow_. */
function serializeBonusEntriesForCache_(entries) {
  return entries.map(function(e) {
    return { name: e.name, nameNorm: e.nameNorm, dateIso: formatBonusDateLocal_(e.date), type: e.type, complete: e.complete };
  });
}

function deserializeBonusEntriesFromCache_(serialized) {
  return (serialized || []).map(function(e) {
    return { name: e.name, nameNorm: e.nameNorm, date: parseBonusDateLocal_(e.dateIso), type: e.type, complete: e.complete };
  });
}

/**
 * Cache-only half of getAllBonusEntriesCached_ — same split as getCachedTrackerLayoutOnly_/
 * getTrackerLayout_ (dashboardWebapp.js), so a caller can find out whether it can skip opening
 * the spreadsheet (and fetching bonusSheet) entirely before paying for that open (F3Go30-440b.6).
 * @returns {Array|null} null on a miss or corrupt entry.
 */
function getCachedBonusEntriesOnly_(sheetId) {
  var cache = CacheService.getScriptCache();
  var cached;
  try { cached = cache.get(bonusEntriesCacheKey_(sheetId)); } catch (e) { cached = null; }
  if (!cached) return null;
  try { return deserializeBonusEntriesFromCache_(JSON.parse(cached)); } catch (e) { return null; }
}

/**
 * Cache-aware wrapper around readAllBonusEntries_ — one CacheService entry per tracker sheet,
 * shared by every PAX's dashboard load for that month (unlike listBonusEntriesForPax_, which
 * reads live every time because it's only called once per bonus-section open by one PAX).
 * addBonusEntry_/editBonusEntry_ below invalidate this key on write, so staleness is bounded by
 * "since this PAX's last bonus edit," not by the TTL.
 */
function getAllBonusEntriesCached_(bonusSheet, sheetId) {
  var cached = getCachedBonusEntriesOnly_(sheetId);
  if (cached) return cached;

  var entries = readAllBonusEntries_(bonusSheet);
  try {
    CacheService.getScriptCache().put(bonusEntriesCacheKey_(sheetId), JSON.stringify(serializeBonusEntriesForCache_(entries)), BONUS_ENTRIES_CACHE_TTL_SECONDS_);
  } catch (e) { /* payload too large or cache unavailable — the read above still succeeded */ }
  return entries;
}

/** Called when a write can't be safely write-through patched (see patchBonusCaches_) so the next
 *  dashboard/bonus-list load re-reads live data instead of serving a stale or corrupt cached copy
 *  for up to BONUS_ENTRIES_CACHE_TTL_SECONDS_ — clears both the pill-shape cache
 *  (getAllBonusEntriesCached_) and the client-shape cache (getAllBonusRowsCached_). */
function invalidateBonusEntriesCache_(sheetId) {
  try { CacheService.getScriptCache().remove(bonusEntriesCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
  try { CacheService.getScriptCache().remove(bonusRowsCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
}

/**
 * Builds the two cache-shape objects a write already has enough information to construct without
 * a re-read: the pill-shape entry (readAllBonusEntries_/serializeBonusEntriesForCache_'s shape)
 * and the client-shape row (formatBonusRowForClient_'s shape, plus name/nameNorm the way
 * getAllBonusRowsCached_ adds them). `complete` mirrors column E's spilled formula result
 * (readAllBonusEntries_'s doc) — duplicating that rule here (rather than the single source of
 * truth those reads use) is the deliberate tradeoff a write-through patch requires: there's no
 * live cell to read without paying the cost this cache exists to avoid. It's safe because
 * validateBonusEntry_ already guarantees "requires a link" implies a non-blank link.
 * @returns {{entry:Object, row:Object}}
 */
function buildBonusCacheShapes_(f3Name, rowIndex, payload) {
  var def = bonusTypeDef_bw_(payload.type);
  var nameNorm = paxCacheNormalizeName_bw_(f3Name);
  var complete = !def || !def.requiresLink || !!String(payload.link || '').trim();
  var message = String(payload.message || '').trim();
  var link = String(payload.link || '').trim();
  return {
    entry: { name: f3Name, nameNorm: nameNorm, dateIso: payload.whenIso, type: payload.type, complete: complete },
    row: { rowIndex: rowIndex, type: payload.type, whenIso: payload.whenIso, message: message, link: link, complete: complete, name: f3Name, nameNorm: nameNorm },
  };
}

/**
 * Write-through patch for both cached bonus arrays (F3Go30-o39s.6, closes finding F5) — replaces
 * addBonusEntry_/editBonusEntry_/clearBonusEntry_'s former invalidate-and-reread with an in-place
 * patch, so the next bonusList/dashboard read for this sheet is a cache HIT reflecting the write
 * instead of paying a full cold rebuild (see getAllBonusRowsCached_'s doc for why that rebuild is
 * expensive). Must be called inside the same LockService section as the sheet write, so a
 * concurrent writer can never interleave a stale patch.
 *
 * go30dash:bonusRows carries rowIndex, so add/edit/clear there match by rowIndex directly.
 * go30dash:bonusEntries (the pill shape) carries no rowIndex — it's matched by content instead
 * (nameNorm + type + dateIso, the same identity originalSnapshot already captures), requiring
 * exactly one match. Any cache miss on a key is a no-op for that key (nothing cached to patch);
 * any mismatch — the array isn't there in the expected shape, a rowIndex/content match fails, or
 * a match is ambiguous — falls back to invalidateBonusEntriesCache_ for both keys rather than
 * risk serving a wrongly patched array.
 * @param {string} sheetId
 * @param {'add'|'edit'|'clear'} op
 * @param {number} rowIndex Row the write landed on (add/edit) or cleared (clear).
 * @param {string} f3Name
 * @param {{entry:Object, row:Object}|null} newShapes buildBonusCacheShapes_ output for add/edit;
 *   null for clear (nothing to insert, only remove).
 * @param {{type:string, whenIso:string}|null} originalSnapshot Pre-write identity, required for
 *   edit/clear (to locate the old pill-cache entry); null for add.
 */
function patchBonusCaches_(sheetId, op, rowIndex, f3Name, newShapes, originalSnapshot) {
  var cache = CacheService.getScriptCache();
  var nameNorm = paxCacheNormalizeName_bw_(f3Name);
  var rowsPatchOk = true;

  try {
    var rowsCached = cache.get(bonusRowsCacheKey_(sheetId));
    if (rowsCached) {
      var rows = JSON.parse(rowsCached);
      var idx = -1;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].rowIndex === rowIndex) { idx = i; break; }
      }
      if (op === 'add') {
        if (idx !== -1) throw new Error('rowIndex already present');
        rows.push(newShapes.row);
      } else if (idx === -1) {
        throw new Error('rowIndex not found');
      } else if (op === 'edit') {
        rows[idx] = newShapes.row;
      } else { // clear
        rows.splice(idx, 1);
      }
      cache.put(bonusRowsCacheKey_(sheetId), JSON.stringify(rows), BONUS_ENTRIES_CACHE_TTL_SECONDS_);
    }
  } catch (e) {
    rowsPatchOk = false;
  }

  if (!rowsPatchOk) {
    invalidateBonusEntriesCache_(sheetId);
    return;
  }

  try {
    var entriesCached = cache.get(bonusEntriesCacheKey_(sheetId));
    if (entriesCached) {
      var entries = JSON.parse(entriesCached);
      if (op === 'add') {
        entries.push(newShapes.entry);
      } else {
        var matchIdx = -1, matchCount = 0;
        for (var j = 0; j < entries.length; j++) {
          var e = entries[j];
          if (e.nameNorm === nameNorm && e.type === originalSnapshot.type && e.dateIso === originalSnapshot.whenIso) {
            matchCount++;
            matchIdx = j;
          }
        }
        if (matchCount !== 1) throw new Error('content match not unique');
        if (op === 'edit') {
          entries[matchIdx] = newShapes.entry;
        } else { // clear
          entries.splice(matchIdx, 1);
        }
      }
      cache.put(bonusEntriesCacheKey_(sheetId), JSON.stringify(entries), BONUS_ENTRIES_CACHE_TTL_SECONDS_);
    }
  } catch (e) {
    invalidateBonusEntriesCache_(sheetId);
  }
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

  // findNextBonusRow_ (read) + writeBonusEnteredColumns_ (write) must be atomic — otherwise two
  // concurrent adds can both read the same blank row as "next free," and the second write
  // silently clobbers the first PAX's entry rather than landing in its own row.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('addBonusEntry_.lockFailed', { f3Name: f3Name, error: e.message });
    return { ok: false, error: 'locked' };
  }
  try {
    var nextRow = findNextBonusRow_(bonusSheet);
    if (!nextRow) return { ok: false, error: 'bonus_sheet_full' };

    writeBonusEnteredColumns_(bonusSheet, nextRow, f3Name, payload);
    patchBonusCaches_(bonusSheet.getParent().getId(), 'add', nextRow, f3Name, buildBonusCacheShapes_(f3Name, nextRow, payload), null);
    return { ok: true, rowIndex: nextRow };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Locates the row for an existing entry by matching its full remembered content (Name + Type +
 * When + What + Link), not a bare row number — a rowIndex captured when the bonus list loaded
 * can go stale by save time for reasons that have nothing to do with concurrent app requests
 * (a human manually sorting the Bonus Tracker sheet, a bulk edit), and a Name-only check would
 * wrongly pass if some other row happened to land at that index with the same PAX's name on it.
 * rowIndexHint is tried first as a fast path — if the row there still matches the full snapshot,
 * no scan is needed — falling back to a full-sheet scan only when the hint misses.
 * @param {Sheet} bonusSheet
 * @param {string} f3Name
 * @param {{type:string, whenIso:string, message:string, link:string}} snapshot pre-edit values,
 *   as the client last saw them from the bonusList response — not the edited form fields.
 * @param {number=} rowIndexHint
 * @returns {number|null}
 */
function findBonusRowByIdentity_(bonusSheet, f3Name, snapshot, rowIndexHint) {
  // No snapshot (missing/legacy caller) must never match — falling back to an empty {} would let
  // it wrongly match any row with blank Type/When/What/Link, which is exactly the kind of
  // unverified guess this function exists to prevent.
  if (!snapshot || !snapshot.type || !snapshot.whenIso) return null;

  var nameNorm = paxCacheNormalizeName_bw_(f3Name);
  function matches(rowValues) {
    if (!rowValues || paxCacheNormalizeName_bw_(rowValues[0]) !== nameNorm) return false;
    var formatted = formatBonusRowForClient_(rowValues, 0);
    return formatted.type === snapshot.type
      && formatted.whenIso === snapshot.whenIso
      && formatted.message === (snapshot.message || '')
      && formatted.link === (snapshot.link || '');
  }

  var maxRows = bonusSheet.getMaxRows();
  if (rowIndexHint && rowIndexHint >= 2 && rowIndexHint <= maxRows) {
    var hintRow = bonusSheet.getRange(rowIndexHint, 1, 1, BONUS_TRACKER_LAST_ENTERED_COL_).getValues()[0];
    if (matches(hintRow)) return rowIndexHint;
  }

  if (maxRows < 2) return null;
  var allRows = bonusSheet.getRange(2, 1, maxRows - 1, BONUS_TRACKER_LAST_ENTERED_COL_).getValues();
  for (var i = 0; i < allRows.length; i++) {
    if (matches(allRows[i])) return i + 2; // +2: 1-based, header row offset
  }
  return null;
}

/**
 * Overwrites an existing Bonus Tracker row's entered columns in place. Relocates the row by
 * content (findBonusRowByIdentity_) rather than trusting rowIndexHint outright — see that
 * function's doc. Locate + write happen inside one lock so nothing can move the row between the
 * two.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function editBonusEntry_(bonusSheet, f3Name, rowIndexHint, payload, originalSnapshot) {
  var validation = validateBonusEntry_(payload);
  if (!validation.ok) return validation;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('editBonusEntry_.lockFailed', { f3Name: f3Name, rowIndex: rowIndexHint, error: e.message });
    return { ok: false, error: 'locked' };
  }
  try {
    var rowIndex = findBonusRowByIdentity_(bonusSheet, f3Name, originalSnapshot, rowIndexHint);
    if (!rowIndex) return { ok: false, error: 'not_found' };

    writeBonusEnteredColumns_(bonusSheet, rowIndex, f3Name, payload);
    patchBonusCaches_(bonusSheet.getParent().getId(), 'edit', rowIndex, f3Name, buildBonusCacheShapes_(f3Name, rowIndex, payload), originalSnapshot);
    return { ok: true, rowIndex: rowIndex };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Clears an existing Bonus Tracker row's entered columns in place. Used when an edit changes an
 * entry's date enough to move it into a different month's tracker sheet — editBonusEntry_ can't
 * just retarget the write there, since the entry now belongs in a different sheet entirely.
 * Relocates the row by content (findBonusRowByIdentity_), same as editBonusEntry_.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function clearBonusEntry_(bonusSheet, f3Name, rowIndexHint, originalSnapshot) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('clearBonusEntry_.lockFailed', { f3Name: f3Name, rowIndex: rowIndexHint, error: e.message });
    return { ok: false, error: 'locked' };
  }
  try {
    var rowIndex = findBonusRowByIdentity_(bonusSheet, f3Name, originalSnapshot, rowIndexHint);
    if (!rowIndex) return { ok: false, error: 'not_found' };

    bonusSheet.getRange(rowIndex, BONUS_TRACKER_NAME_COL_).clearContent();
    bonusSheet.getRange(rowIndex, BONUS_TRACKER_TYPE_COL_).clearContent();
    bonusSheet.getRange(rowIndex, BONUS_TRACKER_WHEN_COL_).clearContent();
    bonusSheet.getRange(rowIndex, BONUS_TRACKER_WHAT_COL_).clearContent();
    bonusSheet.getRange(rowIndex, BONUS_TRACKER_LINK_COL_).clearContent();
    patchBonusCaches_(bonusSheet.getParent().getId(), 'clear', rowIndex, f3Name, null, originalSnapshot);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
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
    clearBonusEntry_: clearBonusEntry_,
    findBonusRowByIdentity_: findBonusRowByIdentity_,
    readAllBonusEntries_: readAllBonusEntries_,
    serializeBonusEntriesForCache_: serializeBonusEntriesForCache_,
    deserializeBonusEntriesFromCache_: deserializeBonusEntriesFromCache_,
    getCachedBonusEntriesOnly_: getCachedBonusEntriesOnly_,
    getAllBonusEntriesCached_: getAllBonusEntriesCached_,
    getAllBonusRowsCached_: getAllBonusRowsCached_,
    invalidateBonusEntriesCache_: invalidateBonusEntriesCache_,
    buildBonusCacheShapes_: buildBonusCacheShapes_,
    patchBonusCaches_: patchBonusCaches_,
    bonusEntriesCacheKey_: bonusEntriesCacheKey_,
    bonusRowsCacheKey_: bonusRowsCacheKey_,
  };
}
