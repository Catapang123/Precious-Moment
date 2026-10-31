import { api, getCurrentUser } from './api.js';

const errorBox = document.getElementById('auth-error');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const mfaForm = document.getElementById('mfa-form');
const title = document.querySelector('[data-auth-title]');
const subtitle = document.querySelector('[data-auth-subtitle]');
const tabs = [...document.querySelectorAll('[data-tab]')];
const switchNote = document.querySelector('[data-switch-note]');
const panels = {
  login: document.getElementById('panel-login'),
  register: document.getElementById('panel-register'),
  mfa: document.getElementById('panel-mfa'),
};

const params = new URLSearchParams(window.location.search);
const rawNext = params.get('next') || '';
const nextUrl =
  rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/login') ? rawNext : '/app';

const PASSWORD_RULES = [
  { key: 'length', label: 'At least 10 characters', test: (value) => value.length >= 10 },
  { key: 'upper', label: 'One uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { key: 'lower', label: 'One lowercase letter', test: (value) => /[a-z]/.test(value) },
  { key: 'number', label: 'One number', test: (value) => /\d/.test(value) },
  { key: 'symbol', label: 'One symbol', test: (value) => /[^A-Za-z0-9]/.test(value) },
];
const PASSWORD_MESSAGE =
  'Use at least 10 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.';

function setError(message = '') {
  errorBox.textContent = message;
  errorBox.classList.toggle('show', Boolean(message));
}

function paintRules(value) {
  const list = document.getElementById('register-rules');
  if (!list) return;
  for (const rule of PASSWORD_RULES) {
    const item = list.querySelector(`[data-rule="${rule.key}"]`);
    if (item) item.classList.toggle('ok', rule.test(value));
  }
}

function setTab(mode, { focus = false } = {}) {
  const active = mode === 'login' ? 'login' : 'register';
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  Object.entries(panels).forEach(([name, panel]) => {
    panel.hidden = name !== active;
  });
  if (switchNote) {
    switchNote.hidden = false;
    switchNote.innerHTML =
      active === 'register'
        ? 'Already have an account? <button class="link-button" type="button" data-switch-login>Sign in</button>'
        : 'New here? <button class="link-button" type="button" data-switch-register>Create an account</button>';
  }
  title.textContent = active === 'register' ? 'Start something.' : 'Welcome back.';
  subtitle.textContent =
    active === 'register'
      ? 'Create a customer account to send booking requests and follow every update.'
      : 'Sign in to see your bookings, updates, and payment records.';
  document.title = active === 'register' ? 'Create your account — Precious Moments' : 'Sign in — Precious Moments';
  setError();
  if (focus) {
    const first =
      active === 'register'
        ? document.getElementById('register-name')
        : document.getElementById('login-email');
    first?.focus();
  }
  const hash = active === 'register' ? '#register' : '#login';
  if (window.location.hash !== hash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }
}

function showMfa() {
  tabs.forEach((tab) => {
    tab.hidden = true;
  });
  Object.entries(panels).forEach(([name, panel]) => {
    panel.hidden = name !== 'mfa';
  });
  if (switchNote) switchNote.hidden = true;
  title.textContent = 'Two-step check.';
  subtitle.textContent = 'Your account is protected with an authenticator app.';
  setError();
  document.getElementById('mfa-code')?.focus();
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const tab = target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  if (target.closest('[data-switch-login]')) return setTab('login', { focus: true });
  if (target.closest('[data-switch-register]')) return setTab('register', { focus: true });
  if (target.closest('[data-forgot-password]')) {
    const note = document.querySelector('[data-forgot-note]');
    if (note) note.hidden = !note.hidden;
    return;
  }
  if (target.closest('[data-mfa-cancel]')) {
    api('/api/auth/logout', { method: 'POST', body: '{}' }).finally(() => {
      window.location.assign('/login?mode=login');
    });
    return;
  }
  const toggle = target.closest('[data-toggle-password]');
  if (toggle) {
    const input = document.getElementById(toggle.dataset.togglePassword);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
  }
});

// Arrow keys move between the two tabs, as the tab pattern expects.
tabs.forEach((tab) => {
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const target = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    target.focus();
    setTab(target.dataset.tab);
  });
});

document.getElementById('register-password')?.addEventListener('input', (event) => {
  paintRules(event.target.value);
});

function validateLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email) return 'Enter your email address.';
  if (!password) return 'Enter your password.';
  return '';
}

function validateRegister() {
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  if (name.length < 2) return 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (PASSWORD_RULES.some((rule) => !rule.test(password))) return PASSWORD_MESSAGE;
  return '';
}

function setBusy(form, busy, label) {
  const button = form.querySelector('[data-submit]');
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const validation = validateLogin();
  if (validation) return setError(validation);
  setBusy(loginForm, true, 'Signing in…');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
      }),
    });
    if (result.mfa_required) {
      setBusy(loginForm, false);
      showMfa();
      return;
    }
    window.location.assign(nextUrl);
  } catch (error) {
    setError(error.message);
    setBusy(loginForm, false);
  }
});

mfaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const code = document.getElementById('mfa-code').value.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
  setBusy(mfaForm, true, 'Checking…');
  try {
    await api('/api/auth/mfa', { method: 'POST', body: JSON.stringify({ code }) });
    window.location.assign(nextUrl);
  } catch (error) {
    setError(error.message);
    setBusy(mfaForm, false);
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError();
  const validation = validateRegister();
  if (validation) return setError(validation);
  setBusy(registerForm, true, 'Creating account…');
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('register-name').value.trim(),
        email: document.getElementById('register-email').value.trim(),
        phone: document.getElementById('register-phone').value.trim(),
        password: document.getElementById('register-password').value,
      }),
    });
    window.location.assign(nextUrl);
  } catch (error) {
    setError(error.message);
    setBusy(registerForm, false);
  }
});

// Sign-up is the default arrival; explicit links still open sign-in.
const initial =
  params.get('mode') === 'login' || window.location.hash === '#login' ? 'login' : 'register';
setTab(initial);
paintRules(document.getElementById('register-password')?.value || '');

getCurrentUser()
  .then((user) => {
    if (user) window.location.replace(nextUrl);
  })
  .catch(() => {});
