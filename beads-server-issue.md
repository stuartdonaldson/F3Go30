# bd/dolt Non-Durable Writes — Server-Mode Sync Issue

**Discovered:** 2026-07-07, session `0067b78b-d921-44de-bf04-68f204eaf2a1`
**Project:** F3Go30 (but the failure mode and fixes apply to any bd project)
**bd version:** 1.0.4
**Status:** Root cause identified via the dolt server log; F3Go30 **not resolved** — the server DB is not persisting commits and shows schema corruption. `export.auto` change uncommitted.

> **Revision (after reading `.beads/dolt-server.log`):** the original "two dolt sql-servers racing"
> theory was **wrong** — see §2.1. The decisive evidence is the server log (§2.2): the F3Go30 dolt
> server logs `error="nothing to commit"` **1208 times** and re-imports "into empty database" on
> every connection. Writes never get committed to dolt at all; `export.auto` is a band-aid, not the fix.

---

## 1. Symptom

Every `bd` command printed:

```
auto-importing 272168 bytes from /mnt/c/dev/F3Go30/.beads/issues.jsonl into empty database...
auto-imported 198 issues from /mnt/c/dev/F3Go30/.beads/issues.jsonl
```

and **bd writes silently reverted**: an issue closed with `✓ Closed` reappeared as `OPEN`
on the next command; status changes undid themselves. `bd stats` showed 210 issues while the
jsonl held 198 and the embedded on-disk DB held 169 — **three divergent datasets**. Significant
effort was wasted chasing writes that would not stick.

The failure looked *random* because issues created **after** the stale jsonl snapshot (e.g.
`csfe`, `awhw`, `g7bm`) persisted, while older issues present in the snapshot (`8djp`, `7mz`,
`kpe5`) reverted to their snapshot state.

---

## 2. Root Cause

F3Go30's `.beads/` carries an older, **non-default** configuration that combines three
individually-tolerable settings into a data-integrity trap:

| Setting | F3Go30 value | bd 1.0.4 default | Effect |
|---------|-------------|------------------|--------|
| `.beads/metadata.json` → `dolt_mode` | `server` | `embedded` | Live data lives in an external `dolt sql-server`, not the on-disk embedded DB |
| `.beads/config.yaml` → `export.auto` | `false` | `true` | DB writes are **never exported** back to `issues.jsonl` |
| `.beads/issues.jsonl` in git | **gitignored** (commit `f15d39d`) | tracked | jsonl is a stale local snapshot, not refreshed |

**The mechanism:** bd **auto-imports** `.beads/issues.jsonl` at the start of every command. With
`export.auto: false`, the reverse never happens — so the jsonl is frozen at its last manual/older
state (Jul 2, 198 issues). Every command re-imports that stale snapshot over the live DB, resetting
any issue that exists in the snapshot back to its snapshot state. **Import ON + export OFF = writes
revert.** That asymmetry is the defect.

### 2.1 The "duplicate server" theory was wrong

The original writeup blamed two racing `dolt sql-server` processes. The log + process inspection
disprove it:

- `.beads/dolt-server.pid` = **7198**, `.beads/dolt-server.port` = **34331** — bd for F3Go30 talks
  to **exactly one** server (PID 7198, started 10:29).
- The second process (PID 24123, port 38985, started 20:26) has cwd
  `/mnt/c/dev/RepositoryReport/.beads/dolt` — it serves a **different project** (RepositoryReport)
  and never touches F3Go30's data.

So there is no server race for F3Go30. (Per-project stray dolt servers are still untidy, but they
are not this bug.)

### 2.2 Decisive evidence — the server log

`.beads/dolt-server.log` (3.5 MB, 25 833 lines) shows the real failure. Error tally:

| Count | Error | Meaning |
|-------|-------|---------|
| **1208** | `nothing to commit` | Every bd write issues a dolt commit that finds **no staged changes** — the write never lands in a durable dolt commit |
| 13 / 11 | `backup 'backup_export' not found` / `already exists` | Backup-config churn |
| 11 | `! [rejected] main -> main (non-fast-forward) … failed to push` | `bd dolt push` to `git+https://…/F3Go30.git` is rejected — dolt remote is behind and never syncs |
| 8 | `Column "…"` | Schema mismatch |
| 2 | `table not found: config` / `branch not found: config` | The bd-maintenance §1 Tier-3 `dolt add config && dolt commit` remediation **cannot work here** — there is no `config` table/branch |
| 2 ea. | `foreign key fk_dep_depends_on was not found`, `Duplicate key name idx_issues_issue_type` / `idx_wisp_dep_type…` | **Schema is partially-migrated / corrupt** |

