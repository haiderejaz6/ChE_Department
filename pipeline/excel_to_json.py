"""
excel_to_json.py  (Windows-compatible)
========================================
Converts Qalam_CLOs.xlsx → data.json for the SCME OBE Dashboard.

NEW in this version
-------------------
• Reads Semester, Lec, Lab columns directly from the Excel (no SEMESTER_MAP needed).
• Windows-compatible paths — uses pathlib; works in any CMD / PowerShell.
• Shebang line is commented out (not needed on Windows).
• Course files (converted course-outline Markdown, one per course code) are now
  loaded from COURSE_FILES_DIR and merged with CLO text before topic/concept
  extraction, so generated topics reflect the full course content — not just
  the CLOs. Missing course files degrade gracefully to CLO-only extraction.
• KNOWLEDGE-GRAPH EDGES: when LLM mode is active, each course's Ollama call now
  extracts topics AND the sequencing relationships between them in one shot
  (schema: course["topics"] = [{id, label, bloom_level}], course["edges"] =
  [{source, target, type, rationale, confidence}], type is one of
  prerequisite_of / corequisite_with / related_to). Topics and edges are
  written out with status="pending_validation" so they can be fed straight
  into a combined CLO+edge teacher-voting instrument (topics and edges are
  validated in the same session, against the same graph). Edges are
  within-course only for now — cross-course edges are a documented follow-up
  once prerequisite data is wired in (see match_course_file / COURSE_FILES_DIR).
  Rule-only mode does not produce edges (no LLM = no sequencing judgement),
  so course["edges"] is [] when --mode rule is used.

Two extraction modes are supported and can be combined:

  --mode rule   Fast regex/vocabulary extraction (no LLM, always runs).
  --mode llm    LLM extraction via a local Ollama server (requires Ollama).
  --mode both   Run rule extraction first, then overlay LLM results (default).

Usage
-----
    # Rule-only (fast, no Ollama needed) — recommended for CI
    python excel_to_json.py --mode rule

    # LLM only
    python excel_to_json.py --mode llm

    # Best of both (default)
    python excel_to_json.py

    # Point at a different course-files directory
    python excel_to_json.py --course-files-dir "D:\\some\\other\\path"

Dependencies
------------
    pip install pandas openpyxl requests

On Windows, install via:
    py -m pip install pandas openpyxl requests
"""

import re
import json
import sys
import argparse
import requests
from pathlib import Path
from collections import defaultdict

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
# The script is expected to sit in the repo root (or a scripts/ sub-folder).
# Override EXCEL_PATH / OUTPUT_PATH if your layout differs.
_SCRIPT_DIR = Path(__file__).resolve().parent
# Try repo-root first, then same folder as the script
_REPO_ROOT   = _SCRIPT_DIR.parent if (_SCRIPT_DIR / "..").is_dir() else _SCRIPT_DIR

EXCEL_PATH  = _REPO_ROOT / "Qalam_CLOs.xlsx"
# If the xlsx is in the same folder as the script, use this instead:
if not EXCEL_PATH.exists():
    EXCEL_PATH = _SCRIPT_DIR / "Qalam_CLOs.xlsx"

SHEET_NAME  = "Qalam_CLOs"
OUTPUT_PATH = _REPO_ROOT / "data.json"
if not OUTPUT_PATH.parent.exists():
    OUTPUT_PATH = _SCRIPT_DIR / "data.json"

# ── Course files (converted course-outline Markdown, one per course code) ─────
# Default location — override at runtime with --course-files-dir if needed.
COURSE_FILES_DIR = _REPO_ROOT / "courses"
# Extensions to look for, in priority order, when matching a course code to a file.
# A bare filename with no extension (e.g. "CHE-401") is also matched.
COURSE_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ""]
# Cap how much course-file text is fed into the LLM prompt (keeps calls fast/cheap).
COURSE_FILE_LLM_CHAR_LIMIT = 4000

# Ollama settings
OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "llama3"
OLLAMA_TIMEOUT = 120          # seconds per course call

# ── Column names in the Qalam export ──────────────────────────────────────────
COL_SEMESTER    = "Semester"
COL_LEC         = "Lec"
COL_LAB         = "Lab"
COL_SCHEME_LINE = "Scheme Line"   # "CHE-425 - Maintenance & Process Safety"
COL_CLO_CODE    = "CLO Code"
COL_BATCH       = "Program Batch"
COL_PLO         = "PLO"
COL_EMPHASIS    = "Emphasis Level"
COL_DOMAIN      = "Domain Level"
COL_DESCRIPTION = "Description"

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
# ──────────────────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════════
#  NORMALISATION HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def normalise_plo(raw: str) -> str:
    raw = str(raw).strip()
    m = re.match(r"PLO[\s\-_]?(\d+)", raw, re.IGNORECASE)
    return f"PLO-{m.group(1)}" if m else raw

def normalise_domain(raw: str) -> str:
    raw = str(raw).strip()
    m = re.match(r"([CcPpAa])[\s\-_]?(\d)", raw)
    return f"{m.group(1).upper()}-{m.group(2)}" if m else raw

def extract_batch(program_batch: str) -> str:
    """'SCME/BCHMLE/2022F' → '2022F'"""
    parts = str(program_batch).strip().split("/")
    return parts[-1] if parts else program_batch

def extract_course_code(scheme_line: str) -> str:
    """'CHE-425 - Maintenance & Process Safety' → 'CHE-425'"""
    m = re.match(r"(\S+)", str(scheme_line).strip())
    return m.group(1).lstrip("\u2060\u200b\ufeff") if m else scheme_line.strip()

