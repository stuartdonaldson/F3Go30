# DESIGN — F3Go30

## Solution Strategy

Spreadsheet creation follows a **copy-from-template** pattern: a working spreadsheet (and its
bound form) is duplicated rather than built from scratch each month. New tracker names are
auto-generated as `YYYY-MM-NameSpace` (e.g. `2026-04-F3Waxhaw`) using the start date and the
`NameSpace` value from the Config sheet; operators are not prompted for a name. This avoids the
complexity of programmatically creating Google Forms with correct ownership — a restriction
Google Apps Script does not fully support across accounts. The owner-only menu gate enforces that
only the authorized Q can trigger destructive or structural operations. A sidebar notification
panel (rather than `alert()` dialogs) allows the script to stream progress updates during
long-running copy operations without blocking execution.

Programmatic form generation was explored but deferred — the Google Forms API does not support
ownership transfer, making full automation impossible for cross-account regional bootstrapping.
See ADR-004.

**Script execution is centralized** (ADR-010): only the spreadsheet-creation step above produces
a new physical spreadsheet. All triggers, dispatch, and logic run exclusively in the Template's
bound script. A monthly tracker copy is registered for execution by adding a row to `TrackerDB`
(spreadsheet ID, form ID, active date range) — it does not get its own triggers. Centrally-run
functions resolve "which spreadsheet do I operate on" by looking up a **context date** against
`TrackerDB`, then call `SpreadsheetApp.openById()` on the resolved target. This also means Script
Properties (Axiom token, GasLogger config, URL-shortener keys) are configured once, on the
Template, and are visible to every dispatched operation — they previously had to be re-entered
per copy because `SpreadsheetApp.copy()` never duplicates Script Properties.

---

## Runtime Architecture

```mermaid
%%{init: {'theme': 'architecture-beta'}}%%
graph TD
    A[Q opens spreadsheet] --> B[onOpen — owner check]
    B --> C{Owner?}
    C -- Yes --> D[F3 Go30 menu shown]
    C -- No --> E[No menu]
    D --> F[Copy and Initialize]
    F --> G[Copies spreadsheet + form]
    G --> H[initSheets — resets all sheets]
    H --> I[URL shortening]
    I --> TDB[Register row in TrackerDB]
    TDB --> J[Sidebar: links to new tracker]
    %% Q background tasks (manual, in-browser)
    J --> BG1[Verify Tracker sheet]
    J --> BG3[Update Go30 Links and Slack]
    %% Centralized dispatch — installed once on the Template
    L[Daily 1 AM trigger — Template only] --> LDB[Resolve context date against TrackerDB]
    LDB --> P[markEmptyCellsAsMinusOne — writes −1 for missed days, per resolved tracker]
    N[PAX submits HC form] --> M[Form-submit dispatcher — Template only]
    M --> MDB[Resolve form ID against TrackerDB]
    MDB --> O[onFormSubmit — adds PAX row to resolved Tracker]
    D --> MT[Initialize Monthly Trigger]
    MT --> MTrig[Monthly trigger — 20th of month, Template only]
    MTrig --> AGS[autoGenerateNextMonthTracker]
    AGS --> EmailQ[Emails Site Q with links + Slack message]
classDef lightblue fill:#ADD8E6,stroke:#333,stroke-width:1px,color:#000
class A,B,C,D,E,F,G,H,I,TDB,J,L,LDB,M,MDB,N,O,P,MT,MTrig,AGS,EmailQ lightblue
classDef lightgreen fill:#90EE90,stroke:#333,stroke-width:1px,color:#000
class BG1,BG3 lightgreen
```

---

## Building Block View

### Level 1 — System Overview

