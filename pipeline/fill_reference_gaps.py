"""
Close the gaps recorded in ISSUES.md Part A.

Two rules govern everything here:

  1. Existing ids never change. 224 mappings reference them. New areas and
     units are APPENDED (KA-15, KA-16, KU-01.08, ...) even though physics
     belongs early pedagogically - an `order` field carries display order
     so the ids can stay stable.

  2. Adding a unit without mapping the courses that teach it would
     manufacture fake gaps. So this script also promotes the `unmapped`
     entries that now have a home into real mappings, and leaves only the
     genuinely out-of-scope ones behind.

Run:  python pipeline/fill_reference_gaps.py
"""

import json
from pathlib import Path

D = Path(__file__).resolve().parent
REF = D / "reference_ontology.json"
EXT = D / "claude_extraction.json"


def topic(tid, name, desc):
    return {"id": tid, "name": name, "description": desc}


# ── Topics appended to existing units (gaps A4-A8 and the sem 7-8 finds) ──
NEW_TOPICS = {
    "KU-01.01": [
        topic("T-01.01.05", "Analytical Geometry", "Coordinate geometry in 2- and 3-space, quadric surfaces, cylindrical and spherical systems."),
        topic("T-01.01.06", "Complex Numbers", "Complex arithmetic and its engineering applications."),
    ],
    "KU-01.07": [
        topic("T-01.07.04", "Queuing and Waiting-Line Models", "Infinite and finite source queuing analysis of process and service systems."),
        topic("T-01.07.05", "Facility Layout and Line Balancing", "Allocation of work and space across a production system."),
    ],
    "KU-02.01": [
        topic("T-02.01.06", "Chemical Bonding and Molecular Orbitals", "Bonding theory and molecular orbital description of structure and reactivity."),
    ],
    "KU-02.03": [
        topic("T-02.03.04", "Nuclear and Radiochemistry", "Radioactive elements, decay and their industrial and safety implications."),
    ],
    "KU-04.05": [
        topic("T-04.05.05", "Electrochemical Energy Conversion", "Fuel cells and the thermodynamics of electrochemical cells."),
    ],
    "KU-07.04": [
        topic("T-07.04.05", "Leaching and Solid-Liquid Extraction", "Solid-liquid extraction principles, rate factors, equipment and staging."),
    ],
    "KU-10.04": [
        topic("T-10.04.06", "Dimensional Metrology", "Measurement standards, limits, fits and tolerances."),
    ],
    "KU-11.04": [
        topic("T-11.04.06", "Market Economics", "Demand, supply, equilibrium and market structure as they bear on process economics."),
    ],
    "KU-11.06": [
        topic("T-11.06.05", "Inspection and Non-Destructive Testing", "Asset integrity assessment without damaging the equipment inspected."),
    ],
    "KU-12.01": [],
    "KU-13.06": [
        topic("T-13.06.06", "Energy Policy and Regulation", "National and international policy shaping industrial energy choices."),
    ],
}

# Units renamed to reflect widened scope (ids unchanged)
RENAME_UNITS = {
    "KU-07.04": "Liquid-Liquid Extraction and Leaching",
}

