# LL: Python environment unspecified in instructions caused environment drift

Date: 2026-03-31
Domain: testing | environment

## Observation
The project contains Python test tooling (`test/test_tracker_init.py`) but earlier guidance and assistant outputs did not specify the required Python virtual environment. The agreed canonical environment is `/mnt/c/dev/envs/uv1`, but this was not consistently used in commands or run instructions, causing ambiguity and potential failures when tests are run in other interpreters.

## Why Chain
Why 1 — Test instructions lacked an explicit activation step for the canonical virtualenv path.
Why 2 — No repository-level note (e.g., README or repo memory) recorded the canonical environment path for developers and automation.
Why 3 — No gating or pre-run check existed to verify the active Python interpreter matches the canonical environment.
Root cause: Missing documented and machine-verifiable project configuration for the Python interpreter and virtualenv.

## Initial Candidates
b: Add canonical environment note to CLAUDE.md and README with exact path and activation command.
c: Add a small `scripts/activate_env.sh` helper that verifies and activates `/mnt/c/dev/envs/uv1` when available, and prints a helpful error otherwise.
d: Add a gate checklist item or test pre-run that fails if `sys.executable` does not contain `/mnt/c/dev/envs/uv1` for CI or local runs.

## Next Steps (capture)
- Document the canonical environment in README and /memories/repo/python_env.md.
- Add a pre-run check to `test/test_tracker_init.py` to assert the correct interpreter, failing fast with a clear message.
- Consider adding a short helper script in `script/` or `tools/` to activate or advise about the environment.
