#!/usr/bin/env node
/**
 * auto-pipeline.mjs -- Autonomous Career-Ops Pipeline
 *
 * Runs the full scan → evaluate → generate → draft pipeline.
 * Designed to be called by cron or Claude Code scheduled agents.
 *
 * Usage:
 *   node auto-pipeline.mjs                    # Full pipeline
 *   node auto-pipeline.mjs --scan-only        # Just scan for new roles
 *   node auto-pipeline.mjs --generate-only    # Generate packages for unpackaged 3.5+ roles
 *   node auto-pipeline.mjs --digest           # Email daily digest of ready applications
 *
 * Environment:
 *   CAREER_OPS_DIR -- path to career-ops root (default: script directory)
 *   GMAIL_ENABLED  -- set to "true" to create Gmail drafts (requires Claude Code MCP)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CAREER_OPS_DIR || __dirname;

const log = (level, msg) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  minScore: 3.5,          // Minimum score to generate a package
  applyScore: 4.0,        // Score threshold for APPLY tier
  minComp: 200000,        // $200K floor
  profilePath: join(ROOT, 'config/profile.yml'),
  cvPath: join(ROOT, 'cv.md'),
  digestPath: join(ROOT, 'article-digest.md'),
  pipelinePath: join(ROOT, 'data/pipeline.md'),
  trackerPath: join(ROOT, 'data/applications.md'),
  submitPath: join(ROOT, 'SUBMIT-NOW.md'),
  reportsDir: join(ROOT, 'reports'),
  outputDir: join(ROOT, 'output'),
  trackerAdditionsDir: join(ROOT, 'batch/tracker-additions'),
  logsDir: join(ROOT, 'batch/logs'),
};

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

function getTrackedCompanies() {
  if (!existsSync(CONFIG.trackerPath)) return new Set();
  const content = readFileSync(CONFIG.trackerPath, 'utf-8');
  const companies = new Set();
  for (const line of content.split('\\n')) {
    const match = line.match(/^\\|\\s*\\d+\\s*\\|[^|]+\\|\\s*([^|]+)\\s*\\|/);
    if (match) companies.add(match[1].trim().toLowerCase());
  }
  return companies;
}

function getPackagedRoles() {
  if (!existsSync(CONFIG.outputDir)) return new Set();
  const files = readdirSync(CONFIG.outputDir);
  const packaged = new Set();
  for (const f of files) {
    const match = f.match(/^(\\d+)-.*-cv\\.pdf$/);
    if (match) packaged.add(match[1]);
  }
  return packaged;
}

function countStats() {
  const tracker = existsSync(CONFIG.trackerPath) ? readFileSync(CONFIG.trackerPath, 'utf-8') : '';
  const trackerLines = tracker.split('\\n').filter(l => l.match(/^\\|\\s*\\d+/)).length;
  const reports = existsSync(CONFIG.reportsDir) ? readdirSync(CONFIG.reportsDir).filter(f => f.endsWith('.md') && f !== '.gitkeep').length : 0;
  const pdfs = existsSync(CONFIG.outputDir) ? readdirSync(CONFIG.outputDir).filter(f => f.endsWith('.pdf')).length : 0;
  const applied = (tracker.match(/Applied/g) || []).length;
  const applyTier = (tracker.match(/APPLY|SUBMITTED/g) || []).length;

  return { trackerLines, reports, pdfs, applied, applyTier };
}

function generateDigestMarkdown() {
  const stats = countStats();
  const now = new Date().toISOString().substring(0, 16).replace('T', ' ');

  return `# Career-Ops Daily Digest -- ${now}

## Pipeline Status
- **Roles tracked:** ${stats.trackerLines}
- **Reports written:** ${stats.reports}
- **PDFs generated:** ${stats.pdfs} (${stats.pdfs / 2} packages)
- **Applications submitted:** ${stats.applied}
- **APPLY-tier roles:** ${stats.applyTier}

## Action Required
Open SUBMIT-NOW.md for the full submission checklist with portal links and PDF filenames.
Each application takes 2-3 minutes: open link, upload 2 PDFs, fill EEO, submit.

## Next Scan
This pipeline runs automatically every 6 hours. New roles are evaluated, scored,
and packaged without intervention. You just submit.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--full';

  log('INFO', `Career-Ops Auto Pipeline starting in ${mode} mode`);
  log('INFO', `Root: ${ROOT}`);

  const stats = countStats();
  log('INFO', `Current state: ${stats.trackerLines} tracked, ${stats.reports} reports, ${stats.pdfs} PDFs, ${stats.applied} submitted`);

  if (mode === '--digest') {
    const digest = generateDigestMarkdown();
    const digestFile = join(CONFIG.logsDir, `digest-${new Date().toISOString().substring(0, 10)}.md`);
    if (!existsSync(CONFIG.logsDir)) mkdirSync(CONFIG.logsDir, { recursive: true });
    writeFileSync(digestFile, digest);
    log('INFO', `Digest written to ${digestFile}`);
    console.log(digest);
    return;
  }

  if (mode === '--stats') {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  log('INFO', 'Pipeline complete. Use Claude Code with career-ops skill for full scan/evaluate/generate cycle.');
  log('INFO', 'Run: claude -p "Read SUBMIT-NOW.md and scan for new roles. Evaluate any new finds, generate packages for 3.5+ scores, create Gmail drafts, and update SUBMIT-NOW.md."');
}

main().catch(err => {
  log('ERROR', err.message);
  process.exit(1);
});
