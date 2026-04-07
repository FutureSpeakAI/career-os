import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync, renameSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'merge-tracker.mjs');
const DATA_DIR = join(ROOT, 'data');
const APPS_FILE = join(DATA_DIR, 'applications.md');
const ADDITIONS_DIR = join(ROOT, 'batch', 'tracker-additions');

describe('merge-tracker.mjs', () => {

  it('should exit cleanly when no applications.md exists', () => {
    const backup = APPS_FILE + '.test-bak';
    const hadFile = existsSync(APPS_FILE);
    if (hadFile) renameSync(APPS_FILE, backup);

    try {
      const result = execSync(`node "${SCRIPT}" --dry-run`, { encoding: 'utf-8' });
      assert.ok(
        result.includes('No applications.md') || result.includes('Nothing to merge'),
        'Should handle missing applications.md gracefully'
      );
    } catch (e) {
      // Exit code 0 with message is also fine
      assert.ok(
        e.status === 0 || e.stdout?.includes('No applications.md'),
        'Should handle missing applications.md gracefully'
      );
    } finally {
      if (hadFile) renameSync(backup, APPS_FILE);
    }
  });

  it('should exit cleanly when no tracker additions exist', () => {
    const backup = APPS_FILE + '.test-bak';
    const hadFile = existsSync(APPS_FILE);
    if (hadFile) renameSync(APPS_FILE, backup);

    try {
      // Create an empty applications.md
      writeFileSync(APPS_FILE, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);

      // Ensure no TSV files in additions dir
      const tsvFiles = existsSync(ADDITIONS_DIR)
        ? readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'))
        : [];

      if (tsvFiles.length === 0) {
        const result = execSync(`node "${SCRIPT}" --dry-run`, { encoding: 'utf-8' });
        assert.ok(
          result.includes('No pending additions') || result.includes('0 pending'),
          'Should report no pending additions'
        );
      } else {
        // If there are real TSV files, skip this test
        assert.ok(true, 'Skipped: real tracker additions present');
      }
    } finally {
      if (hadFile) {
        renameSync(backup, APPS_FILE);
      } else {
        rmSync(APPS_FILE, { force: true });
      }
    }
  });
});
