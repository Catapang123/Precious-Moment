/**
 * Shared browser helpers used by every page.
 *
 * Three jobs live here so the page scripts don't each reinvent them:
 *  1. `api()` — one fetch wrapper with cookies, JSON handling, error messages,
 *     and the thin top-of-page request bar.
 *  2. Formatting — money, dates, times, initials, and the escape function that
 *     every template literal uses before inserting user data into HTML.
 *  3. UI primitives — the toast, the shared rate-card markup, and debounce.
 *
 * Imported by `app.js` (dashboard), `home.js` (marketing page), and `auth.js`
 * (sign in / sign up). It has no DOM requirement beyond `document` existing.
 */

// Counts in-flight requests so the progress bar stays visible while several
// calls overlap, and disappears only after the last one settles.
let activeRequests = 0;

function setRequestBar(busy) {
  if (busy) document.documentElement.setAttribute('data-busy', '');
  else document.documentElement.removeAttribute('data-busy');
}

/**
 * A failed request, tagged with enough information for the UI to say what
 * actually happened: `kind` is one of offline, network, timeout, unauthorized,
 * forbidden, not-found, server.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'server' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

// An operation is "slow" after this long, and abandoned after TIMEOUT_AFTER.
const SLOW_AFTER = 8000;
const TIMEOUT_AFTER = 25000;

function kindForStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'busy';
  if (status >= 500) return 'server';
  return 'request';
}

function defaultMessageFor(status) {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'Your account does not have access to this.';
  if (status === 404) return 'That item could not be found.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'The studio system had a problem. Please try again in a moment.';
  return 'Something went wrong. Please try again.';
}

// Events let the dashboard react once, globally, instead of every call site
// repeating the same 401/403 handling.
function announce(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Calls the JSON API and returns its parsed body.
 *
 * - Sends cookies (`same-origin`) because sessions are httpOnly cookies.
 * - Turns a non-2xx response into an `ApiError` carrying the server's message,
 *   the HTTP status, and a `kind` the UI can classify.
 * - Announces slow calls (`pm:slow`) and session/permission failures
 *   (`pm:session-expired`, `pm:forbidden`) for the dashboard's global handlers.
 * - Times out after 25s so a hung request can never look like a frozen app.
 */
export async function api(path, options = {}) {
  activeRequests += 1;
  setRequestBar(true);
  const controller = options.signal ? null : new AbortController();
  const slowTimer = setTimeout(() => announce('pm:slow', { path }), SLOW_AFTER);
  const timeoutTimer = controller
    ? setTimeout(() => controller.abort('timeout'), TIMEOUT_AFTER)
    : null;

  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
    });

    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = (data && data.error) || defaultMessageFor(response.status);
      if (response.status === 401 && !path.startsWith('/api/auth/')) {
        announce('pm:session-expired', { message });
      }
      if (response.status === 403) announce('pm:forbidden', { message });
      throw new ApiError(message, {
        status: response.status,
        kind: kindForStatus(response.status),
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError' || error === 'timeout') {
      throw new ApiError(
        'That took longer than expected. Check your connection and try again.',
        { kind: 'timeout' }
      );
    }
    // `fetch` rejects with a TypeError for both offline and DNS failures; the
    // browser's own onLine flag is the only way to tell them apart.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(
      offline
        ? "You're offline. Reconnect and try again — nothing was sent."
        : 'We could not reach the studio system. Check your connection and try again.',
      { kind: offline ? 'offline' : 'network' }
    );
  } finally {
    clearTimeout(slowTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    activeRequests = Math.max(0, activeRequests - 1);
    if (!activeRequests) setRequestBar(false);
  }
}

/**
 * Plain-language explanation and next step for a failure. Every screen that can
 * show an error uses this, so the same failure reads the same everywhere and a
 * stack trace never reaches a customer.
 */
export function errorInfo(error) {
  const kind = error?.kind || (error?.status === 403 ? 'forbidden' : 'server');
  if (kind === 'offline') {
    return {
      kind,
      title: "You're offline",
      message:
        'The page you already loaded still works. Anything that needs the studio — sending a booking, loading reports, signing in — needs a connection.',
      action: 'Try again',
    };
  }
  if (kind === 'network') {
    return {
      kind,
      title: 'We could not reach the studio',
      message: 'The connection dropped before the request finished. Nothing was lost — check your signal and try again.',
      action: 'Try again',
    };
  }
  if (kind === 'timeout') {
    return {
      kind,
      title: 'This is taking longer than usual',
      message: 'The studio system did not answer in time. Wait a moment, then try again.',
      action: 'Try again',
    };
  }
  if (kind === 'unauthorized') {
    return {
      kind,
      title: 'Your session ended',
      message: 'You were signed out for your security. Sign in again to pick up where you left off.',
      action: 'Sign in again',
    };
  }
  if (kind === 'forbidden') {
    return {
      kind,
      title: 'This needs different access',
      message:
        'Your account can use the rest of the dashboard, but not this part. Ask the studio owner to change your role if you need it.',
      action: 'Go back',
    };
  }
  if (kind === 'busy') {
    return {
      kind,
      title: 'Too many attempts',
      message: 'Please wait a moment before trying again.',
      action: 'Try again',
    };
  }
  return {
    kind,
    title: 'Something went wrong',
    message: error?.message || 'The studio system could not complete that. Please try again.',
    action: 'Try again',
  };
}

/**
 * Closest candidate for a query that returned nothing, using edit distance.
 * Returns '' when nothing is plausibly close, so the UI never guesses wildly.
 * Used by the bookings search: "Weddding" suggests "Wedding" instead of a dead end.
 */
