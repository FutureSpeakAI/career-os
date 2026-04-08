/**
 * lib/parsers.mjs -- Pure parsing functions for Career-OS data formats.
 *
 * Extracted from dashboard-server.mjs so both the server and tests can
 * import the same code. All functions are pure (no I/O, no side effects).
 */

// ---------------------------------------------------------------------------
// Markdown Table Parser
// ---------------------------------------------------------------------------

/**
 * Parse a markdown table into structured data.
 * Returns { headers: string[], rows: object[] } where each row is keyed by header.
 */
export function parseMdTable(content) {
  const lines = content.split('\n');
  const result = { headers: [], rows: [] };

  let headerLine = -1;
  let separatorLine = -1;

  // Find the header row (first line starting with |) and separator (|---|)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && !trimmed.match(/^\|\s*-/)) {
      if (headerLine === -1) {
        headerLine = i;
      }
    }
    if (trimmed.startsWith('|') && trimmed.match(/^\|\s*-/)) {
      separatorLine = i;
      break;
    }
  }

  if (headerLine === -1 || separatorLine === -1) return result;

  // Parse headers
  result.headers = lines[headerLine]
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);

  // Parse data rows (everything after separator that starts with |)
  for (let i = separatorLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    // Skip rows that are all empty
    if (cells.every(c => c === '')) continue;

    const row = {};
    result.headers.forEach((header, idx) => {
      row[header] = cells[idx] || '';
    });
    result.rows.push(row);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Markdown Sections Parser
// ---------------------------------------------------------------------------

/**
 * Parse markdown content into sections by headings.
 * Returns array of { title: string, level: number, body: string }.
 */
export function parseMdSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = null;
  let bodyLines = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Save previous section
      if (current) {
        current.body = bodyLines.join('\n').trim();
        sections.push(current);
      }
      current = {
        title: headingMatch[2].trim(),
        level: headingMatch[1].length,
        body: '',
      };
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  // Save last section
  if (current) {
    current.body = bodyLines.join('\n').trim();
    sections.push(current);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Simple YAML Parser
// ---------------------------------------------------------------------------

/**
 * Parse simple flat YAML (key: "value" or key: value).
 * Handles nested keys one level deep (parent.child).
 * Returns a flat object.
 */
export function parseSimpleYaml(content) {
  const result = {};
  let currentParent = '';
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Top-level key (no indent or section header)
    const kvMatch = line.match(/^(\s*)(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const [, spaces, key, rawValue] = kvMatch;
    const indentLevel = spaces.length;

    // Clean the value: strip quotes, handle arrays/booleans
    let value = rawValue.trim();

    if (indentLevel === 0) {
      // Top-level key
      if (value === '' || value === '|' || value === '>') {
        // This is a section header
        currentParent = key;
        continue;
      }
      value = value.replace(/^["']|["']$/g, '');
      result[key] = value;
    } else {
      // Nested key
      value = value.replace(/^["']|["']$/g, '');
      const fullKey = currentParent ? `${currentParent}.${key}` : key;
      result[fullKey] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// YAML List Parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML list items under a key.
 * Returns array of strings.
 */
export function parseYamlList(content, sectionKey) {
  const lines = content.split('\n');
  const items = [];
  let inSection = false;
  let sectionIndent = -1;

  for (const line of lines) {
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Check if we're entering the target section (escape sectionKey for safe regex)
    const escapedKey = sectionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionMatch = line.match(new RegExp(`^(\\s*)${escapedKey}\\s*:`));
    if (sectionMatch) {
      inSection = true;
      sectionIndent = sectionMatch[1].length;
      continue;
    }

    if (inSection) {
      const lineIndent = line.match(/^(\s*)/)[1].length;
      // If we hit a line at same or lower indent that's a new key, exit
      if (lineIndent <= sectionIndent && line.match(/^\s*\w[\w_]*\s*:/)) {
        inSection = false;
        continue;
      }

      // Parse list item
      const listMatch = line.match(/^\s*-\s+(.+)/);
      if (listMatch) {
        let val = listMatch[1].trim().replace(/^["']|["']$/g, '');
        items.push(val);
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Pipeline Parser
// ---------------------------------------------------------------------------

/**
 * Parse the pipeline.md file into structured offer objects.
 * Pipeline format varies -- may be a table or a list of URLs with context.
 */
export function parsePipeline(content) {
  if (!content.trim()) return [];
  const entries = [];
  for (const line of content.split('\n')) {
    // Format: - [ ] URL | Company | Title  OR  - [x] URL | Company | Title
    const m = line.match(/^- \[[ x]\]\s+(\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/);
    if (m) {
      const title = m[3].trim();
      const tier = classifyTier(title);
      entries.push({ url: m[1], company: m[2].trim(), title, tier, done: line.includes('[x]') });
    }
  }
  // Fallback to table format if no list entries found
  if (entries.length === 0) {
    const table = parseMdTable(content);
    return table.rows;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Tracker (applications.md) Parser
// ---------------------------------------------------------------------------

/**
 * Parse the tracker (applications.md) into row objects.
 * Columns: #, Date, Company, Role, Score, Status, PDF, Report, Notes
 */
export function parseTracker(content) {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const rows = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    // Skip header and separator
    if (line.includes('---') || line.match(/\|\s*#\s*\|/)) continue;

    const cells = line.split('|').map(s => s.trim());
    // Filter empty leading/trailing cells from pipe split
    const parts = cells.filter(Boolean);
    if (parts.length < 8) continue;

    const num = parseInt(parts[0]);
    if (isNaN(num)) continue;

    rows.push({
      num,
      date: parts[1] || '',
      company: parts[2] || '',
      role: parts[3] || '',
      score: parts[4] || '',
      status: parts[5] || '',
      pdf: parts[6] || '',
      report: parts[7] || '',
      notes: parts[8] || '',
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Scan History Parser
// ---------------------------------------------------------------------------

/**
 * Parse scan-history.tsv into structured data.
 */
export function parseScanHistory(content) {
  if (!content.trim()) return [];

  const lines = content.split('\n').filter(l => l.trim());
  const rows = [];

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    rows.push({
      date: parts[0] || '',
      url: parts[1] || '',
      company: parts[2] || '',
      role: parts[3] || '',
      status: parts[4] || '',
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Analytics Computation
// ---------------------------------------------------------------------------

/**
 * Compute analytics from tracker data.
 */
export function computeAnalytics(trackerRows) {
  const statusCounts = {};
  const scores = [];
  const weeklyMap = {};

  for (const row of trackerRows) {
    // Status counts
    const status = row.status.replace(/\*\*/g, '').trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // Score distribution
    const scoreMatch = row.score.replace(/\*\*/g, '').match(/([\d.]+)\/5/);
    if (scoreMatch) {
      scores.push(parseFloat(scoreMatch[1]));
    }

    // Weekly velocity
    if (row.date && row.date.match(/\d{4}-\d{2}-\d{2}/)) {
      const d = new Date(row.date);
      // Get ISO week start (Monday)
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff));
      const weekKey = weekStart.toISOString().substring(0, 10);

      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = { evaluated: 0, applied: 0, total: 0 };
      }
      weeklyMap[weekKey].total++;
      if (/evaluad|evaluated/i.test(status)) weeklyMap[weekKey].evaluated++;
      if (/aplicad|applied/i.test(status)) weeklyMap[weekKey].applied++;
    }
  }

  // Score distribution buckets
  const scoreDistribution = {
    '4.5+': scores.filter(s => s >= 4.5).length,
    '4.0-4.4': scores.filter(s => s >= 4.0 && s < 4.5).length,
    '3.5-3.9': scores.filter(s => s >= 3.5 && s < 4.0).length,
    '3.0-3.4': scores.filter(s => s >= 3.0 && s < 3.5).length,
    'below 3.0': scores.filter(s => s < 3.0).length,
  };

  const avgScore = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
    : null;

  // Weekly velocity sorted by date
  const velocity = Object.entries(weeklyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({ week, ...data }));

  return {
    total: trackerRows.length,
    statusCounts,
    scoreDistribution,
    avgScore,
    velocity,
  };
}

// ---------------------------------------------------------------------------
// Tier Classification
// ---------------------------------------------------------------------------

/**
 * Classify a role title into a tier: 'c-suite', 'director', or 'other'.
 */
export function classifyTier(role) {
  const r = (role || '').toLowerCase();
  if (/\b(vp|vice president|c-suite|chief|cto|cio|coo|ceo|caio|cmo|svp|evp|president)\b/.test(r)) return 'c-suite';
  if (/\b(director|head of|principal)\b/.test(r)) return 'director';
  return 'other';
}

// ---------------------------------------------------------------------------
// Memory Deduplication
// ---------------------------------------------------------------------------

/**
 * Check if a new memory entry is a duplicate of an existing one.
 * Uses normalized lowercase comparison with a similarity threshold:
 * - Exact match after normalization (trimming, lowercasing, collapsing whitespace)
 * - One string fully contains the other
 * Returns true if the new entry is a duplicate.
 */
export function isMemoryDuplicate(existingEntries, newEntry) {
  if (!newEntry || !existingEntries?.length) return false;
  const normalize = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const normalNew = normalize(newEntry);
  if (!normalNew) return false;
  for (const existing of existingEntries) {
    const normalExisting = normalize(existing);
    if (!normalExisting) continue;
    // Exact match
    if (normalNew === normalExisting) return true;
    // One contains the other (e.g., "20 years journalism" vs "20 years of journalism experience")
    if (normalNew.includes(normalExisting) || normalExisting.includes(normalNew)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Environment Status
// ---------------------------------------------------------------------------

/**
 * Return boolean status for each known .env key. NEVER returns actual values.
 */
export function parseEnvStatus() {
  const keys = [
    'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'PERPLEXITY_API_KEY',
    'FIRECRAWL_API_KEY',
    'LOGO_DEV_PUBLISHABLE_KEY',
    'LOGO_DEV_SECRET_KEY',
    'HUGGINGFACE_TOKEN',
  ];

  const status = {};
  for (const key of keys) {
    status[key] = !!(process.env[key] && process.env[key].trim().length > 0);
  }
  return status;
}
