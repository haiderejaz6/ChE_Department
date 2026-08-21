# Open issues — reference ontology and curriculum data

Working document. Two independent problem sets, kept apart on purpose:

- **Part A** — holes in `reference_ontology.json`. My reference is incomplete;
  these are things the curriculum teaches that the yardstick fails to measure.
  Fixing these makes the reference better. They are **not** curriculum findings.
- **Part B** — problems in the curriculum data itself (`data.json`, `courses/`).
  These corrupt the mapping if left unfixed, and several would corrupt PLO
  attainment reporting regardless of this project.

**Part A is now CLOSED** — see the appendix at the end for what was applied.
Part B remains open and needs departmental input.

Status: all 51 courses mapped; reference enlarged to 16 areas / 93 units / 390 topics.

---

# Part A — Reference ontology gaps  ✅ CLOSED

Every entry was raised by a real course whose content had nowhere to map.
The "raised by" column is the evidence; a gap flagged by several independent
courses is more certain than one flagged once.

## A1. Missing knowledge area: Physics for Chemical Engineers

**Severity: high — this is a whole missing area, not a missing unit.**

`PHY-102 Applied Physics` is a required semester-2 course and almost none of it
maps. The reference has Mathematics (KA-01) and Chemistry (KA-02) but no physics,
even though engineering science is a standard accreditation requirement.

| Uncovered content | Raised by |
|---|---|
| Newtonian mechanics — laws, work/energy, friction, rotation, moment of inertia | PHY-102 |
| Electricity and magnetism — Coulomb's law, fields, potential, capacitors, induction | PHY-102 |
| Oscillations and waves | PHY-102 |

**Proposed fix:** add `KA-15 Physics for Chemical Engineers` with units for
mechanics, electricity and magnetism, oscillations and waves, and possibly
thermal physics. Renumbering is not required — new areas can append.

## A2. Missing unit: Data Science and Machine Learning

**Severity: high — flagged by four independent courses.**

| Raised by | Evidence |
|---|---|
| CS-117 | statistics, AI and machine learning in Python; regression and classification |
| CHE-226 | data science concepts; data analysis and visualisation of process data |
| CHE-323 | Industry 4.0 era; overview of AI applications in process control |
| CHE-465 | entire course — Data Science and Machine Learning in Chemical Engineering |

KU-01.05 covers classical statistics (distributions, error analysis, regression,
hypothesis testing, DoE) but nothing on ML workflow, model training, or
classification.

**Proposed fix:** add `KU-01.08 Data Science and Machine Learning` under KA-01,
with topics for supervised learning, model validation, feature engineering, and
data-driven process modelling.

## A3. Missing units in KA-12 Materials and Polymer Engineering

**Severity: medium — flagged by two courses.**

| Uncovered content | Raised by |
|---|---|
| Crystal structures, crystallographic planes and directions, defects and imperfections | MSE-226, CH-113 |
| Binary phase diagrams, solid solutions, metals and alloys | MSE-226 |

KU-12.01 covers material classes and properties but stops short of structure.
Note this is distinct from KU-04.03 Phase Equilibrium — a materials Fe-C diagram
is not the VLE treatment thermodynamics gives.

**Proposed fix:** add `KU-12.06 Crystal Structure and Phase Behaviour of Materials`.

## A4. Missing topic: electrochemical thermodynamics

**Severity: medium — flagged by two courses.**

| Uncovered content | Raised by |
|---|---|
| Fuel cells | CH-114 |
| Thermodynamics of electrochemical cells | CHE-332 |

KU-02.01 has an electrochemistry topic (T-02.01.04) covering electrode
potentials and corrosion basics, but nothing on energy conversion.

**Proposed fix:** either extend KU-04.05 Thermodynamic Cycles with an
electrochemical energy conversion topic, or add a unit if the curriculum
warrants it.

## A5. Missing topic: leaching (solid-liquid extraction)

**Severity: medium.** Raised by CHE-349, where leaching is a full syllabus block
with its own staging calculations. KU-07.04 covers liquid-liquid extraction only.

**Proposed fix:** add a leaching topic to KU-07.04, or split into a
`Solid-Liquid Extraction and Leaching` unit.

