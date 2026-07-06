/**
 * CopyTemplate — stands up a brand-new, fully isolated environment by copying the Template
 * spreadsheet (its bound script comes along automatically, since Drive file copies of a
 * container-bound spreadsheet duplicate the bound Apps Script project too) plus the N most
 * recent real monthly tracker spreadsheets into a new Drive folder, then rebuilds that copy's
 * TrackerDB/PaxDB sheets from scratch using only the copied trackers' (new) SheetIds.
 *
 * Deliberately does NOT touch triggers, HC Forms, TinyURL short links, or deploy anything —
 * this only gets the files in place. Manually initializing/deploying the new environment is
 * left to the operator (see docs/OPERATIONS.md §CopyTemplate).
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

var copyTemplateGo30ToolsModule_ = (typeof module !== 'undefined' && module.exports)
	? require('./go30tools.js')
	: null;
var copyTemplateUtilitiesModule_ = (typeof module !== 'undefined' && module.exports)
	? require('./Utilities.js')
	: null;
var ct_upsertConfigSheetRow_ = (copyTemplateUtilitiesModule_ && copyTemplateUtilitiesModule_.upsertConfigSheetRow_) ||
	(typeof globalThis !== 'undefined' && globalThis.upsertConfigSheetRow_);
var ct_readTrackerDbRowsBySheetId_ = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._readTrackerDbRowsBySheetId_) ||
	(typeof globalThis !== 'undefined' && globalThis._readTrackerDbRowsBySheetId_);
var ct_computeTrackerMetrics_ = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._computeTrackerMetrics_) ||
	(typeof globalThis !== 'undefined' && globalThis._computeTrackerMetrics_);
var ct_buildTrackerMetadata_ = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._buildTrackerMetadata_) ||
	(typeof globalThis !== 'undefined' && globalThis._buildTrackerMetadata_);
var ct_loadPaxData = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._loadPaxData) ||
	(typeof globalThis !== 'undefined' && globalThis._loadPaxData);
var ct_updateTrackerDB = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._updateTrackerDB) ||
	(typeof globalThis !== 'undefined' && globalThis._updateTrackerDB);
var ct_updatePaxDB = (copyTemplateGo30ToolsModule_ && copyTemplateGo30ToolsModule_._updatePaxDB) ||
	(typeof globalThis !== 'undefined' && globalThis._updatePaxDB);

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
 * Copies the Template (+ bound script) and the `trackerCount` most recent real monthly
 * trackers into a new sibling Drive folder named `folderName`, then rebuilds the copy's
 * TrackerDB/PaxDB from scratch using only those copied trackers.
 * @param {string} folderName
 * @param {number=} trackerCount Defaults to 3.
 * @param {function(string)=} logFn Progress callback.
 * @returns {{newFolderId, newFolderUrl, newTemplateId, newTemplateUrl, copiedTrackers: Array}}
 */
function copyTemplateToNewEnvironment_(folderName, trackerCount, logFn) {
	logFn = logFn || function() {};
	trackerCount = trackerCount || 3;

	if (!folderName || !String(folderName).trim()) {
		throw new Error('folderName is required');
	}

	var templateSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var templateFile = DriveApp.getFileById(templateSpreadsheet.getId());
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

	return {
		newFolderId: newFolder.getId(),
		newFolderUrl: newFolder.getUrl(),
		newTemplateId: newTemplateId,
		newTemplateUrl: newTemplateFile.getUrl(),
		copiedTrackers: copiedTrackers
	};
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		selectRecentRealTrackerRows_: selectRecentRealTrackerRows_,
		buildCopiedTrackerDbRow_: buildCopiedTrackerDbRow_,
		computeSafeConfigDefaults_: computeSafeConfigDefaults_,
		buildRenamedTrackerName_: buildRenamedTrackerName_,
		applySafeConfigDefaults_: applySafeConfigDefaults_,
		copyTemplateToNewEnvironment_: copyTemplateToNewEnvironment_
	};
}
