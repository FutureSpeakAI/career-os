/**
 * lib/compression.mjs -- Response compression middleware.
 *
 * Supports gzip and deflate using Node.js built-in zlib.
 * No external dependencies required.
 *
 * Usage:
 *   import { compressionMiddleware } from './lib/compression.mjs';
 *   app.use(compressionMiddleware());
 */

import { createGzip, createDeflate } from 'zlib';

// --- TUNABLE ---
const MIN_SIZE = 1024; // Only compress responses larger than 1KB
const COMPRESSIBLE_TYPES = /^(application\/json|text\/(html|css|javascript|plain|xml)|application\/javascript)/i;

/**
 * Express middleware that compresses response bodies using gzip or deflate
 * based on the Accept-Encoding request header.
 *
 * Skips compression for:
 * - Responses smaller than MIN_SIZE bytes
 * - Non-compressible content types (images, already-compressed)
 * - Requests that don't accept gzip/deflate
 * - HEAD requests
 */
export function compressionMiddleware() {
  return function compress(req, res, next) {
    // Skip HEAD requests
    if (req.method === 'HEAD') return next();

    const acceptEncoding = req.headers['accept-encoding'] || '';

    // Determine best encoding
    let encoding = null;
    if (acceptEncoding.includes('gzip')) {
      encoding = 'gzip';
    } else if (acceptEncoding.includes('deflate')) {
      encoding = 'deflate';
    }

    if (!encoding) return next();

    // Intercept res.json and res.send to compress
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    function compressAndSend(body) {
      // Convert to string/buffer
      let data;
      if (typeof body === 'string') {
        data = Buffer.from(body, 'utf-8');
      } else if (Buffer.isBuffer(body)) {
        data = body;
      } else {
        // For non-string/buffer, let original handle it
        return originalSend(body);
      }

      // Skip if too small
      if (data.length < MIN_SIZE) {
        return originalSend(body);
      }

      // Check content type
      const contentType = res.getHeader('content-type') || '';
      if (!COMPRESSIBLE_TYPES.test(contentType)) {
        return originalSend(body);
      }

      // Don't double-compress
      if (res.getHeader('content-encoding')) {
        return originalSend(body);
      }

      // Compress
      const stream = encoding === 'gzip' ? createGzip() : createDeflate();
      const chunks = [];

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const compressed = Buffer.concat(chunks);
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        originalSend(compressed);
      });
      stream.on('error', () => {
        // Fallback to uncompressed on error
        originalSend(body);
      });

      stream.end(data);
    }

    res.json = function (obj) {
      const body = JSON.stringify(obj);
      if (!res.getHeader('content-type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      compressAndSend(body);
      return res;
    };

    // Only override send for text/html responses (SPA fallback, static)
    // Leave it alone for other types to avoid double-processing
    const originalSendFile = res.sendFile ? res.sendFile.bind(res) : null;

    next();
  };
}
