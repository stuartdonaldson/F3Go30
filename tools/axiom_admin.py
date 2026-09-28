#!/usr/bin/env python3
"""
axiom_admin.py — administer the Axiom dataset itself (schema, field budget, map fields).
Companion to query_axiom.py (which reads events); this manages the dataset's *shape*.
Introduced by F3Go30-u7nk (dataset hit Axiom's 256-field limit; new-field batches dropped).

Tokens (local.settings.json; never printed): axiomQueryToken for schema reads,
axiomManageToken for map-field / dataset management calls. axiomDataset names the dataset.

Usage:
    python tools/axiom_admin.py check                 # token/permission probe, no writes
    python tools/axiom_admin.py schema [--top N]      # field count vs limit, grouped by prefix
    python tools/axiom_admin.py fields [--prefix P]   # list column names
    python tools/axiom_admin.py mapfields             # list configured map fields
    python tools/axiom_admin.py map NAME [NAME ...]   # declare object fields as map fields
    python tools/axiom_admin.py unmap NAME [NAME ...] # remove map-field declarations
    python tools/axiom_admin.py apply-registry        # map every mapFields entry in the registry

Map fields keep an object's keys inside ONE field, so arbitrary keys (query params, ids) stop
consuming the per-dataset field budget. Only NEW data follows the map shape; legacy flattened
columns (e.g. `parameter.cmd`) keep counting until trimmed/vacuumed out of the dataset.
Query a map field with bracket syntax: ['parameter']['cmd'].
"""
import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

_ROOT = pathlib.Path(__file__).parent.parent
_SETTINGS_PATH = _ROOT / "local.settings.json"
REGISTRY_PATH = _ROOT / "test" / "fixtures" / "axiomFieldRegistry.json"
FIELD_LIMIT = 256
API = "https://api.axiom.co"


def _load_settings() -> dict:
    if not _SETTINGS_PATH.exists():
        raise FileNotFoundError("local.settings.json not found.")
    return json.loads(_SETTINGS_PATH.read_text())


def _settings_or_die(*keys: str) -> dict:
    s = _load_settings()
    missing = [k for k in ("axiomDataset", *keys) if not s.get(k)]
    if missing:
        print(f"ERROR: {', '.join(missing)} not set in local.settings.json", file=sys.stderr)
        sys.exit(1)
    return s


def _call(method: str, path: str, token: str, body=None):
    """One HTTP client for every Axiom call. Returns parsed JSON (None for an empty body).
    Raises RuntimeError with status + trimmed body — never includes the token."""
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}") from e


def fetch_columns(dataset: str, query_token: str) -> list[str]:
    """Column names in the dataset's schema (getschema), excluding _time/_sysTime/_rowId."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = _call("POST", "/v1/datasets/_apl?format=legacy", query_token, {
        "apl": f"['{dataset}'] | getschema",
        "startTime": "2020-01-01T00:00:00Z",
        "endTime": now,
    })
    names = [m["data"]["ColumnName"] for m in result.get("matches", [])]
    return sorted(n for n in names if n not in ("_time", "_sysTime", "_rowId"))


def group_by_prefix(columns: list[str]) -> dict[str, int]:
    """Field count per top-level name; a flattened `a.b.c` counts toward `a`."""
    groups: dict[str, int] = {}
    for c in columns:
        key = c.split(".", 1)[0].replace("\\", "")
        groups[key] = groups.get(key, 0) + 1
    return dict(sorted(groups.items(), key=lambda kv: (-kv[1], kv[0])))


def _map_field_names(payload) -> list[str]:
    """The mapfields GET response is a list of names or of {name: ...} objects."""
    if not payload:
        return []
    items = payload if isinstance(payload, list) else payload.get("mapFields", payload.get("fields", []))
    return sorted(i if isinstance(i, str) else i.get("name", "") for i in items)


def cmd_check(s, _a) -> int:
    ok = True
    for label, key, method, path, body in (
        ("query token  (schema read)", "axiomQueryToken", "POST", "/v1/datasets/_apl?format=legacy",
         {"apl": f"['{s['axiomDataset']}'] | limit 1",
          "startTime": "2026-01-01T00:00:00Z", "endTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}),
        ("manage token (list map fields)", "axiomManageToken", "GET",
         f"/v2/datasets/{s['axiomDataset']}/mapfields", None),
    ):
        if not s.get(key):
            print(f"  {label}: {key} not set"); ok = False; continue
        try:
            _call(method, path, s[key], body)
            print(f"  {label}: OK")
        except RuntimeError as e:
            print(f"  {label}: FAIL  {e}"); ok = False
    return 0 if ok else 1


def cmd_schema(s, a) -> int:
    cols = fetch_columns(s["axiomDataset"], s["axiomQueryToken"])
    print(f"dataset={s['axiomDataset']}  fields={len(cols)} / {FIELD_LIMIT}  (headroom {FIELD_LIMIT - len(cols)})")
    print("(getschema sees fields with data in range; the enforced count also includes trimmed-but-registered fields)")
    groups = group_by_prefix(cols)
    for name, n in list(groups.items())[: a.top]:
        print(f"  {n:>4}  {name}{'.*' if n > 1 else ''}")
    return 0


def cmd_fields(s, a) -> int:
    for c in fetch_columns(s["axiomDataset"], s["axiomQueryToken"]):
        if not a.prefix or c.startswith(a.prefix):
            print(c)
    return 0


def cmd_mapfields(s, _a) -> int:
    names = _map_field_names(_call("GET", f"/v2/datasets/{s['axiomDataset']}/mapfields", s["axiomManageToken"]))
    print("\n".join(names) if names else "(no map fields)")
    return 0


def _post_map(s, name: str) -> None:
    _call("POST", f"/v2/datasets/{s['axiomDataset']}/mapfields", s["axiomManageToken"], {"name": name})
    print(f"mapped: {name}")


def cmd_map(s, a) -> int:
    for name in a.names:
        _post_map(s, name)
    return 0


def cmd_unmap(s, a) -> int:
    for name in a.names:
        _call("DELETE", f"/v2/datasets/{s['axiomDataset']}/mapfields", s["axiomManageToken"], {"name": name})
        print(f"unmapped: {name}")
    return 0


def cmd_apply_registry(s, _a) -> int:
    wanted = json.loads(REGISTRY_PATH.read_text())["mapFields"]
    have = set(_map_field_names(_call("GET", f"/v2/datasets/{s['axiomDataset']}/mapfields", s["axiomManageToken"])))
    todo = [n for n in wanted if n not in have]
    for name in todo:
        _post_map(s, name)
    print(f"{len(todo)} added, {len(wanted) - len(todo)} already mapped")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sp = sub.add_parser("schema"); sp.add_argument("--top", type=int, default=25)
    sp = sub.add_parser("fields"); sp.add_argument("--prefix")
    sub.add_parser("mapfields")
    sub.add_parser("map").add_argument("names", nargs="+")
    sub.add_parser("unmap").add_argument("names", nargs="+")
    sub.add_parser("apply-registry")
    a = p.parse_args()

    needs_manage = a.cmd in ("check", "mapfields", "map", "unmap", "apply-registry")
    needs_query = a.cmd in ("check", "schema", "fields")
    s = _settings_or_die(*(["axiomManageToken"] if needs_manage else []),
                         *(["axiomQueryToken"] if needs_query else []))
    handler = {"check": cmd_check, "schema": cmd_schema, "fields": cmd_fields, "mapfields": cmd_mapfields,
               "map": cmd_map, "unmap": cmd_unmap, "apply-registry": cmd_apply_registry}[a.cmd]
    try:
        return handler(s, a)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
