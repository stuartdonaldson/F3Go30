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
            "serverByHour": [_server(5), _server(17)], "latencyByHour": [_latency(5), _latency(17)],
            "clientByHour": [_client(17), _client(5)], "latencyAll": [_latency("all")],
        }

    def test_partial_week_is_shown_but_never_flagged(self):
        report = ah.build_report(self._raw(), "prod", "2026-09-13T00:00:00Z",
                                 "2026-10-04T12:00:00Z", "2026-10-04T12:00:00Z")
        weeks = report["byWeek"]["server"]
        self.assertTrue(weeks[-1]["partial"])
        self.assertFalse(weeks[0]["partial"])
        self.assertNotIn("volume-drop", [f["kind"] for f in report["flags"]])
        self.assertIn("(partial)", ah.render_markdown(report))

    def test_by_hour_tables_are_in_hour_order(self):
        report = ah.build_report(self._raw(), "prod", "2026-09-13T00:00:00Z",
                                 "2026-10-04T12:00:00Z", "2026-10-04T12:00:00Z")
        self.assertEqual([r["period"] for r in report["byHour"]["client"]], [5, 17])
        self.assertEqual([r["period"] for r in report["byHour"]["server"]], [5, 17])
        self.assertIn("SERVER BY HOUR (PT)", ah.render_text(report))
        self.assertIn("05:00", ah.render_text(report))
        self.assertIn("By hour of day", ah.render_markdown(report))


class VersionLifespan(unittest.TestCase):
    """First day a client version shows up, and the day it is mostly gone (< 5% of a day's requests)."""

    @staticmethod
    def _days(spec):
        # spec: {version: [count per day from 2026-09-01]}
        return [{"period": v, "day": f"2026-09-{i + 1:02d}", "posts": n}
                for v, counts in spec.items() for i, n in enumerate(counts) if n]

    def test_first_and_mostly_gone(self):
        rows = self._days({"2.6.2": [100, 100, 60, 4, 1, 1, 0],
                           "2.6.3": [0, 0, 40, 96, 99, 99, 100]})
        life = ah.version_lifespans(rows)
        self.assertEqual(life["2.6.2"], {"firstDay": "2026-09-01", "goneDay": "2026-09-04",
                                         "inUse": False, "firstClipped": True})
        self.assertEqual(life["2.6.3"], {"firstDay": "2026-09-03", "goneDay": None,
                                         "inUse": True, "firstClipped": False})

    def test_build_numbers_fold_and_a_never_significant_version_has_no_gone_day(self):
        rows = self._days({"2.6.7.11": [0, 50, 50, 50], "2.6.7.12": [0, 0, 50, 50],
                           "2.4.10": [0, 2, 0, 0], "2.6.5": [100, 100, 100, 100]})
        life = ah.version_lifespans(rows)
        self.assertEqual(life["2.6.7"]["firstDay"], "2026-09-02")
        self.assertTrue(life["2.6.7"]["inUse"])
        self.assertEqual((life["2.4.10"]["goneDay"], life["2.4.10"]["inUse"]), (None, False))

    def test_shown_in_the_app_by_version_table(self):
        raw = BuildReport._raw(self)
        raw["clientVersionDays"] = self._days({"2.6.7": [10, 50, 50]})
        report = ah.build_report(raw, "prod", "2026-09-13T00:00:00Z", "2026-10-04T12:00:00Z",
                                 "2026-10-04T12:00:00Z")
        row = report["byVersion"]["client"][0]
        self.assertEqual((row["firstDay"], row["inUse"]), ("2026-09-01", True))
        text = ah.render_text(report)
        self.assertIn("Mostly gone", text)
        self.assertIn("<=09/01", text)
        self.assertIn("in use", text)
        self.assertIn("Mostly gone", ah.render_markdown(report))


class ViewSelection(unittest.TestCase):
    def test_version_view_is_only_the_by_version_tables(self):
        raw = BuildReport._raw(self)
        report = ah.build_report(raw, "prod", "2026-09-13T00:00:00Z", "2026-10-04T12:00:00Z",
                                 "2026-10-04T12:00:00Z")
        v = ah.select_view(report, "version")
        self.assertEqual(set(v), {"meta", "byVersion"})
        text = ah.render_text(v)
        self.assertIn("APP (BROWSER) BY VERSION", text)
        self.assertIn("HEALTH REPORT", text)
        for absent in ("BY WEEK", "BY HOUR", "NEEDS ATTENTION"):
            self.assertNotIn(absent, text)
        md = ah.render_markdown(v)
        self.assertIn("## By version", md)
        self.assertNotIn("By week", md)
        self.assertNotIn("Needs attention", md)
        self.assertIs(ah.select_view(report, "all"), report)


