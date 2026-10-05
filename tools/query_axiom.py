#!/usr/bin/env python3
"""
query_axiom.py — Query the Axiom dataset (GTaskSheet-x94a/9dss/aa7j/ecs1 logging-taxonomy work)
without re-deriving the APL request shape and auth every time.

Reads axiomQueryToken + axiomDataset from local.settings.json (same settings file every other
test/script in this repo uses — see tests/conftest.py:_load_settings()). Never prints the token.

Usage:
    python tools/query_axiom.py [--limit N] [--since DURATION | --start ISO [--end ISO]]
                                 [--env sit|prod] [--side gas|python] [--name SUBSTRING]
                                 [--where APL_EXPR] [--apl PIPELINE]
                                 [--format table|tsv|json|jsonl] [--raw [PATH]]

Examples:
    python tools/query_axiom.py                          # last 200 events, last 24h
    python tools/query_axiom.py --limit 50 --since 2h
    python tools/query_axiom.py --side python
    python tools/query_axiom.py --name sync.warn --env prod
    python tools/query_axiom.py --where "execId == 'b962...'"
    python tools/query_axiom.py --raw /tmp/axiom_dump.json   # also dump full JSON for offline analysis

    # Aggregate server-side (no row cap) — e.g. PROD events per deployed version:
    python tools/query_axiom.py --env prod --since 14d --format tsv \\
        --apl "| summarize n=count(), first=min(_time) by version"

    # Before/after a deploy, absolute window, machine-readable:
    python tools/query_axiom.py --env prod --start 2026-09-20 --end 2026-09-30T12:00:00Z \\
        --format jsonl --apl "| where name == 'clientTelemetry' and kind == 'error' \\
        | summarize n=count() by version, clientVersion, action"

Local store (tools/axiom_store.py, F3Go30-43qv — Parquet under data/axiom/, queried with DuckDB):
    python tools/query_axiom.py --sync --env prod       # pull new events into the store, then prune
    python tools/query_axiom.py --local --sql "select name, count(*) n from events group by 1 order by 2 desc"
        # views: events, timing_daily (PROD only), each with an `env` column; --env omitted = both

Field names are bare (`execId`, `kind`, `target`), NOT `data.`-prefixed — `data.x` fails with a
400 "invalid field". The `data` wrapper only appears in the legacy JSON response (--raw).

--apl takes an APL pipeline (starting with `|`); the dataset and any --env/--side/--name/--where
filters are prepended, and no order/limit is appended. --format controls stdout: `table`
(default, human), or `tsv`/`json`/`jsonl` (column-keyed records, no banner — for scripts).

DURATION accepts <N>s / <N>m / <N>h / <N>d (e.g. 30m, 2h, 1d). Default: 24h.
--start/--end accept ISO-8601 (a bare date means midnight UTC); --end defaults to now.
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

_SETTINGS_PATH = pathlib.Path(__file__).parent.parent / "local.settings.json"
_DURATION_RE = re.compile(r"^(\d+)([smhd])$")
_APL_URL = "https://api.axiom.co/v1/datasets/_apl?format="

# --env → the `target` field GasLogger stamps on every event (see tools/manage-deployments.js).
ENV_TARGET = {"sit": "TEST", "prod": "TEMPLATE"}


def _load_settings() -> dict:
    if not _SETTINGS_PATH.exists():
        raise FileNotFoundError(
            "local.settings.json not found. Copy local.settings.example.json and fill in IDs."
        )
    return json.loads(_SETTINGS_PATH.read_text())


def axiom_credentials(settings: dict | None = None) -> tuple[str, str] | None:
    """(dataset, queryToken) from local.settings.json, or None when either is unset."""
    settings = _load_settings() if settings is None else settings
    dataset, token = settings.get("axiomDataset"), settings.get("axiomQueryToken")
    return (dataset, token) if dataset and token else None


def require_axiom_credentials() -> tuple[str, str]:
    """axiom_credentials() for CLI entry points: prints the standard error and exits 1 if unset."""
    creds = axiom_credentials()
    if not creds:
        print("ERROR: axiomDataset / axiomQueryToken not set in local.settings.json", file=sys.stderr)
        sys.exit(1)
    return creds


def _parse_duration(spec: str) -> timedelta:
    m = _DURATION_RE.match(spec.strip())
    if not m:
        raise ValueError(f"Bad --since value '{spec}', expected e.g. 30m, 2h, 1d")
    n, unit = int(m.group(1)), m.group(2)
    return {"s": timedelta(seconds=n), "m": timedelta(minutes=n),
            "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]


def _parse_instant(spec: str) -> datetime:
    dt = datetime.fromisoformat(spec.strip().replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _window(since: timedelta | None, start: datetime | None,
            end: datetime | None) -> tuple[datetime, datetime]:
    end = end or datetime.now(timezone.utc)
    return (start or end - (since or timedelta(hours=24))), end


def _filters(side: str | None = None, name: str | None = None, where: str | None = None,
             env: str | None = None) -> list[str]:
    filters = []
    if env:
        filters.append(f"target == '{ENV_TARGET[env]}'")
    if side:
        filters.append(f"side == '{side}'")
    if name:
        filters.append(f"name contains '{name}'")
    if where:
        filters.append(where)
    return filters


def _post_apl(token: str, apl: str, start: datetime, end: datetime, fmt: str) -> dict:
    body = {
        "apl": apl,
        "startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    req = urllib.request.Request(
        _APL_URL + fmt,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Axiom query failed ({e.code}): {e.read().decode()[:500]}") from e


def query(dataset: str, token: str, *, limit: int, since: timedelta,
          side: str | None, name: str | None, where: str | None,
          start: datetime | None = None, end: datetime | None = None) -> dict:
    """Newest-first raw events, legacy response shape ({"matches": [{_time, data}, ...]})."""
    # `where` must precede `order by`/`limit` in the pipeline, otherwise filtering
    # would apply after the top-N cut and could return fewer than `limit` rows.
    apl = f"['{dataset}']"
    for f in _filters(side, name, where):
        apl += f" | where {f}"
    apl += f" | order by _time desc | limit {limit}"
    return _post_apl(token, apl, *_window(since, start, end), "legacy")


def run_apl(dataset: str, token: str, pipeline: str, *, start: datetime, end: datetime,
            filters: list[str] = ()) -> tuple[list[str], list[dict]]:
    """Run an arbitrary APL pipeline (aggregations included) → (columns, row dicts)."""
    pipeline = pipeline.strip()
    if not pipeline.startswith("|"):
        pipeline = "| " + pipeline
    apl = f"['{dataset}']" + "".join(f" | where {f}" for f in filters) + " " + pipeline
    table = _post_apl(token, apl, start, end, "tabular")["tables"][0]
    columns = [f["name"] for f in table["fields"]]
    return columns, [dict(zip(columns, row)) for row in zip(*table["columns"])]


def _is_empty(v) -> bool:
    """True for None/''/{} and for dicts whose values are all themselves empty — catches fields
    like a stray DBG:{a:None,b:None} that schema-backfill adds to every row once any event has
    ever set it, which `v not in (None, "", {})` alone doesn't (a dict of Nones isn't `{}`)."""
    if v in (None, "", {}):
        return True
    if isinstance(v, dict):
        return all(_is_empty(x) for x in v.values())
    return False


def _event_records(matches: list[dict]) -> tuple[list[str], list[dict]]:
    """Legacy raw events → (columns, flat records of non-empty fields), columns in first-seen order."""
    records = [{"_time": m["_time"], **{k: v for k, v in m.get("data", {}).items() if not _is_empty(v)}}
               for m in matches]
    columns = list(dict.fromkeys(k for r in records for k in r))
    return columns, records


def _print_table(matches: list[dict]) -> None:
    for m in matches:
        data = m.get("data", {})
        nonnull = {k: v for k, v in data.items() if not _is_empty(v)}
        side = nonnull.pop("side", "?")
        name = nonnull.pop("name", "?")
        nonnull.pop("version", None)
        nonnull.pop("caller", None)
        detail = " ".join(f"{k}={v}" for k, v in nonnull.items())
        print(f"{m['_time']}  {side:<6} {name:<32} {detail}")


def _cell(v) -> str:
    if v is None:
        return ""
    return json.dumps(v) if isinstance(v, (dict, list)) else str(v)


def _emit(columns: list[str], records: list[dict], fmt: str) -> None:
    if fmt == "json":
        print(json.dumps(records, indent=2, default=str))
    elif fmt == "jsonl":
        for r in records:
            print(json.dumps(r, default=str))
    elif fmt == "tsv":
        print("\t".join(columns))
        for r in records:
            print("\t".join(_cell(r.get(c)).replace("\t", " ").replace("\n", " ") for c in columns))
    else:  # table, for --apl results
        cells = [[_cell(r.get(c)) for c in columns] for r in records]
        widths = [max([len(c)] + [len(row[i]) for row in cells]) for i, c in enumerate(columns)]
        for row in [columns] + cells:
            print("  ".join(v.ljust(w) for v, w in zip(row, widths)).rstrip())


def _store_main(args, parser) -> int:
    import axiom_store
    axiom_store.require()  # store operations: no live fallback possible
    if args.sync:
        if not args.env:
            parser.error("--sync requires --env sit|prod")
        print(json.dumps(axiom_store.sync(args.env)))
        return 0
    if not args.sql:
        parser.error("--local requires --sql")
    rows = axiom_store.rows(axiom_store.connect([args.env] if args.env else sorted(ENV_TARGET)), args.sql)
    _emit(list(rows[0]) if rows else [], rows, args.format)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", "-n", type=int, default=200, help="Max events to return (default: 200; ignored with --apl)")
    window = parser.add_mutually_exclusive_group()
    window.add_argument("--since", help="How far back to look, e.g. 30m, 2h, 1d (default: 24h)")
    window.add_argument("--start", help="Absolute window start, ISO-8601 (bare date = midnight UTC)")
    parser.add_argument("--end", help="Absolute window end, ISO-8601 (default: now)")
    parser.add_argument("--env", choices=sorted(ENV_TARGET), help="Filter to SIT (TEST) or PROD (TEMPLATE)")
    parser.add_argument("--side", choices=["gas", "python"], help="Filter to one side")
    parser.add_argument("--name", help="Filter to event names containing this substring")
    parser.add_argument("--where", help="Raw APL `where` expression, bare field names, e.g. \"execId == 'xyz'\"")
    parser.add_argument("--apl", metavar="PIPELINE",
                        help="APL pipeline to run after the filters, e.g. \"| summarize count() by name\"")
    parser.add_argument("--format", choices=["table", "tsv", "json", "jsonl"], default="table",
                        help="stdout format (default: table, human-readable)")
    parser.add_argument("--sync", action="store_true",
                        help="Sync --env's events into the local store (data/axiom/), then prune; prints stats")
    parser.add_argument("--local", action="store_true",
                        help="Run --sql against the local store (views events, timing_daily) instead of Axiom")
    parser.add_argument("--sql", help="SELECT to run with --local, using --format")
    parser.add_argument("--raw", nargs="?", const="-", metavar="PATH",
                        help="Dump full JSON response (to PATH, or stdout if no PATH given)")
    args = parser.parse_args()

    if args.sync or args.local:
        return _store_main(args, parser)

    dataset, token = require_axiom_credentials()
    since = _parse_duration(args.since) if args.since else None
    start = _parse_instant(args.start) if args.start else None
    end = _parse_instant(args.end) if args.end else None
    lookback = args.since or (f"{args.start} → {args.end or 'now'}" if args.start else "24h")

    if args.apl:
        win_start, win_end = _window(since, start, end)
        columns, records = run_apl(dataset, token, args.apl, start=win_start, end=win_end,
                                   filters=_filters(args.side, args.name, args.where, args.env))
        if args.format == "table":
            print(f"{len(records)} rows, {lookback}, dataset={dataset}")
        _emit(columns, records, args.format)
        return 0

    where = " and ".join(_filters(where=args.where, env=args.env)) or None
    result = query(
        dataset, token,
        limit=args.limit, since=since, start=start, end=end,
        side=args.side, name=args.name, where=where,
    )
    matches = result.get("matches", [])

    if args.raw is not None:
        text = json.dumps(result, indent=2)
        if args.raw == "-":
            print(text)
        else:
            pathlib.Path(args.raw).write_text(text)
            print(f"Wrote {len(matches)} events to {args.raw}", file=sys.stderr)
        return 0

    if args.format == "table":
        print(f"{len(matches)} events, {lookback} lookback, dataset={dataset}")
        _print_table(matches)
    else:
        _emit(*_event_records(matches), args.format)
    return 0


if __name__ == "__main__":
    sys.exit(main())
