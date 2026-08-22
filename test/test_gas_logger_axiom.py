#!/usr/bin/env python3
"""
GasLogger live-pipe check — F3Go30-kq0t

Confirms the GAS -> logging-sink pipe is actually delivering data in a given
environment. Passive by design: it does NOT trigger a dedicated GAS execution
(that used to mean driving the Apps Script editor via Playwright, which is what
made the old tests/playwright/gaslogger.spec.js flaky/slow — see kq0t). Instead
it checks for *recent* log activity, on the assumption that this runs as part of
a regression pass that already exercises the webapp (checkin/signup/dashboard
etc., each wrapped in GasLogger.run()) shortly before this check does.

GasLogger.flush() (script/GasLogger.js) picks its sink itself: Axiom exclusively
when AXIOM_TOKEN + AXIOM_DATASET script properties are both set on the target
script project, else the Drive LogFile channel (ADR-007). This script mirrors
that precedence using the *local* proxy for the same config -- local.settings.json's
axiomDataset/axiomQueryToken (query_axiom.py already gates on the same pair) --
since there is no reliable remote way to read GAS Script Properties without
`clasp run`, which this project's GCP wiring does not support today (see
docs/deployment-model.md Step F).

Usage:
    python test/test_gas_logger_axiom.py [--env sit|prod] [--since 15m] [--min-count 1]

Exits 0 on pass, 1 on failure (no recent entries found for the sink in use).
"""

import argparse
import sys
import time
from pathlib import Path

TOOLS_DIR = Path(__file__).parent.parent / 'tools'
sys.path.insert(0, str(TOOLS_DIR))
from query_axiom import query, _load_settings, _parse_duration  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from log_channel import collect_local_log_entries  # noqa: E402

# Matches script/version.js's APP_DEPLOY_TARGET values (tools/manage-deployments.js
# writes one or the other on push).
_TARGET_BY_ENV = {'sit': 'TEST', 'prod': 'TEMPLATE'}


def check_axiom(dataset: str, token: str, since: str, target: str, min_count: int) -> bool:
    result = query(
        dataset, token,
        limit=50, since=_parse_duration(since),
        side='gas', name=None, where=f"target == '{target}'",
    )
    matches = result.get('matches', [])
    print(f"Axiom: {len(matches)} 'gas' side row(s) for target={target!r} in the last {since}")
    if len(matches) < min_count:
        print(f"FAIL: expected at least {min_count}, found {len(matches)}")
        return False
    latest = matches[0]
    data = latest.get('data', {})
    print(f"  latest: {latest.get('_time')}  name={data.get('name')}  version={data.get('version')}")
    return True


def check_drive(local_path: str, prefix: str, since: str, min_count: int) -> bool:
    scan_path = str(Path(local_path) / prefix)
    window_seconds = _parse_duration(since).total_seconds()
    cutoff = time.time() - window_seconds
    files_map = collect_local_log_entries(scan_path)
    recent = [
        e for entries in files_map.values() for e in entries
        if _entry_epoch(e.get('ts')) >= cutoff
    ]
    print(f"Drive: {len(recent)} entr(y/ies) in {scan_path!r} in the last {since}")
    if len(recent) < min_count:
        print(f"FAIL: expected at least {min_count}, found {len(recent)}")
        return False
    return True


def _entry_epoch(ts: str) -> float:
    from datetime import datetime, timezone
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError):
        return 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--env', choices=['sit', 'prod'], default='sit')
    parser.add_argument('--since', default='15m', help='Lookback window, e.g. 15m, 1h (default: 15m)')
    parser.add_argument('--min-count', type=int, default=1)
    args = parser.parse_args()

    settings = _load_settings()
    dataset = settings.get('axiomDataset')
    token = settings.get('axiomQueryToken')
    target = _TARGET_BY_ENV[args.env]

    if dataset and token:
        print(f"Sink: Axiom (dataset={dataset})")
        ok = check_axiom(dataset, token, args.since, target, args.min_count)
    else:
        local_path = settings.get('GAS_LOGGER_LOCAL_PATH')
        prefix = settings.get('GAS_LOGGER_PROJECT_PREFIX', 'F3Go30')
        if not local_path:
            print('ERROR: neither Axiom (axiomDataset/axiomQueryToken) nor Drive '
                  '(GAS_LOGGER_LOCAL_PATH) is configured in local.settings.json')
            return 1
        print(f"Sink: Drive LogFile ({local_path}/{prefix}) — Axiom not configured locally")
        ok = check_drive(local_path, prefix, args.since, args.min_count)

    if not ok:
        print('\nNo recent GasLogger activity found. Run the checkin/signup live-check specs '
              'first (they exercise the webapp end-to-end, which flushes through GasLogger), '
              'or increase --since.')
        return 1

    print('\nPASS — GasLogger pipe is delivering data.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
