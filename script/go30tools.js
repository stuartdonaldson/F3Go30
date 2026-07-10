/** scanTrackers() 
* Scans the current folder for Google spreadsheets that contain a Tracker sheet with
* at least 10 rows of Data. and updates the TrackerDB with with data from those sheets.
* Examines the Tracker sheet and updates the Total PAX, Total Teams and Average score columns.
* Factors out private functions to _loadTrackerData(sheetId) to load the tracker data from that
* sheet and _updateTrackerDB(data) to update the TrackerDB with the data from the tracker sheets.
*
* The Creates or updates TrackerDB sheet with the following columns:
*   Date Modified - spreadsheet modified date
*   StartDate - start date of the tracker
*   SpreadsheetName - name of the spreadsheet
*   ShortTracker - shortened URL of the tracker (if known)
*   TrackerURL - URL of the tracker spreadsheet)
*   ShortHC - short name of the HC (shortened URL if known)
*   HC URL - URL of the HC Form
*   SheetId - ID of the sheet
*   FormId - ID of the form
*   TotalPAX - total number of PAX in the tracker
*   TotalTeams - total number of teams in the tracker
*   AverageScore - average score of the teams in the tracker
*   LastSignupAt - timestamp of the most recent signup event for this tracker
*   TriggersInitializedAt - timestamp when trigger initialization last completed
*   LastMinusOneRunAt - timestamp of the latest minus-one nightly run
*   LastNagRunAt - timestamp of the latest nag email trigger run
*/

var TRACKER_DB_SHEET_NAME_ = 'TrackerDB';
var NAMESPACE_DB_SHEET_NAME_ = 'NamespaceDB';
// Canonical NamespaceDB header row (ADR-014 D6/D7). Single source of truth for the columns
// buildNamespaceRegistryRow_ writes and _lookupNamespaceRegistryRow_ reads; also used to
// seed the sheet when a registry deployment has none yet (appendNamespaceRegistryRow_).
var NAMESPACE_DB_HEADERS_ = [
	'NameSpace',
	'TemplateId',
	'Kind',
	'NagEnabled',
	'MinusOneEnabled',
	'AutoGenerateEnabled',
	'CleanupSessionsEnabled'
];
var ALL_GO30_ROOT_FOLDER_ID_ = '1bMf--vyEqu8_F1NskrMbJ0cusRrR-plr';
var TRACKER_DB_HEADERS_ = [
	'Date Modified',
	'StartDate',
	'SpreadsheetName',
	'ShortTracker',
	'TrackerURL',
	'ShortHC',
	'HC URL',
	'SheetId',
	'FormId',
	'TotalPAX',
	'TotalTeams',
	'AverageScore',
	'LastSignupAt',
	'TriggersInitializedAt',
	'LastMinusOneRunAt',
	'LastNagRunAt'
];

var TRACKER_DB_LIFECYCLE_FIELDS_ = ['lastSignupAt', 'triggersInitializedAt', 'lastMinusOneRunAt', 'lastNagRunAt'];

var PAX_DB_SHEET_NAME_ = 'PaxDB';
var PAX_DB_HEADERS_ = [
	'SheetId',
	'Date',
	'F3 Name',
	'Team',
	'WHO',
	'WHAT',
	'HOW',
	'Comments',
	'Hit',
	'Miss',
	'NoCheckin',
	'Fellowship',
	'Q Point',
	'Inspire',
	'EHing FNG',
	'Email',
	'Team Type',
	'Other Team',
	'Phone',
	'NAG Email'
];

/**
 * Scans sibling tracker spreadsheets in the active spreadsheet folder and refreshes TrackerDB/PaxDB.
 * Source qualification (F3Go30-xj1q.2): every file found in the folder walk is checked
 * against _qualifySourceFiles_ before scanning — a name containing "(Smoke)"/"(Expired)" is
 * excluded by default so a stray smoke/expired tracker left in the folder never silently
 * pollutes TrackerDB/PaxDB. Headless callers (admin action, time trigger) get exclusion +
 * a GasLogger warning enumerating what was skipped, with no prompt. Interactive callers
 * (opts.interactive === true, i.e. invoked from an onOpen menu item with a UI available)
 * are offered include/exclude/remove per run, default exclude.
 * @param {{interactive?: boolean}=} opts interactive: true when called from a UI context
 *   (SpreadsheetApp.getUi() must be available) — offers an include/exclude/remove prompt
 *   for any smoke/expired artifacts found instead of silently excluding them. Omit/false
 *   for headless (admin action / time trigger) callers.
 * @returns {{scanned: number, processed: number, unchanged: number, tracked: number, skipped: number}} Run summary.
 */
function scanTrackers(opts) {
	opts = opts || {};
	return GasLogger.run('scanTrackers', function() {
		var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
		var parentFolder = _getFirstParentFolder_(activeSpreadsheet.getId());
		if (!parentFolder) {
			throw new Error('scanTrackers: active spreadsheet is not in a Drive folder.');
		}
		var filesById = _collectSheetFilesInFolder_(parentFolder);
		var qualified = _qualifySourceFiles_(filesById);
		var finalFilesById = qualified.included;

		if (qualified.excluded.length) {
			if (opts.interactive) {
				finalFilesById = _resolveSmokeArtifactsInteractively_(qualified);
			} else {
				_logExcludedSourceArtifacts_(qualified.excluded, 'scanTrackers');
			}
		}

		return _scanSheetFilesById_(finalFilesById, 'scanTrackers');
	});
}

/**
 * Pure source-qualification filter for the scanTrackers folder walk (F3Go30-xj1q.2). Excludes
 * any file whose name contains "(Smoke)" or "(Expired)" (same convention as CopyTemplate.js's
 * selectRecentRealTrackerRows_, which applies the equivalent filter to TrackerDB rows rather
 * than a folder walk). No Drive/Sheets calls, so it's unit-testable without live GAS services.
 * @param {Object<string,{id:string,name:string,lastUpdated:Date}>} filesById From _collectSheetFilesInFolder_.
 * @returns {{included: Object<string,Object>, excluded: Array<{id:string,name:string,reason:string}>}}
 */
function _qualifySourceFiles_(filesById) {
	var included = {};
	var excluded = [];

	Object.keys(filesById || {}).forEach(function(sheetId) {
		var fileMeta = filesById[sheetId] || {};
		var name = fileMeta.name || '';
		var reason = null;

		if (name.indexOf('(Smoke)') !== -1) {
			reason = 'name_smoke';
		} else if (name.indexOf('(Expired)') !== -1) {
			reason = 'name_expired';
		}

		if (reason) {
			excluded.push({ id: sheetId, name: name, reason: reason, fileMeta: fileMeta });
		} else {
			included[sheetId] = fileMeta;
		}
	});

	return { included: included, excluded: excluded };
}

/**
 * Headless-path logging for excluded smoke/expired artifacts — never prompts, just records a
 * warning enumerating what was skipped so a headless run (admin action / time trigger) never
 * silently includes smoke data. Also reaches Logger.log via GasLogger.log (see GasLogger.js),
 * so it's visible in Stackdriver/clasp logs even without an Axiom sink configured.
 * @param {Array<{id:string,name:string,reason:string}>} excluded
 * @param {string} sourceLabel
 */
function _logExcludedSourceArtifacts_(excluded, sourceLabel) {
	GasLogger.log(sourceLabel + '.smokeArtifactsExcluded', {
		message: 'WARNING: excluded ' + excluded.length + ' smoke/expired artifact(s) from scan',
		count: excluded.length,
		artifacts: excluded.map(function(a) { return a.name + ' [' + a.reason + ']'; })
	});
}

/**
 * Interactive-path resolution for excluded smoke/expired artifacts — only reachable when
 * scanTrackers() is called with opts.interactive === true from a context where
 * SpreadsheetApp.getUi() is available (an onOpen menu item; there is no such menu item yet —
 * see F3Go30-xj1q.3's planned collapse of CopyTemplate onto scanTrackers). Not unit-testable
 * (Apps Script UI dialogs have no Node stand-in); kept deliberately thin — all the
 * unit-testable logic (qualification, logging) lives in _qualifySourceFiles_ /
 * _logExcludedSourceArtifacts_ above, this function only interprets the button the operator
 * pressed.
 *
 * ui.alert only supports OK/CANCEL, YES/NO, YES/NO/CANCEL button sets — there is no native
 * three-choice "include/exclude/remove" prompt, so this asks once per excluded artifact using
 * YES = include, NO = exclude (default; also what closing the dialog does), CANCEL = remove
 * (cleanupTracker the smoke artifact via cleanupTrackerArtifact_, then exclude it from this
 * scan since it no longer exists).
 * @param {{included: Object<string,Object>, excluded: Array<{id:string,name:string,reason:string}>}} qualified
 * @returns {Object<string,Object>} The final filesById to scan.
 */
