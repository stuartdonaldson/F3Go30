/**
 * CopyTemplate — stands up a brand-new, fully isolated environment by copying the Template
 * spreadsheet (its bound script comes along automatically, since Drive file copies of a
 * container-bound spreadsheet duplicate the bound Apps Script project too) plus the N most
 * recent real monthly tracker spreadsheets into a new Drive folder, then rebuilds that copy's
 * TrackerDB/PaxDB sheets from scratch using only the copied trackers' (new) SheetIds.
 *
 * Installs an edit trigger (setupTrackerEditTrigger_, F3Go30-o39s.5/C4) on each copied tracker
 * so a human editing one directly keeps PaxCache coherent — otherwise copied trackers would have
 * no trigger at all, since Drive file copies don't carry installable triggers with them (those
 * live in the script project that created them, not on the spreadsheet file). Deliberately does
 * NOT set up form-submit triggers, HC Forms, TinyURL short links, or deploy anything else — this
 * only gets the files (+ edit-trigger coverage) in place. Manually initializing/deploying the
 * rest of the new environment is left to the operator (see docs/OPERATIONS.md §CopyTemplate).
 *
 * ENV-STANDUP VISION: this module is the precursor step for spinning up a realistic-prod-data
 * test/SIT environment — real Template + real recent trackers, but running as an independent
 * copy. The ONLY meaningful delta between the PROD source and the copied environment is the
 * Config sheet: Email Test Mode must be forced to Yes (fail-safe) and NameSpace must be a
 * unique value derived from the operator-supplied folderName, so the copy cannot be mistaken
 * for PROD and cannot send live email. Making that differentiation is this module's job, at
 * minimum the Email Test Mode fail-safe — a future maintainer must NOT "clean up" the copy's
 * Config back toward PROD's values, since doing so silently re-arms live email sends from a
 * spreadsheet everyone assumes is a harmless test copy. See selectRecentRealTrackerRows_ (which
 * scopes the trackers) and computeSafeConfigDefaults_/buildRenamedTrackerName_ (which apply the
 * fail-safe Config + rename) below.
 */

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var copyTemplateGo30ToolsModule_ = gasRequire_('./go30tools.js', ['_readTrackerDbRowsBySheetId_', '_computeTrackerMetrics_', '_buildTrackerMetadata_', '_loadPaxData', '_updateTrackerDB', '_updatePaxDB', 'appendNamespaceRegistryRow_', '_lookupNamespaceRegistryRow_', 'removeNamespaceRegistryRow_']);
var copyTemplateUtilitiesModule_ = gasRequire_('./Utilities.js', ['upsertConfigSheetRow_']);
var copyTemplateTrackerEditTriggerModule_ = gasRequire_('./TrackerEditTrigger.js', ['setupTrackerEditTrigger_']);
var ct_setupTrackerEditTrigger_ = copyTemplateTrackerEditTriggerModule_.setupTrackerEditTrigger_;
var copyTemplateSignupWebappModule_ = gasRequire_('./signupWebapp.js', ['getCurrentAndNextMonths_']);
var ct_getCurrentAndNextMonths_ = copyTemplateSignupWebappModule_.getCurrentAndNextMonths_;
var copyTemplatePaxCacheModule_ = gasRequire_('./PaxCache.js', ['wipePaxCacheAndRelatedCachesForSheet_']);
var ct_wipePaxCacheAndRelatedCachesForSheet_ = copyTemplatePaxCacheModule_.wipePaxCacheAndRelatedCachesForSheet_;
var ct_upsertConfigSheetRow_ = copyTemplateUtilitiesModule_.upsertConfigSheetRow_;
var ct_readTrackerDbRowsBySheetId_ = copyTemplateGo30ToolsModule_._readTrackerDbRowsBySheetId_;
var ct_computeTrackerMetrics_ = copyTemplateGo30ToolsModule_._computeTrackerMetrics_;
var ct_buildTrackerMetadata_ = copyTemplateGo30ToolsModule_._buildTrackerMetadata_;
var ct_loadPaxData = copyTemplateGo30ToolsModule_._loadPaxData;
var ct_updateTrackerDB = copyTemplateGo30ToolsModule_._updateTrackerDB;
var ct_updatePaxDB = copyTemplateGo30ToolsModule_._updatePaxDB;
var ct_appendNamespaceRegistryRow_ = copyTemplateGo30ToolsModule_.appendNamespaceRegistryRow_;
var ct_lookupNamespaceRegistryRow_ = copyTemplateGo30ToolsModule_._lookupNamespaceRegistryRow_;
var ct_removeNamespaceRegistryRow_ = copyTemplateGo30ToolsModule_.removeNamespaceRegistryRow_;

