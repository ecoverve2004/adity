/* =========================================================
   Shared utilities + site chrome behavior
   ========================================================= */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  async function api(path, options = {}) {
    const opts = {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...options
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const error = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function readTime(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 215))} min read`;
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  function toast(message, type = 'success') {
    const stack = $('#toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    stack.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => el.remove(), 280);
    }, 4200);
  }

  function renderInline(raw) {
    let text = escapeHTML(raw);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return text;
  }

  /**
   * Small, safe markdown subset: headings (##), bold, italic, inline code,
   * links, ordered/unordered lists, blockquotes and horizontal rules.
   */
  function renderMarkdown(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushParagraph();
        closeList();
        continue;
      }
      let match;
      if ((match = line.match(/^(#{2,4})\s+(.*)$/))) {
        flushParagraph();
        closeList();
        const level = Math.min(match[1].length, 4);
        out.push(`<h${level}>${renderInline(match[2])}</h${level}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(line)) {
        flushParagraph();
        closeList();
        out.push('<hr>');
        continue;
      }
      if ((match = line.match(/^[-*]\s+(.*)$/))) {
        flushParagraph();
        if (listType !== 'ul') {
          closeList();
          out.push('<ul>');
          listType = 'ul';
        }
        out.push(`<li>${renderInline(match[1])}</li>`);
        continue;
      }
      if ((match = line.match(/^\d+[.)]\s+(.*)$/))) {
        flushParagraph();
        if (listType !== 'ol') {
          closeList();
          out.push('<ol>');
          listType = 'ol';
        }
        out.push(`<li>${renderInline(match[1])}</li>`);
        continue;
      }
      if ((match = line.match(/^>\s?(.*)$/))) {
        flushParagraph();
        closeList();
        out.push(`<blockquote>${renderInline(match[1])}</blockquote>`);
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
    closeList();
    return out.join('\n');
  }

  /* ---------- Scroll reveal ---------- */
  function revealInit(root = document) {
    const items = $$('[data-reveal]', root).filter((el) => !el.classList.contains('is-visible'));
    if (!items.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    items.forEach((el) => observer.observe(el));
  }

  /* ---------- 3D tilt ---------- */
  function tiltInit(root = document) {
    if (reduceMotion || window.matchMedia('(pointer: coarse)').matches) return;
    $$('[data-tilt]', root).forEach((el) => {
      if (el.dataset.tiltBound === 'true') return;
      el.dataset.tiltBound = 'true';
      let frame = null;
      let rect = null;

      const update = (event) => {
        frame = null;
        if (!rect) return;
        const px = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const py = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
        el.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${((0.5 - py) * 7).toFixed(2)}deg`);
        el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      };

      el.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        rect = el.getBoundingClientRect();
        el.classList.add('is-tilting');
      });
      el.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' || !rect) return;
        if (frame) return;
        frame = window.requestAnimationFrame(() => update(event));
      });
      el.addEventListener('pointerleave', () => {
        rect = null;
        if (frame) {
          window.cancelAnimationFrame(frame);
          frame = null;
        }
        el.classList.remove('is-tilting');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Header / navigation ---------- */
  function setupNav() {
    const header = $('#site-header');
    const toggle = $('#nav-toggle');
    const menu = $('#header-menu');
    if (!header) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        header.classList.toggle('is-scrolled', y > 12);
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const progress = max > 0 ? Math.min(y / max, 1) : 0;
        header.style.setProperty('--scroll-progress', progress.toFixed(4));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (toggle && menu) {
      const closeMenu = () => {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      };
      toggle.addEventListener('click', () => {
        const open = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
      menu.addEventListener('click', (event) => {
        if (event.target.closest('a')) closeMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
      });
      document.addEventListener('pointerdown', (event) => {
        if (!menu.classList.contains('is-open')) return;
        if (!menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 960) closeMenu();
      });
    }

    /* Scroll spy for same-page anchors */
    const spyLinks = $$('#primary-nav a[href*="#"]');
    const sections = spyLinks
      .map((link) => {
        const hash = link.getAttribute('href').split('#')[1];
        const section = hash ? document.getElementById(hash) : null;
        return section ? { link, section } : null;
      })
      .filter(Boolean);

    if (sections.length && 'IntersectionObserver' in window) {
      const updateActive = (active) => {
        sections.forEach(({ link, section }) => {
          const isActive = section === active;
          link.classList.toggle('is-active', isActive);
          if (isActive) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      };
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible) {
            const match = sections.find(({ section }) => section === visible.target);
            if (match) updateActive(match.section);
          }
        },
        { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.2, 0.6] }
      );
      sections.forEach(({ section }) => observer.observe(section));
    }
  }

  /* ---------- Auth state in header ---------- */
  let userPromise = null;

  function currentUser(force = false) {
    if (!userPromise || force) {
      userPromise = api('/api/auth/me').then((data) => (data && data.user) || null);
    }
    return userPromise;
  }

  function updateHeaderAuth(user) {
    const actions = $('#header-actions');
    if (!actions) return;
    if (!user) {
      actions.innerHTML = `
        <a class="btn btn--ghost btn--sm" href="/auth" data-auth-link>Log in</a>
        <a class="btn btn--primary btn--sm" href="/#contact">Hire me</a>`;
      return;
    }
    const target = user.role === 'admin' ? '/admin/' : '/blog';
    actions.innerHTML = `
      <a class="user-chip" href="${escapeHTML(target)}" title="${user.role === 'admin' ? 'Open admin dashboard' : 'Member account'}">
        <span class="user-chip__avatar">${escapeHTML(initials(user.name))}</span>
        <span class="user-chip__name">${escapeHTML(user.name)}</span>
      </a>
      <button class="btn btn--ghost btn--sm" type="button" data-logout>Log out</button>`;
    const logout = $('[data-logout]', actions);
    if (logout) {
      logout.addEventListener('click', async () => {
        logout.setAttribute('aria-busy', 'true');
        try {
          await api('/api/auth/logout', { method: 'POST' });
          userPromise = null;
          toast('Signed out.');
          window.setTimeout(() => window.location.reload(), 350);
        } catch (error) {
          toast(error.message, 'error');
          logout.removeAttribute('aria-busy');
        }
      });
    }
  }

  /* ---------- Contact form ---------- */
  function setupContact() {
    const form = $('#contact-form');
    if (!form) return;
    const errorBox = $('#contact-error');
    const submit = $('#contact-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.classList.remove('is-shown');
      errorBox.textContent = '';

      if (form.website && form.website.value) return;

      if (!form.reportValidity()) return;
      const payload = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        subject: (form.subject.value || '').trim(),
        message: form.message.value.trim(),
        website: form.website ? form.website.value : ''
      };
      if (!payload.name || !payload.email || !payload.message) {
        errorBox.textContent = 'Please fill in your name, email and message.';
        errorBox.classList.add('is-shown');
        return;
      }

      submit.setAttribute('aria-busy', 'true');
      submit.disabled = true;
      const label = submit.innerHTML;
      submit.textContent = 'Sending…';
      try {
        await api('/api/contact', { method: 'POST', body: payload });
        form.reset();
        toast('Message sent. Thank you — I will get back to you.');
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.add('is-shown');
      } finally {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
        submit.innerHTML = label;
      }
    });
  }

  function setupCounters() {
    const counters = $$('.counter');
    if (!counters.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      counters.forEach((el) => (el.textContent = el.dataset.count));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = Number(el.dataset.count) || 0;
          const duration = 900;
          const start = performance.now();
          const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            el.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) window.requestAnimationFrame(step);
          };
          window.requestAnimationFrame(step);
          observer.unobserve(el);
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => observer.observe(el));
  }

  function updateYear() {
    const year = new Date().getFullYear();
    $$('[data-year]').forEach((el) => (el.textContent = String(year)));
  }

  function boot() {
    setupNav();
    revealInit();
    tiltInit();
    updateYear();
    setupContact();
    setupCounters();
    currentUser()
      .then(updateHeaderAuth)
      .catch(() => updateHeaderAuth(null));
  }

  window.Site = {
    $,
    $$,
    api,
    escapeHTML,
    formatDate,
    readTime,
    initials,
    toast,
    renderMarkdown,
    revealInit,
    tiltInit,
    currentUser,
    updateHeaderAuth
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
