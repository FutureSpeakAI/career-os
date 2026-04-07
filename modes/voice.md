# Mode: voice -- AI Voice Agent for Interview Prep & Roleplay

Uses Gemini 2.5 Flash with Live API or ElevenLabs for voice-based interview preparation, roleplay, and career coaching conversations.

## Capabilities

### 1. Interview Roleplay

Simulate real interviews with voice interaction:

1. **Load context**: Read the company's evaluation report from `reports/`
2. **Set the scene**: Brief the user on the interview format (behavioral, technical, case study)
3. **Launch voice session**: Connect via Gemini Live API for real-time voice conversation
4. **Play the interviewer**: Ask questions based on the JD, probe for depth, give realistic follow-ups
5. **Debrief**: After the session, provide feedback on answers, suggest improvements, identify gaps

### 2. Career Coaching Conversations

Open-ended voice sessions for:
- Discussing role evaluations and which offers to pursue
- Talking through negotiation strategies before a call
- Debriefing after an interview ("how did it go?")
- Working through career narrative and positioning
- Stress-testing STAR stories out loud

### 3. Pre-Interview Warmup

Quick 10-minute session before an interview:
1. Read the company prep kit from `interview-prep/`
2. Run through the top 3 likely questions
3. Practice the "tell me about yourself" opener
4. Review compensation talking points
5. Confidence boost and final tips

## Voice Agent Setup

### Option A: Gemini Live API (recommended for roleplay)

Requires `GEMINI_API_KEY` in `.env`. Uses Gemini's multimodal live API for real-time voice conversation.

```bash
# Launch voice session via Gemini Live
# The agent constructs the system prompt from report + JD context
# and initiates a live audio session
```

**System prompt construction for roleplay:**
1. Read `config/profile.yml` for candidate context
2. Read the relevant `reports/{num}-{company}.md` for JD and evaluation
3. Read `interview-prep/story-bank.md` for available STAR stories
4. Construct interviewer persona: role title, company culture, technical depth level

### Option B: ElevenLabs (for TTS narration)

Requires `ELEVENLABS_API_KEY` in `.env`. Best for:
- Reading back evaluation summaries
- Narrating interview prep briefs
- Audio versions of coaching feedback

### Option C: Text-only fallback

If no voice API keys are configured, fall back to text-based roleplay:
- Claude plays the interviewer in text
- User types responses
- Same debrief and feedback workflow

## Roleplay Scenarios

Load from `roleplay/scenarios/` or generate dynamically:

| Scenario | Duration | Focus |
|----------|----------|-------|
| Behavioral round | 30 min | STAR stories, leadership, conflict |
| Technical deep-dive | 45 min | Architecture, system design, trade-offs |
| Hiring manager screen | 20 min | Motivation, fit, comp expectations |
| Executive presentation | 15 min | Strategy pitch, vision, metrics |
| Culture fit | 20 min | Values, work style, team dynamics |
| Recruiter screen | 15 min | Background, expectations, logistics |

## Feedback Framework

After each roleplay session, evaluate on:

| Dimension | What to assess |
|-----------|----------------|
| **Clarity** | Were answers concise and structured? |
| **Evidence** | Did they cite specific metrics and examples? |
| **Relevance** | Did answers map to the JD requirements? |
| **Confidence** | Tone, pacing, filler words, hedging? |
| **Depth** | Did they go beyond surface-level? |
| **Questions asked** | Did they ask insightful questions back? |

## Usage

```
/career-os voice                    -- Start a coaching conversation
/career-os voice [company]          -- Roleplay interview for specific company
/career-os voice warmup [company]   -- 10-min pre-interview warmup
/career-os voice debrief            -- Post-interview debrief
```

## API Key Management

Voice features require API keys in `.env`:

```
GEMINI_API_KEY=your_key_here        # For Gemini Live voice
ELEVENLABS_API_KEY=your_key_here    # For ElevenLabs TTS (optional)
```

If neither key is present, voice mode falls back to text-based roleplay.
