# Meeting Prep Engine

**For:** [Your Name]
**System Version:** 1.0

The Meeting Prep Engine automates pre-meeting intelligence gathering and brief generation. When a meeting appears on your calendar, the system detects what kind of meeting it is, pulls relevant data from across the Career Advancement OS, and produces a focused prep brief so you walk in knowing more than anyone expects.

---

## How It Works

The engine follows a five-step pipeline:

1. **Calendar Scan:** Google Calendar MCP reads upcoming events (title, description, attendees, time, video link).
2. **Meeting Type Detection:** Keywords in the title, description, and attendee list are matched against detection rules (see below). If the event matches a company in the pipeline or CRM, the system pulls role-specific context automatically.
3. **Brief Generation:** The system selects the correct prep template, populates it with data from the story bank, negotiation playbook, company evaluations, pipeline tracker, and profile config.
4. **Delivery:** The completed brief is saved to `meetings/briefs/` and optionally drafted as a Gmail message to yourself via Gmail MCP.
5. **Calendar Prep Block:** Optionally, the system creates a 60-minute prep event on your calendar ending 30 minutes before the meeting, linked to the brief.

---

## Meeting Type Detection Rules

The system classifies meetings by scanning the event title, description, and attendee domains against these keyword sets. First match wins; ambiguous matches default to the highest-stakes template.

| Meeting Type | Title Keywords | Description Keywords | Attendee Signals | Template |
|-------------|---------------|---------------------|-----------------|----------|
| **Job Interview** | "interview", "technical", "panel", "case study", "hiring", "final round" | "interview process", "behavioral", "meet the team" | Recruiter or HR domain, company from pipeline | `interview-prep-brief.md` |
| **Recruiter Screen** | "screen", "intro call", "recruiter", "phone screen", "initial call" | "learn more about you", "fit", "quick chat" | Recruiter domain (@greenhouse, @lever, staffing firm) | `recruiter-screen-brief.md` |
| **Networking Call** | "network", "coffee chat", "informational", "catch up", "connect" | "pick your brain", "learn about", "advice" | Personal email, no company from pipeline | `networking-call-brief.md` |
| **Negotiation / Offer** | "offer", "compensation", "package", "negotiation", "terms" | "offer details", "total comp", "start date", "benefits" | HR domain, recruiter previously in thread | `negotiation-call-brief.md` |
| **Client Meeting** | "[Client Company]", "client", "engagement" | "deliverable", "status", "review", "project" | Client company domain | `client-meeting-brief.md` |
| **Conference / Speaking** | "panel", "keynote", "fireside", "conference", "summit", "webinar", "speaking" | "audience", "presentation", "talk", "moderator" | Event organizer domain | `conference-speaking-brief.md` |
| **Resignation** | "1:1" with direct manager + flagged manually | N/A | Your manager's email | `resignation-brief.md` |

### Pipeline Matching

When an attendee's email domain matches a company in `data/applications.md` or `data/pipeline.md`, the system automatically:
- Pulls the evaluation report from `reports/`
- Pulls the company prep kit from `interview-prep/` if one exists
- Identifies the role, score, and status from the tracker
- Flags any comp data from the evaluation

### Manual Override

If the system misclassifies a meeting, add a tag to the calendar event description:

```
[prep:interview]
[prep:negotiation]
[prep:networking]
[prep:client]
[prep:speaking]
[prep:resignation]
```

The tag overrides automatic detection.

---

## Integration Points

### Inputs (Data Sources)

| Source | What It Provides |
|--------|-----------------|
| **Google Calendar MCP** | Event details: title, description, attendees, time, video link |
| **Pipeline / Applications Tracker** | Company status, score, role, evaluation report link |
| **Story Bank** (`interview-prep/story-bank.md`) | STAR stories matched to role requirements |
| **Negotiation Playbook** (`comp-lab/negotiation-playbook.md`) | Scripts, anchoring strategy, counter tactics |
| **Company Prep Kits** (`interview-prep/`) | Company research, AI maturity, key people, culture signals |
| **Profile Config** (`config/profile.yml`) | Target roles, comp range, narrative, proof points |
| **Counter-Offer Prep** (`offers/counter-offer-prep.md`) | Resignation scripts, counter evaluation framework |
| **Decision Framework** (`offers/decision-framework.md`) | Filter stack, gut check questions, comparison shortcut |

### Outputs

| Output | Destination |
|--------|------------|
| **Prep Brief** | Saved to `meetings/briefs/{YYYY-MM-DD}-{company-slug}-{type}.md` |
| **Gmail Draft** | Drafted to self via Gmail MCP with brief contents |
| **Calendar Prep Event** | 60-minute block ending 30 minutes before the meeting |

---

## Activation

### Automatic (Scheduled)

Run a daily calendar scan at 7:00 AM local time:
- Scan today's and tomorrow's events
- Generate briefs for any meetings that match detection rules
- Flag meetings that need manual classification

### Manual (On-Demand)

Use these commands:

| Command | Action |
|---------|--------|
| `prep [meeting name]` | Generate a brief for a specific meeting |
| `prep tomorrow` | Generate briefs for all meetings tomorrow |
| `prep week` | Generate briefs for the full week ahead |
| `prep [company] [type]` | Generate a brief for a company with a specific template type |

---

## Brief Naming Convention

All briefs are saved to `meetings/briefs/` with this format:

```
{YYYY-MM-DD}-{company-slug}-{meeting-type}.md
```

Examples:
- `2026-04-10-acme-corp-interview.md`
- `2026-04-08-client-name-client.md`
- `2026-04-07-networking-jane-smith.md`

---

## Post-Meeting Follow-Up

After any meeting, the system can generate:
- **Thank-you email draft** (via Gmail MCP) personalized to the conversation
- **Debrief notes template** for capturing what you learned
- **Pipeline status update** if the meeting was interview-related
- **Next steps reminder** as a calendar event

To trigger: `debrief [meeting name]` after the meeting concludes.

---

*Meeting Prep Engine v1.0, Career Advancement OS*
