#!/usr/bin/env python3
"""
activity_log.py — Query Axiom logs and summarize key PAX activity.

Aggregates signup, check-in-page-view, checkin, dashboard-view, bonus, and nag-email events
into human-readable summaries, ordered chronologically. Field names match the actual GasLogger
event payloads (see script/dashboardWebapp.js, script/signupWebapp.js, script/nag.js) — not
guessed names.

Viewing the check-in page, logging a checkin, and viewing the dashboard are each their own
activity, but a PAX typically does all three back-to-back in one sitting. Activities that
belong to the check-in flow (view page / checkin / bonus add / view dashboard) for the same
PAX within SESSION_GAP_SECONDS of each other are collapsed onto a single [SESSION] line rather
than printed as separate, disconnected events. Signup and nag-email activity are never merged
into a session line.

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

# Activities within this many seconds of each other, for the same PAX, are treated as one
# authentication session and collapsed onto a single report line.
SESSION_GAP_SECONDS = 300

_SESSION = 'session'
_STANDALONE = 'standalone'


def _fmt_time(iso_str: str) -> str:
    try:
        dt_utc = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        dt_local = dt_utc.astimezone()
        return dt_local.strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, AttributeError):
        return iso_str


def _parse_epoch(iso_str: str):
    try:
        return datetime.fromisoformat(iso_str.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError):
        return None


def _classify(event: dict) -> dict | None:
    """Normalize one raw Axiom event into a trackable activity, or None if not a tracked type.

    `group` marks whether this activity can be merged into a same-PAX session line (_SESSION)
    or must always stand alone (_STANDALONE). `f3Name` is the session grouping key for _SESSION
    activities; it's meaningless for _STANDALONE ones.
    """
    data = event.get('data', {})
    name = data.get('name', '')
    ts_iso = event.get('_time', '')
    ts_str = _fmt_time(ts_iso)
    epoch = _parse_epoch(ts_iso)

    if name == 'signupWebapp.identify' and data.get('matched') is True:
        f3_name = data.get('f3Name', '?')
        team = data.get('team', '?')
        team_type = data.get('teamType', '')
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE, 'f3Name': None,
                'label': 'SIGNUP', 'detail': f"{f3_name} → team {team} ({team_type})"}

    if name == 'checkinWebapp.identify':
        f3_name = data.get('f3Name', '?')
        return {'ts': epoch, 'ts_str': ts_str, 'group': _SESSION, 'f3Name': f3_name,
                'label': 'VIEW CHECKIN', 'detail': "check-in page"}

    if name == 'checkinWebapp.checkin':
        f3_name = data.get('f3Name', '?')
        day = data.get('day', '?')
        value = data.get('value')
        result = "YES" if value == 1 else "NO" if value == 0 else "?"
        return {'ts': epoch, 'ts_str': ts_str, 'group': _SESSION, 'f3Name': f3_name,
                'label': 'CHECKIN', 'detail': f"checked in ({day}): {result}"}

    if name == 'checkinWebapp.dashboard':
        f3_name = data.get('f3Name', '?')
        return {'ts': epoch, 'ts_str': ts_str, 'group': _SESSION, 'f3Name': f3_name,
                'label': 'DASHBOARD', 'detail': "dashboard"}

    if name == 'checkinWebapp.bonusAdd':
        f3_name = data.get('f3Name', '?')
        bonus_type = data.get('type', '?')
        return {'ts': epoch, 'ts_str': ts_str, 'group': _SESSION, 'f3Name': f3_name,
                'label': 'BONUS', 'detail': f"added bonus {bonus_type}"}

    if name == 'sendNagEmail.complete':
        emails_sent = data.get('emailsSent', '?')
        teams_notified = data.get('teamsNotified') or []
        teams = ", ".join(t.get('team', '?') for t in teams_notified) if teams_notified else "-"
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE, 'f3Name': None,
                'label': 'NAG EMAIL', 'detail': f"sent={emails_sent} teams=[{teams}]"}

    if name == 'sendNagEmail.sendFailed':
        team = data.get('team', '?')
        error = data.get('error', '?')
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE, 'f3Name': None,
                'label': 'NAG FAILED', 'detail': f"team={team} error={error}"}

    return None


def _format_tag(label: str) -> str:
    return f"[{label}]".ljust(14)


def _group_sessions(activities: list) -> list:
    """Collapse consecutive same-PAX _SESSION activities within SESSION_GAP_SECONDS into one
    [SESSION] line each; _STANDALONE activities always get their own line. `activities` must
    already be in chronological order.
    """
    lines = []
    pending = None  # {'key', 'f3Name', 'ts_str', 'last_ts', 'labels': [...], 'details': [...]}

    def flush():
        nonlocal pending
        if pending is None:
            return
        if len(pending['details']) == 1:
            lines.append(f"{pending['ts_str']}  {_format_tag(pending['labels'][0])} {pending['f3Name']}: {pending['details'][0]}")
        else:
            chain = " → ".join(pending['details'])
            lines.append(f"{pending['ts_str']}  {_format_tag('SESSION')} {pending['f3Name']}: {chain}")
        pending = None

    for act in activities:
        if act['group'] != _SESSION:
            flush()
            lines.append(f"{act['ts_str']}  {_format_tag(act['label'])} {act['detail']}")
            continue

        key = (act['f3Name'] or '').strip().lower()
        same_session = (
            pending is not None and pending['key'] == key and act['ts'] is not None
            and pending['last_ts'] is not None and act['ts'] - pending['last_ts'] <= SESSION_GAP_SECONDS
        )
        if same_session:
            pending['labels'].append(act['label'])
            pending['details'].append(act['detail'])
            pending['last_ts'] = act['ts']
        else:
            flush()
            pending = {'key': key, 'f3Name': act['f3Name'], 'ts_str': act['ts_str'],
                       'last_ts': act['ts'], 'labels': [act['label']], 'details': [act['detail']]}

    flush()
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", "-n", type=int, default=200, help="Max summaries to output (default: 200)")
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
        limit=args.limit * 3,
        since=_parse_duration(args.since),
        side=None,
        name=None,
        where=where_clause,
    )
    matches = result.get("matches", [])

    activities = [c for c in (_classify(e) for e in matches) if c]
    activities.reverse()  # chronological, oldest first
    summaries = _group_sessions(activities)
    summaries = summaries[:args.limit]

    print(f"\n{len(summaries)} activities, {args.since} lookback")
    print("=" * 90)
    for s in summaries:
        print(s)
    print("=" * 90)

    return 0


if __name__ == "__main__":
    sys.exit(main())
