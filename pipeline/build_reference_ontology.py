"""
ARTIFACT A — the reference knowledge-unit ontology for chemical engineering.

Built WITHOUT reference to this curriculum, on purpose. This is the yardstick
the curriculum is measured against, so it must describe what the discipline
covers, not what NUST currently teaches. Anything derived from the CLOs would
be covered by construction and could never show up as a gap.

Structure follows the ACM/IEEE Computing Curricula scheme that the term
"knowledge unit" comes from:

    Knowledge Area  (KA-01)          ~12 broad subject areas
      └─ Knowledge Unit  (KU-01.02)  the coherent teachable blocks
           └─ Topic     (T-01.02.03) the individual items within a unit

Run:
    python pipeline/build_reference_ontology.py
    python pipeline/build_reference_ontology.py --areas 14
"""

import argparse
from typing import List

from pydantic import BaseModel, Field

from claude_common import (PEC_ANCHOR, REFERENCE_PATH, call_parsed, get_client,
                           save_json)

# ── Response schemas ──────────────────────────────────────────────────────────

class AreaStub(BaseModel):
    name: str        = Field(description="Knowledge area name, 2-5 words")
    description: str = Field(description="One sentence on what this area covers")
    rationale: str   = Field(description="Why this is a distinct area in a ChemE programme")


class AreaList(BaseModel):
    areas: List[AreaStub]


class TopicOut(BaseModel):
    name: str        = Field(description="Topic name, 2-5 words")
    description: str = Field(description="One sentence")


class UnitOut(BaseModel):
    name: str        = Field(description="Knowledge unit name, 2-5 words")
    description: str = Field(description="One or two sentences on what this unit covers")
    core: bool       = Field(description="True if every accredited ChemE programme must cover this; False if elective/specialised")
    expected_bloom: str = Field(description="Bloom level a graduate should reach: Remember, Understand, Apply, Analyze, Evaluate, or Create")
    topics: List[TopicOut]


class UnitList(BaseModel):
    units: List[UnitOut]


# ── Prompts ───────────────────────────────────────────────────────────────────

_EXPERT_SYSTEM = f"""\
You are a senior chemical engineering academic serving on an accreditation
panel. You are defining the body of knowledge an undergraduate chemical
engineering programme is expected to cover.

Your frame of reference is: {PEC_ANCHOR}

Describe the discipline as it is defined by the accreditation framework and
international consensus — NOT any single university's course list. You are
writing the standard against which a specific curriculum will later be audited,
so completeness matters more than convenience. Include areas that programmes
commonly under-serve, since the whole purpose of this reference is to make such
omissions visible.
"""

_AREAS_USER = """\
List the top-level KNOWLEDGE AREAS of undergraduate chemical engineering.

Requirements:
- Return {n} areas.
- Cover the full programme: engineering sciences, chemical engineering core,
  design and practice, plus the professional/analytical strands (safety,
  sustainability, computation, economics, ethics) that accreditation requires.
- Areas must be mutually distinct — no overlap in scope.
- Order them roughly as they would be encountered in a degree programme.
"""

_UNITS_USER = """\
Knowledge area: {name}
Scope: {description}

Break this area into its KNOWLEDGE UNITS, and each unit into its TOPICS.

Requirements:
- Return 4 to 9 knowledge units for this area.
- Each unit is a coherent teachable block — the kind of thing that occupies
  several lectures and could be assessed as a whole.
- Give each unit 3 to 8 topics.
- Mark `core: true` only for units every accredited programme must cover.
  Be honest about which are genuinely core versus specialisation.
- `expected_bloom` is the level a GRADUATE should reach for that unit, not the
  level of a first exposure to it.
- Use standard chemical engineering vocabulary a faculty reviewer would
  recognise immediately.
"""


def main():
    ap = argparse.ArgumentParser(description="Build the reference ChemE knowledge-unit ontology")
    ap.add_argument("--areas", type=int, default=12, help="Number of knowledge areas (default 12)")
    ap.add_argument("--output", type=str, default=None, help="Override output path")
    args = ap.parse_args()

    out_path = REFERENCE_PATH if args.output is None else __import__("pathlib").Path(args.output)
    client = get_client()

    # ── Stage 1: enumerate the knowledge areas ────────────────────────────────
    print(f"Stage 1 — enumerating {args.areas} knowledge areas…")
    area_list = call_parsed(
        client,
        system=_EXPERT_SYSTEM,
        user=_AREAS_USER.format(n=args.areas),
        output_format=AreaList,
        label="areas",
    )

    # ── Stage 2: expand each area into units and topics ───────────────────────
    # One call per area keeps each response small and focused. The system prompt
    # is identical every time, so it caches after the first call.
    print(f"\nStage 2 — expanding {len(area_list.areas)} areas…")
    areas_out = []
    for a_i, area in enumerate(area_list.areas, 1):
        ka_id = f"KA-{a_i:02d}"
        print(f"  [{a_i}/{len(area_list.areas)}] {ka_id} {area.name}")

        unit_list = call_parsed(
            client,
            system=_EXPERT_SYSTEM,
            user=_UNITS_USER.format(name=area.name, description=area.description),
            output_format=UnitList,
            cache_system=True,
            label=ka_id,
        )

        units_out = []
        for u_i, unit in enumerate(unit_list.units, 1):
            ku_id = f"KU-{a_i:02d}.{u_i:02d}"
            units_out.append({
                "id": ku_id,
                "name": unit.name,
                "description": unit.description,
                "core": unit.core,
                "expected_bloom": unit.expected_bloom,
                "topics": [
                    {"id": f"T-{a_i:02d}.{u_i:02d}.{t_i:02d}",
                     "name": t.name, "description": t.description}
                    for t_i, t in enumerate(unit.topics, 1)
                ],
            })

        areas_out.append({
            "id": ka_id,
            "name": area.name,
            "description": area.description,
            "rationale": area.rationale,
            "units": units_out,
        })

    n_units  = sum(len(a["units"]) for a in areas_out)
    n_topics = sum(len(u["topics"]) for a in areas_out for u in a["units"])
    n_core   = sum(1 for a in areas_out for u in a["units"] if u["core"])

    save_json({
        "schema": "che-reference-knowledge-units/1",
        "grounding": PEC_ANCHOR,
        "provenance": "Built independently of the NUST ChE curriculum. Do not "
                      "regenerate from CLO text — that would make gap analysis vacuous.",
        "model": "claude-opus-5",
        "counts": {"areas": len(areas_out), "units": n_units,
                   "core_units": n_core, "topics": n_topics},
        "areas": areas_out,
    }, out_path)

    print(f"\n{len(areas_out)} areas, {n_units} units ({n_core} core), {n_topics} topics")
    print("Review this by hand before using it as ground truth.")


if __name__ == "__main__":
    main()
