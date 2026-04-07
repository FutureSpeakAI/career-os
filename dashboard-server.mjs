#!/usr/bin/env node
/**
 * dashboard-server.mjs -- Career-OS Express + WebSocket Server
 *
 * Serves the SPA frontend, provides REST API endpoints for all Career-OS
 * data and operations, and proxies WebSocket connections to Gemini Live API
 * for real-time voice/chat career coaching.
 *
 * Usage:
 *   node dashboard-server.mjs          # Start on port 3333
 *   PORT=4000 node dashboard-server.mjs  # Custom port
 *
 * Environment (.env):
 *   GEMINI_API_KEY       -- Required for /ws/gemini voice proxy
 *   ANTHROPIC_API_KEY    -- Required for /api/generate content generation
 *   (All other keys are checked for presence only via /api/connectors)
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3333', 10);

// File paths relative to project root
const PATHS = {
  profile:       join(__dirname, 'config/profile.yml'),
  pipeline:      join(__dirname, 'data/pipeline.md'),
  tracker:       join(__dirname, 'data/applications.md'),
  scanHistory:   join(__dirname, 'data/scan-history.tsv'),
  contacts:      join(__dirname, 'crm/contacts.md'),
  followUps:     join(__dirname, 'crm/follow-up-queue.md'),
  storyBank:     join(__dirname, 'interview-prep/story-bank.md'),
  cv:            join(__dirname, 'cv.md'),
  articleDigest: join(__dirname, 'article-digest.md'),
  reportsDir:    join(__dirname, 'reports'),
  publicDir:     join(__dirname, 'public'),
  statesYml:     join(__dirname, 'templates/states.yml'),
  // Comp lab
  marketData:    join(__dirname, 'comp-lab/market-data.md'),
  negotiation:   join(__dirname, 'comp-lab/negotiation-playbook.md'),
  roleComp:      join(__dirname, 'comp-lab/role-comp-summary.md'),
  // Brand
  brandPos:      join(__dirname, 'brand/brand-positioning.md'),
  contentCal:    join(__dirname, 'brand/content-calendar.md'),
  engagement:    join(__dirname, 'brand/engagement-tracker.md'),
  // Analytics
  pipelineMetrics: join(__dirname, 'analytics/pipeline-metrics.md'),
};

// Gemini Live API endpoint
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Gemini system instruction for the career coach
const GEMINI_SYSTEM_INSTRUCTION = `You are Stephen C. Webster's AI career coach. You help with interview preparation, salary negotiation roleplay, application strategy, and career advancement. You speak in a direct, encouraging tone. You know Stephen's background: 20 years of journalism (Raw Story EIC, 50K to 5M readers), frontier AI model training (Google, Meta, Amazon), current Senior Director at Aquent Studios, targeting CAIO/VP of AI roles. His target comp is $200K+. When doing interview roleplay, you play the interviewer. When doing negotiation practice, you play the hiring manager. Always push Stephen to be specific with metrics and proof points.`;

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', OK: '\x1b[32m' };
  const reset = '\x1b[0m';
  console.log(`${prefix[level] || ''}[${ts}] [${level}]${reset} ${msg}`);
}

// ---------------------------------------------------------------------------
// File Reading Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file safely, returning empty string if it doesn't exist.
 */
