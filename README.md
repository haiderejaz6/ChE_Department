# SCME OBE Dashboard

Live, interactive visualisation of Course Learning Outcomes (CLOs), Programme Learning Outcomes (PLOs), and Bloom's Taxonomy distribution for the **BE Chemical Engineering** programme at the School of Chemical & Materials Engineering, NUST.

## Repository layout

```
├── index.html                  ← Dashboard (GitHub Pages entry point)
├── data.json                   ← Structured CLO/PLO data (auto-generated)
├── Qalam_CLOs.xlsx             ← Source Excel file exported from Qalam
├── scripts/
│   └── excel_to_json.py        ← Converts Excel → data.json
└── .github/
    └── workflows/
        └── update_data.yml     ← GitHub Action: auto-updates data.json on push
```

## Dashboard features

| Section | What it shows |
|---|---|
| **PLO Coverage Matrix** | Heatmap of every course × PLO combination — colour = which PLO, brightness = emphasis level, number = CLO count. Hover for details. |
| **Bloom's Domain Distribution** | Stacked bar chart showing the cognitive / psychomotor / affective split per course. |
| **Course Explorer** | Expandable cards for every course — click to reveal individual CLOs with PLO tag, domain level, and emphasis. |
| **PLO Reference Footer** | Quick legend for all 12 PLOs. |

Batch filter tabs at the top let you drill into a single cohort (2022F, 2023F, 2024F, 2025F).

## Updating the data

### Manually (one-time)

```bash
pip install pandas openpyxl
python scripts/excel_to_json.py
# then commit and push data.json
```

### Automatically (recommended)

1. Copy your updated `Qalam_CLOs.xlsx` into the repo root.
2. `git add Qalam_CLOs.xlsx && git commit -m "update CLO data" && git push`
3. The **Update OBE Data** GitHub Action runs, regenerates `data.json`, and commits it automatically.
4. GitHub Pages redeploys — the live site reflects the new data within ~60 seconds.

> The script reads the sheet named `Qalam_CLOs` (configurable at the top of the script).
> Expected columns: `Course Code`, `Course Title`, `CLO Code`, `Program Batch`, `PLO`, `Emphasis Level`, `Domain Level`, `Description`.

## Enabling GitHub Pages

1. Go to **Settings → Pages** in this repository.
2. Source: **Deploy from a branch** → branch `main` → folder `/` (root).
3. Save — your site will be live at `https://<your-username>.github.io/<repo-name>/`.

## Colour coding reference

**Emphasis levels** — Low (dim) · Medium (mid brightness) · High (full brightness)

**Bloom's domains** — C-2 Understand · C-3 Apply · C-4 Analyze · C-5 Evaluate · C-6 Create · P-3 Precision · P-4 Articulation · A-3 Valuing

**PLO colours** are consistent across all views and the footer legend.
