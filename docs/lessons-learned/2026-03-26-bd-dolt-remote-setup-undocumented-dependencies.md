# LL: bd dolt remote setup has undocumented git-remote dependency and URL-change side effects

Date: 2026-03-26
Domain: process | tooling | bd

## Observation

Setting the bd dolt remote required 7+ commands and multiple unplanned recovery steps:

1. `bd dolt remote list` returned "No remotes configured" despite a CLI remote already
   existing — the SQL and CLI remote stores were out of sync.
2. Agent asked the user for the target URL rather than deriving it from `git remote -v`,
   which was available.
3. `bd dolt remote add origin <url>` produced a split result: SQL layer added successfully,
   CLI layer rejected with "already exists" — two separate stores, no single authoritative
   state visible to the operator.
4. Switching git remote from SSH to HTTPS (required to enable push) caused a bd repo
   fingerprint mismatch — an unplanned side effect requiring `bd migrate --update-repo-id`.
5. The migrate command required `--yes` flag for non-interactive confirmation; not obvious
   from the doctor remediation message.

## Why Chain

Why 1 — Agent asked user for the dolt remote URL rather than reading `git remote -v`
Why 2 — No procedure maps "set dolt remote" to "derive URL from git remote -v"
Why 3 — The relationship between git remote URL and dolt remote URL is undocumented — they
         appear independent but are coupled (fingerprint is derived from git remote)
Why 4 — Side effects of changing git remote URL (fingerprint mismatch, `bd migrate` required)
         are not documented in any bd workflow, skill, or framework reference
Root cause: No documented procedure for dolt remote setup/update that covers the
git-remote URL dependency and the cascading fingerprint side effect of URL changes.

## Initial Candidates

- c: Create or update a bd-setup/maintenance skill covering: (1) derive dolt remote URL
     from `git remote -v`, (2) expected split-result behavior when SQL and CLI stores differ,
     (3) fingerprint side effect when git remote URL changes + `bd migrate --update-repo-id --yes`
- e: bd memory — "dolt remote URL must match git remote URL; changing git remote requires
     bd migrate --update-repo-id --yes"
- a: Add note to DevStandard framework README or doc-standard that bd remote setup is a
     post-init step with a known sequence — not a zero-step operation