function readSafe(filePath) {
  try {
    if (!existsSync(filePath)) return '';
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Parse a markdown table into structured data.
 * Returns { headers: string[], rows: object[] } where each row is keyed by header.
 */
function parseMdTable(content) {
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

/**
 * Parse markdown content into sections by headings.
 * Returns array of { title: string, level: number, body: string }.
 */
function parseMdSections(content) {
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

/**
 * Parse simple flat YAML (key: "value" or key: value).
 * Handles nested keys one level deep (parent.child).
 * Returns a flat object.
 */
function parseSimpleYaml(content) {
  const result = {};
  let currentParent = '';
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Check indentation level
    const indent = line.match(/^(\s*)/)[1].length;

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

/**
 * Parse YAML list items under a key.
 * Returns array of strings or objects.
 */
function parseYamlList(content, sectionKey) {
  const lines = content.split('\n');
  const items = [];
  let inSection = false;
  let sectionIndent = -1;

  for (const line of lines) {
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Check if we're entering the target section
    const sectionMatch = line.match(new RegExp(`^(\\s*)${sectionKey}\\s*:`));
    if (sectionMatch) {
      inSection = true;
      sectionIndent = sectionMatch[1].length;
      continue;
    }

    if (inSection) {
      const indent = line.match(/^(\s*)/)[1].length;
      // If we hit a line at same or lower indent that's a new key, exit
      if (indent <= sectionIndent && line.match(/^\s*\w[\w_]*\s*:/)) {
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

/**
 * Return boolean status for each known .env key. NEVER returns actual values.
 */
function parseEnvStatus() {
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

/**
 * Parse the pipeline.md file into structured offer objects.
 * Pipeline format varies -- may be a table or a list of URLs with context.
 */
function parsePipeline(content) {
  if (!content.trim()) return [];
  const entries = [];
  for (const line of content.split('\n')) {
    // Format: - [ ] URL | Company | Title  OR  - [x] URL | Company | Title
    const m = line.match(/^- \[[ x]\]\s+(\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/);
    if (m) {
      const title = m[3].trim();
      const tier = /\b(VP|Vice President|Chief|CAIO|CTO)\b/i.test(title) ? 'c-suite'
        : /\b(Director|Head)\b/i.test(title) ? 'director' : 'other';
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

/**
 * Parse the tracker (applications.md) into row objects.
 * Columns: #, Date, Company, Role, Score, Status, PDF, Report, Notes
 */
function parseTracker(content) {
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

/**
 * Parse scan-history.tsv into structured data.
 */
function parseScanHistory(content) {
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

/**
 * Compute analytics from tracker data.
 */
function computeAnalytics(trackerRows) {
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
// Dynamic System Instruction Builder
// ---------------------------------------------------------------------------

function buildSystemInstruction() {
  const base = GEMINI_SYSTEM_INSTRUCTION;

  // Load memories
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  let memories = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
  try { memories = JSON.parse(readFileSync(memoryPath, 'utf-8')); } catch {}

  // Load current pipeline/tracker stats
  const pipeline = readSafe(PATHS.pipeline);
  const tracker = readSafe(PATHS.tracker);
  const pipelineCount = (pipeline.match(/^- \[/gm) || []).length;
  const appCount = (tracker.match(/^\|\s*\d+/gm) || []).length;

  let instruction = base;

  // Add career facts from memory
  if (memories.careerFacts?.length) {
    instruction += '\n\nKNOWN CAREER FACTS (from previous conversations):\n';
    memories.careerFacts.forEach(f => { instruction += `- ${f.content} (${f.date})\n`; });
  }

  // Add preferences
  if (memories.preferences?.length) {
    instruction += '\n\nUSER PREFERENCES:\n';
    memories.preferences.forEach(p => { instruction += `- ${p.key}: ${p.value}\n`; });
  }

  // Add pending action items
  const pending = (memories.actionItems || []).filter(a => a.status === 'pending');
  if (pending.length) {
    instruction += '\n\nPENDING ACTION ITEMS (remind Stephen about these):\n';
    pending.forEach(a => { instruction += `- ${a.action} (${a.date})\n`; });
  }

  // Add current state
  instruction += `\n\nCURRENT STATE: ${pipelineCount} offers in pipeline, ${appCount} applications tracked.`;

  // Add last conversation summary
  if (memories.conversations?.length) {
    const last = memories.conversations[memories.conversations.length - 1];
    instruction += `\n\nLAST CONVERSATION (${last.date}): ${last.summary}`;
  }

  return instruction;
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();

// Middleware
app.use(express.json());

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    log('INFO', `${req.method} ${req.path}`);
  }
  next();
});

// Static files -- serve the SPA frontend
app.use(express.static(PATHS.publicDir));

// ---------------------------------------------------------------------------
// API Routes -- Data Reading
// ---------------------------------------------------------------------------

/**
 * GET /api/profile -- Returns parsed config/profile.yml
 */
app.get('/api/profile', (req, res) => {
  try {
    const content = readSafe(PATHS.profile);
    if (!content) {
      return res.json({ configured: false, message: 'Profile not configured. Run onboarding first.' });
    }

    const flat = parseSimpleYaml(content);

    // Also extract list fields
    const primaryRoles = parseYamlList(content, 'primary');
    const superpowers = parseYamlList(content, 'superpowers');

    res.json({
      configured: true,
      candidate: {
        full_name: flat['candidate.full_name'] || '',
        email: flat['candidate.email'] || '',
        phone: flat['candidate.phone'] || '',
        location: flat['candidate.location'] || '',
        linkedin: flat['candidate.linkedin'] || '',
        portfolio_url: flat['candidate.portfolio_url'] || '',
        github: flat['candidate.github'] || '',
        twitter: flat['candidate.twitter'] || '',
      },
      target_roles: {
        primary: primaryRoles,
      },
      narrative: {
        headline: flat['narrative.headline'] || '',
        exit_story: flat['narrative.exit_story'] || '',
        superpowers,
      },
      compensation: {
        target_range: flat['compensation.target_range'] || '',
        currency: flat['compensation.currency'] || '',
        minimum: flat['compensation.minimum'] || '',
        location_flexibility: flat['compensation.location_flexibility'] || '',
      },
      location: {
        country: flat['location.country'] || '',
        city: flat['location.city'] || '',
        timezone: flat['location.timezone'] || '',
        visa_status: flat['location.visa_status'] || '',
      },
    });
  } catch (err) {
    log('ERROR', `GET /api/profile: ${err.message}`);
    res.status(500).json({ error: 'Failed to read profile', detail: err.message });
  }
});

/**
 * GET /api/pipeline -- Returns parsed data/pipeline.md
 */
app.get('/api/pipeline', (req, res) => {
  try {
    const content = readSafe(PATHS.pipeline);
    const entries = parsePipeline(content);
    res.json({ count: entries.length, entries });
  } catch (err) {
    log('ERROR', `GET /api/pipeline: ${err.message}`);
    res.status(500).json({ error: 'Failed to read pipeline', detail: err.message });
  }
});

/**
 * GET /api/tracker -- Returns parsed data/applications.md
 */
app.get('/api/tracker', (req, res) => {
  try {
    const content = readSafe(PATHS.tracker);
    const rows = parseTracker(content);
    res.json({ count: rows.length, rows });
  } catch (err) {
    log('ERROR', `GET /api/tracker: ${err.message}`);
    res.status(500).json({ error: 'Failed to read tracker', detail: err.message });
  }
});

/**
 * GET /api/reports -- Returns list of report files
 */
app.get('/api/reports', (req, res) => {
  try {
    if (!existsSync(PATHS.reportsDir)) {
      return res.json({ count: 0, files: [] });
    }

    const files = readdirSync(PATHS.reportsDir)
      .filter(f => f.endsWith('.md') && f !== '.gitkeep')
      .sort()
      .reverse(); // Most recent first

    const reports = files.map(f => {
      // Parse filename: {###}-{company-slug}-{YYYY-MM-DD}.md
      const match = f.match(/^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/);
      return {
        file: f,
        num: match ? parseInt(match[1]) : null,
        slug: match ? match[2] : f,
        date: match ? match[3] : null,
      };
    });

    res.json({ count: reports.length, files: reports });
  } catch (err) {
    log('ERROR', `GET /api/reports: ${err.message}`);
    res.status(500).json({ error: 'Failed to list reports', detail: err.message });
  }
});

/**
 * GET /api/reports/:file -- Returns content of a specific report
 */
app.get('/api/reports/:file', (req, res) => {
  try {
    const filename = req.params.file;

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = join(PATHS.reportsDir, filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const content = readFileSync(filePath, 'utf-8');
    const sections = parseMdSections(content);

    res.json({ file: filename, content, sections });
  } catch (err) {
    log('ERROR', `GET /api/reports/:file: ${err.message}`);
    res.status(500).json({ error: 'Failed to read report', detail: err.message });
  }
});

/**
 * GET /api/scan-history -- Returns parsed data/scan-history.tsv
 */
app.get('/api/scan-history', (req, res) => {
  try {
    const content = readSafe(PATHS.scanHistory);
    const rows = parseScanHistory(content);
    res.json({ count: rows.length, rows });
  } catch (err) {
    log('ERROR', `GET /api/scan-history: ${err.message}`);
    res.status(500).json({ error: 'Failed to read scan history', detail: err.message });
  }
});

/**
 * GET /api/contacts -- Returns parsed crm/contacts.md
 */
app.get('/api/contacts', (req, res) => {
  try {
    const content = readSafe(PATHS.contacts);
    const table = parseMdTable(content);
    res.json({ count: table.rows.length, contacts: table.rows });
  } catch (err) {
    log('ERROR', `GET /api/contacts: ${err.message}`);
    res.status(500).json({ error: 'Failed to read contacts', detail: err.message });
  }
});

/**
 * GET /api/follow-ups -- Returns parsed crm/follow-up-queue.md
 */
app.get('/api/follow-ups', (req, res) => {
  try {
    const content = readSafe(PATHS.followUps);
    const table = parseMdTable(content);
    const sections = parseMdSections(content);
    res.json({ count: table.rows.length, followUps: table.rows, sections });
  } catch (err) {
    log('ERROR', `GET /api/follow-ups: ${err.message}`);
    res.status(500).json({ error: 'Failed to read follow-ups', detail: err.message });
  }
});

/**
 * GET /api/story-bank -- Returns parsed interview-prep/story-bank.md
 */
app.get('/api/story-bank', (req, res) => {
  try {
    const content = readSafe(PATHS.storyBank);
    if (!content) {
      return res.json({ configured: false, sections: [] });
    }
    const sections = parseMdSections(content);
    res.json({ configured: true, content, sections });
  } catch (err) {
    log('ERROR', `GET /api/story-bank: ${err.message}`);
    res.status(500).json({ error: 'Failed to read story bank', detail: err.message });
  }
});

/**
 * GET /api/connectors -- Returns boolean status of API keys and MCP services
 * NEVER returns actual key values.
 */
app.get('/api/connectors', (req, res) => {
  try {
    const keys = parseEnvStatus();

    const mcpServices = [
      { name: 'Gmail', description: 'Inbox monitoring, draft responses' },
      { name: 'Google Calendar', description: 'Interview scheduling' },
      { name: 'Box', description: 'Document storage' },
      { name: 'Canva', description: 'Visual design' },
      { name: 'Figma', description: 'Diagrams, design context' },
    ];

    res.json({ apiKeys: keys, mcpServices });
  } catch (err) {
    log('ERROR', `GET /api/connectors: ${err.message}`);
    res.status(500).json({ error: 'Failed to read connectors', detail: err.message });
  }
});

/**
 * GET /api/comp -- Returns parsed comp-lab files + profile comp data
 */
app.get('/api/comp', (req, res) => {
  try {
    const marketData = readSafe(PATHS.marketData);
    const negotiation = readSafe(PATHS.negotiation);
    const roleComp = readSafe(PATHS.roleComp);
    const profileContent = readSafe(PATHS.profile);

    const marketTable = parseMdTable(marketData);
    const roleCompTable = parseMdTable(roleComp);
    const profileFlat = parseSimpleYaml(profileContent);

    res.json({
      marketData: {
        content: marketData,
        benchmarks: marketTable.rows,
        sections: parseMdSections(marketData),
      },
      negotiation: {
        content: negotiation,
        sections: parseMdSections(negotiation),
      },
      roleComp: {
        content: roleComp,
        tables: roleCompTable.rows,
        sections: parseMdSections(roleComp),
      },
      profile: {
        target_range: profileFlat['compensation.target_range'] || '',
        minimum: profileFlat['compensation.minimum'] || '',
        currency: profileFlat['compensation.currency'] || 'USD',
      },
    });
  } catch (err) {
    log('ERROR', `GET /api/comp: ${err.message}`);
    res.status(500).json({ error: 'Failed to read comp data', detail: err.message });
  }
});

/**
 * GET /api/brand -- Returns parsed brand files
 */
app.get('/api/brand', (req, res) => {
  try {
    const brandPos = readSafe(PATHS.brandPos);
    const contentCal = readSafe(PATHS.contentCal);
    const engagement = readSafe(PATHS.engagement);

    res.json({
      positioning: {
        content: brandPos,
        sections: parseMdSections(brandPos),
      },
      contentCalendar: {
        content: contentCal,
        table: parseMdTable(contentCal),
        sections: parseMdSections(contentCal),
      },
      engagement: {
        content: engagement,
        table: parseMdTable(engagement),
        sections: parseMdSections(engagement),
      },
    });
  } catch (err) {
    log('ERROR', `GET /api/brand: ${err.message}`);
    res.status(500).json({ error: 'Failed to read brand data', detail: err.message });
  }
});

/**
 * GET /api/analytics -- Returns computed analytics from applications.md
 */
app.get('/api/analytics', (req, res) => {
  try {
    const content = readSafe(PATHS.tracker);
    const rows = parseTracker(content);
    const analytics = computeAnalytics(rows);
    res.json(analytics);
  } catch (err) {
    log('ERROR', `GET /api/analytics: ${err.message}`);
    res.status(500).json({ error: 'Failed to compute analytics', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes -- Actions
// ---------------------------------------------------------------------------

/**
 * POST /api/generate -- Generate content with AI (Anthropic Claude API)
 * Body: { type: "resume"|"cover-letter"|"email-draft"|"interview-prep", roleId: number, context: string }
 */
app.post('/api/generate', async (req, res) => {
  try {
    const { type, roleId, context } = req.body;

    if (!type || !['resume', 'cover-letter', 'email-draft', 'interview-prep'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type. Must be one of: resume, cover-letter, email-draft, interview-prep',
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.',
      });
    }

    // Gather context
    const cv = readSafe(PATHS.cv);
    const articleDigest = readSafe(PATHS.articleDigest);
    const profileContent = readSafe(PATHS.profile);
    const trackerContent = readSafe(PATHS.tracker);
    const trackerRows = parseTracker(trackerContent);

    // Find the specific role if roleId provided
    let roleData = null;
    if (roleId) {
      roleData = trackerRows.find(r => r.num === roleId);
    }

    // Build the prompt based on type
    let systemPrompt = '';
    let userPrompt = '';

    switch (type) {
      case 'resume':
        systemPrompt = `You are a professional resume writer specializing in executive and senior technology roles. Create a tailored resume in clean markdown format. Use the candidate's CV as the base and adapt it for the target role. Focus on relevant achievements with quantified metrics. Keep it concise -- 1-2 pages worth of content.`;
        userPrompt = `## Candidate CV:\n${cv}\n\n${articleDigest ? `## Proof Points:\n${articleDigest}\n\n` : ''}## Target Role:\n${roleData ? `Company: ${roleData.company}\nRole: ${roleData.role}\nScore: ${roleData.score}` : 'General application'}\n\n${context ? `## Additional Context:\n${context}` : ''}\n\nGenerate a tailored resume for this role.`;
        break;

      case 'cover-letter':
        systemPrompt = `You are a professional cover letter writer. Write a compelling, concise cover letter (max 400 words) that connects the candidate's experience to the role. Lead with value, not biography. Reference specific proof points and metrics. Do not be generic.`;
        userPrompt = `## Candidate CV:\n${cv}\n\n${articleDigest ? `## Proof Points:\n${articleDigest}\n\n` : ''}## Target Role:\n${roleData ? `Company: ${roleData.company}\nRole: ${roleData.role}` : 'Unknown role'}\n\n${context ? `## Job Description / Context:\n${context}` : ''}\n\nWrite a tailored cover letter.`;
        break;

      case 'email-draft':
        systemPrompt = `You are an expert at professional communication for job seekers. Write concise, warm, professional emails. No fluff, no desperation. Every sentence should serve a purpose.`;
        userPrompt = `## Candidate Profile:\n${profileContent ? profileContent.substring(0, 500) : 'Profile not available'}\n\n## Context:\n${context || 'Follow-up email'}\n\n${roleData ? `## Role: ${roleData.company} - ${roleData.role}` : ''}\n\nDraft the email.`;
        break;

      case 'interview-prep':
        systemPrompt = `You are an interview preparation coach specializing in executive and senior technology roles. Generate likely interview questions and strong STAR+R (Situation, Task, Action, Result + Reflection) stories from the candidate's background. Include both behavioral and technical questions.`;
        userPrompt = `## Candidate CV:\n${cv}\n\n${articleDigest ? `## Proof Points:\n${articleDigest}\n\n` : ''}## Target Role:\n${roleData ? `Company: ${roleData.company}\nRole: ${roleData.role}\nScore: ${roleData.score}` : 'General preparation'}\n\n${context ? `## Additional Context:\n${context}` : ''}\n\nGenerate interview preparation materials including:\n1. Top 10 likely questions for this role\n2. 3-5 STAR+R stories from the candidate's background that map to these questions\n3. Key talking points and metrics to weave in\n4. Questions the candidate should ask`;
        break;
    }

    log('INFO', `Generating ${type} content via Anthropic API${roleData ? ` for #${roleData.num} ${roleData.company}` : ''}`);

    // Call Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      log('ERROR', `Anthropic API error ${response.status}: ${errBody}`);
      return res.status(502).json({
        error: 'Anthropic API request failed',
        status: response.status,
        detail: errBody,
      });
    }

    const data = await response.json();
    const content_text = data.content?.[0]?.text || '';

    res.json({ content: content_text, type, roleId: roleId || null });
  } catch (err) {
    log('ERROR', `POST /api/generate: ${err.message}`);
    res.status(500).json({ error: 'Generation failed', detail: err.message });
  }
});

/**
 * POST /api/verify -- Verify if a job listing is still active
 * Body: { url: string }
 */
app.post('/api/verify', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Invalid URL. Must start with http:// or https://' });
    }

    log('INFO', `Verifying job listing: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return res.json({ status: 'error', title: '', message: 'Request timed out' });
      }
      return res.json({ status: 'not-found', title: '', message: fetchErr.message });
    }

    clearTimeout(timeout);

    if (response.status === 404) {
      return res.json({ status: 'not-found', title: '' });
    }

    if (response.status >= 400) {
      return res.json({ status: 'error', title: '', message: `HTTP ${response.status}` });
    }

    // Read a limited amount of the response body
    const html = await response.text();
    const lowerHtml = html.toLowerCase();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Heuristics for job listing status
    const closedIndicators = [
      'this job is no longer available',
      'this position has been filled',
      'this job has been closed',
      'this posting has expired',
      'no longer accepting applications',
      'job not found',
      'position closed',
      'expired listing',
      'this requisition is no longer active',
    ];

    const activeIndicators = [
      'apply now',
      'apply for this job',
      'submit application',
      'easy apply',
      'apply on company site',
      'submit your application',
    ];

    const isClosed = closedIndicators.some(indicator => lowerHtml.includes(indicator));
    const isActive = activeIndicators.some(indicator => lowerHtml.includes(indicator));

    let status;
    if (isClosed) {
      status = 'closed';
    } else if (isActive) {
      status = 'active';
    } else if (html.length < 1000) {
      // Very short page likely means redirect/error
      status = 'closed';
    } else {
      // Has content but no clear signals -- probably still active
      status = 'active';
    }

    res.json({ status, title });
  } catch (err) {
    log('ERROR', `POST /api/verify: ${err.message}`);
    res.status(500).json({ error: 'Verification failed', detail: err.message });
  }
});

/**
 * PATCH /api/tracker/:num -- Update an application's status/notes
 * Body: { status?: string, notes?: string }
 */
app.patch('/api/tracker/:num', (req, res) => {
  try {
    const num = parseInt(req.params.num);
    if (isNaN(num)) {
      return res.status(400).json({ error: 'Invalid entry number' });
    }

    const { status, notes } = req.body;
    if (!status && notes === undefined) {
      return res.status(400).json({ error: 'Provide at least one of: status, notes' });
    }

    // Validate status against canonical states if provided
    if (status) {
      const statesContent = readSafe(PATHS.statesYml);
      const validStates = [];
      const stateMatches = statesContent.matchAll(/label:\s*(.+)/g);
      for (const m of stateMatches) {
        validStates.push(m[1].trim());
      }

      const statusLower = status.toLowerCase();
      const isValid = validStates.some(s => s.toLowerCase() === statusLower);

      if (!isValid && validStates.length > 0) {
        return res.status(400).json({
          error: `Invalid status "${status}". Valid statuses: ${validStates.join(', ')}`,
        });
      }
    }

    const content = readSafe(PATHS.tracker);
    if (!content) {
      return res.status(404).json({ error: 'Tracker file not found' });
    }

    const lines = content.split('\n');
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) continue;

      const cells = line.split('|').map(s => s.trim());
      const parts = cells.filter(Boolean);
      if (parts.length < 8) continue;

      const rowNum = parseInt(parts[0]);
      if (rowNum !== num) continue;

      // Found the row -- update it
      found = true;

      // Reconstruct with updates
      // columns: #, Date, Company, Role, Score, Status, PDF, Report, Notes
      if (status) parts[5] = status;
      if (notes !== undefined) parts[8] = notes;

      // Rebuild the line with proper pipe formatting
      lines[i] = '| ' + parts.join(' | ') + ' |';

      log('INFO', `Updated tracker entry #${num}: ${status ? 'status=' + status : ''} ${notes !== undefined ? 'notes updated' : ''}`);
      break;
    }

    if (!found) {
      return res.status(404).json({ error: `Entry #${num} not found in tracker` });
    }

    writeFileSync(PATHS.tracker, lines.join('\n'));
    res.json({ success: true, num, status, notes });
  } catch (err) {
    log('ERROR', `PATCH /api/tracker/${req.params.num}: ${err.message}`);
    res.status(500).json({ error: 'Update failed', detail: err.message });
  }
});

/**
 * POST /api/verify-all -- Verify ALL pipeline offers (batch)
 */
app.post('/api/verify-all', async (req, res) => {
  try {
    const content = readSafe(PATHS.pipeline);
    const entries = parsePipeline(content);

    if (entries.length === 0) {
      return res.json({ count: 0, results: [], message: 'No pipeline entries to verify' });
    }

    log('INFO', `Batch verifying ${entries.length} pipeline entries`);

    const results = [];

    for (const entry of entries) {
      const url = entry.url || entry.URL || entry.Url || '';
      if (!url || !url.startsWith('http')) {
        results.push({
          url: url || '(no URL)',
          company: entry.company || entry.Company || '',
          title: entry.title || entry.Title || entry.Role || '',
          status: 'error',
          message: 'Invalid or missing URL',
        });
        continue;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
          signal: controller.signal,
        });

        clearTimeout(timeout);

        let status = 'active';
        let pageTitle = '';

        if (response.status === 404) {
          status = 'not-found';
        } else if (response.status >= 400) {
          status = 'error';
        } else {
          const html = await response.text();
          const lowerHtml = html.toLowerCase();

          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          pageTitle = titleMatch ? titleMatch[1].trim() : '';

          const closedIndicators = [
            'this job is no longer available',
            'this position has been filled',
            'this job has been closed',
            'this posting has expired',
            'no longer accepting applications',
            'position closed',
          ];

          if (closedIndicators.some(ind => lowerHtml.includes(ind))) {
            status = 'closed';
          }
        }

        results.push({
          url,
          company: entry.company || entry.Company || '',
          title: pageTitle || entry.title || entry.Title || entry.Role || '',
          status,
        });
      } catch (fetchErr) {
        results.push({
          url,
          company: entry.company || entry.Company || '',
          title: entry.title || entry.Title || entry.Role || '',
          status: fetchErr.name === 'AbortError' ? 'error' : 'not-found',
          message: fetchErr.message,
        });
      }

      // Small delay between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const summary = {
      active: results.filter(r => r.status === 'active').length,
      closed: results.filter(r => r.status === 'closed').length,
      notFound: results.filter(r => r.status === 'not-found').length,
      errors: results.filter(r => r.status === 'error').length,
    };

    log('INFO', `Batch verify complete: ${summary.active} active, ${summary.closed} closed, ${summary.notFound} not found, ${summary.errors} errors`);

    res.json({ count: results.length, summary, results });
  } catch (err) {
    log('ERROR', `POST /api/verify-all: ${err.message}`);
    res.status(500).json({ error: 'Batch verification failed', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes -- New Features
// ---------------------------------------------------------------------------

/**
 * POST /api/evaluate -- Evaluate a JD (URL or text) using Anthropic Claude
 * Body: { url?: string, text?: string }
 */
app.post('/api/evaluate', async (req, res) => {
  try {
    const { url, text } = req.body;
    if (!url && !text) {
      return res.status(400).json({ error: 'Provide either url or text' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.' });
    }

    let jdText = text || '';

    // If URL provided, fetch page and extract text
    if (url && !jdText) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const pageRes = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const html = await pageRes.text();
        // Strip HTML tags to get plain text, keep key content
        jdText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 8000);
      } catch (fetchErr) {
        return res.status(400).json({ error: 'Failed to fetch URL: ' + fetchErr.message });
      }
    }

    // Read context files
    const cv = readSafe(PATHS.cv);
    const profileContent = readSafe(PATHS.profile);
    const sharedContext = readSafe(join(__dirname, 'modes/_shared.md'));

    const systemPrompt = `You are an expert career advisor evaluating a job description against a candidate profile. Use the Career-OS evaluation framework. Score the role 1-5 based on fit. Identify the matching archetype. Return your analysis as JSON with keys: score (number 1-5 with one decimal), summary (2-3 sentences), report (full markdown evaluation report), archetype (best matching archetype name).

${sharedContext.substring(0, 3000)}`;

    const userPrompt = `## Candidate CV:\n${cv.substring(0, 3000)}\n\n## Profile:\n${profileContent.substring(0, 1500)}\n\n## Job Description:\n${jdText.substring(0, 5000)}\n\nEvaluate this JD. Return ONLY valid JSON: {"score": number, "summary": "...", "report": "...", "archetype": "..."}`;

    log('INFO', `Evaluating JD via Anthropic API${url ? ': ' + url : ''}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: 'Anthropic API error', detail: errBody });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    // Try to parse JSON from response
    let result;
    try {
      // Find JSON in the response (may be wrapped in markdown code blocks)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 0, summary: rawText, report: rawText, archetype: 'Unknown' };
    } catch {
      result = { score: 0, summary: rawText.substring(0, 200), report: rawText, archetype: 'Unknown' };
    }

    res.json(result);
  } catch (err) {
    log('ERROR', `POST /api/evaluate: ${err.message}`);
    res.status(500).json({ error: 'Evaluation failed', detail: err.message });
  }
});

/**
 * POST /api/scan -- Trigger a portal scan
 * Reads portals.yml, fetches Greenhouse APIs, filters by title_filter
 */
app.post('/api/scan', async (req, res) => {
  try {
    const portalsPath = join(__dirname, 'portals.yml');
    const portalsContent = readSafe(portalsPath);

    if (!portalsContent) {
      return res.status(404).json({ error: 'portals.yml not found. Run onboarding first.' });
    }

    // Parse tracked companies with API endpoints from portals.yml
    const companies = [];
    const lines = portalsContent.split('\n');
    let currentCompany = null;

    for (const line of lines) {
      const nameMatch = line.match(/^\s*-\s+name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) {
        currentCompany = { name: nameMatch[1], api: null, filters: [] };
        companies.push(currentCompany);
        continue;
      }
      if (currentCompany) {
        const apiMatch = line.match(/^\s+api:\s*["']?(.+?)["']?\s*$/);
        if (apiMatch) currentCompany.api = apiMatch[1];
        const filterMatch = line.match(/^\s+title_filter:\s*["']?(.+?)["']?\s*$/);
        if (filterMatch) currentCompany.filters = filterMatch[1].split(',').map(f => f.trim().toLowerCase());
      }
    }

    const apiCompanies = companies.filter(c => c.api);
    const results = [];
    let added = 0;

    // Read existing pipeline to avoid duplicates
    const pipelineContent = readSafe(PATHS.pipeline);
    const existingUrls = new Set();
    for (const line of pipelineContent.split('\n')) {
      const urlMatch = line.match(/https?:\/\/\S+/);
      if (urlMatch) existingUrls.add(urlMatch[0]);
    }

    for (const company of apiCompanies) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const apiRes = await fetch(company.api, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!apiRes.ok) continue;
        const data = await apiRes.json();
        const jobs = Array.isArray(data) ? data : data.jobs || data.results || [];

        for (const job of jobs) {
          const title = (job.title || '').toLowerCase();
          const matchesFilter = company.filters.length === 0 || company.filters.some(f => title.includes(f));
          if (!matchesFilter) continue;

          const jobUrl = job.absolute_url || job.url || job.apply_url || '';
          if (!jobUrl || existingUrls.has(jobUrl)) continue;

          results.push({ company: company.name, title: job.title, url: jobUrl });
          existingUrls.add(jobUrl);
          added++;
        }
      } catch {
        // Skip companies whose API fails
      }
    }

    // Append new entries to pipeline.md
    if (results.length > 0) {
      let appendText = '';
      for (const r of results) {
        appendText += `\n- [ ] ${r.url} | ${r.company} | ${r.title}`;
      }
      const currentPipeline = readSafe(PATHS.pipeline);
      writeFileSync(PATHS.pipeline, currentPipeline + appendText);
    }

    log('INFO', `Scan complete: found ${results.length}, added ${added}`);
    res.json({ found: results.length, added, results });
  } catch (err) {
    log('ERROR', `POST /api/scan: ${err.message}`);
    res.status(500).json({ error: 'Scan failed', detail: err.message });
  }
});

/**
 * GET /api/inbox -- Placeholder inbox data (MCP proxy)
 */
app.get('/api/inbox', (req, res) => {
  res.json({
    messages: [
      { id: 1, from: 'recruiter@example.com', subject: 'Interview Invitation - VP of AI', date: '2026-04-07', snippet: 'We would like to schedule an interview for the VP of AI position...', category: 'Interview', read: false },
      { id: 2, from: 'hr@techcorp.com', subject: 'Application Received', date: '2026-04-06', snippet: 'Thank you for your application. We are reviewing...', category: 'Response', read: true },
      { id: 3, from: 'noreply@company.com', subject: 'Position Update', date: '2026-04-05', snippet: 'We appreciate your interest, however we have decided to move...', category: 'Rejection', read: true },
    ],
    note: 'Connect Gmail MCP in Claude Code for live data'
  });
});

/**
 * GET /api/calendar -- Placeholder calendar data (MCP proxy)
 */
app.get('/api/calendar', (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  res.json({
    events: [
      { id: 1, title: 'Interview: TechCorp VP AI', date: `${year}-${String(month+1).padStart(2,'0')}-10`, time: '10:00 AM', type: 'Interview', company: 'TechCorp' },
      { id: 2, title: 'Prep Block: STAR Stories', date: `${year}-${String(month+1).padStart(2,'0')}-08`, time: '2:00 PM', type: 'Prep Block', company: '' },
      { id: 3, title: 'Follow-up: InnovateCo', date: `${year}-${String(month+1).padStart(2,'0')}-12`, time: '9:00 AM', type: 'Follow-up', company: 'InnovateCo' },
      { id: 4, title: 'Application Deadline: AIStartup', date: `${year}-${String(month+1).padStart(2,'0')}-15`, time: '11:59 PM', type: 'Deadline', company: 'AIStartup' },
    ],
    note: 'Connect Google Calendar MCP in Claude Code for live data'
  });
});

/**
 * POST /api/research -- Deep research a company via Anthropic Claude
 * Body: { company: string }
 */
app.post('/api/research', async (req, res) => {
  try {
    const { company } = req.body;
    if (!company) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    }

    const profileContent = readSafe(PATHS.profile);

    const systemPrompt = `You are a career intelligence analyst. Research the company and provide strategic insights for a job candidate. Return your analysis as JSON with keys: company (string), summary (2-3 sentence overview), aiStrategy (their AI strategy and initiatives), culture (work culture and values), recentNews (recent notable news), glassdoor (estimated sentiment and rating), angle (how the candidate should position themselves for this company).`;

    const userPrompt = `Research this company: ${company}\n\nCandidate profile context:\n${profileContent.substring(0, 1000)}\n\nReturn ONLY valid JSON with the fields specified.`;

    log('INFO', `Researching company: ${company}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: 'Anthropic API error', detail: errBody });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    let result;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { company, summary: rawText };
    } catch {
      result = { company, summary: rawText.substring(0, 500), aiStrategy: '', culture: '', recentNews: '', glassdoor: '', angle: '' };
    }

    res.json(result);
  } catch (err) {
    log('ERROR', `POST /api/research: ${err.message}`);
    res.status(500).json({ error: 'Research failed', detail: err.message });
  }
});

/**
 * GET /api/file/:name -- Read a whitelisted file
 */
const EDITABLE_FILES = {
  'cv': PATHS.cv,
  'profile': PATHS.profile,
  'portals': join(__dirname, 'portals.yml'),
  'story-bank': PATHS.storyBank,
};

app.get('/api/file/:name', (req, res) => {
  try {
    const name = req.params.name;
    const filePath = EDITABLE_FILES[name];
    if (!filePath) {
      return res.status(400).json({ error: `File "${name}" is not editable. Allowed: ${Object.keys(EDITABLE_FILES).join(', ')}` });
    }
    const content = readSafe(filePath);
    res.json({ content, path: filePath, name });
  } catch (err) {
    log('ERROR', `GET /api/file/${req.params.name}: ${err.message}`);
    res.status(500).json({ error: 'Failed to read file', detail: err.message });
  }
});

/**
 * PUT /api/file/:name -- Write a whitelisted file
 * Body: { content: string }
 */
app.put('/api/file/:name', (req, res) => {
  try {
    const name = req.params.name;
    const filePath = EDITABLE_FILES[name];
    if (!filePath) {
      return res.status(400).json({ error: `File "${name}" is not editable. Allowed: ${Object.keys(EDITABLE_FILES).join(', ')}` });
    }
    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'content is required' });
    }
    writeFileSync(filePath, content, 'utf-8');
    log('INFO', `Updated file: ${name} (${filePath})`);
    res.json({ success: true, name, path: filePath });
  } catch (err) {
    log('ERROR', `PUT /api/file/${req.params.name}: ${err.message}`);
    res.status(500).json({ error: 'Failed to write file', detail: err.message });
  }
});

/**
 * POST /api/export-package -- Generate resume + cover letter + form answers for a role
 * Body: { roleId: number }
 */
app.post('/api/export-package', async (req, res) => {
  try {
    const { roleId } = req.body;
    if (!roleId) {
      return res.status(400).json({ error: 'roleId is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    }

    const cv = readSafe(PATHS.cv);
    const articleDigest = readSafe(PATHS.articleDigest);
    const trackerContent = readSafe(PATHS.tracker);
    const trackerRows = parseTracker(trackerContent);
    const roleData = trackerRows.find(r => r.num === parseInt(roleId));

    if (!roleData) {
      return res.status(404).json({ error: `Application #${roleId} not found` });
    }

    const systemPrompt = `You are an expert career content generator. Generate a complete application package for a job role. Return JSON with keys: resume (tailored markdown resume), coverLetter (compelling cover letter), answers (common application form answers in Q&A format).`;

    const userPrompt = `## Candidate CV:\n${cv.substring(0, 3000)}\n\n${articleDigest ? `## Proof Points:\n${articleDigest.substring(0, 2000)}\n\n` : ''}## Target Role:\nCompany: ${roleData.company}\nRole: ${roleData.role}\nScore: ${roleData.score}\n\nGenerate a complete application package. Return ONLY valid JSON: {"resume": "...", "coverLetter": "...", "answers": "..."}`;

    log('INFO', `Generating export package for #${roleId} ${roleData.company}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: 'Anthropic API error', detail: errBody });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    let result;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { resume: rawText, coverLetter: '', answers: '' };
    } catch {
      result = { resume: rawText, coverLetter: '', answers: '' };
    }

    res.json(result);
  } catch (err) {
    log('ERROR', `POST /api/export-package: ${err.message}`);
    res.status(500).json({ error: 'Export failed', detail: err.message });
  }
});

/**
 * GET /api/recommendations -- Smart recommendations based on pipeline + tracker
 */
app.get('/api/recommendations', (req, res) => {
  try {
    const trackerContent = readSafe(PATHS.tracker);
    const pipelineContent = readSafe(PATHS.pipeline);
    const trackerRows = parseTracker(trackerContent);
    const pipelineEntries = parsePipeline(pipelineContent);

    const priorities = [];

    // High-score evaluated but not applied
    const highScoreUnapplied = trackerRows
      .filter(r => {
        const score = parseFloat(r.score) || 0;
        const status = (r.status || '').toLowerCase();
        return score >= 4.0 && status === 'evaluated';
      })
      .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0))
      .slice(0, 3);

    for (const r of highScoreUnapplied) {
      priorities.push({
        company: r.company, title: r.role,
        reason: `Score ${r.score} -- strong fit, application not yet submitted`,
        urgency: 'high'
      });
    }

    // Responded/interview -- need follow-up
    const needFollowUp = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'responded' || status === 'interview';
    }).slice(0, 3);

    for (const r of needFollowUp) {
      priorities.push({
        company: r.company, title: r.role,
        reason: `Status: ${r.status} -- keep momentum, prepare or follow up`,
        urgency: 'high'
      });
    }

    // Pipeline C-suite roles not yet evaluated
    const csuiteInPipeline = pipelineEntries
      .filter(e => {
        const title = (e.title || e.role || '').toLowerCase();
        return /\b(vp|chief|caio|cto|cio)\b/.test(title) && !e.done;
      })
      .slice(0, 3);

    for (const e of csuiteInPipeline) {
      priorities.push({
        company: e.company || 'Unknown', title: e.title || e.role || 'C-Suite Role',
        reason: 'C-suite pipeline entry awaiting evaluation',
        urgency: 'medium'
      });
    }

    const weeklyGoals = `Focus areas: ${highScoreUnapplied.length} applications to submit, ${needFollowUp.length} follow-ups pending, ${csuiteInPipeline.length} C-suite roles to evaluate. Target: 3-5 quality applications this week.`;

    res.json({ priorities, weeklyGoals });
  } catch (err) {
    log('ERROR', `GET /api/recommendations: ${err.message}`);
    res.status(500).json({ error: 'Recommendations failed', detail: err.message });
  }
});

/**
 * POST /api/stories -- Add a STAR story to interview-prep/story-bank.md
 * Body: { situation, task, action, result, reflection, tags }
 */
app.post('/api/stories', (req, res) => {
  try {
    const { situation, task, action, result, reflection, tags } = req.body;
    if (!situation || !task || !action || !result) {
      return res.status(400).json({ error: 'situation, task, action, and result are required' });
    }

    let content = readSafe(PATHS.storyBank);

    // If file is empty or doesn't exist, create the structure
    if (!content.trim()) {
      content = `# Story Bank (STAR+R)\n\n`;
    }

    // Append the new story
    const tagStr = tags ? `**Tags:** ${tags}\n` : '';
    const storyEntry = `\n## Story: ${situation.substring(0, 60)}\n\n${tagStr}**Situation:** ${situation}\n\n**Task:** ${task}\n\n**Action:** ${action}\n\n**Result:** ${result}\n\n**Reflection:** ${reflection || 'N/A'}\n\n---\n`;

    content += storyEntry;
    writeFileSync(PATHS.storyBank, content, 'utf-8');

    log('INFO', `Added new STAR story to story bank`);
    res.json({ success: true });
  } catch (err) {
    log('ERROR', `POST /api/stories: ${err.message}`);
    res.status(500).json({ error: 'Failed to add story', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes -- Memory System
// ---------------------------------------------------------------------------

// GET /api/memory
app.get('/api/memory', (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  try {
    const data = JSON.parse(readFileSync(memoryPath, 'utf-8'));
    res.json(data);
  } catch {
    res.json({ careerFacts: [], preferences: [], actionItems: [], conversations: [] });
  }
});

// POST /api/memory -- save a memory entry
app.post('/api/memory', (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  let memories = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
  try { memories = JSON.parse(readFileSync(memoryPath, 'utf-8')); } catch {}

  const { type, data } = req.body; // type: 'careerFact', 'preference', 'actionItem', 'conversation'
  if (type === 'careerFact') memories.careerFacts.push({ ...data, date: new Date().toISOString().split('T')[0] });
  else if (type === 'preference') memories.preferences.push(data);
  else if (type === 'actionItem') memories.actionItems.push({ ...data, status: 'pending', date: new Date().toISOString().split('T')[0] });
  else if (type === 'conversation') memories.conversations.push({ ...data, date: new Date().toISOString().split('T')[0] });

  writeFileSync(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
  res.json({ success: true });
});

// POST /api/memory/extract -- use Claude to extract facts from conversation
app.post('/api/memory/extract', async (req, res) => {
  const { messages } = req.body; // array of { role, text }
  if (!messages?.length) return res.json({ facts: [], actions: [] });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const transcript = messages.map(m => `${m.role}: ${m.text}`).join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Extract career-relevant facts and action items from this conversation between Stephen C. Webster and his AI career coach.\n\nConversation:\n${transcript}\n\nReturn JSON with:\n- "facts": array of { "type": "role"|"achievement"|"skill"|"preference"|"goal", "content": "description" }\n- "actions": array of { "action": "what to do", "priority": "high"|"medium"|"low" }\n\nOnly include genuinely new/important information. Return ONLY valid JSON, no markdown.`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const extracted = JSON.parse(text);

    // Save extracted facts to memory
    const memoryPath = join(ROOT, 'data', 'agent-memory.json');
    let memories = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
    try { memories = JSON.parse(readFileSync(memoryPath, 'utf-8')); } catch {}

    const today = new Date().toISOString().split('T')[0];
    if (extracted.facts) {
      extracted.facts.forEach(f => memories.careerFacts.push({ ...f, date: today, applied: false }));
    }
    if (extracted.actions) {
      extracted.actions.forEach(a => memories.actionItems.push({ ...a, status: 'pending', date: today }));
    }

    writeFileSync(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
    res.json({ extracted, saved: true });
  } catch (err) {
    log('ERROR', `Memory extraction failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/memory/:index -- update action item status
app.patch('/api/memory/:index', (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  try {
    const memories = JSON.parse(readFileSync(memoryPath, 'utf-8'));
    const idx = parseInt(req.params.index);
    if (memories.actionItems[idx]) {
      Object.assign(memories.actionItems[idx], req.body);
      writeFileSync(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Action item not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversation/save -- save conversation log
app.post('/api/conversation/save', (req, res) => {
  const { messages } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const dir = join(ROOT, 'data', 'conversations');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${today}.json`);

  // Append to existing day's conversation
  let existing = [];
  try { existing = JSON.parse(readFileSync(filePath, 'utf-8')); } catch {}
  existing.push(...messages);

  writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
  res.json({ success: true, count: existing.length });
});

// GET /api/conversation/latest -- get latest conversation
app.get('/api/conversation/latest', (req, res) => {
  const dir = join(ROOT, 'data', 'conversations');
  if (!existsSync(dir)) return res.json({ messages: [] });
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  if (!files.length) return res.json({ messages: [] });
  try {
    const messages = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
    res.json({ date: files[0].replace('.json', ''), messages });
  } catch {
    res.json({ messages: [] });
  }
});

// ---------------------------------------------------------------------------
// POST /api/chat -- Text chat via Claude API
// Text chat goes through Claude (not Gemini Live, which is audio-only).
// This gives proper text responses for typed messages.
// ---------------------------------------------------------------------------

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // Build context-rich system prompt
  const cvContent = readSafe(join(ROOT, 'cv.md')).slice(0, 3000);
  const profileContent = readSafe(PATHS.profile).slice(0, 2000);
  const pipelineContent = readSafe(PATHS.pipeline);
  const pipelineCount = (pipelineContent.match(/^- \[/gm) || []).length;
  const trackerContent = readSafe(PATHS.tracker);
  const appCount = (trackerContent.match(/^\|\s*\d+/gm) || []).length;

  // Load memories
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  let memories = { careerFacts: [], preferences: [], actionItems: [] };
  try { memories = JSON.parse(readFileSync(memoryPath, 'utf-8')); } catch {}

  const systemPrompt = `You are Career-OS, Stephen C. Webster's AI career coach and assistant. You are direct, warm, and knowledgeable. You help with:
- Interview preparation and roleplay
- Resume and cover letter strategy
- Job search and application decisions
- Salary negotiation tactics
- Career narrative and positioning

STEPHEN'S BACKGROUND:
${cvContent ? cvContent.slice(0, 2000) : 'CV not loaded.'}

CURRENT STATUS:
- ${pipelineCount} offers in pipeline
- ${appCount} applications tracked
- Targeting: CAIO, VP of AI, CTO roles
- Target comp: $200K+ base

${memories.careerFacts?.length ? 'KNOWN FACTS:\n' + memories.careerFacts.map(f => '- ' + f.content).join('\n') : ''}
${memories.actionItems?.filter(a => a.status === 'pending').length ? 'PENDING ACTIONS:\n' + memories.actionItems.filter(a => a.status === 'pending').map(a => '- ' + a.action).join('\n') : ''}

Keep responses concise (2-4 sentences for simple questions, longer for complex analysis). Be actionable. Use Stephen's actual metrics and proof points when relevant. Don't be sycophantic.`;

  // Build messages array from history
  const messages = [];
  if (history && Array.isArray(history)) {
    // Include last 10 messages for context
    const recent = history.slice(-10);
    for (const msg of recent) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text || msg.content || ''
      });
    }
  }
  messages.push({ role: 'user', content: message });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      log('ERROR', `Claude API error: ${response.status} ${err.slice(0, 200)}`);
      return res.status(500).json({ error: 'Claude API error: ' + response.status });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || 'No response generated.';
    res.json({ response: text });
  } catch (err) {
    log('ERROR', `Chat error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback -- send index.html for any unmatched GET request
// ---------------------------------------------------------------------------

app.get('/{*splat}', (req, res) => {
  const indexPath = join(PATHS.publicDir, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      error: 'Frontend not built',
      message: 'No public/index.html found. Create the public/ directory with your SPA build.',
    });
  }
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket Server
// ---------------------------------------------------------------------------

const server = createServer(app);

// WebSocket server for Gemini Live proxy
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/ws/gemini') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (clientWs) => {
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    log('WARN', 'WebSocket connection attempted but GEMINI_API_KEY not set');
    clientWs.send(JSON.stringify({
      type: 'error',
      error: 'GEMINI_API_KEY not configured. Add it to your .env file.',
    }));
    clientWs.close(1008, 'API key not configured');
    return;
  }

  log('INFO', 'New Gemini Live WebSocket connection from browser');

  const geminiUrl = `${GEMINI_WS_URL}?key=${geminiKey}`;
  let geminiWs = null;
  let clientClosed = false;
  let geminiClosed = false;
  let keepAlive = null;

  // Connect to Gemini Live API
  try {
    geminiWs = new WebSocket(geminiUrl);
  } catch (err) {
    log('ERROR', `Failed to create Gemini WebSocket: ${err.message}`);
    clientWs.send(JSON.stringify({ type: 'error', error: 'Failed to connect to Gemini API' }));
    clientWs.close(1011, 'Upstream connection failed');
    return;
  }

  geminiWs.on('open', () => {
    log('INFO', 'Connected to Gemini Live API');

    // Send initial setup message with system instruction
    const systemInstruction = buildSystemInstruction();
    const setupMessage = {
      setup: {
        model: 'models/gemini-2.5-flash-native-audio-latest',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
      },
    };

    geminiWs.send(JSON.stringify(setupMessage));

    // Keep-alive ping every 30 seconds
    keepAlive = setInterval(() => {
      if (!geminiClosed && geminiWs?.readyState === WebSocket.OPEN) {
        geminiWs.ping();
      }
    }, 30000);
  });

  // Proxy: Gemini -> Client (translate Gemini format to simple format)
  geminiWs.on('message', (data) => {
    if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
      try {
        const raw = data.toString();
        const msg = JSON.parse(raw);

        // Extract text from serverContent
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.text) {
              clientWs.send(JSON.stringify({ type: 'text', text: part.text }));
            }
            if (part.inlineData) {
              clientWs.send(JSON.stringify({
                type: 'audio',
                audio: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              }));
            }
          }
        }
        // Forward transcriptions (native audio models provide these)
        if (msg.serverContent?.outputTranscription?.text) {
          clientWs.send(JSON.stringify({ type: 'transcript', text: msg.serverContent.outputTranscription.text }));
        }
        if (msg.serverContent?.inputTranscription?.text) {
          clientWs.send(JSON.stringify({ type: 'inputTranscript', text: msg.serverContent.inputTranscription.text }));
        }
        // Forward turnComplete signal
        if (msg.serverContent?.turnComplete) {
          clientWs.send(JSON.stringify({ type: 'turnComplete' }));
        }
        // Forward setup complete
        if (msg.setupComplete) {
          clientWs.send(JSON.stringify({ type: 'ready' }));
          log('INFO', 'Gemini Live session ready');
        }
      } catch (err) {
        log('ERROR', `Error parsing Gemini message: ${err.message}`);
      }
    }
  });

  geminiWs.on('error', (err) => {
    log('ERROR', `Gemini WebSocket error: ${err.message}`);
    if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: `Gemini error: ${err.message}` }));
    }
  });

  geminiWs.on('close', (code, reason) => {
    geminiClosed = true;
    clearInterval(keepAlive);
    const reasonStr = reason ? reason.toString() : '';
    log('INFO', `Gemini WebSocket closed: ${code} ${reasonStr}`);
    if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reasonStr);
    }
  });

  // Proxy: Client -> Gemini (translate simple format to Gemini Live API format)
  clientWs.on('message', (data) => {
    if (!geminiClosed && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      try {
        const raw = data.toString();

        // Check if it's binary audio data (from MediaRecorder)
        if (data instanceof Buffer && !raw.startsWith('{')) {
          const b64 = data.toString('base64');
          const geminiMsg = {
            realtimeInput: {
              audio: { data: b64, mimeType: 'audio/pcm;rate=16000' }
            }
          };
          geminiWs.send(JSON.stringify(geminiMsg));
          return;
        }

        const msg = JSON.parse(raw);

        if (msg.type === 'text' && msg.content) {
          // Use clientContent for text input (proper turn-based conversation)
          const geminiMsg = {
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: msg.content }] }],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(geminiMsg));
        } else if (msg.type === 'audio' && msg.data) {
          // Convert audio chunk to Gemini realtimeInput audio format
          const geminiMsg = {
            realtimeInput: {
              audio: { data: msg.data, mimeType: msg.mimeType || 'audio/pcm;rate=16000' }
            }
          };
          geminiWs.send(JSON.stringify(geminiMsg));
        } else {
          // Forward unknown messages as-is
          geminiWs.send(raw);
        }
      } catch (err) {
        log('ERROR', `Error forwarding Client -> Gemini: ${err.message}`);
      }
    }
  });

  clientWs.on('error', (err) => {
    log('ERROR', `Client WebSocket error: ${err.message}`);
  });

  clientWs.on('close', (code, reason) => {
    clientClosed = true;
    clearInterval(keepAlive);
    log('INFO', `Client WebSocket closed: ${code} ${reason}`);
    if (!geminiClosed && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close(1000, 'Client disconnected');
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  log('OK', `Career-OS Dashboard Server running at http://localhost:${PORT}`);
  log('INFO', `API endpoints at http://localhost:${PORT}/api/`);
  log('INFO', `Gemini Live WebSocket at ws://localhost:${PORT}/ws/gemini`);
  log('INFO', `Serving static files from ${PATHS.publicDir}`);

  // Log connector status
  const connectors = parseEnvStatus();
  const active = Object.entries(connectors).filter(([, v]) => v).map(([k]) => k);
  const missing = Object.entries(connectors).filter(([, v]) => !v).map(([k]) => k);

  if (active.length > 0) {
    log('OK', `Active API keys: ${active.join(', ')}`);
  }
  if (missing.length > 0) {
    log('WARN', `Missing API keys: ${missing.join(', ')}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('INFO', 'SIGTERM received, shutting down...');
  server.close(() => {
    log('INFO', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('INFO', 'SIGINT received, shutting down...');
  server.close(() => {
    log('INFO', 'Server closed');
    process.exit(0);
  });
});
