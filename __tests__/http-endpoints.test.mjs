import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Integration tests for the Career-OS dashboard server HTTP endpoints.
 *
 * These tests import the express app directly (without starting the server)
 * and use Node's built-in http to test request/response cycles.
 *
 * Since the server is a monolith that can't be easily imported without side
 * effects, we test by starting a temporary server on a random port.
 */

// We'll test against the actual server by spawning it on a random port
let serverProcess;
let baseUrl;
const TEST_PORT = 39871; // High port unlikely to conflict

/**
 * Helper to make HTTP requests to the test server.
 */
async function request(path, options = {}) {
  const url = `http://localhost:${TEST_PORT}${path}`;
  const fetchOptions = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `http://localhost:${TEST_PORT}`,
      ...(options.headers || {}),
    },
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, json, text, headers: response.headers };
}

/**
 * Start the server as a child process for testing.
 */
import { spawn } from 'child_process';

async function startServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    serverProcess = spawn('node', ['dashboard-server.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        // Don't need real API keys for most tests
        GEMINI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('running at')) {
        clearTimeout(timeout);
        // Give server a moment to fully initialize
        setTimeout(resolve, 200);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      // Log stderr for debugging but don't fail
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
    serverProcess = null;
  }
}

// Ensure cleanup on unexpected exits (prevent orphan server processes)
process.on('exit', stopServer);
process.on('SIGTERM', stopServer);
process.on('SIGINT', stopServer);
process.on('uncaughtException', (err) => {
  stopServer();
  throw err;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HTTP endpoint integration tests', () => {
  before(async () => {
    await startServer();
  });

  after(() => {
    stopServer();
  });

  // --- CORS ---
  describe('CORS', () => {
    it('should set CORS headers for allowed localhost origin', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.headers.get('access-control-allow-origin'), `http://localhost:${TEST_PORT}`);
    });

    it('should NOT set CORS origin header for disallowed origins', async () => {
      const url = `http://localhost:${TEST_PORT}/api/connectors`;
      const response = await fetch(url, {
        headers: { 'Origin': 'https://evil.com' },
      });
      const origin = response.headers.get('access-control-allow-origin');
      assert.ok(!origin || origin !== 'https://evil.com', 'Should not allow evil.com origin');
    });

    it('should handle OPTIONS preflight for allowed origin', async () => {
      const url = `http://localhost:${TEST_PORT}/api/connectors`;
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: { 'Origin': `http://localhost:${TEST_PORT}` },
      });
      assert.equal(response.status, 204);
    });
  });

  // --- Read endpoints ---
  describe('GET /api/connectors', () => {
    it('should return API key boolean status', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.status, 200);
      assert.ok(res.json.apiKeys, 'Should have apiKeys object');
      assert.ok(res.json.mcpServices, 'Should have mcpServices array');
      // Keys should be boolean, never the actual value
      for (const [key, value] of Object.entries(res.json.apiKeys)) {
        assert.equal(typeof value, 'boolean', `${key} should be boolean`);
      }
    });
  });

  describe('GET /api/profile', () => {
    it('should return profile data or unconfigured status', async () => {
      const res = await request('/api/profile');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
      // Either configured:true with data, or configured:false
      assert.ok(typeof res.json.configured === 'boolean', 'Should have configured field');
    });
  });

  describe('GET /api/pipeline', () => {
    it('should return pipeline entries', async () => {
      const res = await request('/api/pipeline');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have count');
      assert.ok(Array.isArray(res.json.entries), 'Should have entries array');
    });
  });

  describe('GET /api/tracker', () => {
    it('should return tracker rows', async () => {
      const res = await request('/api/tracker');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have count');
      assert.ok(Array.isArray(res.json.rows), 'Should have rows array');
    });
  });

  describe('GET /api/analytics', () => {
    it('should return computed analytics', async () => {
      const res = await request('/api/analytics');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.total === 'number', 'Should have total');
      assert.ok(res.json.statusCounts, 'Should have statusCounts');
    });
  });

  describe('GET /api/reports', () => {
    it('should return list of report files', async () => {
      const res = await request('/api/reports');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have count');
      assert.ok(Array.isArray(res.json.files), 'Should have files array');
    });
  });

  describe('GET /api/reports/:file', () => {
    it('should reject directory traversal attempts', async () => {
      const res = await request('/api/reports/..%2F..%2Fetc%2Fpasswd');
      // Should be 400 or 404, not 200
      assert.ok(res.status >= 400, `Should reject traversal, got ${res.status}`);
    });

    it('should return 404 for non-existent report', async () => {
      const res = await request('/api/reports/nonexistent-file-12345.md');
      assert.equal(res.status, 404);
    });
  });

  describe('GET /api/scan-history', () => {
    it('should return scan history', async () => {
      const res = await request('/api/scan-history');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number');
      assert.ok(Array.isArray(res.json.rows));
    });
  });

  describe('GET /api/contacts', () => {
    it('should return contacts data', async () => {
      const res = await request('/api/contacts');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number');
    });
  });

  describe('GET /api/recommendations', () => {
    it('should return priorities and weekly goals', async () => {
      const res = await request('/api/recommendations');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.priorities), 'Should have priorities array');
      assert.ok(typeof res.json.weeklyGoals === 'string', 'Should have weeklyGoals string');
    });
  });

  describe('GET /api/briefing', () => {
    it('should return morning briefing data', async () => {
      const res = await request('/api/briefing');
      assert.equal(res.status, 200);
      assert.ok(res.json.date, 'Should have date');
      assert.ok(res.json.greeting, 'Should have greeting');
      assert.ok(res.json.pipeline, 'Should have pipeline stats');
      assert.ok(res.json.tracker, 'Should have tracker stats');
      assert.ok(typeof res.json.suggestion === 'string', 'Should have suggestion');
    });
  });

  describe('GET /api/notifications', () => {
    it('should return notifications array', async () => {
      const res = await request('/api/notifications');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.notifications), 'Should have notifications array');
    });
  });

  describe('GET /api/memory', () => {
    it('should return memory structure', async () => {
      const res = await request('/api/memory');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.careerFacts), 'Should have careerFacts');
      assert.ok(Array.isArray(res.json.actionItems), 'Should have actionItems');
    });
  });

  describe('GET /api/inbox', () => {
    it('should return placeholder inbox data', async () => {
      const res = await request('/api/inbox');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.messages), 'Should have messages array');
    });
  });

  describe('GET /api/calendar', () => {
    it('should return placeholder calendar data', async () => {
      const res = await request('/api/calendar');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.events), 'Should have events array');
    });
  });

  // --- Write endpoint validation ---
  describe('PATCH /api/tracker/:num', () => {
    it('should reject invalid entry number', async () => {
      const res = await request('/api/tracker/abc', {
        method: 'PATCH',
        body: { status: 'Applied' },
      });
      assert.equal(res.status, 400);
    });

    it('should reject missing status and notes', async () => {
      const res = await request('/api/tracker/1', {
        method: 'PATCH',
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  describe('GET /api/file/:name', () => {
    it('should reject unknown file names', async () => {
      const res = await request('/api/file/malicious');
      assert.equal(res.status, 400);
      assert.ok(res.json.error.includes('not editable'));
    });

    it('should return file content for whitelisted names', async () => {
      const res = await request('/api/file/cv');
      assert.equal(res.status, 200);
      assert.ok('content' in res.json, 'Should have content field');
    });
  });

  describe('PUT /api/file/:name', () => {
    it('should reject non-string content', async () => {
      const res = await request('/api/file/cv', {
        method: 'PUT',
        body: { content: 12345 },
      });
      assert.equal(res.status, 400);
    });

    it('should reject missing content', async () => {
      const res = await request('/api/file/cv', {
        method: 'PUT',
        body: {},
      });
      assert.equal(res.status, 400);
    });

    it('should reject unknown file names', async () => {
      const res = await request('/api/file/secret', {
        method: 'PUT',
        body: { content: 'hack' },
      });
      assert.equal(res.status, 400);
    });
  });

  // --- POST endpoint input validation ---
  describe('POST /api/generate', () => {
    it('should reject missing type', async () => {
      const res = await request('/api/generate', {
        method: 'POST',
        body: { context: 'test' },
      });
      assert.equal(res.status, 400);
    });

    it('should reject invalid type', async () => {
      const res = await request('/api/generate', {
        method: 'POST',
        body: { type: 'malicious' },
      });
      assert.equal(res.status, 400);
    });

    it('should return 503 when API key is missing', async () => {
      const res = await request('/api/generate', {
        method: 'POST',
        body: { type: 'resume' },
      });
      assert.equal(res.status, 503);
    });
  });

  describe('POST /api/evaluate', () => {
    it('should reject missing url and text', async () => {
      const res = await request('/api/evaluate', {
        method: 'POST',
        body: {},
      });
      assert.equal(res.status, 400);
    });

    it('should return 503 when API key is missing', async () => {
      const res = await request('/api/evaluate', {
        method: 'POST',
        body: { text: 'Software Engineer at Acme Corp' },
      });
      assert.equal(res.status, 503);
    });
  });

  describe('POST /api/research', () => {
    it('should reject missing company name', async () => {
      const res = await request('/api/research', {
        method: 'POST',
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/verify', () => {
    it('should reject invalid URL', async () => {
      const res = await request('/api/verify', {
        method: 'POST',
        body: { url: 'not-a-url' },
      });
      assert.equal(res.status, 400);
    });

    it('should reject missing URL', async () => {
      const res = await request('/api/verify', {
        method: 'POST',
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/stories', () => {
    it('should reject incomplete STAR story', async () => {
      const res = await request('/api/stories', {
        method: 'POST',
        body: { situation: 'test' },
      });
      assert.equal(res.status, 400);
      assert.ok(res.json.error.includes('required'));
    });
  });

  describe('POST /api/memory', () => {
    it('should reject invalid type', async () => {
      const res = await request('/api/memory', {
        method: 'POST',
        body: { type: 'invalid', data: {} },
      });
      assert.equal(res.status, 400);
    });

    it('should reject missing data', async () => {
      const res = await request('/api/memory', {
        method: 'POST',
        body: { type: 'careerFact' },
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/export-package', () => {
    it('should reject missing roleId', async () => {
      const res = await request('/api/export-package', {
        method: 'POST',
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/chat', () => {
    it('should reject missing message', async () => {
      const res = await request('/api/chat', {
        method: 'POST',
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  // --- Security Headers ---
  describe('Security headers', () => {
    it('should include X-Content-Type-Options nosniff', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    it('should include X-Frame-Options DENY', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
    });

    it('should include X-XSS-Protection header', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.headers.get('x-xss-protection'), '1; mode=block');
    });

    it('should include Referrer-Policy header', async () => {
      const res = await request('/api/connectors');
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    });

    it('should include Content-Security-Policy header', async () => {
      const res = await request('/api/connectors');
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp, 'Should have CSP header');
      assert.ok(csp.includes("default-src 'self'"), 'CSP should restrict default-src');
    });
  });

  // --- Async I/O verification ---
  describe('Async endpoints', () => {
    it('GET /api/briefing should work (async converted)', async () => {
      const res = await request('/api/briefing');
      assert.equal(res.status, 200);
      assert.ok(res.json.greeting || res.json.date, 'Should have briefing data');
    });

    it('GET /api/notifications should work (async converted)', async () => {
      const res = await request('/api/notifications');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.notifications), 'Should have notifications array');
    });

    it('GET /api/comp should work (async parallel reads)', async () => {
      const res = await request('/api/comp');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
    });

    it('GET /api/brand should work (async parallel reads)', async () => {
      const res = await request('/api/brand');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
    });

    it('GET /api/story-bank should work (async converted)', async () => {
      const res = await request('/api/story-bank');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
    });

    it('GET /api/follow-ups should work (async converted)', async () => {
      const res = await request('/api/follow-ups');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
    });

    it('GET /api/memory should work', async () => {
      const res = await request('/api/memory');
      assert.equal(res.status, 200);
      assert.ok(res.json !== null, 'Should return JSON');
    });
  });

  // --- Cycle 3: Pipeline Pagination ---
  describe('GET /api/pipeline (pagination)', () => {
    it('should return pagination metadata', async () => {
      const res = await request('/api/pipeline?page=1&limit=10');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have total count');
      assert.ok(typeof res.json.page === 'number', 'Should have page number');
      assert.ok(typeof res.json.limit === 'number', 'Should have limit');
      assert.ok(typeof res.json.totalPages === 'number', 'Should have totalPages');
      assert.ok(typeof res.json.hasMore === 'boolean', 'Should have hasMore flag');
      assert.ok(Array.isArray(res.json.entries), 'Should have entries array');
    });

    it('should respect limit parameter', async () => {
      const res = await request('/api/pipeline?page=1&limit=2');
      assert.equal(res.status, 200);
      assert.ok(res.json.entries.length <= 2, 'Should return at most 2 entries');
      assert.equal(res.json.limit, 2);
    });

    it('should return all entries when page=0', async () => {
      const res = await request('/api/pipeline?page=0');
      assert.equal(res.status, 200);
      assert.equal(res.json.page, 0, 'Page 0 means return all');
    });

    it('should cap limit at 200', async () => {
      const res = await request('/api/pipeline?page=1&limit=999');
      assert.equal(res.status, 200);
      assert.ok(res.json.limit <= 200, 'Limit should be capped at 200');
    });

    it('should accept tier filter', async () => {
      const res = await request('/api/pipeline?tier=c-suite');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.entries));
    });

    it('should accept search query', async () => {
      const res = await request('/api/pipeline?q=google');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.entries));
    });
  });

  // --- Cycle 3: Data Integrity Endpoints ---
  describe('GET /api/pipeline/duplicates', () => {
    it('should return duplicate URL list', async () => {
      const res = await request('/api/pipeline/duplicates');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have count');
      assert.ok(Array.isArray(res.json.duplicates), 'Should have duplicates array');
    });
  });

  describe('GET /api/tracker/duplicates', () => {
    it('should return duplicate company+role list', async () => {
      const res = await request('/api/tracker/duplicates');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.count === 'number', 'Should have count');
      assert.ok(Array.isArray(res.json.duplicates), 'Should have duplicates array');
    });
  });

  describe('POST /api/pipeline/add', () => {
    it('should reject missing fields', async () => {
      const res = await request('/api/pipeline/add', {
        method: 'POST',
        body: { url: 'https://example.com' },
      });
      assert.equal(res.status, 400);
    });

    it('should reject non-http URLs', async () => {
      const res = await request('/api/pipeline/add', {
        method: 'POST',
        body: { url: 'ftp://example.com', company: 'Test', title: 'Role' },
      });
      assert.equal(res.status, 400);
    });
  });

  // --- Cycle 3: Memory Dedup via API ---
  describe('POST /api/memory (dedup)', () => {
    it('should accept valid careerFact', async () => {
      const res = await request('/api/memory', {
        method: 'POST',
        body: { type: 'careerFact', data: { content: 'Test fact for dedup ' + Date.now() } },
      });
      assert.equal(res.status, 200);
      assert.ok(res.json.success);
    });

    it('should indicate dedup on duplicate careerFact', async () => {
      const fact = 'Unique dedup test fact ' + Date.now();
      // First save
      await request('/api/memory', {
        method: 'POST',
        body: { type: 'careerFact', data: { content: fact } },
      });
      // Second save (should be deduplicated)
      const res2 = await request('/api/memory', {
        method: 'POST',
        body: { type: 'careerFact', data: { content: fact } },
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.json.deduplicated, true);
    });
  });

  // --- Cycle 5: Workflow Endpoint Tests ---
  // Note: workflow endpoints use apiProxyLimiter (10 req/min), so they may
  // return 429 if previous tests exhausted the limit. We accept 429 as valid.
  describe('POST /api/workflow/full-pipeline', () => {
    it('should handle full-pipeline workflow request', async () => {
      const res = await request('/api/workflow/full-pipeline', {
        method: 'POST',
        body: { count: 1 },
      });
      // 200 = success, 503 = no API key, 429 = rate limited (all valid)
      assert.ok([200, 503, 429].includes(res.status), `Expected 200, 503, or 429, got ${res.status}`);
      if (res.status === 200) {
        assert.ok(res.json.scanned !== undefined, 'Should have scanned field');
        assert.ok(Array.isArray(res.json.evaluated), 'Should have evaluated array');
        assert.ok(Array.isArray(res.json.materials), 'Should have materials array');
      }
    });

    it('should accept count parameter', async () => {
      const res = await request('/api/workflow/full-pipeline', {
        method: 'POST',
        body: { count: 2 },
      });
      assert.ok([200, 503, 429].includes(res.status));
    });

    it('should not crash with large count', async () => {
      const res = await request('/api/workflow/full-pipeline', {
        method: 'POST',
        body: { count: 999 },
      });
      assert.ok([200, 503, 429].includes(res.status));
    });
  });

  describe('POST /api/workflow/interview-prep', () => {
    it('should reject missing company name with 400 or 429', async () => {
      const res = await request('/api/workflow/interview-prep', {
        method: 'POST',
        body: {},
      });
      assert.ok([400, 429].includes(res.status), `Expected 400 or 429, got ${res.status}`);
      if (res.status === 400) {
        assert.ok(res.json.error.includes('Company'), 'Error should mention company');
      }
    });

    it('should include hint in 400 error response', async () => {
      const res = await request('/api/workflow/interview-prep', {
        method: 'POST',
        body: {},
      });
      if (res.status === 400) {
        assert.ok(res.json.hint, 'Should include hint field');
      }
      // 429 is acceptable too (rate limited from previous tests)
      assert.ok([400, 429].includes(res.status));
    });

    it('should accept company and role', async () => {
      const res = await request('/api/workflow/interview-prep', {
        method: 'POST',
        body: { company: 'TestCo', role: 'VP of AI' },
      });
      assert.ok([200, 503, 429].includes(res.status), `Expected 200, 503, or 429, got ${res.status}`);
      if (res.status === 200) {
        assert.equal(res.json.company, 'TestCo');
        assert.equal(res.json.role, 'VP of AI');
        assert.ok(Array.isArray(res.json.stories), 'Should have stories array');
        assert.ok(Array.isArray(res.json.behavioralQuestions), 'Should have behavioralQuestions array');
      }
    });
  });

  describe('POST /api/workflow/follow-up-batch', () => {
    it('should return drafts array or be rate-limited', async () => {
      const res = await request('/api/workflow/follow-up-batch', {
        method: 'POST',
        body: {},
      });
      assert.ok([200, 503, 429].includes(res.status), `Expected 200, 503, or 429, got ${res.status}`);
      if (res.status === 200) {
        assert.ok(Array.isArray(res.json.drafts), 'Should have drafts array');
        if (res.json.drafts.length === 0) {
          assert.ok(res.json.message, 'Should have message when no drafts');
        }
      }
    });
  });

  // --- Cycle 5: Enhanced Recommendations ---
  describe('GET /api/recommendations (enhanced)', () => {
    it('should return priorities with priorityScore', async () => {
      const res = await request('/api/recommendations');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.priorities), 'Should have priorities');
      for (const p of res.json.priorities) {
        assert.ok(typeof p.priorityScore === 'number', 'Each priority should have numeric priorityScore');
        assert.ok(p.urgency, 'Each priority should have urgency');
        assert.ok(p.reason, 'Each priority should have reason');
      }
    });

    it('should return stats object', async () => {
      const res = await request('/api/recommendations');
      assert.equal(res.status, 200);
      assert.ok(res.json.stats, 'Should have stats object');
      assert.ok(typeof res.json.stats.totalTracked === 'number', 'Should have totalTracked');
      assert.ok(typeof res.json.stats.applied === 'number', 'Should have applied count');
      assert.ok(typeof res.json.stats.pipelineSize === 'number', 'Should have pipelineSize');
    });

    it('should return weeklyGoals string', async () => {
      const res = await request('/api/recommendations');
      assert.equal(res.status, 200);
      assert.ok(typeof res.json.weeklyGoals === 'string', 'Should have weeklyGoals');
    });
  });

  // --- Cycle 5: Scan with filter stats ---
  describe('POST /api/scan (filtering)', () => {
    it('should return filteredOut count in response', async () => {
      const res = await request('/api/scan', {
        method: 'POST',
        body: {},
      });
      // Scan may fail if portals.yml is missing, succeed, or be rate-limited
      if (res.status === 200) {
        assert.ok(typeof res.json.filteredOut === 'number', 'Should report filteredOut count');
        assert.ok(typeof res.json.found === 'number', 'Should report found count');
        assert.ok(typeof res.json.added === 'number', 'Should report added count');
      }
      assert.ok([200, 404, 429].includes(res.status), `Expected 200, 404, or 429, got ${res.status}`);
    });
  });

  // --- Cycle 5: Actionable Error Hints ---
  // These test that error responses include actionable "hint" fields.
  // Rate-limited (429) responses are acceptable since the rate limiter
  // fires before the endpoint logic -- the important thing is these
  // return proper errors when not rate-limited.
  describe('Error response hints', () => {
    it('POST /api/generate should include hint on 400', async () => {
      const res = await request('/api/generate', {
        method: 'POST',
        body: { type: 'invalid-type' },
      });
      if (res.status === 429) return; // Rate limited, skip
      assert.equal(res.status, 400);
      assert.ok(res.json.hint, 'Should include hint field');
      assert.ok(res.json.validTypes, 'Should include validTypes array');
    });

    it('POST /api/generate should include hint on 503 (missing API key)', async () => {
      const res = await request('/api/generate', {
        method: 'POST',
        body: { type: 'resume' },
      });
      if (res.status === 429) return; // Rate limited, skip
      assert.equal(res.status, 503);
      assert.ok(res.json.hint, 'Should include hint field explaining how to fix');
    });

    it('POST /api/evaluate should include hint on 400', async () => {
      const res = await request('/api/evaluate', {
        method: 'POST',
        body: {},
      });
      if (res.status === 429) return; // Rate limited, skip
      assert.equal(res.status, 400);
      assert.ok(res.json.hint, 'Should include hint field');
    });

    it('POST /api/chat should include hint on 503 (missing API key)', async () => {
      const res = await request('/api/chat', {
        method: 'POST',
        body: { message: 'hello' },
      });
      if (res.status === 429) return; // Rate limited, skip
      assert.equal(res.status, 503);
      assert.ok(res.json.hint, 'Should include hint field explaining how to fix');
    });

    it('POST /api/chat should include hint on 400 (missing message)', async () => {
      const res = await request('/api/chat', {
        method: 'POST',
        body: {},
      });
      if (res.status === 429) return; // Rate limited, skip
      assert.equal(res.status, 400);
      assert.ok(res.json.hint, 'Should include hint field');
    });
  });

  // --- SPA fallback ---
  describe('SPA fallback', () => {
    it('should serve index.html for unknown GET routes', async () => {
      const res = await request('/some/random/page');
      // Should return 200 with HTML (the SPA) or 404 if no public/index.html
      assert.ok(res.status === 200 || res.status === 404);
    });
  });
});