function _resolveSmokeArtifactsInteractively_(qualified) {
	var ui = SpreadsheetApp.getUi();
	var finalFilesById = Object.assign({}, qualified.included);

	qualified.excluded.forEach(function(artifact) {
		var response = ui.alert(
			'Smoke/expired tracker found',
			'"' + artifact.name + '" looks like a smoke or expired tracker (' + artifact.reason + ').\n\n' +
			'Include it in this scan? YES = include, NO = exclude (default), CANCEL = remove it now.',
			ui.ButtonSet.YES_NO_CANCEL
		);

		if (response === ui.Button.YES) {
			GasLogger.log('scanTrackers.smokeArtifactIncluded', { fileId: artifact.id, fileName: artifact.name, reason: artifact.reason });
			finalFilesById[artifact.id] = artifact.fileMeta;
		} else if (response === ui.Button.CANCEL) {
			try {
				var result = cleanupTrackerArtifact_(artifact.id, true);
				GasLogger.log('scanTrackers.smokeArtifactRemoved', Object.assign({ fileId: artifact.id, fileName: artifact.name }, result));
			} catch (e) {
				GasLogger.log('scanTrackers.smokeArtifactRemoveFailed', { fileId: artifact.id, fileName: artifact.name, error: e.message });
				ui.alert('Could not remove "' + artifact.name + '": ' + e.message);
			}
			// Removed (or attempted) — either way, exclude from this scan.
		} else {
			GasLogger.log('scanTrackers.smokeArtifactExcluded', { fileId: artifact.id, fileName: artifact.name, reason: artifact.reason });
		}
	});

	return finalFilesById;
}

/**
 * Recursively scans ALL Go30 tracker spreadsheets under the configured root folder and
 * completely rebuilds TrackerDB/PaxDB from scratch.
 *
 * DANGEROUS — not part of normal operation. Use scanTrackers() (sibling-folder, incremental)
 * for routine maintenance. This function walks every historical folder, overwrites PaxDB with
 * whatever it finds, and can corrupt live data if run while incremental upserts are active.
 * Reserved for disaster recovery or one-off historical data extraction only.
 * @returns {{scanned: number, processed: number, unchanged: number, tracked: number, skipped: number}}
 */
function paxDbHistoricalRebuild() {
	return GasLogger.run('paxDbHistoricalRebuild', function() {
		Logger.log('[paxDbHistoricalRebuild] WARNING: full recursive rebuild — overwrites all of ' +
			'TrackerDB and PaxDB. Do not run during normal operation.');
		var filesById = _collectSheetFilesInFolderTree_(ALL_GO30_ROOT_FOLDER_ID_);
		return _scanSheetFilesById_(filesById, 'paxDbHistoricalRebuild');
	});
}

function _scanSheetFilesById_(filesById, sourceLabel) {
	var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var trackerState = _readTrackerDbRowsBySheetId_(activeSpreadsheet);
	var paxState = _readPaxDbRowsBySheetId_(activeSpreadsheet);
	var fileIds = Object.keys(filesById || {}).sort();
	var trackerRows = [];
	var paxRows = [];
	var scanned = 0;
	var processed = 0;
	var unchanged = 0;
	var skipped = 0;

	for (var f = 0; f < fileIds.length; f++) {
		var sheetId = fileIds[f];
		var fileMeta = filesById[sheetId] || {};
		var fileName = fileMeta.name || 'unknown';
		var modifiedAt = fileMeta.lastUpdated || null;
		scanned += 1;

		try {
			var existingTracker = trackerState.bySheetId[sheetId] || null;
			var existingModified = _parseDateish_(existingTracker && existingTracker.dateModified);
			var shouldProcess = !existingModified || (modifiedAt && modifiedAt.getTime() > existingModified.getTime());

			if (!shouldProcess) {
				unchanged += 1;
				var unchangedPaxCount = 0;
				if (existingTracker) trackerRows.push(existingTracker);
				if (paxState.bySheetId[sheetId]) {
					Array.prototype.push.apply(paxRows, paxState.bySheetId[sheetId]);
					unchangedPaxCount = paxState.bySheetId[sheetId].length;
				}
				GasLogger.log(sourceLabel + '.fileSkipped', { fileId: sheetId, fileName: fileName, reason: 'unchanged_not_rescanned', fileDate: _formatLogDate_(modifiedAt), pax: unchangedPaxCount });
				continue;
			}

			var spreadsheet = SpreadsheetApp.openById(sheetId);
			var trackerResult = _loadTrackerData(spreadsheet, existingTracker, modifiedAt);
			if (!trackerResult.data) {
				var rejectedPaxCount = 0;
				if (existingTracker) {
					trackerRows.push(existingTracker);
					if (paxState.bySheetId[sheetId]) {
						Array.prototype.push.apply(paxRows, paxState.bySheetId[sheetId]);
						rejectedPaxCount = paxState.bySheetId[sheetId].length;
					}
				}
				skipped += 1;
				GasLogger.log(sourceLabel + '.fileRejected', { fileId: sheetId, fileName: fileName, reason: trackerResult.reason, fileDate: _formatLogDate_(modifiedAt), pax: rejectedPaxCount });
				continue;
			}

			processed += 1;
			var trackerData = trackerResult.data;
			trackerRows.push(trackerData);
			var currentPaxRows = _loadPaxData(spreadsheet, sheetId, trackerData.startDate);
			Array.prototype.push.apply(
				paxRows,
				currentPaxRows
			);
			GasLogger.log(sourceLabel + '.fileIncluded', { fileId: sheetId, fileName: fileName, fileDate: _formatLogDate_(modifiedAt), pax: currentPaxRows.length });
		} catch (err) {
			skipped += 1;
			var errorPaxCount = 0;
			if (trackerState.bySheetId[sheetId]) {
				trackerRows.push(trackerState.bySheetId[sheetId]);
				if (paxState.bySheetId[sheetId]) {
					Array.prototype.push.apply(paxRows, paxState.bySheetId[sheetId]);
					errorPaxCount = paxState.bySheetId[sheetId].length;
				}
			}
			GasLogger.log(sourceLabel + '.fileError', { fileId: sheetId, fileName: fileName, error: err.message, fileDate: _formatLogDate_(modifiedAt), pax: errorPaxCount });
		} finally {
			SpreadsheetApp.flush();
		}
	}

	_updateTrackerDB(_mergeTrackerDbRowsForScan_(trackerState.bySheetId, trackerRows));
	_updatePaxDB(paxRows);
	GasLogger.log(sourceLabel + '.summary', { scanned: scanned, processed: processed, unchanged: unchanged, tracked: trackerRows.length, skipped: skipped, pax: paxRows.length });
	return {
		scanned: scanned,
		processed: processed,
		unchanged: unchanged,
		tracked: trackerRows.length,
		skipped: skipped
	};
}

function _collectSheetFilesInFolder_(folder) {
	var filesById = {};
	if (!folder) return filesById;

	var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
	while (files.hasNext()) {
		var file = files.next();
		filesById[file.getId()] = {
			id: file.getId(),
			name: file.getName(),
			lastUpdated: file.getLastUpdated()
		};
	}

	return filesById;
}

function _collectSheetFilesInFolderTree_(rootFolderId) {
	var rootFolder = DriveApp.getFolderById(rootFolderId);
	var filesById = {};
	_collectSheetFilesRecursive_(rootFolder, filesById);
	return filesById;
}

function _collectSheetFilesRecursive_(folder, filesById) {
	if (!folder) return;

	var folderFiles = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
	while (folderFiles.hasNext()) {
		var file = folderFiles.next();
		filesById[file.getId()] = {
			id: file.getId(),
			name: file.getName(),
			lastUpdated: file.getLastUpdated()
		};
	}

	var childFolders = folder.getFolders();
	while (childFolders.hasNext()) {
		_collectSheetFilesRecursive_(childFolders.next(), filesById);
	}
}

/**
 * Loads tracker summary data from a spreadsheet.
 * Returns null when the spreadsheet does not look like a valid monthly tracker.
 * @param {Spreadsheet} spreadsheet Spreadsheet object.
 * @param {Object=} linkMetadata Optional existing TrackerDB row for this SheetId (lineage metadata).
 * @param {Date=} modifiedAt Last modified timestamp from Drive metadata.
 * @returns {{data: Object|null, reason: string}} Result containing row data or rejection reason.
 */
function _loadTrackerData(spreadsheet, linkMetadata, modifiedAt) {
	var sheetId = spreadsheet.getId();
	var trackerSheet = spreadsheet.getSheetByName('Tracker');
	if (!trackerSheet) return { data: null, reason: 'missing_tracker_sheet' };

	var trackerValues = trackerSheet.getDataRange().getValues();
	if (!trackerValues || trackerValues.length < 4) return { data: null, reason: 'insufficient_tracker_rows' };

	var metrics = _computeTrackerMetrics_(trackerValues);
	if (metrics.totalPax < 10) return { data: null, reason: 'total_pax_lt_10' };

	var metadata = _buildTrackerMetadata_(spreadsheet, trackerSheet, trackerValues, linkMetadata);
	var lifecycleFields = _carryForwardLifecycleFields_(linkMetadata);
	var data = {
		dateModified: modifiedAt || new Date(),
		startDate: metadata.startDate,
		spreadsheetName: spreadsheet.getName(),
		shortTracker: metadata.shortTracker,
		trackerUrl: metadata.trackerUrl,
		shortHc: metadata.shortHc,
		hcUrl: metadata.hcUrl,
		sheetId: sheetId,
		formId: metadata.formId,
		totalPax: metrics.totalPax,
		totalTeams: metrics.totalTeams,
		averageScore: metrics.averageScore
	};
	TRACKER_DB_LIFECYCLE_FIELDS_.forEach(function(key) {
		data[key] = lifecycleFields[key];
	});

	return { data: data, reason: 'included' };
}

function _formatLogDate_(value) {
	if (!value) return 'unknown';
	if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
	var parsed = _parseDateish_(value);
	if (parsed) return parsed.toISOString().slice(0, 10);

	var text = String(value || '');
	var match = text.match(/\d{4}-\d{2}-\d{2}/);
	return match ? match[0] : text;
}

