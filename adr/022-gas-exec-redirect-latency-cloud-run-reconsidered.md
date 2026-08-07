# ADR-022: GAS `/exec` Redirect Latency — Persistent-Connection/Streaming Rejected, Cloud Run/Function Alternative Reconsidered (Proposal)

Status: Proposed
Date: 2026-08-05

## Context

Every call from the static front end (`static-pages/src/index.html`) to the GAS backend — GET or
POST, any `cmd` — goes to a `script.google.com/.../exec` URL and gets an unconditional HTTP 302 to
a second, per-request `script.googleusercontent.com/macros/echo` URL that actually serves the
response. That second hop costs on the order of 1-3 seconds and is where the request either
succeeds or, per `test_client_transport_resilience.js` (F3Go30-313u), silently disappears in either
direction — a request that never reaches GAS, or a GAS-executed response that never reaches the
browser. This is Google's standard Apps Script web-app serving mechanism, not something in
F3Go30's own code, and it applies identically to every deployment (SIT and PROD) and every `cmd`.

Two questions came up in discussion:

1. Can the redirect cost be avoided by keeping a connection open across multiple logical commands,
   or by having the server stream/flush partial results incrementally instead of paying the
   redirect once per full response?
2. Given the redirect is inherent to Apps Script web apps, would moving the backend off Apps
   Script entirely (Cloud Run / Cloud Functions) be worth it, and what actually blocked that idea
   previously?

## Discussion

### Persistent connection / incremental streaming — not available on this platform

- **No persistent connection to reuse.** `doGet`/`doPost` in Apps Script are stateless, one-shot
  invocations. There is no WebSocket support, no HTTP/2 multiplexed stream, and no keep-alive
  semantics the app layer can hold open across calls — every logical command is a brand-new
  execution with its own cold 302, regardless of client-side transport tricks (e.g. reusing a
  `fetch` keep-alive agent does nothing, since the redirect is issued by Google's front end, not by
  our handler).
- **No incremental flush from `ContentService`/`HtmlService`.** A `doGet`/`doPost` handler builds
  and returns one complete response object; there is no chunked-transfer or flush API. Even if
  partial output could be flushed, the client still pays the same redirect round trip to fetch it,
  so nothing would be saved.
- **Conclusion: neither idea is implementable within Apps Script's execution model.** This isn't a
  gap in F3Go30's code to close — it's a platform constraint with no opt-out.

### Mitigations that stay inside the current (GAS) architecture

Since the redirect cost is roughly fixed per round trip, the only lever available is reducing the
*number* of round trips, or hiding their latency:

1. **Batch multiple logical operations into one request/response** — e.g. a combined `cmd` that
   returns signup + dashboard + streak data in one payload instead of N sequential `callApi` calls,
   paying the redirect tax once instead of N times. (Same principle already applied once: ADR-015,
   checkin/dashboard round-trip reduction.)
2. **Parallelize genuinely independent calls** (`Promise.all`) so redirect latency overlaps instead
   of stacking serially. Improves perceived latency, not total server load.
3. **Client-side caching** of data that doesn't need to be re-fetched every interaction.
4. **Harden the timeout/retry path** for the redirect hop's observed unreliability (F3Go30-313u) —
   this is the more urgent issue independent of latency: a dropped response with no timeout leaves
   `pendingRequestCount_` never decrementing and the UI stuck on "Syncing…". Every caller path
   should have the same timeout/recovery guard the static-page transport block already has.

None of these require leaving Apps Script.

### The Cloud Run / Cloud Function alternative

Moving the backend to Cloud Run or Cloud Functions would remove the GAS `/exec` redirect entirely
— a normal HTTPS endpoint answers directly, no second hop. This was considered previously and not
pursued; the stated reason at the time was "GCP requirements," which on review breaks down into two
separable concerns:

**1. Credential handling — not actually a blocker, corrected here.** A concern was raised that the
static page would need to hold/manage service-account OAuth credentials to reach Sheets data via a
Cloud Run backend. That's not how it would work, and it's no different in shape from the current
architecture:

| | Current (GAS) | Cloud Run/Function |
|---|---|---|
| Client-held credential | None — static page POSTs to `/exec` | None — static page POSTs to the Cloud Run URL |
| Identity that talks to the Sheet | GAS itself, running as `USER_DEPLOYING` (the owner), fixed at deploy time | The service's own attached service account |
| How that identity gets Sheet access | Owner deployed the script bound to/authorized against the Sheet | Share the target Sheet with the service account's email (or grant Sheets/Drive scope via IAM), same as sharing with any Google account |
| Runtime authentication mechanism | Built into Apps Script | **Application Default Credentials (ADC)** — Cloud Run injects a short-lived token for the attached SA via its metadata server automatically; no key file, no secret store, nothing to rotate manually |

No client-side secret exists in either model, and no secrets-manager requirement exists server-side
either. `ANYONE_ANONYMOUS` (F3Go30's current access setting) governs whether an anonymous *visitor*
can invoke the endpoint — it says nothing about how the *backend* authenticates to Google APIs, and
a Cloud Run service's IAM-bound identity is a direct analog to GAS's `USER_DEPLOYING` execution
identity, not a new class of problem.

**2. What the real cost actually is.** With the credential-storage concern removed, the remaining
GCP-specific overhead is:

- A GCP project with **billing enabled** — Cloud Run/Cloud Functions require a linked billing
  account (a card on file, even to stay inside the free tier), unlike Apps Script, which runs on
  Google's shared quota with zero project/billing setup.
- One-time **IAM binding** (grant the service's SA access to the target Sheet) and **Sheets API
  enablement** on that GCP project.
- **CORS handling** that Apps Script's `ANYONE_ANONYMOUS` web app gives for free — a Cloud Run
  endpoint would need its own CORS configuration for the static origin.
- Ongoing **operational surface**: a second deployment pipeline/target alongside the existing
  `manage-deployments.js` SIT/PROD split, a second place logs and errors live, a second thing to
  keep in sync with `TrackerDB` dispatch (ADR-010) if the same centralized-dispatch model is kept.

None of this is prohibitive at F3Go30's scale (20-40 users), but it is real, ongoing infrastructure
that Apps Script currently gives for free. This ADR does not resolve whether that tradeoff is worth
making — it corrects the record on *why* it wasn't made (the credential-storage reasoning doesn't
hold up), and separates that from the *actual* remaining cost (billing/project standup + IAM/CORS +
a second deploy target), which is a legitimate, still-open cost/benefit question.

## Decision

Not yet made — filed as a proposal for later review.

Recommended framing for that review:
- Persistent-connection and incremental-streaming workarounds are ruled out unconditionally —
  revisit only if Google changes Apps Script's execution model.
- Within-GAS mitigations (batching, parallelizing, caching, timeout hardening) are viable now and
  independent of the Cloud Run question — they can proceed regardless of what's decided below.
- The Cloud Run/Function migration is not blocked by credential-management complexity (corrected
  above). If it is revisited, weigh it against the *actual* cost — GCP billing/project setup, IAM +
  CORS configuration, and a second deployment target — not against the credential-storage concern
  that motivated the earlier rejection.

## Consequences

- No further investigation needed into persistent connections or server-side streaming for this
  redirect cost — both are closed by platform constraint, not by lack of effort.
- Batching/parallelizing/caching mitigations remain available as near-term, in-place improvements
  and do not require this ADR's open question to be resolved first.
- If a future session pursues Cloud Run/Cloud Functions, it should start from the corrected
  cost model here rather than re-deriving (and likely re-rejecting on the same mistaken
  credential-storage grounds) the same alternative.
- This ADR should move to Accepted (with a decision recorded) or Rejected (with the actual
  decision and rationale) once reviewed — it is left Proposed deliberately since no decision was
  made in this session.
