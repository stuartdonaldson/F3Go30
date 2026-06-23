# F3Go30 Deployment Model

> Status: **Proposed** — describes the target state and the plan to get there.
> Current state is documented in `docs/OPERATIONS.md §Deployment`.

---

## Context

F3Go30 is a Google Apps Script project bound to a Google Sheets spreadsheet (the **Template**). Every month a new tracker spreadsheet is created by running `copyAndInit()` in the template — this copies the spreadsheet (including its bound script) and initialises the copy for the new month. The owner then opens the copy and runs **Initialize Triggers** from the custom menu to set up form-submit and time-based triggers under the f3go30@gmail.com account.

This creates three distinct deployment targets:

| Target | Description | When pushed |
|--------|-------------|------------|
| **template** | The Go30 Template spreadsheet. New month trackers are copied from here. | Active development and releases |
| **month** | The current live month's tracker spreadsheet. | Patch delivery to a running month |
| **test** | A dev/test copy used for end-to-end testing without touching live data. | Developer testing |

Each target has its own Google Apps Script **project** (a different `scriptId`), even though they all run the same code. Pushing to one target does not affect the others.

---

## Target State: npm-Driven Deployment

The pattern is borrowed from the canonical reference in `GAS-Practices/best-practices/gas-cm-and-deployment/`. The key files are:

```
tools/manage-deployments.js  # single deployment entry point
local.settings.json          # per-machine IDs — NOT committed to git
.clasp.json                  # written dynamically by manage-deployments.js before each push
package.json                 # npm scripts: push / deploy:month / deploy:test / release:*
script/version.js            # stamped on every push with version, date, target
```

### `local.settings.json` schema

```json
{
  "templateScriptId":      "...",
  "templateSpreadsheetId": "...",
  "monthScriptId":         "...",
  "monthSpreadsheetId":    "...",
  "testScriptId":          "...",
  "testSpreadsheetId":     "..."
}
```

**Maintenance:** These IDs must be updated manually when:
- A new month tracker is created (`copyAndInit`) → update `monthScriptId` / `monthSpreadsheetId` to the new spreadsheet's values.
- The template spreadsheet is re-created or migrated → update `templateScriptId` / `templateSpreadsheetId`.
- A new test spreadsheet is provisioned → update `testScriptId` / `testSpreadsheetId`.

Find a spreadsheet's script ID: Apps Script editor → Project Settings → IDs.
Find a spreadsheet's spreadsheet ID from its URL: `/spreadsheets/d/<ID>/`.

### `package.json` scripts (target state)

```json
{
  "scripts": {
    "push":           "node manage-deployments.js --deploy-template",
    "deploy:month":   "node manage-deployments.js --deploy-month",
    "deploy:test":    "node manage-deployments.js --deploy-test",
    "release:patch":  "npm version patch && npm run push && git push --follow-tags",
    "release:minor":  "npm version minor && npm run push && git push --follow-tags",
    "release:major":  "npm version major && npm run push && git push --follow-tags",
    "test":           "node test/test_sheet_helpers.js && node test/test_signup_reuse.js && ..."
  }
}
```

### How `tools/manage-deployments.js` works

1. Reads `local.settings.json` to get the target's `scriptId`.
2. Writes `.clasp.json` at the project root with `{ "scriptId": "<target>", "rootDir": "script" }`.
3. Stamps `script/version.js` with the npm package version, ISO timestamp, and deploy target label.
4. Runs `clasp push -f`.
5. Restores `.clasp.json` (or leaves the last-used target in place).

