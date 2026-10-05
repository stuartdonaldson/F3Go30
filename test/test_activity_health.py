#!/usr/bin/env python3
"""
Unit tests for tools/activity_health.py — F3Go30-lsoj (AC5).

Network-free: most tests feed fixture rows shaped like the `summarize` output that
activity_health.fetch() returns, and assert on the pure analysis layer (rates, deltas, flag
rules, rendering); FetchFromStore (F3Go30-43qv) runs the SQL fetch() over a fixture Parquet
store in a tempdir. Nothing here touches Axiom.

Usage:
    /mnt/c/dev/venvs/uv1/bin/python test/test_activity_health.py
"""

import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

import activity_health as ah  # noqa: E402
import axiom_store as store  # noqa: E402


def _server(period, posts=100, logins=50, matched=48, users=10, checkins=20, saves=5,
            srv_err=0, days=7, first="2026-09-01T00:00:00Z"):
    return {"period": period, "days": days, "first": first, "last": first, "posts": posts,
            "logins": logins, "matched": matched, "users": users, "checkins": checkins,
            "signupSaves": saves, "srvErr": srv_err}


def _latency(period, p50=3000, p95=6000, slow=0, n=50):
    return {"period": period, "p50": p50, "p95": p95, "slow": slow, "n": n}


def _client(period, posts=100, err=1, lost=2, lost_timeout=1, reconnect_failed=0,
            users=10, affected=2, first="2026-09-01T00:00:00Z", last="2026-09-07T00:00:00Z"):
    return {"period": period, "posts": posts, "err": err, "lost": lost,
            "lostTimeout": lost_timeout, "reconnectFailed": reconnect_failed,
            "users": users, "affected": affected, "first": first, "last": last}


class VersionHelpers(unittest.TestCase):
    def test_normalize_truncates_build_number(self):
        self.assertEqual(ah.normalize_version("2.6.7.11"), "2.6.7")
        self.assertEqual(ah.normalize_version("2.6.7"), "2.6.7")

    def test_normalize_keeps_non_numeric_labels(self):
        self.assertEqual(ah.normalize_version("legacy"), "legacy")
        self.assertEqual(ah.normalize_version(None), "(none)")
        self.assertEqual(ah.normalize_version(""), "(none)")

    def test_version_sort_is_numeric_with_labels_first(self):
        vs = ["2.6.10", "legacy", "2.6.9", "2.6.7"]
        self.assertEqual(sorted(vs, key=ah.version_key), ["legacy", "2.6.7", "2.6.9", "2.6.10"])

    def test_pct(self):
        self.assertEqual(ah.pct(1, 4), 25.0)
        self.assertIsNone(ah.pct(1, 0))
        self.assertIsNone(ah.pct(0, None))


class ServerTable(unittest.TestCase):
    def test_rates_and_merge_with_latency(self):
        rows = ah.build_server_table(
            [_server("2.6.6", posts=200, logins=40, matched=30, srv_err=2)],
            [_latency("2.6.6", slow=4, n=40)],
            order=["2.6.6"])
        r = rows[0]
        self.assertEqual(r["loginMatchPct"], 75.0)
        self.assertEqual(r["srvErrPct"], 1.0)
        self.assertEqual(r["slowPct"], 10.0)
        self.assertEqual(r["p95"], 6000)

    def test_order_is_respected_and_deltas_against_previous(self):
        rows = ah.build_server_table(
            [_server("b", logins=100, matched=90), _server("a", logins=100, matched=100)],
            [], order=["a", "b"])
        self.assertEqual([r["period"] for r in rows], ["a", "b"])
        self.assertIsNone(rows[0]["delta"].get("loginMatchPct"))
        self.assertEqual(rows[1]["delta"]["loginMatchPct"], -10.0)


