function shortenAndShareSpreadsheet(spreadsheetUrl, customAlias) {
  // Default Spreadsheet URL
  const defaultSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/1y2c5r-_R0UJRdjEcDPpQSG9WtepTV6JFuYwCB0xbCak/edit?usp=sharing";
  // Default Custom Alias
  const defaultCustomAlias = "202501F3Go30"; // Replace with your desired default alias

  // Use the provided URL or the default URL
  const urlToUse = spreadsheetUrl || defaultSpreadsheetUrl;
  // Use the provided custom alias or the default custom alias
  const aliasToUse = customAlias || defaultCustomAlias;

  // Get the spreadsheet
  const spreadsheet = SpreadsheetApp.openByUrl(urlToUse);

  // Set spreadsheet sharing settings using DriveApp
  const file = DriveApp.getFileById(spreadsheet.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  // Shorten URL using Bitly API with the custom alias
  const shortUrl = shortenUrlWithBitly(urlToUse, aliasToUse);
  
  Logger.log("Shortened URL: " + shortUrl);
}

function shortenUrlWithBitly(longUrl, customAlias) {
  // Retrieve Bitly API token from PropertiesService
  // see Apps Script Project / Settings > Properties
  const accessToken = PropertiesService.getScriptProperties().getProperty('BITLY_ACCESS_TOKEN');

  const apiUrl = "https://api-ssl.bitly.com/v4/shorten";
  const payload = {
    "long_url": longUrl
  };

  // Add custom alias if provided
  if (customAlias) {
    payload.domain = "bit.ly";
    payload.custom_bitlink = `bit.ly/${customAlias}`;
  }

  const options = {
    "method": "POST",
    "contentType": "application/json",
    "headers": {
      "Authorization": "Bearer " + accessToken
    },
    "payload": JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const json = JSON.parse(response.getContentText());
  return json.link;
}
