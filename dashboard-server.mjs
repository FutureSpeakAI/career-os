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
import { readFile, writeFile, mkdir, readdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseMdTable,
  parseMdSections,
  parseSimpleYaml,
  parseYamlList,
  parsePipeline,
  parseTracker,
  parseScanHistory,
  computeAnalytics,
  classifyTier,
  isMemoryDuplicate,
  parseEnvStatus,
} from './lib/parsers.mjs';
import {
  extractProofPoints,
  summarizeConversationHistory,
  parseTitleFilter,
  matchesTitleFilter,
} from './lib/intelligence.mjs';
import { compressionMiddleware } from './lib/compression.mjs';
import { createFileCache } from './lib/cache-headers.mjs';

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
const GEMINI_SYSTEM_INSTRUCTION = `You are Stephen C. Webster's AI career coach inside Career-OS.

PERSONALITY: Direct, warm, action-oriented. You celebrate wins but push for specificity. Never hedge -- give clear recommendations. When Stephen is vague, ask one pointed question rather than multiple.

TOOLS: You have 13 tools -- USE THEM IMMEDIATELY when Stephen asks you to do something. Do not describe what you would do; do it. Do not ask for permission unless genuinely ambiguous. If a tool fails, tell Stephen what went wrong and suggest the fix.

TOOL SELECTION:
- "Find me jobs" / "What's new?" -> scan_portals
- Pastes a URL or JD -> evaluate_job
- "Write a resume" / "Update my CV for X" -> generate_resume
- "Cover letter for X" -> generate_cover_letter
- "Draft an email" / "Follow up" / "Thank you" -> draft_email
- "Is this still open?" -> verify_listing
- "Tell me about [company]" -> research_company
- "I applied" / "Got rejected" / status update -> update_application_status
- Shares a new fact about himself -> save_memory (proactively, without being asked)
- Shares an accomplishment -> add_story
- "What's in my pipeline?" -> get_pipeline
- "Show my tracker" -> get_tracker
- "What should I focus on?" -> get_recommendations

INTERVIEW ROLEPLAY: When Stephen asks to practice, immediately become the interviewer. Use the company name and role if known. Ask one question at a time. After each answer, give brief feedback (what was strong, what to sharpen), then ask the next question. Push for metrics and proof points in every answer.

NEGOTIATION PRACTICE: Play the hiring manager. Start with a realistic but below-target offer. Respond naturally to counter-arguments. After the practice, debrief with what worked and what to improve.

ANTI-HALLUCINATION: If you do not know a fact about a company, say so and suggest using research_company. Never invent interview questions specific to a company without first researching it.

Stephen's background: 20 years of journalism (Raw Story EIC, scaled 50K to 5M readers), frontier AI model training (Google, Meta, Amazon), current Senior Director at Aquent Studios, targeting CAIO/VP of AI roles. Target comp: $200K+ base.`;

// Gemini function declarations -- these let the voice agent take actions
const GEMINI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'evaluate_job',
      description: 'Evaluate a job description by URL or text. Returns a score and analysis.',
      parameters: { type: 'OBJECT', properties: {
        url: { type: 'STRING', description: 'URL of the job posting' },
        text: { type: 'STRING', description: 'Raw job description text (if no URL)' }
      }}
    },
    {
      name: 'scan_portals',
      description: 'Scan job portals to discover new matching offers. Checks Greenhouse APIs and tracked companies.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'generate_resume',
      description: 'Generate a tailored resume for a specific tracked application.',
      parameters: { type: 'OBJECT', properties: {
        company: { type: 'STRING', description: 'Company name' },
        role: { type: 'STRING', description: 'Role title' }
      }, required: ['company'] }
    },
    {
      name: 'generate_cover_letter',
      description: 'Generate a tailored cover letter for a specific role.',
      parameters: { type: 'OBJECT', properties: {
        company: { type: 'STRING', description: 'Company name' },
        role: { type: 'STRING', description: 'Role title' }
      }, required: ['company'] }
    },
    {
      name: 'draft_email',
      description: 'Draft an email (follow-up, thank you, response to recruiter, outreach, etc.)',
      parameters: { type: 'OBJECT', properties: {
        recipient: { type: 'STRING', description: 'Who the email is to (name or role)' },
        purpose: { type: 'STRING', description: 'Purpose of the email (follow-up, thank you, cold outreach, etc.)' },
        company: { type: 'STRING', description: 'Company name if relevant' }
      }, required: ['purpose'] }
    },
    {
      name: 'verify_listing',
      description: 'Check if a job listing URL is still active or has been taken down.',
      parameters: { type: 'OBJECT', properties: {
        url: { type: 'STRING', description: 'URL to verify' }
      }, required: ['url'] }
    },
    {
      name: 'research_company',
      description: 'Deep research a company: AI strategy, culture, recent news, Glassdoor sentiment, and positioning angle.',
      parameters: { type: 'OBJECT', properties: {
        company: { type: 'STRING', description: 'Company name to research' }
      }, required: ['company'] }
    },
    {
      name: 'update_application_status',
      description: 'Update the status of a tracked application (e.g., mark as Applied, Interview, Rejected).',
      parameters: { type: 'OBJECT', properties: {
        company: { type: 'STRING', description: 'Company name' },
        status: { type: 'STRING', description: 'New status: Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP' }
      }, required: ['company', 'status'] }
    },
    {
      name: 'save_memory',
      description: 'Save an important fact, preference, or action item to persistent memory.',
      parameters: { type: 'OBJECT', properties: {
        type: { type: 'STRING', description: 'Type: careerFact, preference, or actionItem' },
        content: { type: 'STRING', description: 'What to remember' }
      }, required: ['type', 'content'] }
    },
    {
      name: 'add_story',
      description: 'Add a STAR interview story to the story bank.',
      parameters: { type: 'OBJECT', properties: {
        situation: { type: 'STRING', description: 'The situation/context' },
        task: { type: 'STRING', description: 'The task/challenge' },
        action: { type: 'STRING', description: 'Actions taken' },
        result: { type: 'STRING', description: 'Results achieved' },
        reflection: { type: 'STRING', description: 'What was learned' }
      }, required: ['situation', 'task', 'action', 'result'] }
    },
    {
      name: 'get_pipeline',
      description: 'Get the current list of job offers in the pipeline with company, role, and tier.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'get_tracker',
      description: 'Get the current applications tracker with status, scores, and notes.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'get_recommendations',
      description: 'Get smart recommendations for what to prioritize this week.',
      parameters: { type: 'OBJECT', properties: {} }
    }
  ]
}];

// Execute a tool call from Gemini and return the result
async function executeToolCall(name, args) {
  log('INFO', `Voice agent tool call: ${name}(${JSON.stringify(args).slice(0, 100)})`);
  const base = `http://localhost:${PORT}`;
  try {
    switch (name) {
      case 'evaluate_job': {
        const res = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: args.url, text: args.text }) });
        return await res.json();
      }
      case 'scan_portals': {
        const res = await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        return await res.json();
      }
      case 'generate_resume': {
        const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'resume', context: `${args.company} - ${args.role || ''}` }) });
        return await res.json();
      }
      case 'generate_cover_letter': {
        const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cover-letter', context: `${args.company} - ${args.role || ''}` }) });
        return await res.json();
      }
      case 'draft_email': {
        const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'email-draft', context: `To: ${args.recipient || 'recruiter'} at ${args.company || 'company'}, Purpose: ${args.purpose}` }) });
        return await res.json();
      }
      case 'verify_listing': {
        const res = await fetch(`${base}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: args.url }) });
        return await res.json();
      }
      case 'research_company': {
        const res = await fetch(`${base}/api/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: args.company }) });
        return await res.json();
      }
      case 'update_application_status': {
        // Find the application by company name
        const tracker = await readSafeAsync(PATHS.tracker);
        // Escape special regex characters in company name to prevent ReDoS
        const escapedCompany = (args.company || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = tracker.match(new RegExp(`^\\|\\s*(\\d+)\\s*\\|[^|]*\\|\\s*${escapedCompany}`, 'mi'));
        if (match) {
          const res = await fetch(`${base}/api/tracker/${match[1]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: args.status }) });
          return await res.json();
        }
        return { error: `Application for ${args.company} not found in tracker` };
      }
      case 'save_memory': {
        const memoryPath = join(ROOT, 'data', 'agent-memory.json');
        const memories = await readJsonSafeAsync(memoryPath, { careerFacts: [], preferences: [], actionItems: [], conversations: [] });
        const today = new Date().toISOString().split('T')[0];
        if (args.type === 'careerFact') {
          if (!isMemoryDuplicate(memories.careerFacts.map(f => f.content), args.content)) {
            memories.careerFacts.push({ content: args.content, date: today });
          } else {
            return { success: true, message: `Already known: ${args.content}`, deduplicated: true };
          }
        } else if (args.type === 'preference') {
          const key = args.content.split(':')[0];
          // Replace existing preference with same key
          const existingIdx = memories.preferences.findIndex(p => p.key === key);
          if (existingIdx >= 0) {
            memories.preferences[existingIdx] = { key, value: args.content, date: today };
          } else {
            memories.preferences.push({ key, value: args.content, date: today });
          }
        } else if (args.type === 'actionItem') {
          if (!isMemoryDuplicate(memories.actionItems.filter(a => a.status === 'pending').map(a => a.action), args.content)) {
            memories.actionItems.push({ action: args.content, status: 'pending', date: today });
          } else {
            return { success: true, message: `Already tracked: ${args.content}`, deduplicated: true };
          }
        }
        await writeFile(memoryPath, JSON.stringify(memories, null, 2));
        return { success: true, message: `Saved ${args.type}: ${args.content}` };
      }
      case 'add_story': {
        const res = await fetch(`${base}/api/stories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        return await res.json();
      }
      case 'get_pipeline': {
        const content = await readSafeAsync(PATHS.pipeline);
        const entries = parsePipeline(content);
        return { count: entries.length, top5: entries.slice(0, 5).map(e => `${e.company}: ${e.title} (${e.tier})`) };
      }
      case 'get_tracker': {
        const content = await readSafeAsync(PATHS.tracker);
        const rows = parseTracker(content);
        return { count: rows.length, entries: rows.slice(0, 10).map(r => `${r.Company || r.company}: ${r.Role || r.role} [${r.Status || r.status}] ${r.Score || r.score || ''}`) };
      }
      case 'get_recommendations': {
        const res = await fetch(`${base}/api/recommendations`);
        return await res.json();
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    log('ERROR', `Tool execution error (${name}): ${err.message}`);
    return { error: err.message };
  }
}

const ROOT = __dirname;

// File cache for ETag-based cache validation on GET endpoints
const fileCache = createFileCache();

// Memory Deduplication -- imported from lib/parsers.mjs

// ---------------------------------------------------------------------------
// Rate Limiting (in-memory, no dependencies)
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate limiter.
 * windowMs: time window in milliseconds
 * max: maximum requests allowed in that window
 */
function createRateLimiter(windowMs, max) {
  const hits = new Map(); // key -> [timestamps]

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create timestamps array
    let timestamps = hits.get(key) || [];
    // Purge expired entries
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter,
      });
    }

    timestamps.push(now);
    hits.set(key, timestamps);

    // Periodic cleanup: remove stale keys every 100 requests
    if (hits.size > 100) {
      for (const [k, v] of hits) {
        const fresh = v.filter(t => t > windowStart);
        if (fresh.length === 0) hits.delete(k);
        else hits.set(k, fresh);
      }
    }

    next();
  };
}