/**
 * Loads normalized Responses records for PaxDB from a tracker spreadsheet.
 * @param {Spreadsheet} spreadsheet Spreadsheet object.
 * @param {string} sheetId Spreadsheet ID.
 * @param {Date|string=} startDate Sheet-level date used for PaxDB Date column.
 * @returns {Array<Object>} Pax rows.
 */
function _loadPaxData(spreadsheet, sheetId, startDate) {
	var responsesSheet = spreadsheet.getSheetByName('Responses');
	if (!responsesSheet) return [];
	var trackerStatsByName = _buildTrackerPaxStatsByName_(spreadsheet.getSheetByName('Tracker'));

	var values = responsesSheet.getDataRange().getValues();
	if (!values || values.length < 2) return [];

	var headers = values[0] || [];
	var indexer = _buildSoftHeaderMatcher_(headers);

	var nameIdx = indexer.find([
		'F3 Name',
		'Name'
	]);
	var teamIdx = indexer.find([
		'Team',
		'Goal / Team',
		'Goal selection',
		'What is your goal?',
		'Other team name'
	]);
	var whoIdx = indexer.find([
		'WHO do you ultimately want to become?',
		'Who do you ultimately want to become?',
		'Who'
	]);
	var whatIdx = indexer.find([
		'WHAT is your Go30 Challenge?',
		'What is your Go30 Challenge?',
		'What'
	]);
	var howIdx = indexer.find([
		'HOW are you going to be successful this month?',
		'How are you going to be successful this month?',
		'How'
	]);
	var emailIdx = indexer.find(['Email Address', 'Email']);
	var teamTypeIdx = indexer.find(['Team type']);
	var otherTeamIdx = indexer.find(['Goal or other team name', 'Other team name']);
	var phoneIdx = indexer.find(['Cell Phone Number', 'Phone']);
	var nagEmailIdx = indexer.find(['NAG email?', 'NAG Email']);
	var commentsIndexes = _findAllResponseCommentIndexes_(indexer);

	if (nameIdx === -1) return [];

	var sheetDate = _parseDateish_(startDate) || '';
	var paxRows = [];

	for (var i = 1; i < values.length; i++) {
		var row = values[i] || [];
		if (_isDeletedResponseRow_(row, indexer)) continue;

		var f3Name = _normalizeCellText_(row[nameIdx]);
		if (!f3Name) continue;
		var trackerStats = trackerStatsByName[f3Name.toLowerCase()] || _buildEmptyTrackerPaxStats_();

		paxRows.push({
			sheetId: sheetId,
			date: sheetDate,
			f3Name: f3Name,
			team: teamIdx === -1 ? '' : _normalizeCellText_(row[teamIdx]),
			who: whoIdx === -1 ? '' : _normalizeCellText_(row[whoIdx]),
			what: whatIdx === -1 ? '' : _normalizeCellText_(row[whatIdx]),
			how: howIdx === -1 ? '' : _normalizeCellText_(row[howIdx]),
			comments: _collectCommentsForRow_(row, commentsIndexes),
			hit: trackerStats.hit,
			miss: trackerStats.miss,
			noCheckin: trackerStats.noCheckin,
			fellowship: trackerStats.fellowship,
			qPoint: trackerStats.qPoint,
			inspire: trackerStats.inspire,
			ehingFng: trackerStats.ehingFng,
			email: emailIdx === -1 ? '' : _normalizeCellText_(row[emailIdx]),
			teamType: teamTypeIdx === -1 ? '' : _normalizeCellText_(row[teamTypeIdx]),
			otherTeam: otherTeamIdx === -1 ? '' : _normalizeCellText_(row[otherTeamIdx]),
			phone: phoneIdx === -1 ? '' : _normalizeCellText_(row[phoneIdx]),
			nagEmail: nagEmailIdx === -1 ? '' : _normalizeCellText_(row[nagEmailIdx])
		});
	}

	return paxRows;
}

/**
 * Resolves the single TrackerDB row "active" for a context date. A row is active from
 * its own StartDate up to (but not including) the next row's StartDate, sorted ascending;
 * the latest row's range is open-ended. Rows sharing an identical StartDate make that
 * range ambiguous. Per ADR-010, lookup failures (zero or multiple matches) must fail
 * loudly — this throws rather than returning null or guessing, so callers must log/handle
 * the error explicitly instead of silently skipping or picking an arbitrary row.
 * @param {Array<Object>} rows TrackerDB rows (each with at least a startDate and sheetId).
 * @param {Date|string} contextDate The date to resolve a tracker for.
 * @returns {Object} The single matching TrackerDB row.
 * @throws {Error} When zero or more than one row matches the context date.
 */
function resolveTrackerDbRowForContextDate_(rows, contextDate) {
	var context = contextDate instanceof Date ? contextDate : new Date(contextDate);
	if (isNaN(context.getTime())) {
		throw new Error('resolveTrackerDbRowForContextDate_: invalid context date: ' + contextDate);
	}
	var contextTime = context.getTime();

	var groupsByTime = {};
	(rows || []).forEach(function(row) {
		var startDate = _parseDateish_(row && row.startDate);
		if (!startDate) return;
		var time = startDate.getTime();
		if (!groupsByTime[time]) groupsByTime[time] = [];
		groupsByTime[time].push(row);
	});

	var sortedTimes = Object.keys(groupsByTime).map(Number).sort(function(a, b) { return a - b; });

	for (var i = 0; i < sortedTimes.length; i++) {
		var startTime = sortedTimes[i];
		var rangeEnd = (i + 1 < sortedTimes.length) ? sortedTimes[i + 1] : Infinity;
		if (contextTime < startTime || contextTime >= rangeEnd) continue;

		var group = groupsByTime[startTime];
		if (group.length > 1) {
			var sheetIds = group.map(function(row) { return row && row.sheetId; }).join(', ');
			throw new Error('resolveTrackerDbRowForContextDate_: ambiguous match for context date ' +
				context.toISOString() + ' — multiple TrackerDB rows share StartDate; SheetIds: ' + sheetIds);
		}
		return group[0];
	}

	throw new Error('resolveTrackerDbRowForContextDate_: no TrackerDB row matches context date ' + context.toISOString());
}

/**
 * Reads the active spreadsheet's TrackerDB sheet and resolves the row active for a
 * context date. Thin GAS-facing wrapper around resolveTrackerDbRowForContextDate_ —
 * dispatch functions (minus-one, nag, form-submit) should call this rather than
 * implementing their own TrackerDB matching.
 * @param {Date|string=} contextDate Defaults to now.
 * @returns {Object} The single matching TrackerDB row.
 * @throws {Error} When zero or more than one row matches the context date.
 */
function resolveTrackerForContextDate(contextDate, spreadsheet) {
	// spreadsheet defaults to the bound one (trigger/admin callers), but request-driven callers
	// resolving tenant data under a namespace pass the ns-resolved template so date-based
	// dispatch reads THAT environment's TrackerDB, not the executing deployment's (ADR-014 D1).
	if (!spreadsheet) spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var trackerState = _readTrackerDbRowsBySheetId_(spreadsheet);
	var rows = Object.keys(trackerState.bySheetId).map(function(sheetId) {
		return trackerState.bySheetId[sheetId];
	});
	return resolveTrackerDbRowForContextDate_(rows, contextDate || new Date());
}

/**
 * Writes TrackerDB rows, replacing existing body rows while preserving the sheet.
 * @param {Array<Object>} rows Tracker summary rows.
 */
function _updateTrackerDB(rows, spreadsheet) {
	if (!spreadsheet) spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var sheet = spreadsheet.getSheetByName(TRACKER_DB_SHEET_NAME_);
	if (!sheet) {
		sheet = spreadsheet.insertSheet(TRACKER_DB_SHEET_NAME_);
	}

	if (sheet.getMaxRows() > 1) {
		sheet.getRange(2, 1, sheet.getMaxRows() - 1, TRACKER_DB_HEADERS_.length).clearContent();
	}

	var headerRange = sheet.getRange(1, 1, 1, TRACKER_DB_HEADERS_.length);
	headerRange.setValues([TRACKER_DB_HEADERS_]);
	headerRange.setFontWeight('bold');

	var outputRows = (rows || []).slice();
	outputRows.sort(function(a, b) {
		var aTime = _toSortableTime_(a && a.startDate);
		var bTime = _toSortableTime_(b && b.startDate);
		return bTime - aTime;
	});

	if (!outputRows.length) {
		return;
	}

	var values = outputRows.map(function(row) {
		return [
			row.dateModified || '',
			row.startDate || '',
			row.spreadsheetName || '',
			row.shortTracker || '',
			row.trackerUrl || '',
			row.shortHc || '',
			row.hcUrl || '',
			row.sheetId || '',
			row.formId || '',
			row.totalPax || 0,
			row.totalTeams || 0,
			row.averageScore || 0,
			row.lastSignupAt || '',
			row.triggersInitializedAt || '',
			row.lastMinusOneRunAt || '',
			row.lastNagRunAt || ''
		];
	});

	sheet.getRange(2, 1, values.length, TRACKER_DB_HEADERS_.length).setValues(values);
}

/**
 * Removes a single TrackerDB row by sheetId from the active spreadsheet's TrackerDB sheet,
 * preserving every other row. Exact sheetId match only — never a wildcard or name-based
 * match — so this can't accidentally remove the wrong tracker. Used for cleaning up
 * orphaned rows left behind by a failed/aborted autoGenerateNextMonthTracker_ run
 * (F3Go30-w6y3).
 * @param {string} sheetId
 * @returns {boolean} true if a matching row was found and removed, false otherwise.
 */