## A6. Missing topics in KA-01

**Severity: low-medium.**

| Uncovered content | Raised by |
|---|---|
| Analytical geometry in 3-space, quadric surfaces, cylindrical/spherical coordinates | MATH-243, MATH-101 |
| Complex numbers | MATH-101 |
| Foundational numeracy — number systems, ratios, measurement scales | QR-100 |
| Formal logic, propositional reasoning, fallacies, argumentation | QR-101 |

The first two extend KU-01.01. The last two are arguably general-education
outcomes rather than ChemE knowledge units — decide whether the reference should
model them at all.

## A7. Missing topics in KA-02

**Severity: low.**

| Uncovered content | Raised by |
|---|---|
| Molecular orbital theory and chemical bonding | CH-113 |
| Radioactive elements and nuclear chemistry | CH-113 |

## A8. Missing topic: microeconomics

**Severity: low.** Raised by ECO-130 — demand, supply, market equilibrium,
consumption and production theory, market structure. KU-11.04 covers project
costing and profitability only.

## A9. Deliberately excluded — confirm this is right

Content that genuinely falls outside a chemical engineering body of knowledge.
Listed so the exclusion is a decision on record rather than an oversight.

| Content | Raised by |
|---|---|
| Manufacturing processes — machining, welding, foundry, forging | ME-105 |
| Geometric dimensioning and tolerancing, development of surfaces | ME-124 |
| Cloud computing, web/mobile development, database systems | CS-117 |
| General language proficiency, expository essay composition | HU-114, ENGL-101 |
| New venture finance and business planning | MGT-271 |

---

# Part B — Curriculum data issues

## B1. `CHE-103.md` contains the wrong course

**Severity: high — corrupts mapping and the public site.**

`courses/CHE-103.md` is titled "CHE-103: Chemical Engineering Principles-**II**",
states semester 3, prerequisite CEP-I, and its contents are energy balances. But
`CHE-103` in `data.json` is Principles-**I**, semester 1, which teaches material
balances. The file duplicates `CHE-222` and even carries a note at the bottom
saying so.

**Effect:** CHE-103 was mapped from CLOs only. Its material-balance content is
under-evidenced, and the published site shows the wrong syllabus for it.

**Fix needed:** source the real Principles-I outline.

## B2. `PHY-102` CLOs are duplicated in `data.json`

**Severity: medium.**

Five distinct CLOs are stored twice — 10 entries. Checked all 51 courses; this is
the only one affected. Real programme CLO total is **198**, not 203.

**Effect:** inflates CLO counts and double-weights PHY-102 in any per-CLO
statistic, including PLO attainment. Worth checking whether `excel_to_json.py`
should de-duplicate on ingest.

## B3. `MATH-121` and `MATH-243` appear to have swapped CLOs

**Severity: high for accreditation reporting.**

| Course | CLOs describe | Outline teaches |
|---|---|---|
| MATH-121 Linear Algebra & ODEs | multivariable functions, partial derivatives, integration of several variables | linear algebra, ODEs, Laplace transforms |
| MATH-243 Vector Calculus | characterisation and solution of ODEs and PDEs | 3-space geometry, del operator, grad/curl/div, multiple integration |

Each course's CLOs read like the other's syllabus.

**Effect:** if real, PLO attainment is being computed against the wrong course.
This matters beyond this project. Verify against the Qalam record.

## B4. Sixteen courses had no outline; nine recovered by renumbering

The `courses/` folder held outlines under an older numbering scheme. Confirmed by
the department as the same courses renumbered; each match verified by reading
contents, recorded in `outline_aliases.json`.

**Still undocumented (6):**

| Course | Why it matters |
|---|---|
| **CHE-344 Separation Processes I** | **Highest priority.** No outline *and* generic CLOs naming no technique. Its distillation and absorption content is invisible to the analysis. |
| CHE-360 Fundamentals of Polymer Engineering | Only 2 CLOs; carries KA-12 polymer units |
| CHE-442 Membrane Technology | Only 3 CLOs; carries KU-07.07 |
| CHE-499 Final Year Design Project-II | Project course; carries the KA-11 design capstone |
| CSL-402 Community Service Learning | Non-technical |
| HU-115 Principles of Sociology | Non-technical |