def extract_course_title(scheme_line: str) -> str:
    """'CHE-425 - Maintenance & Process Safety' → 'Maintenance & Process Safety'"""
    parts = str(scheme_line).strip().split(" - ", 1)
    return parts[1].strip() if len(parts) > 1 else scheme_line.strip()

def _normalise_code_key(code: str) -> str:
    """Normalise a course code for matching purposes: 'che-401 ' → 'CHE-401'."""
    return re.sub(r"\s+", "", str(code).strip()).upper()

# ═══════════════════════════════════════════════════════════════════════════════
#  COURSE FILE LOADING  (merges course-outline content into topic extraction)
# ═══════════════════════════════════════════════════════════════════════════════

def load_course_files(course_files_dir: Path) -> dict:
    """
    Scan course_files_dir for files named after course codes (e.g. 'CHE-401',
    'CHE-401.md', 'CH-113.txt') and return {NORMALISED_CODE: text_content}.

    Returns an empty dict (with a warning) if the directory doesn't exist —
    callers must fall back to CLO-only extraction in that case.
    """
    course_texts: dict = {}

    if not course_files_dir or not course_files_dir.exists():
        print(f"  [course files] Directory not found — skipping: {course_files_dir}")
        return course_texts

    if not course_files_dir.is_dir():
        print(f"  [course files] Not a directory — skipping: {course_files_dir}")
        return course_texts

    candidates = [p for p in course_files_dir.iterdir() if p.is_file()]
    for path in candidates:
        # Stem without extension acts as the course-code key, e.g.
        # "CHE-401.md" → "CHE-401", "CH-113" → "CH-113"
        key = _normalise_code_key(path.stem)
        if not key:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            print(f"    [course files] Could not read {path.name}: {e}")
            continue
        text = text.strip()
        if not text:
            continue
        # If the same code appears with multiple extensions, prefer the first
        # one found among COURSE_FILE_EXTENSIONS priority order.
        if key in course_texts:
            continue
        course_texts[key] = text

    print(f"  [course files] Loaded {len(course_texts)} file(s) from {course_files_dir}")
    return course_texts

def match_course_file(course_code: str, course_texts: dict) -> str:
    """
    Look up course-file text for a given course code. Returns '' if no match
    is found, so callers can fall back to CLO-only extraction gracefully.
    """
    return course_texts.get(_normalise_code_key(course_code), "")

# ═══════════════════════════════════════════════════════════════════════════════
#  RULE-BASED EXTRACTION  (fast, offline, deterministic)
# ═══════════════════════════════════════════════════════════════════════════════

