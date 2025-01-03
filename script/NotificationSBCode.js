// Description: Code for the Notification Sidebar
  
  // Function to handle prompt responses, called from the sidebar
  // update the script properties with the response
  function handlePromptResponse(response) {
    // run the following code with a lock to prevent concurrent access to the script properties
    runWithLock(function() {
      var messages = getScriptProperties();
      messages.response = response;
      messages.prompt = null;
      setScriptProperties(messages);
    });
  }
  
  // getMessages - sidebar callback to retrieve the messages property safely ensuring concurrency is handled.
  function getMessages() {
    var msg;
    runWithLock(function() {
      msg = getScriptProperties();
      setScriptProperties({ lastupdate: new Date().getTime() }); // clear the messages
    });
    return [msg];
  }
  // Function to show the sidebar
  function showSidebarFromFile() {
    var html = HtmlService.createHtmlOutputFromFile('NotificationSidebar');
    SpreadsheetApp.getUi().showSidebar(html);
  }
  
  // blf( text, link ) - create a link in the sidebar
  function blf( text, link ) { 
    // construct an html hyperlink
    return '<a href="' + link + '">' + text + '</a>';
  }

  // Test function to populate the sidebar with different types of messages
  function testNotificationSidebar() {
    NoticeLogInit( `Testing Notification Sidebar`, 
                  `This tests the notification sidebar functionality 
                  showing a title, <b>description</b>, log messages, and a 
                  prompt for response.` );
    NoticeLog( "progress step 1" );
    Utilities.sleep(2000);
    NoticeLog( "progress step 2" );
    Utilities.sleep(2000);
    NoticeLog( "progress step 3" );
    Utilities.sleep(2000);

    NoticeLog(`Click ${blf("here", "https://example.com")} to access the link`);
    Utilities.sleep(2000);

    var x = NoticePrompt( "Enter your name", "Please enter your name:" );
    NoticeLog( "You entered " + x );
    Utilities.sleep(2000);
    NoticeLog( "Test complete" ); 
  }

  // NoticeLogInit - creates a new sidebar, initializing the log and creating a description area
  function NoticeLogInit( title, desc ) {
    var messages = {
      title: title,
      desc: desc,
      log: [],
      prompt: null,
      response: null,
    };

    // run setscriptproperties with a lock to prevent concurrent access to the script properties
    runWithLock(function() {
      setScriptProperties(messages);
    });
    showSidebarFromFile();
  }

  function NoticeLog( message ) {
    // run the following code with a lock to prevent concurrent access to the script properties
    runWithLock(function() {
      var messages = getScriptProperties();
      // if messages does not have a log property, create one
      if (!messages.log) {
        messages.log = [];
      }
      messages.log.push( message );
      setScriptProperties(messages);
    });
  }
  
//********************************************************************************************************************
// NoticePrompt - send a prompt to the sidebar and wait for a response
//   prompt - the prompt to display in the sidebar
//   returns the user's response
//   Note: this function will block until a response is received
//         or the user closes the sidebar
function NoticePrompt(prompt) {
  // send the prompt to the sidebar with a lock to prevent concurrent access to the script properties
  runWithLock(function() {
    var messages = getScriptProperties();
    messages.prompt = prompt;
    setScriptProperties(messages);
  });

  // monitor the messages.prompt in a loop until it is cleared at which time, return the response.
  Logger.log('Waiting for: ' + prompt);
  var logInterval = 60000; // 1 minute
  var lastLogTime = new Date().getTime();
  var timedout = false;

  while (!timedout) {
    var response = null;
    var currentTime = new Date().getTime();
    if (currentTime - lastLogTime >= logInterval) {
      Logger.log('Waiting for user response...');
      lastLogTime = currentTime;
    }
    runWithLock(function() {
      var messages = getScriptProperties();
      if (messages.response) {
        response = messages.response;
        messages.response = null;
        setScriptProperties(messages);
      }
      Logger.log(messages);
      if (messages.lastupdate && (messages.lastupdate + 5000) < currentTime) {
        timedout = true;
        Logger.log('lastupdate was too long ago');
      }
    });

    if (response) {
      Logger.log('User response received: ' + response);
      return response;
    }
    Utilities.sleep(1000); // Sleep for 1 second
  }
}

// setScriptProperties - set the script properties with the messages object
function setScriptProperties(messages) {
  PropertiesService.getScriptProperties().setProperty('MESSAGES', JSON.stringify(messages));
}
// getScriptProperties - get the messages object from the script properties
function getScriptProperties() {
  var messages = PropertiesService.getScriptProperties().getProperty('MESSAGES');
  return messages ? JSON.parse(messages) : {};
}

// run a function guaranteed to prevent concurrent access to the script properties
function runWithLock(func) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);  // wait 30 seconds before conceding an error
    func();
  } catch (e) {
    Logger.log('Error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}
