/**
 * Build onboarding email using OnboardingEmailTemplate
 */

function renderOnboardingEmailHtml_(options) {
  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    // Fallback simple HTML
    var lines = [];
    lines.push('<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;">');
    lines.push('<h1>Verify new tracker: ' + (options.trackerName || '') + '</h1>');
    lines.push('<p>Site ' + (options.siteName || '') + '</p>');
    lines.push('<p>Open the tracker here: <a href="' + (options.trackerUrl || '') + '">View new tracker</a></p>');
    lines.push('</body></html>');
    return lines.join('\n');
  }

  var template = HtmlService.createTemplateFromFile('OnboardingEmailTemplate');
  template.trackerName = options.trackerName;
  template.siteName = options.siteName;
  template.trackerUrl = options.trackerUrl;
  template.formUrl = options.formUrl;
  template.ownerAccount = options.ownerAccount;
  template.initSteps = options.initSteps || [];
  template.postCopyChecklist = options.postCopyChecklist || [];
  template.slackReadyMessage = options.slackReadyMessage;
  template.operatorName = options.operatorName;
  template.contactEmail = options.contactEmail;
  template.appVersion = options.appVersion || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
  return template.evaluate().getContent();
}

function buildOnboardingEmailTemplate_(options) {
  options = options || {};
  var subject = 'F3 Go30: ' + (options.trackerName || 'New tracker') + ' is ready';
  var bodyLines = [];
  bodyLines.push((options.trackerName || 'A new tracker') + ' has been created.');
  bodyLines.push('');
  if (options.trackerUrl) {
    bodyLines.push('Tracker: ' + options.trackerUrl);
  }
  if (options.formUrl) {
    bodyLines.push('HC Form: ' + options.formUrl);
  }
  bodyLines.push('');
  bodyLines.push('Next step: open the new spreadsheet and verify it looks correct.');
  bodyLines.push('');
  if (options.slackReadyMessage) {
    bodyLines.push('Slack message:');
    bodyLines.push(options.slackReadyMessage);
  }

  return {
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: renderOnboardingEmailHtml_(options)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildOnboardingEmailTemplate_: buildOnboardingEmailTemplate_,
    renderOnboardingEmailHtml_: renderOnboardingEmailHtml_
  };
}
