'use strict';

const crypto = require('node:crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLENGTH = 64;

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, SCRYPT_KEYLENGTH).toString('hex');
  return { salt: useSalt, hash };
}

function verifyPassword(password, user) {
  if (!user || !user.salt || !user.passHash) return false;
  try {
    const candidate = crypto.scryptSync(password, user.salt, SCRYPT_KEYLENGTH);
    const stored = Buffer.from(user.passHash, 'hex');
    if (stored.length !== candidate.length) return false;
    return crypto.timingSafeEqual(stored, candidate);
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const cookies = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionCookie(token) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearedSessionCookie() {
  return 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function createAuth(store) {
  const sessions = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt < now) sessions.delete(token);
    }
  }, 60 * 60 * 1000);
  cleanup.unref();

  function findById(id) {
    return store.load('users').find((user) => user.id === id) || null;
  }

  function findByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return store.load('users').find((user) => user.email === normalized) || null;
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    };
  }

  function ensureAdmin() {
    const users = store.load('users');
    const email = String(process.env.ADMIN_EMAIL || 'admin@aditya.local').trim().toLowerCase();
    const existing = users.find((user) => user.email === email);
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        store.save('users');
      }
      return existing;
    }

    const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
    const { salt, hash } = hashPassword(password);
    const admin = {
      id: crypto.randomUUID(),
      name: process.env.ADMIN_NAME || 'Aditya Sarwade',
      email,
      passHash: hash,
      salt,
      role: 'admin',
      createdAt: new Date().toISOString()
    };
    users.push(admin);
    store.save('users');
    console.log(`[auth] Seeded admin account: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log('[auth] Default admin password: Admin@12345 — change it from Admin → Settings.');
    }
    return admin;
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  function destroySession(token) {
    if (token) sessions.delete(token);
  }

  function invalidateUserSessions(userId, exceptToken) {
    for (const [token, session] of sessions) {
      if (session.userId === userId && token !== exceptToken) sessions.delete(token);
    }
  }

  function getUserFromRequest(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return findById(session.userId);
  }

  function sessionToken(req) {
    return parseCookies(req.headers.cookie).sid || '';
  }

  return {
    ensureAdmin,
    findById,
    findByEmail,
    publicUser,
    createSession,
    destroySession,
    invalidateUserSessions,
    getUserFromRequest,
    sessionToken,
    hashPassword,
    verifyPassword
  };
}

module.exports = {
  createAuth,
  hashPassword,
  verifyPassword,
  parseCookies,
  sessionCookie,
  clearedSessionCookie,
  SESSION_TTL_MS
};