function removeTrackerDbRow_(sheetId) {
	if (!sheetId) {
		throw new Error('removeTrackerDbRow_: sheetId is required');
	}
	var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var trackerState = _readTrackerDbRowsBySheetId_(spreadsheet);
	if (!trackerState.bySheetId[sheetId]) {
		return false;
	}
	delete trackerState.bySheetId[sheetId];

	var rows = Object.keys(trackerState.bySheetId).map(function(id) {
		return trackerState.bySheetId[id];
	});
	_updateTrackerDB(rows);
	return true;
}

/**
 * Removes a tracker from TrackerDB, its PaxDB rows, and optionally trashes the spreadsheet and
 * its linked HC form. Primary use case: smoke test teardown (WebApp.js's `cleanupTracker` admin
 * action, and scanTrackers()'s interactive "remove" choice — F3Go30-xj1q.2 — both call this
 * single implementation so cleanup behavior can't drift between the two entry points).
 * Order: unlink form -> trash form -> trash spreadsheet (GAS blocks trashing a spreadsheet
 * while a live form destination points at it).
 * @param {string} sheetId
 * @param {boolean=} trashSpreadsheet Also trash the spreadsheet file (and its linked HC form). Default false.
 * @returns {{trackerRemoved: boolean, paxRowsRemoved: number, formTrashed: boolean, trashed: boolean, triggerCleared: boolean}}
 */
function cleanupTrackerArtifact_(sheetId, trashSpreadsheet) {
	if (!sheetId) {
		throw new Error('cleanupTrackerArtifact_: sheetId is required');
	}
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	var trackerRemoved = removeTrackerDbRow_(sheetId);
	var paxRowsRemoved = deletePaxDbRowsBySheetId_(ss, sheetId);
	var formTrashed = false;
	var trashed = false;
	var triggerCleared = false;

	try {
		var triggerSs = SpreadsheetApp.openById(sheetId);
		clearFormSubmitTrigger(triggerSs);
		triggerCleared = true;
	} catch (triggerErr) {
		GasLogger.log('cleanupTrackerArtifact_.clearFormSubmitTriggerFailed', { error: triggerErr.message });
	}

	if (trashSpreadsheet) {
		try {
			var trackerSs = SpreadsheetApp.openById(sheetId);
			var linkedFormUrl = trackerSs.getFormUrl();
			if (linkedFormUrl) {
				try {
					var linkedForm = FormApp.openByUrl(linkedFormUrl);
					var formId = linkedForm.getId();
					linkedForm.removeDestination();
					DriveApp.getFileById(formId).setTrashed(true);
					GasLogger.log('cleanupTrackerArtifact_.trashForm', { formId: formId });
					formTrashed = true;
				} catch (formErr) {
					GasLogger.log('cleanupTrackerArtifact_.trashFormFailed', { error: formErr.message });
				}
			}
			DriveApp.getFileById(sheetId).setTrashed(true);
			GasLogger.log('cleanupTrackerArtifact_.trashSpreadsheet', { sheetId: sheetId });
			trashed = true;
		} catch (trashErr) {
			GasLogger.log('cleanupTrackerArtifact_.trashSpreadsheetFailed', { error: trashErr.message });
		}
	}

	GasLogger.log('cleanupTrackerArtifact_.summary', { sheetId: sheetId, trackerRemoved: trackerRemoved, paxRowsRemoved: paxRowsRemoved, formTrashed: formTrashed, trashed: trashed, triggerCleared: triggerCleared });
	return { trackerRemoved: trackerRemoved, paxRowsRemoved: paxRowsRemoved, formTrashed: formTrashed, trashed: trashed, triggerCleared: triggerCleared };
}

/**
 * Writes PaxDB rows, replacing existing body rows while preserving the sheet.
 * @param {Array<Object>} rows Pax rows.
 */
function _updatePaxDB(rows, spreadsheet) {
	if (!spreadsheet) spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var sheet = spreadsheet.getSheetByName(PAX_DB_SHEET_NAME_);
	if (!sheet) {
		sheet = spreadsheet.insertSheet(PAX_DB_SHEET_NAME_);
	}

	if (sheet.getMaxRows() > 1) {
		sheet.getRange(2, 1, sheet.getMaxRows() - 1, PAX_DB_HEADERS_.length).clearContent();
	}

	var headerRange = sheet.getRange(1, 1, 1, PAX_DB_HEADERS_.length);
	headerRange.setValues([PAX_DB_HEADERS_]);
	headerRange.setFontWeight('bold');

	if (!rows || !rows.length) return;

	var outputRows = rows.slice();
	outputRows.sort(function(a, b) {
		if (a.sheetId === b.sheetId) {
			return String(a.f3Name || '').localeCompare(String(b.f3Name || ''));
		}
		return String(a.sheetId || '').localeCompare(String(b.sheetId || ''));
	});

	var values = outputRows.map(function(row) {
		return [
			row.sheetId || '',
			row.date || '',
			row.f3Name || '',
			row.team || '',
			row.who || '',
			row.what || '',
			row.how || '',
			row.comments || '',
			row.hit || 0,
			row.miss || 0,
			row.noCheckin || 0,
			row.fellowship || 0,
			row.qPoint || 0,
			row.inspire || 0,
			row.ehingFng || 0,
			row.email || '',
			row.teamType || '',
			row.otherTeam || '',
			row.phone || '',
			row.nagEmail || ''
		];
	});

	sheet.getRange(2, 1, values.length, PAX_DB_HEADERS_.length).setValues(values);
}

function _readTrackerDbRowsBySheetId_(spreadsheet) {
	var sheet = spreadsheet.getSheetByName(TRACKER_DB_SHEET_NAME_);
	if (!sheet) return { bySheetId: {} };

	var values = sheet.getDataRange().getValues();
	if (!values || values.length < 2) return { bySheetId: {} };

	var headers = values[0] || [];
	var headerIndex = _buildHeaderIndex_(headers);
	var out = {};

	for (var i = 1; i < values.length; i++) {
		var row = values[i] || [];
		var sheetId = _getCellByHeader_(row, headerIndex, ['SheetId', 'Spreadsheet ID']);
		if (!sheetId) continue;

		out[sheetId] = {
			dateModified: _getCellValueByHeader_(row, headerIndex, ['Date Modified', 'Date']),
			startDate: _getCellValueByHeader_(row, headerIndex, ['StartDate', 'Month']),
			spreadsheetName: _getCellByHeader_(row, headerIndex, ['SpreadsheetName', 'Spreadsheet Name']),
			shortTracker: _getCellByHeader_(row, headerIndex, ['ShortTracker']),
			trackerUrl: _getCellByHeader_(row, headerIndex, ['TrackerURL', 'Tracker URL']),
			shortHc: _getCellByHeader_(row, headerIndex, ['ShortHC']),
			hcUrl: _getCellByHeader_(row, headerIndex, ['HC URL', 'Form URL']),
			sheetId: sheetId,
			formId: _getCellByHeader_(row, headerIndex, ['FormId', 'Form ID']),
			totalPax: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['TotalPAX'])]) || 0,
			totalTeams: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['TotalTeams'])]) || 0,
			averageScore: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['AverageScore'])]) || 0,
			lastSignupAt: _getCellValueByHeader_(row, headerIndex, ['LastSignupAt']),
			triggersInitializedAt: _getCellValueByHeader_(row, headerIndex, ['TriggersInitializedAt']),
			lastMinusOneRunAt: _getCellValueByHeader_(row, headerIndex, ['LastMinusOneRunAt']),
			lastNagRunAt: _getCellValueByHeader_(row, headerIndex, ['LastNagRunAt'])
		};
	}

	return { bySheetId: out };
}

/**
 * Resolves a request's target Template spreadsheet from an `ns` (namespace) request parameter,
 * per ADR-014 D1/D3. `ns` arrives as e.parameter.ns on a GET (doGet's query string) or as an
 * echoed field in the parsed POST body on a doPost action (ADR-014 D3 — the sandboxed client
 * iframe carries no query string, so ns must round-trip through the page template and every
 * callApi() body exactly like targetMonth/id already do); pass the parsed payload as the second
 * arg for POST call sites. Looks the resolved ns up against the bound spreadsheet's NamespaceDB
 * registry sheet (NameSpace -> TemplateId). Absent ns, a missing NamespaceDB sheet, or an ns not
 * present in the registry all fall back to the bound spreadsheet unchanged — this fail-safe
 * default is what stops an ANYONE_ANONYMOUS caller from ever redirecting execution to an
 * arbitrary spreadsheet id; NamespaceDB is the only allowlist consulted.
 */
function resolveTemplateSpreadsheet_(e, payload) {
	var boundSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var ns = (e && e.parameter && e.parameter.ns) || (payload && payload.ns) || '';
	if (!ns) return boundSpreadsheet;

	var templateId = _lookupNamespaceTemplateId_(boundSpreadsheet, ns);
	if (!templateId) return boundSpreadsheet;

	try {
		return SpreadsheetApp.openById(templateId);
	} catch (err) {
		GasLogger.logError('resolveTemplateSpreadsheet_.openById.error', err, { ns: ns });
		return boundSpreadsheet;
	}
}

