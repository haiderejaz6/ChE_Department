"""
build_curriculum_ontology.py
=============================================================================
PURPOSE
    Converts your existing curriculum data (data.json, produced by
    excel_to_json.py from Qalam_CLOs.xlsx) into a formal OWL ontology file
    (.owl, RDF/XML format) that can be opened directly in Protege, queried
    with SPARQL/DL Query, and checked for logical consistency with a
    reasoner (HermiT/Pellet).

    This does NOT replace data.json or the dashboard. It's a parallel,
    formal representation of the same curriculum data, built specifically
    so you can make a "Formal Curriculum Ontology" contribution section in
    the paper, separate from the extraction pipeline and voting study.

    This version is written directly against YOUR real data.json schema
    (confirmed by inspecting the uploaded file), which looks like:

    {
      "plos": {"PLO-1": "Engineering Knowledge", "PLO-2": "...", ...},
      "courses": [
        {
          "code": "CHE-103",
          "title": "Chemical Engineering Principles-I",
          "batch": "2025F",
          "semester": 1,
          "lec": 2,
          "lab": 0,
          "clos": [
            {
              "code": "CLO-1",
              "plo": "PLO-1",
              "emphasis": "Low",
              "domain": "C-2",
              "description": "Comprehend the basic concepts of ...",
              "concepts": ["process principles", "stoichiometric calculations"]
            }
          ],
          "concepts": ["energy balance", "thermodynamics", ...]
        }
      ],
      "concept_index": {"heat transfer": ["CHE-222", "CHE-223", ...], ...},
      "concept_mode": "both",
      "semesters": {"1": ["CHE-103", "CS-117", ...], "2": [...], ...}
    }

    Notable real-schema quirks this script handles:
      - plos is a DICT of id -> short title, not a list of objects.
      - each CLO has ONE plo id (a string), not a list of PLOs.
      - "domain" is a Bloom's TAXONOMY DOMAIN + LEVEL code, e.g. "C-2" =
        Cognitive domain, level 2. Codes seen in your data: C-2..C-6
        (Cognitive/Bloom's), A-2..A-3 (Affective/Krathwohl), P-1..P-7
        (Psychomotor/Simpson) - this is standard OBE practice (CLOs can
        target cognitive, affective, or psychomotor domains, not just
        Bloom's cognitive levels), so the ontology models THREE taxonomy
        families, not one flat Bloom's list.
      - concepts (knowledge areas) are already flat strings on both the
        CLO and the course level.
      - there is NO prerequisites field yet in your data - matches your
        project notes that prerequisite data is still being gathered.
        The hasPrerequisite property and cycle-checker are still defined
        below so you can wire them in the moment that data exists (e.g.
        once you add a "prerequisites" list per course, or a Prerequisites
        column to the source Excel), with zero other changes needed here.
      - "semesters" is a redundant top-level index (semester number ->
        list of course codes) that should agree with each course's own
        "semester" field. We cross-check this and warn on mismatches -
        useful as another automatic data-quality check, in the same
        spirit as your filename/course-code mismatch findings.
      - "concept_index" is a redundant reverse index (concept -> courses
        covering it). We cross-check it against the concepts actually
        listed under each course as another free consistency check.

-----------------------------------------------------------------------------
STEP-BY-STEP: WHAT THIS SCRIPT DOES AND WHY (read this before running)
-----------------------------------------------------------------------------

STEP 1 - DEFINE THE TBOX (the schema / vocabulary)
    We define these classes:
        Course              - a single course (e.g. CHE-222)
        KnowledgeArea       - a Knowledge Unit/Area (your "concepts")
        CLO                 - a Course Learning Outcome
        PLO                 - a Program Learning Outcome
        TaxonomyLevel       - one level in ONE of the three OBE taxonomy
                               domains (Cognitive/Affective/Psychomotor),
                               e.g. "Cognitive level 2 (Understand)"
        Program             - the degree program (BE Chemical Engineering)
        Semester            - a semester/term (1-8) in the study plan

    And these object properties (relations between individuals):
        hasPrerequisite     - Course -> Course   (defined now, populated
                               later once prerequisite data exists)
        hasCLO              - Course -> CLO
        cloMapsToPLO        - CLO -> PLO           (functional: 1 PLO/CLO,
                               matching your schema's single "plo" field)
        cloCoversKA         - CLO -> KnowledgeArea (can be many)
        cloAtTaxonomyLevel  - CLO -> TaxonomyLevel  (functional)
        offeredInSemester   - Course -> Semester    (functional)

    And data properties:
        courseCode, courseTitle, lecHours, labHours, batch (Course)
        cloCode, cloText, cloEmphasis (CLO)
        ploText (PLO)
        kaName (KnowledgeArea)
        taxonomyDomain ("Cognitive"/"Affective"/"Psychomotor"), taxonomyRank
        (int level within that domain), taxonomyLevelName ("Understand"),
        taxonomyCode (the raw code, e.g. "C-2")   (TaxonomyLevel)
        semesterNumber (Semester)

STEP 2 - DEFINE THE ABOX (the actual data / individuals)
    Reads data.json and creates one OWL individual per course, CLO, PLO,
    knowledge area, semester, and taxonomy level, then links them via the
    object properties above.

STEP 3 - ADD LOGICAL AXIOMS / CONSTRAINTS
    hasPrerequisite is Irreflexive + Asymmetric so a reasoner flags direct
    contradictions once you populate it. cloMapsToPLO and
    cloAtTaxonomyLevel are FunctionalProperty (matches your data: one PLO
    and one taxonomy level per CLO).

STEP 4 - CROSS-CHECK DATA QUALITY (Python-side, no reasoner needed)
    - semesters index vs. each course's own "semester" field
    - concept_index vs. each course's own "concepts" list
    - any CLO "plo" id that isn't in the top-level plos dict
    - any CLO "domain" code we don't recognize
    These are cheap, deterministic checks worth reporting in the paper as
    evidence of ontology-driven data validation.

STEP 5 - SAVE AS .owl AND OPEN IN PROTEGE
    Opens directly via File > Open in Protege. Run a reasoner there
    (Reasoner menu -> HermiT, needs Java installed locally) to check
    logical consistency and try DL Queries against competency questions.

STEP 6 - (OPTIONAL, ON YOUR MACHINE) RUN THE REASONER
    Requires local Java. Use --run-reasoner, or run it from within
    Protege after opening the .owl file.

-----------------------------------------------------------------------------
Run with:
    pip install owlready2 --break-system-packages
    python build_curriculum_ontology.py --input data.json --output che_curriculum.owl
=============================================================================
"""

