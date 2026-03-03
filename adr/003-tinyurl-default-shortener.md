# ADR-003: TinyURL as Default URL Shortener

Status: Accepted
Date: 2026-03-02

## Context
After Copy and Initialize, the Q needs shareable short URLs for the new tracker sheet and HC form. Full Google Drive and Sheets URLs are long and impractical to share in Slack or verbally. Two services were available: TinyURL (supports custom aliases, free tier with token) and Bitly (also supports aliases, requires paid plan for custom domains). The script needs retry logic because custom alias registration can conflict if a prior alias exists.

## Decision
TinyURL is the default URL shortening service. Bitly is supported as an alternative by changing the `service` parameter in `shortenUrl()`. The active token is stored as a Script Property (`TINYURL_ACCESS_TOKEN`). Retry logic attempts up to 5 times with incrementing alias suffixes on conflict.

## Consequences
- Site Qs must obtain and configure a TinyURL API token in Script Properties before first use.
- If TinyURL is unavailable or the token is invalid, the script falls back to the full URL and logs the failure.
- Switching to Bitly requires adding `BITLY_ACCESS_TOKEN` to Script Properties and updating the `service` parameter at the call site in `CreateNewTracker.js`.
- Error handling for non-200 responses is currently insufficient — actionable error messages are not always surfaced. See PLAN.md Backlog #3.