class VersionUsers(unittest.TestCase):
    """--version-users: who is on a client version, how recently, and whether they've moved on."""

    @staticmethod
    def _r(pax, version, src, n, first, last):
        return {"pax": pax, "version": version, "src": src, "n": n,
                "first": f"2026-10-{first}Z", "last": f"2026-10-{last}Z"}

    def test_masked_names_merge_and_latest_version_is_reported(self):
        r = self._r
        rows = [r("Celtic", "2.6.5", "req", 100, "01T10:00:00", "08T21:51:00"),
                r("C...c", "2.6.5", "tel", 238, "01T10:00:00", "08T18:10:00"),
                r("G...\ufffd", "2.6.5", "tel", 11, "03T21:54:00", "03T21:54:00"),
                r("Güéŕó 🌮", "2.6.5", "req", 2, "03T21:54:00", "03T21:54:00"),
                r("Güéŕó 🌮", "2.6.8", "req", 9, "08T12:00:00", "09T12:00:00"),
                r(None, "2.6.5", "req", 18, "03T01:00:00", "08T04:38:00"),
                r("Needles", "2.6.7", "req", 5, "02T00:00:00", "02T00:00:00")]
        users = ah.version_users(rows, "2.6.5", now_iso="2026-10-10T00:00:00Z")
        self.assertEqual([u["pax"] for u in users], ["Celtic", "(unknown)", "Güéŕó 🌮"])
        celtic = users[0]
        self.assertEqual((celtic["requests"], celtic["telemetry"], celtic["latestVersion"]), (100, 238, "2.6.5"))
        self.assertEqual(celtic["daysAgo"], 1)
        self.assertEqual((users[2]["latestVersion"], users[2]["latestSeen"]), ("2.6.8", "2026-10-09T12:00:00Z"))
        self.assertIsNone(users[1]["latestVersion"])

    def test_names_differing_only_in_case_are_one_pax_shown_by_the_commoner_spelling(self):
        r = self._r
        rows = [r("Credo", "2.6.5", "req", 295, "01T00:00:00", "02T00:00:00"),
                r("credo", "2.6.5", "req", 17, "03T00:00:00", "03T00:00:00")]
        users = ah.version_users(rows, "2.6.5", now_iso="2026-10-10T00:00:00Z")
        self.assertEqual([(u["pax"], u["requests"], u["last"]) for u in users],
                         [("Credo", 312, "2026-10-03T00:00:00Z")])

    def test_ambiguous_mask_is_left_as_is(self):
        r = self._r
        rows = [r("Celtic", "2.6.5", "req", 1, "01T00:00:00", "01T00:00:00"),
                r("Comic", "2.6.5", "req", 1, "01T00:00:00", "01T00:00:00"),
                r("C...c", "2.6.5", "tel", 3, "01T00:00:00", "02T00:00:00")]
        self.assertIn("C...c", [u["pax"] for u in ah.version_users(rows, "2.6.5", now_iso="2026-10-10T00:00:00Z")])

    def test_render_text_lists_users(self):
        rows = [self._r("Celtic", "2.6.5", "req", 100, "01T10:00:00", "08T21:51:00")]
        text = ah.render_version_users(ah.version_users(rows, "2.6.5", now_iso="2026-10-10T00:00:00Z"),
                                       "2.6.5", "prod", "2026-09-06T00:00:00Z", "2026-10-10T00:00:00Z")
        self.assertIn("Celtic", text)
        self.assertIn("10/08 14:51", text)   # PT
        self.assertIn("v2.6.5", text)