// Rate limiters for different endpoint tiers
const apiProxyLimiter = createRateLimiter(60_000, 10);  // 10 req/min for AI proxy endpoints
const writeEndpointLimiter = createRateLimiter(60_000, 30);  // 30 req/min for write operations
const readEndpointLimiter = createRateLimiter(60_000, 120);  // 120 req/min for read operations

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
 * Read a file safely (async), returning empty string if it doesn't exist.
 * Preferred in request handlers over the sync version.
 */
async function readSafeAsync(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Read and parse a JSON file safely (async), returning fallback if it doesn't exist.
 */
async function readJsonSafeAsync(filePath, fallback) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

// parseMdTable -- imported from lib/parsers.mjs

// parseMdSections -- imported from lib/parsers.mjs

// parseSimpleYaml -- imported from lib/parsers.mjs

// parseYamlList -- imported from lib/parsers.mjs

// parseEnvStatus -- imported from lib/parsers.mjs

// parsePipeline -- imported from lib/parsers.mjs

// parseTracker -- imported from lib/parsers.mjs

// parseScanHistory -- imported from lib/parsers.mjs

// computeAnalytics -- imported from lib/parsers.mjs

// ---------------------------------------------------------------------------
// Dynamic System Instruction Builder
// ---------------------------------------------------------------------------

async function buildSystemInstruction() {
  const base = GEMINI_SYSTEM_INSTRUCTION;

  // Load memories, CV, and pipeline/tracker in parallel (async)
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  const [memories, cvContent, pipeline, tracker] = await Promise.all([
    readJsonSafeAsync(memoryPath, { careerFacts: [], preferences: [], actionItems: [], conversations: [] }),
    readSafeAsync(PATHS.cv),
    readSafeAsync(PATHS.pipeline),
    readSafeAsync(PATHS.tracker),
  ]);

  const pipelineCount = (pipeline.match(/^- \[/gm) || []).length;
  const appCount = (tracker.match(/^\|\s*\d+/gm) || []).length;

  let instruction = base;

  // Extract top 5 proof points from CV for roleplay and interview scenarios.
  // Proof points are lines containing quantified metrics (numbers with context).
  if (cvContent) {
    const proofPoints = extractProofPoints(cvContent, 5);
    if (proofPoints.length > 0) {
      instruction += '\n\nKEY PROOF POINTS (use these in roleplay, interview prep, and to push for specificity):\n';
      proofPoints.forEach(p => { instruction += `- ${p}\n`; });
    }
  }

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

// extractProofPoints -- imported from lib/intelligence.mjs
// summarizeConversationHistory -- imported from lib/intelligence.mjs
// parseTitleFilter -- imported from lib/intelligence.mjs
// matchesTitleFilter -- imported from lib/intelligence.mjs

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();

// Middleware -- limit request body to 1MB to prevent abuse
app.use(express.json({ limit: '1mb' }));

// Response compression (gzip/deflate) for API JSON responses
app.use(compressionMiddleware());

// CORS -- restrict to localhost origins only (all common dev ports)
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:3000',
  'http://localhost:3333',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://localhost:8080',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  // Requests from same origin (no Origin header) are always allowed
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' ws://localhost:* wss://localhost:*");

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
app.get('/api/profile', fileCache.middleware(PATHS.profile), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.profile);
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
 * GET /api/pipeline -- Returns parsed data/pipeline.md with optional pagination
 * Query params:
 *   page  -- page number (1-based), default: 1 (0 = return all)
 *   limit -- items per page, default: 50 (max: 200)
 *   tier  -- filter by tier: 'c-suite', 'director', 'other'
 *   q     -- search term to filter by company or title
 */
app.get('/api/pipeline', fileCache.middleware(PATHS.pipeline), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.pipeline);
    let entries = parsePipeline(content);

    // Filter by tier if specified
    const tierFilter = req.query.tier;
    if (tierFilter && ['c-suite', 'director', 'other'].includes(tierFilter)) {
      entries = entries.filter(e => {
        const tier = e.tier || classifyTier(e.title || e.role || '');
        return tier === tierFilter;
      });
    }

    // Search filter
    const searchQuery = (req.query.q || '').toLowerCase().trim();
    if (searchQuery) {
      entries = entries.filter(e => {
        const company = (e.company || e.Company || '').toLowerCase();
        const title = (e.title || e.Title || e.role || e.Role || '').toLowerCase();
        return company.includes(searchQuery) || title.includes(searchQuery);
      });
    }

    const totalCount = entries.length;
    const rawPage = parseInt(req.query.page);
    const page = isNaN(rawPage) ? 1 : Math.max(0, rawPage);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    // page=0 means return all (backwards compatible)
    if (page === 0) {
      return res.json({ count: totalCount, entries, page: 0, limit: totalCount, totalPages: 1 });
    }

    const totalPages = Math.ceil(totalCount / limit);
    const offset = (page - 1) * limit;
    const pagedEntries = entries.slice(offset, offset + limit);

    res.json({
      count: totalCount,
      entries: pagedEntries,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (err) {
    log('ERROR', `GET /api/pipeline: ${err.message}`);
    res.status(500).json({ error: 'Failed to read pipeline', detail: err.message });
  }
});

/**
 * GET /api/tracker -- Returns parsed data/applications.md
 */
app.get('/api/tracker', fileCache.middleware(PATHS.tracker), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.tracker);
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
app.get('/api/reports', async (req, res) => {
  try {
    let dirFiles;
    try { dirFiles = await readdir(PATHS.reportsDir); } catch { return res.json({ count: 0, files: [] }); }

    const files = dirFiles
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
app.get('/api/reports/:file', async (req, res) => {
  try {
    const filename = req.params.file;

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = join(PATHS.reportsDir, filename);
    const content = await readSafeAsync(filePath);
    if (!content) {
      return res.status(404).json({ error: 'Report not found' });
    }

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
app.get('/api/scan-history', fileCache.middleware(PATHS.scanHistory), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.scanHistory);
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
app.get('/api/contacts', fileCache.middleware(PATHS.contacts), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.contacts);
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
app.get('/api/follow-ups', async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.followUps);
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
app.get('/api/story-bank', async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.storyBank);
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
app.get('/api/connectors', async (req, res) => {
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
app.get('/api/comp', async (req, res) => {
  try {
    const [marketData, negotiation, roleComp, profileContent] = await Promise.all([
      readSafeAsync(PATHS.marketData),
      readSafeAsync(PATHS.negotiation),
      readSafeAsync(PATHS.roleComp),
      readSafeAsync(PATHS.profile),
    ]);

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
app.get('/api/brand', async (req, res) => {
  try {
    const [brandPos, contentCal, engagement] = await Promise.all([
      readSafeAsync(PATHS.brandPos),
      readSafeAsync(PATHS.contentCal),
      readSafeAsync(PATHS.engagement),
    ]);

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
app.get('/api/analytics', fileCache.middleware(PATHS.tracker), async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.tracker);
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
app.post('/api/generate', apiProxyLimiter, async (req, res) => {
  try {
    const { type, roleId, context } = req.body;

    if (!type || !['resume', 'cover-letter', 'email-draft', 'interview-prep'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid or missing content type.',
        hint: 'Set "type" to one of: resume, cover-letter, email-draft, interview-prep. Example: { "type": "resume", "context": "Company - Role" }',
        validTypes: ['resume', 'cover-letter', 'email-draft', 'interview-prep'],
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'ANTHROPIC_API_KEY is not configured.',
        hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file in the project root, then restart the server. Get a key at https://console.anthropic.com/settings/keys',
      });
    }

    // Gather context (async parallel reads)
    const [cv, articleDigest, profileContent, trackerContent] = await Promise.all([
      readSafeAsync(PATHS.cv),
      readSafeAsync(PATHS.articleDigest),
      readSafeAsync(PATHS.profile),
      readSafeAsync(PATHS.tracker),
    ]);
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
app.patch('/api/tracker/:num', writeEndpointLimiter, async (req, res) => {
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
      const statesContent = await readSafeAsync(PATHS.statesYml);
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

    const content = await readSafeAsync(PATHS.tracker);
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

    await writeFile(PATHS.tracker, lines.join('\n'));
    fileCache.invalidate(PATHS.tracker);
    res.json({ success: true, num, status, notes });
  } catch (err) {
    log('ERROR', `PATCH /api/tracker/${req.params.num}: ${err.message}`);
    res.status(500).json({ error: 'Update failed', detail: err.message });
  }
});

/**
 * POST /api/verify-all -- Verify ALL pipeline offers (batch)
 */
app.post('/api/verify-all', writeEndpointLimiter, async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.pipeline);
    const entries = parsePipeline(content);

    if (entries.length === 0) {
      return res.json({ count: 0, results: [], message: 'No pipeline entries to verify' });
    }

    // Cap at 50 entries to avoid timeout, verify in parallel batches of 10
    const toVerify = entries.slice(0, 50);
    log('INFO', `Batch verifying ${toVerify.length} of ${entries.length} pipeline entries`);

    const results = [];

    async function verifyOne(entry) {
      const url = entry.url || entry.URL || entry.Url || '';
      const company = entry.company || entry.Company || '';
      const title = entry.title || entry.Title || entry.Role || '';
      if (!url || !url.startsWith('http')) {
        return { url: url || '(no URL)', company, title, status: 'error', message: 'Invalid URL' };
      }
      try {
        const controller = new AbortController();
        const tm = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
          redirect: 'follow', signal: controller.signal,
        });
        clearTimeout(tm);
        if (response.status === 404) return { url, company, title, status: 'not-found' };
        if (response.status >= 400) return { url, company, title, status: 'error' };
        const html = await response.text();
        const lower = html.toLowerCase();
        const closed = ['this job is no longer available','this position has been filled','this job has been closed','this posting has expired','no longer accepting applications','position closed'];
        const pageTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
        const status = closed.some(c => lower.includes(c)) ? 'closed' : 'active';
        return { url, company, title: pageTitle || title, status };
      } catch (err) {
        return { url, company, title, status: err.name === 'AbortError' ? 'timeout' : 'error', message: err.message };
      }
    }

    // Process in concurrent batches of 10
    for (let i = 0; i < toVerify.length; i += 10) {
      const batch = toVerify.slice(i, i + 10);
      const batchResults = await Promise.all(batch.map(verifyOne));
      results.push(...batchResults);
      if (i + 10 < toVerify.length) await new Promise(r => setTimeout(r, 500));
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
app.post('/api/evaluate', apiProxyLimiter, async (req, res) => {
  try {
    const { url, text } = req.body;
    if (!url && !text) {
      return res.status(400).json({
        error: 'Either a job URL or description text is required.',
        hint: 'Send { "url": "https://..." } to evaluate by URL, or { "text": "Job description..." } to evaluate raw text.',
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'ANTHROPIC_API_KEY is not configured.',
        hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file, then restart the server.',
      });
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

    // Read context files (async parallel)
    const [cv, profileContent, sharedContext] = await Promise.all([
      readSafeAsync(PATHS.cv),
      readSafeAsync(PATHS.profile),
      readSafeAsync(join(__dirname, 'modes/_shared.md')),
    ]);

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
      return res.status(502).json({ error: 'Anthropic API request failed.', hint: 'This usually means the API key is invalid, expired, or rate-limited. Check your ANTHROPIC_API_KEY in .env and try again.', detail: errBody });
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
 * Reads portals.yml, fetches Greenhouse APIs, applies global title_filter
 * (positive keywords must match, negative keywords must not match) plus
 * per-company title_filter overrides for precision filtering.
 */
app.post('/api/scan', writeEndpointLimiter, async (req, res) => {
  try {
    const portalsPath = join(__dirname, 'portals.yml');
    const portalsContent = await readSafeAsync(portalsPath);

    if (!portalsContent) {
      return res.status(404).json({
        error: 'portals.yml not found.',
        hint: 'Run onboarding first: type "/career-os setup" in Claude Code, or copy templates/portals.example.yml to portals.yml.',
      });
    }

    // Parse global title_filter keywords from portals.yml
    const globalFilter = parseTitleFilter(portalsContent);

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
    let filteredOut = 0;

    // Read existing pipeline to avoid duplicates
    const pipelineContent = await readSafeAsync(PATHS.pipeline);
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

          // Per-company filter (legacy: inline title_filter on the company)
          const matchesCompanyFilter = company.filters.length === 0 || company.filters.some(f => title.includes(f));
          if (!matchesCompanyFilter) { filteredOut++; continue; }

          // Global title_filter: positive keywords (at least one must match)
          // and negative keywords (none must match)
          if (!matchesTitleFilter(title, globalFilter)) { filteredOut++; continue; }

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
      const currentPipeline = await readSafeAsync(PATHS.pipeline);
      await writeFile(PATHS.pipeline, currentPipeline + appendText);
      fileCache.invalidate(PATHS.pipeline);
    }

    log('INFO', `Scan complete: found ${results.length}, added ${added}, filtered out ${filteredOut} by title keywords`);
    res.json({ found: results.length, added, filteredOut, results });
  } catch (err) {
    log('ERROR', `POST /api/scan: ${err.message}`);
    res.status(500).json({ error: 'Scan failed', detail: err.message });
  }
});

/**
 * POST /api/pipeline/add -- Add a single entry to pipeline with URL dedup
 * Body: { url: string, company: string, title: string }
 */
app.post('/api/pipeline/add', writeEndpointLimiter, async (req, res) => {
  try {
    const { url, company, title } = req.body;
    if (!url || !company || !title) {
      return res.status(400).json({ error: 'url, company, and title are required' });
    }
    if (!url.startsWith('http')) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }

    const content = await readSafeAsync(PATHS.pipeline);
    // Check for duplicate URL
    const existingUrls = new Set();
    for (const line of content.split('\n')) {
      const m = line.match(/https?:\/\/\S+/);
      if (m) existingUrls.add(m[0]);
    }
    if (existingUrls.has(url)) {
      return res.json({ success: false, duplicate: true, message: `URL already in pipeline: ${url}` });
    }

    const newLine = `\n- [ ] ${url} | ${company} | ${title}`;
    await writeFile(PATHS.pipeline, content + newLine);
    fileCache.invalidate(PATHS.pipeline);
    log('INFO', `Added to pipeline: ${company} - ${title}`);
    res.json({ success: true, duplicate: false });
  } catch (err) {
    log('ERROR', `POST /api/pipeline/add: ${err.message}`);
    res.status(500).json({ error: 'Failed to add to pipeline', detail: err.message });
  }
});

/**
 * GET /api/pipeline/duplicates -- Find duplicate URLs in pipeline
 */
app.get('/api/pipeline/duplicates', async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.pipeline);
    const urlCounts = new Map();
    for (const line of content.split('\n')) {
      const m = line.match(/https?:\/\/\S+/);
      if (m) {
        urlCounts.set(m[0], (urlCounts.get(m[0]) || 0) + 1);
      }
    }
    const duplicates = [];
    for (const [url, count] of urlCounts) {
      if (count > 1) duplicates.push({ url, count });
    }
    res.json({ count: duplicates.length, duplicates });
  } catch (err) {
    log('ERROR', `GET /api/pipeline/duplicates: ${err.message}`);
    res.status(500).json({ error: 'Failed to check duplicates', detail: err.message });
  }
});

/**
 * GET /api/tracker/duplicates -- Find duplicate company+role entries in tracker
 */
app.get('/api/tracker/duplicates', async (req, res) => {
  try {
    const content = await readSafeAsync(PATHS.tracker);
    const rows = parseTracker(content);
    const seen = new Map();
    const duplicates = [];
    for (const row of rows) {
      const key = `${(row.company || '').toLowerCase().trim()}|${(row.role || '').toLowerCase().trim()}`;
      if (seen.has(key)) {
        duplicates.push({ num: row.num, company: row.company, role: row.role, duplicateOf: seen.get(key) });
      } else {
        seen.set(key, row.num);
      }
    }
    res.json({ count: duplicates.length, duplicates });
  } catch (err) {
    log('ERROR', `GET /api/tracker/duplicates: ${err.message}`);
    res.status(500).json({ error: 'Failed to check duplicates', detail: err.message });
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
app.post('/api/research', apiProxyLimiter, async (req, res) => {
  try {
    const { company } = req.body;
    if (!company) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured.', hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file, then restart the server.' });
    }

    const profileContent = await readSafeAsync(PATHS.profile);

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
      return res.status(502).json({ error: 'Anthropic API request failed.', hint: 'This usually means the API key is invalid, expired, or rate-limited. Check your ANTHROPIC_API_KEY in .env and try again.', detail: errBody });
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

app.get('/api/file/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const filePath = EDITABLE_FILES[name];
    if (!filePath) {
      return res.status(400).json({ error: `File "${name}" is not editable. Allowed: ${Object.keys(EDITABLE_FILES).join(', ')}` });
    }
    const content = await readSafeAsync(filePath);
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
app.put('/api/file/:name', writeEndpointLimiter, async (req, res) => {
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
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    // Limit file content to 500KB to prevent abuse
    if (content.length > 512 * 1024) {
      return res.status(400).json({ error: 'Content too large. Maximum 500KB.' });
    }
    await writeFile(filePath, content, 'utf-8');
    fileCache.invalidate(filePath);
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
app.post('/api/export-package', apiProxyLimiter, async (req, res) => {
  try {
    const { roleId } = req.body;
    if (!roleId) {
      return res.status(400).json({ error: 'roleId is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured.', hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file, then restart the server.' });
    }

    const [cv, articleDigest, trackerContent] = await Promise.all([
      readSafeAsync(PATHS.cv),
      readSafeAsync(PATHS.articleDigest),
      readSafeAsync(PATHS.tracker),
    ]);
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
      return res.status(502).json({ error: 'Anthropic API request failed.', hint: 'This usually means the API key is invalid, expired, or rate-limited. Check your ANTHROPIC_API_KEY in .env and try again.', detail: errBody });
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
 * GET /api/recommendations -- Smart, multi-signal recommendations.
 * Considers: score, tier, days since evaluation, materials generated,
 * application status, and pipeline freshness. Each recommendation gets
 * a composite priority score so the frontend can sort by impact.
 */
app.get('/api/recommendations', async (req, res) => {
  try {
    const [trackerContent, pipelineContent, reportsDir, scanContent] = await Promise.all([
      readSafeAsync(PATHS.tracker),
      readSafeAsync(PATHS.pipeline),
      readdir(PATHS.reportsDir).catch(() => []),
      readSafeAsync(PATHS.scanHistory),
    ]);
    const trackerRows = parseTracker(trackerContent);
    const pipelineEntries = parsePipeline(pipelineContent);
    const scanRows = parseScanHistory(scanContent);
    const today = new Date().toISOString().split('T')[0];

    // Build a set of companies that have reports (= materials generated)
    const reportSlugs = new Set();
    for (const f of reportsDir) {
      if (typeof f === 'string' && f.endsWith('.md')) {
        const match = f.match(/^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$/);
        if (match) reportSlugs.add(match[1].toLowerCase());
      }
    }

    const priorities = [];

    // 1. High-score evaluated but not applied -- weighted by score, tier, and age
    const evaluatedRows = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'evaluated';
    });

    for (const r of evaluatedRows) {
      const score = parseFloat(r.score) || 0;
      if (score < 3.0) continue; // Skip low-fit roles entirely

      const tier = classifyTier(r.role || '');
      const daysOld = r.date ? Math.round((Date.now() - new Date(r.date).getTime()) / 86400000) : 0;
      const companySlug = (r.company || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const hasMaterials = reportSlugs.has(companySlug);

      // Composite priority: higher score = better, c-suite > director > other,
      // fresher is better (decay factor), having materials means closer to ready
      let priority = score * 10;
      if (tier === 'c-suite') priority += 15;
      else if (tier === 'director') priority += 8;
      // Decay: lose 1 point per day after 7 days (stale evaluations need attention)
      if (daysOld > 7) priority -= (daysOld - 7) * 0.5;
      // Bonus for having materials already generated
      if (hasMaterials) priority += 5;

      const urgencyLabel = score >= 4.5 ? 'critical' : score >= 4.0 ? 'high' : 'medium';

      let reason = `Score ${r.score}`;
      if (tier === 'c-suite') reason += ' (C-suite)';
      else if (tier === 'director') reason += ' (Director-level)';
      reason += ' -- strong fit, application not yet submitted';
      if (daysOld > 7) reason += ` (evaluated ${daysOld} days ago, may be expiring)`;
      if (hasMaterials) reason += ' [materials ready]';
      else reason += ' [needs resume/cover letter]';

      priorities.push({
        company: r.company, title: r.role, score,
        tier, daysOld, hasMaterials,
        reason, urgency: urgencyLabel,
        priorityScore: Math.round(priority * 10) / 10,
      });
    }

    // 2. Responded/interview -- need follow-up (highest urgency)
    const needFollowUp = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'responded' || status === 'interview';
    });

    for (const r of needFollowUp) {
      const daysOld = r.date ? Math.round((Date.now() - new Date(r.date).getTime()) / 86400000) : 0;
      const isInterview = (r.status || '').toLowerCase() === 'interview';
      priorities.push({
        company: r.company, title: r.role,
        score: parseFloat(r.score) || 0,
        tier: classifyTier(r.role || ''),
        daysOld,
        hasMaterials: true,
        reason: isInterview
          ? `In interview process -- prepare thoroughly and follow up promptly`
          : `Company responded ${daysOld > 0 ? daysOld + ' days ago' : ''} -- maintain momentum`,
        urgency: 'critical',
        priorityScore: 100 + (isInterview ? 20 : 0), // Always at the top
      });
    }

    // 3. Applied > 5 days ago -- overdue follow-ups
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const overdueApps = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'applied' && r.date && r.date <= fiveDaysAgo;
    });

    for (const r of overdueApps) {
      const daysOld = Math.round((Date.now() - new Date(r.date).getTime()) / 86400000);
      priorities.push({
        company: r.company, title: r.role,
        score: parseFloat(r.score) || 0,
        tier: classifyTier(r.role || ''),
        daysOld,
        hasMaterials: true,
        reason: `Applied ${daysOld} days ago with no response -- send a follow-up email`,
        urgency: 'high',
        priorityScore: 70 + Math.min(daysOld, 20),
      });
    }

    // 4. Pipeline C-suite/director roles not yet evaluated
    const unevaluatedPipeline = pipelineEntries
      .filter(e => !e.done)
      .map(e => {
        const title = e.title || e.role || '';
        const tier = classifyTier(title);
        return { ...e, title, tier };
      })
      .filter(e => e.tier === 'c-suite' || e.tier === 'director')
      .slice(0, 5);

    for (const e of unevaluatedPipeline) {
      priorities.push({
        company: e.company || 'Unknown', title: e.title || 'Unknown Role',
        score: 0, tier: e.tier,
        daysOld: 0, hasMaterials: false,
        reason: `${e.tier === 'c-suite' ? 'C-suite' : 'Director-level'} pipeline entry awaiting evaluation`,
        urgency: 'medium',
        priorityScore: e.tier === 'c-suite' ? 45 : 30,
      });
    }

    // Sort all priorities by composite score (descending)
    priorities.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    // Generate weekly goals summary
    const appliedCount = trackerRows.filter(r => (r.status || '').toLowerCase() === 'applied').length;
    const interviewCount = needFollowUp.filter(r => (r.status || '').toLowerCase() === 'interview').length;
    const highScoreReady = evaluatedRows.filter(r => (parseFloat(r.score) || 0) >= 4.0).length;
    const lastScan = scanRows.length > 0 ? scanRows[scanRows.length - 1].date : null;
    const daysSinceScan = lastScan ? Math.round((Date.now() - new Date(lastScan).getTime()) / 86400000) : null;

    let weeklyGoals = `Focus areas: `;
    const goals = [];
    if (interviewCount > 0) goals.push(`${interviewCount} active interview${interviewCount > 1 ? 's' : ''} (top priority)`);
    if (overdueApps.length > 0) goals.push(`${overdueApps.length} follow-up${overdueApps.length > 1 ? 's' : ''} overdue`);
    if (highScoreReady > 0) goals.push(`${highScoreReady} high-score role${highScoreReady > 1 ? 's' : ''} ready to apply`);
    if (unevaluatedPipeline.length > 0) goals.push(`${unevaluatedPipeline.length} senior roles to evaluate`);
    if (daysSinceScan && daysSinceScan >= 3) goals.push(`scan is ${daysSinceScan} days stale`);
    weeklyGoals += goals.length > 0 ? goals.join(', ') : 'pipeline is in good shape';
    weeklyGoals += `. Target: 3-5 quality applications this week.`;

    res.json({
      priorities: priorities.slice(0, 15), // Cap at 15 recommendations
      weeklyGoals,
      stats: {
        totalTracked: trackerRows.length,
        applied: appliedCount,
        interviews: interviewCount,
        overdueFollowUps: overdueApps.length,
        pipelineSize: pipelineEntries.filter(e => !e.done).length,
        daysSinceScan,
      },
    });
  } catch (err) {
    log('ERROR', `GET /api/recommendations: ${err.message}`);
    res.status(500).json({ error: 'Recommendations failed', detail: err.message });
  }
});

/**
 * POST /api/stories -- Add a STAR story to interview-prep/story-bank.md
 * Body: { situation, task, action, result, reflection, tags }
 */
app.post('/api/stories', writeEndpointLimiter, async (req, res) => {
  try {
    const { situation, task, action, result, reflection, tags } = req.body;
    if (!situation || !task || !action || !result) {
      return res.status(400).json({ error: 'situation, task, action, and result are required' });
    }

    let content = await readSafeAsync(PATHS.storyBank);

    // If file is empty or doesn't exist, create the structure
    if (!content.trim()) {
      content = `# Story Bank (STAR+R)\n\n`;
    }

    // Append the new story
    const tagStr = tags ? `**Tags:** ${tags}\n` : '';
    const storyEntry = `\n## Story: ${situation.substring(0, 60)}\n\n${tagStr}**Situation:** ${situation}\n\n**Task:** ${task}\n\n**Action:** ${action}\n\n**Result:** ${result}\n\n**Reflection:** ${reflection || 'N/A'}\n\n---\n`;

    content += storyEntry;
    await writeFile(PATHS.storyBank, content, 'utf-8');

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
app.get('/api/memory', async (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  const defaultMemory = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
  const data = await readJsonSafeAsync(memoryPath, defaultMemory);
  res.json(data);
});

// POST /api/memory -- save a memory entry
app.post('/api/memory', writeEndpointLimiter, async (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  const defaultMemory = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
  const memories = await readJsonSafeAsync(memoryPath, defaultMemory);

  const { type, data } = req.body; // type: 'careerFact', 'preference', 'actionItem', 'conversation'

  // Validate type
  const validTypes = ['careerFact', 'preference', 'actionItem', 'conversation'];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
  }
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data must be an object' });
  }

  const today = new Date().toISOString().split('T')[0];
  let deduplicated = false;
  if (type === 'careerFact') {
    const content = data.content || '';
    if (isMemoryDuplicate(memories.careerFacts.map(f => f.content), content)) {
      deduplicated = true;
    } else {
      memories.careerFacts.push({ ...data, date: today });
    }
  } else if (type === 'preference') {
    // Replace existing preference with same key
    const key = data.key || '';
    const existingIdx = key ? memories.preferences.findIndex(p => p.key === key) : -1;
    if (existingIdx >= 0) {
      memories.preferences[existingIdx] = { ...data, date: today };
    } else {
      memories.preferences.push(data);
    }
  } else if (type === 'actionItem') {
    const action = data.action || '';
    if (isMemoryDuplicate(memories.actionItems.filter(a => a.status === 'pending').map(a => a.action), action)) {
      deduplicated = true;
    } else {
      memories.actionItems.push({ ...data, status: 'pending', date: today });
    }
  } else if (type === 'conversation') {
    memories.conversations.push({ ...data, date: today });
  }

  if (!deduplicated) {
    await writeFile(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
  }
  res.json({ success: true, deduplicated });
});

// POST /api/memory/extract -- use Claude to extract facts from conversation
app.post('/api/memory/extract', apiProxyLimiter, async (req, res) => {
  const { messages } = req.body; // array of { role, text }
  if (!messages?.length) return res.json({ facts: [], actions: [] });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({
    error: 'ANTHROPIC_API_KEY is not configured.',
    hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file, then restart the server.',
  });

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
    const defaultMemory = { careerFacts: [], preferences: [], actionItems: [], conversations: [] };
    const memories = await readJsonSafeAsync(memoryPath, defaultMemory);

    const today = new Date().toISOString().split('T')[0];
    let factsAdded = 0;
    let actionsAdded = 0;
    if (extracted.facts) {
      const existingContents = memories.careerFacts.map(f => f.content);
      for (const f of extracted.facts) {
        if (!isMemoryDuplicate(existingContents, f.content)) {
          memories.careerFacts.push({ ...f, date: today, applied: false });
          existingContents.push(f.content);
          factsAdded++;
        }
      }
    }
    if (extracted.actions) {
      const existingActions = memories.actionItems.filter(a => a.status === 'pending').map(a => a.action);
      for (const a of extracted.actions) {
        if (!isMemoryDuplicate(existingActions, a.action)) {
          memories.actionItems.push({ ...a, status: 'pending', date: today });
          existingActions.push(a.action);
          actionsAdded++;
        }
      }
    }

    await writeFile(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
    res.json({ extracted, saved: true, factsAdded, actionsAdded, deduplicatedFacts: (extracted.facts?.length || 0) - factsAdded, deduplicatedActions: (extracted.actions?.length || 0) - actionsAdded });
  } catch (err) {
    log('ERROR', `Memory extraction failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/memory/:index -- update action item status
app.patch('/api/memory/:index', writeEndpointLimiter, async (req, res) => {
  const memoryPath = join(ROOT, 'data', 'agent-memory.json');
  try {
    const memories = await readJsonSafeAsync(memoryPath, null);
    if (!memories) {
      return res.status(404).json({ error: 'Memory file not found' });
    }
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    if (memories.actionItems[idx]) {
      // Whitelist allowed fields to prevent prototype pollution
      const allowed = ['status', 'action', 'priority', 'date', 'notes'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          memories.actionItems[idx][key] = req.body[key];
        }
      }
      await writeFile(memoryPath, JSON.stringify(memories, null, 2), 'utf-8');
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Action item not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversation/save -- save conversation log (async to avoid blocking)
app.post('/api/conversation/save', writeEndpointLimiter, async (req, res) => {
  try {
    const { messages } = req.body;

    // Validate input
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array' });
    }
    if (messages.length === 0) {
      return res.status(400).json({ error: 'messages array must not be empty' });
    }
    // Cap messages per save to prevent abuse
    if (messages.length > 200) {
      return res.status(400).json({ error: 'Too many messages. Maximum 200 per save.' });
    }

    const today = new Date().toISOString().split('T')[0];
    const dir = join(ROOT, 'data', 'conversations');
    try { await mkdir(dir, { recursive: true }); } catch {}
    const filePath = join(dir, `${today}.json`);

    // Append to existing day's conversation
    let existing = [];
    try { existing = JSON.parse(await readFile(filePath, 'utf-8')); } catch {}
    existing.push(...messages);

    await writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    res.json({ success: true, count: existing.length });
  } catch (err) {
    log('ERROR', `POST /api/conversation/save: ${err.message}`);
    res.status(500).json({ error: 'Failed to save conversation', detail: err.message });
  }
});

// GET /api/conversation/latest -- get latest conversation (async to avoid blocking)
app.get('/api/conversation/latest', async (req, res) => {
  const dir = join(ROOT, 'data', 'conversations');
  let files;
  try {
    const dirFiles = await readdir(dir);
    files = dirFiles.filter(f => f.endsWith('.json')).sort().reverse();
  } catch {
    return res.json({ messages: [] });
  }
  if (!files.length) return res.json({ messages: [] });
  try {
    const content = await readFile(join(dir, files[0]), 'utf-8');
    const messages = JSON.parse(content);
    res.json({ date: files[0].replace('.json', ''), messages });
  } catch {
    res.json({ messages: [] });
  }
});

// ---------------------------------------------------------------------------
// POST /api/chat -- Text chat via Claude API with tool use
// Claude can call the same 13 tools as the voice agent.
// ---------------------------------------------------------------------------

const CLAUDE_TOOLS = [
  { name: 'scan_portals', description: 'Scan all configured job portals (Greenhouse APIs, tracked companies in portals.yml) to discover new matching offers. Adds new entries to data/pipeline.md. Use when the user asks to find new jobs, refresh the pipeline, or check for new postings.', input_schema: { type: 'object', properties: {} } },
  { name: 'evaluate_job', description: 'Evaluate a job description against the user profile using the 10-dimension Career-OS scoring system (North Star alignment, CV match, seniority, comp, growth, remote, reputation, tech stack, time-to-offer, culture). Accepts a URL to fetch or raw JD text. Returns score (1-5), summary, full report, and archetype. Use when the user pastes a job URL/description or asks you to assess a role.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'URL of the job posting to fetch and evaluate' }, text: { type: 'string', description: 'Raw job description text if no URL available' } } } },
  { name: 'generate_resume', description: 'Generate an ATS-optimized, tailored resume in markdown for a specific company and role. Uses cv.md and article-digest.md as source material and adapts emphasis to match the target role. Use when the user asks for a resume, CV, or application materials.', input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Target company name' }, role: { type: 'string', description: 'Target role title' } }, required: ['company'] } },
  { name: 'generate_cover_letter', description: 'Generate a concise, compelling cover letter (max 400 words) connecting the user experience to a specific role. Leads with value, uses proof points and metrics. Use when the user asks for a cover letter or application letter.', input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Target company name' }, role: { type: 'string', description: 'Target role title' } }, required: ['company'] } },
  { name: 'draft_email', description: 'Draft a professional email for job search communication: follow-ups after applying, thank-you notes after interviews, responses to recruiters, cold outreach, or networking messages. Use when the user asks to write or draft any email related to their job search.', input_schema: { type: 'object', properties: { recipient: { type: 'string', description: 'Who the email is to (name, title, or role like "recruiter")' }, purpose: { type: 'string', description: 'Purpose: follow-up, thank-you, cold-outreach, response, networking, negotiation, etc.' }, company: { type: 'string', description: 'Company name for context' } }, required: ['purpose'] } },
  { name: 'verify_listing', description: 'Check whether a specific job listing URL is still active or has been taken down/filled. Fetches the page and checks for closed indicators (e.g., "position has been filled") vs active indicators (e.g., "Apply Now"). Use when the user asks if a job is still open.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL of the job posting to verify' } }, required: ['url'] } },
  { name: 'research_company', description: 'Deep-dive research on a company: AI strategy, engineering culture, recent news, Glassdoor sentiment estimate, and a strategic angle for how the user should position themselves. Use when the user asks about a company, wants to prepare for an interview, or wants competitive intelligence.', input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Company name to research' } }, required: ['company'] } },
  { name: 'update_application_status', description: 'Update the status of a tracked application in data/applications.md. Finds the application by company name and sets the new canonical status. Use when the user reports progress (e.g., "I applied to Google", "got rejected from Meta", "have an interview at OpenAI").', input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Company name to find in the tracker' }, status: { type: 'string', description: 'New status', enum: ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'] } }, required: ['company', 'status'] } },
  { name: 'save_memory', description: 'Save an important career fact, user preference, or action item to persistent memory (data/agent-memory.json). Career facts persist across sessions and appear in the system prompt. Use proactively when the user shares new information about their career, preferences, or tasks to remember.', input_schema: { type: 'object', properties: { type: { type: 'string', description: 'Category of memory', enum: ['careerFact','preference','actionItem'] }, content: { type: 'string', description: 'What to remember (be specific and concise)' } }, required: ['type', 'content'] } },
  { name: 'add_story', description: 'Add a STAR+R (Situation, Task, Action, Result + Reflection) interview story to the story bank (interview-prep/story-bank.md). These stories are used for interview preparation and roleplay. Use when the user shares an accomplishment, experience, or asks to build their story library.', input_schema: { type: 'object', properties: { situation: { type: 'string', description: 'The context/background of the situation' }, task: { type: 'string', description: 'The challenge or responsibility' }, action: { type: 'string', description: 'Specific actions taken (use "I" not "we")' }, result: { type: 'string', description: 'Quantified outcomes and impact' }, reflection: { type: 'string', description: 'Lessons learned or what you would do differently' } }, required: ['situation','task','action','result'] } },
  { name: 'get_pipeline', description: 'Get the current pipeline of job offers from data/pipeline.md. Returns count and top 5 entries with company, title, and tier (c-suite/director/other). Use when the user asks what jobs are in their pipeline or wants to see available opportunities.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_tracker', description: 'Get the current applications tracker from data/applications.md. Returns count and up to 10 entries with company, role, status, and score. Use when the user asks about their application status, progress, or tracked roles.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_recommendations', description: 'Get smart, prioritized recommendations based on current pipeline and tracker state. Identifies high-score unapplied roles, pending follow-ups, and C-suite pipeline entries. Use when the user asks what to focus on, wants guidance, or says "what should I do next?"', input_schema: { type: 'object', properties: {} } },
];

app.post('/api/chat', apiProxyLimiter, async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({
    error: 'Message is required.',
    hint: 'Send a JSON body with { "message": "your question", "history": [] }.',
  });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({
    error: 'ANTHROPIC_API_KEY is not configured.',
    hint: 'Add ANTHROPIC_API_KEY=sk-ant-... to your .env file in the project root, then restart the server.',
  });

  // Build context (async parallel reads)
  const chatMemoryPath = join(ROOT, 'data', 'agent-memory.json');
  const [cvContent, chatPipelineContent, chatTrackerContent, memories] = await Promise.all([
    readSafeAsync(join(ROOT, 'cv.md')).then(c => c.slice(0, 3000)),
    readSafeAsync(PATHS.pipeline),
    readSafeAsync(PATHS.tracker),
    readJsonSafeAsync(chatMemoryPath, { careerFacts: [], preferences: [], actionItems: [] }),
  ]);
  const pipelineCount = (chatPipelineContent.match(/^- \[/gm) || []).length;
  const appCount = (chatTrackerContent.match(/^\|\s*\d+/gm) || []).length;

  // Conversation summarization: when history exceeds 20 messages,
  // summarize older messages into a compact context block so the model
  // retains context without hitting token limits.
  let conversationSummary = '';
  let recentHistory = [];
  if (history && Array.isArray(history) && history.length > 20) {
    const olderMessages = history.slice(0, -10);
    recentHistory = history.slice(-10);
    // Build a compact summary of older messages
    conversationSummary = summarizeConversationHistory(olderMessages);
  } else if (history && Array.isArray(history)) {
    recentHistory = history.slice(-10);
  }

  const systemPrompt = `You are Career-OS, Stephen C. Webster's AI career coach. Direct, warm, action-oriented.

TOOLS: You have 13 tools. Use them IMMEDIATELY when Stephen asks you to do something -- do not describe what you would do; do it.

TOOL ROUTING:
- Job URL or description pasted -> evaluate_job
- "Find jobs" / "Scan" / "What's new?" -> scan_portals
- "Resume for X" / "CV for X" -> generate_resume
- "Cover letter for X" -> generate_cover_letter
- "Draft email" / "Follow up" / "Thank you" -> draft_email
- "Is this still open?" -> verify_listing
- "Tell me about [company]" / "Research X" -> research_company
- "I applied" / "Got rejected" / status change -> update_application_status
- Shares new career fact -> save_memory (proactively, without asking)
- Shares accomplishment with STAR elements -> add_story
- "What's in my pipeline?" -> get_pipeline
- "Show tracker" / "My applications" -> get_tracker
- "What should I do?" / "Priorities" -> get_recommendations

STEPHEN'S BACKGROUND:
${cvContent.slice(0, 2000)}

CURRENT STATUS: ${pipelineCount} offers in pipeline, ${appCount} applications tracked. Targeting CAIO, VP of AI, CTO. Target comp: $200K+ base.

${memories.careerFacts?.length ? 'KNOWN FACTS:\n' + memories.careerFacts.map(f => '- ' + f.content).join('\n') : ''}
${memories.actionItems?.filter(a => a.status === 'pending').length ? 'PENDING ACTIONS:\n' + memories.actionItems.filter(a => a.status === 'pending').map(a => '- ' + a.action).join('\n') : ''}
${conversationSummary ? '\nEARLIER CONVERSATION CONTEXT:\n' + conversationSummary : ''}

RULES:
- Call tools immediately. Never say "I can't" -- you can.
- Do not ask for permission unless the request is genuinely ambiguous.
- When Stephen shares a career fact or preference, save it with save_memory proactively.
- Keep responses concise. Lead with the action or answer, then explain briefly if needed.
- If a tool call fails, explain the error and suggest a specific fix.
- When multiple tools are needed (e.g., research + generate), chain them in sequence.`;

  // Build messages from recent history (last 10 messages + current)
  const messages = [];
  for (const msg of recentHistory) {
    messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text || msg.content || '' });
  }
  messages.push({ role: 'user', content: message });

  try {
    // Tool use loop -- Claude may call tools, we execute and continue
    let toolResults = [];
    let actionsTaken = [];
    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const body = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        tools: CLAUDE_TOOLS,
        messages
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const err = await response.text();
        log('ERROR', `Claude API error: ${response.status} ${err.slice(0, 200)}`);
        return res.status(500).json({ error: 'Claude API error: ' + response.status });
      }

      const data = await response.json();

      // Check if Claude wants to use tools
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      const textBlocks = (data.content || []).filter(b => b.type === 'text');

      if (toolUseBlocks.length === 0 || data.stop_reason !== 'tool_use') {
        // No more tools -- return the text response
        const text = textBlocks.map(b => b.text).join('\n') || 'Done.';
        return res.json({ response: text, actions: actionsTaken });
      }

      // Execute each tool call
      messages.push({ role: 'assistant', content: data.content });
      const toolResultContent = [];

      for (const tool of toolUseBlocks) {
        log('INFO', `Chat tool call: ${tool.name}(${JSON.stringify(tool.input).slice(0, 80)})`);
        actionsTaken.push(tool.name);
        const result = await executeToolCall(tool.name, tool.input || {});
        const isError = result && typeof result === 'object' && 'error' in result;
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(result).slice(0, 4000),
          ...(isError ? { is_error: true } : {}),
        });
        if (isError) {
          log('WARN', `Chat tool ${tool.name} returned error: ${result.error}`);
        }
      }

      messages.push({ role: 'user', content: toolResultContent });
    }

    // If we hit max rounds, return what we have
    res.json({ response: 'Completed ' + actionsTaken.length + ' actions: ' + actionsTaken.join(', '), actions: actionsTaken, truncated: true });
  } catch (err) {
    log('ERROR', `Chat error: ${err.message}`);
    res.status(500).json({ error: 'Chat request failed.', hint: 'This may be a temporary API issue. Try again in a few seconds. If it persists, check that your ANTHROPIC_API_KEY is valid.', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes -- Morning Briefing
// ---------------------------------------------------------------------------

/**
 * GET /api/briefing -- Daily morning briefing with pipeline summary,
 * overdue follow-ups, action items, recommendations, and smart suggestion.
 */
app.get('/api/briefing', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Pipeline data (async)
    const [pipelineContent, scanContent, trackerContent] = await Promise.all([
      readSafeAsync(PATHS.pipeline),
      readSafeAsync(PATHS.scanHistory),
      readSafeAsync(PATHS.tracker),
    ]);
    const pipelineEntries = parsePipeline(pipelineContent);
    const cSuite = pipelineEntries.filter(e => {
      const title = (e.title || e.role || '').toLowerCase();
      return /\b(vp|vice president|chief|caio|cto|cio|coo|ceo|svp|evp|president)\b/.test(title);
    }).length;
    const director = pipelineEntries.filter(e => {
      const title = (e.title || e.role || '').toLowerCase();
      return /\b(director|head of|principal)\b/.test(title) && !/\b(vp|vice president|chief|caio|cto|cio|coo|ceo|svp|evp|president)\b/.test(title);
    }).length;

    // Count offers added in the last 24 hours (approximate by checking scan history)
    const scanRows = parseScanHistory(scanContent);
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const new24h = scanRows.filter(r => r.date >= yesterday).length;

    // Stale pipeline entries: calculate days since newest entry
    const staleDays = scanRows.length > 0
      ? Math.max(0, Math.round((Date.now() - new Date(scanRows[scanRows.length - 1].date || today).getTime()) / 86400000))
      : 7;

    // 2. Tracker data
    const trackerRows = parseTracker(trackerContent);

    // Overdue follow-ups: Applied > 5 days ago
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const overdueFollowUps = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'applied' && r.date && r.date <= fiveDaysAgo;
    }).map(r => ({
      company: r.company,
      role: r.role,
      date: r.date,
      daysAgo: Math.round((Date.now() - new Date(r.date).getTime()) / 86400000),
    }));

    // Upcoming interviews
    const upcomingInterviews = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'interview';
    }).map(r => ({
      company: r.company,
      role: r.role,
      date: r.date,
    }));

    // Recent activity (last 5 tracker entries by date)
    const recentActivity = trackerRows
      .filter(r => r.date)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5)
      .map(r => ({
        company: r.company,
        role: r.role,
        status: r.status,
        date: r.date,
      }));

    // 3. Agent memory (action items) -- async
    const memoryPath = join(ROOT, 'data', 'agent-memory.json');
    const memories = await readJsonSafeAsync(memoryPath, { careerFacts: [], preferences: [], actionItems: [], conversations: [] });
    const actionItems = (memories.actionItems || []).filter(a => a.status === 'pending').map(a => ({
      action: a.action || '',
      date: a.date || '',
      status: a.status || 'pending',
    }));

    // 4. Scan history -- last scan date
    const sortedScans = scanRows.filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
    const lastScan = sortedScans.length > 0 ? sortedScans[0].date : null;
    const daysSinceLastScan = lastScan
      ? Math.round((Date.now() - new Date(lastScan).getTime()) / 86400000)
      : null;

    // 5. Recommendations (reuse logic from /api/recommendations)
    const recommendations = [];
    const highScoreUnapplied = trackerRows
      .filter(r => {
        const score = parseFloat(r.score) || 0;
        const status = (r.status || '').toLowerCase();
        return score >= 4.0 && status === 'evaluated';
      })
      .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0))
      .slice(0, 3);
    for (const r of highScoreUnapplied) {
      recommendations.push({
        company: r.company, title: r.role,
        reason: `Score ${r.score} -- strong fit, not yet applied`,
        urgency: 'high',
      });
    }
    const csuiteInPipeline = pipelineEntries
      .filter(e => {
        const title = (e.title || e.role || '').toLowerCase();
        return /\b(vp|chief|caio|cto|cio)\b/.test(title) && !e.done;
      })
      .slice(0, 3);
    for (const e of csuiteInPipeline) {
      recommendations.push({
        company: e.company || 'Unknown', title: e.title || e.role || 'C-Suite Role',
        reason: 'C-suite pipeline entry awaiting evaluation',
        urgency: 'medium',
      });
    }

    // 6. Dynamic suggestion (async)
    const profileContent = await readSafeAsync(PATHS.profile);
    const profileFlat = parseSimpleYaml(profileContent);
    const firstName = (profileFlat['candidate.full_name'] || 'there').split(' ')[0];
    const hour = new Date().getHours();
    const greetingTime = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const greeting = `${greetingTime}, ${firstName}.`;

    let suggestion = '';
    if (upcomingInterviews.length > 0) {
      const next = upcomingInterviews[0];
      suggestion = `Prep for your ${next.company} interview${next.date ? ' (' + next.date + ')' : ''}. Review your STAR stories and company research.`;
    } else if (overdueFollowUps.length > 0) {
      suggestion = `You have ${overdueFollowUps.length} follow-up${overdueFollowUps.length > 1 ? 's' : ''} overdue. Send a brief check-in to keep the conversation alive.`;
    } else if (trackerRows.length === 0 && pipelineEntries.length > 0) {
      suggestion = `You have ${pipelineEntries.length.toLocaleString()} offers in pipeline but 0 applications. Focus on evaluating the top VP/CAIO roles this week.`;
    } else if (trackerRows.length > 0 && overdueFollowUps.length === 0) {
      suggestion = `Strong start -- keep the momentum. Consider evaluating ${Math.min(5, csuiteInPipeline.length)} more C-suite roles from your pipeline.`;
    } else {
      suggestion = `Your pipeline has ${pipelineEntries.length.toLocaleString()} offers. Run a scan to discover new roles, then evaluate the top matches.`;
    }

    res.json({
      date: today,
      greeting,
      pipeline: {
        total: pipelineEntries.length,
        cSuite,
        director,
        new24h,
        staleDays,
      },
      tracker: {
        total: trackerRows.length,
        overdueFollowUps,
        upcomingInterviews,
        recentActivity,
      },
      actionItems,
      recommendations,
      lastScan,
      daysSinceLastScan,
      suggestion,
    });
  } catch (err) {
    log('ERROR', `GET /api/briefing: ${err.message}`);
    res.status(500).json({ error: 'Briefing generation failed', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes -- Workflow Chains
// ---------------------------------------------------------------------------

/**
 * POST /api/workflow/full-pipeline -- Scan, evaluate top N, generate materials for best.
 * Body: { count: 5 }
 */
app.post('/api/workflow/full-pipeline', apiProxyLimiter, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 5, 10);
    const base = `http://localhost:${PORT}`;

    // Step 1: Scan
    log('INFO', `[Workflow] Full pipeline: scanning portals...`);
    let scanned = { found: 0, added: 0 };
    try {
      const scanRes = await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      scanned = await scanRes.json();
    } catch (e) {
      log('WARN', `[Workflow] Scan failed: ${e.message}`);
    }

    // Step 2: Read pipeline and pick top N by tier
    const pipelineContent = await readSafeAsync(PATHS.pipeline);
    const entries = parsePipeline(pipelineContent).filter(e => !e.done);
    const sorted = entries.sort((a, b) => {
      const tierOrder = { 'c-suite': 0, 'director': 1, 'other': 2 };
      const ta = a.tier || classifyTier(a.title || a.role || '');
      const tb = b.tier || classifyTier(b.title || b.role || '');
      return (tierOrder[ta] || 2) - (tierOrder[tb] || 2);
    });
    const topN = sorted.slice(0, count);

    // Step 3: Evaluate each
    log('INFO', `[Workflow] Evaluating top ${topN.length} offers...`);
    const evaluated = [];
    for (const entry of topN) {
      try {
        const evalRes = await fetch(`${base}/api/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: entry.url || '', text: `${entry.company} - ${entry.title || entry.role}` }),
        });
        const evalData = await evalRes.json();
        evaluated.push({
          company: entry.company || 'Unknown',
          role: entry.title || entry.role || 'Unknown',
          score: evalData.score || 0,
          summary: evalData.summary || '',
        });
      } catch (e) {
        log('WARN', `[Workflow] Evaluate failed for ${entry.company}: ${e.message}`);
        evaluated.push({ company: entry.company || 'Unknown', role: entry.title || entry.role || '', score: 0, summary: 'Evaluation failed' });
      }
    }

    // Step 4: Generate materials for top 3 by score
    log('INFO', `[Workflow] Generating materials for top 3 by score...`);
    const topByScore = [...evaluated].sort((a, b) => b.score - a.score).slice(0, 3);
    const materials = [];
    for (const entry of topByScore) {
      if (entry.score < 2.0) continue;
      try {
        const resumeRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'resume', context: `${entry.company} - ${entry.role}` }),
        });
        const resumeData = await resumeRes.json();
        const coverRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'cover-letter', context: `${entry.company} - ${entry.role}` }),
        });
        const coverData = await coverRes.json();
        materials.push({
          company: entry.company,
          role: entry.role,
          resume: resumeData.content || '',
          coverLetter: coverData.content || '',
        });
      } catch (e) {
        log('WARN', `[Workflow] Material generation failed for ${entry.company}: ${e.message}`);
      }
    }

    log('INFO', `[Workflow] Full pipeline complete: scanned=${scanned.found}, evaluated=${evaluated.length}, materials=${materials.length}`);
    res.json({ scanned, evaluated, materials });
  } catch (err) {
    log('ERROR', `POST /api/workflow/full-pipeline: ${err.message}`);
    res.status(500).json({ error: 'Full pipeline workflow failed', detail: err.message });
  }
});

/**
 * POST /api/workflow/interview-prep -- Complete interview prep package.
 * Body: { company: string, role: string }
 *
 * Returns: company research, general interview prep, company-specific
 * behavioral questions based on company culture + candidate background,
 * and relevant STAR stories from the story bank.
 */
app.post('/api/workflow/interview-prep', apiProxyLimiter, async (req, res) => {
  try {
    const { company, role } = req.body;
    if (!company) return res.status(400).json({
      error: 'Company name is required.',
      hint: 'Send { "company": "Anthropic", "role": "Solutions Architect" }',
    });

    const base = `http://localhost:${PORT}`;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Step 1: Research company
    log('INFO', `[Workflow] Interview prep: researching ${company}...`);
    let research = {};
    try {
      const researchRes = await fetch(`${base}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
      research = await researchRes.json();
    } catch (e) {
      log('WARN', `[Workflow] Research failed: ${e.message}`);
    }

    // Step 2: Generate interview prep (general technical + behavioral)
    log('INFO', `[Workflow] Generating interview prep for ${company}...`);
    let prepContent = '';
    try {
      const prepRes = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'interview-prep', context: `${company} - ${role || 'Unknown Role'}` }),
      });
      const prepData = await prepRes.json();
      prepContent = prepData.content || '';
    } catch (e) {
      log('WARN', `[Workflow] Prep generation failed: ${e.message}`);
    }

    // Step 3: Generate company-specific behavioral questions
    // Uses the research data (culture, AI strategy) + candidate CV to
    // generate questions that probe fit for THIS specific company.
    let behavioralQuestions = [];
    if (apiKey && (research.culture || research.aiStrategy)) {
      log('INFO', `[Workflow] Generating company-specific behavioral questions for ${company}...`);
      try {
        const cvContent = await readSafeAsync(PATHS.cv);
        const behavioralPrompt = `You are an interview coach. Based on this company's culture and the candidate's background, generate 8 behavioral interview questions that this company would likely ask. For each question, provide a brief coaching note on which STAR story elements to emphasize.

COMPANY: ${company}
ROLE: ${role || 'Senior role'}
COMPANY CULTURE: ${research.culture || 'Unknown'}
COMPANY AI STRATEGY: ${research.aiStrategy || 'Unknown'}
COMPANY ANGLE: ${research.angle || 'Unknown'}

CANDIDATE BACKGROUND (key points):
${cvContent.substring(0, 2000)}

Return ONLY a JSON array of objects: [{"question": "...", "coachingNote": "...", "category": "leadership|technical|culture-fit|conflict|growth"}]`;

        const behavRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: behavioralPrompt }],
          }),
        });

        if (behavRes.ok) {
          const behavData = await behavRes.json();
          const rawText = behavData.content?.[0]?.text || '';
          try {
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            behavioralQuestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          } catch {
            behavioralQuestions = [];
          }
        }
      } catch (e) {
        log('WARN', `[Workflow] Behavioral questions generation failed: ${e.message}`);
      }
    }

    // Step 4: Pull relevant STAR stories
    const storyContent = await readSafeAsync(PATHS.storyBank);
    const storySections = parseMdSections(storyContent);
    const stories = storySections.filter(s => s.level === 2).map(s => ({
      title: s.title,
      body: s.body.substring(0, 300),
    }));

    res.json({
      company,
      role: role || '',
      research,
      prepContent,
      behavioralQuestions,
      stories,
    });
  } catch (err) {
    log('ERROR', `POST /api/workflow/interview-prep: ${err.message}`);
    res.status(500).json({ error: 'Interview prep workflow failed', detail: err.message });
  }
});

/**
 * POST /api/workflow/follow-up-batch -- Generate follow-up drafts for overdue applications.
 */
app.post('/api/workflow/follow-up-batch', apiProxyLimiter, async (req, res) => {
  try {
    const base = `http://localhost:${PORT}`;
    const trackerContent = await readSafeAsync(PATHS.tracker);
    const trackerRows = parseTracker(trackerContent);

    // Find overdue: Applied > 5 days ago
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const overdue = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'applied' && r.date && r.date <= fiveDaysAgo;
    });

    if (overdue.length === 0) {
      return res.json({ drafts: [], message: 'No overdue follow-ups found.' });
    }

    log('INFO', `[Workflow] Generating follow-up drafts for ${overdue.length} overdue applications...`);
    const drafts = [];
    for (const app of overdue.slice(0, 10)) { // Cap at 10
      try {
        const daysAgo = Math.round((Date.now() - new Date(app.date).getTime()) / 86400000);
        const genRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'email-draft',
            context: `Follow-up email for ${app.company} - ${app.role}. Applied ${daysAgo} days ago on ${app.date}. Brief, professional check-in to express continued interest.`,
          }),
        });
        const genData = await genRes.json();
        drafts.push({
          company: app.company,
          role: app.role,
          date: app.date,
          daysAgo,
          draft: genData.content || '',
        });
      } catch (e) {
        log('WARN', `[Workflow] Follow-up draft failed for ${app.company}: ${e.message}`);
      }
    }

    res.json({ drafts, count: drafts.length });
  } catch (err) {
    log('ERROR', `POST /api/workflow/follow-up-batch: ${err.message}`);
    res.status(500).json({ error: 'Follow-up batch failed', detail: err.message });
  }
});

// classifyTier -- imported from lib/parsers.mjs

// ---------------------------------------------------------------------------
// API Routes -- Proactive Notifications
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications -- Returns active notifications based on system state.
 */
app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = [];
    let nextId = 1;

    const [trackerContent, pipelineContent, scanContent] = await Promise.all([
      readSafeAsync(PATHS.tracker),
      readSafeAsync(PATHS.pipeline),
      readSafeAsync(PATHS.scanHistory),
    ]);
    const trackerRows = parseTracker(trackerContent);
    const pipelineEntries = parsePipeline(pipelineContent);
    const scanRows = parseScanHistory(scanContent);

    // 1. Overdue follow-ups (Applied > 5 days ago)
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const overdueApps = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'applied' && r.date && r.date <= fiveDaysAgo;
    });
    for (const app of overdueApps) {
      const daysAgo = Math.round((Date.now() - new Date(app.date).getTime()) / 86400000);
      notifications.push({
        id: String(nextId++),
        type: 'overdue',
        severity: 'warning',
        title: 'Follow-up overdue',
        body: `${app.company} application is ${daysAgo} days old`,
        action: 'draft_email',
        actionData: { company: app.company, role: app.role },
      });
    }

    // 2. Stale pipeline offers (> 7 days old unverified)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const staleCount = pipelineEntries.filter(e => !e.done && !e.verified).length;
    const sortedScans = scanRows.filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
    const lastScanDate = sortedScans.length > 0 ? sortedScans[0].date : null;
    if (staleCount > 20 && lastScanDate && lastScanDate <= sevenDaysAgo) {
      notifications.push({
        id: String(nextId++),
        type: 'stale',
        severity: 'info',
        title: 'Listings aging',
        body: `${staleCount} pipeline offers are 7+ days old and unverified`,
        action: 'verify_all',
        actionData: {},
      });
    }

    // 3. No scan in 3+ days
    if (!lastScanDate || lastScanDate <= new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]) {
      const daysSince = lastScanDate ? Math.round((Date.now() - new Date(lastScanDate).getTime()) / 86400000) : null;
      notifications.push({
        id: String(nextId++),
        type: 'no_scan',
        severity: 'info',
        title: 'Time to scan',
        body: daysSince ? `Last scan was ${daysSince} days ago` : 'No scans recorded yet',
        action: 'run_scan',
        actionData: {},
      });
    }

    // 4. Pipeline offers but 0 applications
    if (pipelineEntries.length > 0 && trackerRows.length === 0) {
      notifications.push({
        id: String(nextId++),
        type: 'no_apps',
        severity: 'info',
        title: 'No applications yet',
        body: `${pipelineEntries.length.toLocaleString()} offers in pipeline but none evaluated. Start with the top C-suite roles.`,
        action: 'workflow_pipeline',
        actionData: {},
      });
    }

    // 5. Interview within 48 hours
    const twoDaysFromNow = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const upcomingInterviews = trackerRows.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status === 'interview';
    });
    for (const iv of upcomingInterviews) {
      notifications.push({
        id: String(nextId++),
        type: 'interview_soon',
        severity: 'warning',
        title: 'Interview tracked',
        body: `${iv.company} -- ${iv.role} is in interview stage. Ensure you are prepared.`,
        action: 'interview_prep',
        actionData: { company: iv.company, role: iv.role },
      });
    }

    // 6. Pending action items from memory (async)
    const memoryPath = join(ROOT, 'data', 'agent-memory.json');
    const memories = await readJsonSafeAsync(memoryPath, { careerFacts: [], preferences: [], actionItems: [], conversations: [] });
    const pendingActions = (memories.actionItems || []).filter(a => a.status === 'pending');
    if (pendingActions.length > 0) {
      notifications.push({
        id: String(nextId++),
        type: 'action_pending',
        severity: 'info',
        title: `${pendingActions.length} pending action${pendingActions.length > 1 ? 's' : ''}`,
        body: pendingActions.slice(0, 3).map(a => a.action).join('; '),
        action: 'view_actions',
        actionData: {},
      });
    }

    // 7. Smart suggestion: high-score unapplied
    const highScoreUnapplied = trackerRows.filter(r => {
      const score = parseFloat(r.score) || 0;
      return score >= 4.0 && (r.status || '').toLowerCase() === 'evaluated';
    });
    if (highScoreUnapplied.length > 0) {
      notifications.push({
        id: String(nextId++),
        type: 'suggestion',
        severity: 'info',
        title: `${highScoreUnapplied.length} high-score role${highScoreUnapplied.length > 1 ? 's' : ''} unapplied`,
        body: `${highScoreUnapplied[0].company} (${highScoreUnapplied[0].score}) and ${highScoreUnapplied.length - 1} more scored 4.0+ but have not been applied to`,
        action: 'view_tracker',
        actionData: {},
      });
    }

    res.json({ notifications });
  } catch (err) {
    log('ERROR', `GET /api/notifications: ${err.message}`);
    res.status(500).json({ error: 'Notifications failed', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback -- send index.html for any unmatched GET request
// ---------------------------------------------------------------------------

app.get('/{*splat}', async (req, res) => {
  const indexPath = join(PATHS.publicDir, 'index.html');
  try {
    await access(indexPath);
    res.sendFile(indexPath);
  } catch {
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

// WebSocket connection rate limiting (per-IP, max 5 connections per minute)
const wsConnectionTimestamps = new Map();
const WS_CONN_WINDOW_MS = 60_000;
const WS_CONN_MAX = 5;
// Maximum incoming WebSocket message size (1MB)
const WS_MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

wss.on('connection', (clientWs, request) => {
  // Connection rate limiting
  const clientIp = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let timestamps = wsConnectionTimestamps.get(clientIp) || [];
  timestamps = timestamps.filter(t => t > now - WS_CONN_WINDOW_MS);
  if (timestamps.length >= WS_CONN_MAX) {
    log('WARN', `WebSocket connection rate limit exceeded for ${clientIp}`);
    clientWs.close(1008, 'Too many connections. Try again later.');
    return;
  }
  timestamps.push(now);
  wsConnectionTimestamps.set(clientIp, timestamps);

  // Periodic cleanup of stale IP entries
  if (wsConnectionTimestamps.size > 50) {
    for (const [ip, ts] of wsConnectionTimestamps) {
      const fresh = ts.filter(t => t > now - WS_CONN_WINDOW_MS);
      if (fresh.length === 0) wsConnectionTimestamps.delete(ip);
      else wsConnectionTimestamps.set(ip, fresh);
    }
  }

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

  geminiWs.on('open', async () => {
    log('INFO', 'Connected to Gemini Live API');

    // Send initial setup message with system instruction (async)
    const systemInstruction = await buildSystemInstruction();
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
        tools: GEMINI_TOOLS,
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
  geminiWs.on('message', async (data) => {
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
        // Handle tool calls from Gemini
        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            log('INFO', `Gemini tool call: ${call.name}`);
            // Notify client that an action is being taken
            clientWs.send(JSON.stringify({ type: 'action', name: call.name, args: call.args }));
            // Execute the tool
            const result = await executeToolCall(call.name, call.args || {});
            // Send result back to Gemini
            const toolResponse = {
              toolResponse: {
                functionResponses: [{
                  name: call.name,
                  id: call.id,
                  response: result
                }]
              }
            };
            geminiWs.send(JSON.stringify(toolResponse));
            // Also notify client of the result
            clientWs.send(JSON.stringify({ type: 'actionResult', name: call.name, result }));
          }
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
    // Enforce message size limit
    const msgSize = typeof data === 'string' ? data.length : data.byteLength || 0;
    if (msgSize > WS_MAX_MESSAGE_SIZE) {
      log('WARN', `WebSocket message too large (${msgSize} bytes), dropping`);
      clientWs.send(JSON.stringify({ type: 'error', error: 'Message too large. Maximum 1MB.' }));
      return;
    }
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

// Catch unhandled errors to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  log('ERROR', `Unhandled promise rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught exception: ${err.message}\n${err.stack}`);
  // Allow existing connections to finish, then exit
  server.close(() => process.exit(1));
  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => process.exit(1), 5000).unref();
});