/**
 * Filters TrackerDB rows down to real, non-smoke, non-expired monthly trackers and returns
 * the `count` most recent by StartDate (descending). Pure — no Drive/Sheets calls — so it's
 * unit-testable without live GAS services.
 * @param {Array<Object>} trackerRows Values from _readTrackerDbRowsBySheetId_(...).bySheetId.
 * @param {number} count
 * @returns {Array<Object>}
 */
function selectRecentRealTrackerRows_(trackerRows, count) {
	var real = (trackerRows || []).filter(function(row) {
		if (!row || !row.sheetId) return false;
		var name = String(row.spreadsheetName || '');
		if (name.indexOf('(Smoke)') !== -1) return false;
		if (name.indexOf('(Expired)') !== -1) return false;
		return true;
	});

	real.sort(function(a, b) {
		var aTime = a.startDate instanceof Date ? a.startDate.getTime() : (new Date(a.startDate)).getTime();
		var bTime = b.startDate instanceof Date ? b.startDate.getTime() : (new Date(b.startDate)).getTime();
		aTime = isNaN(aTime) ? -Infinity : aTime;
		bTime = isNaN(bTime) ? -Infinity : bTime;
		return bTime - aTime;
	});

	return real.slice(0, count);
}

/**
 * Builds one TrackerDB row for a freshly copied tracker spreadsheet. Lineage fields
 * (ShortTracker/ShortHC/FormId/lifecycle timestamps) are intentionally blank — the copy has
 * no short links, forms, or triggers of its own yet (see file header).
 * @param {{sheetId: string, spreadsheetName: string}} copiedFile
 * @param {{startDate, trackerUrl, hcUrl, formId}} metadata From _buildTrackerMetadata_.
 * @param {{totalPax: number, totalTeams: number, averageScore: number}} metrics From _computeTrackerMetrics_.
 * @returns {Object}
 */
function buildCopiedTrackerDbRow_(copiedFile, metadata, metrics) {
	return {
		dateModified: new Date(),
		startDate: metadata.startDate,
		spreadsheetName: copiedFile.spreadsheetName,
		shortTracker: '',
		trackerUrl: metadata.trackerUrl,
		shortHc: '',
		hcUrl: metadata.hcUrl || '',
		sheetId: copiedFile.sheetId,
		formId: '',
		totalPax: metrics.totalPax,
		totalTeams: metrics.totalTeams,
		averageScore: metrics.averageScore,
		lastSignupAt: '',
		triggersInitializedAt: '',
		lastMinusOneRunAt: '',
		lastNagRunAt: ''
	};
}

/**
 * Computes the safe-mode Config sheet overrides applied to every copied environment. Unifies
 * folderName/NameSpace/rename-marker into a single identifier (the operator-supplied
 * folderName) and forces Email Test Mode on regardless of what the source Config carried, so a
 * freshly copied environment can never silently inherit PROD's live-email setting. Pure — no
 * Sheets/Drive calls — so it's unit-testable without live GAS services.
 * @param {string} folderName Operator-supplied name for the new environment; doubles as the
 *   new NameSpace and as the rename marker applied to copied tracker spreadsheets.
 * @returns {{emailTestMode: {key: string, primary: string, secondary: string}, nameSpace: {key: string, primary: string, secondary: string}}}
 */
function computeSafeConfigDefaults_(folderName) {
	return {
		emailTestMode: { key: 'Email Test Mode', primary: 'Yes', secondary: '' },
		nameSpace: { key: 'NameSpace', primary: String(folderName), secondary: '' }
	};
}

