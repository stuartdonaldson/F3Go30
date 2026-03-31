#!/usr/bin/env python3
"""
LogFile test channel helper.

Downloads the F3Go30-LogFile from Google Drive and parses its structured entries.
The file is publicly readable (anyone with the link) — no auth required.

Usage (as a library):
    from log_channel import fetch_log_entries

    entries = fetch_log_entries("https://drive.google.com/file/d/FILE_ID/view?usp=sharing")
    for e in entries:
        print(e["timestamp"], e["trigger"], e["payload"])

Usage (as a script):
    python log_channel.py <drive_file_url_or_id>

Entry format produced by appendToLogFile_ (GAS):
    === <ISO-8601 timestamp> <trigger name> ===
    <JSON payload>

"""

import json
import re
import sys
from typing import Any

import requests


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_file_id(url_or_id: str) -> str:
    """Return the Drive file ID from a URL or bare ID string."""
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    # Assume it is already a bare file ID
    if re.fullmatch(r"[a-zA-Z0-9_-]+", url_or_id):
        return url_or_id
    raise ValueError(f"Cannot extract Drive file ID from: {url_or_id!r}")


def _download_log(file_id: str) -> str:
    """Download plain-text content from a publicly readable Drive file."""
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


def _parse_entries(content: str) -> list[dict[str, Any]]:
    """
    Parse log entries from raw file content.

    Each entry starts with a line matching:
        === <timestamp> <trigger> ===
    followed by zero or more lines of JSON payload.

    Returns a list of dicts with keys: timestamp, trigger, payload.
    """
    header_re = re.compile(
        r"^=== (\S+) (.+?) ===$"
    )
    entries: list[dict[str, Any]] = []
    current_ts: str | None = None
    current_trigger: str | None = None
    body_lines: list[str] = []

    def flush():
        if current_ts is None:
            return
        raw = "\n".join(body_lines).strip()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"_raw": raw}
        entries.append({
            "timestamp": current_ts,
            "trigger": current_trigger,
            "payload": payload
        })

    for line in content.splitlines():
        m = header_re.match(line)
        if m:
            flush()
            current_ts = m.group(1)
            current_trigger = m.group(2)
            body_lines = []
        else:
            if current_ts is not None:
                body_lines.append(line)

    flush()
    return entries


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_log_entries(url_or_id: str) -> list[dict[str, Any]]:
    """
    Download and parse log entries from a Drive LogFile.

    Args:
        url_or_id: Google Drive file URL (from Config sheet Column B) or bare file ID.

    Returns:
        List of dicts, each with keys:
            timestamp (str)  — ISO-8601 timestamp
            trigger   (str)  — name of the GAS function that wrote the entry
            payload   (dict) — parsed JSON payload
    """
    file_id = _extract_file_id(url_or_id)
    content = _download_log(file_id)
    return _parse_entries(content)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <drive_file_url_or_id>", file=sys.stderr)
        sys.exit(2)

    entries = fetch_log_entries(sys.argv[1])
    if not entries:
        print("No log entries found.")
        sys.exit(0)

    for e in entries:
        print(f"[{e['timestamp']}] {e['trigger']}")
        for k, v in e["payload"].items():
            print(f"  {k}: {v!r}")
        print()

    print(f"{len(entries)} entr{'y' if len(entries) == 1 else 'ies'} found.")


if __name__ == "__main__":
    main()
