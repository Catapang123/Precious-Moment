import { api, getCurrentUser } from './api.js';

const errorBox = document.getElementById('auth-error');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const title = document.querySelector('[data-auth-title]');
const subtitle = document.querySelector('[data-auth-subtitle]');
const tabs = [...document.querySelectorAll('[data-tab]')];
const panels = {
  login: document.getElementById('panel-login'),
  register: document.getElementById('panel-register'),
};

const params = new URLSearchParams(window.location.search);
const rawNext = params.get('next') || '';
const nextUrl = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/login') ? rawNext : '/app';

function setError(message = '') {
  errorBox.textContent = message;
  errorBox.classList.toggle('show', Boolean(message));
}

function setTab(mode, { focus = false } = {}) {
  const active = mode === 'register' ? 'register' : 'login';
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  Object.entries(panels).forEach(([name, panel]) => {
    panel.hidden = name !== active;
  });
  title.textContent = active === 'register' ? 'Start something.' : 'Welcome back.';
  subtitle.textContent =
    active === 'register'
      ? 'Create a customer account to send booking requests and follow every update.'
      : 'Sign in to see your bookings, updates, and payment records.';
  setError();
  if (focus) {
    const first = active === 'register' ? document.getElementById('register-name') : document.getElementById('login-email');
    first?.focus();
  }
  const hash = active === 'register' ? '#register' : '#login';
  if (window.location.hash !== hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const target = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    target.focus();
    setTab(target.dataset.tab);
  });
});

document.querySelectorAll('[data-switch-register]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setTab('register', { focus: true });
  });
});

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
  });
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
  if (password.length < 8) return 'Use a password of at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include a letter and a number in your password.';
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
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
      }),
    });
    window.location.assign(nextUrl);
  } catch (error) {
    setError(error.message);
    setBusy(loginForm, false);
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

const initial = params.get('mode') === 'register' || window.location.hash === '#register' ? 'register' : 'login';
setTab(initial);

getCurrentUser()
  .then((user) => {
    if (user) window.location.replace(nextUrl);
  })
  .catch(() => {});
