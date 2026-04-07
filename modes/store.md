# Mode: store -- Cloud Document Management via Box

Organize and manage application documents in Box cloud storage.

## Folder Structure

Career-OS creates and manages this folder hierarchy in Box:

```
Career-OS/
  Applications/
    [Company Name]/
      cv-[company]-[date].pdf
      cover-[company]-[date].pdf
      report-[company]-[date].md
  Portfolio/
    [project-name]/
  Templates/
  Interview Prep/
```

## Capabilities

### 1. Upload Application Package

After generating PDFs, upload the complete package:
- CV PDF
- Cover letter PDF
- Evaluation report
- Any supplementary materials

### 2. Organize by Company

Create company-specific folders for active applications:
- All documents related to one application in one place
- Easy to share specific folders with recruiters if needed

### 3. Portfolio Sharing

Upload portfolio materials for sharing:
- Generate shareable links for specific files
- Track who accesses shared files

### 4. Search & Retrieve

Find previously uploaded documents:
- Search by company name, role, or date
- Retrieve for re-use or reference

## Usage

```
/career-os store upload [company]    -- Upload latest application package
/career-os store list                -- List all stored documents
/career-os store share [file]        -- Generate shareable link
/career-os store organize            -- Clean up and reorganize
```

## Integration Points

| MCP Tool | Usage |
|----------|-------|
| `mcp__claude_ai_Box__create_folder` | Create company folders |
| `mcp__claude_ai_Box__upload_file` | Upload documents |
| `mcp__claude_ai_Box__search_files_keyword` | Find documents |
| `mcp__claude_ai_Box__get_file_content` | Read stored files |
| `mcp__claude_ai_Box__list_folder_content_by_folder_id` | Browse folders |
