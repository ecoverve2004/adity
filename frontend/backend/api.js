'use strict';

const crypto = require('node:crypto');
const { sendJson, readJson, sameOrigin, clientIp } = require('./lib/http');
const { sessionCookie, clearedSessionCookie } = require('./lib/auth');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COVERS_PATTERN = /^\/assets\/img\/[A-Za-z0-9._-]+$/;
const STATUSES = new Set(['published', 'draft']);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, min, max, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) fail(400, `${label} is required.`);
  if (text.length > max) fail(400, `${label} is too long (max ${max} characters).`);
  return text;
}

function optionalText(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) fail(400, `This field is limited to ${max} characters.`);
  return text;
}

function readingMinutes(content) {
  const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 215));
}

function slugify(input) {
  return (
    String(input || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'field-note'
  );
}

function uniqueSlug(posts, base, excludeId) {
  let slug = base;
  let counter = 2;
  while (posts.some((post) => post.slug === slug && post.id !== excludeId)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function sanitizeTags(input) {
  let list = input;
  if (typeof list === 'string') list = list.split(',');
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const tag = String(item || '').trim().slice(0, 24);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 5) break;
  }
  return tags;
}

function normalizeCover(value) {
  const cover = typeof value === 'string' ? value.trim() : '';
  if (!cover) return '';
  if (!COVERS_PATTERN.test(cover)) fail(400, 'Cover must be an image from /assets/img/.');
  return cover;
}

function excerptFrom(content) {
  const plain = String(content || '')
    .replace(/[#>*`\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 177)}…` : plain;
}

function postSummary(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    cover: post.cover,
    tags: post.tags,
    status: post.status,
    createdAt: post.createdAt,
    publishedAt: post.publishedAt,
    readingTime: readingMinutes(post.content)
  };
}

function publishedOrder(a, b) {
  const aDate = new Date(a.publishedAt || a.createdAt).getTime();
  const bDate = new Date(b.publishedAt || b.createdAt).getTime();
  return bDate - aDate;
}

function createApi({ store, auth, rateLimit }) {
  function requireUser(req) {
    const user = auth.getUserFromRequest(req);
    if (!user) fail(401, 'Please log in to continue.');
    return user;
  }

  function requireAdmin(req) {
    const user = requireUser(req);
    if (user.role !== 'admin') fail(403, 'Admin access is required.');
    return user;
  }

  async function handle(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (!readOnly && !sameOrigin(req)) {
      sendJson(res, 403, { error: 'Origin not allowed.' });
      return true;
    }

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      return true;
    }

    /* ---------------- Auth ---------------- */
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = auth.getUserFromRequest(req);
      sendJson(res, 200, { user: auth.publicUser(user) });
      return true;
    }

    if (pathname === '/api/auth/signup' && method === 'POST') {
      const ip = clientIp(req);
      if (!rateLimit(`signup:${ip}`, 10, 60 * 60 * 1000)) {
        fail(429, 'Too many sign-up attempts. Please try again later.');
      }
      const body = await readJson(req);
      const name = cleanText(body.name, 2, 80, 'Name');
      const email = cleanText(body.email, 5, 120, 'Email').toLowerCase();
      const password = cleanText(body.password, 8, 100, 'Password');
      if (!EMAIL_PATTERN.test(email)) fail(400, 'Please enter a valid email address.');
      if (auth.findByEmail(email)) fail(409, 'An account with that email already exists.');

      const { salt, hash } = auth.hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passHash: hash,
        salt,
        role: 'member',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      store.load('users').push(user);
      await store.save('users');

      const token = auth.createSession(user.id);
      sendJson(res, 201, { ok: true, user: auth.publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
      return true;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const ip = clientIp(req);
      if (!rateLimit(`login:${ip}`, 12, 15 * 60 * 1000)) {
        fail(429, 'Too many login attempts. Please wait a few minutes and try again.');
      }
      const body = await readJson(req);
      const email = cleanText(body.email, 5, 120, 'Email').toLowerCase();
      const password = cleanText(body.password, 1, 100, 'Password');
      const user = auth.findByEmail(email);
      if (!user || !auth.verifyPassword(password, user)) {
        fail(401, 'Invalid email or password.');
      }
      user.lastLoginAt = new Date().toISOString();
      store.save('users');
      const token = auth.createSession(user.id);
      sendJson(res, 200, { ok: true, user: auth.publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
      return true;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      auth.destroySession(auth.sessionToken(req));
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearedSessionCookie() });
      return true;
    }

    /* ---------------- Public posts ---------------- */
    if (pathname === '/api/posts' && method === 'GET') {
      const posts = store
        .load('posts')
        .filter((post) => post.status === 'published')
        .sort(publishedOrder)
        .map(postSummary);
      sendJson(res, 200, { posts });
      return true;
    }

    const publicPostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (publicPostMatch && method === 'GET') {
      let slug;
      try {
        slug = decodeURIComponent(publicPostMatch[1]);
      } catch {
        fail(400, 'Invalid post link.');
      }
      const post = store.load('posts').find((item) => item.slug === slug && item.status === 'published');
      if (!post) fail(404, 'Post not found.');
      const comments = store
        .load('comments')
        .filter((comment) => comment.postId === post.id && comment.status === 'approved')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((comment) => ({
          id: comment.id,
          name: comment.name,
          body: comment.body,
          createdAt: comment.createdAt
        }));
      sendJson(res, 200, { post: { ...postSummary(post), content: post.content, comments } });
      return true;
    }

    const commentCreateMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if (commentCreateMatch && method === 'POST') {
      const user = requireUser(req);
      if (!rateLimit(`comment:${user.id}`, 8, 10 * 60 * 1000)) {
        fail(429, 'You are commenting too quickly. Please slow down a little.');
      }
      const body = await readJson(req);
      const text = cleanText(body.body, 2, 1500, 'Comment');
      const post = store.load('posts').find((item) => item.id === commentCreateMatch[1] && item.status === 'published');
      if (!post) fail(404, 'Post not found.');
      const comment = {
        id: crypto.randomUUID(),
        postId: post.id,
        userId: user.id,
        name: user.name,
        body: text,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      store.load('comments').push(comment);
      await store.save('comments');
      sendJson(res, 201, { ok: true, comment: { id: comment.id, status: comment.status } });
      return true;
    }

    /* ---------------- Contact ---------------- */
    if (pathname === '/api/contact' && method === 'POST') {
      const body = await readJson(req);
      if (typeof body.website === 'string' && body.website.trim()) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      const ip = clientIp(req);
      if (!rateLimit(`contact:${ip}`, 5, 60 * 60 * 1000)) {
        fail(429, 'Too many messages from this address. Please try again later.');
      }
      const name = cleanText(body.name, 2, 80, 'Name');
      const email = cleanText(body.email, 5, 120, 'Email').toLowerCase();
      if (!EMAIL_PATTERN.test(email)) fail(400, 'Please enter a valid email address.');
      const subject = optionalText(body.subject, 120);
      const message = cleanText(body.message, 10, 3000, 'Message');
      const entry = {
        id: crypto.randomUUID(),
        name,
        email,
        subject,
        message,
        read: false,
        createdAt: new Date().toISOString()
      };
      store.load('messages').push(entry);
      await store.save('messages');
      sendJson(res, 201, { ok: true });
      return true;
    }

    /* ---------------- Admin ---------------- */
    if (pathname === '/api/admin/stats' && method === 'GET') {
      requireAdmin(req);
      const posts = store.load('posts');
      const comments = store.load('comments');
      const messages = store.load('messages');
      const users = store.load('users');
      sendJson(res, 200, {
        stats: {
          posts: {
            total: posts.length,
            published: posts.filter((post) => post.status === 'published').length,
            drafts: posts.filter((post) => post.status === 'draft').length
          },
          comments: {
            total: comments.length,
            pending: comments.filter((comment) => comment.status === 'pending').length,
            approved: comments.filter((comment) => comment.status === 'approved').length
          },
          messages: {
            total: messages.length,
            unread: messages.filter((message) => !message.read).length
          },
          members: users.filter((user) => user.role === 'member').length
        }
      });
      return true;
    }

    if (pathname === '/api/admin/posts' && method === 'GET') {
      requireAdmin(req);
      const posts = [...store.load('posts')].sort(
        (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
      );
      sendJson(res, 200, { posts });
      return true;
    }

    if (pathname === '/api/admin/posts' && method === 'POST') {
      requireAdmin(req);
      const body = await readJson(req);
      const title = cleanText(body.title, 3, 140, 'Title');
      const content = cleanText(body.content, 10, 60000, 'Content');
      const status = STATUSES.has(body.status) ? body.status : 'draft';
      const excerpt = optionalText(body.excerpt, 400) || excerptFrom(content);
      const cover = normalizeCover(body.cover);
      const tags = sanitizeTags(body.tags);
      const posts = store.load('posts');
      const now = new Date().toISOString();
      const slugSource = optionalText(body.slug, 90);
      const post = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(posts, slugify(slugSource || title)),
        title,
        excerpt,
        content,
        cover,
        tags,
        status,
        createdAt: now,
        updatedAt: now,
        publishedAt: status === 'published' ? now : null
      };
      posts.push(post);
      await store.save('posts');
      sendJson(res, 201, { ok: true, post });
      return true;
    }

    const adminPostMatch = pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
    if (adminPostMatch && (method === 'PUT' || method === 'PATCH')) {
      requireAdmin(req);
      const posts = store.load('posts');
      const post = posts.find((item) => item.id === adminPostMatch[1]);
      if (!post) fail(404, 'Post not found.');
      const body = await readJson(req);

      if (body.title !== undefined) post.title = cleanText(body.title, 3, 140, 'Title');
      if (body.content !== undefined) post.content = cleanText(body.content, 10, 60000, 'Content');
      if (body.excerpt !== undefined) post.excerpt = optionalText(body.excerpt, 400);
      if (body.cover !== undefined) post.cover = normalizeCover(body.cover);
      if (body.tags !== undefined) post.tags = sanitizeTags(body.tags);
      if (body.slug !== undefined && String(body.slug).trim()) {
        post.slug = uniqueSlug(posts, slugify(body.slug), post.id);
      }
      if (!post.excerpt) post.excerpt = excerptFrom(post.content);
      if (body.status !== undefined) {
        if (!STATUSES.has(body.status)) fail(400, 'Invalid status.');
        post.status = body.status;
        if (post.status === 'published' && !post.publishedAt) post.publishedAt = new Date().toISOString();
      }
      post.updatedAt = new Date().toISOString();
      await store.save('posts');
      sendJson(res, 200, { ok: true, post });
      return true;
    }

    if (adminPostMatch && method === 'DELETE') {
      requireAdmin(req);
      const id = adminPostMatch[1];
      const posts = store.load('posts');
      const index = posts.findIndex((item) => item.id === id);
      if (index === -1) fail(404, 'Post not found.');
      posts.splice(index, 1);
      const comments = store.load('comments');
      const remaining = comments.filter((comment) => comment.postId !== id);
      comments.length = 0;
      comments.push(...remaining);
      await Promise.all([store.save('posts'), store.save('comments')]);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/admin/comments' && method === 'GET') {
      requireAdmin(req);
      const posts = store.load('posts');
      const users = store.load('users');
      const comments = [...store.load('comments')]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((comment) => {
          const post = posts.find((item) => item.id === comment.postId);
          const author = users.find((item) => item.id === comment.userId);
          return {
            ...comment,
            postTitle: post ? post.title : '(deleted post)',
            postSlug: post ? post.slug : '',
            email: author ? author.email : ''
          };
        });
      sendJson(res, 200, { comments });
      return true;
    }

    const adminCommentMatch = pathname.match(/^\/api\/admin\/comments\/([^/]+)$/);
    if (adminCommentMatch && (method === 'PATCH' || method === 'PUT')) {
      requireAdmin(req);
      const body = await readJson(req);
      if (!['approved', 'pending'].includes(body.status)) fail(400, 'Status must be approved or pending.');
      const comment = store.load('comments').find((item) => item.id === adminCommentMatch[1]);
      if (!comment) fail(404, 'Comment not found.');
      comment.status = body.status;
      await store.save('comments');
      sendJson(res, 200, { ok: true, comment });
      return true;
    }

    if (adminCommentMatch && method === 'DELETE') {
      requireAdmin(req);
      const comments = store.load('comments');
      const index = comments.findIndex((item) => item.id === adminCommentMatch[1]);
      if (index === -1) fail(404, 'Comment not found.');
      comments.splice(index, 1);
      await store.save('comments');
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/admin/messages' && method === 'GET') {
      requireAdmin(req);
      const messages = [...store.load('messages')].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      sendJson(res, 200, { messages });
      return true;
    }

    const adminMessageMatch = pathname.match(/^\/api\/admin\/messages\/([^/]+)$/);
    if (adminMessageMatch && (method === 'PATCH' || method === 'PUT')) {
      requireAdmin(req);
      const body = await readJson(req);
      const message = store.load('messages').find((item) => item.id === adminMessageMatch[1]);
      if (!message) fail(404, 'Message not found.');
      message.read = Boolean(body.read);
      await store.save('messages');
      sendJson(res, 200, { ok: true, message });
      return true;
    }

    if (adminMessageMatch && method === 'DELETE') {
      requireAdmin(req);
      const messages = store.load('messages');
      const index = messages.findIndex((item) => item.id === adminMessageMatch[1]);
      if (index === -1) fail(404, 'Message not found.');
      messages.splice(index, 1);
      await store.save('messages');
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/admin/password' && method === 'POST') {
      const user = requireAdmin(req);
      const body = await readJson(req);
      const current = cleanText(body.currentPassword, 1, 100, 'Current password');
      if (!auth.verifyPassword(current, user)) fail(400, 'Current password is incorrect.');
      const next = cleanText(body.newPassword, 8, 100, 'New password');
      const { salt, hash } = auth.hashPassword(next);
      user.salt = salt;
      user.passHash = hash;
      user.updatedAt = new Date().toISOString();
      await store.save('users');
      auth.invalidateUserSessions(user.id, auth.sessionToken(req));
      sendJson(res, 200, { ok: true });
      return true;
    }

    return false;
  }

  return handle;
}

module.exports = { createApi };
