"""
axiom_store.py — local, per-environment Parquet store of Axiom log events, queried with DuckDB
(F3Go30-43qv). Axiom's free plan keeps 30 days; this keeps PROD longer and makes the reports
(activity_log.py narrative and --health) run against local files instead of the live dataset.

Self-contained on purpose (only query_axiom's credential/transport/emptiness helpers are used) so
it can move into the shared gas-axiom package later (F3Go30-i4kd).

Layout (STORE_ROOT = <repo>/data/axiom, gitignored — local only, not backed up):
    <env>/events/<YYYY-MM>.parquet          zstd; monthly files, rewritten whole when touched
    prod/timing_daily/<YYYY-MM>.parquet     daily roll-up of PROD '*.timing' rows older than 30d

Events schema: typed columns for the fields the reports read, `data JSON` holding every OTHER
non-empty field (nested objects intact), and `row_hash` (sha1 of the canonical JSON of the
record's non-empty fields incl. _time — Axiom's tabular rows carry no usable row id for dedup;
empties are excluded so a field added to the dataset schema later doesn't change a re-fetched
row's hash). to_record() rebuilds the full non-empty record; a value that doesn't fit its typed
column's type is kept in `data` instead of being dropped.

Retention (prune(), after every sync; cutoff = UTC midnight of now-30d):
    sit   rows older than the cutoff are deleted
    prod  '*.timing' rows older than the cutoff are aggregated into timing_daily and removed;
          everything else is kept forever

sync() pulls rows newer than the env's watermark (max _time in the store) minus a 1h overlap, up
to now-10m (Axiom ingest lag), in 1-day chunks; a chunk that returns exactly the row limit is
split in half recursively. A first sync backfills 30 days. Re-running is idempotent.
"""
import hashlib
import json
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timedelta, timezone

try:
    import duckdb
    AVAILABLE = True
except ModuleNotFoundError:  # the store's one non-stdlib dependency (F3Go30-43qv)
    duckdb, AVAILABLE = None, False
INSTALL_CMD = "uv pip install --python /mnt/c/dev/venvs/uv1/bin/python duckdb"


def require() -> None:
    """Exit with the install command when duckdb is missing. Importing this module never fails,
    so callers that can fall back to live Axiom (activity_log.py) check AVAILABLE instead."""
    if not AVAILABLE:
        sys.exit(f"ERROR: duckdb is not installed in this Python. Install it with:\n  {INSTALL_CMD}")

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from query_axiom import ENV_TARGET, _is_empty, _post_apl, require_axiom_credentials

STORE_ROOT = pathlib.Path(__file__).parent.parent / "data" / "axiom"
RETENTION_DAYS = 30            # Axiom free-plan retention, and the SIT / raw-timing window
OVERLAP = timedelta(hours=1)   # re-fetch this much before the watermark (late-arriving rows)
INGEST_LAG = timedelta(minutes=10)
CHUNK = timedelta(days=1)
ROW_LIMIT = 10000

_STR_COLS = ("name", "kind", "target", "side", "version", "clientVersion", "execId", "f3Name",
             "action", "outcome", "message", "errorText")
_NUM_COLS = ("durationMs", "count")
_BOOL_COLS = ("matched",)
_PROMOTED = _STR_COLS + _BOOL_COLS + _NUM_COLS
_EVENT_COLS = {"_time": "TIMESTAMPTZ", **{c: "VARCHAR" for c in _STR_COLS}, "matched": "BOOLEAN",
               "durationMs": "DOUBLE", "count": "DOUBLE", "data": "JSON", "row_hash": "VARCHAR"}
_TIMING_COLS = {"day": "DATE", "name": "VARCHAR", "kind": "VARCHAR", "version": "VARCHAR",
                "n": "BIGINT", "p50": "DOUBLE", "p95": "DOUBLE", "max": "DOUBLE"}
_TIMING_KEY = ("day", "name", "kind", "version")


# --- row <-> record -------------------------------------------------------------------------
def _iso(t: datetime) -> str:
    """UTC ISO-8601 with ms ('...01.316Z'), the shape Axiom returns; µs only when non-zero."""
    t = t.astimezone(timezone.utc)
    frac = f".{t.microsecond:06d}"
    return t.strftime("%Y-%m-%dT%H:%M:%S") + (frac[:4] if frac.endswith("000") else frac) + "Z"


def _clean(record: dict) -> dict:
    return {k: v for k, v in record.items() if not _is_empty(v)}


