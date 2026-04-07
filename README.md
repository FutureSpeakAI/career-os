# Career-OS

**Your AI-powered career advancement operating system, built on Claude Code.**

> Evaluate offers. Generate tailored CVs. Scan job portals. Track everything. One slash command.

[![FutureSpeak.AI](https://img.shields.io/badge/FutureSpeak.AI-000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJMMiAyMmgyMEwxMiAyeiIvPjwvc3ZnPg==&logoColor=white)](https://futurespeak.ai)
![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

## What is Career-OS?

Career-OS turns Claude Code into a full job search command center. Instead of juggling spreadsheets, PDFs, and browser tabs, you get an AI-powered pipeline that does the tedious work so you can focus on what matters: finding the right role.

- **Evaluate offers** with a structured 6-block scoring system (10 weighted dimensions)
- **Generate tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scan portals** automatically (Greenhouse, Ashby, Lever, company career pages)
- **Process in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Track everything** in a single source of truth with integrity checks
- **Prepare for interviews** -- accumulates STAR+Reflection stories across evaluations

> **This is NOT a spray-and-pray tool.** The whole point is to apply only where there's a real match -- for your sake and for the recruiter reading your application. The scoring system helps you focus on high-fit opportunities instead of wasting everyone's time.

## Quick Start

```bash
mkdir career && cd career
claude
```

Then inside Claude Code, type:

```
/career-os setup
```

That's it. One command. Career-OS will:

1. **Clone the repo** into your current directory
2. **Install all dependencies** (Node.js packages, Playwright browser)
3. **Start your profile interview** -- a 5-minute conversation where your Career Agent learns everything it needs to build your system

The interview covers your career narrative, target roles, compensation targets, proof points, and application form defaults. It also researches you online to enrich your profile. When it's done, you have a fully personalized career search operating system.

> **Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) and [Node.js 18+](https://nodejs.org/) installed.

### Already cloned?

If you cloned the repo manually, just open Claude Code in the directory and type `/career-os setup`. It will detect the existing files and skip straight to whatever's missing.

## Usage

Career-OS is a single slash command with multiple modes:

```
/career-os                  Show all available commands
/career-os {paste a JD}     Full auto-pipeline (evaluate + PDF + tracker)
/career-os scan             Scan portals for new offers
/career-os pdf              Generate ATS-optimized CV
/career-os batch            Batch evaluate multiple offers
/career-os tracker          View application status
/career-os apply            Fill application forms with AI
/career-os pipeline         Process pending URLs from inbox
/career-os evaluate         Evaluate a single offer (A-F blocks)
/career-os compare          Compare and rank multiple offers
/career-os outreach         LinkedIn outreach message
/career-os deep             Deep company research
/career-os training         Evaluate a course/cert
/career-os project          Evaluate a portfolio project

Connectivity:
/career-os inbox            Monitor email for employer responses
/career-os voice            Interview roleplay & coaching (Gemini Live)
/career-os schedule         Manage interview calendar
/career-os design           Create visual materials (Canva/Figma)
/career-os store            Manage documents in cloud (Box)
/career-os connect          Show connectivity status
```

Or just paste a job URL or description directly -- Career-OS auto-detects it and runs the full pipeline.

> **Bilingual:** The original mode names (`oferta`, `ofertas`, `contacto`) still work alongside the English aliases.

## How It Works

```
You paste a job URL or description
        |
        v
+------------------+
|  Archetype       |  Classifies the role against your target archetypes
|  Detection       |
+--------+---------+
         |
+--------v---------+
|  A-F Evaluation   |  Match analysis, comp research, STAR stories
|  (reads cv.md)    |
+--------+---------+
         |
    +----+----+
    v    v    v
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

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

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline** | Paste a URL, get a full evaluation + PDF + tracker entry |
| **Interview Story Bank** | Accumulates STAR+Reflection stories -- 5-10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **ATS PDF Generation** | Keyword-injected CVs with Space Grotesk + DM Sans design |
| **Portal Scanner** | 45+ companies pre-configured + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **Batch Processing** | Parallel evaluation with `claude -p` workers |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline (optional, requires Go) |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |
| **Form Submission** | AI-powered form filling with portal auto-detection (experimental) |
| **Inbox Monitor** | Scan Gmail for employer responses, auto-draft replies, sync tracker |
| **Voice Roleplay** | Practice interviews with Gemini Live voice agent, get scored feedback |
| **Calendar Manager** | Schedule interviews, auto-block prep time, generate availability |
| **Design Studio** | Create cover letters and portfolio decks via Canva/Figma |
| **Cloud Storage** | Organize application docs in Box with shareable links |

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job boards:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com

## Project Structure

```
career-os/
+-- CLAUDE.md                     # Agent instructions (the brain)
+-- cv.md                         # Your CV (you create this)
+-- config/
|   +-- profile.example.yml      # Template for your profile
+-- modes/                        # 14 skill modes
|   +-- _shared.md               # Shared context (customize archetypes here)
|   +-- auto-pipeline.md         # Full pipeline
|   +-- evaluate.md              # -> oferta.md (English alias)
|   +-- compare.md               # -> ofertas.md (English alias)
|   +-- outreach.md              # -> contacto.md (English alias)
|   +-- scan.md, pdf.md, ...     # Other modes
+-- templates/
|   +-- cv-template.html         # ATS-optimized CV template
|   +-- portals.example.yml      # Scanner config template
|   +-- states.yml               # Canonical application statuses
+-- batch/                        # Batch processing system
+-- dashboard/                    # Go TUI pipeline viewer (optional)
+-- data/                         # Your tracking data (gitignored)
+-- reports/                      # Evaluation reports (gitignored)
+-- output/                       # Generated PDFs (gitignored)
+-- fonts/                        # Space Grotesk + DM Sans (self-hosted)
+-- docs/                         # Setup, customization, architecture
+-- examples/                     # Sample CV, report, proof points
+-- __tests__/                    # Test suite
```

## NPM Scripts

```bash
npm run setup          # One-command setup (install + scaffold + validate)
npm run verify         # Health check: statuses, duplicates, broken links
npm run merge          # Merge batch tracker additions into applications.md
npm run dedup          # Remove duplicate entries
npm run normalize      # Fix non-canonical statuses
npm run pdf            # Generate PDF from HTML
npm run sync-check     # Validate CV/profile/portals consistency
npm test               # Run test suite
```

## Dashboard TUI (Optional)

The built-in terminal dashboard lets you browse your pipeline visually:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes. Requires Go 1.21+.

## Tech Stack

- **Agent**: Claude Code with custom skills and modes
- **PDF**: Playwright + HTML template (Space Grotesk + DM Sans)
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Data**: Markdown tables + YAML config + TSV batch files
- **Tests**: Node.js built-in test runner

## Ethical Use

**This system is designed for quality, not quantity.** The goal is to help you find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- Applications are **never submitted without your review**
- Low-fit scores (below 3.0) trigger explicit warnings
- Every application a recruiter reads costs someone's attention -- only send what's worth reading

## Attribution

Career-OS is built on top of [**career-ops**](https://github.com/santifer/career-ops) by [Santiago Fernandez de Valderrama](https://santifer.io), released under the MIT license. Santiago built career-ops to manage his own job search -- he used it to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role.

Career-OS extends the original with:
- **One-command setup** -- `npm run setup` handles everything
- **English mode aliases** -- `evaluate`, `compare`, `outreach` alongside the original Spanish names
- **Test suite** -- automated tests for pipeline integrity scripts
- **CI/CD** -- GitHub Actions workflow for pull request validation
- **Streamlined onboarding** -- Claude auto-detects first run and guides you through

The companion portfolio site is also open source: [cv-santiago](https://github.com/santifer/cv-santiago).

## About

Career-OS is a [FutureSpeak.AI](https://futurespeak.ai) project, maintained by [Stephen C. Webster](https://github.com/FutureSpeakAI).

Built because the job search process is broken -- not because people lack talent, but because the tooling hasn't caught up with what AI can do. Career-OS is the system we use ourselves.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Open an issue first to discuss your idea before submitting a PR.

## License

MIT -- see [LICENSE](LICENSE).
