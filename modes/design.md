# Mode: design -- Visual Materials via Canva & Figma

Create professional visual materials for your job search using Canva and Figma MCP integrations.

## What You Can Create

### 1. Cover Letter (Canva)

Generate a visually designed cover letter that matches your CV template:
- Use `generate-design` with structured content from the evaluation report
- Map JD requirements to proof points
- Export as PDF via `export-design`

### 2. Portfolio Deck (Canva)

Create a presentation-ready portfolio:
- Project showcase slides with metrics
- Architecture diagrams
- Case study summaries
- Export as PDF or shareable link

### 3. One-Pager / Leave-Behind (Canva)

Single-page summary for interviews:
- Key metrics and proof points
- Visual project timeline
- Skills matrix
- Contact info and portfolio links

### 4. Architecture Diagrams (Figma)

For technical roles, create system architecture diagrams:
- Use `generate_diagram` for FigJam boards
- Create from evaluation report's technical context
- Export as PNG/SVG for inclusion in applications

### 5. Company Logo Fetching (Logo.Dev)

When generating materials, fetch company logos:
- Requires `LOGO_DEV_KEY` in `.env`
- Use for personalized cover letters and presentations
- Professional touch that shows attention to detail

## Workflow

1. **Context**: Read the evaluation report and CV
2. **Generate**: Create the visual via Canva or Figma
3. **Review**: Show the user a preview
4. **Export**: Download as PDF/PNG
5. **Store**: Save to `output/` and optionally upload to Box

## Usage

```
/career-os design cover [company]      -- Cover letter for specific role
/career-os design portfolio            -- Portfolio presentation
/career-os design onepager [company]   -- Interview leave-behind
/career-os design diagram [project]    -- Architecture diagram
```

## Integration Points

| MCP Tool | Usage |
|----------|-------|
| `mcp__claude_ai_Canva__generate-design` | Create designs from prompts |
| `mcp__claude_ai_Canva__export-design` | Export to PDF/PNG |
| `mcp__claude_ai_Canva__get-design` | Retrieve existing designs |
| `mcp__claude_ai_Canva__search-designs` | Find previous work |
| `mcp__claude_ai_Figma__generate_diagram` | Create diagrams |
| `mcp__claude_ai_Figma__get_screenshot` | Preview designs |
| `mcp__claude_ai_Box__upload_file` | Store in cloud |