def row_hash(record: dict) -> str:
    return hashlib.sha1(json.dumps(_clean(record), sort_keys=True, default=str,
                                   separators=(",", ":")).encode()).hexdigest()


def _coerce(col: str, v):
    """(typed value, ok). ok False → caller keeps the raw value in `data`."""
    if col in _STR_COLS:
        return (str(v), True) if isinstance(v, (str, int, float, bool)) else (None, False)
    if col in _BOOL_COLS:
        return (v, True) if isinstance(v, bool) else (None, False)
    return (float(v), True) if isinstance(v, (int, float)) and not isinstance(v, bool) else (None, False)


def to_row(record: dict) -> dict:
    """Axiom record ({_time, ...fields}) → events-table row dict (data a dict or None)."""
    rec = _clean(record)
    row = {c: None for c in _EVENT_COLS}
    row["_time"] = rec.pop("_time")
    extra = {}
    for k, v in rec.items():
        if k in _PROMOTED:
            row[k], ok = _coerce(k, v)
            if not ok:
                extra[k] = v
        else:
            extra[k] = v
    row["data"] = extra or None  # a dict, so read_json parses it into the JSON column as an object
    row["row_hash"] = row_hash(record)
    return row


def to_record(row: dict) -> dict:
    """Events-table row → the full non-empty original record (integral floats back to ints)."""
    t = row["_time"]
    rec = {"_time": _iso(t) if isinstance(t, datetime) else str(t)}
    for c in _PROMOTED:
        v = row.get(c)
        if v is not None:
            rec[c] = int(v) if isinstance(v, float) and v.is_integer() else v
    data = row.get("data")
    rec.update(json.loads(data) if isinstance(data, str) else (data or {}))
    return rec


def to_legacy_matches(rows: list[dict]) -> list[dict]:
    """Rows → Axiom legacy shape ({"_time", "data": {...}}) as activity_log's classifiers consume."""
    out = []
    for row in rows:
        rec = to_record(row)
        out.append({"_time": rec.pop("_time"), "data": rec})
    return out


# --- files ----------------------------------------------------------------------------------
def _dir(env: str, kind: str) -> pathlib.Path:
    return pathlib.Path(STORE_ROOT) / env / kind


def _files(env: str, kind: str) -> list[pathlib.Path]:
    return sorted(_dir(env, kind).glob("*.parquet"))


def _mem() -> "duckdb.DuckDBPyConnection":
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")
    return con


def _struct(cols: dict) -> str:
    return "{" + ", ".join(f"'{c}': '{t}'" for c, t in cols.items()) + "}"


def _ddl(cols: dict) -> str:
    return ", ".join(f'"{c}" {t}' for c, t in cols.items())


def _write_month(con, table: str, path: pathlib.Path, order: str) -> None:
    """Atomically replace `path` with `table`'s rows (or remove it when the table is empty)."""
    if not con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    con.execute(f"COPY (SELECT * FROM {table} ORDER BY {order}) TO '{tmp}' "
                "(FORMAT parquet, COMPRESSION zstd)")
    os.replace(tmp, path)


def _load_month(con, table: str, cols: dict, path: pathlib.Path) -> None:
    con.execute(f"CREATE OR REPLACE TABLE {table} ({_ddl(cols)})")
    if path.exists():
        con.execute(f"INSERT INTO {table} SELECT {', '.join(chr(34) + c + chr(34) for c in cols)} "
                    f"FROM read_parquet('{path}')")


def watermark(env: str) -> datetime | None:
    files = _files(env, "events")
    if not files:
        return None
    # epoch_ms, not the TIMESTAMPTZ itself: fetching one into Python needs pytz.
    ms = _mem().execute(
        f"SELECT epoch_ms(max(_time)) FROM read_parquet({[str(f) for f in files]}, union_by_name=true)"
    ).fetchone()[0]
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def _add_rows(env: str, rows: list[dict]) -> int:
    """Merge row dicts into the monthly event files, skipping row_hashes already stored."""
    by_month = {}
    for r in rows:
        by_month.setdefault(r["_time"][:7], []).append(r)
    con, added = _mem(), 0
    for month, batch in sorted(by_month.items()):
        path = _dir(env, "events") / f"{month}.parquet"
        _load_month(con, "m", _EVENT_COLS, path)
        before = con.execute("SELECT count(*) FROM m").fetchone()[0]
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as fh:
            fh.write("\n".join(json.dumps(r) for r in batch))
        try:
            con.execute(
                "INSERT INTO m SELECT DISTINCT ON (row_hash) * FROM read_json(?, "
                f"format='newline_delimited', columns={_struct(_EVENT_COLS)}) n "
                "WHERE row_hash NOT IN (SELECT row_hash FROM m)", [fh.name])
        finally:
            os.unlink(fh.name)
        added += con.execute("SELECT count(*) FROM m").fetchone()[0] - before
        _write_month(con, "m", path, "_time")
    return added