**Two aliases are `partial` and must not be over-read:**

- `CHE-425 Maintenance & Process Safety` uses `CHE-455 Maintenance & **Utility**
  Engineering`. The file has maintenance content but **no process safety**.
  No safety mapping may be drawn from it.
- `OTM-456 Production & Operations Management` uses `CHE-436 Operations
  Management **and Risk Assessment**` — the file has extra content the current
  course may not teach.

## B5. Filename typos in `courses/`

| File | Actually contains | Status |
|---|---|---|
| `HI-114.md` | HU-114 Functional English | **fixed** — renamed to `HU-114.md` |
| `CHE-555.md` | CHE-455 Maintenance & Utility Engineering | not fixed — orphan |
| `MGT-442.md` | MGT-422 Project Management | not fixed — orphan |

## B6. Twelve orphan outlines for courses not in the current scheme

Not used in the mapping. Listed in `outline_aliases.json` under
`unused_orphans`. Two are worth a decision:

- **`CHE-453 Environmental Engineering`** — there is no environmental course in
  the current 51. If it was dropped, that is directly relevant to the KA-13
  coverage finding below.
- **`CHE-447 Advanced Process Control`** — would cover KU-10.03 at depth.

## B7. Candidate genuine curriculum gaps

Distinct from documentation gaps. These need instructor confirmation before
being reported as findings.

| Unit | Observation |
|---|---|
| `KU-08.04` Non-Ideal Flow and Residence Time | CHE-347's syllabus lists ideal reactors, multiple, heterogeneous and non-isothermal reactions — but no RTD, dispersion or tanks-in-series |
| `KA-13` Safety, Health and Environment | After 6 semesters only KU-13.04 is touched, and every hit is a lab-conduct CLO ("follow lab safety protocols"), not taught safety content. Hazard identification, risk assessment, inherent safety, environmental engineering and sustainability are all untouched so far. |

KA-13 is the finding to be most careful about: it is the area accreditation
weights most heavily, and the one course that should cover it (CHE-425) has only
a partial alias outline with no safety content. Confirm before publishing.


---

# Part A — what was actually added

| Gap | Fix applied |
|---|---|
| A1 physics | **KA-15 Physics for Chemical Engineers** — Classical Mechanics, Oscillations and Waves, Electricity and Magnetism (3 units, 11 topics) |
| A2 machine learning | **KU-01.08 Data Science and Machine Learning** — supervised, unsupervised, validation, data-driven process modelling, reinforcement/ensemble |
| A3 materials structure | **KU-12.06 Crystal Structure and Phase Behaviour** — crystal structures, defects, diffusion, binary phase diagrams |
| A4 electrochemical | topic **T-04.05.05 Electrochemical Energy Conversion** added to KU-04.05 |
| A5 leaching | topic **T-07.04.05** added; KU-07.04 renamed *Liquid-Liquid Extraction and Leaching* |
| A6 KA-01 topics | analytical geometry, complex numbers; plus **KU-01.09 Quantitative and Logical Reasoning** |
| A7 KA-02 topics | chemical bonding / molecular orbitals; nuclear and radiochemistry |
| A8 microeconomics | topic **T-11.04.06 Market Economics** added to KU-11.04 |
| sector gap (sem 7-8) | **KA-16 Energy and Process Industry Sectors** — Petroleum Refining, Natural Gas Processing, Fuels and Combustion Technology, Petrochemicals |
| utilities | **KU-11.07 Plant Utility Systems** |
| NDT, metrology, queuing | topics added to KU-11.06, KU-10.04, KU-01.07 |

Coverage of the enlarged reference: **76 strong · 1 moderate · 7 weak · 8 very
weak · 1 uncovered**. Only KU-16.04 Petrochemicals came out weak among the new
units, which is honest — CH-113 mentions petrochemical applications once.

21 `unmapped` entries remain, all deliberate: content genuinely outside a ChemE
body of knowledge (A9), plus CHE-344's unidentifiable separation techniques and
CHE-347's absent residence time distribution, which are curriculum questions
rather than reference gaps.