| Module | Files | Responsibility |
|--------|-------|---------------|
| Entry Points | `onOpen.js` | Custom menu |
| Tracker Lifecycle | `CreateNewTracker.js`, `CopyTemplate.js`, `addResponseOnSubmit.js`, `markMinusOne.js`, `nag.js` | Copy-and-init workflow, template-copy mechanics, form-submit handler, nightly miss marking, daily reminder email workflow — all triggers installed once on the Template and dispatching by `TrackerDB` lookup (ADR-010) |
| Dispatch / TrackerDB | `go30tools.js` | `TrackerDB`/`PaxDB` schema, cross-tracker aggregation, and (per ADR-010) the context-date → target-spreadsheet resolution used by every centrally-dispatched function |
| Web Apps | `WebApp.js`, `signupWebapp.js`, `SignupApp.html`, `dashboardWebapp.js`, `CheckinApp.html`, `IdentityCore.html`, `HomeApp.html`, `bonusWebapp.js` | `doGet`/`doPost` dispatcher by `cmd` query param (`signup`, `checkin`, `admin`); each `cmd` renders its own `HtmlService` template and handles its own `action`-keyed POST body. `signupWebapp.js`/`SignupApp.html` = HC sign-up; `dashboardWebapp.js`/`CheckinApp.html` = daily check-in + PAX dashboard, reading/writing the current month's Tracker sheet directly (no separate data store); `bonusWebapp.js` = bonus-list/add/edit actions under the same `checkin` cmd; `IdentityCore.html` = client-side identity/HTTP plumbing shared by both `SignupApp.html` and `CheckinApp.html` (see `include_()` below); no `cmd` (or an unrecognized one) renders `HomeApp.html`, a landing page linking to sign-up, check-in/dashboard, and the current month's tracker spreadsheet |
| Identity / Check-in | `CheckinSessions.js`, `IdentityToken.js` | Bookmarkable check-in link — `CheckinSessions.js` mints/resolves a server-stored GUID session so a returning PAX can reload the check-in/dashboard page without re-entering F3 Name + Email each visit; `IdentityToken.js`'s signed-token verify path is kept only to honor links minted before the rollout (see the decision below) |
| Bonus Rules | `BonusTypes.js` | Centralized bonus-type registry (rule definitions: points, link requirement, cap) consumed by `dashboardWebapp.js`/`bonusWebapp.js` chip rendering and validation |
| Email | `onboardingEmail.js`, `responseSettingsEmail.js`, `signupEmail.js`, `signupReuse.js` + matching `*Template.html` files | Site-Q onboarding email, response-settings confirmation email, sign-up confirmation email, and repeat-signup detection/reuse |
| UI / Notifications | `NotificationSBCode.js`, `NotificationSidebar.html` | Sidebar panel: log streaming, prompts, HTML link generation |
| Utilities | `logActivity.js`, `urlShortener.js`, `Utilities.js`, `libSheets.js`, `response_utils.js`, `PaxCache.js`, `GasLogger.js`, `logFile.js`, `version.js` | Activity logging, URL shortening (TinyURL/Bitly), cell utilities, Config sheet reads, sheet-access helpers, response-parsing helpers, PAX lookup caching, Axiom log sink, log-file download support, version/About constants |

---

## Runtime View

Known code-level risks:

| Scenario | Risk | Status |
|----------|------|--------|
| Tracker has fewer than 4 rows when `onFormSubmit` runs | `getRange` throws on negative row count | Guard added — F3Go30-x82 |
| URL shortener returns non-200 | Error caught but fallback URL not surfaced with actionable message | Known gap |
| `autoGenerateNextMonthTracker` installed on wrong spreadsheet | If installed on a monthly tracker instead of the template, copies from that tracker not the template | Install monthly trigger only on the template spreadsheet |
| Ambiguous or missing `TrackerDB` row match for a context date | A `TrackerDB` row with a duplicate StartDate, or no row at all covering a given date, leaves dispatch with no defined target | `resolveTrackerDbRowForContextDate_` (go30tools.js) throws rather than silently picking a row or no-op'ing (F3Go30-vr80) — an operator error (bad/missing `TrackerDB` row) still surfaces as a logged failure, not a misdirected write |
| A smoke or expired tracker spreadsheet left in the active spreadsheet's Drive folder | `scanTrackers()`'s folder walk scanned anything tracker-shaped with no filtering, so a stray smoke/expired file would land in `TrackerDB`/`PaxDB` as if real | `_qualifySourceFiles_` excludes by name (`(Smoke)`/`(Expired)`); headless runs log a warning and exclude, never silently include (F3Go30-xj1q.2) |