/**
 * Renames a copied historical tracker spreadsheet to carry the new environment's marker, so
 * it's never mistaken for its PROD original. Appends " (<folderName>)" to the source name
 * (the safe default per this bead's design notes) rather than substituting the NameSpace
 * segment of "YYYY-MM-<oldNs>" — appending can't collide with or corrupt an unexpected source
 * naming convention, and keeps the original name fully intact for traceability back to PROD.
 * Pure — no Drive calls — so it's unit-testable without live GAS services.
 * @param {string} originalName Source tracker's spreadsheetName (e.g. "2026-07 F3 Go30").
 * @param {string} folderName Operator-supplied environment marker (== new NameSpace).
 * @returns {string} e.g. "2026-07 F3 Go30 (SIT-2026-07-06)".
 */
function buildRenamedTrackerName_(originalName, folderName) {
	return String(originalName) + ' (' + String(folderName) + ')';
}

/**
 * Applies the safe-mode Config defaults (see computeSafeConfigDefaults_) to a copied
 * environment's Config sheet in place.
 * @param {Sheet} configSheet Raw Config sheet of the copied template spreadsheet.
 * @param {string} folderName Operator-supplied environment marker (== new NameSpace).
 * @returns {Array<Array>} The Config sheet's rows after the upserts (mirrors upsertConfigSheetRow_'s
 *   mutated-rows-array convention).
 */
function applySafeConfigDefaults_(configSheet, folderName) {
	var rows = configSheet.getDataRange().getValues();
	var defaults = computeSafeConfigDefaults_(folderName);
	ct_upsertConfigSheetRow_(configSheet, rows, defaults.emailTestMode.key, defaults.emailTestMode.primary, defaults.emailTestMode.secondary);
	ct_upsertConfigSheetRow_(configSheet, rows, defaults.nameSpace.key, defaults.nameSpace.primary, defaults.nameSpace.secondary);
	return rows;
}

/**
 * Copies a source Template (+ bound script) and the `trackerCount` most recent real monthly
 * trackers into a new sibling Drive folder named `folderName`, rebuilds the copy's
 * TrackerDB/PaxDB from scratch using only those copied trackers, then registers the new
 * environment as a `NamespaceDB` row in the *destination* (active/executing) deployment.
 *
 * Per ADR-014 D6, source and destination are deliberately decoupled: `sourceTemplateId` is an
 * explicit spreadsheet id (typically PROD's Template) copied FROM, while the active spreadsheet
 * (typically SIT) is the registry copied TO — it owns the `NamespaceDB` sheet that the new
 * environment is registered into. Run from SIT, this copies PROD without ever copying SIT
 * itself.
 * @param {string} folderName Also becomes the new environment's NameSpace (registry key).
 * @param {string} sourceTemplateId Spreadsheet id of the Template to copy FROM. Required —
 *   never defaults to the active spreadsheet, or SIT would copy itself instead of PROD.
 * @param {number=} trackerCount Defaults to 3.
 * @param {string=} kind NamespaceDB `Kind` column (`smoke` | `regional` | `demo`). Defaults to 'smoke'.
 * @param {function(string)=} logFn Progress callback.
 * @returns {{newFolderId, newFolderUrl, newTemplateId, newTemplateUrl, copiedTrackers: Array, nameSpace: string, kind: string}}
 */
