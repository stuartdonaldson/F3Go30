/**
 * Daily NAG processing.
 * - setupDailyNagTrigger(): installs a daily trigger at 10:00 local time
 * - sendNagEmail(): invoked by trigger; for each team, if anyone on the team
 *   has not checked in for the previous day, email all team members who opted
 *   into the "NAG Email?" column with a list of missing people.
 */

function setupDailyNagTrigger() {
  clearDailyNagTrigger();
  ScriptApp.newTrigger('sendNagEmail')
    .timeBased()
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .atHour(10)
    .nearMinute(0)
    .create();
}

function clearDailyNagTrigger() {
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === 'sendNagEmail') {
      ScriptApp.deleteTrigger(existingTriggers[i]);
    }
  }
}

function isYesLike_(val) {
  if (val === undefined || val === null) return false;
  var s = String(val).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s.indexOf('yes') === 0;
}

function sanitizeNagRecipientEmail_(email) {
  var flattened = String(email || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (/[<>\",;]/.test(flattened)) return '';
  var cleaned = flattened.replace(/\s+/g, '');
  if (!cleaned) return '';
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(cleaned)) return '';
  return cleaned.toLowerCase();
}

function sanitizeNagDisplayName_(name) {
  var flattened = String(name || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!flattened) return '';

  var normalized = typeof flattened.normalize === 'function'
    ? flattened.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    : flattened;

  return normalized
    .replace(/[^A-Za-z0-9 ._'()-]+/g, ' ')
    .replace(/[<>",;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNagRecipientList_(recipients) {
  return (recipients || []).map(function(recipient) {
    var email = sanitizeNagRecipientEmail_(recipient && recipient.email);
    if (!email) return '';

    var displayName = sanitizeNagDisplayName_(recipient && recipient.name);
    return displayName ? (displayName + ' <' + email + '>') : email;
  }).filter(function(entry) {
    return !!entry;
  }).join(',');
}

function buildTrackerUrl_(ss, tracker) {
  return ss.getUrl() + '#gid=' + tracker.getSheetId();
}

function pickFunFactFromValues_(values, randomIndexFn) {
  if (!values || values.length < 2) return '';

  var dataRows = values.slice(1).filter(function(row) {
    return row && row.some(function(cell) {
      return String(cell || '').trim() !== '';
    });
  });

  if (dataRows.length === 0) return '';

  var index = randomIndexFn
    ? randomIndexFn(dataRows.length)
    : Math.floor(Math.random() * dataRows.length);
  var selected = dataRows[index] || [];
  var left = String(selected[0] || '').trim();
  var right = String(selected[1] || '').trim();
  var detail = right ? (left + ' - ' + right) : left;

  return detail ? ('Fun fact: ' + detail) : '';
}

function readRandomFunFact_(ss) {
  var funFacts = ss.getSheetByName('FunFacts');
  if (!funFacts) return '';
  return pickFunFactFromValues_(funFacts.getDataRange().getValues());
}

function escapeHtmlForEmail_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReminderEmailHtmlFallback_(options) {
  var missingItems = (options.missing || []).map(function(member) {
    var goal = member.who ? (' - goal: ' + escapeHtmlForEmail_(member.who)) : '';
    return '<li><strong>' + escapeHtmlForEmail_(member.name) + '</strong>' + goal + '</li>';
  }).join('');

  return [
    '<!DOCTYPE html>',
    '<html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">',
    options.funFact ? ('<p style="font-weight:bold;">' + escapeHtmlForEmail_(options.funFact) + '</p>') : '',
    '<p>Men of ' + escapeHtmlForEmail_(options.teamName) + ',</p>',
    '<p>This is a quick reminder that the following teammates have not yet checked in for ' + escapeHtmlForEmail_(options.targetDateString) + ':</p>',
    '<ul>' + missingItems + '</ul>',
    '<p><a href="' + escapeHtmlForEmail_(options.trackerUrl) + '">Open the tracker</a></p>',
    '<p>If you already checked in and your entry is not showing yet, just update it in the tracker.</p>',
    '<p>This reminder was sent only to teammates who explicitly opted in to nag emails.</p>',
    '<p>Stay after it,<br>F3 Go30</p>',
    '</body></html>'
  ].join('');
}

function renderReminderEmailHtml_(options) {
  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    return renderReminderEmailHtmlFallback_(options);
  }

  var template = HtmlService.createTemplateFromFile('ReminderEmailTemplate');
  template.teamName = options.teamName;
  template.targetDateString = options.targetDateString;
  template.trackerUrl = options.trackerUrl;
  template.funFact = options.funFact;
  template.missing = options.missing || [];
  return template.evaluate().getContent();
}

function buildReminderEmailTemplate_(options) {
  var subject = 'Go30 Reminder; Missing check-in for ' + options.targetDateString;
  var bodyLines = [];

  if (options.funFact) bodyLines.push(options.funFact, '');
  bodyLines.push('Men of ' + options.teamName + ',');
  bodyLines.push('');
  bodyLines.push('This is a quick reminder that the following teammates have not yet checked in for ' + options.targetDateString + ':');
  bodyLines.push('');

  options.missing.forEach(function(member) {
    var line = '- ' + member.name;
    if (member.who) line += ' (goal: ' + member.who + ')';
    bodyLines.push(line);
  });

  bodyLines.push('');
  bodyLines.push('Open the tracker here:');
  bodyLines.push(options.trackerUrl);
  bodyLines.push('');
  bodyLines.push('If you already checked in and your entry is not showing yet, just update it in the tracker.');
  bodyLines.push('');
  bodyLines.push('This reminder was sent only to teammates who explicitly opted in to nag emails.');
  bodyLines.push('');
  bodyLines.push('Stay after it,');
  bodyLines.push('F3 Go30');

  return {
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: renderReminderEmailHtml_(options)
  };
}

function sendNagEmail() {
  GasLogger.init('sendNagEmail');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tracker = ss.getSheetByName('Tracker');
  var responses = ss.getSheetByName('Responses');
  if (!tracker || !responses) {
    Logger.log('sendNagEmail: Tracker or Responses sheet missing');
    return;
  }

  var tz = ss.getSpreadsheetTimeZone();
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  var targetDateString = Utilities.formatDate(yesterday, tz, 'MM/dd/yyyy');
  var trackerUrl = buildTrackerUrl_(ss, tracker);

  // Find the column in row 3 that matches yesterday's date
  var lastCol = tracker.getLastColumn();
  var row3 = tracker.getRange(3, 1, 1, lastCol).getValues()[0];
  var dateCol = -1;
  for (var c = 0; c < row3.length; c++) {
    var v = row3[c];
    if (v instanceof Date) {
      var s = Utilities.formatDate(v, tz, 'MM/dd/yyyy');
      if (s === targetDateString) { dateCol = c + 1; break; }
    } else if (String(v || '').trim() === targetDateString) {
      dateCol = c + 1; break;
    }
  }

  if (dateCol === -1) {
    Logger.log('sendNagEmail: date column not found for ' + targetDateString);
    return;
  }

  var startRow = 4;
  var lastRow = tracker.getLastRow();
  if (lastRow < startRow) return;

  // Read tracker basics (Name, Team) and yesterday's column values
  var nameTeamRange = tracker.getRange(startRow, 1, lastRow - startRow + 1, Math.max(2, Math.min(2, tracker.getLastColumn())));
  var nameTeam = nameTeamRange.getValues();
  var dayVals = tracker.getRange(startRow, dateCol, lastRow - startRow + 1, 1).getValues();

  // Load responses to map latest info (email, NAG opt-in, WHO)
  var respData = responses.getDataRange().getValues();
  if (respData.length < 2) {
    Logger.log('sendNagEmail: Responses has no data');
    return;
  }
  var responseColumns = resolveResponseColumns_(respData[0]);

  // Build latest response map by F3 Name (scan from bottom)
  var latestByName = {};
  for (var r = respData.length - 1; r >= 1; r--) {
    var row = respData[r];
    var name = String(getResponseValue_(row, responseColumns, 'F3_NAME') || '').trim();
    if (!name) continue;
    if (!(name in latestByName)) latestByName[name] = row;
  }

  // Group by team
  var teams = {}; // teamName -> { members: [{name, email, who, nagOpt, checked}] }
  for (var i = 0; i < nameTeam.length; i++) {
    var name = String(nameTeam[i][0] || '').trim();
    if (!name) continue;
    var team = String(nameTeam[i][1] || '').trim() || '(Unassigned)';
    var val = dayVals[i][0];
    var checked = (val === 1 || val === '1' || val === 0 || val === '0');

    var respRow = latestByName[name] || [];
    var email = String(getResponseValue_(respRow, responseColumns, 'EMAIL') || '').trim();
    var nagOpt = isYesLike_(getOptionalResponseValue_(respRow, responseColumns, 'NAG_EMAIL'));
    var who = String(getResponseValue_(respRow, responseColumns, 'WHO') || '').trim();

    if (!teams[team]) teams[team] = { members: [] };
    teams[team].members.push({ name: name, email: email, who: who, nagOpt: nagOpt, checked: checked });
  }

  var funFact = readRandomFunFact_(ss);

  var sentSummary = [];
  for (var teamName in teams) {
    var group = teams[teamName];
    var missing = group.members.filter(function(m){ return !m.checked; });
    if (missing.length === 0) continue; // nobody missing, skip

    // Recipients are members who opted in and have an email
    var recipients = group.members.filter(function(m){ return m.nagOpt && m.email; });
    if (recipients.length === 0) continue; // no recipients

    var recipientList = buildNagRecipientList_(recipients);
    if (!recipientList) continue;

    var message = buildReminderEmailTemplate_({
      teamName: teamName,
      targetDateString: targetDateString,
      trackerUrl: trackerUrl,
      funFact: funFact,
      missing: missing
    });

    try {
      MailApp.sendEmail({
        to: recipientList,
        subject: message.subject,
        body: message.body,
        htmlBody: message.htmlBody
      });
      sentSummary.push({ team: teamName, recipients: recipients.length, missing: missing.length });
    } catch (e) {
      Logger.log('sendNagEmail: MailApp.sendEmail failed for team ' + teamName + ' — ' + e.message);
    }
  }

  GasLogger.log('sendNagEmail', { date: targetDateString, teamsNotified: sentSummary }, true);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildTrackerUrl_: buildTrackerUrl_,
    pickFunFactFromValues_: pickFunFactFromValues_,
    buildReminderEmailTemplate_: buildReminderEmailTemplate_,
    sanitizeNagRecipientEmail_: sanitizeNagRecipientEmail_,
    sanitizeNagDisplayName_: sanitizeNagDisplayName_,
    buildNagRecipientList_: buildNagRecipientList_
  };
}
