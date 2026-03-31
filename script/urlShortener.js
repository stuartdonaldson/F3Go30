function testShortenUrl() {
  const longUrl = "https://www.example.com/some/very/long/url.3";
  const customAlias = "F3testAlias123";

  try {
    Logger.log("Testing TinyURL Shortener...");
    const tinyUrl = shortenUrl(longUrl, customAlias, 5, "tinyurl");
    Logger.log("TinyURL Shortened URL: " + tinyUrl);
  } catch (error) {
    Logger.log("Error with TinyURL Shortener: " + error.message);
  }

  try {
    Logger.log("Testing Bitly Shortener...");
    const bitlyUrl = shortenUrl(longUrl, customAlias, 5, "bitly");
    Logger.log("Bitly Shortened URL: " + bitlyUrl);
  } catch (error) {
    Logger.log("Error with Bitly Shortener: " + error.message);
  }
}
/**
 * Shortens a URL using the specified service with retry logic.
 * @param {*} longUrl - The long URL to shorten.
 * @param {*} customAlias - The custom alias to use (if any).
 * @param {*} tries - The number of retry attempts.
 * @param {*} service - The URL shortening service to use (e.g., "tinyurl" or "bitly").
 * @returns The shortened URL.
 */
function shortenUrl(longUrl, customAlias, tries = 5, service = "tinyurl") {
  let shortenerFunction;

  // Determine which shortener function to use based on the service
  if (service.toLowerCase() === "tinyurl") {
    shortenerFunction = shortenUrlWithTinyUrl;
  } else if (service.toLowerCase() === "bitly") {
    shortenerFunction = shortenUrlWithBitly;
  } else {
    throw new Error(`Unsupported URL shortener service: ${service}`);
  }

  // Attempt to shorten the URL with retries
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      // Modify the alias for retries (use a dash instead of a period)
      const aliasToUse = attempt === 0 ? customAlias : `${customAlias}-${attempt}`;
      Logger.log(`Attempting to shorten URL with alias: ${aliasToUse}`);
      
      // Call the appropriate shortener function
      const shortUrl = shortenerFunction(longUrl, aliasToUse);
      Logger.log(`Successfully shortened URL: ${shortUrl}`);
      return shortUrl; // Return the shortened URL if successful
    } catch (error) {
      // Check if the error is related to alias unavailability
      if (error.message.includes("alias") || error.message.includes("already used")) {
        Logger.log(`Alias "${customAlias}" unavailable. Retrying with a new alias...`);
      } else {
        // If the error is unrelated to alias, rethrow it
        throw new Error(`Failed to shorten URL: ${error.message}`);
      }
    }
  }
  // If all attempts fail, throw an error
  throw new Error(`Failed to shorten URL after ${tries} attempts. All aliases were unavailable.`);
}

function shortenUrlWithBitly(longUrl, customAlias) {
  // Retrieve Bitly API token from PropertiesService
  // see Apps Script Project / Settings > Properties
  const accessToken = PropertiesService.getScriptProperties().getProperty('BITLY_ACCESS_TOKEN');

  if (!accessToken) {
    throw new Error("Bitly API access token is missing. Please set it in the script properties.");
  }

  // /v4/shorten does not support custom aliases — use /v4/bitlinks + PATCH for that.
  // We shorten first, then apply the alias via /v4/custom_bitlinks if one is requested.
  const apiUrl = "https://api-ssl.bitly.com/v4/shorten";
  const payload = { "long_url": longUrl };

  const options = {
    "method": "POST",
    "contentType": "application/json",
    "headers": {
      "Authorization": "Bearer " + accessToken
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error('Bitly API returned HTTP ' + statusCode + ': ' + response.getContentText());
  }
  const json = JSON.parse(response.getContentText());
  if (!json.link) {
    throw new Error('Bitly API response did not include a shortened URL: ' + response.getContentText());
  }
  const shortUrl = json.link;

  // Apply custom alias via the correct endpoint if requested
  if (customAlias) {
    const customPayload = { "custom_bitlink": 'bit.ly/' + customAlias, "bitlink_id": json.id };
    const customOptions = {
      "method": "POST",
      "contentType": "application/json",
      "headers": { "Authorization": "Bearer " + accessToken },
      "payload": JSON.stringify(customPayload),
      "muteHttpExceptions": true
    };
    const customResponse = UrlFetchApp.fetch("https://api-ssl.bitly.com/v4/custom_bitlinks", customOptions);
    if (customResponse.getResponseCode() === 200 || customResponse.getResponseCode() === 201) {
      return 'https://bit.ly/' + customAlias;
    }
    // Alias unavailable or quota error — return the random short URL and let caller retry
    Logger.log('Bitly custom alias failed (HTTP ' + customResponse.getResponseCode() + '): ' + customResponse.getContentText());
    throw new Error('alias ' + customAlias + ' already used');
  }

  return shortUrl;
}

function shortenUrlWithTinyUrl(longUrl, customAlias) {
  const apiUrl = "https://api.tinyurl.com/create";

  // Retrieve TinyURL API token from PropertiesService
  const accessToken = PropertiesService.getScriptProperties().getProperty('TINYURL_ACCESS_TOKEN');

  if (!accessToken) {
    throw new Error("TinyURL API access token is missing. Please set it in the script properties.");
  }

  const payload = {
    "url": longUrl
  };

  // Add custom alias if provided
  if (customAlias) {
    payload.alias = customAlias;
  }

  const options = {
    "method": "POST",
    "contentType": "application/json",
    "headers": {
      "Authorization": "Bearer " + accessToken
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error('TinyURL API returned HTTP ' + statusCode + ': ' + response.getContentText());
  }
  const json = JSON.parse(response.getContentText());
  if (json.data && json.data.tiny_url) {
    return json.data.tiny_url;
  } else {
    throw new Error('TinyURL API response did not include a shortened URL: ' + response.getContentText());
  }
}