import argparse
import json
import re
import sys
from pathlib import Path

from owlready2 import (
    Thing,
    ObjectProperty,
    DataProperty,
    FunctionalProperty,
    IrreflexiveProperty,
    AsymmetricProperty,
    get_ontology,
    sync_reasoner,
    Nothing,
    AllDisjoint,
    default_world,
)

# =============================================================================
# CONFIG - field names, matched to your real data.json (edit if it evolves)
# =============================================================================
FIELD_MAP = {
    "plos_key": "plos",                  # dict: {plo_id: plo_title}
    "courses_key": "courses",
    "course_code": "code",
    "course_title": "title",
    "course_batch": "batch",
    "course_semester": "semester",       # int, 1-8
    "course_lec": "lec",
    "course_lab": "lab",
    "course_prerequisites": "prerequisites",  # NOT present yet in your data;
                                               # add this key per-course once
                                               # prerequisite data is ready.
    "course_concepts": "concepts",       # course-level aggregate concepts
    "clos": "clos",
    "clo_code": "code",
    "clo_plo": "plo",                    # single id string, not a list
    "clo_domain": "domain",              # e.g. "C-2", "A-3", "P-7"
    "clo_emphasis": "emphasis",          # "Low" / "Medium" / "High"
    "clo_text": "description",
    "clo_concepts": "concepts",
    "semesters_key": "semesters",        # dict: {"1": [course codes...]}
    "concept_index_key": "concept_index",  # dict: {concept: [course codes]}
}

