/*
 * siteFeedback.js
 *
 * handleSiteFeedback_, extracted out of dashboardWebapp.js (REVIEW-260910's split-identity
 * finding — see docs/staging/review-260910.md). At ~60 lines with no coupling to its former
 * neighbours (identity resolution, cache), this rode along with the dashboardIdentity.js
 * extraction rather than counting as a second instance of that conversion. Pure structural move
 * — no behaviour change; this file's contents are the original dashboardWebapp.js block verbatim.
 */

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;

// F3Go30-5c2a.3: handleSiteFeedback_'s idempotency dedupe reuses the generic PropertiesService
// dedupe-store primitives ClientTelemetryLog.js already built for handleClientTelemetryBatch_,
// rather than hand-rolling a second store.
var siteFeedbackClientTelemetryLogModule_ = gasRequire_('./ClientTelemetryLog.js', ['loadDedupeSeenIds_', 'saveDedupeSeenIds_', 'pruneDedupeSeenIds_']);
var loadDedupeSeenIds_dw_ = siteFeedbackClientTelemetryLogModule_.loadDedupeSeenIds_;
var saveDedupeSeenIds_dw_ = siteFeedbackClientTelemetryLogModule_.saveDedupeSeenIds_;
var pruneDedupeSeenIds_dw_ = siteFeedbackClientTelemetryLogModule_.pruneDedupeSeenIds_;

var siteFeedbackUtilitiesModule_ = gasRequire_('./Utilities.js', ['readEmailDeliveryPolicy_', 'sendConfiguredEmail_']);
// F3Go30-1pqo.4: settings-menu "Send Feedback" reuses the same email-delivery policy/send path
// as every other outbound email in this codebase (signupWebapp.js's confirmation email,
// Nag.js's reminders, CreateNewTracker.js's Site Q notices) rather than a bespoke MailApp call.
var readEmailDeliveryPolicy_dw_ = siteFeedbackUtilitiesModule_.readEmailDeliveryPolicy_;
var sendConfiguredEmail_dw_ = siteFeedbackUtilitiesModule_.sendConfiguredEmail_;

/**
 * F3Go30-1pqo.4: settings-menu "Send Feedback" — emails the Site Q directly with the sender's
 * identity (F3 name + email), free-text comment, star rating, and app version/build for
 * correlating with a specific deploy. Distinct from handleSignupFeedback_ (signupWebapp.js),
 * which only ever writes {feedbackRating, feedbackComment} onto that PAX's signup row for the
 * month being signed up for — this one has no signup-row target (reachable any time
 * post-identify via the settings menu, not just during signup) and its whole point IS the
 * email, not a sheet write. Reuses readEmailDeliveryPolicy_/sendConfiguredEmail_ (Utilities.js)
 * — the same email-delivery path every other outbound email in this codebase goes through —
 * rather than a bespoke MailApp call.
 * @param {Object} payload { f3Name, email, rating, comment, clientVersion, feedbackKey } —
 *   clientVersion is attached to every callApi() call automatically (static-pages/src/index.html's
 *   STATIC_BUILD_VERSION_, see F3Go30-833s.15), reused here rather than inventing a second version
 *   field. feedbackKey (F3Go30-5c2a.3) is a client-minted hash of the unedited report content
 *   (siteFeedbackKey_, index.html) — stable across a hand-retried resubmission of the exact same
 *   report (the failure mode that produced three emails for one report during F3Go30-5c2a: the
 *   server's send actually succeeded each time, but the client reported false transport
 *   failures, so the PAX resubmitted by hand), and different once the report text changes.
 */
var SITE_FEEDBACK_DEDUPE_PROPERTY_ = 'SITE_FEEDBACK_DEDUPE_SEEN_KEYS';
var SITE_FEEDBACK_DEDUPE_WINDOW_DAYS_ = 2; // same window as CLIENT_TELEMETRY_DEDUPE_WINDOW_DAYS_
                                            // (ClientTelemetryLog.js) — generous relative to how
                                            // fast a PAX actually hand-retries, but the store is
                                            // pruned on every write so it costs nothing to keep.

function handleSiteFeedback_(templateSpreadsheet, payload) {
  var comment = String((payload && payload.comment) || '').trim();
  var rating = Number(payload && payload.rating) || 0;
  if (!rating && !comment) return { ok: false, error: 'empty_feedback' };

  var f3Name = String((payload && payload.f3Name) || '').trim() || '(unknown)';
  var email = String((payload && payload.email) || '').trim();

  var feedbackKey = String((payload && payload.feedbackKey) || '').trim();
  var seenKeys = feedbackKey
    ? pruneDedupeSeenIds_dw_(loadDedupeSeenIds_dw_(SITE_FEEDBACK_DEDUPE_PROPERTY_), SITE_FEEDBACK_DEDUPE_WINDOW_DAYS_)
    : null;
  if (feedbackKey && seenKeys[feedbackKey]) {
    // Repeat of an already-sent report within the window: report success without sending a
    // second email — the PAX must never be told a resubmission of an already-delivered report
    // failed (AC3).
    return { ok: true };
  }

  var policy = readEmailDeliveryPolicy_dw_(templateSpreadsheet);
  if (!policy.siteQEmail) {
    GasLogger.log('dashboardWebapp.siteFeedback.skipped', { reason: 'no_site_q_email' });
    return { ok: false, error: 'site_q_not_configured' };
  }

  var body = [
    'Feedback from: ' + f3Name + (email ? ' <' + email + '>' : ''),
    'Rating: ' + (rating ? rating + '/5' : '(none given)'),
    '',
    comment || '(no comment)',
    '',
    '---',
    'App version: ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '(unknown)') +
      (typeof APP_VERSION_DATE !== 'undefined' ? ' (' + APP_VERSION_DATE + ')' : ''),
    'Client build: ' + ((payload && payload.clientVersion) || '(unknown)')
  ].join('\n');

  try {
    sendConfiguredEmail_dw_({
      spreadsheet: templateSpreadsheet,
      policy: policy,
      recipientList: policy.siteQEmail,
      subject: 'Go30 Feedback from ' + f3Name,
      body: body,
      allowPlainTextFallback: true,
      logLabel: 'dashboardWebapp.siteFeedback'
    });
  } catch (e) {
    GasLogger.logError('dashboardWebapp.siteFeedback.error', e, {});
    return { ok: false, error: 'send_failed' };
  }

  if (feedbackKey) {
    seenKeys[feedbackKey] = new Date().toISOString();
    saveDedupeSeenIds_dw_(SITE_FEEDBACK_DEDUPE_PROPERTY_, seenKeys);
  }

  return { ok: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleSiteFeedback_: handleSiteFeedback_,
  };
}