/**
 * Looks up a namespace's full NamespaceDB registry row, per ADR-014 D2/D7. NamespaceDB is
 * the sole allowlist for ns -> templateId resolution (see resolveTemplateSpreadsheet_); this
 * also surfaces Kind and the per-trigger opt-in columns (D4 fan-out) for callers that need more
 * than the templateId. Returns null when the sheet is absent or ns isn't a registered row —
 * callers must treat null as "not allowlisted", never as permission to fall through to a
 * request-supplied id.
 */
function _lookupNamespaceRegistryRow_(boundSpreadsheet, ns) {
	var sheet = boundSpreadsheet.getSheetByName(NAMESPACE_DB_SHEET_NAME_);
	if (!sheet) return null;

	var values = sheet.getDataRange().getValues();
	if (!values || values.length < 2) return null;

	var headers = values[0] || [];
	var headerIndex = _buildHeaderIndex_(headers);

	for (var i = 1; i < values.length; i++) {
		var row = values[i] || [];
		var rowNamespace = _getCellByHeader_(row, headerIndex, ['NameSpace', 'Namespace', 'ns']);
		if (rowNamespace !== ns) continue;
		return {
			namespace: rowNamespace,
			templateId: _getCellByHeader_(row, headerIndex, ['TemplateId', 'Template Id', 'TemplateID']),
			kind: _getCellByHeader_(row, headerIndex, ['Kind']),
			nagEnabled: _isNamespaceFlagEnabled_(_getCellByHeader_(row, headerIndex, ['NagEnabled', 'Nag Enabled'])),
			minusOneEnabled: _isNamespaceFlagEnabled_(_getCellByHeader_(row, headerIndex, ['MinusOneEnabled', 'MinusOne Enabled'])),
			autoGenerateEnabled: _isNamespaceFlagEnabled_(_getCellByHeader_(row, headerIndex, ['AutoGenerateEnabled', 'AutoGenerate Enabled'])),
			cleanupSessionsEnabled: _isNamespaceFlagEnabled_(_getCellByHeader_(row, headerIndex, ['CleanupSessionsEnabled', 'CleanupSessions Enabled']))
		};
	}
	return null;
}

function _isNamespaceFlagEnabled_(val) {
	var s = String(val == null ? '' : val).trim().toLowerCase();
	return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

function _lookupNamespaceTemplateId_(boundSpreadsheet, ns) {
	var row = _lookupNamespaceRegistryRow_(boundSpreadsheet, ns);
	return row ? row.templateId : '';
}

/**
 * Builds a NamespaceDB row's field values for a newly provisioned environment (ADR-014 D6).
 * Pure — no Sheets calls — so it's unit-testable without live GAS services. Kind defaults to
 * 'smoke' (the first consumer, per ADR-014); trigger fan-out opt-ins (D4) default to blank/off
 * so a freshly provisioned namespace never joins time-trigger fan-out until an operator
 * deliberately enables it.
 * @param {{nameSpace: string, templateId: string, kind?: string, nagEnabled?: boolean,
 *   minusOneEnabled?: boolean, autoGenerateEnabled?: boolean, cleanupSessionsEnabled?: boolean}} fields
 * @returns {Object}
 */
function buildNamespaceRegistryRow_(fields) {
	fields = fields || {};
	return {
		nameSpace: String(fields.nameSpace || ''),
		templateId: String(fields.templateId || ''),
		kind: String(fields.kind || 'smoke'),
		nagEnabled: fields.nagEnabled ? 'Yes' : '',
		minusOneEnabled: fields.minusOneEnabled ? 'Yes' : '',
		autoGenerateEnabled: fields.autoGenerateEnabled ? 'Yes' : '',
		cleanupSessionsEnabled: fields.cleanupSessionsEnabled ? 'Yes' : ''
	};
}

/**
 * Appends a new row to the destination (registry) spreadsheet's NamespaceDB sheet, per
 * ADR-014 D6 — the write half of provisioning (resolveTemplateSpreadsheet_/
 * _lookupNamespaceRegistryRow_ are the read half). Header-order independent: writes each
 * field by matching the sheet's actual header row, so column order in NamespaceDB can differ
 * from the field order here. If the destination spreadsheet has no NamespaceDB sheet yet it is
 * created and seeded with NAMESPACE_DB_HEADERS_ before the append — first-registration
 * bootstrap, so a fresh registry deployment needs no manual sheet setup. This is create-then-
 * write, not silently-skip: the row is always registered or an error is thrown.
 * @param {Spreadsheet} registrySpreadsheet The destination (active) deployment's bound Template.
 * @param {Object} fields See buildNamespaceRegistryRow_.
 * @returns {Object} The row that was appended (buildNamespaceRegistryRow_'s return value).
 */
function appendNamespaceRegistryRow_(registrySpreadsheet, fields) {
	var sheet = registrySpreadsheet.getSheetByName(NAMESPACE_DB_SHEET_NAME_);
	if (!sheet) {
		sheet = registrySpreadsheet.insertSheet(NAMESPACE_DB_SHEET_NAME_);
		sheet.appendRow(NAMESPACE_DB_HEADERS_);
	}

	var row = buildNamespaceRegistryRow_(fields);
	var headers = (sheet.getDataRange().getValues() || [])[0] || [];
	var headerIndex = _buildHeaderIndex_(headers);
	var values = new Array(headers.length).fill('');

	function setColumn_(aliases, value) {
		var index = _pickHeaderIndex_(headerIndex, aliases);
		if (index !== -1) values[index] = value;
	}

	setColumn_(['NameSpace', 'Namespace', 'ns'], row.nameSpace);
	setColumn_(['TemplateId', 'Template Id', 'TemplateID'], row.templateId);
	setColumn_(['Kind'], row.kind);
	setColumn_(['NagEnabled', 'Nag Enabled'], row.nagEnabled);
	setColumn_(['MinusOneEnabled', 'MinusOne Enabled'], row.minusOneEnabled);
	setColumn_(['AutoGenerateEnabled', 'AutoGenerate Enabled'], row.autoGenerateEnabled);
	setColumn_(['CleanupSessionsEnabled', 'CleanupSessions Enabled'], row.cleanupSessionsEnabled);

	sheet.appendRow(values);
	return row;
}

/**
 * Deletes a NamespaceDB row by NameSpace — the teardown half of appendNamespaceRegistryRow_
 * (ADR-014 D6 lifecycle, i5md.4). Removing this row is the primary safety cut for environment
 * teardown: it makes the ns unresolvable via resolveTemplateSpreadsheet_ immediately,
 * independent of whether any later Drive cleanup succeeds. Never throws on a missing
 * sheet/row — teardown must be safely retriable after a partial failure.
 * @param {Spreadsheet} registrySpreadsheet
 * @param {string} ns
 * @returns {boolean} Whether a row was found and removed.
 */
function removeNamespaceRegistryRow_(registrySpreadsheet, ns) {
	var sheet = registrySpreadsheet.getSheetByName(NAMESPACE_DB_SHEET_NAME_);
	if (!sheet) return false;

	var values = sheet.getDataRange().getValues();
	if (!values || values.length < 2) return false;

	var headers = values[0] || [];
	var headerIndex = _buildHeaderIndex_(headers);
	var nsColumn = _pickHeaderIndex_(headerIndex, ['NameSpace', 'Namespace', 'ns']);
	if (nsColumn === -1) return false;

	for (var i = 1; i < values.length; i++) {
		if (values[i][nsColumn] === ns) {
			sheet.deleteRow(i + 1);
			return true;
		}
	}
	return false;
}

function _readPaxDbRowsBySheetId_(spreadsheet) {
	var sheet = spreadsheet.getSheetByName(PAX_DB_SHEET_NAME_);
	if (!sheet) return { bySheetId: {} };

	var values = sheet.getDataRange().getValues();
	if (!values || values.length < 2) return { bySheetId: {} };

	var headers = values[0] || [];
	var headerIndex = _buildHeaderIndex_(headers);
	var bySheetId = {};

	for (var i = 1; i < values.length; i++) {
		var row = values[i] || [];
		var sheetId = _getCellByHeader_(row, headerIndex, ['SheetId', 'Spreadsheet ID']);
		if (!sheetId) continue;

		if (!bySheetId[sheetId]) bySheetId[sheetId] = [];
		bySheetId[sheetId].push({
			sheetId: sheetId,
			date: _getCellValueByHeader_(row, headerIndex, ['Date']),
			f3Name: _getCellByHeader_(row, headerIndex, ['F3 Name', 'Name']),
			team: _getCellByHeader_(row, headerIndex, ['Team']),
			who: _getCellByHeader_(row, headerIndex, ['WHO', 'Who']),
			what: _getCellByHeader_(row, headerIndex, ['WHAT', 'What']),
			how: _getCellByHeader_(row, headerIndex, ['HOW', 'How']),
			comments: _getCellByHeader_(row, headerIndex, ['Comments']),
			hit: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['Hit'])]) || 0,
			miss: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['Miss'])]) || 0,
			noCheckin: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['NoCheckin', 'No Checkin'])]) || 0,
			fellowship: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['Fellowship'])]) || 0,
			qPoint: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['Q Point', 'Q-Point'])]) || 0,
			inspire: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['Inspire'])]) || 0,
			ehingFng: _toNumber_(row[_pickHeaderIndex_(headerIndex, ['EHing FNG', 'Ehing FNG'])]) || 0,
			email: _getCellByHeader_(row, headerIndex, ['Email']),
			teamType: _getCellByHeader_(row, headerIndex, ['Team Type']),
			otherTeam: _getCellByHeader_(row, headerIndex, ['Other Team']),
			phone: _getCellByHeader_(row, headerIndex, ['Phone']),
			nagEmail: _getCellByHeader_(row, headerIndex, ['NAG Email'])
		});
	}

	return { bySheetId: bySheetId };
}