RULE_PATTERNS = [
    # Transport / Thermodynamics
    (r"heat\s+transfer",                          "heat transfer"),
    (r"mass\s+transfer",                          "mass transfer"),
    (r"momentum\s+transfer",                      "momentum transfer"),
    (r"transport\s+phenomena",                    "transport phenomena"),
    (r"simultaneous\s+heat\s+and\s+mass",         "heat transfer"),
    (r"coupled\s+heat\s+and\s+mass",              "heat transfer"),
    (r"heat\s+(and\s+)?mass\s+transport",         "heat transfer"),
    (r"heat\s+exchanger",                         "heat exchanger"),
    (r"\bconduction\b",                           "conduction"),
    (r"\bconvection\b",                           "convection"),
    (r"\bradiation\b",                            "radiation"),
    (r"energy\s+balance",                         "energy balance"),
    (r"mass\s+balance",                           "mass balance"),
    (r"momentum\s+balance",                       "momentum balance"),
    (r"thermo\w+",                                "thermodynamics"),
    (r"phase\s+equilibri\w+",                     "phase equilibrium"),
    (r"equation\s+of\s+state",                    "thermodynamics"),
    (r"\benthalpy\b|\bentropy\b",                 "thermodynamics"),
    # Fluid Mechanics
    (r"fluid\s+(mechanics|dynamics|flow)\b",      "fluid mechanics"),
    (r"turbulent\s+flow|laminar\s+flow",          "fluid mechanics"),
    (r"pipe\s+flow|boundary\s+layer",             "fluid mechanics"),
    (r"reynolds\s+number",                        "fluid mechanics"),
    # Reaction Engineering
    (r"reaction\s+engineering",                   "reaction engineering"),
    (r"chemical\s+reaction|reaction\s+rate",      "reaction kinetics"),
    (r"reaction\s+kinetics|activation\s+energy",  "reaction kinetics"),
    (r"\barrhenius\b",                            "reaction kinetics"),
    (r"reactor\s+design|ideal\s+reactor",         "reactor design"),
    (r"plug\s+flow\s+reactor|\bpfr\b|\bcstr\b",   "reactor design"),
    (r"batch\s+reactor|residence\s+time",         "reactor design"),
    (r"heterogeneous\s+(catalysis|reaction)",     "heterogeneous catalysis"),
    (r"homogeneous\s+(catalysis|reaction)",       "homogeneous catalysis"),
    (r"catalytic\s+reaction|\bcatalysis\b",       "catalysis"),
    (r"\bselectivity\b|\bconversion\b|\byield\b", "yield"),
    (r"stoichiometr\w+",                          "stoichiometry"),
    # Separation
    (r"separation\s+process",                     "separation"),
    (r"\bdistillation\b",                         "distillation"),
    (r"\babsorption\b",                           "absorption"),
    (r"\badsorption\b",                           "adsorption"),
    (r"liquid.liquid\s+extraction|\bextraction\b","extraction"),
    (r"\bevaporation\b",                          "evaporation"),
    (r"\bdrying\b",                               "drying"),
    (r"\bfiltration\b",                           "filtration"),
    (r"crystalli[sz]ation\b|recrystalli[sz]ation","crystallization"),
    (r"mccabe.?thiele\b",                         "distillation"),
    (r"equilibrium\s+stage",                      "separation"),
    # Process Control
    (r"process\s+control",                        "process control"),
    (r"feedback\s+control|feedforward\s+control", "process control"),
    (r"pid\s+control\w*|proportional.integral",   "PID control"),
    (r"control\s+loop|closed.loop|open.loop",     "process control"),
    (r"transfer\s+function|laplace\s+transform",  "control theory"),
    (r"process\s+dynamics",                       "process dynamics"),
    (r"control\s+theor\w+",                       "control theory"),
    (r"sensor\s+calibrat\w+|process\s+instrumen\w+", "instrumentation"),
    (r"(flow|pressure|temperature|level)\s+(measurement|sensor)", "instrumentation"),
    (r"process\s+variable",                       "instrumentation"),
    # Particulate
    (r"particulate\s+technolog\w+",               "particle technology"),
    (r"particle\s+size\b",                        "particle size"),
    (r"size\s+reduction|grinding|milling|crushing","size reduction"),
    (r"fluidized?\s+bed|fluidis\w+",              "fluidization"),
    (r"tyler\s+mesh",                             "particle size"),
    (r"pneumatic\s+conveying|bulk\s+solid\w*",    "solids handling"),
    # Polymer
    (r"polymer\s+engineering",                    "polymer engineering"),
    (r"polymer\s+(chemistry|classification)|polymeri[sz]ation\b", "polymers"),
    (r"polymer\s+processing",                     "polymer processing"),
    (r"\brheology\b",                             "rheology"),
    (r"viscoelastic\w*",                          "viscoelasticity"),
    (r"glass\s+transition|thermal\s+propert\w+",  "thermal properties"),
    (r"molecular\s+weight",                       "polymers"),
    (r"mechanical\s+propert\w+",                  "mechanical properties"),
    (r"colligative\b",                            "colligative properties"),
    # Data Science / Computing
    (r"machine\s+learning",                       "machine learning"),
    (r"data\s+science",                           "data science"),
    (r"linear\s+algebra",                         "linear algebra"),
    (r"\bprobability\b",                          "probability"),
    (r"\bstatistics\b|statistical\s+anal\w+",     "statistics"),
    (r"data\s+(distribution|analysis|repr\w+)",   "data analysis"),
    (r"\bpython\b",                               "Python"),
    (r"\bmatlab\b",                               "MATLAB"),
    (r"\balgorithm\w*",                           "algorithms"),
    (r"numerical\s+method\w*",                    "numerical methods"),
    (r"mathematical\s+model\w*|quantitative\s+model\w*","mathematical modelling"),
    (r"differential\s+equation\w*",               "differential equations"),
    (r"\bregression\b",                           "regression"),
    (r"optimi[sz]ation\b",                        "optimization"),
    # Safety / Environment
    (r"process\s+safety",                         "process safety"),
    (r"lab\w*\s+safety",                          "lab safety"),
    (r"risk\s+(assessment|management)",           "risk management"),
    (r"hazard\s+anal\w+|\bhazop\b",               "hazard analysis"),
    (r"safety\s+(protocol|sop|procedure|management)","safety management"),
    (r"environmental\s+impact|pollution\s+control","sustainability"),
    (r"\bsustainability\b",                       "sustainability"),
    (r"waste\s+management",                       "waste management"),
    # Economics / Management
    (r"engineering\s+economics",                  "engineering economics"),
    (r"project\s+management",                     "project management"),
    (r"operations?\s+management",                 "operations management"),
    (r"quality\s+control",                        "quality control"),
    (r"decision.making",                          "decision making"),
    (r"\bforecasting\b",                          "forecasting"),
    (r"inventory\s+management",                   "inventory management"),
    (r"net\s+present\s+value|\bnpv\b|cost.benefit","economic analysis"),
    # Chemistry
    (r"organic\s+(chemistry|synthesis|reaction)",  "organic chemistry"),
    (r"inorganic\s+(chemistry|synthesis)",         "inorganic chemistry"),
    (r"chemical\s+synthes\w+",                     "chemical synthesis"),
    (r"\btitration\b",                             "titration"),
    (r"\bchromatography\b",                        "chromatography"),
    (r"\bspectroscopy\b",                          "spectroscopy"),
    (r"process\s+flow|process\s+design",           "process design"),
    (r"process\s+industr\w+",                      "process industry"),
    (r"manufacturing\s+process",                   "manufacturing"),
    # Gas Engineering
    (r"gas\s+(processing|purification)",           "gas processing"),
    (r"gas\s+(drilling|storage|transmission|engineering)|natural\s+gas\b", "gas engineering"),
    # Petroleum
    (r"petroleum\s+refin\w+|crude\s+oil",          "petroleum refining"),
    (r"refinery\s+product\w*|distillate\w*",       "petroleum refining"),
    # Physics / Maths
    (r"newtonian\s+mechanics|\bmechanics\b",       "mechanics"),
    (r"electromagnetic\s+induction",               "electromagnetism"),
    (r"\bthermometry\b",                           "instrumentation"),
    (r"vector\s+calculus|differential\s+calculus|\bintegral\b|\bcalculus\b", "calculus"),
    (r"quantitative\s+reasoning|numerical\s+litera\w+","quantitative reasoning"),
    (r"logical\s+reasoning",                       "logical reasoning"),
    # Lab / Professional
    (r"experimental\s+procedure|data\s+collection","lab practice"),
    (r"lab\w*\s+(conduct|practice|procedure|skill)","lab practice"),
    (r"error\s+analysis",                          "data analysis"),
    (r"\bteamwork\b",                              "teamwork"),
    (r"professionali\w+",                          "professionalism"),
    (r"\bethics?\b",                               "ethics"),
    # Writing / Social
    (r"expository\s+writing|rhetor\w+|writing\s+strateg\w+","academic writing"),
    (r"research\s+method\w*",                      "research methods"),
    (r"\bsociology\b",                             "sociology"),
    (r"human\s+behav\w+",                          "human behaviour"),
    (r"\bideology\b",                              "ideology"),
    (r"\bconstitution\b",                          "constitutional law"),
    # Drawing / CAD
    (r"engineering\s+drawing",                     "engineering drawing"),
    (r"projection\s+theor\w+",                     "projection"),
    (r"\bcad\b|computer\s+aided\s+draw\w+",        "CAD"),
    # CFD / Simulation
    (r"\bcfd\b|computational\s+fluid\s+dynamics",  "CFD"),
    (r"aspen\s+hysys|\bhysys\b|process\s+simulat\w+","process simulation"),
    # Community service / civic
    (r"community\s+service|civic\s+engagement",    "community service"),
    (r"sustainable\s+development",                 "sustainability"),
]

