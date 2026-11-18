/* =========================================================
   Blog listing + latest posts on home
   ========================================================= */
(function () {
  'use strict';

  const { $, escapeHTML, formatDate, api, toast } = window.Site;

  const state = {
    posts: [],
    tag: '',
    query: ''
  };

  function postCard(post, options = {}) {
    const { featured = false, delay = 0 } = options;
    const tags = (post.tags || [])
      .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
      .join('');
    const date = formatDate(post.publishedAt || post.createdAt);
    const reading = post.readingTime ? `${post.readingTime} min read` : '';
    const href = `/post.html?slug=${encodeURIComponent(post.slug)}`;
    const cover = escapeHTML(post.cover || 'assets/img/blog-cad.webp');

    return `
      <article class="post-card${featured ? ' post-card--featured' : ''} tilt-sheen" data-tilt data-reveal style="--reveal-delay:${delay}ms">
        <div class="post-card__media">
          ${featured ? '<span class="post-card__label">Latest note</span>' : ''}
          <img src="${cover}" alt="" width="1600" height="1067" loading="lazy" decoding="async" />
        </div>
        <div class="post-card__body">
          <div class="post-card__meta">
            <span>${escapeHTML(date)}</span>
            ${reading ? `<span class="dot">·</span><span>${escapeHTML(reading)}</span>` : ''}
          </div>
          <h3><a href="${href}">${escapeHTML(post.title)}</a></h3>
          <p>${escapeHTML(post.excerpt || '')}</p>
          <div class="post-card__tags">${tags}</div>
          <span class="post-card__more">Read note
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </div>
      </article>`;
  }

  function renderInto(container, html) {
    container.innerHTML = html;
    if (window.Site.tiltInit) window.Site.tiltInit(container);
    if (window.Site.revealInit) window.Site.revealInit(container);
  }

  function filtered() {
    const query = state.query.trim().toLowerCase();
    return state.posts.filter((post) => {
      const matchesTag = !state.tag || (post.tags || []).includes(state.tag);
      if (!matchesTag) return false;
      if (!query) return true;
      const haystack = [post.title, post.excerpt, (post.tags || []).join(' ')].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderFeatured(container, options = {}) {
    if (!container) return;
    const posts = state.posts;
    if (!posts.length) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <strong>No field notes published yet.</strong>
          New notes will appear here as soon as they are published.
        </div>`;
      return;
    }
    if (options.limit) {
      renderInto(container, posts.slice(0, options.limit).map((post, index) => postCard(post, { delay: index * 70 })).join(''));
      return;
    }
    renderInto(container, posts.map((post, index) => postCard(post, { delay: index * 60 })).join(''));
  }

  function buildFilters() {
    const container = $('#blog-filters');
    if (!container) return;
    const tags = Array.from(new Set(state.posts.flatMap((post) => post.tags || []))).sort((a, b) => a.localeCompare(b));
    const buttons = [`<button type="button" class="chip chip--filter" data-tag="" aria-pressed="${state.tag === ''}">All</button>`]
      .concat(
        tags.map(
          (tag) =>
            `<button type="button" class="chip chip--filter" data-tag="${escapeHTML(tag)}" aria-pressed="${state.tag === tag}">${escapeHTML(tag)}</button>`
        )
      )
      .join('');
    container.innerHTML = buttons;
  }

  function renderList() {
    const grid = $('#post-grid');
    if (!grid) return;
    const results = filtered();
    const count = $('#blog-count');
    const empty = $('#blog-empty');
    const query = state.query.trim();

    if (count) {
      const label = results.length === 1 ? 'note' : 'notes';
      count.textContent = `${results.length} ${label}${state.tag ? ` in ${state.tag}` : ''}${query ? ` matching “${query}”` : ''}`;
    }

    if (!results.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const featuredEligible = !state.tag && !query;
    const html = results
      .map((post, index) =>
        postCard(post, {
          featured: featuredEligible && index === 0,
          delay: Math.min(index * 55, 220)
        })
      )
      .join('');
    renderInto(grid, html);
  }

  function syncTagButtons() {
    if (!window.Site.$$) return;
    window.Site.$$('.chip--filter').forEach((button) => {
      button.setAttribute('aria-pressed', String((button.dataset.tag || '') === state.tag));
    });
  }

  function setupFilters() {
    const container = $('#blog-filters');
    if (!container) return;
    container.addEventListener('click', (event) => {
      const button = event.target.closest('.chip--filter');
      if (!button) return;
      state.tag = button.dataset.tag || '';
      syncTagButtons();
      renderList();
      const url = new URL(window.location.href);
      if (state.tag) url.searchParams.set('tag', state.tag);
      else url.searchParams.delete('tag');
      window.history.replaceState({}, '', url);
    });
  }

  function setupSearch() {
    const input = $('#blog-search-input');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        state.query = input.value;
        renderList();
      }, 160);
    });
  }

  async function load() {
    const grid = $('#post-grid');
    const latest = $('#latest-posts');
    const count = $('#blog-count');
    try {
      const data = await api('/api/posts');
      state.posts = Array.isArray(data && data.posts) ? data.posts : [];

      if (grid) {
        const params = new URLSearchParams(window.location.search);
        state.tag = params.get('tag') || '';
        buildFilters();
        setupFilters();
        setupSearch();
        renderList();
        if (count && !state.posts.length) count.textContent = '0 notes';
      }
      if (latest) {
        renderFeatured(latest, { limit: 3 });
      }
    } catch (error) {
      const fallback = `<div class="empty-state" style="grid-column:1/-1"><strong>Couldn't load the field notes.</strong>Make sure the backend server is running, then refresh.</div>`;
      if (grid) {
        grid.innerHTML = fallback;
        if (count) count.textContent = 'Unavailable';
      }
      if (latest) latest.innerHTML = fallback;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
