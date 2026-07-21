#!/usr/bin/env python3
"""
activity_log.py — Query Axiom logs and summarize key PAX activity.

Aggregates signup, check-in-page-view, checkin, dashboard-view, bonus, nag-email, and legacy
GAS-to-static redirect events into human-readable summaries, ordered chronologically. Field
names match the actual GasLogger event payloads (see script/dashboardWebapp.js,
script/signupWebapp.js, script/nag.js, script/WebApp.js) — not guessed names.

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
    - Check-in entry path (which front end / which credential) is NOT on the
      checkinWebapp.identify event itself — it is reconstructed by joining that event to the
      doGet/doPost request event from the same execution via `execId`. See _entry_path_ below.
    - Registering is two separate executions: the signup form's PaxDB prefill LOOKUP
      (signupWebapp.identify, handleSignupIdentify_) and the WRITE that follows it
      (signupWebapp.save, handleSignupSave_). Only the write says whether the PAX was new;
      a lookup happens whether or not anything is ever saved. They are reported as
      [SIGNUP LOOKUP] and [SIGNUP NEW] / [SIGNUP UPDATE] accordingly — see
      _signup_exec_index_ and _attribute_signup_saves_ below.
    - [REDIRECT] lines are legacy ?cmd=checkin/?cmd=signup/home arrivals landing on the GAS
      "has moved" interstitial (logStaticRedirect_, script/WebApp.js) before the PAX taps through
      to the static front end. Never attributable to a PAX from Axiom alone (no f3Name is logged
      here, by the PII rule, and the token isn't re-logged on any later event to join against) —
      only the saved-link token itself is shown when present. The resolved PAX name, when the
      token matches a live session, is written to the spreadsheet's own Activity tab instead
      (see tools/callWebapp.js getSheet --body '{"sheetName":"Activity"}').
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

# signupWebapp.save `mode` (handleSignupSave_, script/signupWebapp.js) -> report label. This is
# the only event that distinguishes a first-time registration from a returning PAX re-saving one.
_SIGNUP_SAVE_LABELS = {'insert': 'SIGNUP NEW', 'update': 'SIGNUP UPDATE'}


def _entry_front_end_(data: dict) -> str | None:
    """Which front end issued this doGet/doPost request, or None if it isn't a check-in request.

    Four paths reach handleCheckinIdentify_ (script/dashboardWebapp.js), and the identify event
    alone can only tell token-vs-typed (`viaToken`). The front end is only visible on the request
    event that opened the same execution:

      doGet  cmd=checkin (+id=<guid>)     -> GAS-hosted CheckinApp.html, saved-link doGet
                                            (renderCheckinPage_, script/dashboardWebapp.js)
      doPost cmd=checkin, formIdentify=1  -> GAS-hosted page's typed-identify <form target="_top">
                                            (renderCheckinPageForTypedIdentify_)
      doPost cmd=checkin, no formIdentify -> static check-in page's JSON callApi('identify')
                                            (handleCheckinPost_; static-pages/src/index.html)

    A doGet with no `id` renders the GAS page's blank identify form and never calls identify at
    all, so it has no identify event to join to — it is deliberately not reported as an entry.
    """
    parameter = data.get('parameter') or {}
    if parameter.get('cmd') != 'checkin':
        return None
    if data.get('name') == 'doGet':
        return 'GAS page' if parameter.get('id') else None
    if data.get('name') == 'doPost':
        return 'GAS page' if parameter.get('formIdentify') == '1' else 'static page'
    return None


def _build_entry_index_(matches: list) -> dict:
    """Maps execId -> front-end label, from the doGet/doPost request events in the same result
    set. A check-in execution logs its request event before its identify event, so the pair is
    normally both present; near the query's oldest edge the request event can fall outside the
    window, in which case the identify event just reports an unknown front end.
    """
    index = {}
    for event in matches:
        data = event.get('data', {})
        exec_id = data.get('execId')
        if not exec_id:
            continue
        front_end = _entry_front_end_(data)
        if front_end:
            index[exec_id] = front_end
    return index


def _signup_exec_index_(matches: list) -> dict:
    """Maps execId -> the signup facts scattered across other events in the same execution.

    handleSignupSave_ (script/signupWebapp.js) logs the insert/update decision on its own event,
    but the two things that make that decision readable are logged separately within the same
    execution:

      findMostRecentPaxRecordForName_.done  `found`   -> has this PAX any PRIOR month's PaxDB
                                                        record (target month excluded)? This is
                                                        the "currently participating" answer
                                                        written to the Responses sheet.
      upsertPaxDbRow_                       `created` -> was the PaxDB row new, or patched?

    `f3Name` is picked up from any event in the execution that carries it; on the save execution
    that is only true once the GAS side stamps it (see _attribute_signup_saves_ for the fallback
    used on executions logged before that).
    """
    index = {}
    for event in matches:
        data = event.get('data', {})
        exec_id = data.get('execId')
        if not exec_id:
            continue
        name = data.get('name')
        entry = index.setdefault(exec_id, {})
        if data.get('f3Name'):
            entry['f3Name'] = data['f3Name']
        if name == 'findMostRecentPaxRecordForName_.done':
            entry['priorMonth'] = data.get('found')
        elif name == 'upsertPaxDbRow_':
            entry['paxDbCreated'] = data.get('created')
    return index


def _legacy_token_exec_ids_(matches: list) -> set:
    """execIds whose identify resolved via a pre-rollout signed IdentityToken.js token rather
    than a CheckinSessions guid (checkinWebapp.identify.legacyTokenUsed, resolveCheckinToken_dw_).
    Called out per-entry so the taper-off this event exists to monitor is visible in the report.
    """
    return {
        event.get('data', {}).get('execId')
        for event in matches
        if event.get('data', {}).get('name') == 'checkinWebapp.identify.legacyTokenUsed'
        and event.get('data', {}).get('execId')
    }


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


def _classify(event: dict, entry_index: dict = None, legacy_exec_ids: set = None,
              signup_index: dict = None) -> dict | None:
    """Normalize one raw Axiom event into a trackable activity, or None if not a tracked type.

    `group` marks whether this activity can be merged into a same-PAX session line (_SESSION)
    or must always stand alone (_STANDALONE). `f3Name` is the session grouping key for _SESSION
    activities; for _STANDALONE ones it is informational (the signup lines use it to attribute
    a save to a PAX — see _attribute_signup_saves_).

    `entry_index` / `legacy_exec_ids` come from _build_entry_index_ / _legacy_token_exec_ids_ and
    only affect the VIEW CHECKIN line's entry-path detail. `signup_index` comes from
    _signup_exec_index_ and only affects the signup lines.

    A returned activity carries either a finished `detail`, or a `detail_fmt` with a `{who}`
    placeholder that _attribute_signup_saves_ fills in a later chronological pass.
    """
    entry_index = entry_index or {}
    legacy_exec_ids = legacy_exec_ids or set()
    signup_index = signup_index or {}
    data = event.get('data', {})
    name = data.get('name', '')
    ts_iso = event.get('_time', '')
    ts_str = _fmt_time(ts_iso)
    epoch = _parse_epoch(ts_iso)

    # The signup form's PaxDB prefill lookup (handleSignupIdentify_) — reported for both outcomes,
    # and deliberately NOT called a signup: it is a read, and nothing may ever be saved after it.
    if name == 'signupWebapp.identify' and data.get('matched') is not None:
        facts = signup_index.get(data.get('execId'), {})
        f3_name = data.get('f3Name') or facts.get('f3Name') or '?'
        if data.get('matched') is True:
            team = data.get('team', '?')
            team_type = data.get('teamType', '')
            outcome = f"existing record found, prefilled → team {team} ({team_type})"
        else:
            outcome = "no existing record — form starts blank"
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE, 'f3Name': f3_name,
                'label': 'SIGNUP LOOKUP', 'detail': f"{f3_name}: signup form lookup, {outcome}"}

    # The write that follows the lookup (handleSignupSave_). `mode` is absent on this event's
    # other uses (trackerRowAdded), which are not registration outcomes and are skipped.
    if name == 'signupWebapp.save' and data.get('mode') in _SIGNUP_SAVE_LABELS:
        facts = signup_index.get(data.get('execId'), {})
        mode = data['mode']
        what = ("new registration for this month" if mode == 'insert'
                else "existing registration for this month re-saved")
        prior = facts.get('priorMonth')
        history = ("first Go30 month" if prior is False else
                   "returning from a prior month" if prior is True else
                   "prior participation unknown")
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE,
                'f3Name': data.get('f3Name') or facts.get('f3Name'),
                'label': _SIGNUP_SAVE_LABELS[mode], 'detail': None,
                'detail_fmt': "{who}: " + f"{what} ({history})"}

    if name == 'signupWebapp.save.emailChanged':
        facts = signup_index.get(data.get('execId'), {})
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE,
                'f3Name': data.get('f3Name') or facts.get('f3Name'),
                'label': 'SIGNUP EMAIL', 'detail': None,
                'detail_fmt': "{who}: signed up under a new email; prior row retired (DELETED)"}

    if name == 'checkinWebapp.identify':
        f3_name = data.get('f3Name', '?')
        front_end = entry_index.get(data.get('execId'), 'unknown front end')
        credential = "saved link" if data.get('viaToken') else "typed name+email"
        if data.get('execId') in legacy_exec_ids:
            credential += ", legacy token"
        return {'ts': epoch, 'ts_str': ts_str, 'group': _SESSION, 'f3Name': f3_name,
                'label': 'VIEW CHECKIN', 'detail': f"check-in page ({front_end}, {credential})"}

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

    # A legacy GAS URL (?cmd=checkin, ?cmd=signup, or bare home) arriving at the one-tap
    # "has moved" interstitial (logStaticRedirect_, script/WebApp.js). This is its own execution,
    # separate from any later identify — Axiom never carries f3Name here (PII rule), and the
    # token itself isn't re-logged on the later identify event either, so there is no reliable
    # join back to a PAX from Axiom data alone. Report the route and, when a saved-link token
    # rode along, the token itself — the closest thing to "who" that Axiom actually has. The
    # resolved PAX name (when the token matches a live CheckinSessions row) is only ever written
    # to the spreadsheet's own Activity tab (logActivity, GAS-side), not Axiom.
    if name.endswith('.staticRedirect') and name.startswith('render'):
        route = {'renderHomePage_.staticRedirect': 'home', 'renderSignupPage_.staticRedirect': 'signup',
                 'renderCheckinPage_.staticRedirect': 'check-in'}.get(name, name)
        token = data.get('token')
        who = f"token={token}" if token else "no token (anonymous arrival)"
        return {'ts': epoch, 'ts_str': ts_str, 'group': _STANDALONE, 'f3Name': None,
                'label': 'REDIRECT', 'detail': f"legacy {route} link → static interstitial ({who})"}

    return None


def _attribute_signup_saves_(activities: list) -> list:
    """Fill the `{who}` placeholder on signup-write lines. `activities` must be chronological.

    The save runs in its own execution (a fresh doPost), so it cannot be joined to the lookup by
    execId the way the check-in entry path is. Where the GAS side stamps f3Name on the save event
    the name is exact; on executions logged before that it is inferred from the most recent
    signup-form lookup within SESSION_GAP_SECONDS and prefixed '~' to mark it as inferred. Two
    PAX signing up concurrently can defeat that inference, which is why the '~' is there.
    """
    last_lookup = None  # (epoch, f3Name)
    for act in activities:
        if act['label'] == 'SIGNUP LOOKUP' and act.get('f3Name') and act.get('ts'):
            last_lookup = (act['ts'], act['f3Name'])
        fmt = act.pop('detail_fmt', None)
        if not fmt:
            continue
        who = act.get('f3Name')
        if not who and last_lookup and act.get('ts') and act['ts'] - last_lookup[0] <= SESSION_GAP_SECONDS:
            who = '~' + last_lookup[1]
        act['detail'] = fmt.format(who=who or '?')
    return activities


def _format_tag(label: str) -> str:
    return f"[{label}]".ljust(16)


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

    # Built over the whole raw result set (not just the classified activities) — the doGet/doPost
    # request events these join against are never themselves reported as activities.
    entry_index = _build_entry_index_(matches)
    legacy_exec_ids = _legacy_token_exec_ids_(matches)
    signup_index = _signup_exec_index_(matches)

    activities = [c for c in (_classify(e, entry_index, legacy_exec_ids, signup_index) for e in matches) if c]
    activities.reverse()  # chronological, oldest first
    summaries = _group_sessions(_attribute_signup_saves_(activities))
    summaries = summaries[:args.limit]

    print(f"\n{len(summaries)} activities, {args.since} lookback")
    print("=" * 90)
    for s in summaries:
        print(s)
    print("=" * 90)

    return 0


if __name__ == "__main__":
    sys.exit(main())