function copyTemplateToNewEnvironment_(folderName, sourceTemplateId, trackerCount, kind, logFn) {
	logFn = logFn || function() {};
	trackerCount = trackerCount || 3;
	kind = kind || 'smoke';

	if (!folderName || !String(folderName).trim()) {
		throw new Error('folderName is required');
	}
	if (!sourceTemplateId || !String(sourceTemplateId).trim()) {
		throw new Error('sourceTemplateId is required');
	}

	var registrySpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var templateSpreadsheet = SpreadsheetApp.openById(sourceTemplateId);
	var templateFile = DriveApp.getFileById(sourceTemplateId);
	var parents = templateFile.getParents();
	if (!parents.hasNext()) {
		throw new Error('Cannot determine Drive folder for the Template spreadsheet — it must live in a folder, not My Drive root.');
	}
	var parentFolder = parents.next();

	var newFolder = parentFolder.createFolder(folderName);
	logFn('Created folder "' + folderName + '" (' + newFolder.getId() + ')');

	var newTemplateFile = templateFile.makeCopy(folderName + ' - Go30 Template', newFolder);
	var newTemplateId = newTemplateFile.getId();
	logFn('Copied Template spreadsheet (+ bound script) -> ' + newTemplateId);

	var newTemplateSpreadsheetForConfig = SpreadsheetApp.openById(newTemplateId);
	var newConfigSheet = newTemplateSpreadsheetForConfig.getSheetByName('Config');
	if (!newConfigSheet) {
		throw new Error('Copied template spreadsheet has no Config sheet — cannot apply safe-mode defaults (Email Test Mode/NameSpace).');
	}
	applySafeConfigDefaults_(newConfigSheet, folderName);
	logFn('Config: forced Email Test Mode=Yes and NameSpace="' + folderName + '" (safe-mode defaults; never inherit PROD\'s live-email/NameSpace).');

	var trackerState = ct_readTrackerDbRowsBySheetId_(templateSpreadsheet);
	var allRows = Object.keys(trackerState.bySheetId).map(function(id) { return trackerState.bySheetId[id]; });
	var selected = selectRecentRealTrackerRows_(allRows, trackerCount);
	if (!selected.length) {
		throw new Error('No eligible (real, non-smoke, non-expired) trackers found in TrackerDB.');
	}

	var newTrackerDbRows = [];
	var paxRows = [];
	var copiedTrackers = [];

	selected.forEach(function(sourceRow) {
		var sourceFile = DriveApp.getFileById(sourceRow.sheetId);
		var renamedTrackerName = buildRenamedTrackerName_(sourceRow.spreadsheetName, folderName);
		var copiedFile = sourceFile.makeCopy(renamedTrackerName, newFolder);
		var newSheetId = copiedFile.getId();
		logFn('Copied tracker "' + sourceRow.spreadsheetName + '" -> ' + newSheetId);

		var copiedSpreadsheet = SpreadsheetApp.openById(newSheetId);
		var trackerSheet = copiedSpreadsheet.getSheetByName('Tracker');
		if (!trackerSheet) {
			logFn('  ⚠️  Skipping TrackerDB/PaxDB seeding for ' + sourceRow.spreadsheetName + ' — no Tracker sheet found.');
			return;
		}

		var trackerValues = trackerSheet.getDataRange().getValues();
		var metrics = ct_computeTrackerMetrics_(trackerValues);
		var metadata = ct_buildTrackerMetadata_(copiedSpreadsheet, trackerSheet, trackerValues, null);

		// C4 (F3Go30-o39s.5): copied trackers get no triggers of their own from Drive's file
		// copy (installable triggers live in the script project that created them, not on the
		// spreadsheet file), so without this a human editing a namespace/smoke tracker directly
		// would silently get no PaxCache invalidation at all. Copied trackers carry no HC Form
		// (formId is left blank; see buildCopiedTrackerDbRow_ below; ADR-024 retired the Form).
		ct_setupTrackerEditTrigger_(copiedSpreadsheet);
		logFn('  Installed edit trigger for ' + copiedFile.getName());

		var copiedFileInfo = { sheetId: newSheetId, spreadsheetName: copiedFile.getName() };
		newTrackerDbRows.push(buildCopiedTrackerDbRow_(copiedFileInfo, metadata, metrics));
		Array.prototype.push.apply(paxRows, ct_loadPaxData(copiedSpreadsheet, newSheetId, metadata.startDate));

		copiedTrackers.push({
			sourceSheetId: sourceRow.sheetId,
			newSheetId: newSheetId,
			spreadsheetName: copiedFile.getName(),
			totalPax: metrics.totalPax,
			totalTeams: metrics.totalTeams
		});
	});

	var newTemplateSpreadsheet = newTemplateSpreadsheetForConfig;
	ct_updateTrackerDB(newTrackerDbRows, newTemplateSpreadsheet);
	ct_updatePaxDB(paxRows, newTemplateSpreadsheet);
	logFn('Seeded new TrackerDB (' + newTrackerDbRows.length + ' rows) and PaxDB (' + paxRows.length + ' rows).');

	ct_appendNamespaceRegistryRow_(registrySpreadsheet, {
		nameSpace: folderName,
		templateId: newTemplateId,
		kind: kind
	});
	logFn('Registered NamespaceDB row: NameSpace="' + folderName + '" -> TemplateId=' + newTemplateId + ' (Kind=' + kind + ').');

	return {
		newFolderId: newFolder.getId(),
		newFolderUrl: newFolder.getUrl(),
		newTemplateId: newTemplateId,
		newTemplateUrl: newTemplateFile.getUrl(),
		copiedTrackers: copiedTrackers,
		nameSpace: folderName,
		kind: kind
	};
}