def rule_extract(text: str) -> list:
    text = text.lower()
    text = re.sub(r"[^\w\s\-]", " ", text)
    found: dict = {}
    covered: set = set()
    for pattern, canonical in sorted(RULE_PATTERNS, key=lambda x: -len(x[0])):
        for m in re.finditer(pattern, text):
            span = set(range(m.start(), m.end()))
            if not span.intersection(covered):
                covered.update(span)
                found[canonical] = True
    return sorted(found)

def rule_extract_course(clos: list, course_file_text: str = "") -> list:
    """
    Concepts are derived from BOTH the CLO descriptions AND the matched
    course-file content (if any). course_file_text = "" when no file was
    found for this course, in which case this degrades to CLO-only extraction.
    """
    concepts: set = set()
    for clo in clos:
        concepts.update(rule_extract(clo.get("description", "")))
    if course_file_text:
        concepts.update(rule_extract(course_file_text))
    return sorted(concepts)

# ═══════════════════════════════════════════════════════════════════════════════
#  LLM EXTRACTION  (via local Ollama)
# ═══════════════════════════════════════════════════════════════════════════════

_ANCHOR_VOCAB = sorted({canonical for _, canonical in RULE_PATTERNS})

_EXTRACT_PROMPT = """\
You are a chemical engineering curriculum analyst.

Course title: {title}

All CLO descriptions for this course:
{clo_block}
{file_block}
TASK: Extract the core technical topics this course covers, using BOTH the
CLO descriptions and the course outline content above (when present) as your
combined source of truth.

RULES — follow exactly:
1. Return 6 to 12 concepts.
2. Each concept must be 2 to 4 words — descriptive enough to be understood
   without context.
   GOOD: "heat transfer", "reaction kinetics", "PID control",
         "particle size analysis", "polymer processing", "process safety"
   BAD (too short/vague): "transfer", "kinetics", "control", "analysis"
   BAD (too long): "fundamentals of heat and mass transfer operations"
3. Use standard chemical engineering vocabulary. Prefer terms from this
   reference list when they match: {anchor_sample}
4. Non-technical courses (language, humanities, general studies, religious
   studies, ideology, sociology, constitution, writing) → return empty list.
5. Do NOT invent concepts not grounded in the CLO or course-outline text.
6. Output ONLY valid JSON — no markdown fences, no explanation.

{{"concepts": ["two to four words", ...]}}
"""

# Combined topic + sequencing-edge extraction. This is the prompt actually
# used by llm_extract_course_graph() (the current LLM extraction path).
# _EXTRACT_PROMPT above is kept only as a lighter-weight fallback / reference.
_EXTRACT_GRAPH_PROMPT = """\
You are a chemical engineering curriculum analyst building a knowledge graph.

Course title: {title}

All CLO descriptions for this course:
{clo_block}
{file_block}
TASK: Extract the core technical topics this course covers, AND the
sequencing relationships between them, using BOTH the CLO descriptions and
the course outline content above (when present) as your combined source of
truth. A faculty expert will review every topic and every edge you propose,
so ground each one in the text above — never invent something the text
doesn't support.

STEP 1 — TOPICS
Return 6 to 12 topics. Each topic is an object with:
  "id"          short id: "t1", "t2", "t3", ... unique within this course
  "label"       2 to 4 words, descriptive enough to stand without context.
                GOOD: "heat transfer", "reaction kinetics", "PID control"
                BAD (too short/vague): "transfer", "kinetics", "control"
                BAD (too long): "fundamentals of heat and mass transfer"
  "bloom_level" your best estimate of the cognitive level this topic is
                taught at IN THIS COURSE, based on the CLO action verbs.
                One of: Remember, Understand, Apply, Analyze, Evaluate, Create
Use standard chemical engineering vocabulary. Prefer terms from this
reference list when they match: {anchor_sample}
Non-technical courses (language, humanities, general studies, religious
studies, ideology, sociology, constitution, writing) → return empty
"topics" and empty "edges".

STEP 2 — EDGES  (sequencing relationships WITHIN this course only)
For pairs of topics from Step 1 where a teaching-order relationship
genuinely exists, return an edge object with:
  "source", "target"  topic ids from Step 1. Direction matters: for
                       "prerequisite_of", source must be taught/understood
                       BEFORE target.
  "type"               one of:
                         "prerequisite_of"  - source required before target
                         "corequisite_with" - normally taught together
                         "related_to"       - thematically linked, no
                                              required order
  "rationale"          ONE short sentence (under 20 words) grounding the
                       edge in the CLO/course-outline text above
  "confidence"         your confidence in this edge, a number 0.0 to 1.0
Only propose edges you can justify from the text above. Returning few
edges, or none, is fine if the topics are largely independent. Never
propose an edge from a topic to itself.

Output ONLY valid JSON — no markdown fences, no explanation:
{{"topics": [{{"id": "t1", "label": "two to four words", "bloom_level": "Understand"}}, ...],
  "edges":  [{{"source": "t1", "target": "t2", "type": "prerequisite_of",
               "rationale": "short grounding sentence", "confidence": 0.8}}, ...]}}
"""

