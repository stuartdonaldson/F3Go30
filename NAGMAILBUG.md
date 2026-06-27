# Nag Email Bug Report

**Date:** 2026-06-26  
**Issue:** Nag email trigger failed at 10:04 AM Pacific Daylight Time (17:04 UTC)  
**Status:** Unknown if still occurring

## Symptom

Daily nag email trigger executed but failed to send any emails due to an Invalid Date error.

```
Error: resolveTrackerDbRowForContextDate_: invalid context date: Invalid Date
```

## Execution Details

**ExecId:** `aa25fe31-9a64-4e35-905e-3d4496e9b8e6`  
**Timestamp:** 2026-06-26T17:04:02.976Z (10:04 AM PDT)  
**Target:** TEMPLATE (production)  
**Version:** 2.2.44  
**Trigger Type:** Daily time-based trigger at 10:00 AM local time  
**RunId:** gaslogger-test  

## Stack Trace

```
resolveTrackerDbRowForContextDate_ (go30tools:400:9)
  ← called from resolveTrackerForContextDate (go30tools:447:9)
  ← called from sendNagEmail_ (nag:209:20)
```

## Root Cause Analysis

The daily trigger is configured in `nag.js:25-33`:
```javascript
ScriptApp.newTrigger('sendNagEmail')
  .timeBased()
  .everyDays(1)
  .inTimezone(Session.getScriptTimeZone())
  .atHour(10)
  .nearMinute(0)
  .create();
```

When the trigger fires, it calls `sendNagEmail()` with **no arguments**, so `contextDate = undefined`.

**Expected flow at nag.js:206:**
```javascript
var today = contextDate instanceof Date ? contextDate : new Date(contextDate || Date.now());
```

With `contextDate = undefined`:
- `contextDate instanceof Date` → false
- `contextDate || Date.now()` → returns `Date.now()` (a number)
- `new Date(Date.now())` → should create a **valid Date**

**Actual result:** An Invalid Date object was created and propagated to `resolveTrackerForContextDate()`.

At `go30tools.js:398-400`, the invalid date check:
```javascript
var context = contextDate instanceof Date ? contextDate : new Date(contextDate);
if (isNaN(context.getTime())) {
    throw new Error('resolveTrackerDbRowForContextDate_: invalid context date: ' + contextDate);
}
```

This threw because `context` was an Invalid Date object.

## Possible Causes

### 1. Invalid Date at Line 206 (Most Likely)
If `today` is an Invalid Date, then `yesterday` (created at line 207-208) would also be invalid:
```javascript
var yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
```

But the defensive code at line 206 should prevent this. **How could an Invalid Date be created from `new Date(Date.now())`?**

Potential explanations:
- Bug in deployed code differs from repo version
- Race condition or corruption during trigger invocation
- Timezone-related issue with `Session.getScriptTimeZone()`
- JavaScript runtime bug (unlikely)

### 2. WebApp.js Admin Endpoint (Ruled Out)
`WebApp.js:239` can create Invalid Date if called with bad string:
```javascript
var contextDate = payload.contextDate ? new Date(payload.contextDate) : new Date();
```

However, the trigger is a time-based trigger, not an admin call, so this is not the cause.

### 3. Code Version Mismatch
Current deployed version is 2.2.44. Recent commits show no changes to nag email date handling. But the code in the deployed script could differ from the repo.

## Investigation Gaps

1. **Is this still occurring?** Need to confirm if the 10:04 AM error was a one-time incident or happens daily.
2. **What's the actual deployed code?** The code in the repo looks correct; the deployed version may differ.
3. **Timezone verification:** What timezone is the script project set to? Does `Session.getScriptTimeZone()` return a valid value?
4. **Test the trigger manually:** Call `sendNagEmail()` directly from the script editor to verify it works.

## Files Involved

| File | Line | Issue |
|------|------|-------|
| `script/nag.js` | 25-33 | Trigger setup |
| `script/nag.js` | 196-200 | Entry point `sendNagEmail()` |
| `script/nag.js` | 202-214 | Function `sendNagEmail_()` where error originated |
| `script/nag.js` | 206-210 | Date construction and resolution (suspicious) |
| `script/go30tools.js` | 397-430 | `resolveTrackerDbRowForContextDate_()` error check |
| `script/go30tools.js` | 441-448 | `resolveTrackerForContextDate()` wrapper |
| `script/WebApp.js` | 236-242 | Admin `runNagCheck` endpoint (creates Date from payload) |

## Reproduction Steps

1. Wait for daily trigger to fire at 10:00 AM (or manually invoke `sendNagEmail()`)
2. Check Axiom logs for `sendNagEmail.dispatch` and error tag with `execId`
3. Verify if error still occurs or if it was a one-time incident

## Recommended Actions

1. **Verify current status:** Run `sendNagEmail()` manually in the script editor and check logs
2. **Audit deployed code:** Compare deployed `nag.js` line 206 with repo version
3. **Add defensive logging:** Add `GasLogger.log()` before the `new Date()` call to log what's being passed
4. **Check timezone:** Verify `Session.getScriptTimeZone()` returns a valid timezone
5. **Consider edge case handling:** Add explicit validation that `today` is valid before using it
