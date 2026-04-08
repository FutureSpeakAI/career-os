# Career-OS -- AI Career Advancement Operating System

## Origin & Attribution

This system is built on [career-ops](https://github.com/santifer/career-ops) by [Santiago Fernandez de Valderrama](https://santifer.io), who used it to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. Career-OS extends the original with streamlined onboarding, English mode aliases, a test suite, and CI/CD.

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (Claude) can edit any file in this system. The user says "change the archetypes to data engineering roles" and you do it.

## What is Career-OS

AI-powered career advancement operating system built on Claude Code: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing, voice-enabled AI career coach, and a full web dashboard.

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `data/agent-memory.json` | Voice agent persistent memory (auto-created) |
| `data/conversations/` | Conversation logs by date (auto-created) |
| `portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `generate-pdf.mjs` | Puppeteer: HTML to PDF |
| `dashboard-server.mjs` | Express + WebSocket server for web dashboard (43 routes) |
| `dashboard-web.mjs` | Static HTML dashboard generator (fallback) |
| `public/index.html` | Web dashboard SPA (12 tabs, voice agent) |
| `lib/parsers.mjs` | Shared parsing functions (Markdown tables, YAML, pipeline, tracker) |
| `lib/intelligence.mjs` | AI helpers (proof point extraction, summarization, title filtering) |
| `lib/compression.mjs` | Gzip/deflate response compression middleware |
| `lib/cache-headers.mjs` | ETag-based cache validation middleware |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`) |

### Web Dashboard

The web dashboard is a full SPA served at `http://localhost:3333`. Start with:
```bash
npm start
```

Features: 12 interactive tabs (Pipeline, Tracker, Interview Prep, CRM, Comp Lab, Brand, Analytics, Connectors, Inbox, Calendar, Research, Settings), Gemini Live voice agent with persistent memory, AI content generation (resumes, cover letters, emails), job listing verification, and more.

The voice agent uses Gemini 2.5 Flash Native Audio via WebSocket proxy. It remembers conversations across sessions and extracts career facts automatically.

### First Run -- Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Does `node_modules/` exist? (dependencies installed)
2. Does `cv.md` exist?
3. Does `config/profile.yml` exist (not just profile.example.yml)?
4. Does `portals.yml` exist (not just templates/portals.example.yml)?

**If ANY of these are missing, enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until setup is complete.

**Read and execute `modes/onboard.md`** -- this handles EVERYTHING automatically:
- Clones the repo (if the user started from an empty directory)
- Installs npm packages and Playwright Chromium
- Scaffolds config files and data directories
- Conducts a structured 7-section interview to build the user's profile
- Researches the user online to enrich their profile
- Customizes archetypes, portals, and templates based on their answers

The entire flow from empty directory to fully-configured system requires only one user action: typing `/career-os setup` in Claude Code. Everything else is automatic until the interview questions begin.

#### Tracker Setup
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/career-os scan` to search portals
> - Run `/career-os` to see all commands
>
> Everything is customizable -- just ask me to change anything."

### Personalization

This system is designed to be customized by YOU (Claude). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" -> edit `modes/_shared.md`
- "Translate the modes to English" -> edit all files in `modes/`
- "Add these companies to my portals" -> edit `portals.yml`
- "Update my profile" -> edit `config/profile.yml`
- "Change the CV template design" -> edit `templates/cv-template.html`
- "Adjust the scoring weights" -> edit `modes/_shared.md` and `batch/batch-prompt.md`

### Skill Modes

| If the user... | Mode | Alias |
|----------------|------|-------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) | |
| Asks to evaluate offer | `oferta` | `evaluate` |
| Asks to compare offers | `ofertas` | `compare` |
| Wants LinkedIn outreach | `contacto` | `outreach` |
| Asks for company research | `deep` | |
| Wants to generate CV/PDF | `pdf` | |
| Evaluates a course/cert | `training` | |
| Evaluates portfolio project | `project` | |
| Asks about application status | `tracker` | |
| Fills out application form | `apply` | |
| Searches for new offers | `scan` | |
| Processes pending URLs | `pipeline` | |
| Batch processes offers | `batch` | |

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use -- CRITICAL

**This system is designed for quality, not quantity.** The goal is to help the user find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs -- but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **Discourage low-fit applications.** If a score is below 3.0/5, explicitly tell the user this is a weak match and recommend skipping unless they have a specific reason.
- **Quality over speed.** A well-targeted application to 5 companies beats a generic blast to 50. Guide the user toward fewer, better applications.
- **Respect recruiters' time.** Every application a human reads costs someone's attention. Only send what's worth reading.

---

## Offer Verification -- MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

**Exception for batch workers (`claude -p`):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`. The user can verify manually later.