var PAX_DB_FIELD_ALIASES_ = {
	sheetId: ['SheetId', 'Spreadsheet ID'],
	date: ['Date'],
	f3Name: ['F3 Name', 'Name'],
	team: ['Team'],
	who: ['WHO', 'Who'],
	what: ['WHAT', 'What'],
	how: ['HOW', 'How'],
	comments: ['Comments'],
	hit: ['Hit'],
	miss: ['Miss'],
	noCheckin: ['NoCheckin', 'No Checkin'],
	fellowship: ['Fellowship'],
	qPoint: ['Q Point', 'Q-Point'],
	inspire: ['Inspire'],
	ehingFng: ['EHing FNG', 'Ehing FNG'],
	email: ['Email'],
	teamType: ['Team Type'],
	otherTeam: ['Other Team'],
	phone: ['Phone'],
	nagEmail: ['NAG Email']
};

/** Opens the given spreadsheet's PaxDB sheet, creating it with headers if missing. */
function _openOrCreatePaxDbSheet_(spreadsheet) {
	var sheet = spreadsheet.getSheetByName(PAX_DB_SHEET_NAME_);
	if (!sheet) {
		sheet = spreadsheet.insertSheet(PAX_DB_SHEET_NAME_);
		sheet.getRange(1, 1, 1, PAX_DB_HEADERS_.length).setValues([PAX_DB_HEADERS_]).setFontWeight('bold');
	}
	return sheet;
}

/**
 * Incrementally upserts a single PaxDB row, keyed on (SheetId, F3 Name) — F3 Name matched
 * case-insensitively. Only the fields explicitly present in `fields` are written; any other
 * column on an existing row is left untouched. Creates the row if no match exists. This is
 * the live-write counterpart to the historical full-rebuild done by scanTrackers()/paxDbHistoricalRebuild()
 * — called directly from signup save (goal fields) and mark-minus-one (Hit/Miss/NoCheckin)
 * so PaxDB stays current without depending on a manual rescan.
 * @param {Spreadsheet} spreadsheet The spreadsheet whose PaxDB sheet should be updated
 *   (the Template — PaxDB only lives there).
 * @param {Object} fields Must include sheetId and f3Name; any other PAX_DB_FIELD_ALIASES_
 *   key may be included to write that column.
 * @returns {{created: boolean, row: number}} Whether a new row was appended, and its row number.
 */
/**
 * Appends a missing PaxDB column at the end, lock-guarded against a concurrent caller
 * racing to add the same column — same convention as signupWebapp.js's ensureResponseColumn_
 * for the Responses sheet.
 * @returns {boolean} true if this call added the column, false if it was already there.
 */
function _appendPaxDbColumn_(sheet, headerName) {
	var lock = LockService.getScriptLock();
	try {
		lock.waitLock(10000);
	} catch (e) {
		GasLogger.log('_appendPaxDbColumn_.lockFailed', { header: headerName, error: e.message });
		return false;
	}
	try {
		var lastColumn = sheet.getLastColumn();
		var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
		if (headers.indexOf(headerName) !== -1) return false; // already there — concurrent call won the race
		sheet.getRange(1, lastColumn + 1).setValue(headerName);
		return true;
	} finally {
		lock.releaseLock();
	}
}

function upsertPaxDbRow_(spreadsheet, fields) {
	var startedAt = Date.now();
	if (!fields || !fields.sheetId || !fields.f3Name) {
		throw new Error('upsertPaxDbRow_: sheetId and f3Name are required');
	}

	var sheet = _openOrCreatePaxDbSheet_(spreadsheet);
	var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	var headerIndex = _buildHeaderIndex_(headers);

	function colFor(field) {
		return _pickHeaderIndex_(headerIndex, PAX_DB_FIELD_ALIASES_[field] || [field]);
	}

	// Self-heal: a field with no matching column (e.g. an older PaxDB sheet predating Email/
	// Team Type/Other Team/Phone/NAG Email) must not be silently dropped — warn and add the
	// column, same convention as signupWebapp.js's ensureResponseColumn_ for the Responses sheet.
	var fieldsToWrite = Object.keys(fields).filter(function(field) { return fields[field] !== undefined; });
	var missingFields = fieldsToWrite.filter(function(field) { return colFor(field) === -1; });
	if (missingFields.length) {
		GasLogger.log('upsertPaxDbRow_.missingColumns', { sheetId: fields.sheetId, fields: missingFields });
		missingFields.forEach(function(field) {
			var headerName = (PAX_DB_FIELD_ALIASES_[field] || [field])[0];
			if (_appendPaxDbColumn_(sheet, headerName)) {
				GasLogger.log('upsertPaxDbRow_.missingColumns.healed', { header: headerName });
			}
		});
		headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
		headerIndex = _buildHeaderIndex_(headers);
	}

	var lastColumn = sheet.getLastColumn();
	var lastRow = sheet.getLastRow();
	var sheetIdCol = colFor('sheetId');
	var f3NameCol = colFor('f3Name');
	var normName = String(fields.f3Name).trim().toLowerCase();

	var matchedRowNumber = -1;
	if (lastRow > 1) {
		var existingValues = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
		for (var i = 0; i < existingValues.length; i++) {
			var rowName = String(existingValues[i][f3NameCol] || '').trim().toLowerCase();
			if (existingValues[i][sheetIdCol] === fields.sheetId && rowName === normName) {
				matchedRowNumber = i + 2;
				break;
			}
		}
	}

	var targetRowNumber = matchedRowNumber === -1 ? lastRow + 1 : matchedRowNumber;
	var rowRange = sheet.getRange(targetRowNumber, 1, 1, lastColumn);
	var rowValues = matchedRowNumber === -1 ? new Array(lastColumn).fill('') : rowRange.getValues()[0];

	fieldsToWrite.forEach(function(field) {
		var col = colFor(field);
		rowValues[col] = fields[field];
	});

	rowRange.setValues([rowValues]);

	GasLogger.log('upsertPaxDbRow_', {
		sheetId: fields.sheetId,
		created: matchedRowNumber === -1,
		row: targetRowNumber,
		elapsedMs: Date.now() - startedAt
	});

	return { created: matchedRowNumber === -1, row: targetRowNumber };
}

/**
 * Recomputes PaxDB stats for every PAX in a single tracker spreadsheet and upserts each row.
 * Called after markEmptyCellsAsMinusOne_ finalises a day's data so PaxDB stays current
 * without waiting for the next manual runScanTrackers.
 * @param {Spreadsheet} trackerSpreadsheet The individual tracker spreadsheet.
 * @param {string} sheetId Its spreadsheet ID (already known at call site).
 * @param {Date|string=} startDate The tracker's start date (from TrackerDB row).
 * @returns {{pax: number, created: number, updated: number}}
 */
function refreshPaxDbForTracker_(trackerSpreadsheet, sheetId, startDate) {
	var templateSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	var paxRows = _loadPaxData(trackerSpreadsheet, sheetId, startDate);
	var created = 0, updated = 0;
	paxRows.forEach(function(row) {
		var result = upsertPaxDbRow_(templateSpreadsheet, row);
		if (result.created) created++; else updated++;
	});
	GasLogger.log('refreshPaxDbForTracker_', { sheetId: sheetId, pax: paxRows.length, created: created, updated: updated });
	return { pax: paxRows.length, created: created, updated: updated };
}

/**
 * Finds the most recent PaxDB row for f3Name (case-insensitive), optionally excluding one
 * sheetId (the caller's own target month, when it may already have a row there). Replaces
 * the old Config 'Last Month Tracker' + cross-spreadsheet walk-back entirely: one read of
 * one sheet (PaxDB, in the Template), sorted by Date descending — no other spreadsheet is
 * opened. Logs start-to-finish timing so we have real numbers if this ever needs to become
 * an indexed/cached lookup instead.
 * @param {Spreadsheet} spreadsheet The Template spreadsheet (where PaxDB lives).
 * @param {string} f3Name
 * @param {string=} excludeSheetId
 * @returns {Object|null} The matching PaxDB row (shape per _readPaxDbRowsBySheetId_), or null.
 */
function _findMostRecentPaxRecordByPredicate_(logTag, spreadsheet, excludeSheetId, predicate) {
	var startedAt = Date.now();
	GasLogger.log(logTag + '.start', { excludeSheetId: excludeSheetId || null });

	var paxState = _readPaxDbRowsBySheetId_(spreadsheet);
	var candidates = [];
	Object.keys(paxState.bySheetId).forEach(function(sheetId) {
		if (excludeSheetId && sheetId === excludeSheetId) return;
		paxState.bySheetId[sheetId].forEach(function(row) {
			if (predicate(row)) candidates.push(row);
		});
	});

	candidates.sort(function(a, b) { return _toSortableTime_(b.date) - _toSortableTime_(a.date); });
	var result = candidates.length ? candidates[0] : null;

	GasLogger.log(logTag + '.done', {
		found: !!result,
		candidateSheets: Object.keys(paxState.bySheetId).length,
		matchesFound: candidates.length,
		elapsedMs: Date.now() - startedAt
	});

	return result;
}

function findMostRecentPaxRecordForName_(spreadsheet, f3Name, excludeSheetId) {
	var normName = String(f3Name || '').trim().toLowerCase();
	if (!normName) return null;
	return _findMostRecentPaxRecordByPredicate_('findMostRecentPaxRecordForName_', spreadsheet, excludeSheetId, function(row) {
		return String(row.f3Name || '').trim().toLowerCase() === normName;
	});
}

