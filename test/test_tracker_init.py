#!/usr/bin/env python3
"""
Verify that a Google Sheets Tracker has been correctly initialized by copyAndInit().

Usage:
    # Primary: discover sheet URL from the most recent log entry
    python test_tracker_init.py --log <drive_logfile_url>

    # Legacy: provide sheet URL directly
    python test_tracker_init.py <google_sheets_url>

The sheet must be publicly shared (no auth required).
Exits 0 if all checks pass, non-zero if any fail.
"""

import sys
import re
import io
import calendar
from datetime import date, datetime as dt, timedelta

import requests
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

# Import log_channel from same directory
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from log_channel import fetch_log_entries


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_sheet_id(url: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError(f"Cannot extract sheet ID from URL: {url}")
    return m.group(1)


def build_export_url(sheet_id: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"


def download_xlsx(export_url: str) -> bytes:
    resp = requests.get(export_url, timeout=30)
    resp.raise_for_status()
    return resp.content


def follow_redirect(url: str) -> str:
    """Follow redirects and return the final URL."""
    resp = requests.head(url, allow_redirects=True, timeout=15)
    return resp.url


def find_sheet_url_from_log(log_url: str) -> tuple[str, dict]:
    """
    Download the LogFile, find the most recent successful copyAndInit entry,
    follow the trackerUrl redirect to obtain the full spreadsheet URL.

    Returns (sheet_url, entry) where entry is the log payload dict.
    """
    entries = fetch_log_entries(log_url)
    if not entries:
        raise RuntimeError("LogFile is empty — no entries found.")

    # Most recent entry is last; search in reverse for a successful copyAndInit
    for entry in reversed(entries):
        if entry["trigger"] != "copyAndInit":
            continue
        payload = entry["payload"]
        if "error" in payload:
            continue
        tracker_url = payload.get("trackerUrl")
        if not tracker_url:
            continue

        print(f"Most recent copyAndInit: [{entry['timestamp']}]")
        print(f"  spreadsheetName: {payload.get('spreadsheetName', '?')}")
        print(f"  trackerUrl: {tracker_url}")

        # Follow the short URL redirect to get the full spreadsheet URL
        final_url = follow_redirect(tracker_url)
        print(f"  resolved to: {final_url}")

        # Strip the #gid fragment — we need the spreadsheet root URL
        sheet_url = final_url.split("#")[0]
        return sheet_url, payload

    raise RuntimeError(
        "No successful copyAndInit entry found in LogFile. "
        "Most recent entries:\n" +
        "\n".join(
            f"  [{e['timestamp']}] {e['trigger']} "
            f"{'(error)' if 'error' in e['payload'] else ''}"
            for e in reversed(entries[-5:])
        )
    )


def argb_matches(fill, hex_color: str) -> bool:
    """Check if an openpyxl PatternFill matches a hex color (RRGGBB or FFRRGGBB)."""
    if fill is None or fill.fgColor is None:
        return False
    color = fill.fgColor
    if color.type == "rgb":
        rgb = color.rgb.upper()
        if len(rgb) == 8:
            rgb = rgb[2:]  # strip alpha byte (first two hex chars)
        return rgb == hex_color.upper().lstrip("#")
    return False


ORANGE = "FF9900"
GREEN  = "00FF00"
LAST_TRACKER_COLUMN = 44  # Column AR — matches GAS LAST_TRACKER_COLUMN constant

RESULT = {"pass": 0, "fail": 0}


def check(name: str, passed: bool, detail: str = "") -> bool:
    status = "PASS" if passed else "FAIL"
    msg = f"  [{status}] {name}"
    if detail:
        msg += f": {detail}"
    print(msg)
    RESULT["pass" if passed else "fail"] += 1
    return passed


# ---------------------------------------------------------------------------
# Determine expected month from the first date in row 3
# ---------------------------------------------------------------------------

def first_date_in_row3(ws):
    """Return the first date value found in row 3, or None (always a date, never datetime)."""
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=3, column=col).value
        if isinstance(val, dt):
            return val.date()
        if isinstance(val, date):
            return val
        if isinstance(val, str):
            try:
                parts = val.split("/")
                if len(parts) == 2:
                    return date(date.today().year, int(parts[0]), int(parts[1]))
            except (ValueError, IndexError):
                pass
    return None


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_tracker(ws):
    print("\n--- Tracker sheet ---")

    # Identify the first date cell to determine the month being tested
    first_date = first_date_in_row3(ws)
    if not check("Row 3 has at least one date value", first_date is not None):
        return

    year = first_date.year
    month = first_date.month
    days_in_month = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)

    # Find the column where the first DATE sits (skip fixed header columns like "F3 Name")
    first_date_col = None
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=3, column=col).value
        if isinstance(val, date):
            first_date_col = col
            break
        if isinstance(val, str):
            try:
                parts = val.split("/")
                if len(parts) == 2:
                    int(parts[0]); int(parts[1])
                    first_date_col = col
                    break
            except (ValueError, IndexError):
                pass

    if first_date_col is None:
        check("Could anchor date column in row 3", False)
        return

    # AC 4: sequential dates starting from the 1st
    date_cols = {}        # date → column index
    bonus_cols = set()    # column indices that are Bonus columns
    bad_dates = []

    expected_day = 1
    col = first_date_col
    while expected_day <= days_in_month and col <= ws.max_column:
        cell = ws.cell(row=3, column=col)
        val = cell.value

        # Detect a Bonus column (header says "Bonus" or similar, or green fill)
        header = ws.cell(row=1, column=col).value or ws.cell(row=2, column=col).value or ""
        fill = cell.fill
        is_bonus = (
            (isinstance(header, str) and "bonus" in header.lower())
            or argb_matches(fill, GREEN)
        )
        if is_bonus:
            bonus_cols.add(col)
            col += 1
            continue

        # Parse the date value (normalize datetime → date)
        if isinstance(val, dt):
            cell_date = val.date()
        elif isinstance(val, date):
            cell_date = val
        elif isinstance(val, str):
            try:
                parts = val.split("/")
                cell_date = date(year, int(parts[0]), int(parts[1]))
            except (ValueError, IndexError, TypeError):
                bad_dates.append((col, val))
                col += 1
                expected_day += 1
                continue
        else:
            bad_dates.append((col, val))
            col += 1
            expected_day += 1
            continue

        expected_date = month_start + timedelta(days=expected_day - 1)
        if cell_date != expected_date:
            bad_dates.append((col, f"{val!r} expected {expected_date.strftime('%m/%d')}"))
        else:
            date_cols[cell_date] = col

        expected_day += 1
        col += 1

    check("Row 3 contains sequential dates for the month",
          len(bad_dates) == 0,
          f"mismatches: {bad_dates}" if bad_dates else "")

    # AC 4 format: MM/DD
    bad_fmt = []
    for col_idx in date_cols.values():
        val = ws.cell(row=3, column=col_idx).value
        if isinstance(val, str):
            if not re.fullmatch(r"\d{1,2}/\d{1,2}", val):
                bad_fmt.append((col_idx, val))
        # date objects are formatted by Sheets; xlsx may render as date type — acceptable
    check("Date cells formatted MM/DD (or date type)",
          len(bad_fmt) == 0,
          f"bad format: {bad_fmt}" if bad_fmt else "")

    # AC 5: orange fill on date columns
    non_orange = []
    for d, col_idx in date_cols.items():
        fill = ws.cell(row=3, column=col_idx).fill
        if not argb_matches(fill, ORANGE):
            non_orange.append(col_idx)
    check("Date cells have orange fill (#FF9900)",
          len(non_orange) == 0,
          f"cols without orange: {non_orange}" if non_orange else "")

    # AC 6: each Saturday is followed by a Bonus column with green fill
    bad_bonus = []
    for d, col_idx in date_cols.items():
        if d.weekday() == 5:  # Saturday
            next_col = col_idx + 1
            bonus_fill = ws.cell(row=3, column=next_col).fill
            if not argb_matches(bonus_fill, GREEN):
                bad_bonus.append(f"col {next_col} (after Sat {d.strftime('%m/%d')})")
    check("Each Saturday is followed by a Bonus column (green fill)",
          len(bad_bonus) == 0,
          f"missing: {bad_bonus}" if bad_bonus else "")

    # AC 7 (trailing Bonus): a Bonus column exists after the last day of the month
    if date_cols:
        last_date = max(date_cols.keys())
        last_col = date_cols[last_date]
        trailing_col = last_col + 1
        trailing_fill = ws.cell(row=3, column=trailing_col).fill
        trailing_header = (
            ws.cell(row=1, column=trailing_col).value or
            ws.cell(row=2, column=trailing_col).value or ""
        )
        has_trailing = (
            argb_matches(trailing_fill, GREEN)
            or (isinstance(trailing_header, str) and "bonus" in trailing_header.lower())
        )
        check("Trailing Bonus column exists after last day of month",
              has_trailing,
              f"col {trailing_col} fill={ws.cell(row=3, column=trailing_col).fill.fgColor.rgb!r}"
              if not has_trailing else "")

    # AC 8: no data rows beyond row 4
    non_empty = []
    for row in range(5, ws.max_row + 1):
        for col_idx in range(1, ws.max_column + 1):
            if ws.cell(row=row, column=col_idx).value not in (None, ""):
                non_empty.append(row)
                break
    check("No data rows beyond row 4 in Tracker",
          len(non_empty) == 0,
          f"rows with data: {non_empty}" if non_empty else "")

    # AC 9 (partial — hidden columns): first column after last day/bonus region must be hidden.
    # Google Sheets XLSX export only marks the start of a hidden range; checking only the
    # first column after the date area is sufficient.
    # Skip bonus columns not captured in the main loop (e.g. trailing bonus added after last day).
    if date_cols:
        last_date_col = max(date_cols.values())
        check_from = last_date_col + 1
        while check_from in bonus_cols or argb_matches(ws.cell(row=3, column=check_from).fill, GREEN):
            check_from += 1
        if check_from > ws.max_column:
            check("First column after date area is hidden", True,
                  "month fills tracker width — no columns beyond spreadsheet max")
        else:
            col_letter = get_column_letter(check_from)
            dim = ws.column_dimensions.get(col_letter)
            is_hidden = (dim.hidden if dim else False)
            check("First column after date area is hidden",
                  is_hidden,
                  f"col {check_from} ({col_letter}) not hidden" if not is_hidden else "")