# --- sync -----------------------------------------------------------------------------------
def _axiom_fetch(env: str):
    """Real fetch(start, end, limit) → records ascending by _time, filtered to `env`'s target."""
    dataset, token = require_axiom_credentials()

    def fetch(start: datetime, end: datetime, limit: int) -> list[dict]:
        apl = (f"['{dataset}'] | where target == '{ENV_TARGET[env]}' "
               f"| order by _time asc | limit {limit}")
        matches = _post_apl(token, apl, start, end, "legacy").get("matches", [])
        return [{"_time": m["_time"], **m.get("data", {})} for m in matches]
    return fetch


def _fetch_split(fetch, start: datetime, end: datetime, limit: int) -> list[dict]:
    """fetch(start, end), halving the window while a result hits `limit` (rows may be missing)."""
    rows = fetch(start, end, limit)
    if len(rows) < limit:
        return rows
    mid = (start + (end - start) / 2).replace(microsecond=0)
    if not start < mid < end:  # cannot split a sub-2s window further
        print(f"WARNING: {len(rows)} rows in {start:%H:%M:%S}..{end:%H:%M:%S} hit the limit; "
              "not splittable, rows may be missing", file=sys.stderr)
        return rows
    return _fetch_split(fetch, start, mid, limit) + _fetch_split(fetch, mid, end, limit)


def sync(env: str, *, now: datetime | None = None, fetch=None, limit: int = ROW_LIMIT) -> dict:
    """Pull new events for `env` into the store, then prune. → {fetched, added, pruned, rolled_up}."""
    now = now or datetime.now(timezone.utc)
    fetch = fetch or _axiom_fetch(env)
    mark = watermark(env)
    retention_start = now - timedelta(days=RETENTION_DAYS)
    if mark is not None and mark < retention_start:
        print(f"WARNING: {env} store watermark {_iso(mark)} is older than Axiom's "
              f"{RETENTION_DAYS}d retention — events {_iso(mark)} .. {_iso(retention_start)} are "
              "gone from Axiom and cannot be recovered (gap in the local store)", file=sys.stderr)
    start = (mark - OVERLAP) if mark is not None else retention_start
    end = now - INGEST_LAG
    target, rows = ENV_TARGET[env], []
    t = start
    while t < end:
        rows += _fetch_split(fetch, t, min(t + CHUNK, end), limit)
        t += CHUNK
    rows = [r for r in rows if r.get("target") == target]
    added = _add_rows(env, [to_row(r) for r in rows])
    return {"env": env, "fetched": len(rows), "added": added, **prune(env, now)}


# --- retention ------------------------------------------------------------------------------
def _cutoff(now: datetime) -> datetime:
    d = (now - timedelta(days=RETENTION_DAYS)).astimezone(timezone.utc)
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


# .timing events carry their duration as durationMs (a promoted column) or, for the multi-phase
# ones (resolveIdentity, buildMonthNavigationPayload, ...), as totalMs (kept in `data`).
_TIMING_MS = "COALESCE(durationMs, TRY_CAST(json_extract_string(data, '$.totalMs') AS DOUBLE))"


def _rollup_timing(con, cutoff: datetime) -> int:
    """Aggregate PROD raw .timing rows older than `cutoff` into timing_daily files, returning the
    number of daily rows written. Existing day+name+kind+version rows are replaced, not added to."""
    con.execute(f"""CREATE OR REPLACE TABLE agg AS
        SELECT CAST(_time AS DATE) AS day, name, COALESCE(kind, '') AS kind,
               COALESCE(version, '') AS version, count(*) AS n,
               quantile_cont({_TIMING_MS}, 0.5) AS p50, quantile_cont({_TIMING_MS}, 0.95) AS p95,
               max({_TIMING_MS}) AS "max"
        FROM old WHERE suffix(name, '.timing') GROUP BY ALL""")
    written = 0
    for month in [r[0] for r in con.execute("SELECT DISTINCT strftime(day, '%Y-%m') FROM agg").fetchall()]:
        path = _dir("prod", "timing_daily") / f"{month}.parquet"
        _load_month(con, "td", _TIMING_COLS, path)
        con.execute(f"""DELETE FROM td WHERE (day, name, kind, version) IN
                        (SELECT day, name, kind, version FROM agg WHERE strftime(day, '%Y-%m') = ?)""", [month])
        con.execute("INSERT INTO td SELECT * FROM agg WHERE strftime(day, '%Y-%m') = ?", [month])
        written += con.execute("SELECT count(*) FROM agg WHERE strftime(day, '%Y-%m') = ?", [month]).fetchone()[0]
        _write_month(con, "td", path, "day, name, kind, version")
    return written