class HourOfDay(unittest.TestCase):
    """byHour: rates per hour, compared with the whole window, so uneven traffic doesn't skew it."""

    def _tables(self, server, client, latency=None):
        return ah.build_hour_tables(server, latency or [], client)

    def test_delta_is_against_the_whole_window_not_the_previous_hour(self):
        t = self._tables([_server(3, posts=100, srv_err=1), _server(4, posts=100, srv_err=9)],
                         [_client(3, posts=900, err=9), _client(4, posts=100, err=1)])
        s3, s4 = t["server"]
        self.assertEqual((s3["srvErrPct"], s4["srvErrPct"]), (1.0, 9.0))
        self.assertEqual((s3["delta"]["srvErrPct"], s4["delta"]["srvErrPct"]), (-4.0, 4.0))  # overall 5%
        c3, c4 = t["client"]
        self.assertEqual((c3["errPct"], c4["errPct"]), (1.0, 1.0))  # 10x the traffic, same rate
        self.assertEqual((c3["delta"]["errPct"], c4["delta"]["errPct"]), (0.0, 0.0))

    def _hotspots(self, t, p95_all=None):
        return ah.hour_hotspots(t, p95_all, env="prod", start="2026-09-01T00:00:00Z",
                                end="2026-10-01T00:00:00Z")

    def test_hour_with_a_much_higher_rate_is_a_hotspot(self):
        t = self._tables([_server(h) for h in range(6)],
                         [_client(h, posts=1000, lost=10) for h in range(5)]
                         + [_client(5, posts=200, lost=20)])
        flags = self._hotspots(t)
        self.assertEqual([(f["kind"], f["key"], f["detail"]["metric"]) for f in flags],
                         [("hour-hotspot", "05:00 PT", "lostPct")])
        self.assertIn("hourofday", flags[0]["drill"])

    def test_busy_hour_with_the_same_rate_is_not_a_hotspot(self):
        t = self._tables([_server(h) for h in range(3)],
                         [_client(0, posts=5000, lost=50), _client(1, posts=100, lost=1),
                          _client(2, posts=100, lost=1)])
        self.assertEqual(self._hotspots(t), [])

    def test_hotspot_needs_count_and_denominator(self):
        t = self._tables([_server(0), _server(1)],
                         [_client(0, posts=1000, lost=0), _client(1, posts=10, lost=3)])
        self.assertEqual(self._hotspots(t), [])  # 30% but only 10 requests

    def test_apl_local_hour_follows_dst_inside_the_window(self):
        self.assertEqual(ah.apl_local_hour("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
                         "((hourofday(_time) + 24 + -7) % 24)")
        self.assertEqual(ah.apl_local_hour("2026-10-20T00:00:00Z", "2026-11-10T00:00:00Z"),
                         "((hourofday(_time) + 24 + iff(_time >= datetime(2026-11-01T09:00:00Z), -8, -7)) % 24)")

    def test_slow_hour_p95_is_a_hotspot(self):
        t = self._tables([_server(h) for h in range(3)], [],
                         [_latency(0, p95=5000), _latency(1, p95=5000), _latency(2, p95=9000)])
        flags = self._hotspots(t, p95_all=5500)
        self.assertEqual([(f["key"], f["detail"]["metric"]) for f in flags], [("02:00 PT", "p95")])


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
    def ev(at, name, **f):
        return {"_time": at, "name": name, "target": "TEMPLATE", "side": "gas", **f}

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
            # relayed a day late: counted when it happened (ts, 01:00 PDT Oct 3), not when it arrived
            ev("2026-10-04T15:00:00.000Z", "clientTelemetry", kind="lostResponse", clientVersion="2.6.8",
               f3Name="C", ts="2026-10-03T08:00:00.000Z"),
            # --version-users attribution: a doPost has no f3Name, another event in its execId does
            ev("2026-10-04T16:00:00.000Z", "doPost", version="legacy", clientVersion="2.6.5.1", execId="e1"),
            ev("2026-10-04T16:00:01.000Z", "checkinWebapp.checkin", version="legacy", f3Name="Celtic", execId="e1"),
            ev("2026-10-04T17:00:00.000Z", "doPost", version="legacy", clientVersion="2.6.5.1", execId="e2"),
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
            "ingestRejected", "recentStart", "repeatFailures",
            "serverByHour", "latencyByHour", "clientByHour", "latencyAll", "clientVersionDays"})

    def test_client_version_days_cover_the_whole_store(self):
        got = {(r["period"], r["day"]): r["posts"] for r in self.raw["clientVersionDays"]}
        self.assertEqual(got, {("", "2026-10-03"): 2, ("", "2026-10-04"): 1, ("2.6.5", "2026-10-04"): 2})

    def test_version_usage_attributes_requests_through_exec_id(self):
        con = store.connect(["prod"])
        rows = ah.fetch_version_usage(con, "prod", self.START, self.END)
        got = {(r["pax"], r["version"], r["src"]): r["n"] for r in rows}
        self.assertEqual(got[("Celtic", "2.6.5", "req")], 1)
        self.assertEqual(got[(None, "2.6.5", "req")], 1)
        self.assertEqual(got[("C", "2.6.8", "tel")], 1)
        users = ah.version_users(rows, "2.6.5", now_iso="2026-10-05T12:00:00Z")
        self.assertEqual([u["pax"] for u in users], ["(unknown)", "Celtic"])

    def test_hours_are_pacific_local(self):
        # 10:00Z / 11:00Z / 12:00Z on Oct 3 (PDT, UTC-7) = 03 / 04 / 05 local
        self.assertEqual(self.row("serverByHour", 3)["posts"], 3)
        self.assertEqual(self.row("serverByHour", 4)["logins"], 4)
        self.assertEqual(self.row("latencyByHour", 4)["n"], 4)
        self.assertEqual(self.row("clientByHour", 5)["lost"], 1)
        self.assertEqual(self.raw["latencyAll"][0]["n"], 4)

    def test_weeks_start_sunday_and_are_iso_strings(self):
        self.assertEqual(sorted(r["period"] for r in self.raw["serverByWeek"]),
                         ["2026-09-27T00:00:00Z", "2026-10-04T00:00:00Z"])
        self.assertEqual(self.row("serverByWeek", "2026-09-27T00:00:00Z")["first"], "2026-10-03T10:00:00Z")

    def test_versions_fold_to_x_y_z(self):
        self.assertEqual({r["period"] for r in self.raw["serverByVersion"]}, {"2.6.7", "legacy"})
        self.assertEqual({r["period"] for r in self.raw["clientByVersion"]}, {"2.6.5", "2.6.7", "2.6.8", ""})  # "" = doPosts with no clientVersion
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

    def test_client_failures_count_when_they_happened_not_when_they_arrived(self):
        self.assertEqual(self.row("clientByHour", 1)["lost"], 1)
        self.assertNotIn(8, {r["period"] for r in self.raw["clientByHour"]})   # 15:00Z arrival = 08 PDT
        self.assertEqual(self.row("clientByWeek", "2026-09-27T00:00:00Z")["lost"], 2)

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
