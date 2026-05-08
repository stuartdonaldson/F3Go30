#!/usr/bin/env python3
"""
Live integration test for GasLogger.

Prerequisites:
  1. local.settings.json at the project root with GAS_LOGGER_LOCAL_PATH and
     GAS_LOGGER_PROJECT_PREFIX (Drive folder must be mounted locally).
  2. Run testGasLogger_() from the GAS editor (Apps Script > Run > testGasLogger_).
  3. python test/test_gas_logger_live.py

Exits 0 on pass, 1 on failure or timeout.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from log_channel import collect_local_log_entries, _load_settings

RUN_ID = 'gaslogger-test'
EXPECTED_TAGS = {'normal.first', 'normal.second', 'inline.flush', 'newlog.before', 'newlog.after'}
TIMEOUT = 60


def collect_by_file(scan_path, run_id, timeout):
    """Poll until all expected tags are present. Returns {file_path: [entries]}."""
    found = set()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        files_map = collect_local_log_entries(scan_path, run_id)
        found = {e['tag'] for entries in files_map.values() for e in entries}
        if EXPECTED_TAGS <= found:
            return files_map
        print(f'  waiting... missing: {EXPECTED_TAGS - found}')
        time.sleep(3)
    raise TimeoutError(f'Timed out after {timeout}s — missing: {EXPECTED_TAGS - found}')


def resolve_exec_id(files_map):
    """Return the execId that covers the most expected tags (the latest complete run)."""
    counts = {}
    for entries in files_map.values():
        for e in entries:
            eid = e.get('execId')
            if e.get('tag') in EXPECTED_TAGS:
                counts[eid] = counts.get(eid, 0) + 1
    return max(counts, key=counts.get) if counts else None


def find(files_map, tag, exec_id=None):
    for file_path, entries in files_map.items():
        for e in entries:
            if e.get('tag') == tag and (exec_id is None or e.get('execId') == exec_id):
                return file_path, e
    return None, None


def assert_fields(entry, tag):
    for field in ('ts', 'tag', 'data', 'execId', 'runId'):
        assert field in entry, f'{tag}: missing field {field!r}'
    assert entry['runId'] == RUN_ID, f'{tag}: runId mismatch'


def main():
    settings = _load_settings()
    local_path = settings.get('GAS_LOGGER_LOCAL_PATH')
    prefix = settings.get('GAS_LOGGER_PROJECT_PREFIX', 'F3Go30')
    if not local_path:
        print('ERROR: local.settings.json must contain GAS_LOGGER_LOCAL_PATH')
        sys.exit(1)
    scan_path = str(Path(local_path) / prefix)

    print(f'Polling {scan_path!r} for runId={RUN_ID!r} (timeout={TIMEOUT}s)...')
    try:
        files_map = collect_by_file(scan_path, RUN_ID, TIMEOUT)
    except TimeoutError as e:
        print(f'FAIL: {e}')
        sys.exit(1)
    print(f'Found entries across {len(files_map)} file(s)\n')

    exec_id = resolve_exec_id(files_map)

    # AC2: normal.first and normal.second in the same file with correct fields
    fid1, e1 = find(files_map, 'normal.first', exec_id)
    fid2, e2 = find(files_map, 'normal.second', exec_id)
    assert fid1 and e1, 'AC2 FAIL: normal.first not found'
    assert fid2 and e2, 'AC2 FAIL: normal.second not found'
    assert fid1 == fid2, 'AC2 FAIL: normal entries in different files'
    assert_fields(e1, 'normal.first')
    assert_fields(e2, 'normal.second')
    assert e1['execId'] == e2['execId'], 'AC2 FAIL: execId mismatch between normal entries'
    print('AC2 PASS  normal run — both entries in same file')

    # AC3: inline.flush entry exists
    _, e3 = find(files_map, 'inline.flush', exec_id)
    assert e3, 'AC3 FAIL: inline.flush not found'
    assert_fields(e3, 'inline.flush')
    print('AC3 PASS  inline flush entry found')

    # AC4: newlog.before and newlog.after in separate files
    fid_b, e_b = find(files_map, 'newlog.before', exec_id)
    fid_a, e_a = find(files_map, 'newlog.after', exec_id)
    assert fid_b and e_b, 'AC4 FAIL: newlog.before not found'
    assert fid_a and e_a, 'AC4 FAIL: newlog.after not found'
    assert fid_b != fid_a, 'AC4 FAIL: newlog entries in same file (newLog reset not working)'
    print('AC4 PASS  newLog reset — entries in separate files')

    # AC5: the five test entries all share the same execId
    test_entries = [e1, e2, e3, e_b, e_a]
    exec_ids = {e['execId'] for e in test_entries}
    assert len(exec_ids) == 1, f'AC5 FAIL: multiple execIds across test entries: {exec_ids}'
    print('AC5 PASS  single execId across all test entries')

    print('\nAll assertions passed.')


if __name__ == '__main__':
    main()