# ── New units appended to existing areas (gaps A2, A3, A6, and utilities) ──
NEW_UNITS = {
    "KA-01": [
        {"id": "KU-01.08", "name": "Data Science and Machine Learning", "core": True,
         "expected_bloom": "Apply",
         "description": "Learning models fitted to data, and their use for prediction and classification in process contexts.",
         "topics": [
             topic("T-01.08.01", "Supervised Learning", "Regression, classification, decision trees, neural networks and support vector machines."),
             topic("T-01.08.02", "Unsupervised Learning", "Clustering, dimensionality reduction and pattern discovery in unlabelled data."),
             topic("T-01.08.03", "Model Validation and Overfitting", "Train-test splitting, cross-validation, accuracy measures and pruning."),
             topic("T-01.08.04", "Data-Driven Process Modelling", "Applying learned models to process prediction, soft sensing and control."),
             topic("T-01.08.05", "Reinforcement and Ensemble Methods", "Markov decision processes, bagging, boosting and committee methods."),
         ]},
        {"id": "KU-01.09", "name": "Quantitative and Logical Reasoning", "core": True,
         "expected_bloom": "Evaluate",
         "description": "Numeracy and formal reasoning underpinning evidence-based engineering judgement.",
         "topics": [
             topic("T-01.09.01", "Numeracy and Proportional Reasoning", "Number systems, rates, ratios, proportions and measurement scales."),
             topic("T-01.09.02", "Propositional Logic", "Propositions, connectives, truth tables and logical equivalence."),
             topic("T-01.09.03", "Argument Evaluation and Fallacies", "Inductive, deductive and abductive reasoning; identifying logical fallacies."),
             topic("T-01.09.04", "Data Interpretation", "Reading and critiquing quantitative information presented in tables and charts."),
         ]},
    ],
    "KA-11": [
        {"id": "KU-11.07", "name": "Plant Utility Systems", "core": True,
         "expected_bloom": "Understand",
         "description": "The supporting services every process plant needs, their selection and economical operation.",
         "topics": [
             topic("T-11.07.01", "Steam and Boiler Feed Water", "Steam generation, distribution and water treatment for boilers."),
             topic("T-11.07.02", "Cooling Water Systems", "Cooling water supply, circulation and treatment."),
             topic("T-11.07.03", "Instrument and Plant Air", "Compressed air systems supporting instrumentation and operations."),
             topic("T-11.07.04", "Flare and Relief Networks", "Plant-wide flare header design and disposal of relieved streams."),
             topic("T-11.07.05", "Utility Selection and Economics", "Choosing and sizing utilities for economical operation."),
         ]},
    ],
    "KA-12": [
        {"id": "KU-12.06", "name": "Crystal Structure and Phase Behaviour of Materials", "core": True,
         "expected_bloom": "Understand",
         "description": "Atomic-scale structure of solids and the phase diagrams that govern their processing.",
         "topics": [
             topic("T-12.06.01", "Crystal Structures", "Lattice types, unit cells, crystallographic planes and directions."),
             topic("T-12.06.02", "Imperfections and Defects", "Point, line and surface defects and their effect on properties."),
             topic("T-12.06.03", "Diffusion in Solids", "Mass transport through crystalline solids."),
             topic("T-12.06.04", "Binary Phase Diagrams", "Solid solutions, eutectics and the interpretation of alloy phase diagrams."),
         ]},
    ],
}

