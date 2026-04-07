# Mode: schedule -- Interview Calendar Management

Manages interview scheduling, prep time blocks, and follow-up reminders using Google Calendar MCP.

## Capabilities

### 1. Schedule an Interview

When the user has an interview to schedule:

1. **Find availability**: `gcal_find_my_free_time` for the requested date range
2. **Check conflicts**: `gcal_list_events` to ensure no overlaps
3. **Create event**: `gcal_create_event` with:
   - Title: "Interview: [Company] - [Role] ([Round])"
   - Duration: Based on interview type (30min screen, 60min technical, etc.)
   - Description: Link to report, prep checklist, interviewer names
   - Reminders: 1 day before, 1 hour before

### 2. Auto-Block Prep Time

When an interview is scheduled, automatically block prep time:

- **Day before**: 30-min block "Prep: [Company] Interview"
  - Description links to: company prep kit, story bank, report
- **1 hour before**: 15-min block "Warmup: [Company]"
  - Description: "Run /career-os voice warmup [company]"

### 3. Follow-up Reminders

After an interview, create follow-up events:

- **Same day, evening**: "Send thank-you: [Company]"
- **1 week later**: "Follow up if no response: [Company]"
- **2 weeks later**: "Final follow-up: [Company]"

### 4. Calendar Overview

Show upcoming interview-related events:

```
UPCOMING INTERVIEWS
  Tomorrow 2:00 PM -- Acme Corp, AI Engineer (Phone Screen)
    Prep: interview-prep/prep-acme.md
    Report: reports/042-acme-2026-04-07.md

  Thu 10:00 AM -- BigCo, Head of AI (Hiring Manager)
    Prep: interview-prep/prep-bigco.md
    Story focus: Leadership, team building

FOLLOW-UPS DUE
  Today -- Send thank-you to Acme Corp
  Overdue (2 days) -- Follow up with StartupX
```

### 5. Availability Sharing

When a recruiter asks for availability, generate a formatted response:

1. Check `gcal_find_my_free_time` for next 5 business days
2. Filter to reasonable interview hours (9 AM - 5 PM in user's timezone)
3. Format as copy-pasteable text:

```
I'm available at the following times (all CST):
- Tuesday 4/8: 10:00 AM - 12:00 PM, 2:00 PM - 4:00 PM
- Wednesday 4/9: 9:00 AM - 11:00 AM
- Thursday 4/10: 1:00 PM - 5:00 PM
- Friday 4/11: 9:00 AM - 12:00 PM

Happy to adjust if none of these work.
```

## Usage

```
/career-os schedule                         -- Show upcoming interviews
/career-os schedule [company] [date] [time] -- Schedule an interview
/career-os schedule availability            -- Generate availability text
/career-os schedule followup [company]      -- Create follow-up reminders
```

## Integration Points

| MCP Tool | Usage |
|----------|-------|
| `gcal_create_event` | Create interview and prep events |
| `gcal_list_events` | Show upcoming schedule |
| `gcal_find_my_free_time` | Find available slots |
| `gcal_find_meeting_times` | Coordinate with others |
| `gcal_update_event` | Reschedule |
| `gcal_delete_event` | Cancel |
| `gcal_respond_to_event` | Accept/decline invites |