**What this means:** `auto-importing … into empty database` + `nothing to commit` together prove the
server's persistent working set is **empty on every connection** and writes are **never committed**.
bd re-hydrates from `.beads/issues.jsonl` at each command, applies the write in a session that is
never durably committed, and the next command starts from the same stale jsonl again. jsonl is the
de-facto source of truth — and it is stale (Jul 2), gitignored, and `export.auto: false`, so recent
closes evaporate.

**Consequence for the fix:** enabling `export.auto` only snapshots the transient in-memory state
before it is lost — it does **not** fix a DB that commits nothing. The durable fix is to **rebuild
the database from the authoritative JSONL** (`bd doctor --fix --source=jsonl`, documented as
"Rebuild database from JSONL (source of truth)") or to migrate cleanly to embedded **after** an
authoritative `bd export`. The schema-corruption and missing-`config`-table errors mean the current
server DB should be treated as **suspect and rebuilt**, not incrementally patched.

---

### 2.3 Underlying cause — dolt DB lives on the WSL2 `/mnt/c` driver

`.beads/` sits at `/mnt/c/dev/F3Go30/.beads` — a **Windows drive accessed through the WSL2
9p/drvfs driver**, not native Linux ext4. This is very likely *why* the dolt server cannot persist:

- Dolt's storage engine (noms) depends on **memory-mapped files, advisory file locks, and fsync
  durability**. The `/mnt/c` driver translates these to Windows semantics unreliably — writes may
  not be durably flushed, locks may not hold, mmap coherency is not guaranteed.
- The symptoms match this exactly: commits that report `nothing to commit`, a persisted DB that is
  **empty on every reconnect**, and schema corruption (duplicate indexes, missing FKs) — the classic
  signature of a mmap/lock-based database on a filesystem that doesn't honor those primitives.
- The log even contains `wsasend: An established connection was aborted by the software in your host
  machine` — confirming traffic is crossing the Windows boundary.

**Why the JSONL round-trip fix works here:** `.beads/issues.jsonl` is a plain **sequential file
write/read**, which `/mnt/c` handles reliably. bd's import→export cycle therefore round-trips
durably even though the dolt DB underneath does not. This makes "jsonl as source of truth +
`export.auto: true`" not just a workaround but the **right architecture for a `/mnt/c` checkout** —
and it means the corrupt dolt DB can be treated as a disposable cache.

**Durable options (in order of preference):**
1. **Keep jsonl as source of truth** (done): `export.auto: true`, dolt DB disposable/rebuildable.
   Zero-cost, already verified durable.
2. **Move the dolt DB off `/mnt/c`** onto native WSL2 ext4 (e.g. `~/…`) if server/embedded dolt
   features are wanted — native fs restores the durability primitives dolt needs.
3. **Run bd from Windows-native tooling** against the Windows path (avoids the WSL translation layer
   entirely). Not preferred given the WSL-based workflow here.

## 3. Why the `bd-maintenance` Skill Made It Worse

The skill's **§7 Auto-Import Diagnostic** says: symptom = `auto-importing … into empty database` →
cause = `dolt_mode: server` → fix = **set `dolt_mode: embedded`**.

**That fix is wrong when live data lives in a running dolt sql-server.** Switching F3Go30 to
`embedded` made bd read the **stale 169-issue on-disk copy**, hiding all recent issues (`csfe`,
`awhw`, `g7bm`). The change had to be reverted. In server mode, `bd doctor` actually passes clean
(70 passed, 0 errors) and all recent issues are correct — the source of truth is the **running
server**, and the embedded DB is a stale sibling.

The skill treats `dolt_mode: server` as *always* the misconfiguration. It is not: for a repo
deliberately on server mode with live data in the server, flipping to embedded is a **data-loss
hazard**, not a fix.

---

