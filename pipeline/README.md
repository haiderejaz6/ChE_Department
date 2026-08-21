# Curriculum data pipeline

Generates the `data.json` that the dashboard, graph, and ontology pages read.

```
Qalam_CLOs.xlsx  ─┐
                  ├─> excel_to_json.py ─────────> ../data.json
../courses/*.md  ─┘                                   │
                                                      v
                                     build_curriculum_ontology.py
                                                      │
                                                      v
                                            che_curriculum.owl
```

## Setup

The virtual environment is deliberately **not** committed — it is ~100 MB of
platform-specific binaries. Rebuild it from `requirements.txt`:

```bash
python -m venv venv
venv/Scripts/pip install -r requirements.txt      # Windows
# source venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
```

Python 3.13 was used originally; anything 3.10+ should work.

## Regenerating `data.json`

Concept extraction has an LLM mode that calls a **local Ollama** instance at
`http://localhost:11434` with the `llama3` model. Start Ollama first, or use
`--mode rule` to skip it.

```bash
venv/Scripts/python pipeline/excel_to_json.py --mode both
```

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--mode` | `rule`, `llm`, `both` | `both` | `rule` needs no Ollama |
| `--course-files-dir` | path | `../courses` | Markdown outlines named by course code |

Output is written to the repo root as `data.json`, which is what the site serves.

## Rebuilding the ontology

```bash
venv/Scripts/python pipeline/build_curriculum_ontology.py \
  --input ../data.json --output che_curriculum.owl
```

`--run-reasoner` additionally runs HermiT, which requires a local Java install.

## Files

| File | Role |
|---|---|
| `Qalam_CLOs.xlsx` | Source data exported from Qalam (sheet `Qalam_CLOs`) |
| `excel_to_json.py` | Excel + course outlines → `data.json` |
| `build_curriculum_ontology.py` | `data.json` → OWL ontology |
| `che_curriculum.owl` | Generated ontology, committed for convenience |

---

# Claude-based knowledge-unit extraction

A third extraction method, alongside the rule-based and Ollama paths in
`excel_to_json.py`. Those stay untouched so all three can be compared.

## Why this is two artifacts, not one

Extracting knowledge units *from* the CLOs can never reveal what the curriculum
is missing — everything extracted is covered by definition. So the reference is
built separately, from the discipline rather than from these courses:

```
  A. reference_ontology.json          B. claude_extraction.json
     what ChemE should cover             what these courses do cover
     (PEC 2023-24 + expert model)        (CLOs + courses/*.md)
                    \                   /
                     \                 /
                      coverage_report.json
                   gaps / overlap / bloom shortfall
```

`build_reference_ontology.py` must NOT be re-pointed at the CLO text. That one
change would make every gap disappear and the analysis meaningless.

## Setup

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

## Running

```powershell
# 1. Build the reference (~13 calls, once). Review the output by hand.
venv\Scripts\python.exe ChE_Department\pipeline\build_reference_ontology.py

# 2. Map the courses onto it (one call per course).
venv\Scripts\python.exe ChE_Department\pipeline\claude_extract.py --limit 3   # smoke test
venv\Scripts\python.exe ChE_Department\pipeline\claude_extract.py            # all courses

# 3. Gaps and overlap. No API calls, safe to re-run.
venv\Scripts\python.exe ChE_Department\pipeline\coverage_report.py --markdown gaps.md
```

## Structure

Three levels, following the ACM/IEEE scheme the term "knowledge unit" comes from:

| Level | Id | Meaning |
|---|---|---|
| Knowledge Area | `KA-03` | Broad subject area |
| Knowledge Unit | `KU-03.02` | Coherent teachable block |
| Topic | `T-03.02.04` | Individual item |

## Guards worth knowing about

- Unit ids returned by the model are checked against the reference; anything
  invented is dropped and listed under `invalid_unit_ids_dropped`.
- Every mapping carries `evidence` quoted from the course text — a mapping
  without grounding is a false positive that hides a real gap.
- Topics with no matching unit go to `unmapped` rather than being forced into an
  approximate one. Review these: they are how you find holes in the reference.
- Everything is written `pending_validation`. This is a first pass for faculty
  review, not ground truth on its own.
