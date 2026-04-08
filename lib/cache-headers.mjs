/**
 * lib/cache-headers.mjs -- ETag and cache control middleware.
 *
 * Provides ETag-based cache validation for GET API endpoints that read files.
 * When data files haven't changed, returns 304 Not Modified.
 *
 * Usage:
 *   import { createFileCache } from './lib/cache-headers.mjs';
 *   const cache = createFileCache();
 *   app.get('/api/pipeline', cache.middleware(PATHS.pipeline), handler);
 */

import { stat } from 'fs/promises';
import { createHash } from 'crypto';

/**
 * Create a file-backed cache that tracks file modification times.
 * When a watched file changes, ETags are invalidated.
 */
export function createFileCache() {
  // Cache of file mtimes: path -> mtime epoch ms
  const mtimeCache = new Map();

  // --- TUNABLE ---
  const STALE_CHECK_MS = 2000; // How often to re-stat files (2 seconds)
  const lastChecked = new Map(); // path -> last stat time

  /**
   * Get a fast ETag for a file based on its mtime.
   * Returns null if file doesn't exist.
   */
  async function getFileETag(filePath) {
    const now = Date.now();
    const lastCheck = lastChecked.get(filePath) || 0;

    // Only re-stat if enough time has passed
    if (now - lastCheck > STALE_CHECK_MS) {
      try {
        const stats = await stat(filePath);
        mtimeCache.set(filePath, stats.mtimeMs);
        lastChecked.set(filePath, now);
      } catch {
        mtimeCache.delete(filePath);
        lastChecked.set(filePath, now);
        return null;
      }
    }

    const mtime = mtimeCache.get(filePath);
    if (!mtime) return null;

    // ETag = hash of filepath + mtime (weak ETag since content may vary slightly)
    const hash = createHash('md5').update(`${filePath}:${mtime}`).digest('hex').slice(0, 16);
    return `W/"${hash}"`;
  }

  /**
   * Invalidate the cache for a specific file (call after writes).
   */
  function invalidate(filePath) {
    mtimeCache.delete(filePath);
    lastChecked.delete(filePath);
  }

  /**
   * Express middleware that adds ETag/Last-Modified headers
   * and returns 304 if the client's cached version is still valid.
   *
   * @param {...string} filePaths - One or more file paths to watch for changes
   */
  function middleware(...filePaths) {
    return async function cacheMiddleware(req, res, next) {
      // Only apply to GET requests
      if (req.method !== 'GET') return next();

      try {
        // Compute combined ETag from all watched files
        const etags = await Promise.all(filePaths.map(fp => getFileETag(fp)));
        const validEtags = etags.filter(Boolean);

        if (validEtags.length > 0) {
          // Combine ETags for multi-file endpoints
          const combinedTag = validEtags.length === 1
            ? validEtags[0]
            : `W/"${createHash('md5').update(validEtags.join(':')).digest('hex').slice(0, 16)}"`;

          res.setHeader('ETag', combinedTag);
          res.setHeader('Cache-Control', 'no-cache'); // Must revalidate, but can use ETag

          // Check If-None-Match
          const clientETag = req.headers['if-none-match'];
          if (clientETag && clientETag === combinedTag) {
            return res.status(304).end();
          }
        }
      } catch {
        // Cache header failures should never block the response
      }

      next();
    };
  }

  return { middleware, invalidate, getFileETag };
}