def check_bonus_tracker(wb):
    print("\n--- Bonus Tracker sheet ---")
    if "Bonus Tracker" not in wb.sheetnames:
        check("Bonus Tracker sheet exists", False, "sheet not found")
        return
    ws = wb["Bonus Tracker"]
    non_empty = []
    for row in range(2, ws.max_row + 1):
        for col in range(1, ws.max_column + 1):
            if ws.cell(row=row, column=col).value not in (None, ""):
                non_empty.append(row)
                break
    check("Bonus Tracker row 2+ is empty",
          len(non_empty) == 0,
          f"rows with data: {non_empty}" if non_empty else "")


def check_responses(wb):
    print("\n--- Responses sheet ---")
    sheet_name = next((s for s in wb.sheetnames if "response" in s.lower()), None)
    if sheet_name is None:
        check("Responses sheet exists", False, "sheet not found")
        return
    ws = wb[sheet_name]
    non_empty = []
    for row in range(2, ws.max_row + 1):
        for col in range(1, ws.max_column + 1):
            if ws.cell(row=row, column=col).value not in (None, ""):
                non_empty.append(row)
                break
    check("Responses sheet has only the header row",
          len(non_empty) == 0,
          f"rows with data: {non_empty}" if non_empty else "")


def check_activity(wb):
    print("\n--- Activity sheet ---")
    sheet_name = next((s for s in wb.sheetnames if "activity" in s.lower()), None)
    if sheet_name is None:
        check("Activity sheet exists", False, "sheet not found")
        return
    ws = wb[sheet_name]
    non_empty = []
    for row in range(2, ws.max_row + 1):
        for col in range(1, ws.max_column + 1):
            if ws.cell(row=row, column=col).value not in (None, ""):
                non_empty.append(row)
                break
    check("Activity sheet has only the header row",
          len(non_empty) == 0,
          f"rows with data: {non_empty}" if non_empty else "")


