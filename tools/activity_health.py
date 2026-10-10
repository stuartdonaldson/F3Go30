"""
activity_health.py — aggregate health report behind `activity_log.py --health` (F3Go30-lsoj).

Where activity_log.py's default mode narrates individual PAX sessions, this mode answers "how is
<env> doing": the same Axiom events, aggregated and compared two ways —

    by version  server metrics grouped by the server `version` stamp; client telemetry grouped by
                the browser's `clientVersion` — both normalised to x.y.z in the query, so SIT
                builds like 2.6.7.11 fold into 2.6.7
    by week     both grouped by APL startofweek(_time) — Sunday-start, UTC
    by hour     both grouped by hour of day (0-23) in Pacific time (HOUR_TZ, the GAS project's
                timezone), each rate compared with the whole window's rate — traffic varies
                widely by hour, so only the rates are comparable (F3Go30-k624)

Every count with a natural denominator is shown as absolute AND percent (login match % of logins,
client failures % of that client's POSTs, users affected % of active users, ...), with the change
from the previous period on each rate, so periods of very different traffic compare directly.

The "Needs further analysis" section is the part meant for a follow-up LLM (or human) pass: rule
based flags — Axiom log loss (gasLogger.ingestRejected), rate regressions, events/error texts first seen in the last 7 days, events that vanish for a week, stale client
versions still posting, server .error events, per-day volume drops (a possible silent log loss,
cf. F3Go30-u7nk), latency regressions, and PAX with repeated client failures — each carrying its
evidence. The default text format is for reading; `--format md` is the same as markdown; `--format
json` emits the whole report machine-readable, adding a query_axiom.py drill-down query per
finding, for the follow-up hand-off. Those drill-down commands are live APL (query_axiom.py), so
they only reach Axiom's last 30 days — older findings can be re-queried locally with
`query_axiom.py --local --sql`.

Layering: fetch() (SQL over the local Axiom store, axiom_store.py, F3Go30-43qv — it outlives Axiom's
30-day retention) and its APL twin fetch_live() (used when duckdb is not installed; 30-day reach)
are the only functions that do I/O; they return identical raw dicts, and everything else is pure
over the row dicts they return, and is unit-tested from fixtures in test/test_activity_health.py.

Time of a client failure: a client queues telemetry offline and relays it later — about half of
PROD's arrive over an hour late, some a day or more — so every clientTelemetry row is placed by
the client's own capture time `ts` (when it happened), not its arrival `_time` (F3Go30-k624).
fetch() swaps `ts` into `_time` for those rows before any query sees them, and selects the window
by it; fetch_live() swaps it the same way but Axiom selects the window by arrival.

Caveats:
    - `ts` is the browser's clock; a device with a wrong clock misplaces its own failures.
    - Metrics that only exist from a given version on (lostResponse from 2.6.6, hedgedRead from
      2.6.7) read as 0 for older versions — "not instrumented", not "no problem".
"""

import json
import re
import shlex
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import axiom_store
from query_axiom import ENV_TARGET, run_apl

# --- thresholds -----------------------------------------------------------------------------
REGRESSION_RATIO = 1.5      # "higher is worse" rate must grow by at least this factor ...
MIN_RATE_PP = 1.0           # ... and by at least this many percentage points ...
MIN_COUNT = 5               # ... with at least this many occurrences in the latest period
MATCH_DROP_PP = 3.0         # "lower is worse" rate must fall by at least this many points ...
MIN_DENOMINATOR = 20        # ... over at least this many trials
P95_RATIO = 1.25            # login p95 latency regression
VOLUME_DROP_RATIO = 0.5     # POSTs/day below this fraction of the previous period
REPEAT_FAILURES = 10        # client failures by one PAX in the recent window
RECENT_DAYS = 7             # 'recent' window for new-event / stale-client / repeat-failure flags
GAP_BASELINE = 20           # an event must average this many per complete week ...
GAP_RATIO = 0.1             # ... and fall below this fraction of it in one week to flag a gap
GONE_SHARE = 0.05           # an app version is "mostly gone" after its last day at >= this share
GONE_MIN = 5                # ... of all that day's requests, with at least this many of its own
HOUR_TZ = "America/Los_Angeles"  # by-hour view: the GAS project timezone (script/appsscript.json)

# (rate key, numerator, denominator, direction) — direction is which way is worse
SERVER_RATE_METRICS = [
    ("loginMatchPct", "matched", "logins", "lower"),
    ("srvErrPct", "srvErr", "posts", "higher"),
    ("slowPct", "slow", "n", "higher"),
]
CLIENT_RATE_METRICS = [
    ("errPct", "err", "posts", "higher"),
    ("lostPct", "lost", "posts", "higher"),
    ("lostTimeoutPct", "lostTimeout", "posts", "higher"),
    ("reconnectFailedPct", "reconnectFailed", "posts", "higher"),
    ("affectedPct", "affected", "users", "higher"),
]
METRIC_LABELS = {
    "loginMatchPct": "login match rate", "srvErrPct": "server errors per POST",
    "slowPct": "logins slower than 10s", "errPct": "client errors per POST",
    "lostPct": "lost responses per POST", "lostTimeoutPct": "lost-response timeouts per POST",
    "reconnectFailedPct": "reconnect gave up per POST", "affectedPct": "users hitting a failure",
}
# APL filter that selects the events behind each rate, for drill-down commands
METRIC_FILTERS = {
    "loginMatchPct": "name == 'checkinWebapp.identify.result' and matched == false",
    "srvErrPct": "name endswith '.error'",
    "slowPct": "name == 'checkinWebapp.identify.result' and durationMs > 10000",
    "errPct": "name == 'clientTelemetry' and kind == 'error'",
    "lostPct": "name == 'clientTelemetry' and kind == 'lostResponse'",
    "lostTimeoutPct": "name == 'clientTelemetry' and kind == 'lostResponse'",
    "reconnectFailedPct": "name == 'clientTelemetry' and kind == 'reconnectPoll' and outcome == 'failed'",
    "affectedPct": "name == 'clientTelemetry' and kind in ('error', 'lostResponse')",
}
CLIENT_COUNT_FIELDS = ("posts", "err", "lost", "lostTimeout", "reconnectFailed", "users", "affected")

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)")
_TOOL = "/mnt/c/dev/venvs/uv1/bin/python tools/query_axiom.py"


# --- small helpers --------------------------------------------------------------------------
def normalize_version(v) -> str:
    if not v:
        return "(none)"
    m = _VERSION_RE.match(str(v))
    return ".".join(m.groups()) if m else str(v)


def version_key(v):
    """Numeric semver order; non-numeric labels ('legacy', '(none)') sort first."""
    m = _VERSION_RE.match(str(v))
    return (1, tuple(int(x) for x in m.groups())) if m else (0, (str(v),))


def pct(n, d):
    if not d:
        return None
    return round(100.0 * (n or 0) / d, 2)


