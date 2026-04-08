# Changelog

All notable changes to Career-OS are documented in this file.

## [2.0.0] - 2026-04-08

Major release: 6 cycles of systematic improvement via Asimov's Mind AI agent swarm.
184 tests passing. 43 API routes. 4 shared lib modules. Zero external test dependencies.

### Cycle 1: Foundation Hardening

- **CORS lockdown**: Restricted API to localhost origins only (configurable port allowlist)
- **Rate limiting**: In-memory sliding window with 3 tiers (10/min AI proxy, 30/min writes, 120/min reads)
- **Test suite**: Established 40 tests covering parsers, HTTP endpoints, security headers, input validation
- **Accessibility**: Keyboard navigation for modals (Escape to close, focus restoration)
- **Error boundary**: Global unhandled rejection handler with user-facing toast notifications

### Cycle 2: Performance and Security

- **Full async I/O**: Converted all `readFileSync` calls to async `fs/promises` (non-blocking)
- **Skeleton loaders**: Animated placeholder UI for all dashboard sections during data loading
- **Security headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, CSP
- **WebSocket hardening**: Connection rate limit (5/min per IP), 1MB message size cap, keep-alive pings
- **Lazy-load tabs**: Tab content only loads when first viewed, reducing initial page load

### Cycle 3: Data Integrity and UX

- **Memory deduplication**: `save_memory` and `/api/memory/extract` skip duplicate career facts and action items
- **Pipeline pagination**: `GET /api/pipeline?page=1&limit=50&tier=c-suite&q=google` with metadata
- **Tool error propagation**: Tool execution errors flagged with `is_error: true` for Claude API tool_result blocks
- **Toast stacking**: Max 5 visible toasts, dedup within 2s window, dismiss buttons
- **Data integrity endpoints**: `GET /api/pipeline/duplicates`, `GET /api/tracker/duplicates`, `POST /api/pipeline/add` with URL dedup

### Cycle 4: Architecture and Performance

- **Parser modularization**: Extracted pure parsing functions into `lib/parsers.mjs` (no I/O, fully testable)
- **Gzip compression**: `lib/compression.mjs` -- auto-compresses JSON responses >1KB via gzip/deflate
- **ETag caching**: `lib/cache-headers.mjs` -- file-backed ETags with 304 Not Modified for unchanged data
- **Code quality**: Removed code duplication between server and tests; all parsers imported from shared modules
- **Regex escaping**: Security fix for company name injection in tracker regex patterns

### Cycle 5: Intelligence and Workflows

- **Voice proof points**: `lib/intelligence.mjs` -- `extractProofPoints()` auto-extracts quantified CV achievements for voice agent context
- **Conversation summarization**: `summarizeConversationHistory()` compresses long chat histories (>20 messages) into compact context blocks
- **Smart scan filtering**: `parseTitleFilter()` and `matchesTitleFilter()` filter portal results by positive/negative keywords from portals.yml
- **Enhanced recommendations**: `/api/recommendations` returns priority-scored suggestions with urgency levels, stats, and weekly goals
- **Behavioral questions**: `/api/workflow/interview-prep` generates company-specific behavioral interview questions
- **Actionable errors**: All 4xx/5xx API responses include `hint` field with user-facing fix instructions
- **Workflow endpoints**: `full-pipeline`, `interview-prep`, `follow-up-batch` -- multi-step orchestrated actions

### Cycle 6: Meta-Improvement and Polish

- **Documentation sweep**: Updated CLAUDE.md, README.md, ARCHITECTURE.md, SETUP.md with accurate metrics (184 tests, 43 routes, 4 lib modules)
- **Gemini system prompt**: Improved voice agent instructions with structured tool guidance, anti-hallucination rules, and conversation flow directives
- **Claude chat prompt**: Enhanced tool descriptions with richer context for better tool selection accuracy
- **Package version**: Bumped to 2.0.0 with new test sub-commands (`test:unit`, `test:integration`, `test:scripts`)
- **CHANGELOG**: Created comprehensive changelog documenting all 6 improvement cycles
- **Security audit**: Final pass confirming no remaining vulnerabilities (path traversal, regex injection, secret exposure all mitigated)
- **Performance baseline**: 184 tests in ~3.1s, 43 endpoints, 8,933 lines across core files

### Architecture Summary (v2.0.0)

```
43 API routes (20 GET, 16 POST/PATCH/PUT, 3 workflow, 1 chat, 3 SPA/static)
4  lib modules (parsers, intelligence, compression, cache-headers)
7  test files (184 tests: 80 unit + 65 integration + 8 script + 31 edge cases)
12 dashboard tabs
13 voice/chat agent tools
23 CLI skill modes
```

## [1.0.0] - 2026-03-15

Initial public release of Career-OS.

- Web dashboard SPA with 12 interactive tabs
- Gemini Live voice agent with persistent memory
- Claude API content generation (resumes, cover letters, emails)
- 23 CLI skill modes via Claude Code
- Express + WebSocket server
- Pipeline tracking, offer evaluation, CV generation
- Portal scanning via Greenhouse APIs
- Batch processing system
- MCP connector support (Gmail, Calendar, Box, Canva, Figma)