---

## Stack and Conventions

- Node.js (mjs modules), Express 5 (server), WebSocket/ws (Gemini proxy), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data)
- Scripts in `.mjs`, configuration in YAML
- Dashboard server: `dashboard-server.mjs` (Express 5 + WS, 43 API routes, Gemini Live voice proxy, Claude chat with tool use)
- Shared modules: `lib/parsers.mjs` (data parsing), `lib/intelligence.mjs` (proof points, summarization, title filtering), `lib/compression.mjs` (gzip middleware), `lib/cache-headers.mjs` (ETag/304 caching)
- Tests: `__tests__/*.test.mjs` via `node --test` (no external test framework), 184 tests across 7 test files
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- check or x mark
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

### API Features

| Feature | Details |
|---------|---------|
| **Rate Limiting** | In-memory sliding window: 10/min AI proxy, 30/min writes, 120/min reads |
| **CORS** | Restricted to localhost origins only (configurable port allowlist) |
| **Security Headers** | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, CSP |
| **WebSocket Hardening** | Connection rate limit (5/min per IP), 1MB message size cap, keep-alive pings |
| **Async I/O** | All file reads use async `fs/promises` (no blocking sync reads in handlers) |
| **Gzip Compression** | `lib/compression.mjs` -- auto-compresses JSON responses >1KB via gzip/deflate |
| **ETag Caching** | `lib/cache-headers.mjs` -- file-backed ETags, 304 Not Modified for unchanged data |
| **Pipeline Pagination** | `GET /api/pipeline?page=1&limit=50&tier=c-suite&q=google` |
| **Memory Dedup** | `save_memory` and `/api/memory/extract` skip duplicate career facts and action items |
| **Data Integrity** | `POST /api/pipeline/add` deduplicates URLs; `GET /api/tracker/duplicates` finds duplicate company+role entries |
| **Error Propagation** | Tool execution errors flagged with `is_error: true` for Claude API tool_result blocks |
| **Actionable Errors** | All 4xx/5xx responses include `hint` field with user-facing fix instructions |
| **Proof Points** | `lib/intelligence.mjs` auto-extracts quantified achievements from CV for voice agent context |
| **Conversation Summarization** | Long chat histories (>20 messages) are locally summarized to preserve context within token limits |
| **Smart Title Filtering** | Portal scan results filtered by positive/negative keywords from `portals.yml` |
| **Skeleton Loaders** | All dashboard sections show animated placeholders until data loads |
| **Error Recovery** | Tab-level error states with retry buttons; global unhandled rejection boundary |
| **Toast Stacking** | Max 5 visible toasts, dedup within 2s window, dismiss buttons |
| **Modal Keyboard** | Escape to close, click-outside-to-close, focus restoration |
| **Workflow Endpoints** | `full-pipeline`, `interview-prep`, `follow-up-batch` -- multi-step orchestrated actions |
| **Smart Recommendations** | Priority-scored suggestions with urgency levels, stats, and weekly goals |

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node verify-pipeline.mjs`
6. Normalize statuses: `node normalize-statuses.mjs`
7. Dedup: `node dedup-tracker.mjs`

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)