/**
 * Tears down a namespace environment provisioned by copyTemplateToNewEnvironment_, per
 * ADR-014 D6 lifecycle (i5md.4). Removes the NamespaceDB row FIRST — this is the primary
 * safety cut, since it makes the ns unresolvable via resolveTemplateSpreadsheet_ immediately,
 * regardless of whether the Drive trash step below succeeds. Namespace environments install no
 * triggers of their own (see file header), so there is no trigger-leak mode to guard against
 * here — unlike cleanupTrackerArtifact_, which must also clear a form-submit trigger.
 * @param {string} ns NameSpace to tear down.
 * @param {boolean=} trashFolder Also trash the environment's whole Drive folder (the Template
 *   copy + every tracker spreadsheet copied alongside it, since copyTemplateToNewEnvironment_
 *   places them all in one sibling folder). Default false.
 * @param {function(string)=} logFn Progress callback.
 * @returns {{nameSpace: string, templateId: string, registryRowRemoved: boolean,
 *   folderId: (string|null), folderTrashed: boolean}}
 */
function teardownNamespaceEnvironment_(ns, trashFolder, logFn) {
	logFn = logFn || function() {};
	if (!ns || !String(ns).trim()) {
		throw new Error('ns is required');
	}

	var registrySpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var registryRow = ct_lookupNamespaceRegistryRow_(registrySpreadsheet, ns);
	if (!registryRow) {
		throw new Error('NamespaceDB has no row for ns="' + ns + '" -- nothing to tear down.');
	}

	var registryRowRemoved = ct_removeNamespaceRegistryRow_(registrySpreadsheet, ns);
	logFn('Removed NamespaceDB row for ns="' + ns + '" (unresolvable immediately).');

	var folderId = null;
	var folderTrashed = false;
	if (trashFolder) {
		var templateFile = DriveApp.getFileById(registryRow.templateId);
		var parents = templateFile.getParents();
		if (parents.hasNext()) {
			var folder = parents.next();
			folderId = folder.getId();
			folder.setTrashed(true);
			folderTrashed = true;
			logFn('Trashed environment folder (' + folderId + ') -- Template copy + all copied trackers.');
		} else {
			logFn('Could not determine environment folder for TemplateId=' + registryRow.templateId + ' -- skipped folder trash.');
		}
	}

	return {
		nameSpace: ns,
		templateId: registryRow.templateId,
		registryRowRemoved: registryRowRemoved,
		folderId: folderId,
		folderTrashed: folderTrashed
	};
}

// F3Go30-956l: fixed set of per-tracker sheets that carry a month's actual data (as opposed to
// Config/Links/Activity, which are structural). Shared by copyCurrentMonthTrackerDataFromSource_
// below and TrackerEditTrigger.js's own TRACKER_EDIT_INVALIDATING_SHEETS_ (same three sheets,
// different purpose — kept as separate constants since one drives cache invalidation and this
// one drives which sheets get their non-formula cell values overlaid from the source).
var TRACKER_DATA_SHEET_NAMES_ = ['Tracker', 'Bonus Tracker', 'Responses'];

