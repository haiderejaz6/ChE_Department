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