# ── New knowledge areas (gaps A1 and the sector gap) ──────────────────────
NEW_AREAS = [
    {"id": "KA-15", "name": "Physics for Chemical Engineers", "order": 3,
     "description": "The engineering-science physics on which mechanical and electrical aspects of process plant rest.",
     "rationale": "Accreditation requires an engineering-science foundation beyond mathematics and chemistry; the original reference omitted physics entirely.",
     "units": [
         {"id": "KU-15.01", "name": "Classical Mechanics", "core": True, "expected_bloom": "Apply",
          "description": "Newtonian description of forces, motion and energy in engineering systems.",
          "topics": [
              topic("T-15.01.01", "Newton's Laws and Statics", "Force balances, equilibrium and free-body analysis."),
              topic("T-15.01.02", "Work, Energy and Power", "Mechanical energy accounting and conservation."),
              topic("T-15.01.03", "Friction", "Frictional resistance in mechanical and process equipment."),
              topic("T-15.01.04", "Rotation and Moment of Inertia", "Rotational dynamics of shafts, impellers and agitators."),
          ]},
         {"id": "KU-15.02", "name": "Oscillations and Waves", "core": True, "expected_bloom": "Understand",
          "description": "Periodic motion and wave propagation, and their appearance in process equipment.",
          "topics": [
              topic("T-15.02.01", "Simple Harmonic Motion", "Oscillatory systems, damping and resonance."),
              topic("T-15.02.02", "Wave Propagation", "Travelling and standing waves; acoustic and vibrational phenomena."),
              topic("T-15.02.03", "Vibration in Equipment", "Machine vibration as a diagnostic and design concern."),
          ]},
         {"id": "KU-15.03", "name": "Electricity and Magnetism", "core": True, "expected_bloom": "Understand",
          "description": "Electrical and magnetic phenomena underpinning plant instrumentation and drives.",
          "topics": [
              topic("T-15.03.01", "Electrostatics", "Electric charge, Coulomb's law, fields and potential."),
              topic("T-15.03.02", "Capacitance and Dielectrics", "Charge storage and dielectric behaviour."),
              topic("T-15.03.03", "Magnetic Fields and Induction", "Magnetic fields, electromagnetic induction and their applications."),
              topic("T-15.03.04", "Electrical Machines and Drives", "Motors and electrical drives in process plant."),
          ]},
     ]},
    {"id": "KA-16", "name": "Energy and Process Industry Sectors", "order": 16,
     "description": "Sector-specific process knowledge: how the major energy and chemical industries are actually configured.",
     "rationale": "Programmes teach refining, gas processing and fuels as distinct courses; the generic unit operations areas do not capture this sector knowledge.",
     "units": [
         {"id": "KU-16.01", "name": "Petroleum Refining", "core": False, "expected_bloom": "Apply",
          "description": "Crude oil characterisation and the conversion train of a modern refinery.",
          "topics": [
              topic("T-16.01.01", "Crude Oil Characterisation", "Composition, physical properties and standard test methods."),
              topic("T-16.01.02", "Crude Distillation", "Desalting, atmospheric and vacuum distillation, stabilisation."),
              topic("T-16.01.03", "Conversion Processes", "Alkylation, reforming, isomerisation, cracking and hydroprocessing."),
              topic("T-16.01.04", "Refinery Products", "Product slates, specifications and lubricating oils."),
              topic("T-16.01.05", "Upstream Petroleum", "Exploration, resource estimation, well logging and oil production."),
          ]},
         {"id": "KU-16.02", "name": "Natural Gas Processing", "core": False, "expected_bloom": "Analyze",
          "description": "Treatment and conditioning of natural gas from wellhead to sales specification.",
          "topics": [
              topic("T-16.02.01", "Gas Sweetening", "Chemical and physical solvent processes for acid gas removal."),
              topic("T-16.02.02", "Gas Dehydration", "Water removal by glycol and molecular sieve."),
              topic("T-16.02.03", "LPG, LNG and CNG", "Recovery, liquefaction, condensate stabilisation and storage."),
              topic("T-16.02.04", "Gas Transmission", "Pipeline transport, compression, pigging and metering."),
          ]},
         {"id": "KU-16.03", "name": "Fuels and Combustion Technology", "core": False, "expected_bloom": "Analyze",
          "description": "Characterisation, upgrading and combustion of solid, liquid and gaseous fuels.",
          "topics": [
              topic("T-16.03.01", "Fuel Classification and Characterisation", "Properties, calorific value, storage and handling of fuels."),
              topic("T-16.03.02", "Fuel Upgrading", "Carbonisation, gasification, liquefaction, syngas and Fischer-Tropsch routes."),
              topic("T-16.03.03", "Combustion Principles", "Mechanism and kinetics of combustion; flame behaviour."),
              topic("T-16.03.04", "Combustion Equipment", "Burners, boilers, furnaces, draft control and waste heat recovery."),
          ]},
         {"id": "KU-16.04", "name": "Petrochemicals", "core": False, "expected_bloom": "Understand",
          "description": "Commodity chemical manufacture from hydrocarbon feedstocks.",
          "topics": [
              topic("T-16.04.01", "Petrochemical Feedstocks", "Olefins, aromatics and their sources."),
              topic("T-16.04.02", "Commodity Chemical Routes", "Major industrial synthesis routes from petrochemical feedstock."),
          ]},
     ]},
]

# Display order for existing areas (ids stay as they are)
AREA_ORDER = {
    "KA-01": 1, "KA-02": 2, "KA-15": 3, "KA-03": 4, "KA-04": 5, "KA-05": 6,
    "KA-06": 7, "KA-07": 8, "KA-08": 9, "KA-09": 10, "KA-10": 11, "KA-11": 12,
    "KA-12": 13, "KA-16": 14, "KA-13": 15, "KA-14": 16,
}