/**
 * Pure planning step for copyCurrentMonthTrackerDataFromSource_: decides which of
 * TRACKER_DATA_SHEET_NAMES_ to copy vs skip, given which sheet names actually exist on the
 * source tracker. No Drive/Sheets calls, so it's unit-testable without live GAS services.
 * @param {Array<string>} sheetNames
 * @param {Object<string,boolean>} sourceSheetNamesPresent
 * @returns {Array<{name:string, action:('copy'|'skip')}>}
 */
function planTrackerDataSheetCopy_(sheetNames, sourceSheetNamesPresent) {
	return (sheetNames || []).map(function(name) {
		return { name: name, action: (sourceSheetNamesPresent && sourceSheetNamesPresent[name]) ? 'copy' : 'skip' };
	});
}

/**
 * Pure planning step for copyTrackerDataSheetValues_: decides which COLUMNS are safe to overlay
 * whole, given the formula layout of both sides. A column is 'skip' if a formula appears anywhere
 * in it on either side, 'copy' otherwise. Column-level (not cell-level) is deliberate: an earlier
 * cell-level design (F3Go30-956l) computed a per-cell merged grid but then wrote it back with one
 * Range.setValues() call spanning the WHOLE sheet — Sheets has no "skip this cell" write, so that
 * call silently overwrote every formula cell in the range with its last computed value, destroying
 * the formula. Tracker/Bonus Tracker/Responses each have formulas clustered in whole columns
 * (computed totals/scores), not mixed within a column, so skipping a formula-bearing column
 * entirely — and writing every safe column in one contiguous Range.setValues() — copies real data
 * without ever touching a formula cell. No Drive/Sheets calls, so it's unit-testable without live
 * GAS services.
 * @param {Array<Array<string>>} sourceFormulas From sourceSheet.getDataRange().getFormulas().
 * @param {Array<Array<string>>} destFormulas From destinationSheet.getDataRange().getFormulas().
 * @param {number} sourceColCount
 * @param {number} destColCount
 * @returns {Array<{col: number, action: ('copy'|'skip')}>} col is 0-based.
 */
function planTrackerDataColumnOverlay_(sourceFormulas, destFormulas, sourceColCount, destColCount) {
	var formulaCols = {};
	[sourceFormulas, destFormulas].forEach(function(formulas) {
		(formulas || []).forEach(function(row) {
			(row || []).forEach(function(f, c) {
				if (f) { formulaCols[c] = true; }
			});
		});
	});
	var maxCols = Math.max(sourceColCount || 0, destColCount || 0);
	var plan = [];
	for (var c = 0; c < maxCols; c++) {
		plan.push({ col: c, action: formulaCols[c] ? 'skip' : 'copy' });
	}
	return plan;
}

/**
 * Overlays sourceSheet's non-formula-column cell values onto destinationSheet in place (see
 * planTrackerDataColumnOverlay_ for the column-safety rule), leaving the destination sheet itself
 * — identity, formatting, tab position, any linked Form, and every formula cell — completely
 * untouched. Deliberately does NOT use Sheet.copyTo()/deleteSheet() (F3Go30-956l live-test
 * finding: the destination Responses sheet can carry a linked Google Form, and Sheets refuses to
 * delete a sheet with a linked form). Clears data validation on each copied column before writing
 * (another F3Go30-956l live-test finding: a destination cell can carry validation — e.g. a
 * dropdown list — that rejects a legitimate value copied in from the source). GAS orchestration
 * only (live Sheet/Range objects) — not unit-tested; see planTrackerDataColumnOverlay_ for the
 * testable planning logic this is driven by.
 * @param {Object} sourceSheet
 * @param {Object} destinationSheet
 * @param {function(string)=} logFn Progress callback, used only to report skipped formula columns.
 * @returns {{rows: number, cols: number, skippedFormulaColumns: Array<number>}} cols/skippedFormulaColumns are 1-based column numbers.
 */
