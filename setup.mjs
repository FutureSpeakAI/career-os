#!/usr/bin/env node

/**
 * setup.mjs -- One-command Career-OS setup
 *
 * Installs all dependencies, scaffolds config files, creates data directories,
 * and validates the setup. Run with: npm run setup
 *
 * What it does:
 *   1. Installs npm dependencies (if needed)
 *   2. Installs Playwright Chromium browser (for PDF generation)
 *   3. Copies template files to their working locations
 *   4. Creates required data directories with .gitkeep files
 *   5. Optionally builds the Go dashboard (if Go is available)
 *   6. Runs the sync check to validate everything
 *   7. Prints next steps
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(icon, msg) { console.log(`  ${icon}  ${msg}`); }
function header(msg) { console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }
function success(msg) { log(`${c.green}OK${c.reset}`, msg); }
function skip(msg) { log(`${c.dim}--${c.reset}`, `${c.dim}${msg}${c.reset}`); }
function warn(msg) { log(`${c.yellow}!!${c.reset}`, msg); }
function fail(msg) { log(`${c.red}XX${c.reset}`, msg); }

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts }).toString().trim();
  } catch (e) {
    return null;
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return true;
  }
  return false;
}

function ensureGitkeep(dir) {
  ensureDir(dir);
  const gitkeep = join(dir, '.gitkeep');
  if (!existsSync(gitkeep)) {
    writeFileSync(gitkeep, '');
  }
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  console.log(`
${c.bold}${c.cyan}
   ____                              ___  ____
  / ___|__ _ _ __ ___  ___ _ __     / _ \\/ ___|
 | |   / _\` | '__/ _ \\/ _ \\ '__|   | | | \\___ \\
 | |__| (_| | | |  __/  __/ |      | |_| |___) |
  \\____\\__,_|_|  \\___|\\___|_|       \\___/|____/

${c.reset}${c.dim}  AI-powered career advancement operating system
  A FutureSpeak.AI project | Built on santifer/career-ops${c.reset}
`);

  let errors = 0;

  // -----------------------------------------------------------------------
  // Step 1: npm dependencies
  // -----------------------------------------------------------------------
  header('Step 1/6 -- Installing dependencies');

  if (existsSync(join(ROOT, 'node_modules', 'playwright'))) {
    skip('npm packages already installed');
  } else {
    log('..', 'Running npm install...');
    const result = run('npm install --no-audit --no-fund', { stdio: 'inherit' });
    if (result === null && !existsSync(join(ROOT, 'node_modules', 'playwright'))) {
      fail('npm install failed');
      errors++;
    } else {
      success('npm packages installed');
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Playwright Chromium
  // -----------------------------------------------------------------------
  header('Step 2/6 -- Installing Playwright browser');

  // Check if Chromium is already installed
  const pwTest = run('npx playwright install --dry-run chromium 2>&1');
  if (pwTest && pwTest.includes('already installed')) {
    skip('Playwright Chromium already installed');
  } else {
    log('..', 'Installing Chromium (this may take a minute)...');
    const pwResult = run('npx playwright install chromium', { stdio: 'inherit' });
    if (pwResult === null) {
      // Check if it actually installed despite error
      const verify = run('npx playwright install --dry-run chromium 2>&1');
      if (verify && verify.includes('already installed')) {
        success('Playwright Chromium installed');
      } else {
        warn('Playwright install may have failed -- PDF generation requires Chromium');
        warn('Run manually: npx playwright install chromium');
      }
    } else {
      success('Playwright Chromium installed');
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Scaffold config files
  // -----------------------------------------------------------------------
  header('Step 3/6 -- Scaffolding configuration files');

  const scaffolds = [
    {
      src: join(ROOT, 'config', 'profile.example.yml'),
      dst: join(ROOT, 'config', 'profile.yml'),
      name: 'config/profile.yml',
    },
    {
      src: join(ROOT, 'templates', 'portals.example.yml'),
      dst: join(ROOT, 'portals.yml'),
      name: 'portals.yml',
    },
  ];

  for (const { src, dst, name } of scaffolds) {
    if (existsSync(dst)) {
      skip(`${name} already exists`);
    } else if (existsSync(src)) {
      copyFileSync(src, dst);
      success(`${name} created from template`);
    } else {
      warn(`Template not found: ${src}`);
    }
  }

  // Create empty story bank
  const storyBank = join(ROOT, 'interview-prep', 'story-bank.md');
  if (!existsSync(storyBank)) {
    writeFileSync(storyBank, `# Interview Story Bank

> STAR+Reflection stories accumulated across evaluations.
> Career-OS automatically adds stories here as you evaluate offers.
> Over time, you'll build 5-10 master stories that answer any behavioral question.

| # | Source Role | Requirement | S | T | A | R | Reflection |
|---|------------|-------------|---|---|---|---|------------|
`);
    success('interview-prep/story-bank.md created');
  } else {
    skip('interview-prep/story-bank.md already exists');
  }

  // -----------------------------------------------------------------------
  // Step 4: Create data directories
  // -----------------------------------------------------------------------
  header('Step 4/8 -- Creating data directories');

  const dirs = [
    'data', 'data/conversations', 'reports', 'output', 'output/submissions',
    'batch/tracker-additions', 'batch/logs', 'jds', 'public',
  ];

  for (const dir of dirs) {
    const fullPath = join(ROOT, dir);
    ensureGitkeep(fullPath);
  }
  success('Data directories ready');

  // -----------------------------------------------------------------------
  // Step 5: Environment variables
  // -----------------------------------------------------------------------
  header('Step 5/8 -- Environment configuration');

  const envPath = join(ROOT, '.env');
  const envExamplePath = join(ROOT, '.env.example');
  if (existsSync(envPath)) {
    skip('.env already exists');
    // Check which keys are set
    const { readFileSync: readF } = await import('fs');
    const envContent = readF(envPath, 'utf-8');
    const keys = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
    for (const key of keys) {
      const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match && match[1].trim()) {
        success(`${key} configured`);
      } else {
        warn(`${key} not set -- some features require this`);
      }
    }
  } else if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    success('.env created from template');
    warn('Edit .env to add your API keys (GEMINI_API_KEY required for voice agent)');
  } else {
    warn('.env.example not found -- create .env manually');
  }

  // -----------------------------------------------------------------------
  // Step 6: Go dashboard (optional)
  // -----------------------------------------------------------------------
  header('Step 6/8 -- Dashboard TUI (optional)');

  const goVersion = run('go version');
  if (goVersion) {
    log('..', `Found ${goVersion.split('\n')[0]}`);
    const dashboardDir = join(ROOT, 'dashboard');
    if (existsSync(join(dashboardDir, 'main.go'))) {
      log('..', 'Building dashboard...');
      const buildResult = run('go build -o career-dashboard .', { cwd: dashboardDir });
      if (buildResult !== null) {
        success('Dashboard built: dashboard/career-dashboard');
      } else {
        warn('Dashboard build failed -- you can build it later with: cd dashboard && go build -o career-dashboard .');
      }
    }
  } else {
    skip('Go not found -- TUI dashboard is optional');
  }

  // -----------------------------------------------------------------------
  // Step 7: Web dashboard check
  // -----------------------------------------------------------------------
  header('Step 7/8 -- Web Dashboard');

  if (existsSync(join(ROOT, 'dashboard-server.mjs')) && existsSync(join(ROOT, 'public', 'index.html'))) {
    success('Web dashboard ready (run: npm start)');
  } else if (existsSync(join(ROOT, 'dashboard-web.mjs'))) {
    success('Static dashboard ready (run: npm run dashboard)');
  } else {
    warn('No web dashboard found');
  }

  // -----------------------------------------------------------------------
  // Step 8: Validate setup
  // -----------------------------------------------------------------------
  header('Step 8/8 -- Validating setup');

  // Check required files
  const checks = [
    { path: join(ROOT, 'CLAUDE.md'), name: 'CLAUDE.md (agent instructions)' },
    { path: join(ROOT, 'config', 'profile.example.yml'), name: 'config/profile.example.yml (template)' },
    { path: join(ROOT, 'templates', 'cv-template.html'), name: 'templates/cv-template.html (PDF template)' },
    { path: join(ROOT, 'templates', 'states.yml'), name: 'templates/states.yml (canonical states)' },
    { path: join(ROOT, 'modes', '_shared.md'), name: 'modes/_shared.md (shared context)' },
    { path: join(ROOT, 'generate-pdf.mjs'), name: 'generate-pdf.mjs (PDF generator)' },
  ];

  let allPresent = true;
  for (const { path, name } of checks) {
    if (existsSync(path)) {
      success(name);
    } else {
      fail(`Missing: ${name}`);
      allPresent = false;
      errors++;
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);

  if (errors === 0) {
    console.log(`
${c.bold}${c.green}  Setup complete!${c.reset}

${c.bold}  Next steps:${c.reset}

  ${c.cyan}1.${c.reset} Start the web dashboard:
     ${c.dim}$ npm start${c.reset}
     Then open ${c.dim}http://localhost:3333${c.reset} in your browser.

  ${c.cyan}2.${c.reset} Open Claude Code for the full CLI experience:
     ${c.dim}$ claude${c.reset}
     Claude will walk you through personalization:
     - Paste your CV (or LinkedIn URL)
     - Set your target roles and salary range
     - Configure companies to track

  ${c.cyan}3.${c.reset} Start using Career-OS:
     - Paste a job URL to evaluate it
     - Run ${c.dim}/career-os scan${c.reset} to search portals
     - Run ${c.dim}/career-os${c.reset} to see all commands

  ${c.cyan}4.${c.reset} Edit ${c.dim}.env${c.reset} to add your API keys:
     - GEMINI_API_KEY (required for voice agent)
     - ANTHROPIC_API_KEY (required for AI generation)
     - Other keys are optional

${c.dim}  Tip: The system is designed to be customized by Claude.
  Archetypes, scoring, templates -- just ask Claude to change them.${c.reset}

${c.dim}  Built on career-ops by Santiago Fernandez de Valderrama (santifer.io)
  A FutureSpeak.AI project | https://futurespeak.ai${c.reset}
`);
  } else {
    console.log(`
${c.bold}${c.yellow}  Setup completed with ${errors} issue(s).${c.reset}
  Review the warnings above and fix before using Career-OS.
`);
  }
}

main().catch(err => {
  console.error(`\n${c.red}Setup failed: ${err.message}${c.reset}`);
  process.exit(1);
});
