#!/usr/bin/env python3
"""
Verify that a Google Sheets Tracker has been correctly initialized by copyAndInit().

Usage:
    python test_tracker_init.py <sheet_url>

The sheet must be publicly shared (no auth required).
Exits 0 if all checks pass, non-zero if any fail.
"""

import sys
import re
import io
import calendar
from datetime import date, timedelta

import requests
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


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


def argb_matches(fill, hex_color: str) -> bool:
    """Check if an openpyxl PatternFill matches a hex color (RRGGBB or FFRRGGBB)."""
    if fill is None or fill.fgColor is None:
        return False
    color = fill.fgColor
    if color.type == "rgb":
        val = color.rgb.upper().lstrip("FF") if len(color.rgb) == 8 else color.rgb.upper()
        return val == hex_color.upper().lstrip("#")
    return False


ORANGE = "FF9900"
GREEN  = "00FF00"

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
    """Return the first date value found in row 3, or None."""
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=3, column=col).value
        if isinstance(val, (date,)):
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
    if not check("Row 3 has at least one date value", first_date is not None,
                 "could not find a date in row 3"):
        # Cannot continue date-dependent checks
        return

    year = first_date.year
    month = first_date.month
    days_in_month = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)

    # Find the column where the first date sits (to anchor the rest)
    first_date_col = None
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=3, column=col).value
        if val is not None:
            first_date_col = col
            break

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

        # Parse the date value
        if isinstance(val, date):
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

    # AC 7: no data rows beyond row 4
    non_empty = []
    for row in range(5, ws.max_row + 1):
        for col_idx in range(1, ws.max_column + 1):
            if ws.cell(row=row, column=col_idx).value not in (None, ""):
                non_empty.append(row)
                break
    check("No data rows beyond row 4 in Tracker",
          len(non_empty) == 0,
          f"rows with data: {non_empty}" if non_empty else "")

    # AC 8 (partial — hidden columns): columns after the last day's column should have width 0
    # openpyxl exposes column dimensions; width=None or 0 means hidden/default
    if date_cols:
        last_date_col = max(date_cols.values())
        # Also account for any trailing bonus column
        check_from = last_date_col + 1
        if check_from in bonus_cols:
            check_from += 1
        hidden_violations = []
        for col_idx in range(check_from, min(check_from + 10, ws.max_column + 1)):
            col_letter = get_column_letter(col_idx)
            dim = ws.column_dimensions.get(col_letter)
            width = dim.width if dim else None
            hidden = dim.hidden if dim else False
            if not hidden and width not in (None, 0):
                hidden_violations.append(col_idx)
        check("Columns after last day are hidden or zero-width",
              len(hidden_violations) == 0,
              f"non-hidden cols: {hidden_violations}" if hidden_violations else "")


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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <google_sheets_url>", file=sys.stderr)
        sys.exit(2)

    url = sys.argv[1]
    print(f"Sheet URL: {url}")

    try:
        sheet_id = extract_sheet_id(url)
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

    print(f"\nResults: {RESULT['pass']} passed, {RESULT['fail']} failed")
    sys.exit(0 if RESULT["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