_NORMALISE_PROMPT = """\
You are a chemical engineering curriculum analyst.

The list below contains concept labels extracted from multiple courses.
Collapse near-duplicates so the same topic always uses one label.

Rules:
1. Merge synonyms / spelling variants into the most standard, descriptive form.
2. Keep 2–4 words per canonical label.
3. Return a JSON object mapping EVERY input label to its canonical form.
   If a label is already correct, map it to itself.
4. Output ONLY valid JSON — no markdown, no explanation.

Input labels: {raw_list}

{{"mapping": {{"original label": "canonical label", ...}}}}
"""

def _call_ollama(prompt: str) -> str:
    try:
        r = requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=OLLAMA_TIMEOUT,
        )
        return r.json().get("response", "")
    except Exception as e:
        print(f"    [Ollama error] {e}")
        return ""

def _parse_concepts_json(text: str) -> list:
    if not text:
        return []
    for candidate in (text, re.search(r"\{.*?\}", text, re.DOTALL)):
        src = candidate if isinstance(candidate, str) else (candidate.group() if candidate else None)
        if not src:
            continue
        try:
            data = json.loads(src)
            return [c.lower().strip() for c in data.get("concepts", []) if c.strip()]
        except Exception:
            continue
    return []

def llm_extract_course(title: str, clos: list, course_file_text: str = "") -> list:
    import random
    clo_block = "\n".join(
        f"  [{c.get('code','CLO')}] {c.get('description','')}" for c in clos
    )

    file_block = ""
    if course_file_text:
        snippet = course_file_text[:COURSE_FILE_LLM_CHAR_LIMIT]
        file_block = f"\nCourse outline content (from course file):\n{snippet}\n"

    anchor_sample = ", ".join(
        f'"{v}"' for v in random.sample(_ANCHOR_VOCAB, min(30, len(_ANCHOR_VOCAB)))
    )
    raw = _call_ollama(_EXTRACT_PROMPT.format(
        title=title, clo_block=clo_block, file_block=file_block, anchor_sample=anchor_sample
    ))
    concepts = _parse_concepts_json(raw)
    NOISE = {"analysis","control","design","process","system","method",
             "theory","study","concept","principle","application","approach",
             "techniques","overview","introduction","fundamentals"}
    filtered_c = []
    for c in concepts:
        words = c.strip().split()
        if 2 <= len(words) <= 4 and c.lower().strip() not in NOISE:
            filtered_c.append(c.lower().strip())
    if raw:
        print(f"    LLM → {filtered_c}")
    return sorted(set(filtered_c))

_EDGE_TYPES = {"prerequisite_of", "corequisite_with", "related_to"}
_BLOOM_LEVELS = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}
_CONCEPT_NOISE = {"analysis","control","design","process","system","method",
                   "theory","study","concept","principle","application","approach",
                   "techniques","overview","introduction","fundamentals"}

def _parse_graph_json(text: str) -> dict:
    """
    Parse the {"topics": [...], "edges": [...]} payload from the combined
    extraction prompt. Returns {"topics": [], "edges": []} on any failure —
    callers should treat that as "no graph for this course" and move on
    rather than crash the whole run.
    """
    empty = {"topics": [], "edges": []}
    if not text:
        return empty
    for candidate in (text, re.search(r"\{.*\}", text, re.DOTALL)):
        src = candidate if isinstance(candidate, str) else (candidate.group() if candidate else None)
        if not src:
            continue
        try:
            data = json.loads(src)
        except Exception:
            continue
        topics = data.get("topics", [])
        edges  = data.get("edges", [])
        if isinstance(topics, list) and isinstance(edges, list):
            return {"topics": topics, "edges": edges}
    return empty

