#!/usr/bin/env bash
set -euo pipefail

# Open the Google Sheets spreadsheet bound to this Apps Script project.
#
# Usage:
#   tools/open_spreadsheet.sh <drive_file_url_or_id>
#   GAS_BOUND_SPREADSHEET_ID=FILE_ID tools/open_spreadsheet.sh
#
# Strategy:
# 1. If CLI arg or GAS_BOUND_SPREADSHEET_ID provided => open that sheet.
# 2. Else prefer .clasp.json anywhere in repo. Require exact "scriptId" key.
#    If present, try to find a bound spreadsheet URL in the repo (near .clasp.json
#    first, then whole repo). If found, open it; otherwise open Apps Script editor.
# 3. If no .clasp.json, scan repo for a spreadsheet URL and open it.

extract_id() {
  local input="$1"
  if [[ $input =~ /d/([A-Za-z0-9_-]+) ]]; then
    printf "%s" "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ $input =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf "%s" "$input"
    return 0
  fi
  return 1
}

open_url() {
  local url="$1"
  local label="$2"
  echo "$label: $url"
  uname_s=$(uname -s)
  case "${uname_s}" in
    Darwin)
      open "$url" ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
      elif command -v gio >/dev/null 2>&1; then
        gio open "$url" >/dev/null 2>&1 || true
      else
        echo "Open this URL manually: $url" >&2
        return 0
      fi
      ;;
    CYGWIN*|MINGW*|MSYS*)
      cmd.exe /c start "" "${url}" ;;
    *)
      echo "Unsupported platform: ${uname_s}. Open this URL manually: $url" >&2
      return 0
      ;;
  esac
}

### 1) CLI arg
if [[ ${1:-} ]]; then
  id=$(extract_id "$1") || { echo "Cannot extract Drive file ID from: $1" >&2; exit 2; }
  open_url "https://docs.google.com/spreadsheets/d/${id}" "Opening"
  exit 0
fi

### 2) ENV
if [[ -n ${GAS_BOUND_SPREADSHEET_ID:-} ]]; then
  id=$(extract_id "$GAS_BOUND_SPREADSHEET_ID") || { echo "Cannot extract Drive file ID from GAS_BOUND_SPREADSHEET_ID" >&2; exit 2; }
  open_url "https://docs.google.com/spreadsheets/d/${id}" "Opening"
  exit 0
fi

### 3) Prefer .clasp.json if present
clasp_path=""
if command -v git >/dev/null 2>&1; then
  clasp_path=$(git ls-files -z 2>/dev/null | tr '\0' '\n' | grep -E '\.clasp.json$' | head -n1 || true)
fi
if [[ -z "$clasp_path" ]]; then
  clasp_path=$(find . -maxdepth 4 -type f -name .clasp.json -print -quit 2>/dev/null || true)
fi

if [[ -n "$clasp_path" ]]; then
  # Require exact 'scriptId' key
  if command -v jq >/dev/null 2>&1; then
    has_exact=$(jq 'has("scriptId")' "$clasp_path" 2>/dev/null || echo false)
    if [[ "$has_exact" != "true" ]]; then
      echo "Error: .clasp.json found at $clasp_path but missing exact 'scriptId' key." >&2
      exit 2
    fi
    script_id=$(jq -r '.scriptId' "$clasp_path")
  elif command -v python3 >/dev/null 2>&1; then
    script_id=$(python3 - <<'PY'
import json,sys
p=sys.argv[1]
try:
  j=json.load(open(p))
except Exception:
  sys.exit(0)
if 'scriptId' in j and j['scriptId']:
  print(j['scriptId'])
PY
"$clasp_path")
    if [[ -z "$script_id" ]]; then
      echo "Error: .clasp.json found at $clasp_path but missing exact 'scriptId' key." >&2
      exit 2
    fi
  else
    # last-resort sed exact match
    script_id=$(sed -n 's/^[[:space:]]*"scriptId"[[:space:]]*:[[:space:]]*"\([^"\]+\)".*/\1/p' "$clasp_path" || true)
    if [[ -z "$script_id" ]]; then
      echo "Error: .clasp.json found at $clasp_path but cannot extract exact 'scriptId' (install jq or python3)." >&2
      exit 2
    fi
  fi

  echo "Found .clasp.json at $clasp_path; scriptId=$script_id"

  # Try to find a spreadsheet URL near the clasp file first
  clasp_dir=$(dirname "$clasp_path")
  candidate=$(grep -rhoE "docs.google.com/spreadsheets/d/[A-Za-z0-9_-]+" "$clasp_dir" 2>/dev/null | head -n1 || true)
  if [[ -z "$candidate" ]]; then
    candidate=$(grep -rhoE "docs.google.com/spreadsheets/d/[A-Za-z0-9_-]+" . | head -n1 || true)
  fi
  if [[ -n "$candidate" ]]; then
    sheet_id=$(extract_id "$candidate") || true
    if [[ -n "$sheet_id" ]]; then
      open_url "https://docs.google.com/spreadsheets/d/${sheet_id}" "Opening bound spreadsheet"
      exit 0
    fi
  fi

  # Fallback: open Apps Script editor
  open_url "https://script.google.com/d/${script_id}/edit" "Opening Apps Script editor"
  exit 0
fi

### 4) No .clasp.json: scan repo for spreadsheet URLs
candidate=$(grep -rhoE "docs.google.com/spreadsheets/d/[A-Za-z0-9_-]+" . | head -n1 || true)
if [[ -n "$candidate" ]]; then
  sheet_id=$(extract_id "$candidate") || true
  if [[ -n "$sheet_id" ]]; then
    open_url "https://docs.google.com/spreadsheets/d/${sheet_id}" "Opening found spreadsheet"
    exit 0
  fi
fi

echo "Error: no spreadsheet ID found (no CLI arg, GAS_BOUND_SPREADSHEET_ID, .clasp.json with scriptId, or spreadsheet URL in repo)." >&2
exit 2
