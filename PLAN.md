# Plan — F3Go30

<!-- bd is in use. This file is for human reference only.
     Do not consult for AI planning or task tracking.
     Use bd ready, bd prime, and docs/ROADMAP.md instead. -->

## Status
Documentation framework updated to latest version (2026-03-24). Beads initialized — all
planned work items migrated from PLAN.md backlog to bd issues. Roadmap items moved to
docs/ROADMAP.md.

Active development — version/About menu added to codebase but not yet deployed or tested
(F3Go30-zuo).

## Working
```
bd ready              # available work (unblocked, prioritized)
bd list               # all open issues
bd show <id>          # full issue detail with deps
bd update <id> --claim  # claim and start work (atomic: sets assignee + in_progress)
bd close <id>         # mark complete
/bd-report            # generate bdreport.md (snapshot with graph + narrative)
```

# Hardening work
callAdmin.js should move to tools
The Smoke tinyurl conversion failed, probably because Smoke appeared in parenthesis and space.  

copyAndInit from menu did not update the SMOKE_TRACKER_ID property.
copyAndInit from menu did not update TrackerDB, it likely failed other updates.
copying the spreadsheet should not copy the script. we no longer need a script in the tracker sheet.

cleanup onOpen menu.
- initializeTriggers should set everything, including the next month trigger as they are now all running in the context of the production template.
- review each of the menu functions, and recommend if we keep it or remove it, and if removing, should we remove the entire function not just the entry point.

review docs on covering how admin functions get called, what smoke means, how deployment environment and smoke works, how auth works in clasp, how to change environments with clasp you need to write a new .clasp.json file or create separate environment clasp.json files like we do for auth and use --project or the env variable clasp_config_project.  These are all things I have seen Claude stumble upon and have to re-try one or more times just in the last few sessions.  Recommend a concise and clear mechanism to capture this information so we don't have to guess and re-discover it each time.  Consider using tools for the different options, but how to make that the primary approach an llm tool like claude will take.

List where each of these issues, and where it appears in the documentation and how you discover it, and what if anything you recommend for an improvement.



2026 July Hard Commit Signup is open

Sign up here: https://script.google.com/macros/s/AKfycbzx5kfkSzTc8h2vOxuqR1-DDk7GiYdm7BjO8aNVs-ZUPV_gfhV4/exec?cmd=signup

2026 July Tracker: https://docs.google.com/spreadsheets/d/1pmSUWl_RZlZCvgcjb_9WAyeFnDOwV-a-OqExaLULpHY/edit#gid=887409035

(Prefer the old HC form? You can still use it: https://docs.google.com/forms/d/1aC8vh3yyVD2iwd_JWpqY2S0uMOQQgtuEiFMtMRoHymk/viewform)