/**
 * Same as findMostRecentPaxRecordForName_ but matched on Email instead of F3 Name — for
 * admin utilities (e.g. applyPaxDbSettingsToCurrentTracker) that only have an email address to
 * work with, not the PAX's F3 Name.
 */
function findMostRecentPaxRecordForEmail_(spreadsheet, email, excludeSheetId) {
	var normEmail = String(email || '').trim().toLowerCase();
	if (!normEmail) return null;
	return _findMostRecentPaxRecordByPredicate_('findMostRecentPaxRecordForEmail_', spreadsheet, excludeSheetId, function(row) {
		return String(row.email || '').trim().toLowerCase() === normEmail;
	});
}

/**
 * Removes all PaxDB rows whose SheetId matches the given sheetId and rewrites the sheet.
 * Used by the cleanupTracker admin action to purge smoke-test or erroneously-created
 * tracker data from PaxDB alongside its TrackerDB row and spreadsheet.
 * @param {Spreadsheet} spreadsheet The Template spreadsheet (where PaxDB lives).
 * @param {string} sheetId
 * @returns {number} Number of PaxDB rows removed.
 */
function deletePaxDbRowsBySheetId_(spreadsheet, sheetId) {
	if (!sheetId) throw new Error('deletePaxDbRowsBySheetId_: sheetId required');
	var paxState = _readPaxDbRowsBySheetId_(spreadsheet);
	if (!paxState.bySheetId[sheetId]) return 0;
	var count = paxState.bySheetId[sheetId].length;
	delete paxState.bySheetId[sheetId];
	var rows = [];
	Object.keys(paxState.bySheetId).forEach(function(id) {
		paxState.bySheetId[id].forEach(function(row) { rows.push(row); });
	});
	_updatePaxDB(rows, spreadsheet);
	return count;
}

function _getFirstParentFolder_(fileId) {
	var file = DriveApp.getFileById(fileId);
	var parents = file.getParents();
	return parents.hasNext() ? parents.next() : null;
}

/**
 * Picks the lifecycle status fields off an existing TrackerDB row so a re-scan that
 * rebuilds the row (e.g. a tracker that was modified and reprocessed) carries them
 * forward unchanged. These fields are written by their own workflows (signup, trigger
 * init, minus-one, nag), never by the scan itself.
 * @param {Object=} existingRow Existing TrackerDB row for this SheetId, if any.
 * @returns {Object} The four lifecycle fields, defaulting to '' when absent.
 */
function _carryForwardLifecycleFields_(existingRow) {
	var fields = {};
	TRACKER_DB_LIFECYCLE_FIELDS_.forEach(function(key) {
		fields[key] = (existingRow && existingRow[key]) || '';
	});
	return fields;
}

/**
 * Merges this scan's tracker rows with any pre-existing TrackerDB rows whose SheetId
 * wasn't touched by this scan (e.g. a row upserted directly by CreateNewTracker.js for a
 * spreadsheet outside the scanned folder). Scanned rows always win for a given SheetId;
 * untouched rows are carried forward unchanged so a wholesale rewrite of TrackerDB never
 * silently drops them.
 * @param {Object} existingBySheetId Map of SheetId -> existing TrackerDB row.
 * @param {Array<Object>} scannedRows Rows produced by this scan.
 * @returns {Array<Object>} Merged row set to write back to TrackerDB.
 */
function _mergeTrackerDbRowsForScan_(existingBySheetId, scannedRows) {
	var seen = {};
	var merged = (scannedRows || []).map(function(row) {
		if (row && row.sheetId) seen[row.sheetId] = true;
		return row;
	});

	Object.keys(existingBySheetId || {}).forEach(function(sheetId) {
		if (seen[sheetId]) return;
		merged.push(existingBySheetId[sheetId]);
	});

	return merged;
}

function _computeTrackerMetrics_(trackerValues) {
	var headerRowIndex = _findTrackerHeaderRowIndex_(trackerValues);
	if (headerRowIndex === -1) {
		return { totalPax: 0, totalTeams: 0, averageScore: 0 };
	}

	var headers = trackerValues[headerRowIndex] || [];
	var headerIndex = _buildHeaderIndex_(headers);

	var nameIndex = _pickHeaderIndex_(headerIndex, ['F3 Name', 'Name']);
	var teamIndex = _pickHeaderIndex_(headerIndex, ['Goal / Team', 'Team', 'Goal']);
	var scoreIndex = _pickHeaderIndex_(headerIndex, ['Score']);

	if (nameIndex === -1) {
		return { totalPax: 0, totalTeams: 0, averageScore: 0 };
	}

	var paxCount = 0;
	var teams = {};
	var scoreSum = 0;
	var scoreCount = 0;

	for (var r = headerRowIndex + 1; r < trackerValues.length; r++) {
		var row = trackerValues[r] || [];
		var name = _normalizeCellText_(row[nameIndex]);
		if (!name) continue;

		paxCount += 1;

		if (teamIndex !== -1) {
			var team = _normalizeCellText_(row[teamIndex]);
			if (team) teams[team.toLowerCase()] = true;
		}

		if (scoreIndex !== -1) {
			var score = _toNumber_(row[scoreIndex]);
			if (score !== null) {
				scoreSum += score;
				scoreCount += 1;
			}
		}
	}

	return {
		totalPax: paxCount,
		totalTeams: Object.keys(teams).length,
		averageScore: scoreCount ? (scoreSum / scoreCount) : 0
	};
}

function _buildTrackerMetadata_(spreadsheet, trackerSheet, trackerValues, linkMetadata) {
	var fallbackTrackerUrl = spreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();
	var configInfo = _readTrackerConfigInfo_(spreadsheet);
	var startDate = _pickTrackerStartDate_(trackerValues, linkMetadata && linkMetadata.startDate, spreadsheet.getName());

	return {
		startDate: startDate,
		shortTracker: _normalizeCellText_(linkMetadata && linkMetadata.shortTracker),
		trackerUrl: _normalizeCellText_(linkMetadata && linkMetadata.trackerUrl) || fallbackTrackerUrl,
		shortHc: _normalizeCellText_(linkMetadata && linkMetadata.shortHc),
		hcUrl: _normalizeCellText_(linkMetadata && linkMetadata.hcUrl) || configInfo.hcUrl,
		formId: _normalizeCellText_(linkMetadata && linkMetadata.formId) || configInfo.formId
	};
}

function _readTrackerConfigInfo_(spreadsheet) {
	var configSheet = spreadsheet.getSheetByName('Config');
	if (!configSheet) return { hcUrl: '', formId: '' };

	var values = configSheet.getDataRange().getValues();
	if (!values || !values.length) return { hcUrl: '', formId: '' };

	for (var i = 0; i < values.length; i++) {
		var key = _normalizeCellText_(values[i][0]).toLowerCase();
		if (key !== 'signup hc form') continue;

		var url = _normalizeCellText_(values[i][2]);
		return {
			hcUrl: url,
			formId: _extractGoogleFileIdFromUrl_(url)
		};
	}

	return { hcUrl: '', formId: '' };
}

function _pickTrackerStartDate_(trackerValues, linkStartDate, spreadsheetName) {
	var fromLinks = _parseDateish_(linkStartDate);
	if (fromLinks) return fromLinks;

	var headerRowIndex = _findTrackerHeaderRowIndex_(trackerValues);
	if (headerRowIndex !== -1) {
		var headers = trackerValues[headerRowIndex] || [];
		for (var c = 0; c < headers.length; c++) {
			var value = headers[c];
			if (value instanceof Date && !isNaN(value.getTime())) {
				return value;
			}
			var parsed = _parseDateish_(value);
			if (parsed) return parsed;
		}
	}

	// Fallback: parse YYYY-MM from spreadsheet title.
	var match = String(spreadsheetName || '').match(/(\d{4})-(\d{2})/);
	if (match) {
		var year = Number(match[1]);
		var month = Number(match[2]);
		if (year >= 2000 && month >= 1 && month <= 12) {
			return new Date(year, month - 1, 1);
		}
	}

	return '';
}

function _findTrackerHeaderRowIndex_(trackerValues) {
	var limit = Math.min(6, trackerValues.length);
	for (var i = 0; i < limit; i++) {
		var headerIndex = _buildHeaderIndex_(trackerValues[i] || []);
		if (_pickHeaderIndex_(headerIndex, ['F3 Name', 'Name']) !== -1) {
			return i;
		}
	}
	return -1;
}