def llm_extract_course_graph(title: str, clos: list, course_file_text: str = "") -> dict:
    """
    Single Ollama call that extracts BOTH the course's topics and the
    prerequisite/corequisite/related-to edges between them, so CLO topic
    validation and knowledge-graph edge validation can be sent to teachers
    as one combined graph-review item instead of two separate studies.

    Returns:
        {
          "topics": [{"id","label","bloom_level","status"}, ...],
          "edges":  [{"source","target","type","rationale","confidence","status"}, ...],
        }
    Topic labels are filtered exactly like the legacy concept extractor
    (2-4 words, not in the vague-noise list) so downstream normalisation /
    post-normalisation / concept-index code keeps working unchanged. Any
    edge that references a topic id filtered out in that step is dropped
    along with it, so the returned edge set only ever points at valid nodes.
    """
    import random
    clo_block = "\n".join(
        f"  [{c.get('code','CLO')}] {c.get('description','')}" for c in clos
    )

    file_block = ""
    if course_file_text:
        snippet = course_file_text[:COURSE_FILE_LLM_CHAR_LIMIT]
        file_block = f"\nCourse outline content (from course file):\n{snippet}\n"

    anchor_sample = ", ".join(
        f'"{v}"' for v in random.sample(_ANCHOR_VOCAB, min(30, len(_ANCHOR_VOCAB)))
    )
    raw = _call_ollama(_EXTRACT_GRAPH_PROMPT.format(
        title=title, clo_block=clo_block, file_block=file_block, anchor_sample=anchor_sample
    ))
    parsed = _parse_graph_json(raw)

    # ── filter / validate topics, same 2-4 word + noise rule as before ──────
    kept_topics: list = []
    valid_ids: set = set()
    seen_ids: set = set()
    for i, t in enumerate(parsed["topics"]):
        if not isinstance(t, dict):
            continue
        label = str(t.get("label", "")).lower().strip()
        words = label.split()
        if not (2 <= len(words) <= 4) or label in _CONCEPT_NOISE:
            continue
        tid = str(t.get("id") or f"t{i+1}").strip()
        if tid in seen_ids:          # de-dupe a repeated id defensively
            tid = f"{tid}_{i+1}"
        seen_ids.add(tid)
        bloom = str(t.get("bloom_level", "")).strip().title()
        if bloom not in _BLOOM_LEVELS:
            bloom = None
        kept_topics.append({
            "id": tid, "label": label, "bloom_level": bloom,
            "status": "pending_validation",
        })
        valid_ids.add(tid)

    # ── filter / validate edges: both endpoints must be kept topics ─────────
    kept_edges: list = []
    for e in parsed["edges"]:
        if not isinstance(e, dict):
            continue
        src, tgt = str(e.get("source", "")).strip(), str(e.get("target", "")).strip()
        if not src or not tgt or src == tgt:
            continue
        if src not in valid_ids or tgt not in valid_ids:
            continue
        etype = str(e.get("type", "")).strip()
        if etype not in _EDGE_TYPES:
            continue
        try:
            conf = float(e.get("confidence", 0.5))
        except (TypeError, ValueError):
            conf = 0.5
        conf = max(0.0, min(1.0, conf))
        rationale = str(e.get("rationale", "")).strip()[:200]
        kept_edges.append({
            "source": src, "target": tgt, "type": etype,
            "rationale": rationale, "confidence": round(conf, 2),
            "status": "pending_validation",
        })

    if raw:
        print(f"    LLM → {len(kept_topics)} topics, {len(kept_edges)} edges")
    return {"topics": kept_topics, "edges": kept_edges}

def llm_normalise_all(unique_concepts: list) -> dict:
    if not unique_concepts:
        return {}
    CHUNK = 60
    norm_map: dict = {}
    chunks = [unique_concepts[i:i+CHUNK] for i in range(0, len(unique_concepts), CHUNK)]
    for chunk in chunks:
        raw = _call_ollama(_NORMALISE_PROMPT.format(raw_list=json.dumps(chunk)))
        if not raw:
            for c in chunk:
                norm_map[c] = c
            continue
        parsed_map = None
        for candidate in (raw, re.search(r"\{.*\}", raw, re.DOTALL)):
            src = candidate if isinstance(candidate, str) else (candidate.group() if candidate else None)
            if not src:
                continue
            try:
                obj = json.loads(src)
                if "mapping" in obj and isinstance(obj["mapping"], dict):
                    parsed_map = obj["mapping"]
                    break
                if "concepts" in obj:
                    parsed_map = {c: c for c in obj["concepts"]}
                    break
            except Exception:
                continue
        for orig in chunk:
            if parsed_map and orig in parsed_map:
                mapped = str(parsed_map[orig]).lower().strip()
                words = mapped.split()
                norm_map[orig] = mapped if 2 <= len(words) <= 4 else orig
            else:
                norm_map[orig] = orig
    return norm_map

# ═══════════════════════════════════════════════════════════════════════════════
#  CONCEPT INDEX
# ═══════════════════════════════════════════════════════════════════════════════