function copyTrackerDataSheetValues_(sourceSheet, destinationSheet, logFn) {
	logFn = logFn || function() {};
	var sourceRange = sourceSheet.getDataRange();
	var sourceValues = sourceRange.getValues();
	var sourceFormulas = sourceRange.getFormulas();
	var destRange = destinationSheet.getDataRange();
	var destValues = destRange.getValues();
	var destFormulas = destRange.getFormulas();

	var sourceRows = sourceValues.length;
	var destRows = destValues.length;
	var rows = Math.max(sourceRows, destRows);
	var sourceCols = sourceRows ? sourceValues[0].length : 0;
	var destCols = destRows ? destValues[0].length : 0;

	var plan = planTrackerDataColumnOverlay_(sourceFormulas, destFormulas, sourceCols, destCols);
	var copiedCols = [];
	var skippedFormulaColumns = [];

	plan.forEach(function(step) {
		if (step.action === 'skip') {
			skippedFormulaColumns.push(step.col + 1);
			return;
		}
		var c = step.col;
		var columnValues = [];
		for (var r = 0; r < rows; r++) {
			var inSource = r < sourceRows && c < sourceCols;
			var inDest = r < destRows && c < destCols;
			columnValues.push([inSource ? sourceValues[r][c] : (inDest ? destValues[r][c] : '')]);
		}
		if (rows > 0) {
			var columnRange = destinationSheet.getRange(1, c + 1, rows, 1);
			columnRange.clearDataValidations();
			columnRange.setValues(columnValues);
		}
		copiedCols.push(c + 1);
	});

	if (skippedFormulaColumns.length) {
		logFn('    (left ' + skippedFormulaColumns.length + ' formula column(s) untouched: col#' + skippedFormulaColumns.join(', ') + ')');
	}

	return { rows: rows, cols: copiedCols.length, skippedFormulaColumns: skippedFormulaColumns };
}

/**
 * Copies PROD's current-month tracker's Tracker/Bonus Tracker/Responses sheets into the
 * destination Template's own current-month tracker, overlaying each sheet's non-formula cell
 * values onto the destination's existing sheet in place (F3Go30-956l; see
 * copyTrackerDataSheetValues_ — the destination sheet itself, and any linked Form, are never
 * deleted or replaced). Intended to run from SIT only — the adminCopyProdTrackerToSit_ webapp
 * action that calls this enforces the PROD guard; this function itself never writes to the source.
 *
 * Unlike copyTemplateToNewEnvironment_ above (which copies whole tracker FILES into a brand-new
 * environment), this targets the one already-existing destination tracker for "this month" and
 * refreshes only its three data sheets, then re-syncs TrackerDB/PaxDB/PaxCache to match — same
 * freshness guarantee a human editing those sheets (TrackerEditTrigger.js) or an admin-triggered
 * scanTrackers() already provides, since a programmatic Sheet.copyTo() fires no onEdit trigger.
 *
 * @param {string} sourceTemplateId PROD's templateSpreadsheetId — required, never defaults to
 *   the active spreadsheet (mirrors copyTemplateToNewEnvironment_'s sourceTemplateId contract),
 *   so SIT can never accidentally copy from itself.
 * @param {Object} destinationTemplateSpreadsheet The ns-resolved destination Template spreadsheet
 *   (resolveTemplateSpreadsheet_'s result) whose own current-month tracker is the copy target.
 * @param {string=} contextDateOverride Per-request contextDate override, passed through to both
 *   sides' getCurrentAndNextMonths_ so "current month" resolves the same way on each.
 * @param {function(string)=} logFn Progress callback.
 * @returns {{ok:true, sourceSheetId:string, destinationSheetId:string, sheets:Array, scanResult:Object}}
 */
