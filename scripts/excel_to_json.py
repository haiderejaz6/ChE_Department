"""
excel_to_json.py
================
Converts the Qalam_CLOs Excel file into data.json for the OBE dashboard.

Usage
-----
    python scripts/excel_to_json.py

By default it looks for the Excel file at the path configured in EXCEL_PATH
below and writes data.json to the repo root (one level above this script).

Automate with GitHub Actions (see .github/workflows/update_data.yml).
"""

import re
import json
import sys
from pathlib import Path

# ── CONFIGURATION ────────────────────────────────────────────────────────────
EXCEL_PATH = Path(
    r"C:\Users\USER\OneDrive - National University of Sciences & Technology"
    r"\Documents\Admin\OBE\playwright-project\playwright-python\Qalam_CLOs.xlsx"
)
SHEET_NAME = "Qalam_CLOs"          # change if your sheet is named differently
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data.json"

# Expected column names — adjust if Qalam exports with different headers
COL_CODE        = "Course Code"
COL_TITLE       = "Course Title"
COL_CLO_CODE    = "CLO Code"
COL_BATCH       = "Program Batch"
COL_PLO         = "PLO"
COL_EMPHASIS    = "Emphasis Level"
COL_DOMAIN      = "Domain Level"
COL_DESCRIPTION = "Description"

# PLO definitions (static — update manually if the programme spec changes)
PLOS = {
    "PLO-1":  "Engineering Knowledge",
    "PLO-2":  "Problem Analysis",
    "PLO-3":  "Design/Development of Solutions",
    "PLO-4":  "Investigation",
    "PLO-5":  "Modern Tool Usage",
    "PLO-6":  "The Engineer & Society",
    "PLO-7":  "Environment & Sustainability",
    "PLO-8":  "Ethics",
    "PLO-9":  "Individual & Team Work",
    "PLO-10": "Communication",
    "PLO-11": "Project Management",
    "PLO-12": "Lifelong Learning",
}
# ─────────────────────────────────────────────────────────────────────────────


def normalise_plo(raw: str) -> str:
    """'PLO 4' → 'PLO-4',  'PLO-4' → 'PLO-4'"""
    raw = str(raw).strip()
    m = re.match(r"PLO[\s\-_]?(\d+)", raw, re.IGNORECASE)
    return f"PLO-{m.group(1)}" if m else raw


def normalise_domain(raw: str) -> str:
    """'C 3', 'C3', 'C-3' → 'C-3';  'P3', 'P 3' → 'P-3'"""
    raw = str(raw).strip()
    m = re.match(r"([CcPpAa])[\s\-_]?(\d)", raw)
    return f"{m.group(1).upper()}-{m.group(2)}" if m else raw


def extract_batch(program_batch: str) -> str:
    """'SCME/BCHMLE/2022F' → '2022F'"""
    parts = str(program_batch).strip().split("/")
    return parts[-1] if parts else program_batch


def main():
    try:
        import openpyxl  # noqa: F401 – just check availability
        import pandas as pd
    except ImportError:
        print("ERROR: Install dependencies first:\n  pip install pandas openpyxl")
        sys.exit(1)

    import pandas as pd

    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel file not found at:\n  {EXCEL_PATH}")
        sys.exit(1)

    print(f"Reading: {EXCEL_PATH}")
    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name=SHEET_NAME, dtype=str)
    except Exception as e:
        # Try first sheet if named sheet fails
        print(f"  Sheet '{SHEET_NAME}' not found, trying first sheet... ({e})")
        df = pd.read_excel(EXCEL_PATH, sheet_name=0, dtype=str)

    # ── Normalise column names (strip whitespace) ───────────────────────────
    df.columns = [c.strip() for c in df.columns]
    df = df.fillna("")

    # ── Build course → CLO map ──────────────────────────────────────────────
    courses_map = {}   # {course_code: {"title":…, "batch":…, "clos":[…]}}

    for _, row in df.iterrows():
        code = str(row.get(COL_CODE, "")).strip()
        if not code:
            continue

        title   = str(row.get(COL_TITLE, "")).strip()
        batch   = extract_batch(str(row.get(COL_BATCH, "")).strip())
        clo_code = str(row.get(COL_CLO_CODE, "")).strip()
        plo     = normalise_plo(str(row.get(COL_PLO, "")).strip())
        emphasis = str(row.get(COL_EMPHASIS, "")).strip().capitalize()
        domain  = normalise_domain(str(row.get(COL_DOMAIN, "")).strip())
        desc    = str(row.get(COL_DESCRIPTION, "")).strip()

        if code not in courses_map:
            courses_map[code] = {"code": code, "title": title,
                                 "batch": batch, "clos": []}
        elif not courses_map[code]["title"] and title:
            courses_map[code]["title"] = title

        if clo_code:
            courses_map[code]["clos"].append({
                "code": clo_code,
                "plo": plo,
                "emphasis": emphasis,
                "domain": domain,
                "description": desc,
            })

    # ── Sort by batch, then course code ─────────────────────────────────────
    courses = sorted(courses_map.values(),
                     key=lambda c: (c["batch"], c["code"]))

    output = {"plos": PLOS, "courses": courses}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    total_clos = sum(len(c["clos"]) for c in courses)
    print(f"✓  Wrote {OUTPUT_PATH}")
    print(f"   {len(courses)} courses · {total_clos} CLOs")


if __name__ == "__main__":
    main()