For current F3Go30 use (installable triggers, no Web App), `clasp push` is the primary deployment action. When Web App targets are added, `clasp deploy --deploymentId` is also required after each push — see *[@HEAD vs Named Deployments](#head-vs-named-deployments)* below.

### `script/version.js` stamped fields (target state)

```js
const APP_VERSION        = '2.2.1';          // from package.json
const APP_VERSION_DATE   = '2026-05-31T14:22:00Z';  // ISO timestamp of push
const APP_DEPLOY_TARGET  = 'TEMPLATE';        // TEMPLATE | MONTH | TEST
const APP_AUTHOR         = 'Stuart Donaldson (F3 Little John)';
const APP_CONTACT        = 'stu@asyn.com';
```

When a new month tracker is created by `copyAndInit`, `version.js` in the copied spreadsheet reflects the template's version at copy time — no push required. Subsequent patches to that month tracker are delivered via `npm run deploy:month`.

---

## @HEAD vs Named Deployments

### What `clasp push` does

`clasp push` uploads code to the GAS project's **`@HEAD`** version. This makes the latest code available in two places:
- As the **bound script** when spreadsheet triggers fire.
- Under **Test deployments** in the script editor (*Deploy → Manage deployments*).

`@HEAD` is not a stable, addressable URL. It is the project's working copy.

### Named deployments and `clasp deploy`

Named deployments are discrete, numbered versions of the code created via *Deploy → New deployment* in the script editor (or `clasp deploy`). Each gets a **deployment ID** that was previously created by the user via the script editor. For Web Apps, the stable URL is:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

To update an **existing** named deployment without changing its URL:

```
clasp deploy --deploymentId <id> --description "v2.3.0 TEMPLATE"
```

> **Important:** omitting `--deploymentId` creates a *new* deployment with a new ID and a new URL, breaking any clients that hold the old URL.

**For F3Go30 currently:** installable triggers execute `@HEAD`, so `clasp push` alone is sufficient. Named deployments are only required when adding Web App endpoints.

**When Web App features arrive:** `local.settings.json` will need deployment ID fields (e.g. `templateDeploymentId`, `testDeploymentId`), and `manage-deployments.js` will call `clasp deploy --deploymentId` after each push for those targets.

### Testing via the WebApp deployment URL

Once a named deployment exists (created once in the script editor), its `/exec` URL is immediately usable for direct HTTP testing of `doGet()` and `doPost()` handlers:

```
GET  https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=ping
POST https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
     Content-Type: application/json
     {"action": "getVersion"}
```

This gives direct access to the running GAS environment — the actual bound script state, PropertiesService values, and sheet data — without any browser interaction. It is simpler than `clasp run` for WebApp testing because it requires no GCP project, no OAuth consent screen, and no API executable deployment. Any HTTP client (curl, Python requests, Playwright) can drive it.

**Practical consequence for F3Go30:** when WebApp features are added, HTTP-based tests against the `/exec` URL will be the primary integration test mechanism. `clasp run` (Phase 1b) is complementary — it can invoke non-HTTP functions — but the `/exec` approach covers the majority of WebApp test scenarios with far less setup overhead.

> **Note:** This pattern should be captured in `GAS-Practices/best-practices/` as a standalone entry once proven in F3Go30. It is not currently documented there.

### GCP project and WebApp authorisation

Web App deployments that require access to Google APIs beyond the spreadsheet itself must be linked to a Google Cloud Platform (GCP) project. The GCP project controls the OAuth consent screen and authorised redirect URIs. When a WebApp is added, `local.settings.json` will expand to include a `gcpProjectId` field, and the GCP project number must be recorded in the script project settings.

---

## Deployment Sequence

The authoritative sequence for any push. Following this order ensures `version.js` in the live GAS environment always reflects the provenance of the running code — version, deploy target, and timestamp — verifiable by inspection without looking at git.

```
1. Bump version
   npm version patch | minor | major     # updates package.json and creates git tag
   — or — manual edit of package.json for non-standard bumps

2. Stamp version.js  (automated by manage-deployments.js)
   APP_VERSION        ← package.json version
   APP_VERSION_DATE   ← ISO timestamp of push
   APP_DEPLOY_TARGET  ← TEMPLATE | MONTH | TEST

3. Push code to @HEAD
   clasp push -f                          # via manage-deployments.js

4. Update named deployment  [Web App targets only — not yet in use]
   clasp deploy --deploymentId <id> --description "v<VERSION> <TARGET>"

5. Git commit with version and deployment type
   git add script/version.js
   git commit -m "v<VERSION> <TARGET>"   # e.g. "v2.3.0 TEMPLATE"
   git push --follow-tags
```

**Why this order matters:**
- Stamping before pushing keeps `version.js` in GAS consistent with the git commit.
- Including the deploy target in the commit message means any `version.js` in a live GAS environment can be cross-referenced directly to a git commit, confirming exactly what code is running and where it was intended to run.

The `npm run release:patch/minor/major` scripts will automate steps 1–3 and 5 for the template target. `npm run deploy:month` and `npm run deploy:test` automate steps 2–3 for those targets; step 5 is a manual commit for mid-month patches.

---

## Month Tracker Lifecycle

```
Template (v2.x)
     │
     │  copyAndInit() — runs in template
     ▼
Month Tracker copy created
     │  version.js = template's version at copy time
     │  bound script = copy of template's script project
     │
     │  Owner opens month tracker
     │  Menu → Initialize Triggers (manual — Google security requirement)
     │  Triggers installed under f3go30@gmail.com
     │
     │  ... live month in progress ...
     │
     │  Patch needed mid-month?
     │    update monthScriptId / monthSpreadsheetId in local.settings.json
     │    npm run deploy:month
     │    Menu → Initialize Triggers again (if triggers change)
     ▼
End of month — new copyAndInit for next month
```

**Why triggers require a manual step:** Google Apps Script installable triggers must be created by the account that will run them. Because form-submit and time-based triggers need to run as f3go30@gmail.com (the account that owns the spreadsheet), the owner must open the spreadsheet with that account and call `initializeTriggers()` from the menu. This cannot be automated by a push.

---

## Current State vs. Target State

| Aspect | Current | Target |
|--------|---------|--------|
| Push command | `cd script && clasp push` (manual) | `npm run push` |
| Target selection | Manual — edit `.clasp.json` or `cd` to right dir | `tools/manage-deployments.js` with flag |
| Version stamping | Manual edit of `script/version.js` | Automated by `manage-deployments.js` |
| Deploy target in version | Not tracked | `APP_DEPLOY_TARGET` field |
| Month tracker IDs | `local.settings.json` has stub | Full schema as described above |
| `.clasp.json` location | None at root; push from `script/` | Root-level, written dynamically |
| Release workflow | Manual tag + commit | `npm run release:patch/minor/major` |

---

## Migration Plan

### Phase 1 — Infrastructure (non-breaking, ~1 session)

1. **Create `tools/manage-deployments.js`**.  
   Adapt from the canonical reference at `GAS-Practices/best-practices/gas-cm-and-deployment/manage-deployments.js`. Remove Web App / test token logic (not needed for F3Go30 today). Implement three targets: `template`, `month`, `test`. Each target writes `.clasp.json` at the project root with the target's `scriptId` and `rootDir: "script"`, runs `clasp push -f`, then stamps `version.js`. Update `package.json` scripts to invoke `node tools/manage-deployments.js`.

2. **Add `@inquirer/prompts`** to `package.json` dependencies (same as GActionSheet).

3. **Update `local.settings.json`** to full schema.  
   Rename `SCRIPT_ID_PROD` → `templateScriptId`, add `templateSpreadsheetId`, `monthScriptId`, `monthSpreadsheetId`, `testScriptId`, `testSpreadsheetId`. Populate with current IDs.

4. **Move `.clasp.json` from `script/` to project root; update `rootDir`.**  
   The current `script/.clasp.json` has `"rootDir": "."` (relative to `script/`). Move it to the project root and change `rootDir` to `"script"`. `manage-deployments.js` will overwrite this file before each push with the correct `scriptId` for the target.  
   Add `.clasp.json` to `.gitignore` — it is machine-local; the authoritative ID lives in `local.settings.json`.

5. **Update `package.json` scripts** to the target-state pattern above.

### Phase 1b — Apps Script API setup (one-time, before Phase 2)

`clasp run` can invoke GAS functions from Node.js scripts, enabling scripted post-push verification without opening a browser. This is a one-time setup against the GCP project. No Google review is required — the Verification Center confirms: *"Verification is not required since your app is configured with a Testing publishing status."*

#### Step A — Create and configure the GCP project *(scriptable)*

```bash
# Create project (choose a project ID, e.g. go30-tracker)
gcloud projects create go30-tracker --name="F3Go30 Tracker"

# Set as active project
gcloud config set project go30-tracker

# Enable the Apps Script API
gcloud services enable script.googleapis.com
```

#### Step B — Configure the OAuth consent screen *(personal Gmail: console only)*

> **Note:** The `gcloud alpha iap oauth-brands` API that automates consent screen creation is **Google Workspace only**. For personal Gmail accounts (f3go30@gmail.com), this must be done once in the [Cloud Console → APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).

Fields to fill in:

| Field | Value |
|-------|-------|
| User Type | External |
| App name | F3Go30 Tracker |
| User support email | f3go30@gmail.com |
| Developer contact email | f3go30@gmail.com (or developer address) |
| App logo | leave blank (not needed for a developer tool) |
| App domain fields | leave blank |
| Authorized domains | leave blank |
| Publishing status | **Testing** ← leave as Testing; no submission required |

Save. Do **not** click "Publish App" — Testing status is permanent and sufficient for single-developer use.

#### Step C — Add test user *(console only)*

On the **Audience** tab → Test users → Add the developer Gmail account. The 100-user cap applies only to accounts added here; you are authorizing yourself to run the tool, not end users.

#### Step D — Link the GCP project to the Apps Script project *(script editor)*

In the Apps Script editor: *Project Settings → Google Cloud Platform (GCP) Project → Change project* → enter the GCP project number (found in the Cloud Console dashboard).

#### Step E — Create an API executable deployment *(script editor)*

In the Apps Script editor: *Deploy → New deployment → API executable*. This is separate from Web App deployments and does not affect the bound-script or `@HEAD` behavior. Record the deployment ID.

#### Step F — Verify `clasp run` works

```bash
clasp login   # ensure credentials are fresh
clasp run 'getVersion'   # or any lightweight GAS function
```

If this returns the function output, the setup is complete. Record the GCP project ID in `local.settings.json` as `gcpProjectId` for reference.

**Action:** Complete steps A–F and record the outcome in `bd remember` before Phase 2. If Step F fails, defer `clasp run` — manual verification from the script editor remains the fallback.

### Phase 2 — Version stamping (~0.5 session)

6. **Update `script/version.js`** to add `APP_DEPLOY_TARGET` field.

7. **Wire stamping into `manage-deployments.js`**: read `package.json` version, write `APP_VERSION`, `APP_VERSION_DATE` (ISO), `APP_DEPLOY_TARGET` before every push.

8. **Verify**: `npm run push` → check `script/version.js` shows correct stamp → push succeeds.

### Phase 3 — Release workflow (~0.5 session)

9. **Smoke-test `release:patch`**: `npm version patch` bumps `package.json`, `npm run push` stamps and deploys to template, `git push --follow-tags` pushes commit + tag.

10. **Document month-tracker patch workflow** in `docs/OPERATIONS.md`:  
    > "Update `monthScriptId` and `monthSpreadsheetId` in `local.settings.json`, then `npm run deploy:month`."

### Acceptance criteria

- [ ] `npm run push` stamps `version.js` with current version, ISO date, and `TEMPLATE`, then pushes to template scriptId — no manual `.clasp.json` editing required.
- [ ] `npm run deploy:month` pushes to month tracker scriptId with `MONTH` stamp.
- [ ] `npm run deploy:test` pushes to test scriptId with `TEST` stamp.
- [ ] `npm run release:patch` bumps version, pushes to template, creates git tag, pushes to remote.
- [ ] `local.settings.json` is in `.gitignore`.
- [ ] `script/version.js` shows correct `APP_DEPLOY_TARGET` for each target after push.
- [ ] After a `copyAndInit`, the new month tracker's `version.js` reflects the template version at copy time (no extra steps).

---

## Maintenance Reference

### When to update `local.settings.json`

| Event | Field(s) to update |
|-------|--------------------|
| New month tracker created (`copyAndInit`) | `monthScriptId`, `monthSpreadsheetId` |
| Template spreadsheet migrated or re-created | `templateScriptId`, `templateSpreadsheetId` |
| New test spreadsheet provisioned | `testScriptId`, `testSpreadsheetId` |

### How to find IDs

- **Script ID**: Open the spreadsheet → Extensions → Apps Script → Project Settings → IDs → Script ID.
- **Spreadsheet ID**: From the spreadsheet URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### Never commit `local.settings.json`

It contains script and spreadsheet IDs that are environment-specific and potentially sensitive. Verify `.gitignore` includes `local.settings.json` before the first push.
