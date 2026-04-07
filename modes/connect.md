# Mode: connect -- Connectivity Suite Status & Setup

Shows the status of all connected services and helps configure new ones.

## Connected Services

Check and display the status of all integrations:

### MCP-Based (configured in Claude Code settings)

| Service | MCP Tools | What it does for your job search |
|---------|-----------|----------------------------------|
| **Gmail** | `gmail_*` | Monitor inbox for employer emails, draft responses, send follow-ups |
| **Google Calendar** | `gcal_*` | Schedule interviews, block prep time, find availability |
| **Box** | `mcp__claude_ai_Box__*` | Store and organize application documents, share portfolios |
| **Canva** | `mcp__claude_ai_Canva__*` | Design cover letters, portfolio presentations, infographics |
| **Figma** | `mcp__claude_ai_Figma__*` | Create visual portfolio pieces, design system documentation |

### API Key-Based (configured in .env)

| Service | Key | What it does |
|---------|-----|-------------|
| **Gemini** | `GEMINI_API_KEY` | Voice agent for interview roleplay and coaching |
| **ElevenLabs** | `ELEVENLABS_API_KEY` | High-quality text-to-speech for prep narration |
| **OpenAI** | `OPENAI_API_KEY` | Alternative LLM for evaluation diversity |
| **Perplexity** | `PERPLEXITY_API_KEY` | Deep research on companies and roles |
| **Firecrawl** | `FIRECRAWL_API_KEY` | Advanced web scraping for JD extraction |
| **OpenRouter** | `OPENROUTER_API_KEY` | Multi-model routing for batch processing |
| **Logo.Dev** | `LOGO_DEV_KEY` | Company logos for reports and presentations |

## Status Check

When the user runs `/career-os connect`, check each integration:

### MCP Services

For each MCP service, attempt a lightweight probe:
- **Gmail**: Call `gmail_get_profile` -- if it returns, connected
- **Google Calendar**: Call `gcal_list_calendars` -- if it returns, connected
- **Box**: Call `mcp__claude_ai_Box__who_am_i` -- if it returns, connected
- **Canva**: Try `mcp__claude_ai_Canva__get-assets` -- if it returns, connected
- **Figma**: Call `mcp__claude_ai_Figma__whoami` -- if it returns, connected

### API Keys

Check if `.env` exists and which keys are configured:
- Read `.env` file
- For each expected key, check if it's present and non-empty
- Do NOT display key values -- just show configured/missing

### Output Format

```
Career-OS Connectivity Suite
============================

MCP SERVICES
  Gmail .............. [connected] jane@example.com
  Google Calendar .... [connected] 3 calendars
  Box ................ [connected] Jane Smith
  Canva .............. [connected]
  Figma .............. [connected]

API KEYS (.env)
  Gemini ............. [configured]   Voice roleplay ready
  ElevenLabs ......... [configured]   TTS ready
  OpenAI ............. [configured]
  Perplexity ......... [configured]   Deep research ready
  Firecrawl .......... [configured]   Advanced scraping ready
  OpenRouter ......... [configured]   Multi-model routing ready
  Logo.Dev ........... [configured]
  Anthropic .......... [configured]
  HuggingFace ........ [missing]      Optional

FEATURES AVAILABLE
  /career-os inbox     Monitor employer emails
  /career-os voice     Interview roleplay (Gemini Live)
  /career-os schedule  Manage interview calendar
  /career-os design    Create visual materials (Canva/Figma)
  /career-os store     Manage documents (Box)
```

## Setup Guidance

If services are missing, offer to help configure them:

**For MCP services**: Direct the user to Claude Code settings to add the MCP server connection. These are configured at the Claude Code level, not in Career-OS.

**For API keys**: Guide them to create a `.env` file:

```bash
cp .env.example .env
# Then edit .env with your API keys
```

## Usage

```
/career-os connect          -- Show connectivity status
/career-os connect setup    -- Interactive setup wizard
```
