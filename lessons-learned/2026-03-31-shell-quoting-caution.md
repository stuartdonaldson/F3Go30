# LL: Shell command examples using backticks caused unintended shell substitution

Date: 2026-03-31
Domain: documentation | tooling

## Observation
During a recent session, command examples were provided using backticks (e.g. `ls -la ~/.clasprc.json` with backticks displayed inline). When copied directly into a Bourne-like shell, the backticks caused command substitution or syntax errors, risking unintended execution and confusion. The issue was caught when an attempt to run a provided command produced unexpected behavior in the WSL environment.

## Why Chain
Why 1 — Command examples used backticks which the shell treats as command substitution, not literal markers.
Why 2 — Documentation and assistant output mixed markup conventions (Markdown inline code) with shell copy/paste expectations without explicit guidance for safe copy.
Why 3 — No project guideline existed requiring terminal-safe command formatting (fenced code blocks with language hint) or an explicit note for WSL/Unix users.
Root cause: Documentation and assistant outputs did not enforce a standard for presenting terminal commands in a cross-platform-safe way.

## Initial Candidates
c: Update README.md and writing conventions to mandate fenced, language-labeled code blocks for shell commands and avoid inline backticks in examples.
b: Add a CLAUDE.md rule to always present terminal commands in fenced blocks with a short safety note for WSL/Linux users.
e: Add a short `docs/usage.md` section documenting safe copy/paste practices for shells and WSL specifics.

## Next Steps (capture)
- Update project writing guideline (README or CLAUDE.md) to require fenced blocks for shell commands.
- Add example: show both the safe copy/paste command and an explanation if backticks are used in prose.
- Consider a linter or pre-commit check for docs that flags inline backticks containing shell metacharacters.
