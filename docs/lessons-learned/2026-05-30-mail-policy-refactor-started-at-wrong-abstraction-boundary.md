# LL: Mail policy refactor started at the wrong abstraction boundary

Date: 2026-05-30
Domain: process

## Observation

User asked for outbound mail sending to be wrapped so test-mode recipient override and
"intended recipients" annotation would be enforced centrally and would prevent test mail from
going to real users.

The first implementation placed the delivery-policy logic in a nag-specific helper instead of a
shared outbound mail wrapper. User immediately identified the mismatch and asked: "Shouldn't the
policy wrapper be a common wrapper that the Nag, send on Reuse, send on Register, etc... all use?"

Later in the same session, live testing exposed a second rework path: deployed behavior depended on
the exact Config row name, and manual sheet edits had introduced a non-canonical row name. The
project did not have a Config initializer that created or normalized the operational rows, so the
mail policy could be configured incorrectly by typo.

Caught at: user review during implementation, then live deployment testing.

## Why Chain

Branch A — Shared policy implemented as a local caller concern

Why 1 — The first code change put mail-delivery policy in a `nag.js` helper instead of the shared
         outbound mail utility.
Why 2 — The implementation was anchored on the first active sender (`sendNagEmail`) rather than on
         the shared ownership boundary for outbound delivery.
Why 3 — The local-routing workflow optimized for the nearest concrete caller and smallest initial
         edit, but did not force a second check that the abstraction level matched the user's stated
         refactor scope.
Why 4 — There is no explicit pre-edit check that, when the user asks for a common wrapper or shared
         policy, the first implementation must move to the shared owner instead of the current caller.
Root cause A: The implementation process has no explicit guard that maps "shared wrapper / common
policy" requests to the shared ownership boundary before the first edit, so a local caller can be
mistaken for the correct implementation surface.

Branch B — Operational config depended on manual row names

Why 1 — Live behavior depended on an exact Config row name for test mode.
Why 2 — The sheet was edited manually and contained a non-canonical row name.
Why 3 — The tracker/template path did not initialize or migrate the Config sheet to the canonical
         operational keys before runtime looked them up.
Why 4 — There was no project rule that new operational Config keys must be introduced through an
         initializer/migration step rather than through documentation and manual sheet edits.
Root cause B: The project lacked a canonical Config-sheet initialization/migration step for new
operational keys, so runtime behavior could drift based on manual row-name entry.

## Initial Candidates

c: update implementation-gate or a refactor-focused skill check — when user asks for a common
   wrapper/shared policy, require an explicit abstraction-boundary check before the first edit.
b: add a project rule in CLAUDE.md — cross-cutting mail/config policy changes must start at the
   shared utility or owning abstraction, not the first local caller.
c: add a project skill/checklist step — new Config-backed operational features must include a
   canonical initializer or migration path in the same change.
b: add a project rule in CLAUDE.md — manual Config-sheet row creation is not the source of truth;
   operational keys must be created and normalized by code.