## 4. Authoritative bd 1.0.4 Behavior (from DevStandard/knowledge-base/beads)

- **Embedded Dolt is the default backend** since v1.0.0. New `bd init` projects need no server
  process. (`beads-changes.md`, `beads-help-admin.md:30`)
- **Auto-export is ON by default** — after every write, bd exports to `.beads/issues.jsonl`
  (throttled once/60s, with git-add). Disable only with `bd config set export.auto false`.
  (`beads-help-sync.md:497`)
- F3Go30's config (`server` + `export.auto: false` + gitignored jsonl) is the **inverse** of every
  current default — a legacy setup from before embedded became standard.

---

## 5. Recommendations

### 5A. F3Go30 — Immediate Remediation (this repo)

The server DB commits nothing and shows schema corruption, so **treat it as disposable and rebuild
from the authoritative data**, rather than patching in place.

1. **Establish the authoritative dataset first (read-only).** The running server (PID 7198) holds
   the freshest view (recent `csfe`/`awhw`/`g7bm`). Export it before touching anything:
   ```bash
   bd export -o .beads/issues.export-$(date +%Y%m%d).jsonl   # snapshot current live state
   wc -l .beads/issues.jsonl .beads/issues.export-*.jsonl     # compare against the stale Jul-2 file
   ```
   Reconcile so one jsonl reflects the true current state (recent issues present, intended closes
   applied). This file becomes the rebuild source.
2. **Rebuild the DB from that JSONL.** This is the fix for "nothing to commit" + empty-DB re-import
   and for the schema-corruption errors:
   ```bash
   bd doctor --fix --source=jsonl     # rebuild database from JSONL (source of truth)
   bd doctor                          # expect schema/FK/index warnings to clear
   ```
   If corruption persists, the heavier option is a clean re-init from the reconciled jsonl
   (`bd init --reinit-local` then import) — see bd-maintenance §5 for the safety-flag surface.
3. **Turn on durable round-tripping.** Keep `export.auto: true` (already changed locally) and
   **commit `.beads/config.yaml`**. Decide jsonl's git status deliberately: either un-gitignore it
   so writes round-trip and are diffable, or keep it backup-only and rely on the DB — but not the
   current half-state (import-on / export-off / gitignored) that caused the reverts.
4. **Fix or abandon the dolt remote.** `bd dolt push` currently fails `non-fast-forward` every time,
   so the remote never receives updates. Either `bd dolt pull`/reconcile then push, or drop the
   remote if git-tracked jsonl is the intended sync path.
5. **Consider migrating to embedded** (bd 1.0.4 default) once data is reconciled — it removes the
   long-lived server process entirely. Do this only *after* step 1, never by flipping `dolt_mode`
   on a stale DB (that is the §7 trap).
6. **Prove durability before trusting any write:** close one issue, then in a *separate* command
   run `bd show <id>` and confirm it stayed closed, and confirm the log no longer emits
   `nothing to commit` (`tail .beads/dolt-server.log`). Do this before resuming issue work.
7. **Tidy stray servers (optional, not this bug):** RepositoryReport's server (PID 24123) is
   harmless to F3Go30 but leaving many long-lived per-project dolt servers around is untidy.

### 5B. Cross-Project Prevention (all bd repos)

- **Audit every bd project's `.beads/metadata.json` + `.beads/config.yaml`** for the trap
  combination. Flag any repo with `export.auto: false` — under current bd it is almost always
  unintended and, paired with a stale jsonl, produces silent reverts.
  ```bash
  for d in <repo list>; do
    echo "== $d =="; grep dolt_mode "$d/.beads/metadata.json"; grep export.auto "$d/.beads/config.yaml"
  done
  ```
- **Never trust a `✓ Closed` / `✓ Updated` line alone.** Verify with a fresh `bd show` in a
  *separate* command before reporting a bd mutation as done. (Matches the existing memory
  `feedback_bd_dolt_nondurable_writes.md`.)
- **Read `.beads/dolt-server.log` when writes don't stick.** A high count of `error="nothing to
  commit"` means the server isn't persisting commits at all — the authoritative signal, far more
  than issue-count divergence. Grep it early:
  `grep -oE 'error="[^"]*"' .beads/dolt-server.log | sort | uniq -c | sort -rn`.
