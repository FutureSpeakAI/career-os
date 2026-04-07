---
name: career-os
description: AI career advancement operating system -- evaluate offers, generate CVs, scan portals, track applications
user_invocable: true
args: mode
---

# career-os -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|-------|------|
| (empty / no args) | Check setup first, then `discovery` -- Show command menu |
| `setup` or `onboard` | `onboard` -- Install + interview |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` or `evaluate` | `oferta` |
| `ofertas` or `compare` | `ofertas` |
| `contacto` or `outreach` | `contacto` |
| `deep` | `deep` |
| `pdf` | `pdf` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `batch` | `batch` |
| `setup` or `onboard` | `onboard` |
| `inbox` | `inbox` |
| `voice` | `voice` |
| `connect` | `connect` |
| `schedule` | `schedule` |
| `design` | `design` |
| `store` | `store` |

**Auto-pipeline detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
Career-OS -- Command Center

Available commands:
  /career-os {JD}         AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /career-os pipeline     Process pending URLs from inbox (data/pipeline.md)
  /career-os evaluate     Evaluate a single offer (A-F blocks)
  /career-os compare      Compare and rank multiple offers
  /career-os outreach     LinkedIn power move: find contacts + draft message
  /career-os deep         Deep research prompt about company
  /career-os pdf          PDF only, ATS-optimized CV
  /career-os training     Evaluate course/cert against North Star
  /career-os project      Evaluate portfolio project idea
  /career-os tracker      Application status overview
  /career-os apply        Live application assistant (reads form + generates answers)
  /career-os scan         Scan portals and discover new offers
  /career-os batch        Batch processing with parallel workers

Connectivity:
  /career-os inbox        Monitor email for employer responses
  /career-os voice        Interview roleplay & coaching (Gemini Live)
  /career-os schedule     Manage interview calendar
  /career-os design       Create visual materials (Canva/Figma)
  /career-os store        Manage documents in cloud (Box)
  /career-os connect      Show connectivity status & setup

System:
  /career-os setup        Install dependencies + run profile interview
  /career-os onboard      Re-run the profile interview (update your setup)

Aliases: evaluate=oferta, compare=ofertas, outreach=contacto, setup=onboard

Inbox: add URLs to data/pipeline.md -> /career-os pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

**Note:** For aliased modes, load the original mode file:
- `evaluate` -> load `modes/oferta.md`
- `compare` -> load `modes/ofertas.md`
- `outreach` -> load `modes/contacto.md`

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `inbox`, `voice`, `connect`, `schedule`, `design`, `store`, `onboard`

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-os {mode}"
)
```

Execute the instructions from the loaded mode file.