function _buildTrackerPaxStatsByName_(trackerSheet) {
	if (!trackerSheet) return {};

	var trackerValues = trackerSheet.getDataRange().getValues();
	if (!trackerValues || trackerValues.length < 4) return {};

	var headerRowIndex = _findTrackerHeaderRowIndex_(trackerValues);
	if (headerRowIndex === -1) return {};

	var headers = trackerValues[headerRowIndex] || [];
	var headerIndex = _buildHeaderIndex_(headers);
	var nameIdx = _pickHeaderIndex_(headerIndex, ['F3 Name', 'Name']);
	if (nameIdx === -1) return {};

	var fellowshipIdx = _pickHeaderIndex_(headerIndex, ['Fellowship']);
	var qPointIdx = _findHeaderIndexSoft_(headers, ['Q Point', 'Q-Point', 'QPoint']);
	var inspireIdx = _pickHeaderIndex_(headerIndex, ['Inspire']);
	var ehingFngIdx = _findHeaderIndexSoft_(headers, ['EHing FNG', 'Ehing FNG', 'EH FNG']);

	var dateColumnIndexes = _findTrackerDateColumnIndexes_(headers);
	var statsByName = {};

	for (var r = headerRowIndex + 1; r < trackerValues.length; r++) {
		var row = trackerValues[r] || [];
		var f3Name = _normalizeCellText_(row[nameIdx]);
		if (!f3Name) continue;

		var key = f3Name.toLowerCase();
		if (!statsByName[key]) statsByName[key] = _buildEmptyTrackerPaxStats_();
		var stats = statsByName[key];

		for (var i = 0; i < dateColumnIndexes.length; i++) {
			var value = _toNumber_(row[dateColumnIndexes[i]]);
			if (value === 1) stats.hit += 1;
			else if (value === 0) stats.miss += 1;
			else if (value === -1) stats.noCheckin += 1;
		}

		stats.fellowship += _readTrackerNumericCell_(row, fellowshipIdx);
		stats.qPoint += _readTrackerNumericCell_(row, qPointIdx);
		stats.inspire += _readTrackerNumericCell_(row, inspireIdx);
		stats.ehingFng += _readTrackerNumericCell_(row, ehingFngIdx);
	}

	return statsByName;
}

function _buildEmptyTrackerPaxStats_() {
	return {
		hit: 0,
		miss: 0,
		noCheckin: 0,
		fellowship: 0,
		qPoint: 0,
		inspire: 0,
		ehingFng: 0
	};
}

function _findTrackerDateColumnIndexes_(headers) {
	var indexes = [];
	for (var c = 0; c < (headers || []).length; c++) {
		if (_isTrackerHeaderDate_(headers[c])) indexes.push(c);
	}
	return indexes;
}

function _isTrackerHeaderDate_(value) {
	if (value instanceof Date && !isNaN(value.getTime())) return true;
	if (value === undefined || value === null || value === '') return false;

	if (typeof value === 'number' && isFinite(value)) {
		if (value > 20000 && value < 60000) return true;
	}

	var parsed = _parseDateish_(value);
	return !!parsed;
}

function _readTrackerNumericCell_(row, index) {
	if (typeof index !== 'number' || index < 0) return 0;
	return _toNumber_(row[index]) || 0;
}

function _findHeaderIndexSoft_(headers, candidates) {
	var indexer = _buildSoftHeaderMatcher_(headers || []);
	return indexer.find(candidates || []);
}

function _buildHeaderIndex_(headers) {
	var map = {};
	for (var i = 0; i < (headers || []).length; i++) {
		map[_normalizeCellText_(headers[i]).toLowerCase()] = i;
	}
	return map;
}

function _pickHeaderIndex_(headerIndex, candidates) {
	for (var i = 0; i < (candidates || []).length; i++) {
		var key = String(candidates[i] || '').trim().toLowerCase();
		if (key in headerIndex) return headerIndex[key];
	}
	return -1;
}

function _getCellByHeader_(row, headerIndex, aliases) {
	var index = _pickHeaderIndex_(headerIndex, aliases || []);
	if (index === -1) return '';
	return _normalizeCellText_(row[index]);
}

function _getCellValueByHeader_(row, headerIndex, aliases) {
	var index = _pickHeaderIndex_(headerIndex, aliases || []);
	if (index === -1) return '';
	return row[index];
}

function _buildSoftHeaderMatcher_(headers) {
	var normalizedHeaders = (headers || []).map(function(header) {
		return _normalizeHeaderSoft_(header);
	});

	function normalizeCandidate_(value) {
		return _normalizeHeaderSoft_(value);
	}

	function softContainsAllTokens_(header, candidate) {
		if (!header || !candidate) return false;
		var tokens = candidate.split(' ').filter(function(token) { return !!token; });
		if (!tokens.length) return false;
		for (var i = 0; i < tokens.length; i++) {
			if (header.indexOf(tokens[i]) === -1) return false;
		}
		return true;
	}

	return {
		headers: normalizedHeaders,
		find: function(candidates) {
			for (var c = 0; c < (candidates || []).length; c++) {
				var normalizedCandidate = normalizeCandidate_(candidates[c]);
				if (!normalizedCandidate) continue;

				for (var i = 0; i < normalizedHeaders.length; i++) {
					if (normalizedHeaders[i] === normalizedCandidate) return i;
				}

				for (var j = 0; j < normalizedHeaders.length; j++) {
					if (softContainsAllTokens_(normalizedHeaders[j], normalizedCandidate)) return j;
				}
			}
			return -1;
		}
	};
}

function _normalizeHeaderSoft_(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function _isDeletedResponseRow_(row, indexer) {
	var participationIdx = indexer.find([
		'Are you currently participating in Go30?',
		'Participation',
		'Status'
	]);
	if (participationIdx !== -1) {
		var participationValue = _normalizeCellText_(row[participationIdx]).toLowerCase();
		if (participationValue === 'deleted' || participationValue.indexOf('deleted') !== -1) {
			return true;
		}
	}

	var explicitDeleteIdx = indexer.find([
		'Deleted',
		'Is Deleted',
		'Delete Flag'
	]);
	if (explicitDeleteIdx !== -1) {
		var deletedValue = _normalizeCellText_(row[explicitDeleteIdx]).toLowerCase();
		if (deletedValue === 'true' || deletedValue === 'yes' || deletedValue === '1' || deletedValue === 'deleted') {
			return true;
		}
	}

	return false;
}

function _findAllResponseCommentIndexes_(indexer) {
	var candidates = [
		'Constructive Comments',
		'Comments',
		'Success Story',
		'Success Stories'
	];

	var indexes = [];
	var seen = {};
	for (var i = 0; i < candidates.length; i++) {
		var idx = indexer.find([candidates[i]]);
		if (idx === -1 || seen[idx]) continue;
		seen[idx] = true;
		indexes.push(idx);
	}

	return indexes;
}

function _collectCommentsForRow_(row, indexes) {
	var parts = [];
	for (var i = 0; i < (indexes || []).length; i++) {
		var value = _normalizeCellText_(row[indexes[i]]);
		if (!value) continue;
		parts.push(value);
	}

	return parts.join(' | ');
}

function _normalizeCellText_(value) {
	if (value === undefined || value === null) return '';
	return String(value).trim();
}

function _toNumber_(value) {
	if (typeof value === 'number' && isFinite(value)) return value;

	var text = _normalizeCellText_(value);
	if (!text) return null;

	var parsed = Number(text.replace(/,/g, ''));
	return isFinite(parsed) ? parsed : null;
}

function _parseDateish_(value) {
	if (value instanceof Date && !isNaN(value.getTime())) return value;
	var text = _normalizeCellText_(value);
	if (!text) return null;

	// Normalize plain YYYY-MM into first day of month for consistent sorting.
	if (/^\d{4}-\d{2}$/.test(text)) {
		text += '-01';
	}

	var parsed = new Date(text);
	return isNaN(parsed.getTime()) ? null : parsed;
}

function _toSortableTime_(value) {
	var parsed = _parseDateish_(value);
	return parsed ? parsed.getTime() : 0;
}

function _extractGoogleFileIdFromUrl_(url) {
	var text = _normalizeCellText_(url);
	if (!text) return '';

	var match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
	if (match && match[1]) return match[1];
	return '';
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		_mergeTrackerDbRowsForScan_: _mergeTrackerDbRowsForScan_,
		_carryForwardLifecycleFields_: _carryForwardLifecycleFields_,
		resolveTrackerDbRowForContextDate_: resolveTrackerDbRowForContextDate_,
		upsertPaxDbRow_: upsertPaxDbRow_,
		refreshPaxDbForTracker_: refreshPaxDbForTracker_,
		findMostRecentPaxRecordForName_: findMostRecentPaxRecordForName_,
		findMostRecentPaxRecordForEmail_: findMostRecentPaxRecordForEmail_,
		deletePaxDbRowsBySheetId_: deletePaxDbRowsBySheetId_,
		_readPaxDbRowsBySheetId_: _readPaxDbRowsBySheetId_,
		_readTrackerDbRowsBySheetId_: _readTrackerDbRowsBySheetId_,
		resolveTemplateSpreadsheet_: resolveTemplateSpreadsheet_,
		_lookupNamespaceTemplateId_: _lookupNamespaceTemplateId_,
		_lookupNamespaceRegistryRow_: _lookupNamespaceRegistryRow_,
		buildNamespaceRegistryRow_: buildNamespaceRegistryRow_,
		appendNamespaceRegistryRow_: appendNamespaceRegistryRow_,
		removeNamespaceRegistryRow_: removeNamespaceRegistryRow_,
		NAMESPACE_DB_SHEET_NAME_: NAMESPACE_DB_SHEET_NAME_,
		NAMESPACE_DB_HEADERS_: NAMESPACE_DB_HEADERS_,
		_computeTrackerMetrics_: _computeTrackerMetrics_,
		_buildTrackerMetadata_: _buildTrackerMetadata_,
		_loadPaxData: _loadPaxData,
		_updateTrackerDB: _updateTrackerDB,
		_updatePaxDB: _updatePaxDB,
		_qualifySourceFiles_: _qualifySourceFiles_,
		_logExcludedSourceArtifacts_: _logExcludedSourceArtifacts_,
		TRACKER_DB_HEADERS_: TRACKER_DB_HEADERS_,
		PAX_DB_HEADERS_: PAX_DB_HEADERS_
	};
}

