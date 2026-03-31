// Description: Code for the Notification Sidebar
//
// SIDEBAR-ONLY CONTRACT
// NoticeLogInit(), NoticeLog(), and NoticePrompt() are sidebar UI functions.
// They are only active after NoticeLogInit() has opened the sidebar (i.e. inside
// copyAndInit() and reinitializeSheets()). Outside that context, NoticeLog() silently
// discards messages; NoticePrompt() will block indefinitely. Trigger-fired and
// background functions MUST use Logger.log() directly instead.

// Test function to populate the sidebar with different types of messages
function testNotificationSidebar() {
  NoticeLogInit( `Testing Notification Sidebar`, 
                `This tests the notification sidebar functionality 
                showing a title, <b>description</b>, log messages, and a 
                prompt for response.` );
  NoticeLog( "progress step 1" );
  NoticeLog( "-" );
  Utilities.sleep(2000);
  NoticeLog( "progress step 2" );
  Utilities.sleep(2000);
  NoticeLog( "progress step 3" );
  Utilities.sleep(2000);

  NoticeLog(`Click ${createHtmlLink("here", "https://example.com")} to access the link`);
  Utilities.sleep(2000);

  var x = NoticePrompt( "Enter your name" );
  NoticeLog( "You entered " + x );
  Utilities.sleep(2000);
  NoticeLog( "Test complete" ); 
}

  
// createHtmlLink( text, link ) - create a link in the sidebar
function createHtmlLink( text, link ) {
  return '<a href="' + link + '" target="_blank">' + escapeHtml_(text) + '</a>';
}

/**
 * NoticeLogInit - Opens the notification sidebar and initializes the message queues.
 * SIDEBAR-ONLY (see file header). Must be called before NoticeLog() or NoticePrompt().
 * @param {string} title - Sidebar title
 * @param {string} desc  - HTML description shown below the title
 */
function NoticeLogInit( title, desc ) {
  var messages = {
    title: title,
    desc: desc,
    log: null,
    prompt: null,
    response: null,
  };
  // Function to show the sidebar
  var html = HtmlService.createHtmlOutputFromFile('NotificationSidebar');
  SpreadsheetApp.getUi().showSidebar(html);
  
  initMessageQueues();
  sendToClient(messages);
}

/**
 * NoticeLog - Enqueues a message to the sidebar log and mirrors it to Logger.log().
 * SIDEBAR-ONLY (see file header). Logger.log() always fires regardless of sidebar state.
 * @param {string} log - Message text (may include HTML; HTML tags are stripped for Logger)
 */
function NoticeLog( log ) {
  Logger.log(log.replace(/<[^>]*>/g, ''));
  var message = { log: log };
  Enqueue('TO_CLIENT', message);
}
  
/**
 * NoticePrompt - Sends a prompt to the sidebar and blocks until the user responds.
 * SIDEBAR-ONLY (see file header). Returns null if the sidebar closes or times out.
 * @param {string} prompt - Prompt text displayed in the sidebar
 * @returns {string|null} User's response, or null on timeout/close
 */
function NoticePrompt(prompt) {
  var message = { prompt: prompt }; 
  sendToClient(message);
  updateClientActivityTime(); // update the last client activity time to prevent timeout

  var response = null;
  var maxIterations = 120; // 120 × 1s = 2 min max; prevents exhausting the 6-min GAS limit
  var iterations = 0;
  while (!response) {
    if (iterations >= maxIterations) {
      Logger.log('NoticePrompt: max wait time exceeded (' + maxIterations + 's) — returning null');
      return null;
    }
    response = getServerMessage(); // check for a response from the server queue
    if (!response) {
      // if the client has not made a callback in 10 seconds then we will timeout
      if (getLastClientActivityTime() + 10000 < new Date().getTime()) {
        Logger.log('NoticePrompt: client inactive for 10s — timed out');
        return null;
      }
      Utilities.sleep(1000);
      iterations++;
    }
  }
  return response;
}

function initMessageQueues() {
  if (!runWithLock(function() {
    setScriptProperty('TO_SERVER', []);
    setScriptProperty('TO_CLIENT', []);
    updateClientActivityTime();
  })) {
    Logger.log('initMessageQueues: lock acquisition failed — queues may not be fully initialized');
  }
}

// setScriptProperties - set the script properties with the messages object
function setScriptProperty(prop, messages) {
  PropertiesService.getScriptProperties().setProperty(prop, JSON.stringify(messages));
}
// getScriptProperties - get the messages object from the script properties
function getScriptProperty(prop) {
  var messages = PropertiesService.getScriptProperties().getProperty(prop);
  return messages ? JSON.parse(messages) : null;
}

// run a function guaranteed to prevent concurrent access to the script properties
// returns true if the lock was acquired and func ran, false if lock timed out
function runWithLock(func) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);  // wait 30 seconds before conceding an error
  } catch (e) {
    Logger.log('runWithLock: lock acquisition failed — ' + e.message);
    return false;
  }
  try {
    func();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Function to handle submit form response callback from client.  
// Enqueues the response to the script properties.
function sendToServer(message) {
  // run the following code with a lock to prevent concurrent access to the script properties
  Enqueue('TO_SERVER', message);
  setScriptProperty('LastClientAction', new Date().getTime());
}
function getServerMessage() {
  var msg;
  msg = Dequeue('TO_SERVER');
  return msg;
}

function sendToClient(message) {
  Enqueue('TO_CLIENT', message);
}

// Signals the sidebar to stop polling. Call once at the end of any workflow that uses NoticeLog.
function noticeLogDone_() {
  sendToClient({done: true});
}

// getMessages - sidebar callback to retrieve the messages property safely ensuring concurrency is handled.
function getClientMessage() {
  var msg;
  msg = Dequeue('TO_CLIENT');
  updateClientActivityTime();
  return msg;
}

function updateClientActivityTime() {
  setScriptProperty('LastClientAction', new Date().getTime());
}
// get the last time the client accessed the server
function getLastClientActivityTime() {
  return getScriptProperty('LastClientAction');
}
var QUEUE_MAX_BYTES_ = 8000; // PropertiesService limit is 9KB; 8KB leaves headroom

function Enqueue( type, response ) {
  if (!runWithLock(function() {
    var queue = getScriptProperty(type);
    if (!queue) {
      queue = [response];
    } else {
      queue.push(response);
    }
    // Guard against PropertiesService 9KB per-property limit
    if (JSON.stringify(queue).length > QUEUE_MAX_BYTES_) {
      while (JSON.stringify(queue).length > QUEUE_MAX_BYTES_ && queue.length > 1) {
        queue.shift();
      }
      queue.unshift({log: '[Warning: queue overflow — earlier messages were dropped]'});
    }
    setScriptProperty(type, queue);
  })) {
    Logger.log('Enqueue: lock acquisition failed — message dropped for queue: ' + type);
  }
}
  
function Dequeue( type ) {
  var response = null;
  if (!runWithLock(function() {
    var queue = getScriptProperty(type);
    if (queue && queue.length > 0) {
      response = queue.shift();
      setScriptProperty(type, queue);
    }
  })) {
    Logger.log('Dequeue: lock acquisition failed — returning null for queue: ' + type);
  }
  return response;
}