# ── Mappings promoted from `unmapped` into the new units ──────────────────
# (course, unit, bloom, depth, evidence, confidence, drop_unmapped_label)
PROMOTE = [
    ("CS-117",  "KU-01.08", "Apply", "secondary",
     "Introduction to statistics, artificial intelligence, and machine learning using Python; introduction to regression and classification tasks.", 0.7, "machine learning"),
    ("CHE-226", "KU-01.08", "Apply", "primary",
     "Comprehend the fundamentals of introductory programming, data science concepts, and the application of associated tools; How Big Is Big Data?", 0.75, "data science workflow"),
    ("CHE-323", "KU-01.08", "Understand", "secondary",
     "Process control in the Industry 4.0 era; overview of AI applications in process control.", 0.6, "AI in process control"),
    ("CHE-465", "KU-01.08", "Apply", "primary",
     "Supervised learning: decision trees, Naive Bayes, artificial neural networks, support vector machines, overfitting and pruning. Unsupervised learning: hierarchical and K-means clustering, self-organizing maps, kNN. Reinforcement learning: Markov decision processes, bagging and boosting.", 0.95, "supervised learning"),
    ("CHE-465", None, None, None, None, None, "unsupervised learning"),
    ("CHE-465", None, None, None, None, None, "reinforcement learning"),

    ("QR-100",  "KU-01.09", "Apply", "primary",
     "Introduction to quantitative reasoning; number systems and basic arithmetic operations; units and conversions; rates, ratios, and proportions; measurement scales; tabular and graphical presentation of data.", 0.85, "quantitative literacy"),
    ("QR-101",  "KU-01.09", "Evaluate", "primary",
     "Inductive, deductive, and abductive approaches of reasoning; propositions, arguments, logical connectives, truth tables, propositional equivalences; logical fallacies; Venn diagrams.", 0.9, "formal logic and argumentation"),

    ("PHY-102", "KU-15.01", "Apply", "primary",
     "CLO-1: Identify and interpret the core concepts of Newtonian mechanics to solve basic problems of applied physics. Weekly plan: Newton's laws, work and energy, friction, rotation, moment of inertia.", 0.9, "Newtonian mechanics"),
    ("PHY-102", "KU-15.03", "Apply", "primary",
     "Electric charge and Coulomb's law, electric field, electric potential, capacitors and dielectrics, magnetic fields, electromagnetic induction. CLO-2: fundamentals of electromagnetic induction.", 0.9, "electricity and magnetism"),
    ("PHY-102", "KU-15.02", "Understand", "primary",
     "Oscillations, waves and propagation.", 0.82, "oscillations and waves"),

    ("MSE-226", "KU-12.06", "Understand", "primary",
     "CLO-1: explain crystallographic planes and directions as well as imperfections in materials. CLO-3: Interpret the binary phase diagram. Crystal structures, imperfections and defects in solids, diffusion, solutions and phase diagrams.", 0.92, "crystal structures and defects"),
    ("MSE-226", None, None, None, None, None, "binary phase diagrams"),
    ("CH-113",  "KU-12.06", "Understand", "secondary",
     "Crystalline state of metals and lattice structure.", 0.6, "crystal lattice structure"),

    ("CH-114",  "KU-04.05", "Understand", "secondary",
     "Electrochemistry, fuel cells.", 0.6, "fuel cells"),

    ("CHE-350", "KU-16.01", "Apply", "primary",
     "Modern petroleum processing; refining operations; atmospheric and vacuum distillation; alkylation; reforming; isomerization; hydroprocessing. Origin of hydrocarbons; exploration techniques; well logging; oil production processes.", 0.93, "petroleum refining processes"),
    ("CHE-350", None, None, None, None, None, "upstream petroleum"),
    ("CHE-484", "KU-16.02", "Analyze", "primary",
     "Introduction to the natural gas industry; gas sweetening; dehydration of natural gas; LPG recovery and condensate stabilization; LNG and CNG; gas processing facilities; gas compression; pigging of gas lines.", 0.93, "natural gas processing sector"),
    ("CHE-423", "KU-16.03", "Analyze", "primary",
     "Classification and storage of solid, liquid, and gaseous fuels; characterization of fuel oil, coal, and gas; fuel upgradation: carbonization, liquefaction, gasification, Fischer-Tropsch. Principles of combustion; oil & gas burners, fluidized bed combustion boilers, furnaces and waste heat recovery.", 0.93, "fuel characterization and classification"),
    ("CHE-423", None, None, None, None, None, "combustion technologies"),
    ("CH-113",  "KU-16.04", "Understand", "secondary",
     "Applications of petrochemicals.", 0.58, "petrochemicals"),

    ("CHE-425", "KU-11.07", "Understand", "primary",
     "Importance of utilities in process industries: basic utilities of a process, selection criteria, and economical utilization; flare network, instrument and plant air, boiler feed water, steam, cooling water supply.", 0.85, "utility systems engineering"),

    ("ME-105",  "KU-10.04", "Understand", "secondary",
     "Measuring system/standards; manufacturing metrology; limits, fits, allowances, and tolerances; measuring instruments and their uses.", 0.55, "engineering metrology"),
]

