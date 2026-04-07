# Architecture

## System Overview

```
                    +--------------------------------------+
                    |          Web Dashboard (SPA)          |
                    |     public/index.html @ :3333         |
                    |  12 tabs, voice agent, AI generation  |
                    +------------------+-------------------+
                                       |
                    +------------------v-------------------+
                    |       Express + WebSocket Server      |
                    |        dashboard-server.mjs           |
                    |  REST API + Gemini Live WS proxy     |
                    +---+----------+----------+------------+
                        |          |          |
              +---------v--+  +---v-------+  +v-----------+
              | Gemini Live |  | Claude API|  | File I/O   |
              | (voice WS)  |  | (generate)|  | (data/*.md)|
              +------------+  +-----------+  +------------+

                    +--------------------------------------+
                    |         Claude Code Agent (CLI)       |
                    |   reads CLAUDE.md + modes/*.md        |
                    |   23 modes via /career-os skill       |
                    +------------------+-------------------+
                                       |
            +-----------+--------------+-----------+
            |           |              |           |
     +------v----+ +---v-------+ +---v-----+ +---v--------+
     | Evaluation | | Portal    | | Batch   | | MCP        |
     | Pipeline   | | Scanner   | | Workers | | Connectors |
     +------+----+ +---+-------+ +---+-----+ +---+--------+
            |           |             |           |
     +------v-----------v-------------v-----------v--------+
     |                    Shared Data Layer                  |
     |  data/applications.md  data/pipeline.md  cv.md       |
     |  data/agent-memory.json  config/profile.yml          |
     |  reports/*.md  data/conversations/*.json              |
     +-----------------------------------------------------+
```

## Web Dashboard Architecture

### Server (dashboard-server.mjs)

Express 5 app on port 3333 with:

**Data Endpoints (GET)**:
- `/api/profile` -- parsed config/profile.yml
- `/api/pipeline` -- parsed data/pipeline.md
- `/api/tracker` -- parsed data/applications.md
- `/api/reports` / `/api/reports/:file` -- evaluation reports
- `/api/scan-history` -- parsed data/scan-history.tsv
- `/api/contacts` / `/api/follow-ups` / `/api/story-bank` -- CRM + interview data
- `/api/connectors` -- API key status (boolean only, never actual values)
- `/api/comp` / `/api/brand` / `/api/analytics` -- lab data + computed metrics
- `/api/memory` -- persistent agent memory
- `/api/conversation/latest` -- latest conversation log
- `/api/inbox` / `/api/calendar` -- MCP placeholders
- `/api/recommendations` -- smart priority suggestions

**Action Endpoints (POST/PATCH/PUT)**:
- `POST /api/evaluate` -- evaluate JD via Claude API
- `POST /api/scan` -- trigger portal scan via Greenhouse APIs
- `POST /api/generate` -- generate resume/cover letter/email/prep via Claude
- `POST /api/verify` / `/api/verify-all` -- check if job listings are still live
- `POST /api/research` -- deep company research via Claude
- `POST /api/export-package` -- full application package generation
- `POST /api/stories` -- add STAR story
- `POST /api/memory` / `POST /api/memory/extract` -- save/extract memories
- `POST /api/conversation/save` -- persist conversation
- `PATCH /api/tracker/:num` -- update application status
- `GET/PUT /api/file/:name` -- read/write whitelisted files (cv, profile, portals, story-bank)

**WebSocket Proxy** (`/ws/gemini`):
- Bidirectional proxy between browser and Gemini Live API
- Translates simple client format ↔ Gemini protocol
- Text via `clientContent` (turn-based), audio via `realtimeInput`
- Dynamic system instruction built from memories + pipeline state
- 30-second keep-alive pings

### Frontend (public/index.html)

Single-page application with:
- 12 tab panels with full interactivity
- Persistent chat/voice sidebar (Gemini Live via WebSocket)
- Client-side: tab switching, filters, sorting, collapsibles, hash routing
- Audio: PCM capture (ScriptProcessorNode, 16kHz) + gapless PCM playback (Web Audio API, 24kHz)
- Persistence: localStorage for chat history, server-side conversation logs + memory extraction

### Voice Agent Pipeline

```
User speaks → Mic (16-bit PCM 16kHz) → Base64 JSON → Server WS → Gemini Live API
                                                                        |
User hears  ← Web Audio (24kHz PCM) ← Base64 JSON ← Server WS  ←------+
User reads  ← Chat bubble (streaming text)  ←--------+
```

### Memory System

```
Conversation (every 10 turns)
        |
        v
POST /api/memory/extract
        |
        v
Claude API: "Extract career facts + action items"
        |
        v
data/agent-memory.json
  - careerFacts[]    (role changes, achievements, skills)
  - preferences[]    (interview style, communication)
  - actionItems[]    (update CV, follow up, etc.)
  - conversations[]  (date + summary)
        |
        v
buildSystemInstruction()  (injected on next WS connect)
```

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (from user's target roles)
4. **Evaluate**: 6 blocks (A-F): role summary, CV match, level strategy, comp research, personalization, interview prep
5. **Score**: Weighted average across 10 dimensions (1-5)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`generate-pdf.mjs`)
8. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged

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
| inbox | Email monitoring | |
| voice | Interview roleplay | |
| schedule | Calendar management | |
| design | Visual design | |
| store | Cloud storage | |
| connect | Connector status | |
| onboard | Setup + interview | setup |

## Pipeline Integrity

| Script | Purpose |
|--------|---------|
| `merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `normalize-statuses.mjs` | Maps status aliases to canonical values |
| `cv-sync-check.mjs` | Validates setup consistency |

## Design System (FutureSpeak.AI)

The web dashboard uses the FutureSpeak.AI brand:
- Background: `#060B19` (deep navy)
- Accents: `#00F0FF` (cyan) + `#8A2BE2` (purple)
- Glassmorphism: `backdrop-filter: blur(12px)`, translucent backgrounds
- Typography: Inter (body) + Fira Code (monospace)
- Animated gradient text on headings
- Glow shadows, neon hover effects
