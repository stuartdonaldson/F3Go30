# Reminder Email Template

Status: proposed standalone mockup

Purpose: editable reminder-email copy for `F3Go30-ul1`

Note: this file is not yet wired into `script/nag.js` at runtime. It is a standalone template artifact you can edit and revise before we convert it into code.

---

## Template Tokens

Use these placeholders when editing the subject and body:

| Token | Meaning |
|---|---|
| `{{TARGET_DATE}}` | The check-in date being reminded about, e.g. `05/08/2026` |
| `{{TEAM_NAME}}` | Team or sub-team name |
| `{{FUN_FACT}}` | Randomly selected FunFacts text |
| `{{TRACKER_URL}}` | Direct link to the current tracker |
| `{{MISSING_LIST}}` | Bullet list of teammates who have not checked in |
| `{{RECIPIENT_SCOPE_NOTE}}` | Reminder that only opted-in teammates received the email |

---

## Proposed Subject

```text
Go30 Reminder | {{TEAM_NAME}} | Missing check-ins for {{TARGET_DATE}}
```

## Proposed Body

```text
{{FUN_FACT}}

Men of {{TEAM_NAME}},

This is a quick reminder that the following teammates have not yet checked in for {{TARGET_DATE}}:

{{MISSING_LIST}}

Open the tracker here:
{{TRACKER_URL}}

If you already checked in and your entry is not showing yet, just update it in the tracker.

{{RECIPIENT_SCOPE_NOTE}}

Stay after it,
F3 Go30
```

---

## Suggested Token Content

### `{{FUN_FACT}}`

```text
Fun fact: {{FUN_FACT_ROW}}
```

If you decide the message should sometimes omit the FunFacts intro, this line can be optional.

### `{{MISSING_LIST}}`

```text
- Anchor
- Torch
- Sledge
```

### `{{RECIPIENT_SCOPE_NOTE}}`

```text
This reminder was sent only to teammates who explicitly opted in to nag emails.
```

---

## Rendered Example

Subject:

```text
Go30 Reminder | Team A | Missing check-ins for 05/08/2026
```

Body:

```text
Fun fact: Favorite CSAUP - Murph

Men of Team A,

This is a quick reminder that the following teammates have not yet checked in for 05/08/2026:

- Anchor
- Torch

Open the tracker here:
https://docs.google.com/spreadsheets/d/example/edit#gid=456

If you already checked in and your entry is not showing yet, just update it in the tracker.

This reminder was sent only to teammates who explicitly opted in to nag emails.

Stay after it,
F3 Go30
```

---

## Editing Notes

- If you want a stronger F3 voice, adjust the greeting and closing only; keep the factual middle section easy to scan.
- If you want less social pressure, change `the following teammates have not yet checked in` to `the tracker still shows no check-in for`.
- If you want team-specific copy, keep the same tokens and vary only the surrounding text.
- If you want this wired into Apps Script next, the simplest path is to make `buildReminderEmailTemplate_()` match this file's subject/body structure.