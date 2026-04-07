# Connectivity Suite

Career-OS integrates with your existing tools to create a seamless job search experience. No switching between apps -- everything happens inside Claude Code.

## MCP Services (configured in Claude Code)

These integrations are managed through Claude Code's MCP server settings, not through Career-OS directly.

### Gmail

**What it does:** Monitors your inbox for employer emails, drafts responses, sends follow-ups.

**Setup:** Add the Gmail MCP server in your Claude Code settings. See [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp).

**Career-OS commands:** `/career-os inbox`

### Google Calendar

**What it does:** Schedules interviews, blocks prep time, checks availability, creates follow-up reminders.

**Setup:** Add the Google Calendar MCP server in Claude Code settings.

**Career-OS commands:** `/career-os schedule`

### Box

**What it does:** Stores application documents, organizes by company, generates shareable links.

**Setup:** Add the Box MCP server in Claude Code settings.

**Career-OS commands:** `/career-os store`

### Canva

**What it does:** Creates designed cover letters, portfolio decks, interview leave-behinds.

**Setup:** Add the Canva MCP server in Claude Code settings.

**Career-OS commands:** `/career-os design`

### Figma

**What it does:** Creates architecture diagrams, reads design context from portfolio projects.

**Setup:** Add the Figma MCP server in Claude Code settings.

**Career-OS commands:** `/career-os design`

## API Keys (configured in .env)

These are optional integrations that enhance specific features.

### Setup

```bash
cp .env.example .env
# Edit .env with your API keys
```

### Voice & Roleplay

| Key | Service | Feature |
|-----|---------|---------|
| `GEMINI_API_KEY` | Google Gemini | Voice interview roleplay via Live API |
| `ELEVENLABS_API_KEY` | ElevenLabs | High-quality text-to-speech |

### LLM Providers

| Key | Service | Feature |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Anthropic | Claude API for batch workers |
| `OPENAI_API_KEY` | OpenAI | Alternative evaluation perspective |
| `OPENROUTER_API_KEY` | OpenRouter | Multi-model routing |
| `PERPLEXITY_API_KEY` | Perplexity | Deep company research |

### Web & Design

| Key | Service | Feature |
|-----|---------|---------|
| `FIRECRAWL_API_KEY` | Firecrawl | Advanced JD extraction |
| `LOGO_DEV_PUBLISHABLE_KEY` | Logo.Dev | Company logos in materials |
| `LOGO_DEV_SECRET_KEY` | Logo.Dev | Company logos in materials |
| `HUGGINGFACE_TOKEN` | Hugging Face | Open-source model access |

## Check Your Status

Run `/career-os connect` to see which services are connected and which are missing.