def check_log_payload(payload: dict):
    """Assert LogFile payload contains expected Slack message fields."""
    print("\n--- LogFile payload ---")
    slack_msg = payload.get("slackMessage")
    if not check("LogFile payload contains slackMessage", slack_msg is not None):
        return
    check("slackMessage contains 'Hard Commit Signup form is up:'",
          "Hard Commit Signup form is up:" in slack_msg,
          f"actual: {slack_msg!r}")
    check("slackMessage contains 'Tracker:'",
          "Tracker:" in slack_msg,
          f"actual: {slack_msg!r}")
    check("slackMessage contains trackerUrl",
          payload["trackerUrl"] in slack_msg,
          f"trackerUrl={payload['trackerUrl']!r}")
    check("slackMessage contains formUrl",
          payload["formUrl"] in slack_msg,
          f"formUrl={payload['formUrl']!r}")

    conf_msg = payload.get("confirmationMessage")
    if not check("LogFile payload contains confirmationMessage", conf_msg is not None):
        return
    check("confirmationMessage contains 'Thank you for your Hard Commit!'",
          "Thank you for your Hard Commit!" in conf_msg,
          f"actual: {conf_msg!r}")
    check("confirmationMessage contains trackerUrl",
          payload["trackerUrl"] in conf_msg,
          f"trackerUrl={payload['trackerUrl']!r}")
    check("confirmationMessage contains siteQEmail",
          payload["siteQEmail"] in conf_msg,
          f"siteQEmail={payload['siteQEmail']!r}")

    check("LogFile payload contains templateSpreadsheetId",
          "templateSpreadsheetId" in payload,
          "key missing from payload")