def prune(env: str, now: datetime | None = None) -> dict:
    """Apply the retention policy (see module docstring) → {pruned, rolled_up}."""
    cutoff = _cutoff(now or datetime.now(timezone.utc))
    con, pruned, rolled = _mem(), 0, 0
    for path in _files(env, "events"):
        if path.stem > cutoff.strftime("%Y-%m"):
            continue  # whole month newer than the cutoff
        _load_month(con, "m", _EVENT_COLS, path)
        drop = "_time < ?" if env == "sit" else "_time < ? AND suffix(name, '.timing')"
        con.execute(f"CREATE OR REPLACE TABLE old AS SELECT * FROM m WHERE {drop}", [cutoff])
        n = con.execute("SELECT count(*) FROM old").fetchone()[0]
        if not n:
            continue
        if env == "prod":
            rolled += _rollup_timing(con, cutoff)
        con.execute("DELETE FROM m WHERE row_hash IN (SELECT row_hash FROM old)")
        _write_month(con, "m", path, "_time")
        pruned += n
    return {"pruned": pruned, "rolled_up": rolled}


# --- query ----------------------------------------------------------------------------------
def connect(envs=("sit", "prod")) -> "duckdb.DuckDBPyConnection":
    """In-memory DuckDB connection with views `events` and `timing_daily` over the stored files of
    `envs`, each carrying an `env` column. A view with no files yet is empty but correctly typed."""
    con = _mem()
    for view, kind, cols in (("events", "events", _EVENT_COLS), ("timing_daily", "timing_daily", _TIMING_COLS)):
        parts = []
        for env in envs:
            files = _files(env, kind)
            if files:
                parts.append(f"SELECT '{env}' AS env, * FROM read_parquet("
                             f"{[str(f) for f in files]}, union_by_name=true)")
        if not parts:
            parts = ["SELECT NULL::VARCHAR AS env, " + ", ".join(
                f'NULL::{t} AS "{c}"' for c, t in cols.items()) + " WHERE false"]
        con.execute(f"CREATE VIEW {view} AS " + " UNION ALL BY NAME ".join(parts))
    return con


def rows(con, sql: str, params=()) -> list[dict]:
    """Run `sql` → list of column-keyed dicts. TIMESTAMPTZ result columns come back as ISO strings
    (fetching one into Python needs pytz, which isn't a dependency), so ad-hoc `--sql` selecting
    `_time`, min(_time), ... works."""
    types = con.execute(f"DESCRIBE ({sql})", list(params)).fetchall()
    tz = [c for c, t, *_ in types if t == "TIMESTAMP WITH TIME ZONE"]
    if tz:
        iso = ", ".join(f"strftime(CAST(\"{c}\" AT TIME ZONE 'UTC' AS TIMESTAMP), "
                        f"'%Y-%m-%dT%H:%M:%S.%g') || 'Z' AS \"{c}\"" for c in tz)
        sql = f"SELECT * REPLACE ({iso}) FROM ({sql})"
    cur = con.execute(sql, list(params))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# _time as an ISO string: fetching a TIMESTAMPTZ into Python needs pytz, which isn't a dependency.
_ISO_SQL = "strftime(CAST(_time AT TIME ZONE 'UTC' AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%g') || 'Z'"


def event_rows(env: str, *, start: datetime, end: datetime, limit: int | None = None) -> list[dict]:
    """Stored event rows for `env` in [start, end), newest first."""
    con = connect([env])
    sql = (f"SELECT * EXCLUDE (env, _time), {_ISO_SQL} AS _time FROM events "
           "WHERE _time >= ? AND _time < ? ORDER BY events._time DESC")
    return rows(con, sql + (f" LIMIT {int(limit)}" if limit else ""), [start, end])