def build_concept_index(courses: list) -> dict:
    cc: dict = defaultdict(set)
    for course in courses:
        for c in course.get("concepts", []):
            cc[c].add(course["code"])
    return {
        concept: sorted(codes)
        for concept, codes in sorted(cc.items(), key=lambda x: (-len(x[1]), x[0]))
    }

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Excel → data.json for OBE Dashboard")
    parser.add_argument(
        "--mode", choices=["rule", "llm", "both"], default="both",
        help="Concept extraction mode  [rule | llm | both]  (default: both)"
    )
    parser.add_argument(
        "--course-files-dir", type=str, default=None,
        help="Directory containing course-outline files named by course code "
             "(e.g. CHE-401.md). Overrides the built-in COURSE_FILES_DIR default."
    )
    args = parser.parse_args()

    course_files_dir = Path(args.course_files_dir) if args.course_files_dir else COURSE_FILES_DIR

    # ── Dependencies ──────────────────────────────────────────────────────────
    try:
        import openpyxl  # noqa
        import pandas as pd
    except ImportError:
        print("ERROR: Run:  pip install pandas openpyxl  (or  py -m pip install ...  on Windows)")
        sys.exit(1)
    import pandas as pd

    # ── Read Excel ────────────────────────────────────────────────────────────
    excel = EXCEL_PATH
    if not excel.exists():
        # Last resort: search cwd
        excel = Path.cwd() / "Qalam_CLOs.xlsx"
    if not excel.exists():
        print(f"ERROR: Cannot find Qalam_CLOs.xlsx.\n  Searched:\n  {EXCEL_PATH}\n  {excel}")
        sys.exit(1)

    print(f"Reading: {excel}")
    try:
        df = pd.read_excel(excel, sheet_name=SHEET_NAME, dtype=str)
    except Exception as e:
        print(f"  Sheet '{SHEET_NAME}' not found, trying first sheet… ({e})")
        df = pd.read_excel(excel, sheet_name=0, dtype=str)

    df.columns = [c.strip() for c in df.columns]
    df = df.fillna("")

    # ── Build courses_map ─────────────────────────────────────────────────────
    courses_map: dict = {}
    for _, row in df.iterrows():
        scheme_line = str(row.get(COL_SCHEME_LINE, "")).strip()
        if not scheme_line:
            continue
        code  = extract_course_code(scheme_line)
        title = extract_course_title(scheme_line)
        batch = extract_batch(str(row.get(COL_BATCH, "")).strip())

        # ── read semester, lec, lab directly ─────────────────────────────────
        sem_raw = str(row.get(COL_SEMESTER, "")).strip()
        lec_raw = str(row.get(COL_LEC, "")).strip()
        lab_raw = str(row.get(COL_LAB, "")).strip()
        semester = int(sem_raw) if sem_raw.isdigit() else None
        lec      = int(lec_raw) if lec_raw.isdigit() else 0
        lab      = int(lab_raw) if lab_raw.isdigit() else 0
        # ─────────────────────────────────────────────────────────────────────

        clo_code = str(row.get(COL_CLO_CODE, "")).strip()
        plo      = normalise_plo(str(row.get(COL_PLO, "")).strip())
        emphasis = str(row.get(COL_EMPHASIS, "")).strip().capitalize()
        domain   = normalise_domain(str(row.get(COL_DOMAIN, "")).strip())
        desc     = str(row.get(COL_DESCRIPTION, "")).strip()

        if code not in courses_map:
            courses_map[code] = {
                "code":     code,
                "title":    title,
                "batch":    batch,
                "semester": semester,   # direct from Excel
                "lec":      lec,        # lecture credits
                "lab":      lab,        # lab credits
                "clos":     [],
            }

        if clo_code:
            courses_map[code]["clos"].append({
                "code": clo_code, "plo": plo,
                "emphasis": emphasis, "domain": domain,
                "description": desc, "concepts": [],
            })

    courses = sorted(
        courses_map.values(),
        key=lambda c: (c["semester"] or 99, c["code"])
    )
    print(f"  {len(courses)} courses, {sum(len(c['clos']) for c in courses)} CLOs")

    # ── Load course files (for richer topic extraction) ────────────────────────
    course_texts = load_course_files(course_files_dir)

    # ── Extraction phase ──────────────────────────────────────────────────────
    use_rule = args.mode in ("rule", "both")
    use_llm  = args.mode in ("llm",  "both")
    all_llm_concepts: list = []
    matched_files = 0

    for i, course in enumerate(courses, 1):
        file_text = match_course_file(course["code"], course_texts)
        if file_text:
            matched_files += 1

        rule_c = rule_extract_course(course["clos"], file_text) if use_rule else []
        llm_c  = []

        if use_llm:
            tag = " (+ course file)" if file_text else ""
            print(f"  [{i}/{len(courses)}] {course['code']} — calling Ollama{tag}…", flush=True)
            graph = llm_extract_course_graph(course["title"], course["clos"], file_text)
            llm_c = [t["label"] for t in graph["topics"]]
            all_llm_concepts.extend(llm_c)
            # Stash raw graph on the course dict under a leading underscore —
            # relabelled by the normalisation passes below, then promoted to
            # the public "topics"/"edges" keys (with ids namespaced to the
            # course code) just before output.
            course["_llm_topics"] = graph["topics"]
            course["_llm_edges"]  = graph["edges"]
        else:
            course["_llm_topics"] = []
            course["_llm_edges"]  = []

        merged = sorted(set(rule_c) | set(llm_c)) if (use_rule and use_llm) else (rule_c or llm_c)
        course["concepts"] = merged

        # Per-CLO concept tagging still matches against CLO description text only
        # (course-file-derived concepts that aren't in any CLO description simply
        # surface at the course level / concept index, not on a specific CLO).
        for clo in course["clos"]:
            txt = clo["description"].lower()
            clo["concepts"] = sorted(
                c for c in merged
                if any(w in txt for w in c.lower().split())
            )

    if course_texts:
        print(f"  [course files] Matched {matched_files}/{len(courses)} courses "
              f"({len(courses) - matched_files} fell back to CLO-only extraction)")

    # ── Normalisation pass (LLM) ───────────────────────────────────────────
    if use_llm and all_llm_concepts:
        unique = sorted(set(all_llm_concepts))
        print(f"\nNormalising {len(unique)} unique LLM concepts…", flush=True)
        norm_map = llm_normalise_all(unique)
        if norm_map:
            for course in courses:
                course["concepts"] = sorted(set(norm_map.get(c, c) for c in course["concepts"]))
                for clo in course["clos"]:
                    clo["concepts"] = sorted(set(norm_map.get(c, c) for c in clo["concepts"]))
                for t in course.get("_llm_topics", []):
                    t["label"] = norm_map.get(t["label"], t["label"])
            print(f"  Normalised {len(norm_map)} labels → {len(set(norm_map.values()))} unique")

    # ── Deterministic post-normalisation ───────────────────────────────────
    _POST_NORM = {
        "python programming": "Python", "pid control": "PID control",
        "cad": "CAD", "computer-aided design": "CAD",
        "polymers": "polymer chemistry",
        "reaction engineering": "reaction kinetics",
        "thermal properties": "thermodynamics",
        "mechanical properties": "material properties",
        "thermal energy transfer": "heat transfer",
        "fluid flow dynamics": "fluid mechanics",
        "transport phenomena": "mass transfer",
        "conservation laws": "mass balance",
        "separation principles": "separation processes",
        "separation efficiency": "separation processes",
        "control theory": "process control",
        "feedback control": "process control",
        "safety principles": "process safety",
        "safety protocols": "process safety",
        "size analysis": "particle size analysis",
        "particle size": "particle size analysis",
        "mathematical modeling": "mathematical modelling",
        "data processing": "data analysis",
        "data visualization": "data analysis",
        "economics of engineering": "engineering economics",
        "newtonian mechanics": "mechanics",
        "organic reactions": "organic chemistry",
        "lab practice": "laboratory practice",
        "momentum balance": "mass balance",
        "yield": "yield optimization",
        "statistics": "statistical analysis",
        # Drop these (too vague)
        "scientific inquiry": None, "startup procedure": None,
        "problem solving": None, "data evaluation": None,
    }

    def _post_norm(c: str):
        return _POST_NORM.get(c, _POST_NORM.get(c.lower(), c))

    for course in courses:
        seen: set = set(); out: list = []
        for c in course.get("concepts", []):
            n = _post_norm(c)
            if n and n not in seen:
                seen.add(n); out.append(n)
        course["concepts"] = sorted(out)
        for clo in course.get("clos", []):
            seen2: set = set(); out2: list = []
            for c in clo.get("concepts", []):
                n = _post_norm(c)
                if n and n not in seen2:
                    seen2.add(n); out2.append(n)
            clo["concepts"] = sorted(out2)

    # ── Promote stashed LLM topics/edges → public "topics"/"edges" fields ──
    # Topic ids are namespaced to the course code ("CHE-222:t1") so they stay
    # globally unique once every course's graph is merged into one dashboard
    # view / one teacher-voting session. Topics dropped by post-normalisation
    # (mapped to None, i.e. "too vague, drop") take their edges with them.
    for course in courses:
        raw_topics = course.pop("_llm_topics", [])
        raw_edges  = course.pop("_llm_edges", [])
        id_map: dict = {}          # local id ("t1") → namespaced id ("CHE-222:t1")
        kept_topics: list = []
        for t in raw_topics:
            label = _post_norm(t["label"])
            if not label:
                continue           # dropped by post-norm (e.g. too vague)
            new_id = f"{course['code']}:{t['id']}"
            id_map[t["id"]] = new_id
            kept_topics.append({
                "id": new_id, "label": label,
                "bloom_level": t.get("bloom_level"),
                "status": t.get("status", "pending_validation"),
            })
        kept_edges: list = []
        for e in raw_edges:
            src, tgt = id_map.get(e["source"]), id_map.get(e["target"])
            if not src or not tgt:
                continue           # one endpoint's topic was dropped above
            kept_edges.append({**e, "source": src, "target": tgt})
        course["topics"] = kept_topics
        course["edges"]  = kept_edges

    # ── Concept index ─────────────────────────────────────────────────────────
    concept_index = build_concept_index(courses)

    # ── Semester summary (for the curriculum graph) ───────────────────────────
    semesters: dict = {}
    for course in courses:
        sem = course.get("semester")
        if sem is None:
            continue
        key = str(sem)
        if key not in semesters:
            semesters[key] = []
        semesters[key].append(course["code"])

    # ── Write output ──────────────────────────────────────────────────────────
    edge_count = sum(len(c.get("edges", [])) for c in courses)
    edge_type_counts: dict = defaultdict(int)
    for c in courses:
        for e in c.get("edges", []):
            edge_type_counts[e["type"]] += 1

    output = {
        "plos":          PLOS,
        "courses":       courses,
        "concept_index": concept_index,
        "concept_mode":  args.mode,
        "semesters":     semesters,   # semester → [course codes] index
        "edge_schema": {
            # documents the shape of course["edges"][i] for downstream
            # consumers (dashboard graph, teacher-voting tool)
            "types": sorted(_EDGE_TYPES),
            "scope": "within-course only (cross-course edges not yet generated)",
            "fields": ["source", "target", "type", "rationale", "confidence", "status"],
        },
        "edge_counts_by_type": dict(edge_type_counts),
    }

    out_path = OUTPUT_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    shared = sum(1 for v in concept_index.values() if len(v) > 1)
    print(f"\n[OK]  data.json written  →  {out_path}")
    print(f"      {len(courses)} courses  ·  {sum(len(c['clos']) for c in courses)} CLOs")
    print(f"      {len(concept_index)} unique concepts  ·  {shared} shared across >= 2 courses")
    print(f"      Extraction mode: {args.mode}")
    if use_llm:
        total_topics = sum(len(c.get("topics", [])) for c in courses)
        print(f"      Knowledge graph: {total_topics} topics  ·  {edge_count} edges "
              f"(pending_validation) — {dict(edge_type_counts)}")
    else:
        print(f"      Knowledge graph: none — edges require --mode llm or --mode both")
    if course_texts:
        print(f"      Course files: {matched_files}/{len(courses)} matched from {course_files_dir}")
    else:
        print(f"      Course files: none loaded — all courses used CLO-only extraction")
    sem_list = sorted(semesters, key=lambda x: int(x) if x.isdigit() else 99)
    for s in sem_list:
        print(f"      Semester {s}: {len(semesters[s])} courses")

if __name__ == "__main__":
    main()