function copyCurrentMonthTrackerDataFromSource_(sourceTemplateId, destinationTemplateSpreadsheet, contextDateOverride, logFn) {
	logFn = logFn || function() {};
	if (!sourceTemplateId || !String(sourceTemplateId).trim()) {
		throw new Error('sourceTemplateId is required');
	}

	var sourceTemplateSpreadsheet = SpreadsheetApp.openById(sourceTemplateId);
	var sourceMonths = ct_getCurrentAndNextMonths_(sourceTemplateSpreadsheet, null, contextDateOverride);
	if (!sourceMonths.current || !sourceMonths.current.sheetId) {
		throw new Error('source_current_tracker_not_found');
	}
	var destinationMonths = ct_getCurrentAndNextMonths_(destinationTemplateSpreadsheet, null, contextDateOverride);
	if (!destinationMonths.current || !destinationMonths.current.sheetId) {
		throw new Error('destination_current_tracker_not_found');
	}

	var sourceTrackerSpreadsheet = SpreadsheetApp.openById(sourceMonths.current.sheetId);
	var destinationTrackerSpreadsheet = SpreadsheetApp.openById(destinationMonths.current.sheetId);

	var sourceSheetNamesPresent = {};
	TRACKER_DATA_SHEET_NAMES_.forEach(function(name) {
		sourceSheetNamesPresent[name] = !!sourceTrackerSpreadsheet.getSheetByName(name);
	});
	var plan = planTrackerDataSheetCopy_(TRACKER_DATA_SHEET_NAMES_, sourceSheetNamesPresent);

	plan.forEach(function(step) {
		if (step.action === 'skip') {
			logFn('  ⚠️  Skipping "' + step.name + '" — not found on source tracker.');
			return;
		}
		var sourceSheet = sourceTrackerSpreadsheet.getSheetByName(step.name);
		var destinationSheet = destinationTrackerSpreadsheet.getSheetByName(step.name);
		if (!destinationSheet) {
			logFn('  ⚠️  Skipping "' + step.name + '" — not found on destination tracker.');
			step.action = 'skip';
			return;
		}
		try {
			var result = copyTrackerDataSheetValues_(sourceSheet, destinationSheet, logFn);
			logFn('  Copied "' + step.name + '": ' + result.cols + ' column(s) x ' + result.rows + ' row(s) from source into destination tracker' +
				(result.skippedFormulaColumns.length ? ' (' + result.skippedFormulaColumns.length + ' formula column(s) left untouched)' : '') + '.');
		} catch (err) {
			throw new Error('Failed copying "' + step.name + '" sheet: ' + err.message);
		}
	});

	ct_wipePaxCacheAndRelatedCachesForSheet_(destinationMonths.current.sheetId);
	logFn('Wiped PaxCache/dashboard caches for destination sheetId=' + destinationMonths.current.sheetId + '.');
	// scanTrackers (go30tools.js) is called bare, same convention as WebApp.js's
	// adminRunScanTrackers_ — it's GAS-orchestration-only (folder walk + full TrackerDB/PaxDB
	// rebuild), never unit-tested, so it isn't wired through gasRequire_ like the pure helpers
	// above.
	var scanResult = scanTrackers();
	logFn('Ran scanTrackers() to resync TrackerDB/PaxDB: ' + JSON.stringify(scanResult));

	return {
		ok: true,
		sourceSheetId: sourceMonths.current.sheetId,
		destinationSheetId: destinationMonths.current.sheetId,
		sheets: plan,
		scanResult: scanResult
	};
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		selectRecentRealTrackerRows_: selectRecentRealTrackerRows_,
		buildCopiedTrackerDbRow_: buildCopiedTrackerDbRow_,
		TRACKER_DATA_SHEET_NAMES_: TRACKER_DATA_SHEET_NAMES_,
		planTrackerDataSheetCopy_: planTrackerDataSheetCopy_,
		planTrackerDataColumnOverlay_: planTrackerDataColumnOverlay_,
		copyCurrentMonthTrackerDataFromSource_: copyCurrentMonthTrackerDataFromSource_,
		computeSafeConfigDefaults_: computeSafeConfigDefaults_,
		buildRenamedTrackerName_: buildRenamedTrackerName_,
		applySafeConfigDefaults_: applySafeConfigDefaults_,
		copyTemplateToNewEnvironment_: copyTemplateToNewEnvironment_,
		teardownNamespaceEnvironment_: teardownNamespaceEnvironment_
	};
}
