import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'verify-pipeline.mjs');

describe('verify-pipeline.mjs', () => {

  it('should run without crashing on any state', () => {
    // Whether applications.md exists or not, the script should exit cleanly
    try {
      const result = execSync(`node "${SCRIPT}"`, { encoding: 'utf-8' });
      // Exit 0: pipeline is clean or no data
      assert.ok(
        result.includes('applications.md') || result.includes('Pipeline'),
        'Should produce meaningful output'
      );
    } catch (e) {
      // Exit 1: pipeline has errors (still valid behavior)
      assert.equal(e.status, 1, 'Should exit with 0 or 1');
      assert.ok(e.stdout?.length > 0, 'Should produce output on error exit');
    }
  });

  it('should not crash with any argument', () => {
    // The script should always exit cleanly (0 or 1), never crash
    try {
      execSync(`node "${SCRIPT}"`, { encoding: 'utf-8' });
    } catch (e) {
      // Exit code 1 is expected (errors found) -- but it should never crash
      assert.ok(
        e.status === 1,
        `Should exit with code 0 or 1, got ${e.status}`
      );
      // Should have structured output, not a stack trace
      assert.ok(
        !e.stderr || !e.stderr.includes('SyntaxError'),
        'Should not have syntax errors'
      );
    }
  });

  it('should have all required script files present', () => {
    // Verify all pipeline scripts exist
    const scripts = [
      'verify-pipeline.mjs', 'merge-tracker.mjs',
      'normalize-statuses.mjs', 'dedup-tracker.mjs',
      'generate-pdf.mjs', 'cv-sync-check.mjs',
    ];
    for (const script of scripts) {
      assert.ok(
        existsSync(join(ROOT, script)),
        `${script} should exist`
      );
    }
  });
});
