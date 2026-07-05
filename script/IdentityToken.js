/*
 * IdentityToken.js
 *
 * Stateless signed tokens binding {f3Name, email} for a bookmarkable "remember me" check-in
 * link. Why this exists instead of relying on localStorage (see bd F3Go30-4j4o): iOS WebKit's
 * Intelligent Tracking Prevention caps ALL script-writable storage (localStorage included) to 7
 * days without a genuine top-level visit to the storage-owning domain — and Apps Script's
 * content always renders inside a nested sandboxed iframe served from a googleusercontent.com
 * subdomain the user never directly navigates to, so that domain never gets "top-level visit"
 * credit no matter how often the outer script.google.com page is visited. A token embedded in
 * the URL itself sidesteps browser storage entirely; confirmed live on SIT that a target="_top"
 * link can carry it back to a real script.google.com address bar (see the spike in the
 * 2026-07-04 session).
 *
 * Token format: base64url(mintedAtMs|f3Name|email) + '.' + base64url(HMAC-SHA256 of that
 * payload). mintedAtMs comes first specifically because it's guaranteed digits-only (no '|'),
 * so decoding can split on the FIRST '|' unambiguously regardless of what's in f3Name/email.
 *
 * Verifying a token only proves the signature matches this script's secret — it does NOT by
 * itself grant access to anything. Every caller must still re-resolve the decoded f3Name/email
 * against the live Tracker exactly as if freshly typed (resolveCheckinIdentity_ etc.), so a
 * token can never outlive the PAX's actual roster entry (e.g. removed/renamed).
 *
 * mintedAtMs also lets a caller tell "this token was just generated and the PAX is looking at
 * it for the first time" apart from "this is an old bookmark/Home Screen icon being reopened" —
 * without needing any client-side storage to remember which case it is (see
 * handleCheckinIdentify_'s recentlyMinted and CheckinApp.html's bookmark-prompt logic).
 */

var IDENTITY_TOKEN_SECRET_PROPERTY_ = 'IDENTITY_TOKEN_SECRET';

/** Lazily generates and persists the HMAC signing secret on first use — no manual bootstrap
 *  step, unlike ADMIN_SHARED_SECRET, since this key only needs to resist forgery, not gate
 *  administrative access. */
function getOrCreateIdentityTokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(IDENTITY_TOKEN_SECRET_PROPERTY_);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(IDENTITY_TOKEN_SECRET_PROPERTY_, secret);
  }
  return secret;
}

function base64UrlEncode_it_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

function base64UrlDecode_it_(str) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(str)).getDataAsString();
}

function signPayload_it_(payload, secret) {
  var raw = Utilities.computeHmacSha256Signature(payload, secret);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

/** Manual constant-time string compare — Apps Script has no built-in, and a naive === leaks
 *  signature bytes via early-exit timing. Length is not secret (equivalent to any two
 *  different-length signatures failing), only per-character equality once lengths match. */
function constantTimeEquals_it_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} f3Name
 * @param {string} email
 * @returns {string} Opaque token safe to embed in a URL query param.
 */
function mintIdentityToken_(f3Name, email) {
  var payload = String(Date.now()) + '|' + String(f3Name || '') + '|' + String(email || '');
  var encodedPayload = base64UrlEncode_it_(payload);
  var signature = signPayload_it_(payload, getOrCreateIdentityTokenSecret_());
  return encodedPayload + '.' + signature;
}

/**
 * @param {string} token
 * @returns {{f3Name:string, email:string, mintedAtMs:number}|null} null for anything malformed
 *   or unsigned by this script — never throws, so callers can treat it exactly like a failed
 *   lookup.
 */
function verifyIdentityToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var payload;
  try {
    payload = base64UrlDecode_it_(parts[0]);
  } catch (e) {
    return null;
  }
  var expectedSignature = signPayload_it_(payload, getOrCreateIdentityTokenSecret_());
  if (!constantTimeEquals_it_(parts[1], expectedSignature)) return null;
  var mintedAtSep = payload.indexOf('|');
  if (mintedAtSep === -1) return null;
  var mintedAtMs = Number(payload.slice(0, mintedAtSep));
  if (!isFinite(mintedAtMs)) return null;
  var rest = payload.slice(mintedAtSep + 1);
  var identitySep = rest.indexOf('|');
  if (identitySep === -1) return null;
  return { f3Name: rest.slice(0, identitySep), email: rest.slice(identitySep + 1), mintedAtMs: mintedAtMs };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mintIdentityToken_: mintIdentityToken_,
    verifyIdentityToken_: verifyIdentityToken_,
  };
}