def check_links_sheet(payload: dict):
    """Download the template spreadsheet and verify the Links sheet row."""
    print("\n--- Links sheet (template) ---")
    template_id = payload.get("templateSpreadsheetId")
    if not check("templateSpreadsheetId present in payload", template_id is not None,
                 "key missing — cannot verify Links sheet"):
        return

    export_url = build_export_url(template_id)
    print(f"  Downloading template: {export_url}")
    try:
        xlsx_bytes = download_xlsx(export_url)
    except requests.HTTPError as e:
        check("Template spreadsheet downloadable", False, str(e))
        return

    wb = load_workbook(io.BytesIO(xlsx_bytes))
    if not check("Links sheet exists in template", "Links" in wb.sheetnames):
        return

    ws = wb["Links"]
    target_name = str(payload.get("spreadsheetName") or "").strip()
    target_month = str(payload.get("startDateIso") or "").strip()
    target_tracker = str(payload.get("trackerUrl") or "").strip()
    target_form = str(payload.get("formUrl") or "").strip()

    found_row = None
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row=row, column=3).value or "").strip() == target_name:
            found_row = row
            break

    if not check("Links sheet has row for this tracker",
                 found_row is not None,
                 f"no row with spreadsheetName={target_name!r}"):
        return

    row_date = ws.cell(row=found_row, column=1).value
    row_month_raw = ws.cell(row=found_row, column=2).value
    if isinstance(row_month_raw, (dt, date)):
        row_month = row_month_raw.strftime('%Y-%m-%d')
    else:
        row_month = str(row_month_raw or "").strip()
    row_name = str(ws.cell(row=found_row, column=3).value or "").strip()
    row_tracker = str(ws.cell(row=found_row, column=4).value or "").strip()
    row_form = str(ws.cell(row=found_row, column=5).value or "").strip()

    check("Links row has non-empty date", row_date not in (None, ""), f"date={row_date!r}")
    check("Links row month matches startDateIso", row_month == target_month,
          f"got={row_month!r} expected={target_month!r}")
    check("Links row spreadsheetName matches payload", row_name == target_name,
          f"got={row_name!r}")
    check("Links row trackerUrl matches payload", row_tracker == target_tracker,
          f"got={row_tracker!r} expected={target_tracker!r}")
    check("Links row formUrl matches payload", row_form == target_form,
          f"got={row_form!r} expected={target_form!r}")