class ClientTable(unittest.TestCase):
    def test_failure_rates_are_per_post_and_users_affected_pct(self):
        rows = ah.build_client_table(
            [_client("2.6.6", posts=200, err=4, lost=50, lost_timeout=30, reconnect_failed=2,
                     users=20, affected=5)], order=["2.6.6"])
        r = rows[0]
        self.assertEqual(r["errPct"], 2.0)
        self.assertEqual(r["lostPct"], 25.0)
        self.assertEqual(r["lostTimeoutPct"], 15.0)
        self.assertEqual(r["reconnectFailedPct"], 1.0)
        self.assertEqual(r["affectedPct"], 25.0)

    def test_rows_with_same_normalized_version_are_merged(self):
        rows = ah.merge_client_versions([_client("2.6.7", posts=10, err=1),
                                         _client("2.6.7.11", posts=5, err=2)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["period"], "2.6.7")
        self.assertEqual(rows[0]["posts"], 15)
        self.assertEqual(rows[0]["err"], 3)


class Flags(unittest.TestCase):
    def _kinds(self, flags):
        return [f["kind"] for f in flags]

    def test_rate_regression_flagged_only_above_threshold_and_min_count(self):
        client = ah.build_client_table(
            [_client("2026-09-20T00:00:00Z", posts=1000, lost=10), _client("2026-09-27T00:00:00Z", posts=1000, lost=40)],
            order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        flags = ah.rate_regressions(client, ah.CLIENT_RATE_METRICS, scope="week")
        self.assertIn("lostPct", [f["metric"] for f in flags])

        small = ah.build_client_table(
            [_client("2026-09-20T00:00:00Z", posts=100, lost=0), _client("2026-09-27T00:00:00Z", posts=100, lost=2)],
            order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        self.assertEqual(
            [f for f in ah.rate_regressions(small, ah.CLIENT_RATE_METRICS, scope="week")
             if f["metric"] == "lostPct"], [])

    def test_improvement_is_not_flagged(self):
        client = ah.build_client_table(
            [_client("2026-09-20T00:00:00Z", posts=1000, lost=300), _client("2026-09-27T00:00:00Z", posts=1000, lost=70)],
            order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        self.assertEqual(
            [f for f in ah.rate_regressions(client, ah.CLIENT_RATE_METRICS, scope="week")
             if f["metric"] == "lostPct"], [])

    def test_login_match_drop_is_a_regression(self):
        server = ah.build_server_table(
            [_server("2026-09-20T00:00:00Z", logins=100, matched=99), _server("2026-09-27T00:00:00Z", logins=100, matched=85)],
            [], order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        flags = ah.rate_regressions(server, ah.SERVER_RATE_METRICS, scope="week")
        self.assertIn("loginMatchPct", [f["metric"] for f in flags])

    def test_new_in_latest_week(self):
        rows = [{"key": "a", "wk": "2026-09-20T00:00:00Z", "n": 5},
                {"key": "a", "wk": "2026-09-27T00:00:00Z", "n": 5},
                {"key": "b", "wk": "2026-09-27T00:00:00Z", "n": 3}]
        flags = ah.new_in_latest_week(rows, latest_wk="2026-09-27T00:00:00Z", what="event")
        self.assertEqual([f["detail"]["key"] for f in flags], ["b"])

    def test_stale_clients_still_posting(self):
        client = ah.build_client_table(
            [_client("2.6.5", posts=30, last="2026-10-03T00:00:00Z"),
             _client("2.6.4", posts=3, last="2026-09-21T00:00:00Z"),
             _client("2.6.7", posts=300, last="2026-10-04T00:00:00Z")],
            order=["2.6.4", "2.6.5", "2.6.7"])
        flags = ah.stale_clients(client, current="2.6.7", latest_wk="2026-09-27T00:00:00Z")
        self.assertEqual([f["detail"]["version"] for f in flags], ["2.6.5"])

    def test_every_flag_carries_a_drilldown_command(self):
        client = ah.build_client_table(
            [_client("2026-09-20T00:00:00Z", posts=1000, lost=10), _client("2026-09-27T00:00:00Z", posts=1000, lost=40)],
            order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        for f in ah.rate_regressions(client, ah.CLIENT_RATE_METRICS, scope="week", env="prod"):
            self.assertIn("query_axiom.py", f["drill"])
            self.assertIn("--env prod", f["drill"])

    def test_event_gap_flags_a_week_that_vanishes(self):
        w = ["2026-09-06T00:00:00Z", "2026-09-13T00:00:00Z", "2026-09-20T00:00:00Z",
             "2026-09-27T00:00:00Z"]
        rows = [{"key": "checkinWebapp.identify.result", "wk": w[0], "n": 300},
                {"key": "checkinWebapp.identify.result", "wk": w[1], "n": 470},
                {"key": "checkinWebapp.identify.result", "wk": w[2], "n": 1},
                {"key": "checkinWebapp.identify.result", "wk": w[3], "n": 500},
                {"key": "rare", "wk": w[1], "n": 3}]
        flags = ah.event_gaps(rows, w, env="prod")
        self.assertEqual([(f["detail"]["key"], f["detail"]["week"]) for f in flags],
                         [("checkinWebapp.identify.result", w[2])])

    def test_event_gap_ignores_new_instrumentation(self):
        w = ["2026-09-06T00:00:00Z", "2026-09-13T00:00:00Z", "2026-09-20T00:00:00Z"]
        rows = [{"key": "clientTelemetry:lostResponse", "wk": w[2], "n": 372}]
        self.assertEqual(ah.event_gaps(rows, w), [])

    def test_same_kind_flags_are_grouped(self):
        flags = ah.group_flags([{"kind": "stale-client", "summary": "a", "detail": {}, "drill": "x"},
                                {"kind": "server-error", "summary": "b", "detail": {}, "drill": "y"},
                                {"kind": "stale-client", "summary": "c", "detail": {}, "drill": "z"}])
        self.assertEqual([f["kind"] for f in flags], ["stale-client", "server-error"])
        self.assertEqual(len(flags[0]["items"]), 2)

    def test_regression_needs_a_real_previous_denominator(self):
        server = ah.build_server_table(
            [_server("2026-09-20T00:00:00Z", logins=1, matched=1),
             _server("2026-09-27T00:00:00Z", logins=500, matched=470)],
            [], order=["2026-09-20T00:00:00Z", "2026-09-27T00:00:00Z"])
        self.assertEqual(ah.rate_regressions(server, ah.SERVER_RATE_METRICS, scope="week"), [])

    def test_ingest_rejections_flag_log_loss(self):
        flags = ah.ingest_rejections([{"version": "2.6.7", "n": 2, "lost": 40}], env="prod")
        self.assertEqual([f["kind"] for f in flags], ["log-loss"])
        self.assertIn("40 row(s) lost", flags[0]["summary"])

    def test_repeat_failures_threshold(self):
        rows = [{"f3Name": "C...o", "n": 12, "kinds": ["lostResponse"], "actions": ["identify"]},
                {"f3Name": "P...o", "n": 3, "kinds": ["error"], "actions": ["checkin"]}]
        flags = ah.repeat_failures(rows, "2026-09-27T00:00:00Z")
        self.assertEqual([f["detail"]["f3Name"] for f in flags], ["C...o"])


class BuildReport(unittest.TestCase):
    def _raw(self):
        w1, w2, w3 = "2026-09-13T00:00:00Z", "2026-09-20T00:00:00Z", "2026-10-04T00:00:00Z"
        return {
            "serverByVersion": [_server("2.6.7", first="2026-09-13T01:00:00Z")],
            "latencyByVersion": [_latency("2.6.7")],
            "serverByWeek": [_server(w1, posts=1400), _server(w2, posts=1400),
                             _server(w3, posts=100, days=1)],
            "latencyByWeek": [],
            "clientByVersion": [_client("2.6.7")],
            "clientByWeek": [_client(w1), _client(w2), _client(w3)],
            "eventsByWeek": [], "eventsRecent": [], "clientErrorsRecent": [],
            "serverErrors": [], "repeatFailures": [], "recentStart": "2026-09-27T12:00:00Z",
        }

    def test_partial_week_is_shown_but_never_flagged(self):
        report = ah.build_report(self._raw(), "prod", "2026-09-13T00:00:00Z",
                                 "2026-10-04T12:00:00Z", "2026-10-04T12:00:00Z")
        weeks = report["byWeek"]["server"]
        self.assertTrue(weeks[-1]["partial"])
        self.assertFalse(weeks[0]["partial"])
        self.assertNotIn("volume-drop", [f["kind"] for f in report["flags"]])
        self.assertIn("(partial)", ah.render_markdown(report))


class Render(unittest.TestCase):
    def test_markdown_shows_absolute_and_percent(self):
        report = {
            "meta": {"env": "prod", "start": "2026-09-06T00:00:00Z", "end": "2026-10-04T00:00:00Z",
                     "generated": "2026-10-04T18:00:00Z", "currentVersion": "2.6.7",
                     "recentStart": "2026-09-27T18:00:00Z"},
            "byVersion": {
                "server": ah.build_server_table([_server("2.6.7", logins=40, matched=30)],
                                                [_latency("2.6.7")], order=["2.6.7"]),
                "client": ah.build_client_table([_client("2.6.7", posts=200, lost=50)],
                                                order=["2.6.7"])},
            "byWeek": {"server": [], "client": []},
            "flags": [],
        }
        md = ah.render_markdown(report)
        self.assertIn("30 / 40 (75.0%)", md)
        self.assertIn("50 (25.0%)", md)
        self.assertIn("No flags", md)

    def test_text_is_default_shape_aligned_and_has_no_drill_commands(self):
        report = {
            "meta": {"env": "prod", "start": "2026-09-06T00:00:00Z", "end": "2026-10-04T00:00:00Z",
                     "generated": "2026-10-04T18:00:00Z", "currentVersion": "2.6.7",
                     "recentStart": "2026-09-27T18:00:00Z"},
            "byVersion": {
                "server": ah.build_server_table([_server("2.6.7", logins=40, matched=30)],
                                                [_latency("2.6.7")], order=["2.6.7"]),
                "client": ah.build_client_table([_client("2.6.7", posts=2000, lost=500)],
                                                order=["2.6.7"])},
            "byWeek": {"server": [], "client": []},
            "flags": ah.group_flags(
                ah.stale_clients(ah.build_client_table(
                    [_client("2.6.5", posts=30, last="2026-10-03T00:00:00Z")], order=["2.6.5"]),
                    current="2.6.7", latest_wk="2026-09-27T00:00:00Z", env="prod")),
        }
        text = ah.render_text(report)
        self.assertIn("NEEDS ATTENTION (1)", text)
        self.assertIn("Old app versions still sending requests (server is on v2.6.7)", text)
        self.assertIn("v2.6.5", text)
        self.assertIn("75.0%", text)          # login match percent
        self.assertIn("500 25.0%", text)      # count and percent side by side
        self.assertIn("2,000", text)          # thousands separator
        self.assertNotIn("query_axiom", text)
        self.assertNotIn("|", text)           # not markdown
        self.assertNotIn("query_axiom", ah.render_markdown(report))
        self.assertIn("query_axiom", ah.render_json(report))


class FetchFromStore(unittest.TestCase):
    """fetch() = SQL over the local store; same keys / row shapes build_report consumes."""
    END = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)      # a Monday; its week starts Sun Oct 4
    START = datetime(2026, 8, 1, tzinfo=timezone.utc)

    @staticmethod
    def ev(ts, name, **f):
        return {"_time": ts, "name": name, "target": "TEMPLATE", "side": "gas", **f}

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._root, store.STORE_ROOT = store.STORE_ROOT, pathlib.Path(self._tmp.name)
        ev, ident = self.ev, "checkinWebapp.identify.result"
        recs = [
            ev("2026-10-03T10:00:00.000Z", "doPost", version="2.6.7.11"),
            ev("2026-10-03T10:00:01.000Z", "doPost", version="2.6.7.11"),
            ev("2026-10-04T10:00:00.000Z", "doPost", version="2.6.7.12"),
            ev("2026-10-03T11:00:00.000Z", ident, version="2.6.7.11", f3Name="A", matched=True, durationMs=1000),
            ev("2026-10-03T11:00:01.000Z", ident, version="2.6.7.11", f3Name="B", matched=True, durationMs=3000),
            ev("2026-10-03T11:00:02.000Z", ident, version="2.6.7.11", f3Name="A", matched=False, durationMs=12000),
            ev("2026-10-04T11:00:00.000Z", ident, version="legacy", f3Name="A", matched=True, durationMs=5000),
            ev("2026-10-03T12:00:00.000Z", "clientTelemetry", kind="lostResponse", clientVersion="2.6.7.3",
               f3Name="A", action="save", ctx={"mode": "timeout"}),
            ev("2026-10-03T12:00:01.000Z", "clientTelemetry", kind="error", clientVersion="2.6.7.3",
               f3Name="B", errorText="boom " * 40),
            ev("2026-10-04T12:00:00.000Z", "clientTelemetry", kind="reconnectPoll", outcome="failed",
               clientVersion="2.6.8", f3Name="B"),
            ev("2026-10-03T13:00:00.000Z", "handleCheckinPost_.error", version="2.6.7.11", message="bad", execId="x1"),
            ev("2026-10-03T13:00:01.000Z", "handleCheckinPost_.error", version="2.6.7.11", message="bad", execId="x2"),
            ev("2026-10-04T09:00:00.000Z", "gasLogger.ingestRejected", version="2.6.7.12", count=7),
        ]
        # three old PROD timing rows: rolled up into timing_daily by prune, so only the roll-up has them
        recs += [ev("2026-08-09T10:00:0%d.000Z" % i, "x.timing", version="2.6.4", durationMs=100 * (i + 1))
                 for i in range(3)]
        store._add_rows("prod", [store.to_row(r) for r in recs])
        store.prune("prod", self.END)
        self.raw = ah.fetch(store.connect(["prod"]), "prod", self.START, self.END)

    def tearDown(self):
        store.STORE_ROOT = self._root
        self._tmp.cleanup()

    def row(self, key, period):
        return next(r for r in self.raw[key] if r["period"] == period)

    def test_same_keys_as_the_apl_fetch(self):
        self.assertEqual(set(self.raw), {
            "serverByVersion", "serverByWeek", "latencyByVersion", "latencyByWeek", "clientByVersion",
            "clientByWeek", "eventsByWeek", "eventsRecent", "clientErrorsRecent", "serverErrors",
            "ingestRejected", "recentStart", "repeatFailures"})

    def test_weeks_start_sunday_and_are_iso_strings(self):
        self.assertEqual(sorted(r["period"] for r in self.raw["serverByWeek"]),
                         ["2026-09-27T00:00:00Z", "2026-10-04T00:00:00Z"])
        self.assertEqual(self.row("serverByWeek", "2026-09-27T00:00:00Z")["first"], "2026-10-03T10:00:00Z")

    def test_versions_fold_to_x_y_z(self):
        self.assertEqual({r["period"] for r in self.raw["serverByVersion"]}, {"2.6.7", "legacy"})
        self.assertEqual({r["period"] for r in self.raw["clientByVersion"]}, {"2.6.7", "2.6.8", ""})  # "" = doPosts with no clientVersion
        self.assertEqual(self.row("serverByVersion", "2.6.7")["posts"], 3)

    def test_countif_and_dcountif(self):
        wk = self.row("serverByWeek", "2026-09-27T00:00:00Z")
        self.assertEqual((wk["posts"], wk["logins"], wk["matched"], wk["users"], wk["days"]), (2, 3, 2, 2, 1))
        self.assertEqual(wk["srvErr"], 2)
        c = self.row("clientByVersion", "2.6.7")
        self.assertEqual((c["lost"], c["lostTimeout"], c["err"], c["users"], c["affected"]), (1, 1, 1, 2, 2))

    def test_latency_percentiles_and_slow_count(self):
        lat = self.row("latencyByWeek", "2026-09-27T00:00:00Z")
        self.assertEqual((lat["n"], lat["slow"], lat["p50"]), (3, 1, 3000))
        self.assertAlmostEqual(lat["p95"], 11100.0)

    def test_events_by_week_includes_rolled_up_timing_rows(self):
        got = {(r["key"], r["wk"]): r["n"] for r in self.raw["eventsByWeek"]}
        self.assertEqual(got[("x.timing", "2026-08-09T00:00:00Z")], 3)
        self.assertEqual(got[("clientTelemetry:lostResponse", "2026-09-27T00:00:00Z")], 1)
        self.assertEqual(got[("doPost", "2026-09-27T00:00:00Z")], 2)

    def test_errors_and_log_loss(self):
        err = self.raw["serverErrors"][0]
        self.assertEqual((err["name"], err["message"], err["n"], err["versions"], err["samples"]),
                         ("handleCheckinPost_.error", "bad", 2, ["2.6.7.11"], ["x1", "x2"]))
        self.assertEqual(self.raw["ingestRejected"], [{"n": 1, "lost": 7, "version": "2.6.7"}])
        self.assertEqual(len(self.raw["clientErrorsRecent"][0]["key"]), 120)

    def test_build_report_runs_on_it(self):
        fmt = "%Y-%m-%dT%H:%M:%SZ"
        report = ah.build_report(self.raw, "prod", self.START.strftime(fmt), self.END.strftime(fmt), "2026-10-05T12:00:00Z")
        self.assertEqual(report["meta"]["currentVersion"], "legacy")
        self.assertTrue(any(f["kind"] == "log-loss" for f in report["flags"]))
        self.assertIn("HEALTH REPORT", ah.render_text(report))

    def test_empty_store_fetches_empty_rows(self):
        store.STORE_ROOT = pathlib.Path(self._tmp.name) / "none"
        raw = ah.fetch(store.connect(["prod"]), "prod", self.START, self.END)
        self.assertEqual(raw["serverByWeek"], [])
        self.assertEqual(raw["eventsByWeek"], [])


if __name__ == "__main__":
    unittest.main()
