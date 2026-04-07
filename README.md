# Career-OS

**Your AI-powered career advancement operating system, built on Claude Code.**

> Evaluate offers. Generate tailored CVs. Scan job portals. Talk to your AI career coach. Track everything. One command.

[![FutureSpeak.AI](https://img.shields.io/badge/FutureSpeak.AI-000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJMMiAyMmgyMEwxMiAyeiIvPjwvc3ZnPg==&logoColor=white)](https://futurespeak.ai)
![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Gemini Live](https://img.shields.io/badge/Gemini_Live-4285F4?style=flat&logo=google&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## What is Career-OS?

Career-OS turns Claude Code into a full job search command center with a web dashboard and voice-enabled AI career coach. Instead of juggling spreadsheets, PDFs, and browser tabs, you get an AI-powered pipeline that does the tedious work so you can focus on what matters: finding the right role.

### Two Interfaces

**Web Dashboard** (`npm start`) -- A 12-tab SPA at `http://localhost:3333` with:
- Pipeline management, application tracking, interview prep
- Gemini Live voice agent for interview roleplay and career coaching
- AI-powered resume, cover letter, and email generation (Claude API)
- Job listing verification, company research, compensation lab
- Persistent memory -- the agent remembers your conversations across sessions

**Claude Code CLI** (`/career-os`) -- The original command-line interface with 23 modes for power users who want full control.

Both interfaces share the same data files, so you can switch between them freely.

## Quick Start

```bash
git clone https://github.com/FutureSpeakAI/career-os.git
cd career-os
npm run setup
```

Then either:

```bash
# Option A: Web dashboard (recommended)
npm start
# Open http://localhost:3333

# Option B: Claude Code CLI
claude
# Type: /career-os setup
```

### API Keys

Copy `.env.example` to `.env` and add your keys:

| Key | Required For | Get It |
|-----|-------------|--------|
| `GEMINI_API_KEY` | Voice agent, interview roleplay | [Google AI Studio](https://aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` | AI generation (resumes, cover letters, emails) | [Anthropic Console](https://console.anthropic.com/) |
| `OPENAI_API_KEY` | Alternative LLM evaluation | [OpenAI Platform](https://platform.openai.com/) |
| `PERPLEXITY_API_KEY` | Deep company research | [Perplexity API](https://www.perplexity.ai/) |
| `FIRECRAWL_API_KEY` | Advanced JD extraction | [Firecrawl](https://firecrawl.dev/) |

The voice agent requires `GEMINI_API_KEY`. AI generation requires `ANTHROPIC_API_KEY`. Everything else is optional.

## Web Dashboard

Start the server and open `http://localhost:3333`:

```bash
npm start
```

### 12 Interactive Tabs

| Tab | Features |
|-----|----------|
| **Pipeline** | 3-tier offer tables (C-Suite/Director/Other), search/filter, "Evaluate JD" modal, "Run Scan" trigger, "Verify All Listings" batch check |
| **Tracker** | Status funnel, sortable table, per-row Generate Resume/Cover Letter/Email, Export Package, status updates |
| **Interview Prep** | STAR story bank, 7 meeting prep briefs, interview roleplay launcher (connects to voice agent) |
| **CRM** | Contacts with outreach drafting, follow-up queue, outreach templates |
| **Comp Lab** | Current/Target/Walk-away cards, market range visualization, negotiation playbook, "Practice Negotiation" with voice agent |
| **Brand** | Brand positioning, content calendar, engagement metrics, article digest |
| **Analytics** | Score distribution chart, status funnel, velocity metrics, smart recommendations |
| **Connectors** | MCP service status, API key status, setup guide |
| **Inbox** | Email monitoring with category badges, draft replies |
| **Calendar** | Monthly grid with interview events, prep blocks |
| **Research** | Company deep dive (AI strategy, culture, Glassdoor, your angle) |
| **Settings** | CV editor, profile editor, portal manager, story editor -- all in-browser |

### Voice Agent

The dashboard includes a persistent Gemini Live voice agent (right sidebar) that:
- Responds to text and voice input (push-to-talk microphone)
- Does interview roleplay and negotiation practice
- Remembers conversations across sessions via persistent memory
- Extracts career facts and action items automatically
- Uses Gemini 2.5 Flash Native Audio with the Kore voice

### AI Generation

"Generate with AI" buttons throughout the dashboard, powered by Claude API:
- **Resume** -- tailored to a specific tracked role
- **Cover Letter** -- JD-matched with proof points
- **Email Draft** -- follow-up, thank you, response
- **Interview Prep** -- STAR stories + likely questions
- **Export Package** -- complete application bundle (resume + cover letter + answers)
- **Company Research** -- deep dive on any company
- **Smart Recommendations** -- weekly priority suggestions

## CLI Usage

Career-OS is also a Claude Code slash command with 23 modes:

```
/career-os                  Show all available commands
/career-os {paste a JD}     Full auto-pipeline (evaluate + PDF + tracker)
/career-os scan             Scan portals for new offers
/career-os evaluate         Evaluate a single offer (A-F blocks)
/career-os compare          Compare and rank multiple offers
/career-os pdf              Generate ATS-optimized CV
/career-os batch            Batch evaluate multiple offers
/career-os tracker          View application status
/career-os apply            Fill application forms with AI
/career-os pipeline         Process pending URLs from inbox
/career-os outreach         LinkedIn outreach message
/career-os deep             Deep company research
/career-os training         Evaluate a course/cert
/career-os project          Evaluate a portfolio project

Connectivity:
/career-os inbox            Monitor email for employer responses
/career-os voice            Interview roleplay & coaching
/career-os schedule         Manage interview calendar
/career-os design           Create visual materials (Canva/Figma)
/career-os store            Manage documents in cloud (Box)
/career-os connect          Show connectivity status
```

## How It Works

### The 6-Block Evaluation

| Block | What it does |
|-------|-------------|
| **A. Role Summary** | Archetype detection, domain, seniority, remote status |
| **B. CV Match** | Maps each JD requirement to your CV with gap analysis |
| **C. Level Strategy** | Positioning plan, downlevel contingency |
| **D. Comp Research** | Live market data from Glassdoor, Levels.fyi, Blind |
| **E. Personalization** | Top 5 CV changes + Top 5 LinkedIn changes |
| **F. Interview Prep** | 6-10 STAR+Reflection stories mapped to JD requirements |

### Scoring (10 Dimensions)

| Dimension | Weight |
|-----------|--------|
| North Star alignment | 25% |
| CV match | 15% |
| Seniority level | 15% |
| Estimated comp | 10% |
| Growth trajectory | 10% |
| Remote quality | 5% |
| Company reputation | 5% |
| Tech stack modernity | 5% |
| Time-to-offer speed | 5% |
| Cultural signals | 5% |

## Project Structure

```
career-os/
+-- CLAUDE.md                     # Agent instructions (the brain)
+-- dashboard-server.mjs          # Express + WebSocket server
+-- public/index.html             # Web dashboard SPA
+-- dashboard-web.mjs             # Static dashboard generator (fallback)
+-- cv.md                         # Your CV (you create this)
+-- config/
|   +-- profile.example.yml      # Template for your profile
+-- modes/                        # 23 skill modes
|   +-- _shared.md               # Shared context (archetypes, scoring)
|   +-- auto-pipeline.md, scan.md, ...
+-- templates/
|   +-- cv-template.html         # ATS-optimized CV template
|   +-- portals.example.yml      # Scanner config template
|   +-- states.yml               # Canonical application statuses
+-- data/                         # Your tracking data (gitignored)
|   +-- applications.md          # Application tracker
|   +-- pipeline.md              # Pending offers
|   +-- agent-memory.json        # Voice agent persistent memory
|   +-- conversations/           # Conversation logs
+-- reports/                      # Evaluation reports (gitignored)
+-- output/                       # Generated PDFs (gitignored)
+-- crm/                          # Contacts, follow-ups, outreach
+-- comp-lab/                     # Market data, negotiation playbook
+-- brand/                        # Positioning, content calendar
+-- analytics/                    # Pipeline metrics, rejection patterns
+-- interview-prep/               # STAR stories, company prep
+-- meetings/prep-templates/      # 7 meeting prep brief templates
+-- batch/                        # Batch processing system
+-- dashboard/                    # Go TUI pipeline viewer (optional)
+-- fonts/                        # Space Grotesk + DM Sans
+-- docs/                         # Setup, customization, architecture
+-- __tests__/                    # Test suite
```

## NPM Scripts

```bash
npm run setup          # Install + scaffold + validate
npm start              # Start web dashboard at localhost:3333
npm run dashboard      # Generate static HTML dashboard
npm run verify         # Health check: statuses, duplicates, broken links
npm run merge          # Merge batch tracker additions
npm run dedup          # Remove duplicate entries
npm run normalize      # Fix non-canonical statuses
npm run pdf            # Generate PDF from HTML
npm run sync-check     # Validate CV/profile/portals consistency
npm test               # Run test suite
```

## Tech Stack

- **Agent**: Claude Code with custom skills and modes
- **Web Dashboard**: Express + vanilla JS SPA (FutureSpeak.AI design system)
- **Voice Agent**: Gemini 2.5 Flash Native Audio via WebSocket proxy
- **AI Generation**: Claude API (Anthropic) for resumes, cover letters, emails
- **PDF**: Playwright + HTML template (Space Grotesk + DM Sans)
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Data**: Markdown tables + YAML config + TSV batch files + JSON memory
- **Tests**: Node.js built-in test runner

## Connectors

| Service | Connection | Purpose |
|---------|-----------|---------|
| Gmail | Claude Code MCP | Inbox monitoring, draft responses |
| Google Calendar | Claude Code MCP | Interview scheduling, prep blocks |
| Box | Claude Code MCP | Cloud document storage |
| Canva | Claude Code MCP | Visual design (cover letters, decks) |
| Figma | Claude Code MCP | Architecture diagrams |
| Gemini Live | API key (.env) | Voice agent, interview roleplay |
| Claude API | API key (.env) | AI generation (resumes, emails) |
| Perplexity | API key (.env) | Deep company research |

## Ethical Use

**This system is designed for quality, not quantity.** The goal is to help you find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- Applications are **never submitted without your review**
- Low-fit scores (below 3.0) trigger explicit warnings
- Every application a recruiter reads costs someone's attention -- only send what's worth reading

## Attribution

Career-OS is built on [**career-ops**](https://github.com/santifer/career-ops) by [Santiago Fernandez de Valderrama](https://santifer.io), released under the MIT license. Santiago used it to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role.

Career-OS extends the original with a web dashboard, voice agent, AI content generation, persistent memory, 12 additional modes, and streamlined onboarding.

## About

Career-OS is a [FutureSpeak.AI](https://futurespeak.ai) project, maintained by [Stephen C. Webster](https://github.com/FutureSpeakAI).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Open an issue first to discuss your idea before submitting a PR.

## License

MIT -- see [LICENSE](LICENSE).