def check_config(wb):
    print("\n--- Config sheet ---")
    sheet_name = next((s for s in wb.sheetnames if s.lower() == "config"), None)
    if sheet_name is None:
        check("Config sheet exists", False, "sheet not found")
        return
    ws = wb[sheet_name]

    # AC 12: Config sheet should be hidden
    state = ws.sheet_state  # 'visible', 'hidden', 'veryHidden'
    check("Config sheet is hidden",
          state in ("hidden", "veryHidden"),
          f"sheet_state={state!r}")

    # Build a map of variable name → (col_b, col_c)
    config_rows = {}
    for row in range(1, ws.max_row + 1):
        key = ws.cell(row=row, column=1).value
        if key:
            config_rows[str(key).strip()] = (
                ws.cell(row=row, column=2).value,
                ws.cell(row=row, column=3).value,
            )

    # AC 13: NameSpace row with non-empty value in column B
    ns = config_rows.get("NameSpace")
    check("Config has NameSpace row with non-empty column B",
          ns is not None and ns[0] not in (None, ""),
          f"value={ns!r}" if ns is not None else "row not found")

    # AC 13: Site Q row with name in column B and email in column C
    sq = config_rows.get("Site Q")
    has_sq_name = sq is not None and sq[0] not in (None, "")
    has_sq_email = sq is not None and sq[1] not in (None, "")
    check("Config has Site Q row with name in column B",
          has_sq_name,
          f"value={sq!r}" if sq is not None else "row not found")
    check("Config has Site Q row with email in column C",
          has_sq_email,
          f"value={sq!r}" if sq is not None else "row not found")

    # AC 13: LogFile row with non-empty URL in column B
    lf = config_rows.get("LogFile")
    check("Config has LogFile row with non-empty column B",
          lf is not None and lf[0] not in (None, ""),
          f"value={lf!r}" if lf is not None else "row not found")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    log_entry_payload = None

    if len(args) == 2 and args[0] == "--log":
        log_url = args[1]
        print(f"LogFile URL: {log_url}")
        try:
            sheet_url, log_entry_payload = find_sheet_url_from_log(log_url)
        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(2)
    elif len(args) == 1 and not args[0].startswith("--"):
        sheet_url = args[0]
    else:
        print(f"Usage:", file=sys.stderr)
        print(f"  {sys.argv[0]} --log <drive_logfile_url>", file=sys.stderr)
        print(f"  {sys.argv[0]} <google_sheets_url>", file=sys.stderr)
        sys.exit(2)

    print(f"Sheet URL: {sheet_url}")

    try:
        sheet_id = extract_sheet_id(sheet_url)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

    export_url = build_export_url(sheet_id)
    print(f"Downloading: {export_url}")

    try:
        xlsx_bytes = download_xlsx(export_url)
    except requests.HTTPError as e:
        print(f"ERROR downloading spreadsheet: {e}", file=sys.stderr)
        sys.exit(2)

    wb = load_workbook(io.BytesIO(xlsx_bytes))
    print(f"Sheets: {wb.sheetnames}")

    if "Tracker" not in wb.sheetnames:
        print("ERROR: 'Tracker' sheet not found", file=sys.stderr)
        sys.exit(2)

    check_tracker(wb["Tracker"])
    check_bonus_tracker(wb)
    check_responses(wb)
    check_activity(wb)
    check_config(wb)
    if log_entry_payload is not None:
        check_log_payload(log_entry_payload)
        check_links_sheet(log_entry_payload)

    print(f"\nResults: {RESULT['pass']} passed, {RESULT['fail']} failed")
    sys.exit(0 if RESULT["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
