/* =========================================================
   Single blog post + comments
   ========================================================= */
(function () {
  'use strict';

  const S = window.Site;
  const { $, escapeHTML, formatDate, api, toast } = S;

  function showError(message) {
    $('#post-loading').hidden = true;
    const error = $('#post-error');
    error.hidden = false;
    if (message) {
      const p = error.querySelector('p');
      if (p) p.textContent = message;
    }
  }

  function commentsMarkup(post, user) {
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const countLabel = `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`;
    const list = comments.length
      ? comments
          .map(
            (comment) => `
          <div class="comment">
            <div class="comment__head">
              <span class="comment__avatar">${escapeHTML(S.initials(comment.name))}</span>
              <span class="comment__name">${escapeHTML(comment.name)}</span>
              <span class="comment__time">${escapeHTML(formatDate(comment.createdAt))}</span>
            </div>
            <p>${escapeHTML(comment.body).replace(/\n/g, '<br>')}</p>
          </div>`
          )
          .join('')
      : '<p class="muted" style="font-size:.9rem">No comments yet — start the discussion.</p>';

    const form = user
      ? `
        <form class="comment-form" id="comment-form" novalidate>
          <div class="form-error" id="comment-error" role="alert"></div>
          <label class="sr-only" for="comment-body">Your comment</label>
          <textarea id="comment-body" name="body" placeholder="Add a technical note or ask a question…" maxlength="1500" minlength="2" required></textarea>
          <div class="comment-form__row">
            <span>Signed in as <strong>${escapeHTML(user.name)}</strong> · comments are reviewed before publishing.</span>
            <button class="btn btn--primary btn--sm" type="submit">Post comment</button>
          </div>
        </form>`
      : `
        <div class="login-prompt">
          <span>Want to join the discussion? Members can comment on field notes.</span>
          <a class="btn btn--ghost btn--sm" href="/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}">Log in to comment</a>
        </div>`;

    return `
      <section class="comments" aria-labelledby="comments-title">
        <div class="comments__head">
          <h2 id="comments-title">Discussion</h2>
          <span class="comments__count">${countLabel}</span>
        </div>
        <div class="comment-list">${list}</div>
        ${form}
      </section>`;
  }

  function bindCommentForm(post, user) {
    const form = $('#comment-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#comment-error');
      errorBox.classList.remove('is-shown');
      const textarea = $('#comment-body');
      const body = textarea.value.trim();
      if (body.length < 2) {
        errorBox.textContent = 'Please write a little more before posting.';
        errorBox.classList.add('is-shown');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Posting…';
      try {
        await api(`/api/posts/${encodeURIComponent(post.id)}/comments`, {
          method: 'POST',
          body: { body }
        });
        textarea.value = '';
        toast('Comment submitted — it will appear after review.');
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.add('is-shown');
        if (error.status === 401) {
          window.setTimeout(() => (window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`), 1200);
        }
      } finally {
        button.disabled = false;
        button.textContent = 'Post comment';
      }
    });
  }

  function render(post, user) {
    const view = $('#post-view');
    const date = formatDate(post.publishedAt || post.createdAt);
    const reading = post.readingTime ? `${post.readingTime} min read` : S.readTime(post.content);
    const tags = (post.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('');
    const cover = post.cover
      ? `<figure class="post-cover"><img src="${escapeHTML(post.cover)}" alt="" width="1600" height="800" fetchpriority="high" decoding="async" /></figure>`
      : '';

    view.innerHTML = `
      <header class="post-header">
        <div class="post-header__meta">
          <span>Field note</span><span class="dot">/</span>
          <span>${escapeHTML(date)}</span><span class="dot">/</span>
          <span>${escapeHTML(reading)}</span>
        </div>
        <h1>${escapeHTML(post.title)}</h1>
        ${post.excerpt ? `<p class="post-header__excerpt">${escapeHTML(post.excerpt)}</p>` : ''}
        <div class="post-header__tags">${tags}</div>
      </header>
      ${cover}
      <div class="article">${S.renderMarkdown(post.content)}</div>
      <div class="post-footer">
        <div class="post-footer__tags">${tags}</div>
        <a class="section-head__link" href="/blog">All field notes</a>
      </div>
      <aside class="author-card" aria-label="About the author">
        <span class="author-card__avatar" aria-hidden="true">AS</span>
        <div>
          <h3>Aditya Sarwade</h3>
          <p>Mechanical engineer &amp; quality inspector · Latur, Maharashtra</p>
        </div>
        <a class="btn btn--ghost btn--sm" href="/#contact">Get in touch</a>
      </aside>
      ${commentsMarkup(post, user)}
      <a class="post-back" href="/blog">← Back to all field notes</a>
    `;

    const error = $('#post-error');
    error.hidden = true;
    view.hidden = false;
    if (window.Site.revealInit) window.Site.revealInit(view);
    bindCommentForm(post, user);

    document.title = `${post.title} — Aditya Sarwade`;
    const description = document.querySelector('meta[name="description"]');
    if (description && post.excerpt) description.setAttribute('content', post.excerpt);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', post.title);
  }

  async function load() {
    const slug = new URLSearchParams(window.location.search).get('slug');
    if (!slug) {
      showError('No note was selected. Pick one from the field notes.');
      return;
    }
    try {
      const [data, user] = await Promise.all([
        api(`/api/posts/${encodeURIComponent(slug)}`),
        S.currentUser().catch(() => null)
      ]);
      if (!data || !data.post) {
        showError();
        return;
      }
      $('#post-loading').hidden = true;
      render(data.post, user);
    } catch (error) {
      if (error.status === 404) {
        showError();
      } else {
        showError('Something went wrong while loading this note. Please try again in a moment.');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