---

## Crosscutting Concepts

### Notification and Logging

Two logging channels serve different execution contexts:

- **Sidebar (`NoticeLog`, `NoticeLogInit`, `NoticePrompt`)** — active only after `NoticeLogInit()`
  opens the sidebar. Used inside `copyAndInit()` and `reinitializeSheets()`. Messages enqueue to
  `TO_CLIENT` PropertiesService; silently discarded if no sidebar is open.
- **Apps Script Logger (`Logger.log`)** — always available. Required for all trigger-fired and
  background functions (`onFormSubmit`, `markEmptyCellsAsMinusOne`, `autoGenerateNextMonthTracker`).
  Since these now run only in the Template (ADR-010), Logger output and `GasLogger`/Axiom sinks
  are visible in one place for every tracker's activity, not scattered across per-copy projects.

`NoticeLog()` mirrors to `Logger.log()` (HTML-stripped) regardless of sidebar state. Functions
that cannot guarantee a sidebar context must call `Logger.log()` directly.

### Caching

Freshness for every cache touching PAX/token data is driven by exactly **two**
mechanisms (ADR-016): **write-through** (every write this system performs —
webapp-driven and server-side/script-driven alike — patches or invalidates the
affected cache at the point of write) and **installable `onEdit`** (catches the
one thing write-through cannot see: a human editing `Tracker`, `Responses`, or
`Bonus Tracker` directly in the Sheets UI). The Drive-modtime poll
(`ensurePaxCacheFresh_`) is retired from the read path once these two
mechanisms cover every writer — it existed only to backstop staleness sources
the two mechanisms now own explicitly. See ADR-016 for the full rationale and
the accepted residual risk (a manual edit made in the window before `onEdit`
fires).

