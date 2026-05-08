/**
 * Drive-mapped structured logging for server-side test validation.
 *
 * Creates one log file per execution run in a Drive subfolder (F3Go30/).
 * All GasLogger.log() entries within a run share the same execId and go
 * to the same file — one file per execution run, not one file per flush().
 *
 * Setup (run once from the GAS editor after pushing):
 *   setScriptProperty('GAS_LOGGER_PARENT_FOLDER_ID', '<Drive folder ID>');
 *
 * Usage:
 *   GasLogger.init('triggerName');           // call at start of each trigger
 *   GasLogger.log('tag', { key: value });    // accumulate + Logger.log()
 *   GasLogger.flush();                       // write to Drive at end of execution
 *
 * If GAS_LOGGER_PARENT_FOLDER_ID is not set, Drive writes are skipped silently.
 * Logger.log() always fires regardless of Drive availability.
 *
 * PII rule: never pass email addresses or PAX names in the data object.
 */
var GasLogger = {
  _folder: null,
  _entries: [],
  _enabled: true,
  _execId: null,
  _runId: null,
  _fileId: null,

  /**
   * Call at the start of every trigger function.
   * Generates a fresh execId and reads the optional test runId from Script Properties.
   * @param {string} triggerName - Caller name for the init log line.
   * @returns {string} The generated execId.
   */
  init: function(triggerName) {
    this._execId = Utilities.getUuid();
    this._runId = PropertiesService.getScriptProperties().getProperty('F3GO30_TEST_RUN_ID') || null;
    this._entries = [];
    this._fileId = null;
    Logger.log('[GasLogger] init — trigger=' + triggerName +
      ' execId=' + this._execId + (this._runId ? ' runId=' + this._runId : ''));
    return this._execId;
  },

  _getFolder: function() {
    if (this._folder) return this._folder;
    var parentId = PropertiesService.getScriptProperties().getProperty('GAS_LOGGER_PARENT_FOLDER_ID');
    if (!parentId) {
      Logger.log('[GasLogger] GAS_LOGGER_PARENT_FOLDER_ID not set — Drive writes disabled');
      return null;
    }
    try {
      var parent = DriveApp.getFolderById(parentId);
      var iter = parent.getFoldersByName('F3Go30');
      this._folder = iter.hasNext() ? iter.next() : parent.createFolder('F3Go30');
      this._folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return this._folder;
    } catch (e) {
      Logger.log('[GasLogger] _getFolder failed: ' + e);
      return null;
    }
  },

  /**
   * Accumulate a structured log entry. Also writes to Logger.log().
   * @param {string}  tag    - Entry type (e.g. 'copyAndInit', 'formSubmit.processed').
   * @param {Object}  data   - Payload. Must not contain email addresses or PAX names.
   * @param {boolean} flush  - If true, flush accumulated entries to Drive immediately.
   * @param {boolean} newLog - If true, reset the file reference after flushing so the
   *                           next flush() creates a new file for subsequent entries.
   */
  log: function(tag, data, flush, newLog) {
    var entry = { ts: new Date().toISOString(), tag: tag, data: data, execId: this._execId };
    if (this._runId) entry.runId = this._runId;
    Logger.log('[GasLogger] ' + JSON.stringify(entry));
    if (this._enabled) this._entries.push(entry);
    if (flush) this.flush();
    if (newLog) this._fileId = null;
  },

  /**
   * Write accumulated entries to Drive. Call once at the end of each trigger function.
   * First call creates the execution-run file; subsequent calls append to it.
   */
  flush: function() {
    if (!this._enabled || this._entries.length === 0) return;
    var folder = this._getFolder();
    if (!folder) { this._entries = []; return; }
    var content = this._entries.map(function(e) { return JSON.stringify(e); }).join('\n');
    try {
      if (this._fileId) {
        // Append to the execution-run file (read + overwrite — Drive has no native append)
        var existing = DriveApp.getFileById(this._fileId).getBlob().getDataAsString();
        var newContent = existing + (existing ? '\n' : '') + content;
        UrlFetchApp.fetch(
          'https://www.googleapis.com/upload/drive/v3/files/' + this._fileId + '?uploadType=media',
          {
            method: 'PATCH',
            contentType: 'text/plain; charset=UTF-8',
            payload: newContent,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true
          }
        );
      } else {
        // First flush for this execution run — create the file
        var filename = new Date().getTime() + '-' + (this._execId || Utilities.getUuid()) + '.log';
        var file = folder.createFile(filename, content, MimeType.PLAIN_TEXT);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        this._fileId = file.getId();
      }
    } catch (e) {
      Logger.log('[GasLogger] flush failed: ' + e);
    }
    this._entries = [];
  },

  enable: function() { this._enabled = true; },
  disable: function() { this._enabled = false; }
};

/** Run from GAS editor to configure without opening Script Properties UI manually. */
function setScriptProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function getScriptProperty(key) {
  Logger.log(PropertiesService.getScriptProperties().getProperty(key));
}
