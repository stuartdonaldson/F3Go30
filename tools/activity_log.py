#!/usr/bin/env python3
"""
activity_log.py — Query Axiom logs and summarize key PAX activity.

Aggregates signup, checkin, bonus, and nag-email events into human-readable summaries,
ordered chronologically. Field names match the actual GasLogger event payloads (see
script/dashboardWebapp.js, script/signupWebapp.js, script/nag.js) — not guessed names.

Usage:
    python tools/activity_log.py [--limit N] [--since DURATION] [--env sit|prod]

Examples:
    python tools/activity_log.py                    # last 200 events, last 24h
    python tools/activity_log.py --limit 500 --since 7d
    python tools/activity_log.py --env sit

Notes:
    - Nag opt-in status per PAX is NOT logged anywhere (PII masking) — it only lives in
      the Responses sheet's "NAG Email" column. This script instead reports actual nag
      email SEND activity (sendNagEmail.complete / .sendFailed), which is aggregated
      per-team-per-run, not per individual PAX.
    - --env maps to the `target` field stamped by GasLogger on every event: TEMPLATE (prod)
      or TEST (sit) — see tools/manage-deployments.js.
"""
import argparse
import pathlib
import sys
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from query_axiom import query, _load_settings, _parse_duration

_ENV_TARGET = {"sit": "TEST", "prod": "TEMPLATE"}


def _fmt_time(iso_str: str) -> str:
    try:
        return datetime.fromisoformat(iso_str.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, AttributeError):
        return iso_str


def _summarize(event: dict) -> str | None:
    data = event.get('data', {})
    name = data.get('name', '')
    ts = _fmt_time(event.get('_time', ''))

    if name == 'signupWebapp.identify' and data.get('matched') is True:
        f3_name = data.get('f3Name', '?')
        team = data.get('team', '?')
        team_type = data.get('teamType', '')
        return f"{ts}  [SIGNUP]     {f3_name} → team {team} ({team_type})"

    if name == 'checkinWebapp.checkin':
        f3_name = data.get('f3Name', '?')
        day = data.get('day', '?')
        value = data.get('value')
        result = "YES" if value == 1 else "NO" if value == 0 else "?"
        return f"{ts}  [CHECKIN]    {f3_name} ({day}): {result}"

    if name == 'checkinWebapp.bonusAdd':
        f3_name = data.get('f3Name', '?')
        bonus_type = data.get('type', '?')
        return f"{ts}  [BONUS]      {f3_name} added {bonus_type}"

    if name == 'sendNagEmail.complete':
        emails_sent = data.get('emailsSent', '?')
        teams_notified = data.get('teamsNotified') or []
        teams = ", ".join(t.get('team', '?') for t in teams_notified) if teams_notified else "-"
        return f"{ts}  [NAG EMAIL]  sent={emails_sent} teams=[{teams}]"

    if name == 'sendNagEmail.sendFailed':
        team = data.get('team', '?')
        error = data.get('error', '?')
        return f"{ts}  [NAG FAILED] team={team} error={error}"

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", "-n", type=int, default=200, help="Max events to return (default: 200)")
    parser.add_argument("--since", default="24h", help="How far back to look, e.g. 30m, 2h, 1d (default: 24h)")
    parser.add_argument("--env", choices=["sit", "prod"], help="Filter to SIT (TEST) or PROD (TEMPLATE) deploy target")
    args = parser.parse_args()

    settings = _load_settings()
    dataset = settings.get("axiomDataset")
    token = settings.get("axiomQueryToken")
    if not dataset or not token:
        print("ERROR: axiomDataset / axiomQueryToken not set in local.settings.json", file=sys.stderr)
        return 1

    where_clause = None
    if args.env:
        where_clause = f"target == '{_ENV_TARGET[args.env]}'"

    result = query(
        dataset, token,
        limit=args.limit,
        since=_parse_duration(args.since),
        side=None,
        name=None,
        where=where_clause,
    )
    matches = result.get("matches", [])

    summaries = [s for s in (_summarize(e) for e in matches) if s]
    summaries.reverse()  # chronological, oldest first

    print(f"\n{len(summaries)} activities, {args.since} lookback")
    print("=" * 90)
    for s in summaries:
        print(s)
    print("=" * 90)

    return 0


if __name__ == "__main__":
    sys.exit(main())
