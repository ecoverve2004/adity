/* =========================================================
   Admin dashboard
   ========================================================= */
(function () {
  'use strict';

  const S = window.Site;
  const { $, $$, api, escapeHTML, formatDate, toast, initials, renderMarkdown } = S;

  const state = {
    user: null,
    posts: [],
    comments: [],
    messages: [],
    stats: null,
    postFilter: 'all',
    commentFilter: 'all',
    postQuery: '',
    editingId: null
  };

  const VIEW_META = {
    overview: ['Overview', 'Everything that needs your attention today.'],
    posts: ['Posts', 'Write, publish and edit field notes.'],
    comments: ['Comments', 'Approve member comments before they go public.'],
    messages: ['Messages', 'Contact form submissions from the portfolio.'],
    settings: ['Settings', 'Account and security.']
  };

  const COVER_FALLBACKS = [
    ['/assets/img/blog-cad.webp', 'CAD wireframe'],
    ['/assets/img/blog-metrology.webp', 'CMM / metrology'],
    ['/assets/img/blog-quality-docs.webp', 'Inspection desk'],
    ['/assets/img/blog-career.webp', 'Shop floor'],
    ['/assets/img/hero-gears.webp', 'Gears & caliper'],
    ['/assets/img/project-separator.webp', 'Plastic separator']
  ];

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13M10 11v6M14 11v6"/></svg>'
  };

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function handleError(error) {
    if (error && (error.status === 401 || error.status === 403)) {
      showLogin('Your session has ended or this account lacks admin access. Please sign in again.');
      return;
    }
    toast((error && error.message) || 'Something went wrong.', 'error');
  }

  /* ---------- Boot / session ---------- */
  function showLogin(message = '') {
    $('#admin-loading').hidden = true;
    $('#admin-app').hidden = true;
    const screen = $('#login-screen');
    screen.hidden = false;
    const errorBox = $('#admin-login-error');
    if (message) {
      errorBox.textContent = message;
      errorBox.classList.add('is-shown');
    } else {
      errorBox.classList.remove('is-shown');
      errorBox.textContent = '';
    }
    window.setTimeout(() => {
      const email = $('#admin-email');
      if (email) email.focus();
    }, 80);
  }

  function fillUser(user) {
    state.user = user;
    const ini = initials(user.name);
    $('#admin-name').textContent = user.name;
    $('#admin-email-label').textContent = user.email;
    $('#admin-avatar').textContent = ini;
    $('#settings-name').textContent = user.name;
    $('#settings-email').textContent = user.email;
    $('#settings-avatar').textContent = ini;
  }

  function showApp(user) {
    fillUser(user);
    $('#admin-loading').hidden = true;
    $('#login-screen').hidden = true;
    $('#admin-app').hidden = false;
    setupDashboardEvents();
    loadAll();
    switchView('overview');
  }

  /* ---------- Data ---------- */
  async function loadAll() {
    try {
      const [statsData, postsData, commentsData, messagesData] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/posts'),
        api('/api/admin/comments'),
        api('/api/admin/messages')
      ]);
      state.stats = statsData.stats;
      state.posts = postsData.posts || [];
      state.comments = commentsData.comments || [];
      state.messages = messagesData.messages || [];
      renderAll();
    } catch (error) {
      handleError(error);
    }
  }

  function renderAll() {
    renderStats();
    renderOverview();
    renderPosts();
    renderComments();
    renderMessages();
    renderBadges();
    const memberCount = $('#member-count');
    if (memberCount && state.stats) memberCount.textContent = String(state.stats.members);
  }

  function renderBadges() {
    if (!state.stats) return;
    const setBadge = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(value);
      el.hidden = !value;
    };
    setBadge('badge-posts', state.stats.posts.drafts);
    setBadge('badge-comments', state.stats.comments.pending);
    setBadge('badge-messages', state.stats.messages.unread);
  }

  /* ---------- Overview ---------- */
  function renderStats() {
    const grid = $('#stat-grid');
    if (!grid || !state.stats) return;
    const { posts, comments, messages, members } = state.stats;
    const cards = [
      ['Published', posts.published, `${posts.drafts} draft${posts.drafts === 1 ? '' : 's'} waiting`],
      ['Comments pending', comments.pending, `${comments.approved} approved live`],
      ['Unread messages', messages.unread, `${messages.total} in inbox`],
      ['Members', members, 'registered readers'],
      ['Total posts', posts.total, 'field notes written']
    ];
    grid.innerHTML = cards
      .map(
        ([label, value, sub]) => `
        <div class="admin-stat">
          <div class="admin-stat__label">${escapeHTML(label)}</div>
          <div class="admin-stat__value">${escapeHTML(String(value))}</div>
          <div class="admin-stat__sub">${escapeHTML(sub)}</div>
        </div>`
      )
      .join('');
  }

  function renderOverview() {
    const recent = $('#overview-posts');
    const attention = $('#overview-attention');
    if (!recent || !attention || !state.stats) return;

    const posts = state.posts.slice(0, 4);
    recent.innerHTML = posts.length
      ? posts
          .map(
            (post) => `
        <button type="button" class="mini-item" data-edit-post="${escapeHTML(post.id)}">
          <span>${escapeHTML(post.title)}</span>
          <em>${escapeHTML(formatDate(post.updatedAt || post.createdAt))}</em>
        </button>`
          )
          .join('')
      : '<div class="mini-empty">No posts yet — start the first field note.</div>';

    const items = [];
    const { comments, messages, posts: postStats } = state.stats;
    if (comments.pending) {
      items.push(`<button type="button" class="mini-item" data-goto="comments"><span>${comments.pending} comment${comments.pending === 1 ? '' : 's'} awaiting approval</span><em>Review</em></button>`);
    }
    if (messages.unread) {
      items.push(`<button type="button" class="mini-item" data-goto="messages"><span>${messages.unread} unread message${messages.unread === 1 ? '' : 's'}</span><em>Open</em></button>`);
    }
    if (postStats.drafts) {
      items.push(`<button type="button" class="mini-item" data-goto="posts"><span>${postStats.drafts} draft${postStats.drafts === 1 ? '' : 's'} not published</span><em>Edit</em></button>`);
    }
    attention.innerHTML = items.length
      ? items.join('')
      : '<div class="mini-empty">All clear — nothing is waiting for review.</div>';
  }

  /* ---------- Posts ---------- */
  function filteredPosts() {
    const query = state.postQuery.trim().toLowerCase();
    return state.posts.filter((post) => {
      if (state.postFilter !== 'all' && post.status !== state.postFilter) return false;
      if (!query) return true;
      const haystack = [post.title, post.slug, (post.tags || []).join(' ')].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderPosts() {
    const tbody = $('#posts-body');
    const empty = $('#posts-empty');
    if (!tbody) return;
    const posts = filteredPosts();
    tbody.innerHTML = posts
      .map(
        (post) => `
      <tr>
        <td>
          <div class="row-title">
            <strong>${escapeHTML(post.title)}</strong>
            <span>/${escapeHTML(post.slug)}${(post.tags || []).length ? ' · ' + escapeHTML((post.tags || []).join(', ')) : ''}</span>
          </div>
        </td>
        <td><span class="status-pill status-pill--${post.status}">${post.status}</span></td>
        <td><span class="time-cell">${escapeHTML(formatDate(post.updatedAt || post.createdAt))}</span></td>
        <td class="col-actions">
          <div class="row-actions">
            <button type="button" class="icon-btn" data-edit-post="${escapeHTML(post.id)}" aria-label="Edit ${escapeHTML(post.title)}">${ICONS.edit}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-delete-post="${escapeHTML(post.id)}" aria-label="Delete ${escapeHTML(post.title)}">${ICONS.trash}</button>
          </div>
        </td>
      </tr>`
      )
      .join('');
    if (empty) empty.hidden = posts.length > 0;
  }

  function openEditor(post) {
    const modal = $('#editor-modal');
    const form = $('#post-form');
    const preview = $('#editor-preview');
    const content = $('#post-content');
    const errorBox = $('#editor-error');

    state.editingId = post ? post.id : null;
    errorBox.classList.remove('is-shown');
    errorBox.textContent = '';
    $('#editor-title').textContent = post ? 'Edit post' : 'New post';
    $('#editor-meta').textContent = post
      ? `Last updated ${formatDateTime(post.updatedAt || post.createdAt)} · /${post.slug}`
      : 'New draft · saved to the local JSON store';

    $('#post-title').value = post ? post.title : '';
    $('#post-slug').value = post ? post.slug : '';
    $('#post-status').value = post ? post.status : 'draft';
    $('#post-excerpt').value = post ? post.excerpt || '' : '';
    $('#post-tags').value = post ? (post.tags || []).join(', ') : '';
    content.value = post ? post.content : '';

    const cover = form.cover;
    if (post && post.cover && !Array.from(cover.options).some((option) => option.value === post.cover)) {
      cover.add(new Option(post.cover, post.cover));
    }
    cover.value = post ? post.cover || '' : '';

    preview.hidden = true;
    content.hidden = false;
    $('#preview-toggle').textContent = 'Preview';
    updateWordCount();

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => form.title.focus(), 60);
  }

  function closeEditor() {
    $('#editor-modal').hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
  }

  function updateWordCount() {
    const content = $('#post-content');
    const count = $('#editor-count');
    if (!content || !count) return;
    const words = content.value.trim().split(/\s+/).filter(Boolean).length;
    count.textContent = `${words} word${words === 1 ? '' : 's'}`;
  }

  async function savePost() {
    const form = $('#post-form');
    const errorBox = $('#editor-error');
    const button = $('#save-post-btn');
    errorBox.classList.remove('is-shown');
    if (!form.reportValidity()) return;

    const payload = {
      title: $('#post-title').value.trim(),
      slug: $('#post-slug').value.trim(),
      excerpt: $('#post-excerpt').value.trim(),
      status: $('#post-status').value,
      cover: form.cover.value,
      tags: $('#post-tags')
        .value.split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      content: $('#post-content').value.trim()
    };
    if (payload.title.length < 3) {
      errorBox.textContent = 'Give the post a title with at least 3 characters.';
      errorBox.classList.add('is-shown');
      return;
    }
    if (payload.content.length < 10) {
      errorBox.textContent = 'The post needs some content (at least 10 characters).';
      errorBox.classList.add('is-shown');
      return;
    }

    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      if (state.editingId) {
        await api(`/api/admin/posts/${encodeURIComponent(state.editingId)}`, { method: 'PUT', body: payload });
      } else {
        await api('/api/admin/posts', { method: 'POST', body: payload });
      }
      closeEditor();
      toast(payload.status === 'published' ? 'Post published.' : 'Draft saved.');
      await loadAll();
      switchView('posts');
    } catch (error) {
      handleError(error);
      errorBox.textContent = error.message;
      errorBox.classList.add('is-shown');
    } finally {
      button.disabled = false;
      button.textContent = 'Save post';
    }
  }

  async function deletePost(id) {
    const post = state.posts.find((item) => item.id === id);
    if (!post) return;
    const ok = await askConfirm(
      `“${post.title}” and its comments will be permanently removed.`,
      'Delete this post?',
      'Delete post'
    );
    if (!ok) return;
    try {
      await api(`/api/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Post deleted.');
      await loadAll();
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------- Comments ---------- */
  function renderComments() {
    const list = $('#comments-list');
    const empty = $('#comments-empty');
    const note = $('#comments-note');
    if (!list) return;

    if (note && state.stats) {
      note.textContent = `${state.stats.comments.total} total · ${state.stats.comments.pending} pending`;
    }

    const comments = state.comments.filter(
      (comment) => state.commentFilter === 'all' || comment.status === state.commentFilter
    );

    list.innerHTML = comments
      .map((comment) => {
        const pending = comment.status === 'pending';
        return `
        <article class="admin-card${pending ? ' admin-card--pending' : ''}">
          <div class="admin-card__head">
            <span class="admin-card__avatar">${escapeHTML(initials(comment.name))}</span>
            <div class="admin-card__meta">
              <strong>${escapeHTML(comment.name)}</strong>
              <span>${escapeHTML(comment.email || 'member')} · on “${escapeHTML(comment.postTitle)}”</span>
            </div>
            <span class="admin-card__date">${escapeHTML(formatDateTime(comment.createdAt))}</span>
          </div>
          <p>${escapeHTML(comment.body)}</p>
          <span class="status-pill status-pill--${pending ? 'pending' : 'approved'}">${comment.status}</span>
          <div class="admin-card__actions">
            ${
              pending
                ? `<button type="button" class="btn btn--primary btn--xs" data-approve-comment="${escapeHTML(comment.id)}">Approve</button>`
                : `<button type="button" class="btn btn--ghost btn--xs" data-unapprove-comment="${escapeHTML(comment.id)}">Unpublish</button>`
            }
            <a class="btn btn--ghost btn--xs" href="/post.html?slug=${encodeURIComponent(comment.postSlug)}" target="_blank" rel="noopener">View post</a>
            <button type="button" class="btn btn--danger btn--xs" data-delete-comment="${escapeHTML(comment.id)}">Delete</button>
          </div>
        </article>`;
      })
      .join('');

    if (empty) empty.hidden = comments.length > 0;
  }

  async function setCommentStatus(id, status) {
    try {
      await api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
      toast(status === 'approved' ? 'Comment approved.' : 'Comment unpublished.');
      await loadAll();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteComment(id) {
    const ok = await askConfirm('This comment will be permanently removed.', 'Delete comment?', 'Delete');
    if (!ok) return;
    try {
      await api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Comment deleted.');
      await loadAll();
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------- Messages ---------- */
  function renderMessages() {
    const list = $('#messages-list');
    const empty = $('#messages-empty');
    const note = $('#messages-note');
    if (!list) return;

    if (note && state.stats) {
      note.textContent = `${state.stats.messages.total} total · ${state.stats.messages.unread} unread`;
    }

    list.innerHTML = state.messages
      .map(
        (message) => `
        <article class="admin-card${message.read ? '' : ' is-unread'}">
          <div class="admin-card__head">
            <span class="admin-card__avatar">${escapeHTML(initials(message.name))}</span>
            <div class="admin-card__meta">
              <strong>${escapeHTML(message.name)}${message.subject ? ' · ' + escapeHTML(message.subject) : ''}</strong>
              <span>${escapeHTML(message.email)}</span>
            </div>
            <span class="admin-card__date">${escapeHTML(formatDateTime(message.createdAt))}</span>
          </div>
          <p>${escapeHTML(message.message)}</p>
          <div class="admin-card__actions">
            <a class="btn btn--primary btn--xs" href="mailto:${escapeHTML(message.email)}?subject=${encodeURIComponent('Re: ' + (message.subject || 'Your message'))}">Reply by email</a>
            <button type="button" class="btn btn--ghost btn--xs" data-message-read="${escapeHTML(message.id)}" data-read="${message.read ? 'false' : 'true'}">
              Mark ${message.read ? 'unread' : 'read'}
            </button>
            <button type="button" class="btn btn--danger btn--xs" data-delete-message="${escapeHTML(message.id)}">Delete</button>
          </div>
        </article>`
      )
      .join('');

    if (empty) empty.hidden = state.messages.length > 0;
  }

  async function setMessageRead(id, read) {
    try {
      await api(`/api/admin/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { read } });
      await loadAll();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteMessage(id) {
    const ok = await askConfirm('This message will be permanently removed.', 'Delete message?', 'Delete');
    if (!ok) return;
    try {
      await api(`/api/admin/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Message deleted.');
      await loadAll();
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------- Views ---------- */
  function switchView(view) {
    const meta = VIEW_META[view] || VIEW_META.overview;
    $('#view-title').textContent = meta[0];
    $('#view-subtitle').textContent = meta[1];
    $$('.nav-item').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === view);
    });
    $$('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== view;
    });
    const sidebar = $('#sidebar');
    if (sidebar) sidebar.classList.remove('is-open');
    const toggle = $('#sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (view === 'posts') renderPosts();
    if (view === 'comments') renderComments();
    if (view === 'messages') renderMessages();
    if (view === 'overview') {
      renderStats();
      renderOverview();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Confirm ---------- */
  let confirmResolver = null;

  function finishConfirm(value) {
    if (!confirmResolver) return;
    confirmResolver(value);
    confirmResolver = null;
    $('#confirm-modal').hidden = true;
  }

  function askConfirm(text, title = 'Are you sure?', confirmLabel = 'Delete') {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-ok').textContent = confirmLabel;
      $('#confirm-modal').hidden = false;
      window.setTimeout(() => $('#confirm-cancel').focus(), 50);
    });
  }

  /* ---------- Events ---------- */
  let eventsBound = false;

  function setupDashboardEvents() {
    if (eventsBound) return;
    eventsBound = true;

    $$('.nav-item').forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });

    document.addEventListener('click', async (event) => {
      const target = event.target;
      const goto = target.closest('[data-goto]');
      if (goto) {
        switchView(goto.dataset.goto);
        return;
      }
      if (target.closest('[data-new-post]') || target.closest('#new-post-btn')) {
        openEditor(null);
        return;
      }
      const editPost = target.closest('[data-edit-post]');
      if (editPost) {
        const post = state.posts.find((item) => item.id === editPost.dataset.editPost);
        if (post) openEditor(post);
        return;
      }
      const deletePostBtn = target.closest('[data-delete-post]');
      if (deletePostBtn) {
        deletePost(deletePostBtn.dataset.deletePost);
        return;
      }
      const approve = target.closest('[data-approve-comment]');
      if (approve) {
        setCommentStatus(approve.dataset.approveComment, 'approved');
        return;
      }
      const unapprove = target.closest('[data-unapprove-comment]');
      if (unapprove) {
        setCommentStatus(unapprove.dataset.unapproveComment, 'pending');
        return;
      }
      const deleteCommentBtn = target.closest('[data-delete-comment]');
      if (deleteCommentBtn) {
        deleteComment(deleteCommentBtn.dataset.deleteComment);
        return;
      }
      const readBtn = target.closest('[data-message-read]');
      if (readBtn) {
        setMessageRead(readBtn.dataset.messageRead, readBtn.dataset.read === 'true');
        return;
      }
      const deleteMessageBtn = target.closest('[data-delete-message]');
      if (deleteMessageBtn) {
        deleteMessage(deleteMessageBtn.dataset.deleteMessage);
        return;
      }
      if (target.closest('[data-close-editor]')) {
        closeEditor();
        return;
      }
      if (target.id === 'editor-modal') {
        closeEditor();
        return;
      }
      if (target.closest('[data-logout]')) {
        try {
          await api('/api/auth/logout', { method: 'POST' });
          window.location.reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      }
    });

    const postFilters = $('#post-filters');
    if (postFilters) {
      postFilters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-post-filter]');
        if (!button) return;
        state.postFilter = button.dataset.postFilter;
        $$('[data-post-filter]').forEach((el) => el.classList.toggle('is-active', el === button));
        renderPosts();
      });
    }

    const commentFilters = $('#comment-filters');
    if (commentFilters) {
      commentFilters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-comment-filter]');
        if (!button) return;
        state.commentFilter = button.dataset.commentFilter;
        $$('[data-comment-filter]').forEach((el) => el.classList.toggle('is-active', el === button));
        renderComments();
      });
    }

    let searchTimer = null;
    const search = $('#post-search');
    if (search) {
      search.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.postQuery = search.value;
          renderPosts();
        }, 140);
      });
    }

    const postForm = $('#post-form');
    if (postForm) {
      postForm.addEventListener('submit', (event) => {
        event.preventDefault();
        savePost();
      });
      const content = $('#post-content');
      content.addEventListener('input', () => {
        updateWordCount();
        const preview = $('#editor-preview');
        if (!preview.hidden) preview.innerHTML = renderMarkdown(content.value);
      });
      const toggle = $('#preview-toggle');
      toggle.addEventListener('click', () => {
        const preview = $('#editor-preview');
        const showing = !preview.hidden;
        if (showing) {
          preview.hidden = true;
          content.hidden = false;
          toggle.textContent = 'Preview';
        } else {
          preview.innerHTML = renderMarkdown(content.value);
          preview.hidden = false;
          content.hidden = true;
          toggle.textContent = 'Edit';
        }
      });
    }

    const passwordForm = $('#password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorBox = $('#password-error');
        const successBox = $('#password-success');
        errorBox.classList.remove('is-shown');
        successBox.classList.remove('is-shown');
        const current = passwordForm.currentPassword.value;
        const next = passwordForm.newPassword.value;
        const confirm = passwordForm.confirmPassword.value;
        if (next.length < 8) {
          errorBox.textContent = 'The new password must be at least 8 characters.';
          errorBox.classList.add('is-shown');
          return;
        }
        if (next !== confirm) {
          errorBox.textContent = 'The new passwords do not match.';
          errorBox.classList.add('is-shown');
          return;
        }
        const button = $('#password-submit');
        button.disabled = true;
        button.textContent = 'Updating…';
        try {
          await api('/api/admin/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
          passwordForm.reset();
          successBox.textContent = 'Password updated. Other sessions have been signed out.';
          successBox.classList.add('is-shown');
          toast('Password updated.');
        } catch (error) {
          errorBox.textContent = error.message;
          errorBox.classList.add('is-shown');
        } finally {
          button.disabled = false;
          button.textContent = 'Update password';
        }
      });
    }

    const sidebarToggle = $('#sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        const open = $('#sidebar').classList.toggle('is-open');
        sidebarToggle.setAttribute('aria-expanded', String(open));
      });
    }

    const refreshMessages = $('#refresh-messages');
    if (refreshMessages) {
      refreshMessages.addEventListener('click', async () => {
        refreshMessages.disabled = true;
        await loadAll();
        refreshMessages.disabled = false;
        toast('Inbox refreshed.');
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (confirmResolver) {
        finishConfirm(false);
        return;
      }
      if (!$('#editor-modal').hidden) {
        closeEditor();
        return;
      }
      $('#sidebar').classList.remove('is-open');
    });

    document.addEventListener('pointerdown', (event) => {
      const sidebar = $('#sidebar');
      const toggle = $('#sidebar-toggle');
      if (!sidebar.classList.contains('is-open')) return;
      if (sidebar.contains(event.target) || (toggle && toggle.contains(event.target))) return;
      sidebar.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function setupLogin() {
    const form = $('#admin-login-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#admin-login-error');
      const button = $('#admin-login-submit');
      errorBox.classList.remove('is-shown');
      if (!form.reportValidity()) return;
      button.disabled = true;
      button.textContent = 'Signing in…';
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: { email: form.email.value.trim(), password: form.password.value }
        });
        const user = data && data.user;
        if (!user || user.role !== 'admin') {
          await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
          throw Object.assign(new Error('This account does not have administrator access.'), { status: 403 });
        }
        form.reset();
        S.currentUser(true).catch(() => null);
        showApp(user);
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.add('is-shown');
      } finally {
        button.disabled = false;
        button.textContent = 'Sign in to dashboard';
      }
    });
  }

  function setupConfirm() {
    $('#confirm-ok').addEventListener('click', () => finishConfirm(true));
    $('#confirm-cancel').addEventListener('click', () => finishConfirm(false));
    $('#confirm-modal').addEventListener('click', (event) => {
      if (event.target.id === 'confirm-modal') finishConfirm(false);
    });
  }

  async function boot() {
    setupLogin();
    setupConfirm();
    try {
      const user = await S.currentUser();
      if (user && user.role === 'admin') {
        showApp(user);
      } else if (user) {
        showLogin(`You are signed in as ${user.email}, but this account is not an administrator.`);
      } else {
        showLogin();
      }
    } catch (error) {
      showLogin('Could not reach the server. Make sure the backend is running, then refresh.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
