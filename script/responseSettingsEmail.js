/**
 * Build copied-settings email using ResponseSettingsEmailTemplate.
 */

function renderResponseSettingsEmailHtml_(options) {
  options = options || {};

  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    var items = (options.copiedSettings || []).map(function(entry) {
      var value = entry.value === undefined || entry.value === null ? '' : String(entry.value);
      return '<li><strong>' + entry.header + ':</strong> ' + value + '</li>';
    }).join('');

    return [
      '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;">',
      '<h1>Your Go30 signup settings were copied</h1>',
      '<p>Hello ' + (options.recipientName || 'there') + ',</p>',
      '<p>The following signup settings were copied into the current tracker for your account:</p>',
      '<ul>' + items + '</ul>',
      '<p>If any value looks incorrect, please update your form response or contact the Site Q.</p>',
      '</body></html>'
    ].join('');
  }

  var template = HtmlService.createTemplateFromFile('ResponseSettingsEmailTemplate');
  template.recipientName = options.recipientName || 'there';
  template.copiedSettings = options.copiedSettings || [];
  template.appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
  return template.evaluate().getContent();
}

function buildResponseSettingsEmailTemplate_(options) {
  options = options || {};
  var subject = 'Your Go30 signup settings';
  var bodyLines = [];

  bodyLines.push('Hello ' + (options.recipientName || 'there') + ',');
  bodyLines.push('');
  bodyLines.push('The following signup settings were copied into the current tracker for your account:');
  bodyLines.push('');

  (options.copiedSettings || []).forEach(function(entry) {
    var value = entry.value === undefined || entry.value === null ? '' : String(entry.value);
    bodyLines.push(entry.header + ': ' + value);
  });

  bodyLines.push('');
  bodyLines.push('If any value looks incorrect, please update your form response or contact the Site Q.');

  return {
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: renderResponseSettingsEmailHtml_(options)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildResponseSettingsEmailTemplate_: buildResponseSettingsEmailTemplate_,
    renderResponseSettingsEmailHtml_: renderResponseSettingsEmailHtml_
  };
}
