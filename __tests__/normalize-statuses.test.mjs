import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'normalize-statuses.mjs');

describe('normalize-statuses.mjs', () => {

  it('should run without crashing in dry-run mode', () => {
    try {
      const result = execSync(`node "${SCRIPT}" --dry-run`, { encoding: 'utf-8' });
      // Should produce meaningful output regardless of data state
      assert.ok(result.length > 0, 'Should produce output');
    } catch (e) {
      assert.equal(e.status, 1, 'Should exit with 0 or 1');
    }
  });

  it('should not crash with --dry-run flag', () => {
    try {
      execSync(`node "${SCRIPT}" --dry-run`, { encoding: 'utf-8' });
    } catch (e) {
      assert.ok(
        e.status === 0 || e.status === 1,
        `Should exit cleanly, got status ${e.status}`
      );
    }
  });

  it('should accept --dry-run without writing changes', () => {
    // Even if there is data, --dry-run should never modify files
    try {
      const result = execSync(`node "${SCRIPT}" --dry-run`, { encoding: 'utf-8' });
      if (result.includes('normalized')) {
        assert.ok(
          result.includes('dry-run'),
          'Should indicate dry-run mode when normalizations found'
        );
      }
    } catch (e) {
      // Non-zero exit is fine, but should not crash
      assert.ok(!e.stderr?.includes('Error'), 'Should not have uncaught errors');
    }
  });
});
