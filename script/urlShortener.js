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
      if (error.message.toLowerCase().includes("alias") || error.message.toLowerCase().includes("already used")) {
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

/**
 * Re-points an EXISTING TinyURL alias at a new destination, rather than minting a new short
 * URL (F3Go30-833s.11 AC4). This is the only way to migrate short links that are already
 * distributed — pasted into Slack, saved as PAX bookmarks — since those cannot be edited where
 * they sit; the alias they resolve through is the one editable thing left.
 *
 * TinyURL's API does support this: PATCH https://api.tinyurl.com/change with
 * {domain, alias, url} updates the destination of an alias owned by the token's account.
 * Note the failure mode that makes verification non-optional: an alias NOT owned by this
 * account (e.g. minted under a different token) is not editable, and shortenUrlWithTinyUrl's
 * create path would silently mint `<alias>-1` instead — a different, undistributed short URL
 * that leaves every existing link still pointing at the old target. Callers must therefore
 * treat this as best-effort and re-verify the redirect target afterwards
 * (resolveShortUrlRedirectTarget_, CreateNewTracker.js) rather than assuming success.
 *
 * @param {string} alias The bare alias (no domain, no slashes) to re-point.
 * @param {string} newLongUrl The destination the alias should resolve to.
 * @returns {boolean} True if the API reported the change applied; false on any failure.
 */
function repointTinyUrlAlias(alias, newLongUrl) {
  const accessToken = PropertiesService.getScriptProperties().getProperty('TINYURL_ACCESS_TOKEN');
  if (!accessToken) {
    Logger.log('repointTinyUrlAlias: TINYURL_ACCESS_TOKEN missing — cannot re-point ' + alias);
    return false;
  }

  const options = {
    "method": "put",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + accessToken, "X-HTTP-Method-Override": "PATCH" },
    "payload": JSON.stringify({ domain: "tinyurl.com", alias: alias, url: newLongUrl }),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch("https://api.tinyurl.com/change", options);
    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      Logger.log('repointTinyUrlAlias: HTTP ' + statusCode + ' for alias ' + alias + ': ' + response.getContentText());
      return false;
    }
    return true;
  } catch (error) {
    Logger.log('repointTinyUrlAlias: fetch failed for alias ' + alias + ': ' + error.message);
    return false;
  }
}

/**
 * Extracts the bare alias from a short URL ('https://tinyurl.com/Go30Signup' → 'Go30Signup'),
 * so a stored short URL can be re-pointed without also storing its alias separately.
 * @param {string} shortUrl
 * @returns {string} The last path segment, or '' if there isn't one.
 */
function extractShortUrlAlias_(shortUrl) {
  if (!shortUrl) return '';
  var withoutQuery = String(shortUrl).split('?')[0].replace(/\/+$/, '');
  var segments = withoutQuery.split('/');
  var last = segments[segments.length - 1] || '';
  return /^[a-zA-Z0-9_-]+$/.test(last) ? last : '';
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

  // Add custom alias if provided — TinyURL requires [a-zA-Z0-9_-] only
  if (customAlias) {
    payload.alias = customAlias.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
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


if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractShortUrlAlias_: extractShortUrlAlias_,
    repointTinyUrlAlias: repointTinyUrlAlias,
  };
}
