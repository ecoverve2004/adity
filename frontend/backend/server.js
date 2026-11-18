'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { createStore } = require('./lib/store');
const { createAuth } = require('./lib/auth');
const { createApi } = require('./api');
const {
  applySecurityHeaders,
  sendJson,
  redirect,
  serveFile,
  safeResolve,
  createRateLimiter
} = require('./lib/http');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const ADMIN_DIR = path.join(ROOT, 'admin');

const store = createStore(path.join(__dirname, 'data'));
const auth = createAuth(store);
auth.ensureAdmin();
const api = createApi({ store, auth, rateLimit: createRateLimiter() });

function methodAllowed(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return false;
  }
  return true;
}

async function serveFrontend(req, res, pathname) {
  let target = pathname === '/' ? '/index.html' : pathname;
  const candidates = [target];

  if (!path.extname(target)) {
    const trimmed = target.replace(/\/+$/, '');
    if (trimmed) candidates.push(`${trimmed}.html`);
    if (trimmed) candidates.push(path.posix.join(trimmed, 'index.html'));
    else candidates.push('/index.html');
  }

  for (const candidate of candidates) {
    const file = safeResolve(FRONTEND_DIR, candidate);
    if (!file) continue;
    if (await serveFile(req, res, file)) return true;
  }

  const notFoundPage = path.join(FRONTEND_DIR, '404.html');
  if (fs.existsSync(notFoundPage)) {
    await serveFile(req, res, notFoundPage, { status: 404 });
    return true;
  }
  sendJson(res, 404, { error: 'Not found.' });
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    applySecurityHeaders(res);

    if (url.pathname.startsWith('/api/')) {
      const handled = await api(req, res, url);
      if (!handled) sendJson(res, 404, { error: 'API route not found.' });
      return;
    }

    if (!methodAllowed(req, res)) return;

    if (url.pathname === '/admin') {
      redirect(res, '/admin/');
      return;
    }

    if (url.pathname.startsWith('/admin/')) {
      let rest = url.pathname.slice('/admin'.length) || '/';
      if (rest.endsWith('/')) rest += 'index.html';
      const file = safeResolve(ADMIN_DIR, rest);
      if (file && (await serveFile(req, res, file))) return;
      sendJson(res, 404, { error: 'Admin page not found.' });
      return;
    }

    await serveFrontend(req, res, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('[server]', error);
    if (!res.headersSent) {
      applySecurityHeaders(res);
      sendJson(res, status, {
        error: status >= 500 ? 'Something went wrong on the server.' : error.message
      });
    } else {
      res.end();
    }
  }
});

server.headersTimeout = 20000;
server.requestTimeout = 30000;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try: PORT=${PORT + 1} npm start\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Aditya Sarwade — portfolio server');
  console.log(`  Site     http://localhost:${PORT}/`);
  console.log(`  Blog     http://localhost:${PORT}/blog`);
  console.log(`  Admin    http://localhost:${PORT}/admin/`);
  console.log(`  Data     ${path.join(__dirname, 'data')}`);
  console.log('  Zero runtime dependencies. Press Ctrl+C to stop.');
  console.log('');
});

function shutdown(signal) {
  console.log(`\n  ${signal} received — shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
