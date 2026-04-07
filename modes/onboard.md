# Mode: onboard -- First-Run Setup + Profile Interview

This mode handles the entire Career-OS setup from scratch. The user can start from an empty directory, type `/career-os setup` in Claude Code, and everything happens automatically: clone, install, configure, interview.

## Interview Philosophy

Don't make the user fill out forms. Have a conversation. Extract everything you need from natural dialogue, then confirm before writing files. The goal is to learn enough to:
1. Build a complete `config/profile.yml`
2. Customize `modes/_shared.md` archetypes
3. Set up `portals.yml` with relevant companies
4. Create a starter `cv.md` (or validate their pasted CV)
5. Optionally create `article-digest.md` with proof points

## Step 0 -- Bootstrap (fully automatic, no user interaction needed)

Run all of these steps silently via Bash before starting the interview. The user should see a brief status message but should NOT need to do anything until the interview begins.

### 0a. Clone the repo (if needed)

Check if Career-OS files exist in the current directory. If `CLAUDE.md` does not exist and `modes/` does not exist:

```bash
git clone https://github.com/FutureSpeakAI/career-os.git .
```

If the directory is not empty and not a Career-OS repo, warn the user and ask if they want to proceed.

### 0b. Install Node.js dependencies

```bash
npm install --no-audit --no-fund
```

### 0c. Install Playwright Chromium (for PDF generation)

```bash
npx playwright install chromium
```

### 0d. Scaffold config files and directories

Run the setup script which handles template copying and directory creation:

```bash
node setup.mjs
```

If `setup.mjs` fails, handle manually:
1. Copy `config/profile.example.yml` to `config/profile.yml`
2. Copy `templates/portals.example.yml` to `portals.yml`
3. Create `data/`, `reports/`, `output/`, `jds/`, `batch/tracker-additions/`, `batch/logs/` directories
4. Create empty `interview-prep/story-bank.md`

### Status message

Tell the user once bootstrap is complete:
> "Career-OS is installed and ready. Let's set up your profile -- I'm going to ask you a few questions to build your career search system. This takes about 5 minutes."

Then proceed directly to the interview. No further action needed from the user until Section 1.

Once dependencies are installed, proceed to the interview.

## Interview Flow (7 Sections)

### Section 1 -- Identity & Contact

Ask conversationally:
> "Let's get you set up. First, the basics -- what's your full name, email, and location? And if you have a LinkedIn or portfolio URL, share those too."

Extract:
- full_name, email, phone (optional), location
- linkedin, portfolio_url, github, twitter (all optional)

### Section 2 -- Career Narrative

Ask:
> "Tell me your story. What have you been doing, and what are you looking for next? Don't worry about structure -- just talk and I'll organize it."

Listen for and extract:
- Current/most recent role and company
- Years of experience
- Career arc (transitions, pivots, progressions)
- Exit story (why they're looking)
- What excites them about their next move

### Section 3 -- Target Roles

Ask:
> "What roles are you targeting? Give me your dream titles -- the ones that make you think 'yes, that's exactly what I want.' Also tell me what you'd consider but aren't as excited about."

Extract:
- Primary target roles (3-5)
- Secondary/adjacent roles
- Build archetype table from these
- Seniority level expectations

### Section 4 -- Superpowers & Proof Points

Ask:
> "What are you genuinely better at than most people in your field? And what's the evidence -- specific projects, metrics, outcomes that prove it?"

Extract:
- Top 3-5 superpowers
- Proof points with metrics (project name, URL if public, hero metric)
- Any live demos, dashboards, or public work
- Publications, talks, open source contributions

### Section 5 -- Compensation

Ask:
> "What's your target compensation range? And what's your walk-away number -- the minimum where you'd still take the right role?"

Extract:
- target_range
- minimum (walk-away)
- currency
- Feelings about equity vs. base vs. total comp
- Current comp (if they want to share -- don't push)
- Location flexibility and remote preferences

### Section 6 -- Application Defaults

Ask:
> "A few things that come up on every application form -- I'll ask once and remember forever:
> - Are you authorized to work in [their country]? Need sponsorship?
> - Are you open to relocation?
> - Any demographic info you want pre-filled? (These are always optional and self-reported)"

Extract:
- Work authorization / visa status
- Relocation willingness
- Gender, ethnicity, disability, veteran status (all optional -- for auto-filling EEO forms)
- Pronouns (optional)

### Section 7 -- Research & Enrichment

After the interview, use WebSearch to research the candidate:
1. Search their name + company to find public profiles
2. Search their LinkedIn URL (if provided) to extract additional context
3. Search for any publications, talks, or press mentions
4. Search their GitHub (if provided) for notable projects

Use findings to:
- Suggest additions to proof_points
- Validate or enhance their narrative
- Identify angles they might not have mentioned
- Flag any public information that might come up in interviews

### Summary & Confirmation

Present the complete profile back to the user in a structured format:

```
Here's what I've put together for you:

PROFILE
- Name: [name]
- Location: [location]
- Targeting: [roles]
- Comp range: [range]

NARRATIVE
[Their story in 2-3 sentences]

SUPERPOWERS
1. [Superpower] -- [Evidence]
2. [Superpower] -- [Evidence]
3. [Superpower] -- [Evidence]

ARCHETYPES (how I'll evaluate offers for you)
| [Role 1] | [skills] | [what they buy] |
| [Role 2] | [skills] | [what they buy] |
| [Role 3] | [skills] | [what they buy] |

RESEARCH FINDINGS
- [Anything discovered from web research]

Does this look right? I'll set everything up once you confirm.
```

## Post-Interview Setup

Once confirmed, execute these steps:

1. **Write `config/profile.yml`** with all extracted data
2. **Update `modes/_shared.md`** with customized archetypes, framing, and cross-cutting advantage
3. **Copy `templates/portals.example.yml` to `portals.yml`** and update title_filter.positive with their target role keywords
4. **If they pasted a CV:** Create `cv.md` from their content
5. **If they didn't paste a CV:** Prompt them:
   > "Last step: I need your resume. You can:
   > 1. Paste it here (any format, I'll convert to markdown)
   > 2. Paste your LinkedIn URL and I'll build a CV from it
   > 3. Upload a PDF and I'll extract the content
   >
   > This becomes the source of truth for all your applications."
6. **Create `article-digest.md`** if they have proof points with URLs
7. **Create `data/applications.md`** with empty tracker
8. **Run `node cv-sync-check.mjs`** to validate everything

## Final Message

> "You're all set! Here's what's ready:
>
> - Your profile is configured for [target roles]
> - [N] companies are being tracked in your portal scanner
> - Your CV is loaded and ready for personalization
>
> To get started:
> - **Paste a job URL** to run the full evaluation pipeline
> - **Run `/career-os scan`** to discover matching roles
> - **Run `/career-os`** to see all commands
>
> Everything is customizable -- just ask me to change anything.
> I'll always read your CV fresh before each evaluation, so keep it updated."