export function suggestTerm(query, candidates = []) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 3) return '';
  const distance = (a, b) => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return rows[a.length][b.length];
  };
  const limit = Math.max(1, Math.floor(q.length / 4));
  const queryWords = q.split(/[^a-z0-9]+/).filter(Boolean);
  let best = '';
  let bestScore = Infinity;
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    // Whole phrase, then single words: "PM-102" -> "PM-1021".
    for (const target of [value.toLowerCase(), ...words]) {
      if (!target || Math.abs(target.length - q.length) > limit) continue;
      const score = distance(q, target);
      if (score <= limit && score < bestScore) {
        bestScore = score;
        best = value;
      }
    }

    // Multi-word query: every word must be close to a word in the candidate,
    // so "Casa Espernza" still finds "Casa Esperanza, function hall".
    if (queryWords.length > 1 && words.length) {
      let total = 0;
      let matched = true;
      for (const word of queryWords) {
        if (word.length < 3) continue;
        let nearest = Infinity;
        for (const candidateWord of words) nearest = Math.min(nearest, distance(word, candidateWord));
        if (nearest > Math.max(1, Math.floor(word.length / 4))) {
          matched = false;
          break;
        }
        total += nearest;
      }
      if (matched && total < bestScore) {
        bestScore = total;
        best = value;
      }
    }
  }
  return best;
}


/**
 * Escapes text before it goes into an HTML template. Every interpolated value
 * in this codebase passes through `esc`, which is what keeps a customer name
 * like `<img onerror=...>` from becoming markup.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Short alias: `esc` is used in almost every template literal below.
export const esc = escapeHtml;

/** Formats a number as Philippine pesos, e.g. 1250 -> "₱1,250". */
export function peso(value) {
  const amount = Number(value) || 0;
  return `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

/**
 * Formats an ISO date (`YYYY-MM-DD`) in one of three lengths. Parsed manually
 * rather than with `new Date(string)` so a date never shifts by a timezone.
 */
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

/** Formats a full timestamp for logs and timeline entries. */
export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Turns "14:30" into "2:30 PM"; returns '' for anything that isn't HH:MM. */
export function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** First letters of the first two words, used for avatar circles. */
export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || '')
    .join('')
    .toUpperCase();
}

/** "in_progress" -> "in progress" for display next to the status badge. */
export function statusLabel(status) {
  return String(status || '').replace('_', ' ');
}

/**
 * Today's date as `YYYY-MM-DD` in the user's own timezone. Building it from the
 * offset avoids the classic bug where `toISOString()` reports tomorrow for
 * anyone east of UTC late in the evening.
 */
export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Same local-date treatment as `todayISO`, shifted by a number of days. */
export function addDaysISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** First day of the current month, the default start of a report range. */
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

/**
 * Shows the single site-wide toast for 3.6 seconds. Back-to-back calls reuse
 * the same node and restart the entrance animation, so messages never stack.
 * `role="status"` makes screen readers announce it without stealing focus.
 */
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

/**
 * Human-readable quantity breaks for a service, e.g.
 * "1–29 pcs ₱35 · 30+ pcs ₱30". Empty when the service is not tiered.
 */
export function serviceTierSummary(service = {}) {
  return (service.tiers || [])
    .map(
      (row) =>
        `${row.label || `${row.min}${row.max === null || row.max === undefined ? '+' : `–${row.max}`} pcs`} ${peso(row.price)}`
    )
    .join(' · ');
}

/**
 * Renders the full rate card from the `/api/services` payload.
 *
 * Shared by the marketing page (`home.js`) and the dashboard dialog (`app.js`)
 * so a price change appears in both places with no second copy of the markup.
 * Returns '' when the catalog is empty, letting the caller show its own
 * loading or error state.
 */
export function priceGroupsHtml(catalog = {}) {
  const categories = catalog.categories || [];
  const services = catalog.services || [];
  if (!services.length) return '';

  const groups = categories
    .map((category) => {
      const items = services.filter((service) => service.category === category.name);
      if (!items.length) return '';
      return `
        <section class="price-group" aria-labelledby="price-${esc(category.name.toLowerCase().replace(/[^a-z]+/g, '-'))}">
          <header class="price-group-head">
            <h3 id="price-${esc(category.name.toLowerCase().replace(/[^a-z]+/g, '-'))}">
              ${esc(category.name)}
              <span>${String(items.length).padStart(2, '0')} pieces</span>
            </h3>
            <p>${esc(category.note)}</p>
          </header>
          <ul class="price-list">
            ${items
              .map(
                (service) => `
              <li class="price-row">
                <div class="price-copy">
                  <span class="price-name">
                    ${esc(service.name)}
                    ${service.popular ? '<em class="price-popular">most booked</em>' : ''}
                  </span>
                  <span class="price-desc">${esc(service.description)}</span>
                  ${service.tiers?.length ? `<span class="price-tier-line">${esc(serviceTierSummary(service))}</span>` : ''}
                </div>
                <span class="price-value">
                  <strong>${service.tiers?.length ? `from ${peso(Math.min(...service.tiers.map((row) => Number(row.price))))}` : peso(service.price)}</strong>
                  <span>${esc(service.unit)}${service.min_qty ? ` · min ${service.min_qty}` : ''}</span>
                </span>
              </li>`
              )
              .join('')}
          </ul>
        </section>`;
    })
    .join('');

  return `<div class="price-groups">${groups}</div>`;
}

/**
 * Delays `fn` until calls stop for `wait` ms. Used for the search box so typing
 * does not re-render the bookings table on every keystroke.
 */
export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * The signed-in user, or null when nobody is signed in. A 401 is expected here
 * (it is how the page learns there is no session), so it is not an error.
 */
export async function getCurrentUser() {
  try {
    const data = await api('/api/auth/me');
    return data.user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}
