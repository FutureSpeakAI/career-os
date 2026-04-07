# Architecture

## System Overview

```
                    +----------------------------------+
                    |         Claude Code Agent         |
                    |   (reads CLAUDE.md + modes/*.md)  |
                    +-----------+----------------------+
                                |
            +-------------------+---------------------+
            |                   |                      |
     +------v------+    +------v------+    +-----------v---------+
     | Single Eval  |    | Portal Scan |    |   Batch Process     |
     | (auto-pipe)  |    |  (scan.md)  |    |   (batch-runner)    |
     +------+------+    +------+------+    +-----------+---------+
            |                  |                        |
            |           +------v------+           +----v-----+
            |           | pipeline.md |           | N workers|
            |           | (URL inbox) |           | (claude -p)
            |           +-------------+           +----+-----+
            |                                          |
     +------v------------------------------------------v------+
     |                    Output Pipeline                       |
     |  +----------+  +------------+  +-------------------+   |
     |  | Report.md|  |  PDF (HTML |  | Tracker TSV       |   |
     |  | (A-F eval)|  |  Playwright)|  | (merge-tracker)  |   |
     |  +----------+  +------------+  +-------------------+   |
     +---------------------------------------------------------+
                               |
                    +----------v-----------+
                    |  data/applications.md  |
                    |  (canonical tracker)   |
                    +-----------------------+
```

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (from user's target roles)
4. **Evaluate**: 6 blocks (A-F):
   - A: Role summary
   - B: CV match (gaps + mitigation)
   - C: Level strategy
   - D: Comp research (WebSearch)
   - E: CV personalization plan
   - F: Interview prep (STAR stories)
5. **Score**: Weighted average across 10 dimensions (1-5)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`generate-pdf.mjs`)
8. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged

## Batch Processing

The batch system processes multiple offers in parallel:

```
batch-input.tsv    ->  batch-runner.sh  ->  N x claude -p workers
(id, url, source)     (orchestrator)       (self-contained prompt)
                           |
                    batch-state.tsv
                    (tracks progress)
```

Each worker is a headless Claude instance (`claude -p`) that receives the full `batch-prompt.md` as context. Workers produce:
- Report .md
- PDF
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Data Flow

```
cv.md                    ->  Evaluation context
article-digest.md        ->  Proof points for matching
config/profile.yml       ->  Candidate identity
portals.yml              ->  Scanner configuration
templates/states.yml     ->  Canonical status values
templates/cv-template.html -> PDF generation template
```

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Pipeline Integrity

Scripts maintain data consistency:

| Script | Purpose |
|--------|---------|
| `merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `normalize-statuses.mjs` | Maps status aliases to canonical values |
| `cv-sync-check.mjs` | Validates setup consistency |

## Dashboard TUI

The `dashboard/` directory contains a standalone Go TUI application:

- Filter tabs: All, Evaluated, Applied, Interview, Top >=4, Skip
- Sort modes: Score, Date, Company, Status
- Grouped/flat view
- Lazy-loaded report previews
- Inline status picker

## Mode System

Career-OS uses a skill-based mode system routed through `.claude/skills/career-os/SKILL.md`:

| Mode | Purpose | English Alias |
|------|---------|---------------|
| auto-pipeline | Full pipeline | (default for JD input) |
| oferta | Single evaluation | evaluate |
| ofertas | Multi-offer comparison | compare |
| contacto | LinkedIn outreach | outreach |
| pdf | CV generation | |
| scan | Portal scanner | |
| batch | Parallel processing | |
| apply | Form filling | |
| deep | Company research | |
| pipeline | URL inbox processing | |
| tracker | Status overview | |
| training | Course/cert evaluation | |
| project | Portfolio project evaluation | |