# Unmapped labels that stay unmapped (genuinely outside the discipline, or a
# documentation gap rather than a reference gap). Listed so the decision is
# on record rather than an oversight.
KEEP_UNMAPPED = {
    "cloud computing", "web and mobile development", "database systems",
    "general language proficiency", "manufacturing processes",
    "expository essay composition", "geometric dimensioning and tolerancing",
    "development of surfaces", "new venture finance and planning",
    "unspecified separation processes", "residence time distribution absent",
    "analytical geometry", "analytical geometry in 3-space",
    "molecular orbital theory", "radioactive elements", "microeconomics",
    "leaching", "thermodynamics of electrochemical cells",
    "inspection and non-destructive testing", "operations research techniques",
    "energy policy",
}


def main():
    ref = json.loads(REF.read_text(encoding="utf-8"))
    ext = json.loads(EXT.read_text(encoding="utf-8"))

    units_by_id = {u["id"]: u for a in ref["areas"] for u in a["units"]}
    areas_by_id = {a["id"]: a for a in ref["areas"]}

    # 1. topics onto existing units
    added_t = 0
    for uid, tops in NEW_TOPICS.items():
        if uid not in units_by_id:
            print(f"  WARN unit not found: {uid}")
            continue
        have = {t["id"] for t in units_by_id[uid]["topics"]}
        for t in tops:
            if t["id"] not in have:
                units_by_id[uid]["topics"].append(t)
                added_t += 1

    # 2. renames
    for uid, name in RENAME_UNITS.items():
        if uid in units_by_id:
            units_by_id[uid]["name"] = name

    # 3. new units onto existing areas
    added_u = 0
    for aid, units in NEW_UNITS.items():
        if aid not in areas_by_id:
            print(f"  WARN area not found: {aid}")
            continue
        have = {u["id"] for u in areas_by_id[aid]["units"]}
        for u in units:
            if u["id"] not in have:
                areas_by_id[aid]["units"].append(u)
                added_u += 1

    # 4. new areas
    added_a = 0
    have_a = {a["id"] for a in ref["areas"]}
    for a in NEW_AREAS:
        if a["id"] not in have_a:
            ref["areas"].append(a)
            added_a += 1

    # 5. display order
    for a in ref["areas"]:
        a["order"] = AREA_ORDER.get(a["id"], 99)
    ref["areas"].sort(key=lambda a: a["order"])

    valid = {u["id"] for a in ref["areas"] for u in a["units"]}

    # 6. promote unmapped -> mapped
    by_code = {c["code"]: c for c in ext["courses"]}
    promoted, dropped = 0, 0
    for code, uid, bloom, depth, ev, conf, label in PROMOTE:
        c = by_code.get(code)
        if not c:
            print(f"  WARN course not found: {code}")
            continue
        if uid:
            if uid not in valid:
                print(f"  WARN unit not found: {uid}")
                continue
            if not any(m["unit_id"] == uid for m in c["mapped"]):
                c["mapped"].append({"unit_id": uid, "bloom_level": bloom, "depth": depth,
                                    "evidence": ev, "confidence": conf})
                promoted += 1
        before = len(c["unmapped"])
        c["unmapped"] = [x for x in c["unmapped"] if x["label"] != label]
        dropped += before - len(c["unmapped"])

    ref["gaps_filled"] = "ISSUES.md Part A closed. New ids are appended, never renumbered; `order` carries pedagogical display order."
    REF.write_text(json.dumps(ref, indent=2, ensure_ascii=False), encoding="utf-8")
    EXT.write_text(json.dumps(ext, indent=2, ensure_ascii=False), encoding="utf-8")

    n_u = sum(len(a["units"]) for a in ref["areas"])
    n_t = sum(len(u["topics"]) for a in ref["areas"] for u in a["units"])
    n_m = sum(len(c["mapped"]) for c in ext["courses"])
    n_x = sum(len(c["unmapped"]) for c in ext["courses"])
    print(f"added: {added_a} areas, {added_u} units, {added_t} topics")
    print(f"promoted {promoted} mappings, cleared {dropped} unmapped entries")
    print(f"reference now: {len(ref['areas'])} areas, {n_u} units, {n_t} topics")
    print(f"extraction now: {n_m} mappings, {n_x} unmapped remaining")


if __name__ == "__main__":
    main()
