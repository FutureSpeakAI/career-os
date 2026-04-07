#!/usr/bin/env node

/**
 * submit-application.mjs -- Automated job application submission via Playwright
 *
 * STATUS: EXPERIMENTAL -- This script automates form filling but should always
 * be reviewed before submission. Use with caution and always verify the filled
 * data before clicking submit.
 *
 * Usage:
 *   node submit-application.mjs --url "https://..." --cv "output/XXX-cv.pdf" --cover "output/XXX-cover.pdf"
 *
 * Detects portal type (Lever, Greenhouse, Workday, Jobvite, Ashby, generic) and
 * fills standard fields, uploads documents, takes screenshots, and pauses before submit.
 *
 * Requires: playwright installed.
 */

import { chromium } from 'playwright';
import { resolve, dirname, basename } from 'path';
import { readFile, mkdir, access } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Profile defaults (used when profile.yml cannot be parsed)
// Users MUST fill in config/profile.yml with their own data.
// ---------------------------------------------------------------------------
const DEFAULT_PROFILE = {
  full_name: 'Jane Smith',
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@example.com',
  phone: '',
  location: '',
  linkedin: '',
  portfolio: '',
  github: '',
};

// ---------------------------------------------------------------------------
// Minimal YAML parser -- extracts top-level scalars from the candidate block
// ---------------------------------------------------------------------------
function parseProfileYaml(text) {
  const profile = { ...DEFAULT_PROFILE };
  const lines = text.split('\n');

  for (const line of lines) {
    const m = line.match(/^\s+([\w_]+)\s*:\s*"?([^"#\n]+)"?\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    const v = val.trim();
    if (!v) continue;

    switch (key) {
      case 'full_name':
        profile.full_name = v;
        {
          const parts = v.split(/\s+/);
          profile.first_name = parts[0];
          profile.last_name = parts[parts.length - 1];
        }
        break;
      case 'email':
        profile.email = v;
        break;
      case 'phone':
        if (v) profile.phone = v;
        break;
      case 'location':
        profile.location = v;
        break;
      case 'linkedin':
        profile.linkedin = v.startsWith('http') ? v : `https://${v}`;
        break;
      case 'portfolio_url':
        profile.portfolio = v.startsWith('http') ? v : `https://${v}`;
        break;
      case 'github':
        profile.github = v.startsWith('http') ? v : `https://${v}`;
        break;
    }
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Load profile from YAML
// ---------------------------------------------------------------------------
async function loadProfile() {
  const profilePath = resolve(__dirname, 'config', 'profile.yml');
  try {
    const text = await readFile(profilePath, 'utf-8');
    const profile = parseProfileYaml(text);
    log('INFO', `Loaded profile for ${profile.full_name}`);
    return profile;
  } catch (err) {
    log('WARN', `Could not read profile.yml: ${err.message}. Using defaults.`);
    log('WARN', 'Please fill in config/profile.yml with your personal data.');
    return { ...DEFAULT_PROFILE };
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { url: null, cv: null, cover: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      parsed.url = args[++i];
    } else if (args[i] === '--cv' && args[i + 1]) {
      parsed.cv = resolve(args[++i]);
    } else if (args[i] === '--cover' && args[i + 1]) {
      parsed.cover = resolve(args[++i]);
    }
  }

  if (!parsed.url) {
    console.error('Usage: node submit-application.mjs --url "https://..." --cv "output/XXX-cv.pdf" --cover "output/XXX-cover.pdf"');
    console.error('  --url    (required) Job application URL');
    console.error('  --cv     (required) Path to CV PDF');
    console.error('  --cover  (optional) Path to cover letter PDF');
    console.error('\nNOTE: This script is EXPERIMENTAL. Always review before submitting.');
    process.exit(1);
  }

  if (!parsed.cv) {
    console.error('ERROR: --cv is required. Provide the path to your CV PDF.');
    process.exit(1);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Portal detection
// ---------------------------------------------------------------------------
const PORTAL_PATTERNS = [
  { type: 'lever', pattern: /jobs\.lever\.co/i },
  { type: 'greenhouse', pattern: /greenhouse\.io/i },
  { type: 'workday', pattern: /\.myworkdayjobs\.com/i },
  { type: 'workday', pattern: /\.wd\d+\.myworkdayjobs/i },
  { type: 'jobvite', pattern: /jobs\.jobvite\.com/i },
  { type: 'jobvite', pattern: /app\.jobvite\.com/i },
  { type: 'ashby', pattern: /jobs\.ashbyhq\.com/i },
];

function detectPortal(url) {
  for (const { type, pattern } of PORTAL_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  return 'generic';
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Screenshot helper
// ---------------------------------------------------------------------------
async function takeScreenshot(page, dir, label) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${label}-${ts}.png`;
  const filepath = resolve(dir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  log('INFO', `Screenshot saved: ${filepath}`);
  return filepath;
}

// ---------------------------------------------------------------------------
// Safe interaction helpers
// ---------------------------------------------------------------------------
const FIELD_TIMEOUT = 5000;

async function safeType(page, selector, value, label) {
  try {
    const el = await page.waitForSelector(selector, { timeout: FIELD_TIMEOUT, state: 'visible' });
    if (el) {
      await el.click();
      await el.fill(value);
      log('INFO', `Filled ${label}: "${value}"`);
      return true;
    }
  } catch {
    log('DEBUG', `Field not found: ${label} (${selector})`);
  }
  return false;
}

async function safeClick(page, selector, label) {
  try {
    const el = await page.waitForSelector(selector, { timeout: FIELD_TIMEOUT, state: 'visible' });
    if (el) {
      await el.click();
      log('INFO', `Clicked: ${label}`);
      return true;
    }
  } catch {
    log('DEBUG', `Button not found: ${label} (${selector})`);
  }
  return false;
}

async function safeUpload(page, selector, filePath, label) {
  if (!filePath) {
    log('DEBUG', `No file provided for ${label}, skipping upload.`);
    return false;
  }
  try {
    await access(filePath);
  } catch {
    log('WARN', `File not found for ${label}: ${filePath}`);
    return false;
  }
  try {
    const input = await page.waitForSelector(selector, { timeout: FIELD_TIMEOUT });
    if (input) {
      await input.setInputFiles(filePath);
      log('INFO', `Uploaded ${label}: ${basename(filePath)}`);
      return true;
    }
  } catch {
    log('DEBUG', `Upload input not found: ${label} (${selector})`);
  }
  return false;
}

async function safeFillFirst(page, selectors, value, label) {
  for (const sel of selectors) {
    if (await safeType(page, sel, value, label)) return true;
  }
  return false;
}

async function safeUploadFirst(page, selectors, filePath, label) {
  for (const sel of selectors) {
    if (await safeUpload(page, sel, filePath, label)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main -- EXPERIMENTAL
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n=== Career-OS Application Submitter (EXPERIMENTAL) ===\n');
  console.log('WARNING: This script is experimental. Always review filled data before submitting.\n');

  const { url, cv, cover } = parseArgs();
  const profile = await loadProfile();
  const portalType = detectPortal(url);

  log('INFO', `URL: ${url}`);
  log('INFO', `Portal: ${portalType}`);
  log('INFO', `CV: ${cv}`);
  if (cover) log('INFO', `Cover: ${cover}`);

  const screenshotDir = resolve(__dirname, 'output', 'screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    log('INFO', 'Page loaded');

    await takeScreenshot(page, screenshotDir, 'initial');

    // Log form fields for debugging
    const fields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      return inputs.map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        label: el.labels?.[0]?.textContent?.trim() || '',
        visible: el.offsetParent !== null,
      }));
    });

    log('INFO', `Found ${fields.filter(f => f.visible).length} visible form fields`);

    // Basic field filling (portal-agnostic)
    await safeFillFirst(page, [
      'input[name="name"]', 'input[name="full_name"]',
      'input[aria-label*="name" i]', 'input[placeholder*="name" i]',
    ], profile.full_name, 'Full Name');

    await safeFillFirst(page, [
      'input[name="email"]', 'input[type="email"]',
      'input[aria-label*="email" i]', 'input[placeholder*="email" i]',
    ], profile.email, 'Email');

    if (profile.phone) {
      await safeFillFirst(page, [
        'input[name="phone"]', 'input[type="tel"]',
        'input[aria-label*="phone" i]', 'input[placeholder*="phone" i]',
      ], profile.phone, 'Phone');
    }

    if (profile.linkedin) {
      await safeFillFirst(page, [
        'input[name="urls[LinkedIn]"]', 'input[name="linkedin"]',
        'input[aria-label*="linkedin" i]', 'input[placeholder*="linkedin" i]',
      ], profile.linkedin, 'LinkedIn');
    }

    if (profile.portfolio) {
      await safeFillFirst(page, [
        'input[name="urls[Portfolio]"]', 'input[name="portfolio"]', 'input[name="website"]',
        'input[aria-label*="portfolio" i]', 'input[aria-label*="website" i]',
      ], profile.portfolio, 'Portfolio');
    }

    // Upload CV
    await safeUploadFirst(page, [
      'input[type="file"][name*="resume" i]', 'input[type="file"][name*="cv" i]',
      'input[type="file"][accept*="pdf"]', 'input[type="file"]',
    ], cv, 'Resume/CV');

    // Upload cover letter
    if (cover) {
      await safeUploadFirst(page, [
        'input[type="file"][name*="cover" i]',
        'input[type="file"]:nth-of-type(2)',
      ], cover, 'Cover Letter');
    }

    await takeScreenshot(page, screenshotDir, 'filled');

    log('INFO', '');
    log('INFO', '========================================');
    log('INFO', '  PAUSED -- Review the form before submitting.');
    log('INFO', '  The browser window is open for you to verify.');
    log('INFO', '  Press Ctrl+C to cancel, or close the browser when done.');
    log('INFO', '========================================');
    log('INFO', '');

    // Keep browser open for review
    await page.waitForTimeout(300000); // 5 minutes

  } catch (err) {
    log('ERROR', err.message);
    await takeScreenshot(page, screenshotDir, 'error');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log('ERROR', err.message);
  process.exit(1);
});
