let activeRequests = 0;

function setRequestBar(busy) {
  if (busy) document.documentElement.setAttribute('data-busy', '');
  else document.documentElement.removeAttribute('data-busy');
}

export async function api(path, options = {}) {
  activeRequests += 1;
  setRequestBar(true);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });

    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error((data && data.error) || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    if (!activeRequests) setRequestBar(false);
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const esc = escapeHtml;

export function peso(value) {
  const amount = Number(value) || 0;
  return `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value, style = 'long') {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  const date = new Date(year, month - 1, day);
  if (style === 'short') {
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }
  if (style === 'weekday') {
    return date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || '')
    .join('')
    .toUpperCase();
}

export function statusLabel(status) {
  return String(status || '').replace('_', ' ');
}

export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function monthStartISO() {
  return `${todayISO().slice(0, 7)}-01`;
}

const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function toastNode() {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    document.body.appendChild(node);
  }
  if (!node.querySelector('.toast-msg')) {
    node.innerHTML =
      '<span class="toast-icon" aria-hidden="true"></span>' +
      '<span class="toast-msg"></span>' +
      '<button class="toast-close" type="button" aria-label="Dismiss notification">×</button>' +
      '<span class="toast-bar" aria-hidden="true"></span>';
    node.querySelector('.toast-close')?.addEventListener('click', hideToast);
  }
  return node;
}

function hideToast() {
  const node = document.getElementById('toast');
  if (!node) return;
  clearTimeout(node._timer);
  node.classList.remove('show');
}

export function toast(message, type = 'success') {
  const node = toastNode();
  const tint = TOAST_ICONS[type] ? type : 'info';
  node.classList.remove('show', 'toast--success', 'toast--error', 'toast--warning', 'toast--info');
  node.classList.add(`toast--${tint}`);
  const icon = node.querySelector('.toast-icon');
  if (icon) icon.innerHTML = TOAST_ICONS[tint];
  const copy = node.querySelector('.toast-msg');
  if (copy) copy.textContent = message;
  // Restart the entrance and the progress bar for back-to-back messages.
  void node.offsetWidth;
  node.classList.add('show');
  clearTimeout(node._timer);
  node._timer = setTimeout(hideToast, 3600);
}

export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export async function getCurrentUser() {
  try {
    const data = await api('/api/auth/me');
    return data.user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}
