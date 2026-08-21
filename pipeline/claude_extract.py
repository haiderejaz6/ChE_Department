"""
ARTIFACT B — map each course onto the reference knowledge-unit ontology.

Unlike the rule-based and Ollama extractors in excel_to_json.py, this does not
invent a fresh label set per course. It answers a narrower, checkable question:

    "Which units of the reference ontology does this course actually teach,
     at what Bloom level, and on what textual evidence?"

Anything the course teaches that does not fit the reference is returned
separately as `unmapped` — those are the candidates for extending the
reference, and reviewing them is how you tell a genuine omission in the
reference from a genuinely odd course.

Run (needs reference_ontology.json to exist first):
    python pipeline/claude_extract.py
    python pipeline/claude_extract.py --limit 3        # smoke-test on 3 courses
    python pipeline/claude_extract.py --only CHE-346
"""

import argparse
from pathlib import Path
from typing import List

from pydantic import BaseModel, Field

from claude_common import (EXTRACTION_PATH, REFERENCE_PATH, call_parsed,
                           get_client, load_json, save_json)

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
DATA_PATH = _REPO_ROOT / "data.json"
COURSES_DIR = _REPO_ROOT / "courses"

BLOOM = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]


# ── Response schema ───────────────────────────────────────────────────────────

class Mapping(BaseModel):
    unit_id: str = Field(description="Knowledge unit id from the reference, e.g. KU-03.02")
    bloom_level: str = Field(description="Level this course teaches it at, one of: " + ", ".join(BLOOM))
    depth: str = Field(description="primary if a main focus of the course, secondary if only touched on")
    evidence: str = Field(description="Short quote or close paraphrase from the CLO/outline justifying this mapping")
    confidence: float = Field(description="0.0 to 1.0")


class Unmapped(BaseModel):
    label: str = Field(description="Topic taught here that no reference unit covers, 2-4 words")
    evidence: str = Field(description="Text supporting it")
    suggestion: str = Field(description="Which reference area it would belong under, or none if outside the discipline")


class CourseMapping(BaseModel):
    mapped: List[Mapping]
    unmapped: List[Unmapped]
    is_non_technical: bool = Field(description="True for language/humanities/ideology/general-studies courses with no ChemE content")


# ── Prompts ───────────────────────────────────────────────────────────────────

_SYSTEM_TEMPLATE = """\
You are a senior chemical engineering academic auditing a curriculum against an
accreditation reference.

Below is the REFERENCE KNOWLEDGE-UNIT ONTOLOGY. It is fixed. Your task is to
decide which of its units a given course actually teaches.

{ontology}

RULES:
1. Only cite unit ids that appear in the reference above. Never invent an id.
2. Map a unit only when the course genuinely teaches it. A passing mention in
   one CLO is not coverage - mark it "secondary" at most, or leave it out.
   Under-mapping is a much smaller problem than over-mapping: a false mapping
   hides a real curriculum gap, which is exactly what this audit exists to find.
3. bloom_level is what THIS course demands, read from the CLO action verbs -
   not the level the reference says a graduate should eventually reach.
4. Every mapping needs evidence grounded in the course text supplied. If you
   cannot quote something, do not make the mapping.
5. Anything substantial the course teaches that no reference unit covers goes in
   unmapped. Do not force it into an approximate unit.
6. Non-technical courses (language, humanities, ideology, sociology, religious
   studies, constitution, expository writing) should set is_non_technical true
   and return empty lists.
"""

_USER_TEMPLATE = """\
Course code: {code}
Course title: {title}

Course learning outcomes:
{clo_block}
{file_block}
Audit this course against the reference ontology.
"""


def _ontology_digest(ref: dict) -> str:
    """Flatten the reference into a compact block for the system prompt."""
    lines = []
    for area in ref["areas"]:
        lines.append("")
        lines.append("## {} - {}".format(area["id"], area["name"]))
        lines.append("   " + area["description"])
        for unit in area["units"]:
            tag = "CORE" if unit.get("core") else "elective"
            lines.append("   - {} [{}] {}: {}".format(
                unit["id"], tag, unit["name"], unit["description"]))
            topics = ", ".join(t["name"] for t in unit.get("topics", []))
            if topics:
                lines.append("       topics: " + topics)
    return "\n".join(lines)


def _load_course_file(code: str) -> str:
    for ext in (".md", ".markdown", ".txt", ""):
        p = COURSES_DIR / (code + ext)
        if p.exists() and p.is_file():
            return p.read_text(encoding="utf-8", errors="replace")
    return ""


def main():
    ap = argparse.ArgumentParser(description="Map courses onto the reference ontology")
    ap.add_argument("--limit", type=int, default=None, help="Only process the first N courses")
    ap.add_argument("--only", type=str, default=None, help="Only this course code")
    ap.add_argument("--char-limit", type=int, default=6000, help="Max course-file chars sent (default 6000)")
    args = ap.parse_args()

    ref = load_json(REFERENCE_PATH)
    data = load_json(DATA_PATH)
    valid_ids = {u["id"] for a in ref["areas"] for u in a["units"]}

    system = _SYSTEM_TEMPLATE.format(ontology=_ontology_digest(ref))
    print("Reference: {} areas, {} units".format(len(ref["areas"]), len(valid_ids)))

    courses = data["courses"]
    if args.only:
        courses = [c for c in courses if c["code"].upper() == args.only.upper()]
        if not courses:
            print("ERROR: no course with code " + args.only)
            return
    if args.limit:
        courses = courses[:args.limit]

    client = get_client()
    results, hallucinated = [], []

    for i, course in enumerate(courses, 1):
        code = course["code"]
        clo_block = "\n".join(
            "  - [{}] {}".format(c.get("domain", ""), c.get("description", ""))
            for c in course.get("clos", [])
        ) or "  (none recorded)"

        file_text = _load_course_file(code)
        file_block = ""
        if file_text:
            file_block = "\nCourse outline:\n" + file_text[:args.char_limit] + "\n"

        print("[{}/{}] {} - {}".format(i, len(courses), code, course["title"]))
        mapping = call_parsed(
            client,
            system=system,
            user=_USER_TEMPLATE.format(code=code, title=course["title"],
                                       clo_block=clo_block, file_block=file_block),
            output_format=CourseMapping,
            cache_system=True,
            label=code,
        )

        # Drop any unit id not in the reference. Rule 1 says never invent one;
        # this enforces it rather than trusting it.
        clean = []
        for m in mapping.mapped:
            if m.unit_id in valid_ids:
                clean.append(m.model_dump())
            else:
                hallucinated.append({"course": code, "unit_id": m.unit_id})

        results.append({
            "code": code,
            "title": course["title"],
            "semester": course.get("semester"),
            "is_non_technical": mapping.is_non_technical,
            "mapped": clean,
            "unmapped": [u.model_dump() for u in mapping.unmapped],
            "had_course_file": bool(file_text),
        })

    save_json({
        "schema": "che-curriculum-mapping/1",
        "reference_schema": ref.get("schema"),
        "model": "claude-opus-5",
        "status": "pending_validation",
        "invalid_unit_ids_dropped": hallucinated,
        "courses": results,
    }, EXTRACTION_PATH)

    total = sum(len(c["mapped"]) for c in results)
    unmapped = sum(len(c["unmapped"]) for c in results)
    print("\n{} courses - {} mappings, {} unmapped topics".format(
        len(results), total, unmapped))
    if hallucinated:
        print("WARNING: dropped {} invalid unit ids: {}".format(
            len(hallucinated), hallucinated[:5]))


if __name__ == "__main__":
    main()
