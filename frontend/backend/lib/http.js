'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function redirect(res, location, status = 302) {
  if (res.headersSent) return;
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function readJson(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!type.includes('application/json')) {
      const error = new Error('Expected a JSON request body.');
      error.status = 415;
      reject(error);
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      const error = new Error('Request body too large.');
      error.status = 413;
      reject(error);
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const error = new Error('Request body too large.');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        const error = new Error('Invalid JSON body.');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function safeResolve(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  const target = path.resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function cacheControlFor(ext) {
  if (ext === '.html') return 'no-cache';
  if (['.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2'].includes(ext)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  return 'public, max-age=3600, stale-while-revalidate=86400';
}

async function serveFile(req, res, filePath, options = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const cache = options.cache || cacheControlFor(ext);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
    res.end();
    return true;
  }

  let body = await fs.promises.readFile(filePath);
  const headers = {
    'Content-Type': type,
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cache
  };

  const compressible =
    body.length > 900 &&
    (/^text\//.test(type) || /javascript|json|svg|xml/.test(type)) &&
    /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (compressible) {
    body = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }

  headers['Content-Length'] = body.length;
  res.writeHead(options.status || 200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
  return true;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded || req.socket.remoteAddress || 'unknown';
  return raw.replace(/^::ffff:/, '');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function createRateLimiter() {
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt < now) buckets.delete(key);
    }
  }, 10 * 60 * 1000);
  cleanup.unref();

  return function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

module.exports = {
  applySecurityHeaders,
  sendJson,
  redirect,
  readJson,
  safeResolve,
  serveFile,
  clientIp,
  sameOrigin,
  createRateLimiter
};
