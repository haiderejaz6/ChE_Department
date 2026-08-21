"""
Shared Claude API plumbing for the curriculum knowledge-unit work.

Two artifacts are produced by the scripts that import this module:

  A. reference_ontology.json  — what chemical engineering *should* cover,
     built independently of this curriculum (build_reference_ontology.py)
  B. claude_extraction.json   — what these courses *do* cover, mapped onto A
     (claude_extract.py)

Keeping A curriculum-independent is what makes gap analysis possible: if the
reference were extracted from the CLOs, every unit would be covered by
definition and the gap set would always be empty.
"""

import json
import os
import sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("ERROR: pip install -r requirements.txt  (needs 'anthropic' and 'pydantic')")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────────
MODEL       = "claude-opus-5"
MAX_TOKENS  = 16000

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT  = _SCRIPT_DIR.parent

REFERENCE_PATH  = _SCRIPT_DIR / "reference_ontology.json"
EXTRACTION_PATH = _SCRIPT_DIR / "claude_extraction.json"
COVERAGE_PATH   = _SCRIPT_DIR / "coverage_report.json"

# The accreditation framework the course outlines already cite. Anchoring the
# reference ontology to a named standard is what makes it defensible in review —
# "according to PEC 2023-24", not "according to the model".
PEC_ANCHOR = (
    "Pakistan Engineering Council (PEC) Outcome-Based Accreditation guidelines "
    "2023-2024 for undergraduate Chemical Engineering programmes, read alongside "
    "the standard international consensus on chemical engineering curricula "
    "(AIChE / ABET programme criteria)."
)


def get_client() -> "anthropic.Anthropic":
    """
    Construct the SDK client. Credentials resolve from ANTHROPIC_API_KEY, or
    ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile — never hardcode a key.
    """
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        print("NOTE: ANTHROPIC_API_KEY is not set — relying on an `ant auth login` profile.")
        print("      If this fails, set the key:  $env:ANTHROPIC_API_KEY = 'sk-ant-...'")
    return anthropic.Anthropic()


def call_parsed(client, *, system, user, output_format, cache_system=False, label=""):
    """
    One structured-output call. Returns the validated Pydantic object.

    cache_system=True marks the system prompt for prompt caching — worth it when
    the same large system prefix is reused across many calls (e.g. the reference
    ontology sent with all 51 course extractions). Caching is a prefix match, so
    the system text must be byte-identical across calls or nothing hits.

    Note: messages.parse() has no top-level cache_control parameter, so the
    marker goes on the system content block itself.
    """
    system_arg = system
    if cache_system:
        system_arg = [{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }]

    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            thinking={"type": "adaptive"},
            system=system_arg,
            messages=[{"role": "user", "content": user}],
            output_format=output_format,
        )
    except anthropic.NotFoundError as e:
        print(f"  [{label}] model not found: {e}")
        raise
    except anthropic.RateLimitError as e:
        print(f"  [{label}] rate limited: {e}")
        raise
    except anthropic.APIStatusError as e:
        print(f"  [{label}] API error {e.status_code}: {e}")
        raise
    except anthropic.APIConnectionError as e:
        print(f"  [{label}] connection failed: {e}")
        raise

    # Guard before reading content — a refusal returns HTTP 200, not an exception.
    if response.stop_reason == "refusal":
        detail = getattr(response, "stop_details", None)
        raise RuntimeError(f"[{label}] request refused: {detail}")

    u = response.usage
    cached = getattr(u, "cache_read_input_tokens", 0) or 0
    print(f"  [{label}] in={u.input_tokens} cached={cached} out={u.output_tokens}")

    return response.parsed_output


def load_json(path: Path):
    if not path.exists():
        print(f"ERROR: not found: {path}")
        sys.exit(1)
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(obj, path: Path):
    with path.open("w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    print(f"Wrote {path.name}")
