/**
 * Build signup reuse email using SignupReuseEmailTemplate
 */

function renderSignupReuseEmailHtml_(options) {
  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    var lines = [];
    lines.push('<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;">');
    lines.push('<h1>' + (options.usedPriorGoals ? 'Your previous goals were reused' : 'Please enter your goals') + '</h1>');
    if (options.usedPriorGoals) {
      lines.push('<p>We reused your most recent prior Go30 entries for this month.</p>');
      lines.push('<pre>' + (options.summaryLines || []).join('\n') + '</pre>');
    } else {
      lines.push('<p>We could not find a prior entry to reuse for this email address.</p>');
    }
    if (options.prefilledUrl) lines.push('<p><a href="' + options.prefilledUrl + '">Open prefilled form</a></p>');
    if (options.trackerUrl) lines.push('<p><a href="' + options.trackerUrl + '">View tracker</a></p>');
    lines.push('</body></html>');
    return lines.join('\n');
  }

  var template = HtmlService.createTemplateFromFile('SignupReuseEmailTemplate');
  template.usedPriorGoals = !!options.usedPriorGoals;
  template.f3Name = options.f3Name;
  template.trackerUrl = options.trackerUrl;
  template.prefilledUrl = options.prefilledUrl;
  template.summaryLines = options.summaryLines || [];
  return template.evaluate().getContent();
}

function buildSignupReuseEmailTemplate_(options) {
  options = options || {};
  var subject = 'F3 Go30: ' + (options.usedPriorGoals ? "last month's goals reused" : 'enter your goals');
  var bodyLines = [];
  bodyLines.push('F3 Name: ' + (options.f3Name || '(unknown)'));
  bodyLines.push('');
  if (options.usedPriorGoals) {
    bodyLines.push('We reused your most recent prior Go30 entries for this month:');
    bodyLines = bodyLines.concat(options.summaryLines || []);
    bodyLines.push('');
    if (options.prefilledUrl) {
      bodyLines.push('If you want to adjust those defaults, open this prefilled form link and submit again:');
      bodyLines.push(options.prefilledUrl);
    }
  } else {
    bodyLines.push('We could not find a prior Go30 entry for ' + (options.f3Name || 'your F3 Name') + '.');
    bodyLines.push('');
    if (options.prefilledUrl) {
      bodyLines.push('Use this form link to enter or update your goals:');
      bodyLines.push(options.prefilledUrl);
    }
  }
  bodyLines.push('');
  if (options.trackerUrl) bodyLines.push('Tracker: ' + options.trackerUrl);

  return {
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: renderSignupReuseEmailHtml_(options)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSignupReuseEmailTemplate_: buildSignupReuseEmailTemplate_,
    renderSignupReuseEmailHtml_: renderSignupReuseEmailHtml_
  };
}