def to_iso(t) -> str | None:
    """APL returns min/max(_time) as epoch nanoseconds and startofweek() as ISO; unify to ISO."""
    if t is None or t == "":
        return None
    if isinstance(t, (int, float)) or (isinstance(t, str) and t.isdigit()):
        return datetime.fromtimestamp(int(t) / 1e9, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datetime.fromisoformat(str(t).replace("Z", "+00:00")).strftime("%Y-%m-%dT%H:%M:%SZ")


def drill_cmd(env, where, apl=None, start=None, end=None, since=None) -> str:
    parts = [_TOOL]
    if env:
        parts += ["--env", env]
    if start:
        parts += ["--start", start]
        if end:
            parts += ["--end", end]
    elif since:
        parts += ["--since", since]
    parts += ["--where", _quote(where)]
    if apl:
        parts += ["--apl", _quote(apl)]
    return " ".join(parts)


def _quote(arg):
    return f'"{arg}"' if not any(c in arg for c in '"$`\\') else shlex.quote(arg)


def _add_deltas(rows, metrics):
    prev = None
    for r in rows:
        r["delta"] = {}
        for key, *_ in metrics:
            cur, before = r.get(key), (prev or {}).get(key)
            r["delta"][key] = None if cur is None or before is None else round(cur - before, 2)
        prev = r
    return rows


def _ordered(rows, order):
    by = {r["period"]: r for r in rows}
    return [by[p] for p in order if p in by]


# --- tables ---------------------------------------------------------------------------------
def build_server_table(server_rows, latency_rows, order):
    lat = {r["period"]: r for r in latency_rows}
    out = []
    for r in _ordered(server_rows, order):
        row = dict(r)
        row.update({k: v for k, v in lat.get(r["period"], {}).items() if k != "period"})
        row.setdefault("slow", 0)
        row.setdefault("n", 0)
        for key, num, den, _ in SERVER_RATE_METRICS:
            row[key] = pct(row.get(num), row.get(den))
        row["postsPerDay"] = round(row["posts"] / row["days"], 1) if row.get("days") else None
        out.append(row)
    return _add_deltas(out, SERVER_RATE_METRICS)


def merge_client_versions(rows):
    merged = {}
    for r in rows:
        p = normalize_version(r["period"])
        m = merged.setdefault(p, {"period": p, **{k: 0 for k in CLIENT_COUNT_FIELDS},
                                  "first": None, "last": None})
        for k in CLIENT_COUNT_FIELDS:
            m[k] += r.get(k) or 0
        f, l = to_iso(r.get("first")), to_iso(r.get("last"))
        m["first"] = min(x for x in (m["first"], f) if x) if (m["first"] or f) else None
        m["last"] = max(x for x in (m["last"], l) if x) if (m["last"] or l) else None
    return list(merged.values())


def build_client_table(client_rows, order):
    out = []
    for r in _ordered(client_rows, order):
        row = dict(r)
        for key, num, den, _ in CLIENT_RATE_METRICS:
            row[key] = pct(row.get(num), row.get(den))
        out.append(row)
    return _add_deltas(out, CLIENT_RATE_METRICS)


def _vs_overall(table, metrics):
    """Replace each row's delta with its rate minus the whole-table rate (counts are additive)."""
    total = {}
    for _, num, den, _ in metrics:
        for f in (num, den):
            total[f] = sum(r.get(f) or 0 for r in table)
    overall = {key: pct(total[num], total[den]) for key, num, den, _ in metrics}
    for r in table:
        r["delta"] = {key: None if r.get(key) is None or overall[key] is None
                      else round(r[key] - overall[key], 2) for key, *_ in metrics}
    return overall


def build_hour_tables(server_rows, latency_rows, client_rows):
    """byHour {server, client}, hours 0-23 ascending; delta = rate minus the whole-window rate."""
    order = sorted({r["period"] for r in server_rows + client_rows})
    # users/affected are distinct per hour and do not add up across hours, so no overall for them
    client_metrics = [m for m in CLIENT_RATE_METRICS if m[0] != "affectedPct"]
    tables = {"server": build_server_table(server_rows, latency_rows, order),
              "client": build_client_table(client_rows, order)}
    tables["overall"] = {**_vs_overall(tables["server"], SERVER_RATE_METRICS),
                         **_vs_overall(tables["client"], client_metrics)}
    for r in tables["client"]:
        r["delta"]["affectedPct"] = None
    return tables


def version_lifespans(day_rows):
    """{x.y.z: firstDay, goneDay, inUse, firstClipped} from per-(version, day) request counts.

    goneDay is the day after the version's last day at >= GONE_SHARE of all that day's requests
    (with >= GONE_MIN of its own); inUse when that last day is within a day of the newest data;
    neither when it never met that bar. firstClipped: its first day is the data's first day, so it
    may have started earlier."""
    per, total = {}, {}
    for r in day_rows:
        v, day, n = normalize_version(r["period"]), to_iso(r["day"])[:10], r.get("posts") or 0
        per.setdefault(v, {})[day] = per.get(v, {}).get(day, 0) + n
        total[day] = total.get(day, 0) + n
    if not total:
        return {}
    first_data, last_data = min(total), max(total)
    near_end = (datetime.fromisoformat(last_data) - timedelta(days=1)).strftime("%Y-%m-%d")
    out = {}
    for v, days in per.items():
        active = [d for d, n in days.items() if n >= GONE_MIN and n / total[d] >= GONE_SHARE]
        last = max(active) if active else None
        in_use = bool(last) and last >= near_end
        gone = None if not last or in_use else \
            (datetime.fromisoformat(last) + timedelta(days=1)).strftime("%Y-%m-%d")
        first = min(days)
        out[v] = {"firstDay": first, "goneDay": gone, "inUse": in_use,
                  "firstClipped": first == first_data}
    return out


def _hour_label(h):
    return f"{int(h):02d}:00"


def hour_hotspots(by_hour, p95_all=None, env=None, start=None, end=None):
    """Hours whose failure rate (or login p95) stands well above the whole window's."""
    overall = by_hour.get("overall", {})
    tz_apl = apl_local_hour(start, end) if start and end else "hourofday(_time)"
    flags = []

    def add(hour, metric, summary, detail, where, apl):
        flags.append(_flag("hour-hotspot", summary, {"metric": metric, "hour": hour, **detail},
                           drill_cmd(env, where, f"{_APL_OCCURRED} | extend h = {tz_apl} | where h == {hour} {apl}",
                                     start, end),
                           key=f"{_hour_label(hour)} PT"))

    for table, metrics in ((by_hour["server"], SERVER_RATE_METRICS), (by_hour["client"], CLIENT_RATE_METRICS)):
        for r in table:
            for key, num, den, direction in metrics:
                base, rate = overall.get(key), r.get(key)
                if direction != "higher" or base is None or rate is None:
                    continue
                if ((r.get(num) or 0) < MIN_COUNT or (r.get(den) or 0) < MIN_DENOMINATOR
                        or rate - base < MIN_RATE_PP or (base and rate / base < REGRESSION_RATIO)):
                    continue
                label, num_noun, den_noun = METRIC_PHRASES[key]
                add(r["period"], key,
                    f"{label} {rate:.1f}% vs {base:.1f}% overall ({r.get(num):,} of {r.get(den):,} "
                    f"{den_noun} {num_noun})",
                    {"pct": rate, "overallPct": base, "count": r.get(num), "of": r.get(den)},
                    METRIC_FILTERS[key], "| summarize n=count() by bin(_time, 1d), action, version")
    for r in by_hour["server"]:
        p95 = r.get("p95")
        if p95_all and p95 and (r.get("n") or 0) >= MIN_DENOMINATOR and p95 / p95_all >= P95_RATIO:
            add(r["period"], "p95",
                f"Slowest 5% of logins took {p95 / 1000:.1f}s vs {p95_all / 1000:.1f}s overall "
                f"({r.get('n'):,} logins)",
                {"p95": p95, "overallP95": p95_all, "of": r.get("n")},
                "name == 'checkinWebapp.identify.result'",
                "| summarize p95=percentile(durationMs, 95), n=count() by bin(_time, 1d)")
    return sorted(flags, key=lambda f: f["detail"]["hour"])


# --- flags ----------------------------------------------------------------------------------
# Plain-English phrasing per rate metric: (label, numerator noun, denominator noun)
METRIC_PHRASES = {
    "loginMatchPct": ("Login match rate", "matched", "logins"),
    "srvErrPct": ("Server error rate", "errors", "requests"),
    "slowPct": ("Logins slower than 10s", "slow", "logins"),
    "errPct": ("Client error rate", "errors", "requests"),
    "lostPct": ("Lost responses", "lost", "requests"),
    "lostTimeoutPct": ("Lost responses (timed out)", "timed out", "requests"),
    "reconnectFailedPct": ("Reconnects that gave up", "gave up", "requests"),
    "affectedPct": ("Users hitting a failure", "affected", "users"),
}


def _flag(kind, summary, detail, drill, key=None, note=None):
    """`key` names the item inside a grouped flag (event name, version, PAX); `note` is a
    caveat printed under the summary."""
    f = {"kind": kind, "summary": summary, "detail": detail, "drill": drill}
    if key is not None:
        f["key"] = key
    if note:
        f["note"] = note
    return f


def _period_window(scope, period, window_start, window_end):
    """(start, end, since) for a drill-down scoped to one period."""
    if scope == "week":
        s = to_iso(period)
        return s, _week_end(s), None
    return window_start, window_end, None


def rate_regressions(table, metrics, scope, env=None, window_start=None, window_end=None):
    """Latest row vs the previous row, per rate metric, in the 'worse' direction only."""
    if len(table) < 2:
        return []
    prev, cur = table[-2], table[-1]
    flags = []
    for key, num, den, direction in metrics:
        a, b = prev.get(key), cur.get(key)
        if a is None or b is None:
            continue
        if min(prev.get(den) or 0, cur.get(den) or 0) < MIN_DENOMINATOR:
            continue  # a rate over a handful of trials compares nothing
        if direction == "higher":
            worse = ((cur.get(num) or 0) >= MIN_COUNT and b - a >= MIN_RATE_PP
                     and (a == 0 or b / a >= REGRESSION_RATIO))
        else:
            worse = a - b >= MATCH_DROP_PP
        if not worse:
            continue
        note = (f"It was 0 out of {prev.get(den):,} {METRIC_PHRASES[key][2]} before, so this may be "
                f"newly measured rather than newly broken."
                if direction == "higher" and not prev.get(num) else None)
        start, end, since = _period_window(scope, cur["period"], window_start, window_end)
        where = METRIC_FILTERS[key]
        if scope == "version":
            field = "clientVersion" if metrics is CLIENT_RATE_METRICS else "version"
            where += f" and {field} startswith '{cur['period']}'"
        label, num_noun, den_noun = METRIC_PHRASES[key]
        flags.append(_flag(
            "rate-regression",
            f"{label} {'rose' if direction == 'higher' else 'fell'} {a:.1f}% → {b:.1f}% "
            f"({_label(scope, prev['period'])} → {_label(scope, cur['period'])}; "
            f"{cur.get(num) or 0:,} of {cur.get(den) or 0:,} {den_noun} {num_noun})",
            {"metric": key, "scope": scope, "from": prev["period"], "to": cur["period"],
             "fromPct": a, "toPct": b, "count": cur.get(num), "of": cur.get(den)},
            drill_cmd(env, where, "| summarize n=count() by action, clientVersion, version",
                      start, end, since), note=note) | {"metric": key})
    return flags


def latency_regression(table, scope, env=None, window_start=None, window_end=None):
    if len(table) < 2:
        return []
    prev, cur = table[-2], table[-1]
    a, b = prev.get("p95"), cur.get("p95")
    if not a or not b or min(prev.get("n") or 0, cur.get("n") or 0) < MIN_DENOMINATOR or b / a < P95_RATIO:
        return []
    start, end, since = _period_window(scope, cur["period"], window_start, window_end)
    return [_flag("latency-regression",
                  f"Slowest 5% of logins took {a / 1000:.1f}s → {b / 1000:.1f}s "
                  f"({_label(scope, prev['period'])} → {_label(scope, cur['period'])})",
                  {"scope": scope, "fromMs": a, "toMs": b},
                  drill_cmd(env, "name endswith '.timing'",
                            "| summarize p95=percentile(totalMs, 95), n=count() by name",
                            start, end, since))]


def volume_drop(table, scope, env=None):
    """POSTs/day collapsing vs the previous period — real traffic loss or silent log loss."""
    if len(table) < 2:
        return []
    a, b = table[-2].get("postsPerDay"), table[-1].get("postsPerDay")
    if not a or b is None or b / a >= VOLUME_DROP_RATIO:
        return []
    return [_flag("volume-drop",
                  f"Requests per day fell {a:.0f} → {b:.0f} ({_label(scope, table[-2]['period'])} → "
                  f"{_label(scope, table[-1]['period'])})",
                  {"scope": scope, "from": a, "to": b},
                  drill_cmd(env, "name == 'doPost'",
                            "| summarize n=count() by bin(_time, 1d)", since="28d"),
                  note="Either fewer people used it, or events stopped reaching Axiom.")]


def new_in_latest_week(rows, latest_wk, what, env=None, where_for=None, since_iso=None):
    """Keys (event names, error texts, ...) seen only in the `latest_wk` bucket.

    `wk` is any bucket label, compared for equality only — fetch() passes 'recent'/'earlier'
    (last RECENT_DAYS vs before), tests pass week starts."""
    buckets_by_key, total = {}, {}
    for r in rows:
        buckets_by_key.setdefault(r["key"], set()).add(r["wk"])
        if r["wk"] == latest_wk:
            total[r["key"]] = total.get(r["key"], 0) + (r.get("n") or 0)
    if not any(b != latest_wk for bs in buckets_by_key.values() for b in bs):
        return []  # nothing earlier to be "new" against
    flags = []
    for key, bs in sorted(buckets_by_key.items()):
        if bs == {latest_wk}:
            where = where_for(key) if where_for else f"name == '{key}'"
            flags.append(_flag(f"new-{what}", f"{total.get(key, 0):,} time{'' if total.get(key, 0) == 1 else 's'}",
                               {"key": key, "n": total.get(key, 0)},
                               drill_cmd(env, where, "| summarize n=count() by bin(_time, 1d), version",
                                         start=since_iso or latest_wk),
                               key=key))
    return flags


def event_gaps(rows, complete_weeks, env=None):
    """Event names that all but vanish in one complete week vs their median across the others —
    a code path that stopped running, or events silently not reaching Axiom (cf. F3Go30-u7nk)."""
    complete = set(complete_weeks)
    by_key = {}
    for r in rows:
        if r["wk"] in complete:
            by_key.setdefault(r["key"], {})[r["wk"]] = r.get("n") or 0
    flags = []
    for key, counts in sorted(by_key.items()):
        for wk in complete_weeks:
            others = sorted(counts.get(w, 0) for w in complete_weeks if w != wk)
            if not others:
                continue
            baseline = others[len(others) // 2]
            n = counts.get(wk, 0)
            # Present both before and after: an event that only starts (new instrumentation) or
            # only stops (renamed/removed) partway through the window is not a gap.
            before = any(counts.get(w, 0) for w in complete_weeks if w < wk)
            after = any(counts.get(w, 0) for w in complete_weeks if w > wk)
            if before and after and baseline >= GAP_BASELINE and n < GAP_RATIO * baseline:
                end = _week_end(wk)
                name = key.split(":", 1)[0]
                flags.append(_flag("event-gap",
                                   f"{n} in {_label('week', wk)}, usually ~{baseline} a week",
                                   {"key": key, "week": wk, "n": n, "baseline": baseline},
                                   drill_cmd(env, f"name == '{name}'",
                                             "| summarize n=count() by bin(_time, 1d), version",
                                             start=wk, end=end),
                                   key=key))
    return flags


def stale_clients(client_table, current, latest_wk, env=None):
    """Client versions older than the current server version with a POST since `latest_wk`."""
    latest_wk = to_iso(latest_wk)
    flags = []
    for r in client_table:
        v = r["period"]
        if v == "(none)" or (r.get("last") and to_iso(r["last"]) < latest_wk):
            continue
        if _VERSION_RE.match(v) and version_key(v) >= version_key(current):
            continue
        flags.append(_flag("stale-client",
                           f"{r.get('posts', 0):,} requests in the window, last seen "
                           f"{_short_time(r.get('last'))}",
                           {"version": v, "posts": r.get("posts"), "last": to_iso(r.get("last"))},
                           drill_cmd(env, f"clientVersion startswith '{v}'",
                                     "| summarize n=count() by name, kind", start=latest_wk),
                           key=_label("version", v)))
    return flags


def server_errors(rows, env=None, start=None, end=None):
    flags = []
    for r in rows:
        versions = ", ".join(_label("version", v) for v in (r.get("versions") or []))
        flags.append(_flag(
            "server-error",
            f"Server error {r['name']} ×{r['n']} on {versions or '(no version)'}, last "
            f"{_short_time(r.get('last'))}",
            {**r, "first": to_iso(r.get("first")), "last": to_iso(r.get("last"))},
            drill_cmd(env, f"execId == '{(r.get('samples') or [''])[0]}'",
                      "| project _time, name, message", start=start, end=end),
            note=r.get("message") or None))
    return flags


def ingest_rejections(rows, env=None, start=None, end=None):
    """gasLogger.ingestRejected rows: Axiom refused whole batches (F3Go30-u7nk field cap) — every
    other number in the report undercounts by at least `lost` rows."""
    flags = []
    for r in rows:
        if not r.get("n"):
            continue
        flags.append(_flag("log-loss",
                           f"Axiom rejected {r['n']} log batch(es); {r.get('lost') or 0} row(s) lost "
                           f"on {_label('version', r.get('version') or '(none)')}",
                           r,
                           drill_cmd(env, "name == 'gasLogger.ingestRejected'",
                                     "| summarize n=count() by bin(_time, 1d), error", start, end),
                           note="Every count in this report is low by at least that many."))
    return flags


def repeat_failures(rows, latest_wk, env=None):
    return [_flag("repeat-failures",
                  f"{r['n']} failures ({', '.join(r.get('kinds') or [])}) during "
                  f"{', '.join(r.get('actions') or [])}",
                  r,
                  drill_cmd(env, f"f3Name == '{r['f3Name']}' and name == 'clientTelemetry'",
                            "| summarize n=count() by bin(_time, 1d), kind, action",
                            start=to_iso(latest_wk)),
                  key=r["f3Name"])
            for r in rows if (r.get("n") or 0) >= REPEAT_FAILURES]

GROUPED_KINDS = ("event-gap", "new-event", "new-client-error", "stale-client", "repeat-failures",
                 "hour-hotspot")


def group_flags(flags):
    """Collapse same-kind list-style flags into one flag with `items`, in first-seen order."""
    out, groups = [], {}
    for f in flags:
        if f["kind"] not in GROUPED_KINDS:
            out.append(f)
            continue
        g = groups.get(f["kind"])
        if g is None:
            g = groups[f["kind"]] = {"kind": f["kind"], "items": []}
            out.append(g)
        g["items"].append(f)
    for g in groups.values():
        g["summary"] = f"{len(g['items'])} item(s)"
    return out


# --- fetch (the only I/O): fetch() = SQL over the local store; fetch_live() = APL against Axiom ---
# DRIFT RISK, deliberate duplication (user-requested): fetch() and fetch_live() are two translations
# of the same metric definitions (SQL vs APL) and must change together. fetch_live() is the
# fallback activity_log.py uses when duckdb is not installed; it reaches Axiom's last 30 days only.
# Each query below is the SQL twin of the APL it replaced (F3Go30-lsoj → F3Go30-43qv). Differences
# from APL: quantile_cont interpolates where APL's percentile() is a t-digest estimate, and
# count(DISTINCT ...) is exact where dcount() is HyperLogLog. Empty string and NULL are both
# "empty" (APL isempty()); promoted columns store empties as NULL — so an empty f3Name is no longer
# counted as one distinct user (APL's dcount counted the '' group; that was an overcount of 1).
_ISO = "'%Y-%m-%dT%H:%M:%SZ'"
# APL startofweek(): Sunday 00:00 UTC (DuckDB's date_trunc('week') is Monday); dayofweek Sunday = 0.
_WEEK = f"strftime(CAST(CAST(_time AS DATE) - CAST(dayofweek(_time) AS INTEGER) AS TIMESTAMP), {_ISO})"
_HOUR = f"CAST(hour(timezone('{HOUR_TZ}', _time)) AS INTEGER)"


def _iso_t(expr):
    return f"strftime(CAST({expr} AT TIME ZONE 'UTC' AS TIMESTAMP), {_ISO})"


def _xyz(field):
    """SQL twin of normalize_version(): x.y.z, or the raw label ('legacy', '') when not numeric."""
    x = f"regexp_extract({field}, '^([0-9]+[.][0-9]+[.][0-9]+)', 1)"
    return f"COALESCE(NULLIF({x}, ''), {field}, '')"


_EVENT_KEY = "CASE WHEN COALESCE(kind, '') = '' THEN name ELSE name || ':' || kind END"
_FAILURE = "(kind IN ('error', 'lostResponse') OR (kind = 'reconnectPoll' AND outcome = 'failed'))"
_LOGIN = "name = 'checkinWebapp.identify.result'"
# When an event happened: a clientTelemetry row's own capture time (ts), else its arrival (_time).
_OCCURRED = ("CASE WHEN name = 'clientTelemetry' THEN COALESCE("
             "TRY_CAST(json_extract_string(data, '$.ts') AS TIMESTAMPTZ), _time) ELSE _time END")


def _server_sql(dim):
    return (f"SELECT {dim} AS period, count(DISTINCT CAST(_time AS DATE)) AS days, "
            f"{_iso_t('min(_time)')} AS first, {_iso_t('max(_time)')} AS last, "
            "count(*) FILTER (WHERE name = 'doPost') AS posts, "
            f"count(*) FILTER (WHERE {_LOGIN}) AS logins, "
            f"count(*) FILTER (WHERE {_LOGIN} AND matched) AS matched, "
            f"count(DISTINCT f3Name) FILTER (WHERE {_LOGIN}) AS users, "
            "count(*) FILTER (WHERE name = 'checkinWebapp.checkin') AS checkins, "
            "count(*) FILTER (WHERE name = 'signupWebapp.save') AS signupSaves, "
            "count(*) FILTER (WHERE suffix(name, '.error')) AS srvErr "
            "FROM w WHERE name IN ('doPost', 'checkinWebapp.identify.result', 'checkinWebapp.checkin', "
            "'signupWebapp.save') OR suffix(name, '.error') GROUP BY 1")


def _latency_sql(dim):
    return (f"SELECT {dim} AS period, quantile_cont(durationMs, 0.5) AS p50, "
            "quantile_cont(durationMs, 0.95) AS p95, "
            "count(*) FILTER (WHERE durationMs > 10000) AS slow, count(*) AS n "
            f"FROM w WHERE {_LOGIN} GROUP BY 1")


def _client_sql(dim):
    return (f"SELECT {dim} AS period, count(*) FILTER (WHERE name = 'doPost') AS posts, "
            "count(*) FILTER (WHERE kind = 'error') AS err, "
            "count(*) FILTER (WHERE kind = 'lostResponse') AS lost, "
            "count(*) FILTER (WHERE kind = 'lostResponse' "
            "AND json_extract_string(data, '$.ctx.mode') = 'timeout') AS lostTimeout, "
            "count(*) FILTER (WHERE kind = 'reconnectPoll' AND outcome = 'failed') AS reconnectFailed, "
            "count(DISTINCT f3Name) FILTER (WHERE name = 'clientTelemetry') AS users, "
            f"count(DISTINCT f3Name) FILTER (WHERE name = 'clientTelemetry' AND {_FAILURE}) AS affected, "
            f"{_iso_t('min(_time)')} AS first, {_iso_t('max(_time)')} AS last "
            "FROM w WHERE name = 'doPost' OR name = 'clientTelemetry' GROUP BY 1")


def _events_by(con, env, start, end, bucket_raw, bucket_td):
    """Per (event key, bucket) counts: raw events plus timing_daily roll-ups, so a week or window
    whose '.timing' rows were rolled up still shows them (no false event-gap / new-event flags)."""
    return axiom_store.rows(con, f"""
        SELECT key, wk, sum(n)::BIGINT AS n FROM (
          SELECT {_EVENT_KEY} AS key, {bucket_raw} AS wk, count(*) AS n
            FROM events WHERE env = ? AND _time >= ? AND _time < ? GROUP BY 1, 2
          UNION ALL
          SELECT {_EVENT_KEY} AS key, {bucket_td} AS wk, sum(n) AS n
            FROM timing_daily WHERE env = ? AND day >= CAST(? AS DATE) AND day <= CAST(? AS DATE)
            GROUP BY 1, 2) GROUP BY 1, 2""", [env, start, end, env, start, end])


def _window_table(con, env, start, end, view="w"):
    """Temp table `view` = env's events with _OCCURRED as _time, inside [start, end)."""
    con.execute(f"CREATE OR REPLACE TEMP TABLE {view} AS SELECT * REPLACE ({_OCCURRED} AS _time) "
                f"FROM events WHERE env = ? AND {_OCCURRED} >= ? AND {_OCCURRED} < ?", [env, start, end])


def fetch(con, env, start, end) -> dict:
    """Raw row dicts for build_report, from a store connection (axiom_store.connect)."""
    recent_start = end - timedelta(days=RECENT_DAYS)
    rs = recent_start.strftime("%Y-%m-%dT%H:%M:%SZ")

    def q(sql, s=start, view="w"):
        _window_table(con, env, s, end, view)
        return axiom_store.rows(con, sql)

    def week_or_recent(week):
        return (_WEEK, f"strftime(CAST(day - CAST(dayofweek(day) AS INTEGER) AS TIMESTAMP), {_ISO})") \
            if week else (f"CASE WHEN _time >= TIMESTAMPTZ '{rs}' THEN 'recent' ELSE 'earlier' END",
                          f"CASE WHEN day >= CAST(TIMESTAMPTZ '{rs}' AS DATE) THEN 'recent' ELSE 'earlier' END")

    ver, cver = _xyz("version"), _xyz("clientVersion")
    raw = {
        "serverByVersion": q(_server_sql(ver)), "serverByWeek": q(_server_sql(_WEEK)),
        "latencyByVersion": q(_latency_sql(ver)), "latencyByWeek": q(_latency_sql(_WEEK)),
        "clientByVersion": q(_client_sql(cver)), "clientByWeek": q(_client_sql(_WEEK)),
        # whole store history, not the window: when a version first appeared may predate it
        "clientVersionDays": q(f"SELECT {cver} AS period, strftime(CAST(_time AT TIME ZONE 'UTC' AS DATE), "
                               "'%Y-%m-%d') AS day, count(*) AS posts FROM w WHERE name = 'doPost' GROUP BY 1, 2",
                               s=datetime(2000, 1, 1, tzinfo=timezone.utc)),
        "serverByHour": q(_server_sql(_HOUR)), "latencyByHour": q(_latency_sql(_HOUR)),
        "clientByHour": q(_client_sql(_HOUR)), "latencyAll": q(_latency_sql("'all'")),
        "eventsByWeek": _events_by(con, env, start, end, *week_or_recent(True)),
        "eventsRecent": _events_by(con, env, start, end, *week_or_recent(False)),
        "clientErrorsRecent": q(
            "SELECT COALESCE(substr(errorText, 1, 120), '') AS key, "
            f"CASE WHEN _time >= TIMESTAMPTZ '{rs}' THEN 'recent' ELSE 'earlier' END AS wk, "
            "count(*) AS n FROM w WHERE name = 'clientTelemetry' AND kind = 'error' GROUP BY 1, 2"),
        "serverErrors": q(
            "SELECT name, COALESCE(substr(message, 1, 200), '') AS message, count(*) AS n, "
            f"{_iso_t('min(_time)')} AS first, {_iso_t('max(_time)')} AS last, "
            "list_sort(list(DISTINCT version) FILTER (WHERE version IS NOT NULL)) AS versions, "
            "list_sort(list(DISTINCT execId) FILTER (WHERE execId IS NOT NULL))[1:3] AS samples "
            "FROM w WHERE suffix(name, '.error') GROUP BY 1, 2 ORDER BY n DESC"),
        "ingestRejected": q(
            f"SELECT count(*) AS n, sum(CAST(\"count\" AS BIGINT))::BIGINT AS lost, {_xyz('version')} AS version "
            "FROM w WHERE name = 'gasLogger.ingestRejected' GROUP BY 3"),
        "recentStart": rs,
        "repeatFailures": q(
            "SELECT COALESCE(f3Name, '') AS f3Name, count(*) AS n, "
            "list_sort(list(DISTINCT kind) FILTER (WHERE kind IS NOT NULL)) AS kinds, "
            "list_sort(list(DISTINCT action) FILTER (WHERE action IS NOT NULL)) AS actions "
            f"FROM w WHERE name = 'clientTelemetry' AND {_FAILURE} GROUP BY 1 "
            f"HAVING count(*) >= {REPEAT_FAILURES} ORDER BY n DESC", s=max(start, recent_start)),
    }
    return raw


# --- --version-users: who is on a client version (store only, F3Go30-barg) -------------------
def fetch_version_usage(con, env, start, end) -> list:
    """Per (PAX, x.y.z clientVersion, src) counts and first/last times. src 'req' = doPost, which
    carries no f3Name — attributed through any event in the same execId that does (an unmasked
    name preferred); 'tel' = clientTelemetry, by its own f3Name and capture time."""
    _window_table(con, env, start, end)
    cver = _xyz("clientVersion")
    return axiom_store.rows(con, f"""
        WITH names AS (
          SELECT execId, COALESCE(any_value(f3Name) FILTER (WHERE f3Name NOT LIKE '%...%'),
                                  any_value(f3Name)) AS pax
            FROM w WHERE execId IS NOT NULL AND COALESCE(f3Name, '') <> '' GROUP BY 1)
        SELECT n.pax, {cver} AS version, 'req' AS src, count(*) AS n,
               {_iso_t('min(_time)')} AS first, {_iso_t('max(_time)')} AS last
          FROM w LEFT JOIN names n USING (execId) WHERE name = 'doPost' GROUP BY 1, 2
        UNION ALL
        SELECT NULLIF(f3Name, '') AS pax, {cver} AS version, 'tel' AS src, count(*) AS n,
               {_iso_t('min(_time)')} AS first, {_iso_t('max(_time)')} AS last
          FROM w WHERE name = 'clientTelemetry' GROUP BY 1, 2""")


def _mask_matches(masked, name):
    """maskPiiForLog_ (script/GasLogger.js) writes first + '...' + last; it slices UTF-16, so a name
    ending in an emoji leaves a lone surrogate, stored as U+FFFD."""
    if len(masked) != 5 or masked[1:4] != "..." or masked[0] != name[0]:
        return False
    return masked[4] == name[-1] or masked[4] == "\ufffd"


def version_users(rows, version, now_iso) -> list:
    """PAX seen on client `version`, newest last-seen first, with the newest version each was seen on."""
    version = normalize_version(version)
    names = {r["pax"] for r in rows if r.get("pax") and "..." not in r["pax"]}

    # names typed with different capitalisation are one PAX, shown by the most-used spelling
    weight = {}
    for r in rows:
        if r.get("pax") in names:
            weight[r["pax"]] = weight.get(r["pax"], 0) + (r.get("n") or 0)
    spelling = {}
    for n in sorted(weight, key=weight.get, reverse=True):
        spelling.setdefault(n.casefold(), n)

    def canon(p):
        if p and "..." in p:
            hits = {spelling[n.casefold()] for n in names if _mask_matches(p, n)}
            return hits.pop() if len(hits) == 1 else p
        return spelling.get(p.casefold(), p) if p else p

    now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    users, latest = {}, {}
    for r in rows:
        pax, v = canon(r.get("pax")), normalize_version(r.get("version"))
        if pax and (pax not in latest or r["last"] > latest[pax][1]):
            latest[pax] = (v, r["last"])
        if v != version:
            continue
        u = users.setdefault(pax, {"pax": pax or "(unknown)", "requests": 0, "telemetry": 0,
                                   "first": r["first"], "last": r["last"]})
        u["requests" if r["src"] == "req" else "telemetry"] += r.get("n") or 0
        u["first"], u["last"] = min(u["first"], r["first"]), max(u["last"], r["last"])
    out = []
    for pax, u in users.items():
        lv, ls = latest.get(pax, (None, None)) if pax else (None, None)
        last = datetime.fromisoformat(u["last"].replace("Z", "+00:00"))
        out.append({**u, "daysAgo": (now - last).days, "latestVersion": lv, "latestSeen": ls})
    return sorted(out, key=lambda u: u["last"], reverse=True)


def _pt(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(HOUR_TZ)).strftime("%m/%d %H:%M")


def render_version_users(users, version, env, start_iso, end_iso, fmt="text") -> str:
    version = normalize_version(version)
    if fmt == "json":
        return json.dumps({"env": env, "version": version, "start": start_iso, "end": end_iso,
                           "users": users}, indent=2)
    head = ["PAX", "Requests", "Telemetry", "First seen (PT)", "Last seen (PT)", "Days ago", "Now on"]

    def now_on(u):
        if not u["latestVersion"]:
            return "–"
        return "same" if u["latestVersion"] == version else \
            f"{_label('version', u['latestVersion'])} ({_pt(u['latestSeen'])[:5]})"

    rows = [[u["pax"], _num(u["requests"]), _num(u["telemetry"]), _pt(u["first"]), _pt(u["last"]),
             str(u["daysAgo"]), now_on(u)] for u in users]
    title = (f"{env.upper()} — WHO IS ON APP {_label('version', version)}   {_short_date(start_iso)} → "
             f"{_short_date(end_iso)}   ({sum(1 for u in users if u['pax'] != '(unknown)')} PAX)")
    notes = ["Requests carry no PAX name; they are matched to a PAX through other events in the same",
             "server execution. (unknown) = requests with nothing to match. Telemetry times are when it",
             "happened on the device. Now on = newest app version that PAX was seen on in the window."]
    if fmt == "md":
        out = [f"# {title}", "", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
        out += ["| " + " | ".join(r) + " |" for r in rows]
        return "\n".join(out + [""] + notes) + "\n"
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h) for i, h in enumerate(head)]
    line = lambda cells: "  " + "  ".join(c.ljust(w) if i in (0, 6) else c.rjust(w)
                                          for i, (c, w) in enumerate(zip(cells, widths))).rstrip()
    out = [title, ""] + ([line(head), "  " + "  ".join("─" * w for w in widths)] + [line(r) for r in rows]
                         if rows else ["  Nobody seen on that version in the window."])
    return "\n".join(out + ["", "NOTES"] + ["  " + n for n in notes]) + "\n"


# --- fetch_live: the original APL translation (see the drift note above) ----------------------
_APL_WEEK = "startofweek(_time)"


def apl_local_hour(start, end, tz=HOUR_TZ):
    """APL hour of day in `tz` over [start, end]. Axiom has no datetime_utc_to_local(), so the UTC
    offset is a piecewise iff() over the DST transitions inside the window, found here."""
    zone = ZoneInfo(tz)
    start, end = (t if isinstance(t, datetime) else datetime.fromisoformat(t.replace("Z", "+00:00"))
                  for t in (start, end))

    def off(t):
        return int(t.astimezone(zone).utcoffset().total_seconds() // 3600)

    pieces, t = [], start.replace(minute=0, second=0, microsecond=0)
    while t <= end:  # hour steps: a transition always lands on a UTC hour boundary for US zones
        if not pieces or off(t) != pieces[-1][1]:
            pieces.append((t, off(t)))
        t += timedelta(hours=1)
    expr = str(pieces[0][1])
    for at, o in pieces[1:]:
        expr = f"iff(_time >= datetime({at.strftime('%Y-%m-%dT%H:%M:%SZ')}), {o}, {expr})"
    return f"((hourofday(_time) + 24 + {expr}) % 24)"


def _apl_xyz(field):
    """APL twin of normalize_version(): x.y.z, or the raw label ('legacy', '') when not numeric."""
    x = f"extract('^([0-9]+[.][0-9]+[.][0-9]+)', 1, {field})"
    return f"iff(isempty({x}), {field}, {x})"


_APL_EVENT_KEY = "key = iff(isempty(kind), name, strcat(name, ':', kind))"
_APL_FAILURE = "(kind == 'error' or kind == 'lostResponse' or (kind == 'reconnectPoll' and outcome == 'failed'))"
# APL twin of _OCCURRED: place clientTelemetry rows by their capture time (ts), not arrival.
_APL_OCCURRED = "| extend _time = iff(name == 'clientTelemetry' and isnotempty(ts), todatetime(ts), _time)"


def _server_apl(dim):
    return (
        "| where name in ('doPost', 'checkinWebapp.identify.result', 'checkinWebapp.checkin', "
        "'signupWebapp.save') or name endswith '.error'"
        f" | extend period = {dim}, d = bin(_time, 1d)"
        " | summarize days = dcount(d), first = min(_time), last = max(_time),"
        " posts = countif(name == 'doPost'),"
        " logins = countif(name == 'checkinWebapp.identify.result'),"
        " matched = countif(name == 'checkinWebapp.identify.result' and matched == true),"
        " users = dcountif(f3Name, name == 'checkinWebapp.identify.result'),"
        " checkins = countif(name == 'checkinWebapp.checkin'),"
        " signupSaves = countif(name == 'signupWebapp.save'),"
        " srvErr = countif(name endswith '.error') by period")


def _latency_apl(dim):
    return ("| where name == 'checkinWebapp.identify.result'"
            f" | extend period = {dim}"
            " | summarize p50 = percentile(durationMs, 50), p95 = percentile(durationMs, 95),"
            " slow = countif(durationMs > 10000), n = count() by period")


def _client_apl(dim):
    return ("| where name == 'doPost' or name == 'clientTelemetry'"
            f" {_APL_OCCURRED} | extend period = {dim}"
            " | summarize posts = countif(name == 'doPost'),"
            " err = countif(kind == 'error'), lost = countif(kind == 'lostResponse'),"
            " lostTimeout = countif(kind == 'lostResponse' and tostring(ctx.mode) == 'timeout'),"
            " reconnectFailed = countif(kind == 'reconnectPoll' and outcome == 'failed'),"
            " users = dcountif(f3Name, name == 'clientTelemetry'),"
            f" affected = dcountif(f3Name, name == 'clientTelemetry' and {_APL_FAILURE}),"
            " first = min(_time), last = max(_time) by period")


def fetch_live(dataset, token, env, start, end) -> dict:
    """Same raw dict as fetch(), from live Axiom APL (no store, no duckdb)."""
    filters = [f"target == '{ENV_TARGET[env]}'"]
    hour = apl_local_hour(start, end)

    recent_start = end - timedelta(days=RECENT_DAYS)
    recent = f"iff(_time >= datetime({recent_start.strftime('%Y-%m-%dT%H:%M:%SZ')}), 'recent', 'earlier')"

    def q(apl, s=start):
        return run_apl(dataset, token, apl, start=s, end=end, filters=filters)[1]

    raw = {
        "serverByVersion": q(_server_apl(_apl_xyz("version"))),
        "serverByWeek": q(_server_apl(_APL_WEEK)),
        "latencyByVersion": q(_latency_apl(_apl_xyz("version"))),
        "latencyByWeek": q(_latency_apl(_APL_WEEK)),
        "clientByVersion": q(_client_apl(_apl_xyz("clientVersion"))),
        "clientByWeek": q(_client_apl(_APL_WEEK)),
        "serverByHour": q(_server_apl(hour)),
        "latencyByHour": q(_latency_apl(hour)),
        "clientByHour": q(_client_apl(hour)),
        "latencyAll": q(_latency_apl("'all'")),
        "clientVersionDays": q(f"| where name == 'doPost' | extend period = {_apl_xyz('clientVersion')}"
                               " | summarize posts = count() by period, day = bin(_time, 1d)"),
        "eventsByWeek": q(f"| extend wk = {_APL_WEEK}, {_APL_EVENT_KEY} | summarize n = count() by key, wk"),
        "eventsRecent": q(f"| extend wk = {recent}, {_APL_EVENT_KEY} | summarize n = count() by key, wk"),
        "clientErrorsRecent": q("| where name == 'clientTelemetry' and kind == 'error'"
                                f" {_APL_OCCURRED} | extend wk = {recent}, key = substring(tostring(errorText), 0, 120)"
                                " | summarize n = count() by key, wk"),
        "serverErrors": q("| where name endswith '.error'"
                          " | extend message = substring(tostring(message), 0, 200)"
                          " | summarize n = count(), first = min(_time), last = max(_time),"
                          " versions = make_set(version), samples = make_set(execId, 3) by name, message"
                          " | order by n desc"),
    }
    raw["ingestRejected"] = q("| where name == 'gasLogger.ingestRejected'"
                              f" | summarize n = count(), lost = sum(toint(['count'])) by version = {_apl_xyz('version')}")
    raw["recentStart"] = recent_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    raw["repeatFailures"] = q(f"| where name == 'clientTelemetry' and {_APL_FAILURE}"
                              f" {_APL_OCCURRED} | where _time >= datetime({recent_start.strftime('%Y-%m-%dT%H:%M:%SZ')})"
                              " | summarize n = count(), kinds = make_set(kind),"
                              " actions = make_set(action) by f3Name"
                              f" | where n >= {REPEAT_FAILURES} | order by n desc",
                              s=max(start, recent_start))
    return raw


# --- assemble -------------------------------------------------------------------------------
def build_report(raw, env, start_iso, end_iso, generated_iso) -> dict:
    for key in ("serverByWeek", "latencyByWeek", "clientByWeek"):
        for r in raw[key]:
            r["period"] = to_iso(r["period"])
    for r in raw["serverByVersion"]:
        r["period"] = r["period"] or "(none)"
    for r in raw["latencyByVersion"]:
        r["period"] = r["period"] or "(none)"
    for key in ("serverByHour", "latencyByHour", "clientByHour"):
        for r in raw.get(key, []):
            r["period"] = int(r["period"])
    for r in raw["serverByVersion"] + raw["serverByWeek"]:
        r["first"], r["last"] = to_iso(r.get("first")), to_iso(r.get("last"))

    # Server versions in deployment order (first seen), client versions in semver order.
    sv_order = [r["period"] for r in sorted(raw["serverByVersion"], key=lambda r: r["first"] or "")]
    current = sv_order[-1] if sv_order else "(none)"
    clients = merge_client_versions(raw["clientByVersion"])
    cv_order = sorted((r["period"] for r in clients), key=version_key)
    wk_order = sorted(r["period"] for r in raw["serverByWeek"])

    by_version = {"server": build_server_table(raw["serverByVersion"], raw["latencyByVersion"], sv_order),
                  "client": build_client_table(clients, cv_order)}
    life = version_lifespans(raw.get("clientVersionDays", []))
    for r in by_version["client"]:
        r.update(life.get(r["period"], {}))
    by_week = {"server": build_server_table(raw["serverByWeek"], raw["latencyByWeek"], wk_order),
               "client": build_client_table(raw["clientByWeek"], wk_order)}
    by_hour = build_hour_tables(raw.get("serverByHour", []), raw.get("latencyByHour", []),
                                raw.get("clientByHour", []))
    p95_all = next((r.get("p95") for r in raw.get("latencyAll", [])), None)
    # A week clipped by either end of the window is shown but never compared: a Sunday-only
    # "week" vs a full one reads as a volume collapse.
    complete_weeks = [w for w in wk_order if w >= start_iso and _week_end(w) <= end_iso]
    for table in by_week.values():
        for r in table:
            r["partial"] = r["period"] not in complete_weeks
    complete = {k: _add_deltas([dict(r) for r in t if not r["partial"]],
                               SERVER_RATE_METRICS if k == "server" else CLIENT_RATE_METRICS)
                for k, t in by_week.items()}
    # Version-scope regressions compare only numeric client versions, so 'legacy'/'(none)'
    # never sit in the "previous" slot.
    numeric_clients = [r for r in by_version["client"] if _VERSION_RE.match(r["period"])]
    recent = raw["recentStart"]

    flags = ingest_rejections(raw.get("ingestRejected", []), env, start_iso, end_iso)
    flags += rate_regressions(by_version["server"], SERVER_RATE_METRICS, "version", env, start_iso, end_iso)
    flags += rate_regressions(numeric_clients, CLIENT_RATE_METRICS, "version", env, start_iso, end_iso)
    flags += rate_regressions(complete["server"], SERVER_RATE_METRICS, "week", env)
    flags += rate_regressions(complete["client"], CLIENT_RATE_METRICS, "week", env)
    flags += latency_regression(by_version["server"], "version", env, start_iso, end_iso)
    flags += latency_regression(complete["server"], "week", env)
    flags += volume_drop(complete["server"], "week", env)
    flags += event_gaps([{**r, "wk": to_iso(r["wk"])} for r in raw["eventsByWeek"]], complete_weeks, env)
    flags += server_errors(raw["serverErrors"], env, start_iso, end_iso)
    flags += new_in_latest_week(
        raw["eventsRecent"], "recent", "event", env, since_iso=recent,
        where_for=lambda k: (f"name == '{k.split(':', 1)[0]}' and kind == '{k.split(':', 1)[1]}'"
                             if ":" in k else f"name == '{k}'"))
    flags += new_in_latest_week(
        raw["clientErrorsRecent"], "recent", "client-error", env, since_iso=recent,
        where_for=lambda k: f"name == 'clientTelemetry' and kind == 'error' and errorText startswith "
                            f"'{k[:40].replace(chr(39), '')}'")
    flags += stale_clients(by_version["client"], current, recent, env)
    flags += repeat_failures(raw["repeatFailures"], recent, env)
    flags += hour_hotspots(by_hour, p95_all, env, start_iso, end_iso)

    flags = group_flags(flags)
    return {"meta": {"env": env, "start": start_iso, "end": end_iso, "generated": generated_iso,
                     "currentVersion": current, "recentStart": recent},
            "byVersion": by_version, "byWeek": by_week,
            "byHour": {"server": by_hour["server"], "client": by_hour["client"],
                       "overall": {**by_hour["overall"], "p95": p95_all}},
            "flags": flags}


# --- render ---------------------------------------------------------------------------------
VIEWS = {"version": "byVersion", "week": "byWeek", "hour": "byHour"}


def select_view(report, view):
    """`--view`: the report trimmed to one view's tables (no findings); 'all' = unchanged."""
    if view == "all":
        return report
    return {"meta": report["meta"], VIEWS[view]: report[VIEWS[view]]}


def _week_end(wk):
    return to_iso((datetime.fromisoformat(wk.replace("Z", "+00:00")) + timedelta(days=7)).isoformat())


def _short_date(t):
    return datetime.fromisoformat(to_iso(t).replace("Z", "+00:00")).strftime("%b %d")


def _short_time(t):
    return "?" if not t else datetime.fromisoformat(
        to_iso(t).replace("Z", "+00:00")).strftime("%b %d %H:%M UTC")


def _label(scope, period):
    if scope == "week":
        return f"week of {_short_date(period)}"
    if scope == "hour":
        return f"{_hour_label(period)} PT"
    return f"v{period}" if _VERSION_RE.match(str(period)) else str(period)


def _fmt_pct(p):
    if p is None:
        return "–"
    return "<0.1%" if 0 < p < 0.1 else f"{p:.1f}%"


def _fmt_delta(d):
    if d is None or abs(d) < 0.05:
        return ""
    return f", {'+' if d > 0 else '−'}{abs(d):.1f}pp"


def _ms(v):
    return "–" if v is None else f"{v / 1000:.1f}s"


def _num(v):
    return f"{v or 0:,}"


# Group headings for list-style flags. {current} is the current server version.
GROUP_TITLES = {
    "event-gap": "Events that nearly vanished for a week (logging stopped, or the code stopped running)",
    "new-event": "Events first seen in the last 7 days",
    "new-client-error": "Client error messages first seen in the last 7 days",
    "stale-client": "Old app versions still sending requests (server is on v{current})",
    "repeat-failures": "PAX with 10 or more client failures in the last 7 days",
    "hour-hotspot": "Hours of the day (Pacific) with a failure rate or login p95 well above the window's",
}

# Table columns: (header, kind, fields). kind 'n' = count, 'rate' = count + percent,
# 'pct' = percent only, 'ms' = seconds, 'raw' = as-is.
SERVER_COLUMNS = [
    ("Days", "raw", "days"), ("Requests", "n", "posts"), ("Per day", "perday", "postsPerDay"),
    ("Logins", "n", "logins"), ("Matched", "pct", "loginMatchPct"), ("Users", "n", "users"),
    ("Check-ins", "n", "checkins"), ("Signups", "n", "signupSaves"),
    ("Server errors", "rate", ("srvErr", "srvErrPct")), ("Login p50", "ms", "p50"),
    ("p95", "ms", "p95"), ("Logins >10s", "rate", ("slow", "slowPct")),
]
def _first_cell(r):
    d = r.get("firstDay")
    return "–" if not d else ("<=" if r.get("firstClipped") else "") + f"{d[5:7]}/{d[8:10]}"


def _gone_cell(r):
    d = r.get("goneDay")
    return "in use" if r.get("inUse") else "–" if not d else f"{d[5:7]}/{d[8:10]}"


# App by-version only: when each version appeared and was mostly gone (F3Go30-4k27)
VERSION_LIFE_COLUMNS = [("First", "row", _first_cell), ("Mostly gone", "row", _gone_cell)]
CLIENT_COLUMNS = [
    ("Requests", "n", "posts"), ("Errors", "rate", ("err", "errPct")),
    ("Lost", "rate", ("lost", "lostPct")), ("Timed out", "rate", ("lostTimeout", "lostTimeoutPct")),
    ("Reconnect failed", "rate", ("reconnectFailed", "reconnectFailedPct")),
    ("Users", "n", "users"), ("Users w/ failure", "rate", ("affected", "affectedPct")),
]


def _text_column(header, kind, field, rows):
    if kind == "row":
        return header, [field(r) for r in rows]
    if kind == "rate":
        counts = [_num(r.get(field[0])) for r in rows]
        pcts = [_fmt_pct(r.get(field[1])) for r in rows]
        wn, wp = max(map(len, counts), default=1), max(map(len, pcts), default=1)
        return header, [f"{c:>{wn}} {p:>{wp}}" for c, p in zip(counts, pcts)]
    fmt = {"n": _num, "pct": _fmt_pct, "ms": _ms, "raw": lambda v: str(v or 0),
           "perday": lambda v: "–" if v is None else f"{v:,.0f}"}[kind]
    return header, [fmt(r.get(field)) for r in rows]


def _text_table(rows, scope, columns, indent="  "):
    first = {"week": "Week of", "hour": "Hour (PT)"}.get(scope, "Version")
    labels = [(_short_date(r["period"]) + (" *" if r.get("partial") else "")) if scope == "week"
              else _hour_label(r["period"]) if scope == "hour" else r["period"] for r in rows]
    cols = [(first, labels)] + [_text_column(h, k, f, rows) for h, k, f in columns]
    widths = [max(len(h), *(len(c) for c in cells)) if cells else len(h) for h, cells in cols]
    def line(cells):
        return indent + "  ".join(c.ljust(w) if i == 0 else c.rjust(w)
                                  for i, (c, w) in enumerate(zip(cells, widths))).rstrip()
    out = [line([h for h, _ in cols]), indent + "  ".join("─" * w for w in widths)]
    out += [line([cells[i] for _, cells in cols]) for i in range(len(rows))]
    return out


def _wrap(text, indent, width=100):
    import textwrap
    return textwrap.wrap(text, width=width, initial_indent=indent, subsequent_indent=indent)


def _finding_lines_text(i, f, current):
    num = f"{i:>2}. "
    pad = " " * len(num)
    if "items" not in f:
        out = _wrap(f["summary"], "", 100 - len(num))
        out = [num + out[0]] + [pad + l for l in out[1:]]
        if f.get("note"):
            out += _wrap(f["note"], pad + "   ")
        return out
    out = [num + GROUP_TITLES.get(f["kind"], f["kind"]).format(current=current) + f" — {len(f['items'])}"]
    w = max(len(item.get("key", "")) for item in f["items"])
    out += [f"{pad}   {item.get('key', ''):<{w}}  {item['summary']}" for item in f["items"]]
    return out


def render_text(report) -> str:
    """Plain-text report for a terminal or a saved file: findings first, then aligned tables."""
    m = report["meta"]
    flags = report.get("flags")
    out = [f"{m['env'].upper()} HEALTH REPORT   {_short_date(m['start'])} → {_short_date(m['end'])}"
           f"   (server on v{m['currentVersion']}, generated {_short_time(m['generated'])})", ""]
    if flags is not None:
        out.append(f"NEEDS ATTENTION ({len(flags)})" if flags else "NEEDS ATTENTION: nothing flagged")
        for i, f in enumerate(flags, 1):
            out += [""] + _finding_lines_text(i, f, m["currentVersion"])
    sections = [
        ("SERVER BY VERSION", "byVersion", "server", "version", SERVER_COLUMNS),
        ("APP (BROWSER) BY VERSION", "byVersion", "client", "version", VERSION_LIFE_COLUMNS + CLIENT_COLUMNS),
        ("SERVER BY WEEK", "byWeek", "server", "week", SERVER_COLUMNS),
        ("APP (BROWSER) BY WEEK", "byWeek", "client", "week", CLIENT_COLUMNS),
        ("SERVER BY HOUR (PT)", "byHour", "server", "hour", SERVER_COLUMNS),
        ("APP (BROWSER) BY HOUR (PT)", "byHour", "client", "hour", CLIENT_COLUMNS),
    ]
    for title, key, side, scope, columns in sections:
        if key in report:
            out += ["", "", title, ""] + _text_table(report[key].get(side, []), scope, columns)
    out += ["",
            "",
            "NOTES",
            "  - Percentages: matched = % of logins; errors, lost, timed out and reconnect failed = % of",
            "    that version's or week's requests; users w/ failure = % of active users.",
            "  - Weeks start Sunday (UTC). * = week still in progress: shown, but not compared.",
            "  - By hour: hour of day in Pacific time across the whole window. Traffic varies a lot by",
            "    hour, so compare the percentages, not the counts; Per day = average for that hour.",
            "  - App failures are placed by when they happened on the device, not when the report reached",
            "    the server (offline failures are relayed later, often hours or days).",
            "  - A 0 for a version that predates a metric means it was not measured, not that it was healthy.",
            "  - App versions: First = first day seen in the stored history (<= : history starts there).",
            "    Mostly gone = day after its last day at 5%+ of that day's requests; in use = still there.",
            "  - --format json adds the raw numbers and a query for each finding, for follow-up analysis."]
    return "\n".join(out) + "\n"


def _rate_cell(row, num, key, den=None):
    p = _fmt_pct(row.get(key)) + _fmt_delta(row.get("delta", {}).get(key))
    if den:
        return f"{row.get(num) or 0} / {row.get(den) or 0} ({p})"
    return f"{row.get(num) or 0} ({p})"


def _md_row_label(scope, r):
    if scope == "hour":
        return _hour_label(r["period"])
    return (f"wk {r['period'][:10]}" if scope == "week" else r["period"]) + \
        (" (partial)" if r.get("partial") else "")


def _server_md(rows, scope):
    head = ("| Period | Days | POSTs | POSTs/day | Logins matched | Users | Check-ins | Signup saves "
            "| Server errors | Login p50 / p95 | Logins >10s |")
    lines = [head, "|" + "---|" * 11]
    for r in rows:
        lines.append(
            f"| {_md_row_label(scope, r)} | {r.get('days') or 0} | {r.get('posts') or 0} "
            f"| {r.get('postsPerDay') if r.get('postsPerDay') is not None else '–'} "
            f"| {_rate_cell(r, 'matched', 'loginMatchPct', 'logins')} | {r.get('users') or 0} "
            f"| {r.get('checkins') or 0} | {r.get('signupSaves') or 0} "
            f"| {_rate_cell(r, 'srvErr', 'srvErrPct')} | {_ms(r.get('p50'))} / {_ms(r.get('p95'))} "
            f"| {_rate_cell(r, 'slow', 'slowPct')} |")
    return "\n".join(lines)


def _client_md(rows, scope):
    life = scope == "version"
    head = ("| Period " + ("| First | Mostly gone " if life else "") + "| POSTs | Errors | Lost responses "
            "| Lost (timeout) | Reconnect gave up | Active users | Users hit a failure |")
    lines = [head, "|" + "---|" * (10 if life else 8)]
    for r in rows:
        lines.append(
            f"| {_md_row_label(scope, r)} "
            + (f"| {_first_cell(r)} | {_gone_cell(r)} " if life else "")
            + f"| {r.get('posts') or 0} "
            f"| {_rate_cell(r, 'err', 'errPct')} | {_rate_cell(r, 'lost', 'lostPct')} "
            f"| {_rate_cell(r, 'lostTimeout', 'lostTimeoutPct')} "
            f"| {_rate_cell(r, 'reconnectFailed', 'reconnectFailedPct')} | {r.get('users') or 0} "
            f"| {_rate_cell(r, 'affected', 'affectedPct', 'users')} |")
    return "\n".join(lines)


def render_markdown(report) -> str:
    m = report["meta"]
    flags = report.get("flags")
    out = [f"# {m['env'].upper()} health — {m['start'][:10]} → {m['end'][:10]}",
           "",
           f"Generated {m['generated']} · current server version **{m['currentVersion']}**"
           + (f" · {len(flags)} finding(s)" if flags is not None else ""),
           "",
           "Rates show `count (percent, change vs previous row in pp)`. Client failure rates are per "
           "POST from that client version/week; users-hit is per active user. A 0 on a metric older "
           "versions never emitted means not instrumented, not healthy."]
    if flags is not None:
        out += ["", "## Needs attention", ""]
        if not flags:
            out.append("No flags raised.")
        for i, f in enumerate(flags, 1):
            if "items" not in f:
                out.append(f"{i}. {f['summary']}" + (f" — {f['note']}" if f.get("note") else ""))
                continue
            title = GROUP_TITLES.get(f["kind"], f["kind"]).format(current=m["currentVersion"])
            out.append(f"{i}. {title} ({len(f['items'])})")
            out += [f"   - `{item.get('key', '')}` — {item['summary']}" for item in f["items"]]
    sections = [
        ("byVersion", "version", "## By version", "### Server (by server `version`)",
         "### Client (by browser `clientVersion`)"),
        ("byWeek", "week", "## By week (Sunday start, UTC; partial weeks are shown but excluded from flags)",
         "### Server", "### Client"),
        ("byHour", "hour", "## By hour of day (Pacific; change is vs the whole window's rate, not the previous hour)",
         "### Server", "### Client"),
    ]
    for key, scope, title, server_title, client_title in sections:
        if key in report:
            out += ["", title, "", server_title, "", _server_md(report[key].get("server", []), scope),
                    "", client_title, "", _client_md(report[key].get("client", []), scope)]
    return "\n".join(out) + "\n"


def render_json(report) -> str:
    return json.dumps(report, indent=2, default=str)
