# ADR-009: Use Web App Dispatcher Instead of clasp run for Scripted Function Invocation

Status: Accepted
Date: 2026-06-02

## Context

Post-push verification and test tooling require the ability to invoke GAS functions from the local development environment (Node.js scripts, Python tests, Playwright). The canonical path is `clasp run`, which calls GAS functions by name via the Apps Script API and returns their result.

`clasp run` requires:
1. A GCP project with the Apps Script API enabled
2. An OAuth consent screen configured in Cloud Console (partially manual — UI-only steps)
3. The GCP project linked to the Apps Script project
4. An API executable deployment

Steps 2–3 require Cloud Console UI interaction and cannot be fully automated. This setup cost is disproportionate for the current project stage.

## Decision

Use a **Web App dispatcher** deployed in GAS instead of `clasp run`.

A `doPost(e)` handler in GAS accepts a JSON body containing `{ action, args, secret }`. It validates the secret against a value stored in Script Properties (not in code), dispatches to the named function, and returns `{ ok, result }` as JSON.

The dispatch URL and secret are stored in `local.settings.json` (gitignored, machine-local).

## Consequences

- No GCP project, OAuth consent screen, or Apps Script API setup required.
- Works from Node.js (`fetch`), Python (`requests`), Playwright, or any HTTP client.
- Secret is rotatable via Script Properties without a code push.
- The web app requires a named deployment (not `@HEAD`) for a stable URL; this is a one-time manual step per target.
- `executeAs: USER_DEPLOYING` — functions run as the deploying account, consistent with trigger behaviour.
- Error stack traces from GAS must be forwarded explicitly in the JSON response body; they are not surfaced automatically as with `clasp run`.
- The secret provides authentication but not transport encryption beyond HTTPS. Suitable for a private, owner-operated tool; not suitable if the URL were exposed publicly.

## Supersedes

Nothing. j1dc (GCP/OAuth setup for `clasp run`) is deferred as a low-priority enhancement for when OAuth consent screen management becomes routine.
