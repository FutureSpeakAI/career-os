# Setup Guide

## Prerequisites

- [Node.js 18+](https://nodejs.org/) (required)
- [Claude Code](https://claude.ai/code) (for CLI interface)
- API keys (see below)

## Install

```bash
git clone https://github.com/FutureSpeakAI/career-os.git
cd career-os
npm run setup
```

The setup script automatically:
1. Installs npm dependencies (Express, WebSocket, Playwright, dotenv)
2. Installs Playwright Chromium (for PDF generation)
3. Scaffolds config files from templates
4. Creates data directories
5. Creates `.env` from `.env.example`
6. Validates API key configuration
7. Checks web dashboard readiness
8. Validates the installation

## API Keys

Copy `.env.example` to `.env` (setup does this automatically) and add your keys:

```bash
# Required for voice agent
GEMINI_API_KEY=your-key-here

# Required for AI content generation (resumes, cover letters, emails)
ANTHROPIC_API_KEY=your-key-here

# Optional
OPENAI_API_KEY=          # Alternative LLM evaluation
OPENROUTER_API_KEY=      # Multi-model batch routing
PERPLEXITY_API_KEY=      # Deep company research
FIRECRAWL_API_KEY=       # Advanced JD extraction
ELEVENLABS_API_KEY=      # High-quality TTS
LOGO_DEV_PUBLISHABLE_KEY= # Company logos
HUGGINGFACE_TOKEN=       # Open-source model access
```

Where to get keys:
- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)
- **Anthropic**: [Anthropic Console](https://console.anthropic.com/)
- **OpenAI**: [OpenAI Platform](https://platform.openai.com/)
- **Perplexity**: [Perplexity API](https://www.perplexity.ai/)

## Start the Web Dashboard

```bash
npm start
```

Open `http://localhost:3333` in your browser. The dashboard includes:
- 12 interactive tabs for all Career-OS features
- Gemini Live voice agent (right sidebar)
- AI content generation buttons
- In-browser CV/profile/portal editors

## Start with Claude Code (CLI)

```bash
claude
```

Then type `/career-os setup` for the profile interview, or `/career-os` to see all commands.

## MCP Connectors (Optional)

These are connected through Claude Code's MCP settings, not API keys:

| Service | Purpose |
|---------|---------|
| Gmail | Inbox monitoring, draft responses |
| Google Calendar | Interview scheduling |
| Box | Cloud document storage |
| Canva | Visual design |
| Figma | Architecture diagrams |

See [CONNECTIVITY.md](CONNECTIVITY.md) for MCP setup instructions.

## Profile Configuration

After setup, personalize your profile either:

1. **Via Claude Code**: Run `/career-os setup` for a guided interview
2. **Via Web Dashboard**: Go to Settings tab and edit profile.yml
3. **Manually**: Edit `config/profile.yml` with your details

Key fields:
- `candidate`: name, email, location, LinkedIn, GitHub
- `target_roles`: primary and secondary roles with archetypes
- `narrative`: headline, exit story, superpowers, proof points
- `compensation`: target, minimum, current
- `application_defaults`: work authorization, relocation, EEO info

## Verify Installation

```bash
npm run sync-check     # Validate configuration
npm run verify         # Check pipeline integrity
npm test               # Run test suite
```

## Attribution

Career-OS is built on [career-ops](https://github.com/santifer/career-ops) by Santiago Fernandez de Valderrama. A [FutureSpeak.AI](https://futurespeak.ai) project.