- **Map servers to projects before blaming a race.** A `dolt sql-server` seen in `ps` may belong to
  a different repo — check `readlink /proc/<pid>/cwd` and the project's own `.beads/dolt-server.port`
  before assuming two servers contend for one workspace.
- **Prefer the bd 1.0.4 default (embedded + `export.auto: true`)** for new projects; only run
  server mode deliberately and document why.
- **On WSL2, keep the dolt DB off `/mnt/c`.** A `.beads/` checkout on the Windows drive cannot give
  dolt reliable mmap/lock/fsync durability — the DB will silently fail to persist and can corrupt.
  Either treat jsonl as source of truth (`export.auto: true`, DB disposable) or place the dolt DB on
  native ext4. This is a general WSL2-hosted-DB hazard, not bd-specific.

### 5C. Fix the `bd-maintenance` Skill (DevStandard)

File a correction to `DevStandard/dot-claude/skills/bd-maintenance/SKILL.md`:

- **§7 must not tell the agent to blindly set `dolt_mode: embedded`.** Add a gate first:
  1. `ps aux | grep 'dolt sql-server'` — if a server is running and holds the live data,
     **do NOT switch to embedded** (it reads a stale on-disk copy = data-loss hazard).
  2. Compare issue counts across `bd stats` (live DB), `wc -l .beads/issues.jsonl` (snapshot),
     and the embedded DB before changing `dolt_mode`. Divergence means *reconcile first*.
  3. Only migrate to embedded after `bd export`-ing the authoritative server data into the jsonl
     that will seed the embedded DB.
- **Add a new failure mode:** `auto-importing … into empty database` **+ `nothing to commit` in
  `dolt-server.log` + reverting writes** → the server DB is **not persisting commits** (empty on
  every connection); jsonl is the de-facto source of truth and if it is stale/export-off, writes
  revert. Fix is **rebuild from jsonl** (`bd doctor --fix --source=jsonl`), not a `dolt_mode` flip
  and not merely `export.auto true`. This is distinct from the plain "not reading from dolt" §7 symptom.
- **Add a log-triage step to §7:** before changing any config, run
  `grep -c 'nothing to commit' .beads/dolt-server.log` and the error tally above; schema errors
  (`foreign key … not found`, `Duplicate key name idx_*`, `table not found: config`) mean the DB is
  corrupt and must be rebuilt, and specifically mean the Tier-3 `dolt add config && dolt commit`
  remediation will fail (no `config` table/branch).

---

## 6. Evidence (session `0067b78b`)

- Row 214–218: three-way count divergence (210 DB / 198 jsonl / 169 embedded); "only the *last*
  bd write survives."
- Row 228–260: §7 "set embedded" applied, then **reverted** after it hid live issues; server-mode
  `bd doctor` passes clean.
- Row 252: two `dolt sql-server` processes confirmed running.
- Row 273: root cause stated — "auto-import ON, auto-export OFF … that asymmetry is the defect."
- Row 308: enabling `export.auto: true` surfaces the cosmetic `git add failed: paths ignored`
  warning (jsonl gitignored).
- Row 371: even with delays, the first write in a sequence still clobbered (originally mis-attributed
  to a duplicate-server race — the log shows the true cause is uncommitted writes).

**Server log evidence (`.beads/dolt-server.log`, 2026-07-07):**
- `error="nothing to commit"` × **1208** — writes never committed to dolt.
- `! [rejected] main -> main (non-fast-forward)` × 11 — dolt remote push perpetually rejected.
- `foreign key fk_dep_depends_on not found`, `Duplicate key name idx_issues_issue_type`,
  `table not found: config`, `branch not found: config` — schema corruption; Tier-3 remediation blocked.
- PID 24123 (port 38985) cwd = `/mnt/c/dev/RepositoryReport/.beads/dolt` — belongs to another project,
  not F3Go30 (disproves the two-server-race theory).

**Related:** `~/.claude/.../memory/feedback_bd_dolt_nondurable_writes.md`;
DevStandard LL `2026-03-26-bd-doctor-remediation-requires-dolt-cli-fallback.md`;
DevStandard LL `2026-05-04-beads-artifact-contract-not-explicit.md`.
