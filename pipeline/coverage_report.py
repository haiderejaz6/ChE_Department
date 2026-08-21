"""
Join the reference ontology (artifact A) with the curriculum mapping (artifact B)
and produce the numbers the research question actually needs.

Four outputs:

  gaps       reference units NO course maps to        <- the contribution
  overlap    units many courses map to                <- redundancy
  bloom      units taught below their expected level  <- depth shortfall
  agreement  Claude vs the existing rule/Ollama run   <- method comparison

Everything here is deterministic - no API calls. Safe to re-run.

Run:
    python pipeline/coverage_report.py
    python pipeline/coverage_report.py --markdown gaps.md
"""

import argparse
from pathlib import Path

from claude_common import (COVERAGE_PATH, EXTRACTION_PATH, REFERENCE_PATH,
                           load_json, save_json)

_REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = _REPO_ROOT / "data.json"

BLOOM_RANK = {"Remember": 1, "Understand": 2, "Apply": 3,
              "Analyze": 4, "Evaluate": 5, "Create": 6}


def main():
    ap = argparse.ArgumentParser(description="Coverage and gap analysis")
    ap.add_argument("--markdown", type=str, default=None,
                    help="Also write a human-readable summary to this path")
    args = ap.parse_args()

    ref = load_json(REFERENCE_PATH)
    ext = load_json(EXTRACTION_PATH)

    # ── Flatten the reference ────────────────────────────────────────────────
    units = {}
    for area in ref["areas"]:
        for u in area["units"]:
            units[u["id"]] = {
                "id": u["id"], "name": u["name"], "area": area["name"],
                "area_id": area["id"], "core": u.get("core", False),
                "expected_bloom": u.get("expected_bloom", ""),
                "courses": [],
            }

    # ── Fold in the mappings ─────────────────────────────────────────────────
    for course in ext["courses"]:
        for m in course["mapped"]:
            uid = m["unit_id"]
            if uid in units:
                units[uid]["courses"].append({
                    "code": course["code"],
                    "semester": course.get("semester"),
                    "bloom": m.get("bloom_level", ""),
                    "depth": m.get("depth", ""),
                    "confidence": m.get("confidence", 0.0),
                })

    # ── Gaps ─────────────────────────────────────────────────────────────────
    gaps = [u for u in units.values() if not u["courses"]]
    core_gaps = [u for u in gaps if u["core"]]

    # ── Overlap ──────────────────────────────────────────────────────────────
    overlap = sorted(
        (u for u in units.values() if len(u["courses"]) >= 3),
        key=lambda u: -len(u["courses"]),
    )

    # ── Bloom shortfall: taught, but never above the expected level ──────────
    shortfall = []
    for u in units.values():
        if not u["courses"] or not u["expected_bloom"]:
            continue
        want = BLOOM_RANK.get(u["expected_bloom"], 0)
        best = max((BLOOM_RANK.get(c["bloom"], 0) for c in u["courses"]), default=0)
        if want and best and best < want:
            shortfall.append({
                "id": u["id"], "name": u["name"], "area": u["area"],
                "expected": u["expected_bloom"], "highest_taught": best,
                "courses": [c["code"] for c in u["courses"]],
            })

    # ── Area-level coverage ──────────────────────────────────────────────────
    by_area = {}
    for u in units.values():
        a = by_area.setdefault(u["area"], {"total": 0, "covered": 0, "core_gaps": 0})
        a["total"] += 1
        if u["courses"]:
            a["covered"] += 1
        elif u["core"]:
            a["core_gaps"] += 1
    for a in by_area.values():
        a["pct"] = round(100.0 * a["covered"] / a["total"], 1) if a["total"] else 0.0

    # ── Method comparison against the existing extraction ────────────────────
    agreement = {}
    if DATA_PATH.exists():
        old = load_json(DATA_PATH)
        old_concepts = {c: set(codes) for c, codes in old.get("concept_index", {}).items()}
        claude_units = {u["id"]: {c["code"] for c in u["courses"]}
                        for u in units.values() if u["courses"]}
        agreement = {
            "existing_concepts": len(old_concepts),
            "reference_units": len(units),
            "reference_units_covered": len(claude_units),
            "note": "Label sets are not directly comparable - the existing run "
                    "produced free-text concepts, this one maps onto fixed unit "
                    "ids. Compare per-course code sets, not label strings.",
        }

    report = {
        "schema": "che-coverage-report/1",
        "counts": {
            "reference_units": len(units),
            "covered": len(units) - len(gaps),
            "gaps": len(gaps),
            "core_gaps": len(core_gaps),
            "bloom_shortfalls": len(shortfall),
        },
        "core_gaps": sorted(core_gaps, key=lambda u: u["id"]),
        "all_gaps": sorted(gaps, key=lambda u: u["id"]),
        "overlap": overlap[:40],
        "bloom_shortfall": shortfall,
        "coverage_by_area": by_area,
        "method_comparison": agreement,
    }
    save_json(report, COVERAGE_PATH)

    # ── Console summary ──────────────────────────────────────────────────────
    c = report["counts"]
    print("\nReference units : {}".format(c["reference_units"]))
    print("Covered         : {}".format(c["covered"]))
    print("Gaps            : {}  (of which {} are CORE)".format(c["gaps"], c["core_gaps"]))
    print("Bloom shortfall : {}".format(c["bloom_shortfalls"]))

    if core_gaps:
        print("\nCORE units no course covers:")
        for u in sorted(core_gaps, key=lambda x: x["id"])[:20]:
            print("  {}  {}  ({})".format(u["id"], u["name"], u["area"]))

    print("\nCoverage by area:")
    for name, a in sorted(by_area.items(), key=lambda kv: kv[1]["pct"]):
        print("  {:>5}%  {:>2}/{:<2}  {}".format(a["pct"], a["covered"], a["total"], name))

    if args.markdown:
        _write_markdown(Path(args.markdown), report)


def _write_markdown(path: Path, report: dict):
    c = report["counts"]
    L = ["# Curriculum coverage against the reference ontology", "",
         "| | |", "|---|---|",
         "| Reference units | {} |".format(c["reference_units"]),
         "| Covered | {} |".format(c["covered"]),
         "| Gaps | {} |".format(c["gaps"]),
         "| Core gaps | {} |".format(c["core_gaps"]),
         "| Bloom shortfalls | {} |".format(c["bloom_shortfalls"]), ""]

    L += ["## Coverage by knowledge area", "",
          "| Area | Covered | Total | % |", "|---|---|---|---|"]
    for name, a in sorted(report["coverage_by_area"].items(), key=lambda kv: kv[1]["pct"]):
        L.append("| {} | {} | {} | {} |".format(name, a["covered"], a["total"], a["pct"]))

    L += ["", "## Core units with no coverage", ""]
    if report["core_gaps"]:
        L += ["| Unit | Name | Area |", "|---|---|---|"]
        for u in report["core_gaps"]:
            L.append("| {} | {} | {} |".format(u["id"], u["name"], u["area"]))
    else:
        L.append("None - every core unit is covered by at least one course.")

    L += ["", "## Most-shared units", ""]
    if report["overlap"]:
        L += ["| Unit | Name | Courses |", "|---|---|---|"]
        for u in report["overlap"][:20]:
            codes = ", ".join(c["code"] for c in u["courses"])
            L.append("| {} | {} | {} |".format(u["id"], u["name"], codes))
    else:
        L.append("No unit is taught by three or more courses.")

    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\nWrote " + str(path))


if __name__ == "__main__":
    main()
