/* =========================================================
   Login / signup page
   ========================================================= */
(function () {
  'use strict';

  const S = window.Site;
  const { $, $$, api, toast, initials } = S;

  const loginPanel = $('#login-form');
  const signupPanel = $('#signup-form');
  const tabLogin = $('#tab-login');
  const tabSignup = $('#tab-signup');
  const segmented = document.querySelector('.segmented');
  const signedIn = $('#auth-signed-in');

  function nextTarget() {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    return '';
  }

  function switchTab(tab, pushHash = true) {
    const isSignup = tab === 'signup';
    if (!loginPanel || !signupPanel) return;
    loginPanel.hidden = isSignup;
    signupPanel.hidden = !isSignup;
    tabLogin.setAttribute('aria-selected', String(!isSignup));
    tabSignup.setAttribute('aria-selected', String(isSignup));
    const error = $('#login-error');
    if (error) error.classList.remove('is-shown');
    const signupError = $('#signup-error');
    if (signupError) signupError.classList.remove('is-shown');
    if (pushHash) {
      const url = new URL(window.location.href);
      url.hash = isSignup ? 'signup' : '';
      window.history.replaceState({}, '', url);
    }
    const title = document.querySelector('.auth-card__head h1');
    if (title) title.textContent = isSignup ? 'Create your account.' : 'Welcome back.';
    const input = isSignup ? $('#signup-name') : $('#login-email');
    if (input) window.setTimeout(() => input.focus(), 60);
  }

  function showSignedIn(user) {
    if (!signedIn) return;
    if (segmented) segmented.hidden = true;
    loginPanel.hidden = true;
    signupPanel.hidden = true;
    signedIn.classList.add('is-shown');
    const avatar = $('#signed-avatar');
    if (avatar) avatar.textContent = initials(user.name);
    const copy = $('#signed-copy');
    if (copy) {
      copy.textContent =
        user.role === 'admin'
          ? 'You are signed in as an administrator. The dashboard is ready.'
          : 'Your account lets you comment on field notes. Head back and join the discussion.';
    }
    const btn = signedIn.querySelector('.btn');
    if (btn) {
      if (user.role === 'admin') {
        btn.href = '#';
        btn.textContent = 'Open admin dashboard';
      } else {
        btn.href = nextTarget() || 'blog.html';
        btn.textContent = 'Continue to the blog';
      }
    }
    const headTitle = document.querySelector('.auth-card__head h1');
    if (headTitle) headTitle.textContent = 'You\u2019re in.';
    const headCopy = document.querySelector('.auth-card__head p');
    if (headCopy) headCopy.textContent = `Signed in as ${user.email}.`;
  }

  async function submitForm(form, endpoint, errorId, successMessage, buttonId) {
    const errorBox = document.getElementById(errorId);
    const button = document.getElementById(buttonId);
    errorBox.classList.remove('is-shown');
    errorBox.textContent = '';

    if (!form.reportValidity()) return;

    const email = form.email.value.trim();
    const password = form.password.value;
    const payload = { email, password };
    if (endpoint === 'signup') payload.name = form.name.value.trim();

    const originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = endpoint === 'signup' ? 'Creating account…' : 'Logging in…';

    try {
      const data = await api(`/api/auth/${endpoint}`, { method: 'POST', body: payload });
      toast(successMessage);
      S.currentUser(true).catch(() => null);
      const user = (data && data.user) || {};
      const destination =
        user.role === 'admin'
          ? '#'
          : nextTarget() || 'blog.html';
      window.setTimeout(() => (window.location.href = destination), 450);
      return true;
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('is-shown');
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = originalText;
      return false;
    }
  }

  function setupPasswordToggles() {
    $$('[data-password-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
      });
    });
  }

  function setupTabs() {
    if (tabLogin) tabLogin.addEventListener('click', () => switchTab('login'));
    if (tabSignup) tabSignup.addEventListener('click', () => switchTab('signup'));
    $$('[data-switch-tab]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        switchTab(link.dataset.switchTab);
      });
    });
    if (window.location.hash === '#signup') switchTab('signup', false);
  }

  function setupForms() {
    if (loginPanel) {
      loginPanel.addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(loginPanel, 'login', 'login-error', 'Welcome back.', 'login-submit');
      });
    }
    if (signupPanel) {
      signupPanel.addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(signupPanel, 'signup', 'signup-error', 'Account created. Welcome aboard.', 'signup-submit');
      });
    }
  }

  async function setupSession() {
    try {
      const user = await S.currentUser();
      if (user) showSignedIn(user);
    } catch (error) {
      /* stay on the forms if the session can't be checked */
    }
  }

  function boot() {
    setupTabs();
    setupPasswordToggles();
    setupForms();
    setupSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
