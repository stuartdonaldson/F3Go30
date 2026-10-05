#!/usr/bin/env python3
"""
Unit tests for tools/axiom_store.py — F3Go30-43qv (AC1-AC4, AC8).

Network-free: sync() is driven by an injected fake fetch over fixture records, and the store root
is a tempdir. Nothing here touches Axiom or the real data/axiom/.

Usage:
    /mnt/c/dev/venvs/uv1/bin/python test/test_axiom_store.py
"""

import contextlib
import io
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import axiom_store as store  # noqa: E402

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
UTC = timezone.utc


def _ts(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def rec(t, name="doPost", target="TEMPLATE", **fields):
    return {"_time": _ts(t), "name": name, "target": target, "side": "gas", "version": "2.6.7", **fields}


class FakeAxiom:
    """fetch(start, end, limit) over fixture records: ascending, [start, end), first `limit` rows."""
    def __init__(self, records):
        self.records, self.calls = records, []

    def __call__(self, start, end, limit):
        self.calls.append((start, end, limit))
        hit = [r for r in self.records if start <= _parse(r["_time"]) < end]
        return sorted(hit, key=lambda r: r["_time"])[:limit]


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class StoreCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._root, store.STORE_ROOT = store.STORE_ROOT, pathlib.Path(self._tmp.name)

    def tearDown(self):
        store.STORE_ROOT = self._root
        self._tmp.cleanup()

    def sync(self, env, records, now=NOW, **kw):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            stats = store.sync(env, now=now, fetch=FakeAxiom(records), **kw)
        self.warnings = err.getvalue()
        return stats

    def count(self, env="prod", where="true"):
        return store.connect([env]).execute(f"SELECT count(*) FROM events WHERE {where}").fetchone()[0]


class Sync(StoreCase):
    def test_second_sync_adds_nothing(self):
        recs = [rec(NOW - timedelta(hours=h), execId=f"e{h}") for h in range(1, 6)]
        first = self.sync("prod", recs)
        self.assertEqual((first["fetched"], first["added"]), (5, 5))
        second = self.sync("prod", recs)
        self.assertEqual(second["added"], 0)
        self.assertEqual(self.count(), 5)

    def test_overlap_refetches_but_only_new_rows_are_added(self):
        old = [rec(NOW - timedelta(hours=3), execId="a"), rec(NOW - timedelta(minutes=80), execId="b")]
        self.sync("prod", old, now=NOW - timedelta(hours=1))
        new = old + [rec(NOW - timedelta(minutes=30), execId="c")]
        calls = FakeAxiom(new)
        stats = store.sync("prod", now=NOW, fetch=calls)
        self.assertEqual(stats["added"], 1)
        self.assertEqual(self.count(), 3)
        # window started 1h before the watermark (the newest stored row), not at the watermark
        self.assertEqual(calls.calls[0][0], _parse(old[1]["_time"]) - store.OVERLAP)

    def test_window_ends_ten_minutes_before_now(self):
        recs = [rec(NOW - timedelta(minutes=5), execId="late"), rec(NOW - timedelta(minutes=20), execId="ok")]
        self.assertEqual(self.sync("prod", recs)["added"], 1)

    def test_chunk_that_hits_the_limit_is_split(self):
        recs = [rec(NOW - timedelta(hours=1, seconds=i), execId=f"e{i}") for i in range(12)]
        fetch = FakeAxiom(recs)
        stats = store.sync("prod", now=NOW, fetch=fetch, limit=5)
        self.assertEqual(stats["added"], 12)
        self.assertGreater(len(fetch.calls), 2)

    def test_only_the_envs_target_is_stored(self):
        recs = [rec(NOW - timedelta(hours=1), execId="p"), rec(NOW - timedelta(hours=1), target="TEST", execId="s")]
        self.sync("prod", recs)
        self.assertEqual(self.count("prod", "target = 'TEMPLATE'"), 1)
        self.assertEqual(self.count("prod"), 1)

    def test_first_sync_backfills_30_days(self):
        fetch = FakeAxiom([])
        store.sync("prod", now=NOW, fetch=fetch)
        self.assertEqual(fetch.calls[0][0], NOW - timedelta(days=30))
        self.assertEqual(len(fetch.calls), 30)  # 1-day chunks, ending now-10m

    def test_stale_watermark_warns_with_the_gap_window(self):
        self.sync("prod", [rec(NOW - timedelta(days=45), execId="old")], now=NOW - timedelta(days=45) + timedelta(hours=1))
        self.sync("prod", [], now=NOW)
        self.assertIn("WARNING", self.warnings)
        self.assertIn("gap", self.warnings)
        self.assertIn(_ts(NOW - timedelta(days=45))[:10], self.warnings)

    def test_fresh_watermark_does_not_warn(self):
        self.sync("prod", [rec(NOW - timedelta(days=2), execId="a")])
        self.sync("prod", [])
        self.assertEqual(self.warnings, "")

    def test_rows_land_in_monthly_zstd_files(self):
        self.sync("prod", [rec(datetime(2026, 9, 20, tzinfo=UTC), execId="sep"), rec(NOW - timedelta(hours=1), execId="oct")])
        files = sorted(p.name for p in (store.STORE_ROOT / "prod" / "events").glob("*.parquet"))
        self.assertEqual(files, ["2026-09.parquet", "2026-10.parquet"])
        codec = store._mem().execute(
            f"SELECT DISTINCT compression FROM parquet_metadata('{store.STORE_ROOT}/prod/events/2026-10.parquet')").fetchall()
        self.assertTrue(all(c[0].upper() == "ZSTD" for c in codec))


class Prune(StoreCase):
    def test_sit_rows_older_than_30_days_are_deleted(self):
        recs = [rec(NOW - timedelta(days=40), target="TEST", execId="old"),
                rec(NOW - timedelta(days=2), target="TEST", execId="new")]
        store._add_rows("sit", [store.to_row(r) for r in recs])
        out = store.prune("sit", NOW)
        self.assertEqual(out["pruned"], 1)
        self.assertEqual(self.count("sit"), 1)
        self.assertEqual(self.count("sit", "execId = 'new'"), 1)

    def test_prod_non_timing_rows_are_kept_forever(self):
        store._add_rows("prod", [store.to_row(rec(NOW - timedelta(days=400), execId="ancient"))])
        self.assertEqual(store.prune("prod", NOW)["pruned"], 0)
        self.assertEqual(self.count(), 1)

    def _timing(self, day, ms, name="x.timing", **kw):
        return rec(day, name=name, durationMs=ms, **kw)

    def test_prod_timing_rows_roll_up_to_daily_and_raw_rows_go(self):
        d = datetime(2026, 8, 1, 10, tzinfo=UTC)
        recs = [self._timing(d + timedelta(minutes=i), ms, execId=f"t{i}")
                for i, ms in enumerate([100, 200, 300, 400])]
        recs.append(rec(d, name="in.totalMs.timing", totalMs=900, execId="tm"))   # duration only in totalMs
        recs.append(rec(d, name="doPost", execId="keep"))
        store._add_rows("prod", [store.to_row(r) for r in recs])
        out = store.prune("prod", NOW)
        self.assertEqual((out["pruned"], out["rolled_up"]), (5, 2))
        self.assertEqual(self.count(), 1)
        td = store.rows(store.connect(["prod"]),
                        "SELECT CAST(day AS VARCHAR) d, name, kind, version, n, p50, p95, \"max\" FROM timing_daily ORDER BY name")
        self.assertEqual(td[1]["name"], "x.timing")
        self.assertEqual((td[1]["d"], td[1]["n"], td[1]["p50"], td[1]["max"]), ("2026-08-01", 4, 250.0, 400.0))
        self.assertAlmostEqual(td[1]["p95"], 385.0)
        self.assertEqual((td[0]["name"], td[0]["n"], td[0]["max"]), ("in.totalMs.timing", 1, 900.0))
        self.assertTrue((store.STORE_ROOT / "prod" / "timing_daily" / "2026-08.parquet").exists())

    def test_reprune_is_idempotent_and_replaces_rather_than_doubles(self):
        d = datetime(2026, 8, 1, 10, tzinfo=UTC)
        store._add_rows("prod", [store.to_row(self._timing(d, 100, execId="a"))])
        store.prune("prod", NOW)
        store._add_rows("prod", [store.to_row(self._timing(d, 500, execId="b"))])  # same day arrives again
        store.prune("prod", NOW)
        store.prune("prod", NOW)
        td = store.rows(store.connect(["prod"]), "SELECT n, \"max\" FROM timing_daily")
        self.assertEqual(td, [{"n": 1, "max": 500.0}])

    def test_sync_prunes_after_writing(self):
        store._add_rows("sit", [store.to_row(rec(NOW - timedelta(days=60), target="TEST", execId="old"))])
        stats = self.sync("sit", [])
        self.assertEqual(stats["pruned"], 1)


class Records(StoreCase):
    FULL = {"_time": "2026-10-05T19:34:01.316Z", "name": "clientTelemetry", "kind": "lostResponse", "target": "TEMPLATE",
            "version": "2.6.7", "matched": True, "durationMs": 63, "count": 3, "f3Name": "C...o",
            "ctx": {"attempt": 1, "elapsedMs": 14158, "httpStatus": None, "mode": "timeout"},
            "parameter": {"cmd": "checkin", "id": "abc"}, "queryString": "cmd=checkin", "swState": "x"}

    def test_round_trip_keeps_every_non_empty_field_including_nested(self):
        noisy = {**self.FULL, "empty": "", "nothing": None, "DBG": {"a": None}}
        store._add_rows("prod", [store.to_row(noisy)])
        row = store.rows(store.connect(["prod"]), "SELECT * EXCLUDE (env) FROM events")[0]
        self.assertEqual(store.to_record(row), self.FULL)

    def test_values_that_do_not_fit_a_typed_column_stay_in_data(self):
        r = {**self.FULL, "matched": "yes", "durationMs": "slow", "message": {"a": 1}}
        row = store.to_row(r)
        self.assertIsNone(row["matched"])
        self.assertIsNone(row["durationMs"])
        self.assertEqual(store.to_record(row | {"_time": r["_time"]}), r)

    def test_hash_ignores_empty_fields_so_schema_growth_does_not_duplicate(self):
        self.assertEqual(store.row_hash(self.FULL), store.row_hash({**self.FULL, "newField": None, "other": ""}))
        self.assertNotEqual(store.row_hash(self.FULL), store.row_hash({**self.FULL, "name": "other"}))

    def test_legacy_shape(self):
        store._add_rows("prod", [store.to_row(self.FULL)])
        rows = store.event_rows("prod", start=datetime(2026, 10, 5, tzinfo=UTC), end=datetime(2026, 10, 6, tzinfo=UTC))
        legacy = store.to_legacy_matches(rows)
        self.assertEqual(legacy, [{"_time": "2026-10-05T19:34:01.316Z",
                                   "data": {k: v for k, v in self.FULL.items() if k != "_time"}}])
        # the fields activity_log's classifiers read resolve through the legacy shape
        self.assertEqual(legacy[0]["data"]["ctx"]["mode"], "timeout")
        self.assertEqual(legacy[0]["data"]["parameter"]["cmd"], "checkin")
        self.assertEqual(legacy[0]["data"]["count"], 3)


class Views(StoreCase):
    def test_empty_store_gives_typed_empty_views(self):
        con = store.connect(["prod", "sit"])
        self.assertEqual(con.execute("SELECT count(*) FROM events").fetchone()[0], 0)
        self.assertEqual(con.execute("SELECT count(*) FROM timing_daily WHERE n > 0").fetchone()[0], 0)

    def test_views_span_envs_and_carry_env_column(self):
        store._add_rows("prod", [store.to_row(rec(NOW, execId="p"))])
        store._add_rows("sit", [store.to_row(rec(NOW, target="TEST", execId="s"))])
        got = dict(store.connect(["sit", "prod"]).execute("SELECT env, count(*) FROM events GROUP BY 1").fetchall())
        self.assertEqual(got, {"prod": 1, "sit": 1})

    def test_rows_returns_timestamptz_columns_as_iso_strings(self):
        # Ad-hoc `query_axiom.py --local --sql` selects _time / min(_time) directly; fetching a
        # TIMESTAMPTZ raw needs pytz (not a dependency), so rows() must convert it.
        store._add_rows("prod", [store.to_row(Records.FULL)])
        got = store.rows(store.connect(["prod"]), "SELECT _time, min(_time) AS t0, count(*) AS n FROM events GROUP BY _time")
        self.assertEqual(got, [{"_time": "2026-10-05T19:34:01.316Z", "t0": "2026-10-05T19:34:01.316Z", "n": 1}])


class DuckdbMissing(unittest.TestCase):
    """duckdb not installed: narrative / --health fall back to live Axiom; --sync / --local exit."""
    def setUp(self):
        import activity_log, activity_health, query_axiom
        self.al, self.ah, self.qa = activity_log, activity_health, query_axiom
        self._saved = store.AVAILABLE, activity_log.query, activity_log.require_axiom_credentials
        store.AVAILABLE = False
        self.queries = []

        def fake_query(dataset, token, **kw):
            self.queries.append(kw)
            return {"matches": []}
        activity_log.query = fake_query
        activity_log.require_axiom_credentials = lambda: ("ds", "tok")

    def tearDown(self):
        store.AVAILABLE, self.al.query, self.al.require_axiom_credentials = self._saved

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        old = sys.argv
        sys.argv = ["activity_log.py", *argv]
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.al.main()
        finally:
            sys.argv = old
        return out.getvalue(), err.getvalue()

    def test_narrative_warns_and_queries_live_with_the_env_filter(self):
        out, err = self.run_main("--env", "prod", "--since", "2h", "--limit", "7")
        self.assertIn("WARNING: duckdb not installed", err)
        self.assertIn("uv pip install", err)
        self.assertEqual(len(self.queries), 1)
        self.assertEqual((self.queries[0]["limit"], self.queries[0]["where"]), (21, "target == 'TEMPLATE'"))
        self.assertIn("0 activities, 2h lookback", out)

    def test_health_warns_and_uses_fetch_live(self):
        calls = []
        saved = self.ah.fetch_live
        self.ah.fetch_live = lambda *a: calls.append(a) or (_ for _ in ()).throw(StopIteration)
        try:
            with self.assertRaises(StopIteration):
                self.run_main("--env", "prod", "--health")
        finally:
            self.ah.fetch_live = saved
        self.assertEqual(calls[0][:3], ("ds", "tok", "prod"))

    def test_fetch_live_returns_the_same_keys_as_fetch(self):
        saved = self.ah.run_apl
        self.ah.run_apl = lambda *a, **k: ([], [])
        try:
            live = self.ah.fetch_live("ds", "tok", "prod", NOW - timedelta(days=30), NOW)
        finally:
            self.ah.run_apl = saved
        store.AVAILABLE = True
        with tempfile.TemporaryDirectory() as tmp:
            root, store.STORE_ROOT = store.STORE_ROOT, pathlib.Path(tmp)
            try:
                sql = self.ah.fetch(store.connect(["prod"]), "prod", NOW - timedelta(days=30), NOW)
            finally:
                store.STORE_ROOT = root
        self.assertEqual(set(live), set(sql))

    def test_sync_and_local_exit_with_the_install_command(self):
        for argv in (["--sync", "--env", "prod"], ["--local", "--sql", "select 1"]):
            old = sys.argv
            sys.argv = ["query_axiom.py", *argv]
            try:
                with self.assertRaises(SystemExit) as cm:
                    self.qa.main()
            finally:
                sys.argv = old
            self.assertIn("uv pip install", str(cm.exception))

    def test_importing_the_store_never_fails_without_duckdb(self):
        self.assertTrue(callable(store.require))
        with self.assertRaises(SystemExit):
            store.require()


if __name__ == "__main__":
    unittest.main()
