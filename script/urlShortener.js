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

  const apiUrl = "https://api-ssl.bitly.com/v4/shorten";
  const payload = {
    "long_url": longUrl
  };

  // Add custom alias if provided
  if (customAlias) {
    payload.domain = "bit.ly"; // Specify the domain (e.g., "bit.ly" or "j.mp")
    payload.custom_bitlink = `https://bit.ly/${customAlias}`; // Full custom URL
  }

  const options = {
    "method": "POST",
    "contentType": "application/json",
    "headers": {
      "Authorization": "Bearer " + accessToken
    },
    "payload": JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());

    if (json.link) {
      return json.link; // Return the shortened URL
    } else {
      throw new Error("Bitly API response did not include a shortened URL.");
    }
  } catch (error) {
    Logger.log("Error while shortening URL with Bitly: " + error.message);
    throw new Error("Failed to shorten URL with Bitly. Please check the API token, input URL, and custom alias.");
  }
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
    "payload": JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());

    if (json.data && json.data.tiny_url) {
      return json.data.tiny_url; // Return the shortened URL
    } else {
      throw new Error("TinyURL API response did not include a shortened URL.");
    }
  } catch (error) {
    Logger.log("Error while shortening URL with TinyURL: " + error.message);
    throw new Error("Failed to shorten URL with TinyURL. Please check the API token, input URL, and custom alias.");
  }
}


