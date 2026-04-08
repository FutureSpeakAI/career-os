# Contributing to Career-OS

Thanks for your interest in contributing! Career-OS is built with Claude Code, and you can use Claude Code for development too.

## Before Submitting a PR

**Please open an issue first to discuss the change you'd like to make.** This helps us align on direction before you invest time coding.

### What makes a good PR
- Fixes a bug listed in Issues
- Addresses a feature request that was discussed and approved
- Includes a clear description of what changed and why
- Follows the existing code style (simple, minimal, quality over quantity)
- Passes `npm test` and `npm run verify`

## Quick Start

1. Open an issue to discuss your idea
2. Fork the repo
3. Create a branch (`git checkout -b feature/my-feature`)
4. Run `npm run setup` to get everything installed
5. Make your changes
6. Run `npm test` to verify nothing broke
7. Commit and push
8. Open a Pull Request referencing the issue

## What to Contribute

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `examples/`)
- Report bugs via [Issues](https://github.com/FutureSpeakAI/career-os/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard TUI features (in `dashboard/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)
- Test coverage improvements

## Guidelines

- Scripts should handle missing files gracefully (`existsSync` before `readFileSync`)
- Dashboard changes require `go build` -- test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)
- Keep modes language-agnostic when possible
- Add tests for new utility scripts

## Development

```bash
npm run setup          # Install everything
npm test               # Run full test suite (184 tests)
npm run test:unit      # Unit tests only (fast, no server spawn)
npm run test:integration  # Integration tests (spawns server)
npm run test:scripts   # Script tests (merge, normalize, verify)
npm run verify         # Pipeline health check
npm run sync-check     # Config validation
```

## Attribution

Career-OS is built on [career-ops](https://github.com/santifer/career-ops) by Santiago Fernandez de Valderrama. When contributing, please respect the original project's MIT license and attribution.

## Need Help?

- [Open an issue](https://github.com/FutureSpeakAI/career-os/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
