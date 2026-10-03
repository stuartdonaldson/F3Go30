/*
 * hcFormRetirement.js — retiring the HC Google Form (ADR-024, F3Go30-61ln).
 *
 * The static sign-up page is the only sign-up path. This module holds the two Form operations
 * that remain: unlinking+trashing a Form a tracker copy carries (tracker creation, cleanupTracker),
 * and the one-time closeHcForms admin sweep that closes every existing tracker's Form with a
 * message pointing to the sign-up page and unlinks the Template's own Form so future Drive copies
 * of the Template carry none.
 *
 * ORDERING: closeHcForms unlinks the Template Form, so it must only run against an environment
 * whose deployed tracker creation no longer requires one — which is guaranteed, since this action
 * only exists in builds that also carry the no-Form tracker creation (F3Go30-61ln.1).
 */

var HC_FORM_CLOSED_MESSAGE_PREFIX_ = 'The Go30 sign-up form has moved. Sign up (or update your goals) here: ';

/**
 * Unlinks and trashes the Form linked to `spreadsheet`, if any. No-op when nothing is linked. A
 * failure is logged and reported, never thrown — callers (tracker creation, cleanupTracker) must
 * not fail on Form housekeeping.
 * @returns {{retired: boolean, formId: (string|undefined), error: (string|undefined)}}
 */
function retireCopiedHcForm_(spreadsheet) {
  var formUrl = spreadsheet.getFormUrl();
  if (!formUrl) return { retired: false };
  try {
    var form = FormApp.openByUrl(formUrl);
    var formId = form.getId();
    form.removeDestination();
    DriveApp.getFileById(formId).setTrashed(true);
    GasLogger.log('retireCopiedHcForm_', { formId: formId });
    return { retired: true, formId: formId };
  } catch (e) {
    GasLogger.log('retireCopiedHcForm_.failed', { error: e.message });
    return { retired: false, error: e.message };
  }
}

/** Unique non-blank FormIds across TrackerDB rows ({sheetId: {formId, ...}}), in first-seen order. */
function planHcFormClosures_(rowsBySheetId) {
  var ids = [];
  Object.keys(rowsBySheetId || {}).forEach(function(sheetId) {
    var formId = String((rowsBySheetId[sheetId] && rowsBySheetId[sheetId].formId) || '').trim();
    if (formId && ids.indexOf(formId) === -1) ids.push(formId);
  });
  return ids;
}

/**
 * Closes one Form (stop accepting responses + closed message). Already closed with the same
 * message -> 'alreadyClosed'. dryRun reports without writing.
 * @returns {'closed'|'alreadyClosed'}
 */
function closeOneHcForm_(form, message, dryRun) {
  if (!form.isAcceptingResponses() && form.getCustomClosedFormMessage() === message) return 'alreadyClosed';
  if (!dryRun) form.setAcceptingResponses(false).setCustomClosedFormMessage(message);
  return 'closed';
}

/**
 * The closeHcForms sweep: closes every TrackerDB Form and the Template's linked Form with a message
 * linking signupUrl, then unlinks the Template's Form. Idempotent; a missing/inaccessible Form is
 * reported, not thrown.
 * @param {Spreadsheet} templateSpreadsheet
 * @param {Object} rowsBySheetId _readTrackerDbRowsBySheetId_(template).bySheetId
 * @param {{dryRun: (boolean|undefined), signupUrl: string}} options
 */
function closeHcForms_(templateSpreadsheet, rowsBySheetId, options) {
  var signupUrl = String((options && options.signupUrl) || '').trim();
  if (!signupUrl) return { ok: false, error: 'signup_url_unavailable' };
  var dryRun = !!(options && options.dryRun);
  var message = HC_FORM_CLOSED_MESSAGE_PREFIX_ + signupUrl;
  var result = { ok: true, dryRun: dryRun, closed: [], alreadyClosed: [], missing: [], templateFormId: null, templateUnlinked: false };

  planHcFormClosures_(rowsBySheetId).forEach(function(formId) {
    var form;
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      result.missing.push(formId);
      return;
    }
    result[closeOneHcForm_(form, message, dryRun)].push(formId);
  });

  var templateFormUrl = templateSpreadsheet.getFormUrl();
  if (templateFormUrl) {
    var templateForm = FormApp.openByUrl(templateFormUrl);
    result.templateFormId = templateForm.getId();
    if (result.closed.indexOf(result.templateFormId) === -1 && result.alreadyClosed.indexOf(result.templateFormId) === -1) {
      result[closeOneHcForm_(templateForm, message, dryRun)].push(result.templateFormId);
    }
    if (!dryRun) {
      templateForm.removeDestination();
      result.templateUnlinked = true;
    }
  }

  GasLogger.log('closeHcForms_', { mode: dryRun ? 'dryRun' : 'apply', count: result.closed.length, unchanged: result.alreadyClosed.length, removed: result.missing.length });
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HC_FORM_CLOSED_MESSAGE_PREFIX_: HC_FORM_CLOSED_MESSAGE_PREFIX_,
    retireCopiedHcForm_: retireCopiedHcForm_,
    planHcFormClosures_: planHcFormClosures_,
    closeHcForms_: closeHcForms_,
  };
}
