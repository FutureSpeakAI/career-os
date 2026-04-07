# Mode: inbox -- Employer Communication Monitor

Monitor email for employer-related communications and surface actionable items. Uses Gmail MCP for inbox access and Google Calendar MCP for scheduling.

## Capabilities

### 1. Inbox Scan

Search Gmail for employer-related emails using these query patterns:

```
gmail_search_messages with queries:
- "from:(*@greenhouse.io OR *@lever.co OR *@ashbyhq.com OR *@workday.com)" -- ATS notifications
- "subject:(interview OR application OR candidacy OR offer OR assessment)" -- Direct keywords
- "subject:(schedule OR calendar OR availability OR meeting)" -- Scheduling requests
- Companies from data/applications.md where status is Applied, Responded, or Interview
```

For each match found:
1. Read the full message via `gmail_read_message`
2. Read the thread via `gmail_read_thread` for context
3. Classify as: **Response**, **Interview Request**, **Rejection**, **Assessment**, **Offer**, **Follow-up Needed**, or **Informational**
4. Extract: sender, company, role, action required, deadline

### 2. Smart Triage

Present findings grouped by urgency:

```
INBOX SCAN -- [date]

URGENT (action needed today)
  [company] -- Interview scheduling request (reply by [deadline])
  [company] -- Assessment link expires [date]

THIS WEEK
  [company] -- Recruiter follow-up (responded to your application)
  [company] -- Request for additional information

INFORMATIONAL
  [company] -- Application confirmation received
  [company] -- Rejection notification

SUGGESTED ACTIONS
  1. Reply to [company] interview request -- draft below
  2. Update tracker: [company] status -> Responded
  3. Schedule prep for [company] interview on [date]
```

### 3. Auto-Draft Responses

For interview scheduling requests, draft a response via `gmail_create_draft`:
- Check calendar availability via `gcal_find_my_free_time`
- Suggest 2-3 time slots that work
- Professional tone, brief, enthusiastic
- Include timezone

For follow-up requests, draft using context from the matching report in `reports/`.

### 4. Tracker Sync

After scanning, offer to update `data/applications.md`:
- New responses -> status `Responded`
- Interview confirmations -> status `Interview`
- Rejections -> status `Rejected`
- Offers -> status `Offer`

## Workflow

1. **Scan**: Search Gmail for employer-related messages (last 7 days by default, configurable)
2. **Classify**: Categorize each message by type and urgency
3. **Cross-reference**: Match against tracker to identify which applications these relate to
4. **Triage**: Present grouped summary with recommended actions
5. **Act**: Draft responses, schedule meetings, update tracker -- all with user confirmation

## Usage

```
/career-os inbox              -- Scan last 7 days
/career-os inbox 30           -- Scan last 30 days
/career-os inbox [company]    -- Scan for specific company
```

## Integration Points

| MCP Tool | Usage |
|----------|-------|
| `gmail_search_messages` | Find employer emails |
| `gmail_read_message` | Read full message content |
| `gmail_read_thread` | Get conversation context |
| `gmail_create_draft` | Draft responses |
| `gmail_get_profile` | Verify connected account |
| `gcal_find_my_free_time` | Check availability for scheduling |
| `gcal_create_event` | Schedule interviews/prep sessions |
| `gcal_list_events` | Check for conflicts |
