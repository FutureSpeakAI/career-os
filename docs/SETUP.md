# Setup Guide

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and configured
- Node.js 18+ (for PDF generation and utility scripts)
- (Optional) Go 1.21+ (for the dashboard TUI)

## Recommended: Setup via Claude Code

Create a folder, open Claude Code, and type one command:

```bash
mkdir career && cd career
claude
```

Then inside Claude Code:

```
/career-os setup
```

This clones the repo, installs all dependencies, and starts an interactive profile interview. Everything is automatic -- you just answer the questions.

## Alternative: npm setup (without Claude Code)

If you prefer to install dependencies manually before launching Claude:

```bash
git clone https://github.com/FutureSpeakAI/career-os.git
cd career-os
npm run setup
claude
```

The `npm run setup` script automatically:
1. Installs npm dependencies
2. Installs Playwright Chromium (for PDF generation)
3. Scaffolds config files from templates
4. Creates data directories
5. Builds the dashboard TUI (if Go is available)
6. Validates the installation

## Manual Setup (if you prefer)

### 1. Clone and install

```bash
git clone https://github.com/FutureSpeakAI/career-os.git
cd career-os
npm install
npx playwright install chromium
```

### 2. Configure your profile

```bash
cp config/profile.example.yml config/profile.yml
```

Edit `config/profile.yml` with your personal details: name, email, target roles, narrative, proof points.

### 3. Add your CV

Create `cv.md` in the project root with your full CV in markdown format. This is the source of truth for all evaluations and PDFs.

(Optional) Create `article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals.example.yml portals.yml
```

Edit `portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Add companies you want to track in `tracked_companies`
- Customize `search_queries` for your preferred job boards

### 5. Start using

Open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. Career-OS will automatically evaluate it, generate a report, create a tailored PDF, and track it.

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-os scan` |
| Process pending URLs | `/career-os pipeline` |
| Generate a PDF | `/career-os pdf` |
| Batch evaluate | `/career-os batch` |
| Check tracker status | `/career-os tracker` |
| Fill application form | `/career-os apply` |
| LinkedIn outreach | `/career-os outreach` |
| Compare offers | `/career-os compare` |
| Company research | `/career-os deep` |

## Verify Setup

```bash
npm run sync-check     # Check configuration
npm run verify         # Check pipeline integrity
npm test               # Run test suite
```

## Build Dashboard (Optional)

Requires Go 1.21+:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard
```

## Attribution

Career-OS is built on [career-ops](https://github.com/santifer/career-ops) by Santiago Fernandez de Valderrama. A [FutureSpeak.AI](https://futurespeak.ai) project.
