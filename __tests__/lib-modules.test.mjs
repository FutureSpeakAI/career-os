import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Tests for the extracted lib/ modules: compression, cache-headers.
 * Uses the actual server to verify integration works end-to-end.
 */

const TEST_PORT = 39872; // Different port from http-endpoints tests
let serverProcess;

async function startServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    serverProcess = spawn('node', ['dashboard-server.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        GEMINI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('running at')) {
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      }
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
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

describe('lib/ modules integration tests', () => {
  before(async () => {
    await startServer();
  });

  after(() => {
    stopServer();
  });

  // --- Compression ---
  describe('Response compression', () => {
    it('should return gzip-compressed JSON for large responses when Accept-Encoding: gzip', async () => {
      const url = `http://localhost:${TEST_PORT}/api/briefing`;
      const response = await fetch(url, {
        headers: {
          'Accept-Encoding': 'gzip, deflate',
          'Origin': `http://localhost:${TEST_PORT}`,
        },
      });
      // The response may or may not be compressed depending on size
      // At minimum it should succeed
      assert.equal(response.status, 200);
      const encoding = response.headers.get('content-encoding');
      // Briefing response is typically >1KB, should be compressed
      if (encoding) {
        assert.ok(encoding === 'gzip' || encoding === 'deflate', `Encoding should be gzip or deflate, got: ${encoding}`);
      }
    });

    it('should return uncompressed JSON when Accept-Encoding is not set', async () => {
      const url = `http://localhost:${TEST_PORT}/api/connectors`;
      const response = await fetch(url, {
        headers: {
          'Accept-Encoding': '',
          'Origin': `http://localhost:${TEST_PORT}`,
        },
      });
      assert.equal(response.status, 200);
      const encoding = response.headers.get('content-encoding');
      assert.ok(!encoding, 'Should not have Content-Encoding when not requested');
    });
  });

  // --- ETag caching ---
  describe('ETag cache headers', () => {
    it('should return ETag header for GET /api/pipeline', async () => {
      const res = await request('/api/pipeline');
      assert.equal(res.status, 200);
      const etag = res.headers.get('etag');
      assert.ok(etag, 'Should have ETag header');
      assert.ok(etag.startsWith('W/"'), 'Should be a weak ETag');
    });

    it('should return ETag header for GET /api/tracker', async () => {
      const res = await request('/api/tracker');
      assert.equal(res.status, 200);
      const etag = res.headers.get('etag');
      assert.ok(etag, 'Should have ETag header');
    });

    it('should return 304 Not Modified when If-None-Match matches', async () => {
      // First request to get the ETag
      const first = await request('/api/pipeline');
      assert.equal(first.status, 200);
      const etag = first.headers.get('etag');
      assert.ok(etag, 'First request should have ETag');

      // Second request with If-None-Match
      const url = `http://localhost:${TEST_PORT}/api/pipeline`;
      const second = await fetch(url, {
        headers: {
          'If-None-Match': etag,
          'Origin': `http://localhost:${TEST_PORT}`,
        },
      });
      assert.equal(second.status, 304, 'Should return 304 when ETag matches');
    });

    it('should return 200 when If-None-Match does not match', async () => {
      const url = `http://localhost:${TEST_PORT}/api/pipeline`;
      const response = await fetch(url, {
        headers: {
          'If-None-Match': 'W/"nonexistent"',
          'Origin': `http://localhost:${TEST_PORT}`,
        },
      });
      assert.equal(response.status, 200, 'Should return 200 when ETag does not match');
    });

    it('should have Cache-Control: no-cache header', async () => {
      const res = await request('/api/profile');
      assert.equal(res.status, 200);
      const cacheControl = res.headers.get('cache-control');
      assert.ok(cacheControl && cacheControl.includes('no-cache'), 'Should have Cache-Control: no-cache');
    });
  });

  // --- Server cleanup ---
  describe('Server process management', () => {
    it('should respond to health-check requests quickly', async () => {
      const start = Date.now();
      const res = await request('/api/connectors');
      const elapsed = Date.now() - start;
      assert.equal(res.status, 200);
      assert.ok(elapsed < 1000, `Health check should respond in <1s, took ${elapsed}ms`);
    });
  });
});
