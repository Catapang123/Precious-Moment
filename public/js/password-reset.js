/**
 * Forgot-password and reset-password pages.
 *
 * Both pages use the public auth API. The only account-existence check happens
 * on the server, and its response is deliberately identical for every email.
 * The reset token stays in the page URL only until validation; it is never put
 * into storage or logged by this script.
 */
import { api } from './api.js';

const page = document.body.dataset.recoveryPage;
const errorBox = document.getElementById('recovery-error');

const PASSWORD_RULES = [
  { key: 'length', test: (value) => value.length >= 10 && value.length <= 128 },
  { key: 'upper', test: (value) => /[A-Z]/.test(value) },
  { key: 'lower', test: (value) => /[a-z]/.test(value) },
  { key: 'number', test: (value) => /\d/.test(value) },
  { key: 'symbol', test: (value) => /[^A-Za-z0-9]/.test(value) },
];
const PASSWORD_MESSAGE =
  'Use at least 10 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.';

function setError(message = '') {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.toggle('show', Boolean(message));
}

function setBusy(form, busy, label) {
  const button = form?.querySelector('[data-submit]');
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

function paintRules(value) {
  const list = document.getElementById('reset-rules');
  if (!list) return;
  for (const rule of PASSWORD_RULES) {
    const item = list.querySelector(`[data-rule="${rule.key}"]`);
    if (item) item.classList.toggle('ok', rule.test(value));
  }
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-password]');
  if (!toggle) return;
  const input = document.getElementById(toggle.dataset.togglePassword);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
});

if (page === 'forgot') {
  const form = document.getElementById('forgot-form');
  const success = document.querySelector('[data-forgot-success]');
  const message = document.querySelector('[data-forgot-message]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError();
    const email = document.getElementById('forgot-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter the email address registered to your account.');
      document.getElementById('forgot-email').focus();
      return;
    }
    setBusy(form, true, 'Sending…');
    try {
      const result = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (message && result?.message) message.textContent = result.message;
      form.closest('[data-forgot-form-wrap]')?.setAttribute('hidden', '');
      if (success) success.hidden = false;
      document.querySelector('.auth-recovery-card h1').textContent = 'Check your inbox.';
    } catch (error) {
      setError(error.message);
      setBusy(form, false);
    }
  });
}

if (page === 'reset') {
  const form = document.getElementById('reset-form');
  const checking = document.querySelector('[data-reset-checking]');
  const invalid = document.querySelector('[data-reset-invalid]');
  const invalidMessage = document.querySelector('[data-reset-invalid-message]');
  const success = document.querySelector('[data-reset-success]');
  const title = document.querySelector('[data-reset-title]');
  const lead = document.querySelector('[data-reset-lead]');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  let validToken = '';

  const showInvalid = (message) => {
    checking.hidden = true;
    form.hidden = true;
    invalid.hidden = false;
    if (invalidMessage) invalidMessage.textContent = message;
    if (title) title.textContent = 'This link cannot be used.';
    if (lead) lead.textContent = 'Reset links are single-use and time-limited. Request a fresh one below.';
  };

  const ready = async () => {
    if (!token) {
      showInvalid('This reset link is missing its secure token. Request a new link.');
      return;
    }
    try {
      await api('/api/auth/reset-password/validate', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      validToken = token;
      checking.hidden = true;
      form.hidden = false;
      document.getElementById('reset-password')?.focus();
    } catch (error) {
      showInvalid(error.message);
    }
  };

  form.addEventListener('input', (event) => {
    if (event.target.id === 'reset-password') paintRules(event.target.value);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError();
    const password = document.getElementById('reset-password').value;
    const confirmation = document.getElementById('reset-confirm').value;
    if (PASSWORD_RULES.some((rule) => !rule.test(password))) {
      setError(PASSWORD_MESSAGE);
      document.getElementById('reset-password').focus();
      return;
    }
    if (password !== confirmation) {
      setError('The two new passwords do not match.');
      document.getElementById('reset-confirm').focus();
      return;
    }
    setBusy(form, true, 'Saving…');
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: validToken, password, confirm_password: confirmation }),
      });
      form.hidden = true;
      success.hidden = false;
      if (title) title.textContent = 'Password changed.';
      if (lead) lead.textContent = 'Sign in with your new password to continue.';
      // Do not leave a used token in the address bar or browser history.
      history.replaceState(null, '', '/reset-password');
    } catch (error) {
      setError(error.message);
      setBusy(form, false);
    }
  });

  ready();
}