Ten caches make up the PAX/token-data caching surface today (from
`docs/staging/caching-consolidation-review.md`; the poll and `asOf` marker
rows are transitional and are removed once ADR-016's prerequisites land):

| # | Cache | Backing store | Granularity | Populated by | Invalidated by |
|---|-------|---------------|-------------|--------------|----------------|
| 1 | PaxCache per-PAX row (`kind=tracker`) | PropertiesService `go30pax:` | one PAX row | identity/full reads, check-in write-through | write-through patch; poll wipe; onEdit wipe; nightly purge |
| 2 | PaxCache per-PAX row (`kind=responses`) | PropertiesService `go30pax:` | one PAX row | identity/full reads | signup delete; poll wipe; onEdit wipe; nightly purge |
| 3 | PaxCache roster index | PropertiesService `go30idx:` | one map/sheet | roster rebuild, bulk write | signup patch; poll wipe; onEdit wipe |
| 4 | PaxCache asOf marker | PropertiesService `go30asof:` | one ts/sheet | poll + `markPaxCacheFreshNow_` | — (exists only to serve the poll; removed post-retirement, ADR-016) |
| 5 | Tracker layout (row2/row3) | CacheService `go30dash:trackerLayout:` | one/sheet | `getTrackerLayout_` | TTL only (21600s); poll/onEdit wipe |
| 6 | Responses layout (header+cols) | CacheService `go30dash:responsesLayout:` | one/sheet | `getResponsesLayout_` | TTL only; poll/onEdit wipe |
| 7 | Tracker full-roster values | CacheService `go30dash:trackerValues:` | whole sheet | assembled from #1+#3 | `invalidateFullRosterCache_`; poll/onEdit wipe |
| 8 | Responses full-roster values | CacheService `go30dash:responsesValues:` | whole sheet | full read | `invalidateFullRosterCache_`; poll/onEdit wipe |
| 9 | Bonus entries (pill shape) | CacheService `go30dash:bonusEntries:` | whole sheet | `getAllBonusEntriesCached_` | `invalidateBonusEntriesCache_`; poll/onEdit wipe |
| 10 | Bonus rows (client shape) | CacheService `go30dash:bonusRows:` | whole sheet | `getAllBonusRowsCached_` | `invalidateBonusEntriesCache_`; poll/onEdit wipe |

Four invalidation vocabularies currently touch these ten caches
(`invalidateFullRosterCache_`, `invalidateBonusEntriesCache_`,
`wipePaxCacheForSheet_`, `wipePaxCacheAndRelatedCachesForSheet_`) plus TTL,
plus the poll, plus onEdit, plus the nightly purge — the fragmentation
ADR-016's two-mechanism model converges on. Until the poll-retirement
prerequisites (onEdit covering all three sheets, write-through nightly sweep
and form-submit signup, onEdit provisioned on every tracker including
namespace copies) land, the poll and `asOf` marker (row 4) remain in place as
an active backstop — see the epic tracked under F3Go30-o39s for sequencing.

## Decisions (short)

- **PAX motivation data source (F3Go30-r1b) — DECIDED:** Use the `FunFacts` sheet as the motivation source. Reminder emails will include a randomly-selected entry from the `FunFacts` sheet when personalization is desired. This removes the need for an additional per-person profile submission for basic motivational text; code must implement a random-row selector and include the chosen text in the email payload.

- **Notification scope (F3Go30-a45) — DECIDED:** Notification scope is *team* by default. Reminder emails will be addressed to the team (whole tracker or sub-team when a Team column is present), but the system MUST filter recipients to include only members who have explicitly opted in via the `NAG email?` response column on the HC form (opt-in consent). The reminder trigger implementation must consult the Responses/Preferences data to honor consent before sending any emails.

- **Current implementation status:** `nag.js` sends a team-scoped nag email to opted-in recipients and pulls motivational text from the `FunFacts` sheet, per the decision above.

- **Dashboard/check-in identity (F3Go30-ln1x) — DECIDED:** The check-in web app identifies a PAX
  by F3 Name + Email — the same pair the sign-up web app already uses — rather than adding a
  password. No password concept exists anywhere else in the data model; reusing the pair keeps a
  single trust boundary and lets `resolveCheckinIdentity_` reuse `signupWebapp.js`'s
  anti-enumeration `findSignupMatch_` check unchanged. Trade-off: no stronger authentication than
  "knows the PAX's name and email" — acceptable for this internal, low-sensitivity data.

- **Bookmarkable check-in link via GUID session, baked into the form's own `action` URL
  (`CheckinSessions.js`, `CheckinApp.html`, `SignupApp.html`) — DECIDED, supersedes the original
  token+redirect design:** The original approach (a signed `IdentityToken.js` token minted only
  *after* a typed identify resolved, then handed to the PAX via a script-triggered
  `window.top.location.href` redirect) intermittently failed to redirect at all — the redirect
  fires after an async API round trip, and a sandboxed iframe's "sticky user activation" for a
  script-triggered top-level navigation is a race against time, not a guarantee, so the gap
  between click and redirect could exceed it (confirmed via live incident correlation, F3Go30
  hardening work 2026-07). The fix flips the order: a random opaque session GUID is minted
  *before* identity is known and baked directly into the identify `<form target="_top">`'s own
  `action` URL at render time, so the address bar is already correct the instant the page loads —
  the form POST *is* the top-level navigation, with no separate redirect step afterward that
  could fail to fire. `CheckinSessions.js` is the server-side session store this trades in for
  (GUID → F3 Name/Email/Created At/Last Used At, PaxCache-style roster-index + per-row cache,
  nightly-pruned by `cleanupStaleCheckinSessions_`); `IdentityToken.js`'s verify path is kept
  only to honor links minted before this rollout (see `resolveCheckinToken_dw_` in
  `dashboardWebapp.js`) and can be retired once Axiom shows no more legacy-token hits. Sign-up's
  current-month save still hands off into a tokened check-in URL the same way. Once on the
  session URL, a one-time nudge (`#bookmarkHereNote`, gated by an exact Created-At-vs-Last-Used-
  At comparison rather than a time-window heuristic) tells the PAX to bookmark this page; it does
  not reappear on later visits to the same bookmarked link. The identity/HTTP client plumbing
  both apps share (`attemptTopRedirect_`, `saveIdentityToStorage_`/`loadIdentityFromStorage_`,
  `callApi`, `hideApiError_`, `setButtonLoading_`) was consolidated (F3Go30-xj1q.1) into one
  `IdentityCore.html` `<script>`-only partial, pulled into both `SignupApp.html` and
  `CheckinApp.html` via a new `include_(filename)` helper (`WebApp.js`,
  `HtmlService.createHtmlOutputFromFile(filename).getContent()`) — each page sets
  `var CMD_ = 'signup'|'checkin'` before the include so the shared `callApi()` posts to the
  right `?cmd=` endpoint. `showApiError_` was deliberately left page-specific (not extracted):
  a line-by-line diff of the two originals found it isn't actually identical — `CheckinApp`'s
  error banner includes a Site-Q mailto contact link that `SignupApp`'s doesn't — and collapsing
  it would have been a user-visible behavior change on one page or the other.

- **Check-in PaxDB fallback into sign-up (F3Go30-xj1q.1) — DECIDED:** A PAX known to the
  historical `PaxDB` roster (signed up in a prior month) but absent from the CURRENT month's
  Tracker no longer hits a dead end on check-in. `handleCheckinIdentify_`
  (`dashboardWebapp.js`), on a `resolveCheckinIdentity_` miss, now also calls
  `findPaxDbMatch_` (`signupWebapp.js`, reused unchanged) requiring an EXACT match on both F3
  Name and Email — the same anti-enumeration boundary the sign-up app's own `identify` already
  exposes, so this doesn't open a new probing surface. A hit returns
  `{ matched:false, knownPaxNotRegistered:true, f3Name, email }` — deliberately omitting
  team/goals, since sign-up re-fetches its own prefill via the shared localStorage handoff. This
  fallback is wired into the **miss branch only** (`resolveCheckinIdentity_` returning
  unmatched), never the **tokenInvalid branch** (a saved link that fails to verify — tampered,
  stale, or the PAX's roster entry changed): that branch's `f3Name`/`email` are decoded from an
  unverified client-supplied token payload, and a PaxDB lookup there would let a broken/guessed
  token probe PaxDB for names+emails without ever needing a valid signup. `CheckinApp.html`
  auto-redirects a `knownPaxNotRegistered` response into sign-up via the existing
  `attemptTopRedirect_`/localStorage handoff, landing on
  `?cmd=signup&targetMonth=current&autoStart=1` (mirroring the dashboard's existing "Sign up for
  next month" nudge, `openSignup_('current')`) — with a manual "Sign up" button as the
  redirect-blocked fallback. Sign-up itself needed zero changes: its existing
  `autoStart`+localStorage prefill path (`SignupApp.html`) already covers this hand-off.

- **Advanced whole-month check-in calendar (F3Go30-th22) — DECIDED:** The check-in page's
  `#advancedToggleBtn` reveals a full-month calendar (`#advancedGrid`, `CheckinApp.html`) as an
  alternative to the TODAY/YESTERDAY blocks — mutually exclusive views, never both shown at once.
  Four settable states now exist per day, not three: Hit (1), Miss (0), No-Check-in (blank), and
  Failed (−1) — `-1` was previously Q-only (`markMinusOne`'s automatic grace-period mark) and is
  now also a legitimate PAX-set honor-system value (e.g. reverting a system-applied −1 after a
  technical issue, or pre-marking a day they already know they'll miss). Only "Failed" is
  date-gated: a day can only be marked Failed once it's strictly in the past
  (`isStrictlyPastCalendarDate_`, `dashboardWebapp.js`) — nobody can honestly know today whether
  they failed tomorrow's workout. Hit/Miss/No-Check-in remain settable for any day, past or
  future, with no date restriction (the whole point of letting a PAX pre-mark a planned absence).
  **Write contract:** `handleCheckinSubmit_`'s `payload.day` now also accepts an explicit
  `"YYYY-MM-DD"` string alongside the existing `'today'`/`'yesterday'` literals (validated by the
  new pure `validateCheckinSubmitDayValue_`, unit-tested independently of any spreadsheet
  fixture); `payload.value` now also accepts `-1`, gated server-side (defense-in-depth, mirroring
  the client's `#selFailBtn` disable rule) by `isStrictlyPastCalendarDate_` — a replayed/
  manipulated request can't pre-mark a future or today's-own day Failed even though the client UI
  never offers that combination. No new error codes: the existing five (`invalid_day`,
  `invalid_value`, `not_found`, `day_column_not_found`, `cell_is_formula`) cover the widened
  contract unchanged. **Month source:** `handleCheckinIdentify_` now also returns `monthGrid`
  (`buildMonthGridEntries_`) — one `{dateIso, status}` entry per day column of the PAX's current
  identify month, built from data already in scope (no extra spreadsheet read) — which the client
  renders as the calendar and uses to seed the single unified selection panel (`#checkinSelectedDate`
  + 4 buttons) without any further round trip. Calendar cells reuse the existing `SEGMENT_COLORS_`
  palette verbatim (the same one already driving the month-progress ring/day-mini-bar) so the new
  view reads as the same status language, not an invented one. Full design record: bd issue
  F3Go30-th22.1.

- **Dashboard team grouping (F3Go30-ln1x) — DECIDED:** "My Team" and the PAX board group by
  whatever string currently lives in the Tracker's column B (Goal/Team), not a separately
  maintained team roster — there is no fixed team list in the data model. A group is exactly the
  set of PAX sharing that value at read time; renaming a PAX's team moves them to a new group on
  the next dashboard load with no migration step.

- **scanTrackers source qualification (F3Go30-xj1q.2) — DECIDED:** `scanTrackers()`
  (`go30tools.js`) walks the active spreadsheet's sibling Drive folder (same boundary for the
  Template, SIT, or any CopyTemplate-copied environment) and now runs every file found through
  `_qualifySourceFiles_` before scanning: a name containing `(Smoke)`/`(Expired)` is excluded by
  default — mirroring the filter `CopyTemplate.js`'s `selectRecentRealTrackerRows_` already
  applies to `TrackerDB` rows, but applied to the raw folder walk instead. Headless callers
  (the `runScanTrackers` admin action, any future time trigger) get silent exclusion plus one
  `GasLogger.log('scanTrackers.smokeArtifactsExcluded', ...)` warning enumerating what was
  skipped — never a prompt. `scanTrackers(opts)` also accepts `opts.interactive === true` for a
  future UI-context caller (e.g. an `onOpen` menu item): when smoke/expired artifacts are found
  it prompts per-artifact via `ui.alert(YES_NO_CANCEL)` — YES = include, NO = exclude (default),
  CANCEL = remove (calls `cleanupTrackerArtifact_`, the same removal logic
  `WebApp.js`'s `cleanupTracker` admin action uses, extracted into `go30tools.js` so the two
  entry points can't drift). No `onOpen` menu item calls `scanTrackers(...)` yet — that wiring
  is left to F3Go30-xj1q.3's planned collapse of `CopyTemplate`'s bespoke rebuild onto
  `scanTrackers` as the single populate path.

- **CopyTemplate safe-Config defaults + rename (F3Go30-xj1q.3) — DECIDED:**
  `copyTemplateToNewEnvironment_` (`CopyTemplate.js`) stands up a realistic-prod-data test/SIT
  environment by copying the Template (+ bound script) and recent trackers verbatim; the ONLY
  meaningful PROD→test delta it must apply is the Config sheet, so the copy can never be
  mistaken for PROD or silently send live email. `folderName` (operator-supplied) is unified as
  the single identifier for the new environment: it names the Drive folder, the copied
  Template's spreadsheet name suffix, the new Config `NameSpace` value, and the marker appended
  to every copied tracker's name. Right after the Template copy is made (before the tracker
  copy loop), `applySafeConfigDefaults_`/`computeSafeConfigDefaults_` force the copied Config's
  `Email Test Mode` to `Yes` (fail-safe, regardless of what PROD's Config carried) and its
  `NameSpace` to `folderName` — via `upsertConfigSheetRow_` (`Utilities.js`, now exported for
  Node/testing), same primary/secondary Config-row convention used everywhere else. Copied
  historical tracker spreadsheets are renamed via `buildRenamedTrackerName_`, which **appends**
  `" (<folderName>)"` to the source name rather than substituting the NameSpace segment of
  `"YYYY-MM-<oldNs>"` — appending was chosen as the safer default (bead's own design notes):
  it can't collide with or corrupt an unexpected source naming convention and keeps the
  original name fully intact for traceability back to PROD. The module header on
  `CopyTemplate.js` states this vision explicitly so a future maintainer does not "clean up"
  the copy's Config back toward PROD's values and silently re-arm live email. Out of scope for
  this bead (deferred, see the `scanTrackers` entry above): collapsing `CopyTemplate`'s bespoke
  TrackerDB/PaxDB rebuild (`buildCopiedTrackerDbRow_`/`ct_updateTrackerDB`/`ct_updatePaxDB`)
  onto qualified `scanTrackers` as the single populate path.

- **Check-in → dashboard round-trip reduction (F3Go30-qi26, ADR-015) — DECIDED:** Reduces the
  serialized Apps Script round trips and redundant identity/month re-resolution the returning-PAX
  check-in flow was paying for (baseline ~7.4s dashboard `totalMs`, measured via the harness
  below). Builds on ADR-013's rejected onEdit/queue directions by working entirely within each
  request's own live, synchronous execution — no new trigger or background-worker infrastructure.
  Four independent changes, each guarded to fall back to full resolution transparently:
  - **Resolved-context handle (qi26.1):** `handleCheckinIdentify_` (`dashboardWebapp.js`) returns
    a lean `resolvedContext` handle (`buildResolvedContextHandle_`) alongside its normal payload —
    the target tracker's `sheetId`, the PAX's Tracker `rowIndex` + canonical F3 name, and the
    `monthKey`/`label`/`startDate` needed to reconstruct a `monthInfo` without a `TrackerDB` scan.
    `CheckinApp.html` echoes it back on the follow-up `checkin`/`dashboard` POSTs. Every consumer
    treats it as a hint only: `resolveLeanIdentityFromHandle_` (submit path) and
    `resolveFullIdentityFromHandle_` (dashboard path) re-validate that the row at `rowIndex` still
    carries the handle's canonical name before trusting it, and return `null` — triggering
    transparent fallback to `resolveCheckinIdentity_`/`resolveCheckinIdentityFull_` — on a roster
    edit, month rollover, or stale/absent handle. This removes one `resolveMonths` `TrackerDB`
    scan and one Responses-sheet identity re-lookup per checkin/dashboard call.
  - **Dashboard prefetch (qi26.2):** `CheckinApp.html` fires `prefetchDashboard_()` (a `silent`
    `loadDashboard_` call using the just-returned handle) immediately after identify resolves,
    while the PAX is still reading the check-in step. The `dashboardBtn` click handler renders
    from `state.monthCache` (or rides the in-flight prefetch promise) instead of blocking on a
    fresh round trip, so "Continue to Dashboard" is effectively instant on the common path.
  - **doGet title deferral (qi26.3):** the check-in page's first-paint `doGet` no longer opens the
    `CheckinSessions` sheet to resolve a bookmarked link's personalized `<title>`.
    `createOrTouchCheckinSession_` write-through-caches the guid→F3 Name pair
    (`cacheCheckinSessionTitle_`, `CacheService`, 6h TTL); `buildCheckinPageOutput_` reads it via
    the cache-only `getCachedCheckinSessionTitle_`. A cache miss (expiry, or a pre-rollout
    session) falls back to the generic namespace title rather than opening the sheet.
  - **Dashboard freshCheck deferral (qi26.4):** `resolveFullIdentityFromHandle_` and
    `resolveCheckinIdentityFull_` (`dashboardWebapp.js`) no longer pay `ensurePaxCacheFresh_`'s
    ~½s `DriveApp.getLastUpdated()` probe unconditionally. The probe only runs when a roster
    cache entry already exists to validate; when a read goes live (cold cache) instead, the row
    values just read are definitionally current, so `markPaxCacheFreshNow_` (`PaxCache.js`) stamps
    the freshness marker from the read moment with no Drive round trip. The whole-roster Tracker
    read itself stays on the critical path unconditionally and is documented in-code as such — the
    team board needs every PAX row; only the freshness *probe* is now conditional, not the read.
  - **Measurement (qi26.5):** `tools/measureCheckinPerformance.js`, a repeatable
    Playwright-driven harness, captures per-round-trip network timing (TTFB, total, by host) for
    the full page-load → identify → checkin → dashboard flow, plus the Axiom correlation window
    for cross-referencing server-side `GasLogger` timings via `tools/query_axiom.py` — see
    docs/OPERATIONS.md §Performance Testing.

  Trade-off: the resolved-context handle is duplicated client-side state that must be kept in
  sync with server-side row identity, and every fast path carries a second, parallel
  implementation (`resolveLeanIdentityFromHandle_`/`resolveFullIdentityFromHandle_`) alongside the
  original full-resolution function rather than a shared code path — deliberate, since each
  fast/slow pair has different inputs available and different Axiom timing needs (see
  `resolveFullIdentityFromHandle_`'s header comment). See ADR-015 for the full rationale.

---

## Data Model

| Sheet | Purpose | Key Columns |
|-------|---------|-------------|
| Tracker | One row per PAX; daily check-in grid | A: F3 Name, B: Team/Goal (VLOOKUP), G: Raw Score, H: Score, columns I+ (row 3 header): a `Date` value = day column (PAX-entered 1/0, or −1 after nightly marking), the literal string `'Bonus'` = weekly bonus column (row 2 holds its period number, formula-computed); data rows 4+. `dashboardWebapp.js`'s `classifyTrackerColumns_` reads row 2/row 3 to tell day columns from bonus columns rather than hardcoding column letters |
| Responses | Raw Google Form submission data | Col 4 (index 3): F3 Name, Col 6: Team |
| Config | Runtime configuration read by the script | A: variable name, B: primary value, C: secondary value |
| Help | Operational links and config values | A: Label, B: URL |
| Bonus Tracker | PAX bonus-point activity log | PAX-entered; not script-managed |
| Activity | Hidden audit log of script actions | A: Datetime, B: User email, C: Message, D: Sheet name |
| TrackerDB | Template-resident registry of every monthly tracker (formerly a separate `Links` sheet — consolidated, SheetId-keyed); aggregates cross-tracker metrics and (ADR-010) resolves which spreadsheet a centrally-dispatched function should target for a given context date | Date Modified, StartDate, SpreadsheetName, ShortTracker, TrackerURL, ShortHC, HC URL, SheetId, FormId, TotalPAX, TotalTeams, AverageScore, LastSignupAt, TriggersInitializedAt, LastMinusOneRunAt, LastNagRunAt |
| PaxDB | Template-resident aggregate of individual PAX records across all trackers | Sheet ID, date, F3 Name, team, goal data, hit/miss/no-checkin stats |

## References

- [Sheet reference](docs/sheet-reference.md) — per-sheet layout, formulas, and operational notes referenced by runtime modules
- ADR-004 (form ownership decision)
- README.md (in-repo single-file canonical documentation)
- docs/framework/doc-standard.md (documentation standards and templates)