# Three OBE taxonomy domains and their standard level names. Your data's
# "domain" codes (e.g. "C-2") are DOMAIN_LETTER-LEVEL_NUMBER.
TAXONOMY_LEVELS = {
    "C": {  # Cognitive (Bloom's revised taxonomy)
        "name": "Cognitive",
        "levels": {1: "Remember", 2: "Understand", 3: "Apply",
                   4: "Analyze", 5: "Evaluate", 6: "Create"},
    },
    "A": {  # Affective (Krathwohl)
        "name": "Affective",
        "levels": {1: "Receiving", 2: "Responding", 3: "Valuing",
                   4: "Organizing", 5: "Characterizing"},
    },
    "P": {  # Psychomotor (Simpson)
        "name": "Psychomotor",
        "levels": {1: "Perception", 2: "Set", 3: "Guided Response",
                   4: "Mechanism", 5: "Complex Overt Response",
                   6: "Adaptation", 7: "Origination"},
    },
}


def slugify(text: str) -> str:
    """Turn arbitrary text into a safe OWL individual name (IRI fragment)."""
    text = str(text).strip()
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^A-Za-z0-9_\-]", "", text)
    return text or "unnamed"


def load_data(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_domain_code(code: str):
    """
    "C-2" -> ("C", 2). Returns (None, None) if the code doesn't match the
    expected DOMAIN_LETTER-LEVEL_NUMBER pattern, so callers can warn and
    skip rather than crash on unexpected data.
    """
    if not code:
        return None, None
    m = re.match(r"^([CAP])-(\d+)$", code.strip())
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def build_schema(onto):
    """STEP 1: Define classes, object properties, data properties (the TBox)."""
    with onto:

        class Course(Thing):
            pass

        class KnowledgeArea(Thing):
            pass

        class CLO(Thing):
            pass

        class PLO(Thing):
            pass

        class TaxonomyLevel(Thing):
            pass

        class Program(Thing):
            pass

        class Semester(Thing):
            pass

        AllDisjoint([Course, KnowledgeArea, CLO, PLO, TaxonomyLevel, Program, Semester])

        # --- Object properties ---------------------------------------------
        # Defined now, populated later once prerequisite data exists (see
        # FIELD_MAP["course_prerequisites"] note above).
        class hasPrerequisite(Course >> Course, IrreflexiveProperty, AsymmetricProperty):
            pass

        class hasCLO(Course >> CLO):
            pass

        class cloMapsToPLO(CLO >> PLO, FunctionalProperty):
            # Functional: your schema gives each CLO exactly one PLO.
            pass

        class cloCoversKA(CLO >> KnowledgeArea):
            pass

        class cloAtTaxonomyLevel(CLO >> TaxonomyLevel, FunctionalProperty):
            pass

        class offeredInSemester(Course >> Semester, FunctionalProperty):
            pass

        class partOfProgram(Course >> Program):
            pass

        # --- Data properties -------------------------------------------------
        class courseCode(Course >> str, FunctionalProperty):
            pass

        class courseTitle(Course >> str, FunctionalProperty):
            pass

        class courseBatch(Course >> str, FunctionalProperty):
            pass

        class lecHours(Course >> int, FunctionalProperty):
            pass

        class labHours(Course >> int, FunctionalProperty):
            pass

        class cloCode(CLO >> str, FunctionalProperty):
            pass

        class cloText(CLO >> str, FunctionalProperty):
            pass

        class cloEmphasis(CLO >> str, FunctionalProperty):
            pass

        class ploText(PLO >> str, FunctionalProperty):
            pass

        class kaName(KnowledgeArea >> str, FunctionalProperty):
            pass

        class taxonomyDomain(TaxonomyLevel >> str, FunctionalProperty):
            pass

        class taxonomyRank(TaxonomyLevel >> int, FunctionalProperty):
            pass

        class taxonomyLevelName(TaxonomyLevel >> str, FunctionalProperty):
            pass

        class taxonomyCode(TaxonomyLevel >> str, FunctionalProperty):
            pass

        class semesterNumber(Semester >> int, FunctionalProperty):
            pass

    return onto


def get_or_create(cls, cache, key, **data_props):
    if key in cache:
        return cache[key]
    ind = cls(slugify(key))
    for prop, val in data_props.items():
        setattr(ind, prop, val)
    cache[key] = ind
    return ind


def build_taxonomy_levels(onto):
    """Pre-create all 6+5+7 = 18 standard taxonomy level individuals."""
    TaxonomyLevel = onto.TaxonomyLevel
    cache = {}
    for letter, info in TAXONOMY_LEVELS.items():
        for rank, name in info["levels"].items():
            code = f"{letter}-{rank}"
            t = TaxonomyLevel(f"Taxonomy_{code}")
            t.taxonomyDomain = info["name"]
            t.taxonomyRank = rank
            t.taxonomyLevelName = name
            t.taxonomyCode = code
            cache[code] = t
    return cache


def build_abox(onto, data: dict):
    """STEP 2: Populate individuals and relations from data.json (the ABox)."""
    Course, KnowledgeArea, CLO, PLO = onto.Course, onto.KnowledgeArea, onto.CLO, onto.PLO
    Semester = onto.Semester

    fm = FIELD_MAP
    ka_cache, course_cache, sem_cache = {}, {}, {}
    taxonomy_cache = build_taxonomy_levels(onto)

    # --- PLOs: dict of {id: title} in your schema -------------------------
    plo_cache = {}
    for pid, ptitle in data.get(fm["plos_key"], {}).items():
        get_or_create(PLO, plo_cache, pid, ploText=ptitle)

    # --- Semesters 1-8 ------------------------------------------------------
    for sem_str in data.get(fm["semesters_key"], {}).keys():
        try:
            sem_num = int(sem_str)
        except ValueError:
            continue
        get_or_create(Semester, sem_cache, sem_str, semesterNumber=sem_num)

    # --- Courses (first pass: create individuals) ---------------------------
    for c in data.get(fm["courses_key"], []):
        code = c.get(fm["course_code"])
        if not code:
            continue
        course = get_or_create(Course, course_cache, code, courseCode=code)
        course.courseTitle = c.get(fm["course_title"], "")
        course.courseBatch = c.get(fm["course_batch"], "")
        for hour_field, prop_name in ((fm["course_lec"], "lecHours"), (fm["course_lab"], "labHours")):
            val = c.get(hour_field)
            if val is not None:
                try:
                    setattr(course, prop_name, int(val))
                except (TypeError, ValueError):
                    pass

        sem_val = c.get(fm["course_semester"])
        if sem_val is not None and str(sem_val) in sem_cache:
            course.offeredInSemester = sem_cache[str(sem_val)]
        elif sem_val is not None:
            print(f"[WARN] {code}: semester {sem_val} has no matching Semester individual")

    # --- Courses (second pass: CLOs, prerequisites, cross-checks) -----------
    for c in data.get(fm["courses_key"], []):
        code = c.get(fm["course_code"])
        if not code or code not in course_cache:
            continue
        course = course_cache[code]

        # Prerequisites: not present in your data yet. This loop is a no-op
        # today and will "just work" once a "prerequisites" list of course
        # codes is added per course - no other code changes needed.
        for prereq_code in c.get(fm["course_prerequisites"], []) or []:
            prereq = course_cache.get(prereq_code)
            if prereq is None:
                print(f"[WARN] {code}: prerequisite '{prereq_code}' not found among courses")
                continue
            course.hasPrerequisite.append(prereq)

        # Course-level concepts (aggregate knowledge areas)
        for ka_name_val in c.get(fm["course_concepts"], []) or []:
            get_or_create(KnowledgeArea, ka_cache, ka_name_val, kaName=ka_name_val)

        # CLOs
        for clo in c.get(fm["clos"], []) or []:
            clo_code = clo.get(fm["clo_code"], f"CLO{len(course.hasCLO) + 1}")
            clo_ind = CLO(slugify(f"{code}_{clo_code}"))
            clo_ind.cloCode = clo_code
            clo_ind.cloText = clo.get(fm["clo_text"], "")
            clo_ind.cloEmphasis = clo.get(fm["clo_emphasis"], "")
            course.hasCLO.append(clo_ind)

            plo_id = clo.get(fm["clo_plo"])
            if plo_id and plo_id in plo_cache:
                clo_ind.cloMapsToPLO = plo_cache[plo_id]
            elif plo_id:
                print(f"[WARN] {code}/{clo_code}: PLO '{plo_id}' not found in top-level plos")

            domain_code = clo.get(fm["clo_domain"])
            letter, rank = parse_domain_code(domain_code)
            tax_key = f"{letter}-{rank}" if letter else None
            if tax_key and tax_key in taxonomy_cache:
                clo_ind.cloAtTaxonomyLevel = taxonomy_cache[tax_key]
            elif domain_code:
                print(f"[WARN] {code}/{clo_code}: unrecognized taxonomy code '{domain_code}'")

            for ka_name_val in clo.get(fm["clo_concepts"], []) or []:
                ka = get_or_create(KnowledgeArea, ka_cache, ka_name_val, kaName=ka_name_val)
                clo_ind.cloCoversKA.append(ka)

    print(
        f"Built ABox: {len(course_cache)} courses, {len(ka_cache)} knowledge areas, "
        f"{len(plo_cache)} PLOs, {len(sem_cache)} semesters, {len(taxonomy_cache)} taxonomy levels"
    )
    return course_cache, sem_cache


def check_prereq_cycles(course_cache: dict):
    """Python-side cycle check covering cycles of any length."""
    visiting, visited = set(), set()

    def dfs(course, path):
        if course in visiting:
            cycle = " -> ".join(c.courseCode for c in path + [course])
            print(f"[CYCLE] Prerequisite cycle detected: {cycle}")
            return
        if course in visited:
            return
        visiting.add(course)
        for prereq in course.hasPrerequisite:
            dfs(prereq, path + [course])
        visiting.discard(course)
        visited.add(course)

    for course in course_cache.values():
        dfs(course, [])


def check_semesters_index(data: dict, course_cache: dict):
    """
    Cross-checks the top-level 'semesters' index against each course's own
    'semester' field. Reports courses that disagree between the two, and
    courses missing from the index entirely.
    """
    fm = FIELD_MAP
    sem_index = data.get(fm["semesters_key"], {})
    mismatches, missing = 0, 0
    for c in data.get(fm["courses_key"], []):
        code = c.get(fm["course_code"])
        own_sem = str(c.get(fm["course_semester"]))
        listed_in = [s for s, codes in sem_index.items() if code in codes]
        if not listed_in:
            print(f"[WARN] semesters index: {code} not listed in any semester bucket")
            missing += 1
        elif own_sem not in listed_in:
            print(f"[WARN] semesters index: {code} has semester={own_sem} but appears under {listed_in}")
            mismatches += 1
    print(f"Semesters index check: {mismatches} mismatches, {missing} missing entries")


def check_concept_index(data: dict):
    """
    Cross-checks the top-level 'concept_index' (concept -> course codes)
    against the concepts actually listed on each course.
    """
    fm = FIELD_MAP
    concept_index = data.get(fm["concept_index_key"], {})
    course_concepts = {
        c.get(fm["course_code"]): set(c.get(fm["course_concepts"], []) or [])
        for c in data.get(fm["courses_key"], [])
    }
    problems = 0
    for concept, codes in concept_index.items():
        for code in codes:
            if code not in course_concepts:
                print(f"[WARN] concept_index: '{concept}' references unknown course '{code}'")
                problems += 1
            elif concept not in course_concepts[code]:
                print(f"[WARN] concept_index: '{concept}' lists {code}, but {code}'s own concepts don't include it")
                problems += 1
    print(f"Concept index check: {problems} inconsistencies")


def run_reasoner():
    """STEP 6 (optional, run locally where Java is installed)."""
    try:
        with default_world:
            sync_reasoner()
        print("Reasoner ran successfully - no inconsistencies detected.")
    except Exception as e:
        print(f"[REASONER] Could not run (is Java installed?): {e}")


def main():
    parser = argparse.ArgumentParser(description="Build a curriculum OWL ontology from data.json")
    parser.add_argument("--input", type=Path, default=Path("data.json"))
    parser.add_argument("--output", type=Path, default=Path("che_curriculum.owl"))
    parser.add_argument("--iri", type=str, default="http://nust.edu.pk/scme/che-curriculum-ontology")
    parser.add_argument("--run-reasoner", action="store_true", help="Attempt to run HermiT (needs local Java)")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: input file not found: {args.input}")
        sys.exit(1)

    data = load_data(args.input)

    onto = get_ontology(args.iri)
    build_schema(onto)
    course_cache, sem_cache = build_abox(onto, data)

    print("\nRunning Python-side data-quality checks...")
    check_prereq_cycles(course_cache)
    check_semesters_index(data, course_cache)
    check_concept_index(data)

    onto.save(file=str(args.output), format="rdfxml")
    print(f"\nSaved ontology to {args.output} - open this file directly in Protege (File > Open...).")

    if args.run_reasoner:
        print("\nAttempting to run HermiT reasoner (requires Java)...")
        run_reasoner()


if __name__ == "__main__":
    main()
