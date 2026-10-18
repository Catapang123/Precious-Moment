import {
  addDaysISO,
  api,
  debounce,
  esc,
  formatDate,
  formatDateTime,
  formatTime,
  getCurrentUser,
  initials,
  monthStartISO,
  peso,
  statusLabel,
  toast,
  todayISO,
} from './api.js';

const viewRoot = document.getElementById('view');
const navRoot = document.querySelector('[data-sidebar-nav]');
const userChip = document.querySelector('[data-user-chip]');
const drawerRoot = document.getElementById('drawer-root');
const modalRoot = document.getElementById('modal-root');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_progress', 'ready'];
const BOOKING_LABELS = {
  pending: 'Pending request',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const PAYMENT_LABELS = {
  unpaid: 'Unpaid',
  deposit_paid: 'Deposit paid',
  paid: 'Paid in full',
  refunded: 'Refunded',
};
const PAYMENT_METHODS = ['', 'Cash', 'GCash', 'Bank transfer', 'Card'];

const ICONS = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10.5 9-7.5 9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bookings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M4 9h16M8 5v14"/><path d="M12 13h4"/></svg>',
  payments: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>',
  reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  staff: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14c2.3.8 4 3 4 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6"/><path d="M14 8l4 4-4 4M8 12h10"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v10H4z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 20h16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
};

const NAV = {
  customer: [
    { key: 'overview', label: 'Overview', icon: 'home' },
    { key: 'book', label: 'New booking', icon: 'plus' },
    { key: 'bookings', label: 'My bookings', icon: 'calendar' },
  ],
  staff: [
    { key: 'overview', label: 'Studio day', icon: 'home' },
    { key: 'schedule', label: 'My schedule', icon: 'schedule' },
  ],
  admin: [
    { key: 'overview', label: 'Overview', icon: 'home' },
    { key: 'bookings', label: 'Bookings', icon: 'bookings' },
    { key: 'payments', label: 'Payments', icon: 'payments' },
    { key: 'reports', label: 'Reports', icon: 'reports' },
    { key: 'team', label: 'Team', icon: 'staff' },
  ],
};

const PAGE_META = {
  customer: {
    overview: { title: 'Your moments', subtitle: 'Bookings, payments, and studio updates in one place.' },
    book: { title: 'New booking', subtitle: 'Choose the pieces, send the date, and we take it from there.' },
    bookings: { title: 'My bookings', subtitle: 'Every request and every update, kept together.' },
  },
  staff: {
    overview: { title: 'Studio day', subtitle: 'Your assigned events and what needs a nudge.' },
    schedule: { title: 'My schedule', subtitle: 'Dates, crews, and the progress of each booking.' },
  },
  admin: {
    overview: { title: 'Studio overview', subtitle: 'The whole day, from requests to recorded payments.' },
    bookings: { title: 'Bookings', subtitle: 'Coordinate dates, crews, and service progress.' },
    payments: { title: 'Payments', subtitle: 'Keep a clear record of deposits and balances.' },
    reports: { title: 'Reports', subtitle: 'The numbers behind the moments.' },
    team: { title: 'Team', subtitle: 'Create the crew accounts that can see assigned work.' },
  },
};

const state = {
  user: null,
  bookings: [],
  services: [],
  categories: [],
  staff: [],
  view: 'overview',
  activeBooking: null,
  cart: [],
  catalogFilter: 'all',
  customerFilter: 'all',
  staffFilter: 'all',
  adminSearch: '',
  adminStatus: 'all',
  paymentFilter: 'all',
  report: null,
  reportFrom: monthStartISO(),
  reportTo: todayISO(),
  reportLoading: false,
  reportError: '',
  lastFocused: null,
  lastModalFocus: null,
  cancelArmed: false,
};

/* ---------- Small helpers ---------- */

const dayMs = 86400000;

function dateParts(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return { day: '—', month: '' };
  const date = new Date(year, month - 1, day);
  return {
    day: String(day).padStart(2, '0'),
    month: date.toLocaleDateString('en-PH', { month: 'short' }).toUpperCase(),
  };
}

function daysUntil(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year) return 0;
  const target = new Date(year, month - 1, day);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  return Math.round((target - today) / dayMs);
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function activeBookings() {
  return state.bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status));
}

function sortByEventAsc(list) {
  return [...list].sort((a, b) => {
    const date = String(a.event_date).localeCompare(String(b.event_date));
    return date || String(a.event_time || '').localeCompare(String(b.event_time || ''));
  });
}

function getBooking(id) {
  return state.bookings.find((booking) => booking.id === id);
}

function statusBadge(status, label = '') {
  const safe = String(status || '').replace(/[^a-z_]/g, '') || 'pending';
  return `<span class="status-badge status-${safe}">${esc(label || statusLabel(safe))}</span>`;
}

function itemSummary(item) {
  if (item.pricing_mode === 'area') {
    return `${item.name} · ${item.width_ft}×${item.height_ft} ft`;
  }
  return `${item.name}${item.qty > 1 ? ` ×${item.qty}` : ''}`;
}

function bookingServiceSummary(booking) {
  const items = booking.items || [];
  if (!items.length) return 'Custom booking';
  const first = itemSummary(items[0]);
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
}

function relativeTime(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function computeRevenueThisMonth() {
  const month = todayISO().slice(0, 7);
  return state.bookings
    .filter(
      (booking) =>
        booking.payment_status !== 'refunded' &&
        booking.paid_at &&
        String(booking.paid_at).slice(0, 7) === month
    )
    .reduce((sum, booking) => sum + Number(booking.amount_paid || 0), 0);
}

function totalOutstanding() {
  return activeBookings().reduce(
    (sum, booking) => sum + Math.max(0, Number(booking.total) - Number(booking.amount_paid || 0)),
    0
  );
}

function nowLabel() {
  return new Date().toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function bookingRow(booking, { showCustomer = true } = {}) {
  const { day, month } = dateParts(booking.event_date);
  const subline = showCustomer && booking.customer
    ? `${booking.customer.name} · ${formatTime(booking.event_time) || 'Time to confirm'} · ${booking.venue}`
    : `${formatTime(booking.event_time) || 'Time to confirm'} · ${booking.venue}`;
  return `
    <button class="booking-row" type="button" data-open-booking="${esc(booking.id)}">
      <span class="booking-date-tile"><strong>${day}</strong><span>${month}</span></span>
      <span class="booking-row-main">
        <strong>${esc(bookingServiceSummary(booking))}<span class="ref-label">${esc(booking.ref)}</span></strong>
        <p>${esc(subline)}</p>
      </span>
      <span class="booking-row-side">
        ${statusBadge(booking.status)}
        <span class="row-total">${peso(booking.total)}</span>
        <span class="chevron">${ICONS.chevron}</span>
      </span>
    </button>`;
}

function emptyState({ icon = 'calendar', title, text, action = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${ICONS[icon] || ICONS.calendar}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

/* ---------- Chrome ---------- */

function navBadge(key) {
  if (state.user.role === 'admin') {
    if (key === 'bookings') return state.bookings.filter((booking) => booking.status === 'pending').length;
    if (key === 'payments') {
      return state.bookings.filter(
        (booking) => booking.payment_status === 'unpaid' && ACTIVE_STATUSES.includes(booking.status)
      ).length;
    }
  }
  if (state.user.role === 'staff' && key === 'schedule') {
    return state.bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status)).length;
  }
  if (state.user.role === 'customer' && key === 'bookings') return activeBookings().length;
  return 0;
}

function renderChrome() {
  if (!state.user) return;
  const role = state.user.role;
  navRoot.innerHTML = NAV[role]
    .map((item) => {
      const count = navBadge(item.key);
      return `
        <button class="nav-item ${state.view === item.key ? 'active' : ''}" type="button" data-nav="${item.key}">
          ${ICONS[item.icon] || ICONS.home}
          <span>${esc(item.label)}</span>
          ${count ? `<span class="sidebar-count">${count}</span>` : ''}
        </button>`;
    })
    .join('');

  document.querySelector('[data-role-label]').textContent =
    role === 'admin' ? 'Studio administration' : role === 'staff' ? 'Studio crew' : 'Customer account';

  userChip.innerHTML = `
    <span class="avatar">${esc(initials(state.user.name))}</span>
    <span class="user-chip-copy">
      <strong>${esc(state.user.name)}</strong>
      <span>${esc(state.user.role)}</span>
    </span>
    <button class="icon-button" type="button" data-logout aria-label="Sign out" title="Sign out">${ICONS.logout}</button>`;

  const avatar = document.querySelector('[data-avatar]');
  if (avatar) avatar.textContent = initials(state.user.name);
  const today = document.querySelector('[data-today]');
  if (today) today.textContent = nowLabel();
}

function updatePageMeta() {
  const meta = PAGE_META[state.user.role]?.[state.view] || PAGE_META[state.user.role]?.overview;
  if (!meta) return;
  document.querySelector('[data-page-title]').textContent = meta.title;
  document.querySelector('[data-page-subtitle]').textContent = meta.subtitle;
  document.title = `${meta.title} — Precious Moments`;
}

function parseView() {
  const key = window.location.hash.replace('#', '');
  const allowed = NAV[state.user.role].map((item) => item.key);
  return allowed.includes(key) ? key : 'overview';
}

function go(view) {
  if (!NAV[state.user.role].some((item) => item.key === view)) return;
  document.body.classList.remove('sidebar-open');
  if (window.location.hash === `#${view}`) {
    navigate(view);
  } else {
    window.location.hash = view;
  }
}

async function navigate(view) {
  if (!state.user) return;
  const allowed = NAV[state.user.role].map((item) => item.key);
  state.view = allowed.includes(view) ? view : 'overview';
  updatePageMeta();
  renderChrome();
  if (state.view === 'reports' && !state.report && !state.reportLoading) {
    renderView();
    await loadReport();
    return;
  }
  renderView();
  window.scrollTo(0, 0);
}

function renderView() {
  if (!state.user) return;
  const role = state.user.role;
  if (role === 'customer') {
    if (state.view === 'book') renderBookView();
    else if (state.view === 'bookings') renderCustomerBookings();
    else renderCustomerOverview();
  } else if (role === 'staff') {
    if (state.view === 'schedule') renderStaffSchedule();
    else renderStaffOverview();
  } else if (role === 'admin') {
    if (state.view === 'bookings') renderAdminBookings();
    else if (state.view === 'payments') renderAdminPayments();
    else if (state.view === 'reports') renderReports();
    else if (state.view === 'team') renderAdminTeam();
    else renderAdminOverview();
  }
}

/* ---------- Customer overview ---------- */

function renderCustomerOverview() {
  const upcoming = sortByEventAsc(
    activeBookings().filter((booking) => daysUntil(booking.event_date) >= 0)
  );
  const next = upcoming[0];
  const recent = [...state.bookings]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);
  const kept = state.bookings.filter((booking) => booking.status === 'completed').length;
  const balance = state.bookings
    .filter((booking) => ACTIVE_STATUSES.includes(booking.status))
    .reduce((sum, booking) => sum + Math.max(0, booking.total - Number(booking.amount_paid || 0)), 0);
  const nextDays = next ? daysUntil(next.event_date) : 0;
  const nextWhen = nextDays === 0 ? 'today' : nextDays === 1 ? 'tomorrow' : `in ${nextDays} days`;

  viewRoot.innerHTML = `
    <div class="welcome-panel">
      <p class="section-note">${greeting()}, ${esc(firstName(state.user.name))}</p>
      <h2>${next ? `Your next moment is ${nextWhen}.` : 'Something lovely is waiting to be planned.'}</h2>
      <p>${
        next
          ? 'Here is everything the studio has for that day. Open the booking any time to see the latest update or what is still due.'
          : 'Start with a date and a rough idea. You can choose prints, keepsakes, coverage, and booths in one request.'
      }</p>
      <div class="welcome-actions">
        <button class="btn btn-primary" type="button" data-nav="book">${ICONS.plus} Book something new</button>
        <button class="btn" type="button" data-nav="bookings">See all bookings</button>
      </div>
      ${
        next
          ? `<div class="next-event">
              <div class="next-event-date">
                <strong>${dateParts(next.event_date).day}</strong>
                <span>${dateParts(next.event_date).month}</span>
              </div>
              <div class="next-event-main">
                <strong>${esc(bookingServiceSummary(next))}</strong>
                <span>${formatDate(next.event_date, 'weekday')} · ${esc(formatTime(next.event_time) || 'time to confirm')} · ${esc(next.venue)}</span>
              </div>
              <button class="btn btn-sm" type="button" data-open-booking="${esc(next.id)}">Open booking ${ICONS.chevron}</button>
            </div>`
          : ''
      }
    </div>

    <div class="stats-strip">
      <div class="stat-cell"><span>Active bookings</span><strong>${activeBookings().length}</strong><small>Requests and dates in motion</small></div>
      <div class="stat-cell"><span>Upcoming dates</span><strong>${upcoming.length}</strong><small>From today onward</small></div>
      <div class="stat-cell"><span>Moments kept</span><strong>${kept}</strong><small>Completed with the studio</small></div>
      <div class="stat-cell"><span>Balance due</span><strong class="${balance ? 'rose' : ''}">${peso(balance)}</strong><small>Across active bookings</small></div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-head">
          <div><h3>Your bookings</h3><p>The latest requests and dates</p></div>
          <button class="btn btn-sm" type="button" data-nav="bookings">See all</button>
        </div>
        ${
          recent.length
            ? `<div class="booking-list">${recent.map((booking) => bookingRow(booking, { showCustomer: false })).join('')}</div>`
            : emptyState({
                icon: 'spark',
                title: 'No bookings yet',
                text: 'Choose your prints, coverage, or booth and send your first date.',
                action: '<button class="btn btn-primary" type="button" data-nav="book">Start a booking</button>',
              })
        }
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Quick actions</h3><p>The usual next steps</p></div></div>
          <div class="quick-actions">
            <button class="quick-action" type="button" data-nav="book">
              ${ICONS.plus}<span><strong>Plan a booking</strong><span>Prints, coverage, a booth</span></span>
            </button>
            <button class="quick-action" type="button" data-nav="bookings">
              ${ICONS.calendar}<span><strong>Track a date</strong><span>Status and payments</span></span>
            </button>
            <a class="quick-action" href="mailto:hello@preciousmoments.ph">
              ${ICONS.mail}<span><strong>Ask the studio</strong><span>Let us help you plan</span></span>
            </a>
            <a class="quick-action" href="/#prices">
              ${ICONS.bookings}<span><strong>Browse the rate card</strong><span>Starting prices</span></span>
            </a>
          </div>
        </div>
        <div class="panel">
          <div class="note-panel">
            <h3>Reserving a date</h3>
            <p>A 50% reservation fee confirms a booking. The balance is settled on or before the event. Your dashboard will always show what the studio has recorded.</p>
          </div>
          <div class="note-panel">
            <h3>Need a hand?</h3>
            <p>For changes, custom sizes, or out-of-town events, email <a href="mailto:hello@preciousmoments.ph">hello@preciousmoments.ph</a>. A real person replies.</p>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- Customer bookings ---------- */

function renderCustomerBookings() {
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'In motion' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];
  let list = [...state.bookings];
  if (state.customerFilter === 'active') list = list.filter((booking) => ACTIVE_STATUSES.includes(booking.status));
  if (state.customerFilter === 'completed') list = list.filter((booking) => booking.status === 'completed');
  if (state.customerFilter === 'cancelled') list = list.filter((booking) => booking.status === 'cancelled');
  list = sortByEventAsc(list);

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>All your dates</h2><p>${state.bookings.length ? `You have ${plural(state.bookings.length, 'booking')} with the studio.` : 'Nothing here yet — your first moment starts with a request.'}</p></div>
      <div class="page-actions"><button class="btn btn-primary" type="button" data-nav="book">${ICONS.plus} New booking</button></div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <div class="catalog-tabs" style="padding:0;border:0">
          ${filters
            .map((filter) => {
              const count =
                filter.key === 'all'
                  ? state.bookings.length
                  : filter.key === 'active'
                    ? state.bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status)).length
                    : state.bookings.filter((booking) => booking.status === filter.key).length;
              return `<button class="chip ${state.customerFilter === filter.key ? 'active' : ''}" type="button" data-customer-filter="${filter.key}">${filter.label}${count ? ` · ${count}` : ''}</button>`;
            })
            .join('')}
        </div>
      </div>
      ${
        list.length
          ? `<div class="booking-list">${list.map((booking) => bookingRow(booking, { showCustomer: false })).join('')}</div>`
          : emptyState({
              icon: 'calendar',
              title: 'No bookings in this view',
              text: 'Try another filter or start a new request.',
              action: '<button class="btn btn-primary" type="button" data-nav="book">Start a booking</button>',
            })
      }
    </div>`;
}

/* ---------- Staff overview ---------- */

function renderStaffOverview() {
  const mine = sortByEventAsc(state.bookings);
  const active = mine.filter((booking) => ACTIVE_STATUSES.includes(booking.status));
  const inProgress = mine.filter((booking) => booking.status === 'in_progress');
  const ready = mine.filter((booking) => booking.status === 'ready');
  const completedThisMonth = mine.filter(
    (booking) => booking.status === 'completed' && String(booking.event_date).slice(0, 7) === todayISO().slice(0, 7)
  );
  const next = active.filter((booking) => daysUntil(booking.event_date) >= 0)[0];

  viewRoot.innerHTML = `
    <div class="welcome-panel">
      <p class="section-note">${greeting()}, ${esc(firstName(state.user.name))}</p>
      <h2>${next ? `Next up: ${esc(next.customer?.name || next.ref)} on ${formatDate(next.event_date, 'weekday')}.` : 'No dates on your board just yet.'}</h2>
      <p>${
        next
          ? `${esc(bookingServiceSummary(next))} at ${esc(next.venue)}. Open the booking to leave a progress note or mark the next stage.`
          : 'The studio will assign confirmed bookings to you here. Keep an eye on this space.'
      }</p>
      <div class="welcome-actions">
        <button class="btn btn-primary" type="button" data-nav="schedule">Open my schedule</button>
        ${next ? `<button class="btn" type="button" data-open-booking="${esc(next.id)}">Update next booking</button>` : ''}
      </div>
    </div>

    <div class="stats-strip">
      <div class="stat-cell"><span>Assigned to you</span><strong>${active.length}</strong><small>Active bookings</small></div>
      <div class="stat-cell"><span>In progress</span><strong>${inProgress.length}</strong><small>Work underway</small></div>
      <div class="stat-cell"><span>Ready</span><strong>${ready.length}</strong><small>For pickup or handover</small></div>
      <div class="stat-cell"><span>Completed this month</span><strong>${completedThisMonth.length}</strong><small>Nice work</small></div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-head">
          <div><h3>Your assignments</h3><p>Soonest dates first</p></div>
          <button class="btn btn-sm" type="button" data-nav="schedule">Full schedule</button>
        </div>
        ${
          active.length
            ? `<div class="booking-list">${active.map((booking) => bookingRow(booking)).join('')}</div>`
            : emptyState({
                icon: 'camera',
                title: 'No assignments yet',
                text: 'Confirmed dates will appear here once the studio assigns them to you.',
              })
        }
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Crew notes</h3><p>Keep the counter in the loop</p></div></div>
          <div class="note-panel"><p><strong>Progress is a timeline, not a text thread.</strong> Add one short note when you start, when things are ready, and when the work is done.</p></div>
          <div class="note-panel"><p><strong>Payments are admin-only.</strong> If a client asks about a balance, point them to the studio rather than updating the record yourself.</p></div>
          <div class="note-panel"><p><strong>Something changing?</strong> Add a note to the booking so the admin can see it before the client calls.</p></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Completed recently</h3><p>Your latest closed dates</p></div></div>
          ${
            mine.filter((booking) => booking.status === 'completed').length
              ? `<div class="booking-list">${mine
                  .filter((booking) => booking.status === 'completed')
                  .slice(0, 3)
                  .map((booking) => bookingRow(booking))
                  .join('')}</div>`
              : '<div class="empty-state"><p>Completed bookings will collect here.</p></div>'
          }
        </div>
      </div>
    </div>`;
}

/* ---------- Staff schedule ---------- */

function renderStaffSchedule() {
  let list = [...state.bookings];
  if (state.staffFilter === 'upcoming') list = list.filter((booking) => ACTIVE_STATUSES.includes(booking.status) && daysUntil(booking.event_date) >= 0);
  if (state.staffFilter === 'progress') list = list.filter((booking) => booking.status === 'in_progress');
  if (state.staffFilter === 'completed') list = list.filter((booking) => booking.status === 'completed');
  list = sortByEventAsc(list);

  const groups = new Map();
  list.forEach((booking) => {
    if (!groups.has(booking.event_date)) groups.set(booking.event_date, []);
    groups.get(booking.event_date).push(booking);
  });

  const filters = [
    { key: 'all', label: 'All assigned' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
  ];

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Your dates</h2><p>Every date assigned to you, in one place.</p></div>
      <div class="page-actions"><button class="btn" type="button" data-nav="overview">Back to overview</button></div>
    </div>
    <div class="panel">
      <div class="toolbar">
        ${filters
          .map(
            (filter) =>
              `<button class="chip ${state.staffFilter === filter.key ? 'active' : ''}" type="button" data-staff-filter="${filter.key}">${filter.label}</button>`
          )
          .join('')}
      </div>
      ${
        list.length
          ? [...groups.entries()]
              .map(
                ([date, bookings]) => `
                <div class="schedule-day">
                  <div class="schedule-day-head">
                    <strong>${formatDate(date, 'weekday')}</strong>
                    <span>${plural(bookings.length, 'booking')}</span>
                  </div>
                  <div class="booking-list">${bookings.map((booking) => bookingRow(booking)).join('')}</div>
                </div>`
              )
              .join('')
          : emptyState({
              icon: 'calendar',
              title: 'Nothing scheduled here',
              text: 'Try another filter, or wait for the studio to assign a confirmed date.',
            })
      }
    </div>`;
}

/* ---------- Admin overview ---------- */

function renderAdminOverview() {
  const active = sortByEventAsc(activeBookings());
  const upcoming = active.filter((booking) => daysUntil(booking.event_date) >= 0);
  const pending = state.bookings.filter((booking) => booking.status === 'pending');
  const needsAttention = sortByEventAsc([
    ...pending,
    ...state.bookings.filter(
      (booking) =>
        booking.status === 'confirmed' &&
        ['unpaid'].includes(booking.payment_status) &&
        daysUntil(booking.event_date) >= 0
    ),
  ]).slice(0, 5);
  const revenue = computeRevenueThisMonth();
  const outstanding = totalOutstanding();
  const activity = state.bookings
    .flatMap((booking) =>
      (booking.updates || []).map((update) => ({
        ...update,
        bookingRef: booking.ref,
        bookingId: booking.id,
      }))
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>${greeting()}, ${esc(firstName(state.user.name))}.</h2><p>Here is where the studio stands today.</p></div>
      <div class="page-actions">
        <button class="btn" type="button" data-nav="bookings">All bookings</button>
        <button class="btn btn-primary" type="button" data-nav="reports">${ICONS.reports} Generate report</button>
      </div>
    </div>

    <div class="stats-strip">
      <div class="stat-cell"><span>Pending requests</span><strong class="${pending.length ? 'rose' : ''}">${pending.length}</strong><small>Waiting for a decision</small></div>
      <div class="stat-cell"><span>Upcoming dates</span><strong>${upcoming.length}</strong><small>Confirmed and pending</small></div>
      <div class="stat-cell"><span>Recorded this month</span><strong>${peso(revenue)}</strong><small>Payments in the current month</small></div>
      <div class="stat-cell"><span>Outstanding</span><strong>${peso(outstanding)}</strong><small>Across active bookings</small></div>
    </div>

    <div class="two-col">
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div><h3>Needs attention</h3><p>New requests and confirmed dates without a deposit</p></div>
            <button class="btn btn-sm" type="button" data-nav="bookings">Open bookings</button>
          </div>
          ${
            needsAttention.length
              ? `<div class="booking-list">${needsAttention.map((booking) => bookingRow(booking)).join('')}</div>`
              : emptyState({
                  icon: 'check',
                  title: 'All clear',
                  text: 'No pending requests or unpaid confirmed dates need a decision right now.',
                })
          }
        </div>

        <div class="panel">
          <div class="panel-head">
            <div><h3>Upcoming dates</h3><p>The studio calendar, next up</p></div>
            <button class="btn btn-sm" type="button" data-nav="bookings">View all</button>
          </div>
          ${
            upcoming.length
              ? `<div class="booking-list">${upcoming.slice(0, 6).map((booking) => bookingRow(booking)).join('')}</div>`
              : emptyState({ icon: 'calendar', title: 'No upcoming dates', text: 'New confirmed bookings will appear on the calendar.' })
          }
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Recent activity</h3><p>The last notes and status changes</p></div></div>
          ${
            activity.length
              ? `<div class="activity-list">${activity
                  .map(
                    (item) => `
                    <div class="activity-item">
                      <span class="workload-avatar">${esc(initials(item.author?.name || 'PM'))}</span>
                      <div class="activity-copy">
                        <p><strong>${esc(item.author?.name || 'Studio')}</strong> on
                          <button type="button" data-open-booking="${esc(item.bookingId)}">${esc(item.bookingRef)}</button>
                        </p>
                        <span>${esc(item.message)}</span>
                        <small>${relativeTime(item.created_at)}</small>
                      </div>
                    </div>`
                  )
                  .join('')}</div>`
              : '<div class="empty-state"><p>No activity yet.</p></div>'
          }
        </div>

        <div class="panel">
          <div class="panel-head"><div><h3>Quick actions</h3><p>The counter's shortcut</p></div></div>
          <div class="quick-actions">
            <button class="quick-action" type="button" data-nav="bookings">
              ${ICONS.bookings}<span><strong>Coordinate bookings</strong><span>Assign crews and status</span></span>
            </button>
            <button class="quick-action" type="button" data-nav="payments">
              ${ICONS.payments}<span><strong>Record a payment</strong><span>Deposits and balances</span></span>
            </button>
            <button class="quick-action" type="button" data-nav="reports">
              ${ICONS.reports}<span><strong>Generate a report</strong><span>Revenue and workload</span></span>
            </button>
            <a class="quick-action" href="/#prices">
              ${ICONS.bookings}<span><strong>View public rates</strong><span>What customers see</span></span>
            </a>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- Booking flow ---------- */

function cartTotal(item) {
  if (item.pricing_mode === 'area') {
    const area = Math.max(Number(item.min_area) || 1, Number(item.width_ft) * Number(item.height_ft));
    return Math.round(area * Number(item.price));
  }
  return Math.round(Number(item.qty) * Number(item.price));
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + cartTotal(item), 0);
}

function renderBookView() {
  const categories = state.categories || [];
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Build your booking</h2><p>Choose everything for the day. The studio confirms availability before the date is locked.</p></div>
      <div class="page-actions">
        <button class="btn btn-danger" type="button" data-cart-clear ${state.cart.length ? '' : 'hidden'}>Clear selection</button>
        <a class="btn" href="/#prices">View full rate card</a>
      </div>
    </div>
    <div class="book-grid">
      <div class="panel catalog-panel">
        <div class="catalog-tabs" id="catalog-tabs">
          <button class="chip ${state.catalogFilter === 'all' ? 'active' : ''}" type="button" data-catalog="all">All pieces</button>
          ${categories
            .map(
              (category) =>
                `<button class="chip ${state.catalogFilter === category.name ? 'active' : ''}" type="button" data-catalog="${esc(category.name)}">${esc(category.name)}</button>`
            )
            .join('')}
        </div>
        <div id="catalog-body">${catalogBodyTemplate()}</div>
      </div>

      <aside class="panel cart-panel" aria-label="Booking summary">
        <div class="panel-head">
          <div><h3>Your booking</h3><p><span id="cart-count">${plural(state.cart.length, 'line')}</span> · estimate only</p></div>
        </div>
        <div class="cart-items" id="cart-lines">${cartLinesTemplate()}</div>
        <div class="cart-totals" id="cart-totals">${cartTotalsTemplate()}</div>
        <form class="cart-form" id="booking-form" novalidate>
          <div class="field">
            <label for="booking-date">Event date</label>
            <input class="input" type="date" id="booking-date" name="event_date" min="${todayISO()}" required />
          </div>
          <div class="field">
            <label for="booking-time">Start time <span class="field-hint">optional</span></label>
            <input class="input" type="time" id="booking-time" name="event_time" />
          </div>
          <div class="field">
            <label for="booking-venue">Venue or pickup details</label>
            <input class="input" type="text" id="booking-venue" name="venue" maxlength="160" placeholder="e.g. Casa Esperanza, function hall" required />
          </div>
          <div class="field">
            <label for="booking-notes">Notes <span class="field-hint">optional</span></label>
            <textarea class="textarea" id="booking-notes" name="notes" maxlength="2000" placeholder="Theme, sizes, call time, or anything we should know."></textarea>
          </div>
          <div class="form-error" id="booking-error" role="alert"></div>
          <button class="btn btn-primary button-block" type="submit" ${state.cart.length ? '' : 'disabled'}>Send booking request</button>
          <p class="cart-note">No payment is taken here. We check the calendar first and send the 50% reservation details after you request a date.</p>
        </form>
      </aside>
    </div>`;
}

function catalogBodyTemplate() {
  const categoryFilter = state.catalogFilter;
  const categories = (state.categories || []).filter(
    (category) => categoryFilter === 'all' || category.name === categoryFilter
  );
  if (!state.services.length) {
    return '<div class="table-empty">The catalog is taking a moment. Refresh the page to try again.</div>';
  }
  return categories
    .map((category) => {
      const services = state.services.filter((service) => service.category === category.name);
      if (!services.length) return '';
      return `
        <section class="catalog-group">
          <div class="catalog-group-head"><h3>${esc(category.name)}</h3><p>${esc(category.note)}</p></div>
          ${services
            .map(
              (service) => `
            <div class="service-row">
              <div class="service-row-copy">
                <strong>${esc(service.name)}${service.popular ? '<span class="price-popular">most booked</span>' : ''}</strong>
                <p>${esc(service.description)}</p>
              </div>
              <div class="service-row-price">
                <span class="price">
                  <strong>${peso(service.price)}</strong>
                  <span>${esc(service.unit)}${service.min_qty ? ` · min ${service.min_qty}` : ''}</span>
                </span>
                <button class="add-button" type="button" data-add-service="${esc(service.id)}" aria-label="Add ${esc(service.name)}">${ICONS.plus}</button>
              </div>
            </div>`
            )
            .join('')}
        </section>`;
    })
    .join('');
}

function cartLinesTemplate() {
  if (!state.cart.length) {
    return `<div class="cart-empty">Nothing chosen yet.<br />Add a print, keepsake, or service to see the estimate.</div>`;
  }
  return state.cart
    .map((item, index) => {
      const lineTotal = cartTotal(item);
      const area = item.pricing_mode === 'area';
      return `
        <div class="cart-line">
          <div class="cart-line-top">
            <div class="cart-line-name">
              ${esc(item.name)}
              <small>${area ? `${item.width_ft} × ${item.height_ft} ft · ${peso(item.price)} per sq ft` : `${peso(item.price)} · ${esc(item.unit)}`}</small>
            </div>
            <div class="cart-line-side">
              <span class="cart-line-total">${peso(lineTotal)}</span>
              <button class="cart-line-remove" type="button" data-cart-remove="${index}" aria-label="Remove ${esc(item.name)}">×</button>
            </div>
          </div>
          <div class="cart-line-controls">
            ${
              area
                ? `<div class="dimension-inputs">
                    <input type="number" min="0.5" max="50" step="0.5" value="${item.width_ft}" data-cart-width="${index}" aria-label="Width in feet" />
                    <span>×</span>
                    <input type="number" min="0.5" max="50" step="0.5" value="${item.height_ft}" data-cart-height="${index}" aria-label="Height in feet" />
                    <span>ft</span>
                  </div>
                  <span class="tiny muted">min ${item.min_area} sq ft</span>`
                : `<div class="stepper">
                    <button type="button" data-cart-step="${index}" data-delta="-1" aria-label="Decrease quantity">−</button>
                    <span>${item.qty}</span>
                    <button type="button" data-cart-step="${index}" data-delta="1" aria-label="Increase quantity">+</button>
                  </div>
                  ${item.min_qty ? `<span class="tiny muted">min ${item.min_qty}</span>` : ''}`
            }
          </div>
        </div>`;
    })
    .join('');
}

function cartTotalsTemplate() {
  const total = cartSubtotal();
  const deposit = Math.ceil(total / 2);
  return `
    <div class="cart-total-row"><span>Subtotal</span><span>${peso(total)}</span></div>
    <div class="cart-total-row"><span>Reservation fee (50%)</span><span class="deposit">${peso(deposit)}</span></div>
    <div class="cart-total-row"><span>Balance after reservation</span><span>${peso(total - deposit)}</span></div>
    <div class="cart-total-row grand"><span>Estimated total</span><strong>${peso(total)}</strong></div>`;
}

function syncCart() {
  const lines = document.getElementById('cart-lines');
  const totals = document.getElementById('cart-totals');
  const count = document.getElementById('cart-count');
  if (!lines || !totals) return;
  lines.innerHTML = cartLinesTemplate();
  totals.innerHTML = cartTotalsTemplate();
  if (count) count.textContent = plural(state.cart.length, 'line');
  const submit = document.querySelector('#booking-form button[type="submit"]');
  if (submit) submit.disabled = state.cart.length === 0;
  const clear = document.querySelector('[data-cart-clear]');
  if (clear) clear.hidden = state.cart.length === 0;
}

function addService(id) {
  const service = state.services.find((item) => item.id === id);
  if (!service) return;
  const existing = state.cart.find(
    (item) => item.service_id === service.id && item.pricing_mode === 'fixed'
  );
  if (existing) {
    existing.qty += 1;
  } else {
    const item = {
      service_id: service.id,
      name: service.name,
      pricing_mode: service.pricing_mode,
      price: service.price,
      unit: service.unit,
      min_area: service.min_area || 0,
      min_qty: service.min_qty || 1,
      qty: service.min_qty || 1,
      width_ft: null,
      height_ft: null,
    };
    if (service.pricing_mode === 'area') {
      item.width_ft = 2;
      item.height_ft = Math.max(2, Math.ceil((service.min_area || 2) / 2));
      item.qty = 1;
    }
    state.cart.push(item);
  }
  syncCart();
  toast(`${service.name} added.`);
}

async function submitBooking(form) {
  const errorBox = document.getElementById('booking-error');
  const setError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle('show', Boolean(message));
  };
  setError('');
  if (!state.cart.length) return setError('Add at least one piece before sending your request.');
  const data = new FormData(form);
  const eventDate = String(data.get('event_date') || '');
  const venue = String(data.get('venue') || '').trim();
  if (!eventDate) return setError('Choose your event date.');
  if (eventDate < todayISO()) return setError('The event date cannot be in the past.');
  if (venue.length < 3) return setError('Add the venue or a pickup note.');

  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Sending request…';
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        event_date: eventDate,
        event_time: String(data.get('event_time') || ''),
        venue,
        notes: String(data.get('notes') || '').trim(),
        items: state.cart.map((item) => ({
          service_id: item.service_id,
          qty: item.qty,
          width_ft: item.width_ft,
          height_ft: item.height_ft,
        })),
      }),
    });
    state.bookings.unshift(booking);
    state.cart = [];
    renderChrome();
    renderView();
    showBookingSuccess(booking);
  } catch (error) {
    setError(error.message);
    button.disabled = false;
    button.textContent = label;
  }
}

function showBookingSuccess(booking) {
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay open" data-modal-overlay>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="success-title">
        <div class="modal-icon">${ICONS.check}</div>
        <h2 id="success-title">Request received.</h2>
        <p>The studio will check the calendar and get back to you with availability and the reservation details.</p>
        <div class="modal-ref">${esc(booking.ref)} · ${peso(booking.total)}</div>
        <p class="tiny">You can follow the status and payment updates from your bookings page.</p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" data-success-view>View my bookings</button>
          <button class="btn" type="button" data-modal-close>Keep planning</button>
        </div>
      </div>
    </div>`;
  syncBodyLock();
  modalRoot.querySelector('[data-success-view]')?.focus();
}

/* ---------- Admin bookings ---------- */

function filteredAdminBookings() {
  const search = state.adminSearch.trim().toLowerCase();
  return [...state.bookings]
    .filter((booking) => (state.adminStatus === 'all' ? true : booking.status === state.adminStatus))
    .filter((booking) => {
      if (!search) return true;
      return [
        booking.ref,
        booking.customer?.name,
        booking.customer?.email,
        booking.venue,
        ...(booking.items || []).map((item) => item.name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    })
    .sort((a, b) => {
      const activeA = ACTIVE_STATUSES.includes(a.status) ? 0 : 1;
      const activeB = ACTIVE_STATUSES.includes(b.status) ? 0 : 1;
      return activeA - activeB || String(a.event_date).localeCompare(String(b.event_date));
    });
}

function adminBookingsTable(list) {
  if (!list.length) {
    return '<div class="table-empty">No bookings match this view.</div>';
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Booking</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Crew</th>
          <th>Status</th>
          <th>Payment</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map(
            (booking) => `
          <tr class="clickable" data-open-booking="${esc(booking.id)}">
            <td>
              <span class="cell-main">${esc(booking.ref)}</span>
              <span class="cell-sub">${formatDate(booking.event_date, 'short')} · ${esc(formatTime(booking.event_time) || 'time TBC')}</span>
            </td>
            <td>
              <span class="cell-main">${esc(booking.customer?.name || '—')}</span>
              <span class="cell-sub">${esc(booking.customer?.phone || booking.customer?.email || '')}</span>
            </td>
            <td>
              <span class="cell-main">${esc(bookingServiceSummary(booking))}</span>
              <span class="cell-sub">${esc(booking.venue)}</span>
            </td>
            <td>${booking.staff ? esc(booking.staff.name) : '<span class="muted">Unassigned</span>'}</td>
            <td>${statusBadge(booking.status)}</td>
            <td>${statusBadge(booking.payment_status)}</td>
            <td><span class="cell-money">${peso(booking.total)}</span></td>
            <td class="cell-actions"><button class="btn btn-sm" type="button" data-open-booking="${esc(booking.id)}">Open</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderAdminTeam() {
  const staff = [...state.staff].sort((a, b) => a.name.localeCompare(b.name));
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>${plural(staff.length, 'crew account')}</h2><p>Staff only see bookings assigned to them.</p></div>
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-head"><div><h3>Add crew</h3><p>Create a sign-in for a photographer, printer, or booth attendant.</p></div></div>
        <div class="panel-body">
          <form id="team-form" class="form-grid" novalidate>
            <div class="field">
              <label for="team-name">Full name</label>
              <input class="input" id="team-name" name="name" maxlength="80" autocomplete="name" required />
            </div>
            <div class="field">
              <label for="team-email">Email</label>
              <input class="input" id="team-email" name="email" type="email" maxlength="160" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="team-phone">Phone <span class="field-hint">optional</span></label>
              <input class="input" id="team-phone" name="phone" maxlength="30" autocomplete="tel" />
            </div>
            <div class="field">
              <label for="team-password">Temporary password</label>
              <input class="input" id="team-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
              <span class="field-hint">At least 8 characters, with a letter and a number.</span>
            </div>
            <div class="form-error" data-team-error role="alert"></div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">Create crew account</button>
            </div>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Crew</h3><p>Accounts available for assignment</p></div></div>
        ${
          staff.length
            ? `<div class="workload-list">${staff
                .map(
                  (member) => `
                  <div class="workload-row">
                    <span class="workload-avatar">${esc(initials(member.name))}</span>
                    <strong>${esc(member.name)}</strong>
                    <span>${esc(member.email)}${member.phone ? ` · ${esc(member.phone)}` : ''}</span>
                  </div>`
                )
                .join('')}</div>`
            : '<div class="empty-state"><p>No crew accounts yet. Add the first one on the left.</p></div>'
        }
      </div>
    </div>`;
}

function renderAdminBookings() {
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Coordinate the calendar</h2><p>Confirm dates, assign a crew, and keep every status current.</p></div>
      <div class="page-actions">
        <button class="btn" type="button" data-nav="reports">${ICONS.reports} Reports</button>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <div class="search-field">
          ${ICONS.search}
          <input type="search" id="admin-search" placeholder="Search ref, customer, venue..." value="${esc(state.adminSearch)}" aria-label="Search bookings" />
        </div>
        <select class="filter-select" id="admin-status-filter" aria-label="Filter by booking status">
          <option value="all">All statuses</option>
          ${Object.entries(BOOKING_LABELS)
            .map(
              ([key, label]) =>
                `<option value="${key}" ${state.adminStatus === key ? 'selected' : ''}>${label}</option>`
            )
            .join('')}
        </select>
        <div class="toolbar-right"><span class="tiny muted" id="admin-booking-count"></span></div>
      </div>
      <div class="table-wrap" id="admin-booking-results"></div>
      <div class="table-foot"><span>Click a booking to manage it</span><span>${state.bookings.length} total records</span></div>
    </div>`;
  updateAdminBookingsTable();
}

function updateAdminBookingsTable() {
  const target = document.getElementById('admin-booking-results');
  if (!target) return;
  const list = filteredAdminBookings();
  target.innerHTML = adminBookingsTable(list);
  const count = document.getElementById('admin-booking-count');
  if (count) count.textContent = `${plural(list.length, 'booking')} shown`;
}

/* ---------- Admin payments ---------- */

function renderAdminPayments() {
  const active = activeBookings();
  const revenue = computeRevenueThisMonth();
  const outstanding = totalOutstanding();
  const openBalances = active.filter(
    (booking) => Number(booking.total) - Number(booking.amount_paid || 0) > 0
  ).length;
  let list = [...state.bookings].filter((booking) =>
    state.paymentFilter === 'all' ? true : booking.payment_status === state.paymentFilter
  );
  list.sort((a, b) => {
    const activeA = ACTIVE_STATUSES.includes(a.status) ? 0 : 1;
    const activeB = ACTIVE_STATUSES.includes(b.status) ? 0 : 1;
    return activeA - activeB || String(a.event_date).localeCompare(String(b.event_date));
  });

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Deposits &amp; balances</h2><p>A record of what has arrived, what is still due, and how it was paid.</p></div>
      <div class="page-actions"><button class="btn" type="button" data-nav="bookings">All bookings</button></div>
    </div>
    <div class="stats-strip">
      <div class="stat-cell"><span>Recorded this month</span><strong>${peso(revenue)}</strong><small>Payments with a current-month date</small></div>
      <div class="stat-cell"><span>Outstanding</span><strong class="${outstanding ? 'rose' : ''}">${peso(outstanding)}</strong><small>Across active bookings</small></div>
      <div class="stat-cell"><span>Open balances</span><strong>${openBalances}</strong><small>Active bookings with a balance</small></div>
      <div class="stat-cell"><span>Awaiting deposit</span><strong>${active.filter((booking) => booking.payment_status === 'unpaid').length}</strong><small>Active bookings marked unpaid</small></div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <select class="filter-select" id="payment-filter" aria-label="Filter by payment status">
          <option value="all" ${state.paymentFilter === 'all' ? 'selected' : ''}>All payment statuses</option>
          ${Object.entries(PAYMENT_LABELS)
            .map(
              ([key, label]) =>
                `<option value="${key}" ${state.paymentFilter === key ? 'selected' : ''}>${label}</option>`
            )
            .join('')}
        </select>
        <div class="toolbar-right"><span class="tiny muted">${plural(list.length, 'record')}</span></div>
      </div>
      ${
        list.length
          ? `<div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Booking</th><th>Customer</th><th>Event</th><th>Total</th><th>Paid</th><th>Balance</th><th>Method</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${list
                    .map((booking) => {
                      const balance = Math.max(0, Number(booking.total) - Number(booking.amount_paid || 0));
                      return `
                      <tr class="clickable" data-open-booking="${esc(booking.id)}">
                        <td><span class="cell-main">${esc(booking.ref)}</span></td>
                        <td><span class="cell-main">${esc(booking.customer?.name || '—')}</span></td>
                        <td>${formatDate(booking.event_date, 'short')}</td>
                        <td><span class="cell-money">${peso(booking.total)}</span></td>
                        <td><span class="cell-money">${peso(booking.amount_paid)}</span></td>
                        <td><span class="cell-money">${balance ? peso(balance) : '—'}</span></td>
                        <td>
                          <span class="cell-main">${esc(booking.payment_method || 'Not recorded')}</span>
                          <span class="cell-sub">${esc(booking.payment_ref || '')}</span>
                        </td>
                        <td>${statusBadge(booking.payment_status)}</td>
                        <td class="cell-actions"><button class="btn btn-sm" type="button" data-open-booking="${esc(booking.id)}">Record</button></td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="table-empty">No payments match this filter.</div>'
      }
      <div class="table-foot"><span>Only administrators can change a payment record.</span><span>Amounts in PHP</span></div>
    </div>`;
}

/* ---------- Reports ---------- */

async function loadReport() {
  state.reportLoading = true;
  state.reportError = '';
  if (state.view === 'reports') renderView();
  try {
    const query = `from=${encodeURIComponent(state.reportFrom)}&to=${encodeURIComponent(state.reportTo)}`;
    const { report } = await api(`/api/reports?${query}`);
    state.report = report;
  } catch (error) {
    state.reportError = error.message;
    state.report = null;
  } finally {
    state.reportLoading = false;
    if (state.view === 'reports') renderView();
  }
}

function reportBars(items, valueKey, labelKey, max) {
  return `<div class="bar-list">${items
    .map(
      (item) => `
      <div class="bar-item">
        <span>${esc(item[labelKey])}</span>
        <div class="bar-track"><i style="width:${max ? Math.round((Number(item[valueKey]) / max) * 100) : 0}%"></i></div>
        <strong>${item[valueKey]}</strong>
      </div>`
    )
    .join('')}</div>`;
}

function renderReports() {
  const csvHref = `/api/reports.csv?from=${encodeURIComponent(state.reportFrom)}&to=${encodeURIComponent(state.reportTo)}`;
  const report = state.report;
  const statusMax = report ? Math.max(1, ...report.by_status.map((item) => item.count)) : 1;
  const methodMax = report ? Math.max(1, ...report.by_method.map((item) => item.amount)) : 1;

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Operational reports</h2><p>Generated from the live booking and payment records. Pick a period, then export it for your files.</p></div>
      <div class="page-actions">
        <a class="btn" href="${esc(csvHref)}" download>${ICONS.download} Download CSV</a>
      </div>
    </div>
    <div class="panel">
      <form class="report-controls" id="report-form" novalidate>
        <div class="field">
          <label for="report-from">From</label>
          <input class="input" type="date" id="report-from" value="${esc(state.reportFrom)}" required />
        </div>
        <div class="field">
          <label for="report-to">To</label>
          <input class="input" type="date" id="report-to" value="${esc(state.reportTo)}" required />
        </div>
        <button class="btn btn-primary" type="submit" ${state.reportLoading ? 'disabled' : ''}>${state.reportLoading ? 'Generating…' : 'Generate report'}</button>
        <span class="report-meta">${report ? `Last generated ${formatDateTime(report.period.generated_at)}` : 'Generated on demand from live records'}</span>
        <div class="form-error ${state.reportError ? 'show' : ''}" role="alert" style="flex-basis:100%">${esc(state.reportError)}</div>
      </form>
      ${
        state.reportLoading && !report
          ? '<div class="load-screen"><span class="spinner" aria-hidden="true"></span> Adding up the moments...</div>'
          : report
            ? `
            <div class="report-generated">
              <div class="report-summary">
                <div class="report-stat"><span>Bookings created</span><strong>${report.summary.bookings}</strong></div>
                <div class="report-stat"><span>Completed</span><strong>${report.summary.completed}</strong></div>
                <div class="report-stat"><span>Payments recorded</span><strong>${peso(report.summary.revenue_collected)}</strong></div>
                <div class="report-stat"><span>Outstanding balance</span><strong>${peso(report.summary.outstanding)}</strong></div>
              </div>

              <div class="report-grid">
                <div class="panel">
                  <div class="panel-head"><div><h3>Services in this period</h3><p>Value of bookings created between ${formatDate(report.period.from, 'short')} and ${formatDate(report.period.to, 'short')}</p></div></div>
                  <div class="panel-body">
                    ${
                      report.by_service.length
                        ? `<table class="report-table">
                            <thead><tr><th>Service</th><th>Units</th><th>Value</th></tr></thead>
                            <tbody>${report.by_service
                              .map(
                                (service) => `<tr><td>${esc(service.name)}</td><td>${service.units}</td><td class="money">${peso(service.revenue)}</td></tr>`
                              )
                              .join('')}</tbody>
                          </table>`
                        : '<p class="tiny muted">No bookings were created in this period.</p>'
                    }
                  </div>
                </div>

                <div class="panel">
                  <div class="panel-head"><div><h3>Payment mix</h3><p>Amounts recorded in this period</p></div></div>
                  <div class="panel-body">
                    ${
                      report.by_method.length
                        ? `<div class="bar-list">${report.by_method
                            .map(
                              (method) => `
                            <div class="bar-item">
                              <span>${esc(method.method)}</span>
                              <div class="bar-track"><i style="width:${Math.round((method.amount / methodMax) * 100)}%"></i></div>
                              <strong>${peso(method.amount)}</strong>
                            </div>`
                            )
                            .join('')}</div>`
                        : '<p class="tiny muted">No payments were recorded in this period.</p>'
                    }
                  </div>
                </div>

                <div class="panel">
                  <div class="panel-head"><div><h3>Status mix</h3><p>Studio-wide booking statuses</p></div></div>
                  <div class="panel-body">
                    ${reportBars(report.by_status, 'count', 'status', statusMax)}
                  </div>
                </div>

                <div class="panel">
                  <div class="panel-head"><div><h3>Crew workload</h3><p>Active and completed assignments</p></div></div>
                  <div class="panel-body">
                    ${
                      report.staff.length
                        ? `<div class="workload-list">${report.staff
                            .map(
                              (member) => `
                            <div class="workload-row">
                              <span class="workload-avatar">${esc(initials(member.name))}</span>
                              <strong>${esc(member.name)}</strong>
                              <span>${member.active} active · ${member.completed} done</span>
                            </div>`
                            )
                            .join('')}</div>`
                        : '<p class="tiny muted">No staff accounts yet.</p>'
                    }
                  </div>
                </div>
              </div>

              <div class="panel" style="margin-top:20px">
                <div class="panel-head"><div><h3>Bookings created in this period</h3><p>${plural(report.created_bookings.length, 'record')} · export the full detail as CSV</p></div></div>
                ${
                  report.created_bookings.length
                    ? `<div class="table-wrap"><table class="data-table">
                        <thead><tr><th>Reference</th><th>Event date</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
                        <tbody>${report.created_bookings
                          .map(
                            (booking) => `<tr><td><span class="cell-main">${esc(booking.ref)}</span></td><td>${formatDate(booking.event_date, 'short')}</td><td>${esc(booking.customer)}</td><td>${statusBadge(booking.status)}</td><td>${statusBadge(booking.payment_status)}</td><td><span class="cell-money">${peso(booking.total)}</span></td></tr>`
                          )
                          .join('')}</tbody>
                      </table></div>`
                    : '<div class="table-empty">No bookings created in this period.</div>'
                }
              </div>
            </div>`
            : `<div class="empty-state">
                <div class="empty-state-icon">${ICONS.reports}</div>
                <h3>Choose a period</h3>
                <p>Generate a report to see bookings, payments, and crew workload for the dates you choose.</p>
              </div>`
      }
    </div>`;
}

/* ---------- Drawer ---------- */

function drawerItemsTemplate(booking) {
  return (booking.items || [])
    .map(
      (item) => `
      <div class="drawer-item">
        <span>${esc(item.name)}<small>${
          item.pricing_mode === 'area'
            ? `${item.width_ft} × ${item.height_ft} ft · ${item.area_sqft} sq ft`
            : `${item.qty} × ${peso(item.unit_price)} · ${esc(item.unit)}`
        }</small></span>
        <strong>${peso(item.line_total)}</strong>
      </div>`
    )
    .join('');
}

function optionsHtml(entries, selected) {
  return entries
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}" ${String(selected || '') === String(value) ? 'selected' : ''}>${esc(label)}</option>`
    )
    .join('');
}

function drawerTemplate(booking) {
  const role = state.user.role;
  const due = Math.max(0, Number(booking.total) - Number(booking.amount_paid || 0));
  const paidPercent = booking.total ? Math.min(100, Math.round((Number(booking.amount_paid || 0) / Number(booking.total)) * 100)) : 0;
  const showContact = role !== 'customer';
  const methods = PAYMENT_METHODS.includes(booking.payment_method)
    ? PAYMENT_METHODS
    : [...PAYMENT_METHODS, booking.payment_method].filter(Boolean);
  const staffOptions = [
    ['', 'Unassigned'],
    ...state.staff.map((member) => [member.id, `${member.name}${member.id === booking.staff_id ? ' (assigned)' : ''}`]),
  ];
  const canStaffUpdate = role === 'staff' && !['completed', 'cancelled'].includes(booking.status);
  const staffStatuses =
    booking.status === 'confirmed'
      ? [['in_progress', 'In progress']]
      : booking.status === 'in_progress'
        ? [['ready', 'Ready'], ['completed', 'Completed']]
        : booking.status === 'ready'
          ? [['completed', 'Completed']]
          : [];
  const contact = booking.customer || {};

  return `
    <div class="drawer-overlay open">
      <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header class="drawer-head">
          <div>
            <h2 id="drawer-title">${esc(booking.ref)}</h2>
            <p>${formatDate(booking.event_date, 'weekday')} · ${esc(formatTime(booking.event_time) || 'Time to confirm')} · ${peso(booking.total)}</p>
            <div>${statusBadge(booking.status)} ${statusBadge(booking.payment_status)}</div>
          </div>
          <button class="drawer-close" type="button" data-drawer-close aria-label="Close booking details">${ICONS.close}</button>
        </header>
        <div class="drawer-body">
          <section class="drawer-section">
            <h3>The date</h3>
            <div class="detail-grid">
              <div><span>Event date</span><strong>${formatDate(booking.event_date)}</strong></div>
              <div><span>Start time</span><strong>${esc(formatTime(booking.event_time) || 'To confirm')}</strong></div>
              <div><span>Venue</span><strong>${esc(booking.venue)}</strong></div>
              <div><span>Booking reference</span><strong>${esc(booking.ref)}</strong></div>
              ${showContact ? `<div><span>Customer</span><strong>${esc(contact.name || '—')}</strong></div><div><span>Contact</span><strong>${esc(contact.phone || contact.email || '—')}</strong></div>` : ''}
            </div>
            ${booking.notes ? `<div class="drawer-note"><span>Client notes</span><p>${esc(booking.notes)}</p></div>` : ''}
          </section>

          <section class="drawer-section">
            <h3>Pieces &amp; services</h3>
            <div class="drawer-items">${drawerItemsTemplate(booking)}</div>
            <div class="drawer-total"><span>Booking total</span><strong>${peso(booking.total)}</strong></div>
          </section>

          <section class="drawer-section">
            <h3>Payment</h3>
            <div class="payment-badge-row">
              <strong>${peso(booking.amount_paid)}</strong>
              <span>paid of ${peso(booking.total)}</span>
              ${statusBadge(booking.payment_status)}
            </div>
            <div class="pay-bar"><i style="width:${paidPercent}%"></i></div>
            <div class="detail-grid" style="margin-top:14px">
              <div><span>Balance</span><strong>${peso(due)}</strong></div>
              <div><span>Method</span><strong>${esc(booking.payment_method || 'Not recorded')}</strong></div>
              <div><span>Reference</span><strong>${esc(booking.payment_ref || '—')}</strong></div>
              <div><span>Recorded</span><strong>${booking.paid_at ? formatDateTime(booking.paid_at) : '—'}</strong></div>
            </div>
            ${
              role === 'admin'
                ? `<form data-form-type="payment" data-id="${esc(booking.id)}" style="margin-top:16px">
                    <div class="drawer-form">
                      <div class="field">
                        <label for="pay-status">Payment status</label>
                        <select class="select" id="pay-status" name="payment_status" data-payment-status-select data-total="${booking.total}">
                          ${optionsHtml(Object.entries(PAYMENT_LABELS), booking.payment_status)}
                        </select>
                      </div>
                      <div class="field">
                        <label for="pay-amount">Amount paid</label>
                        <input class="input" id="pay-amount" name="amount_paid" type="number" min="0" max="${booking.total}" step="0.01" value="${booking.amount_paid}" />
                      </div>
                      <div class="field">
                        <label for="pay-method">Method</label>
                        <select class="select" id="pay-method" name="payment_method">
                          ${optionsHtml(methods.map((method) => [method, method || 'Not recorded']), booking.payment_method)}
                        </select>
                      </div>
                      <div class="field">
                        <label for="pay-ref">Reference</label>
                        <input class="input" id="pay-ref" name="payment_ref" type="text" maxlength="80" value="${esc(booking.payment_ref || '')}" placeholder="GCash / OR number" />
                      </div>
                      <p class="form-note">Marking “paid in full” records the complete total. Marking “deposit paid” suggests the 50% reservation fee.</p>
                      <div class="form-error field-full" data-drawer-error></div>
                      <div class="drawer-form-actions"><button class="btn btn-primary" type="submit">Save payment</button></div>
                    </div>
                  </form>`
                : ''
            }
          </section>

          ${
            role === 'admin'
              ? `<section class="drawer-section">
                  <h3>Crew &amp; schedule</h3>
                  <form data-form-type="admin-booking" data-id="${esc(booking.id)}">
                    <div class="drawer-form">
                      <div class="field">
                        <label for="admin-status">Booking status</label>
                        <select class="select" id="admin-status" name="status">
                          ${optionsHtml(Object.entries(BOOKING_LABELS), booking.status)}
                        </select>
                      </div>
                      <div class="field">
                        <label for="admin-staff">Assigned crew</label>
                        <select class="select" id="admin-staff" name="staff_id">
                          ${optionsHtml(staffOptions, booking.staff_id || '')}
                        </select>
                      </div>
                      <div class="field">
                        <label for="admin-date">Event date</label>
                        <input class="input" id="admin-date" name="event_date" type="date" value="${esc(booking.event_date)}" />
                      </div>
                      <div class="field">
                        <label for="admin-time">Start time</label>
                        <input class="input" id="admin-time" name="event_time" type="time" value="${esc(booking.event_time || '')}" />
                      </div>
                      <div class="field field-full">
                        <label for="admin-venue">Venue</label>
                        <input class="input" id="admin-venue" name="venue" type="text" maxlength="160" value="${esc(booking.venue)}" />
                      </div>
                      <div class="field field-full">
                        <label for="admin-message">Add a note to the timeline <span class="field-hint">optional</span></label>
                        <input class="input" id="admin-message" name="message" type="text" maxlength="500" placeholder="e.g. Confirmed by phone; layout approved." />
                      </div>
                      <div class="form-error field-full" data-drawer-error></div>
                      <div class="drawer-form-actions"><button class="btn btn-primary" type="submit">Save changes</button></div>
                    </div>
                  </form>
                </section>`
              : ''
          }

          ${
            canStaffUpdate
              ? `<section class="drawer-section">
                  <h3>Update progress</h3>
                  <form data-form-type="staff-booking" data-id="${esc(booking.id)}">
                    <div class="drawer-form">
                      ${
                        staffStatuses.length
                          ? `<div class="field field-full">
                              <label for="staff-status">Next stage</label>
                              <select class="select" id="staff-status" name="status">
                                ${optionsHtml(staffStatuses, '')}
                              </select>
                            </div>`
                          : '<p class="form-note field-full">This booking is waiting for admin confirmation before work can start.</p>'
                      }
                      <div class="field field-full">
                        <label for="staff-message">Progress note <span class="field-hint">optional</span></label>
                        <textarea class="textarea" id="staff-message" name="message" maxlength="500" placeholder="What changed on site?"></textarea>
                      </div>
                      <div class="form-error field-full" data-drawer-error></div>
                      <div class="drawer-form-actions"><button class="btn btn-primary" type="submit">Post update</button></div>
                    </div>
                  </form>
                </section>`
              : role === 'staff'
                ? `<section class="drawer-section"><h3>Update progress</h3><p class="form-note">This booking is closed. The timeline below is read-only.</p></section>`
                : ''
          }

          ${
            role === 'customer'
              ? `<section class="drawer-section">
                  <h3>Need to change something?</h3>
                  <p class="form-note">For custom sizes, added items, or a new date, message the studio and we will sort it out with you.</p>
                  <div class="drawer-form-actions" style="justify-content:flex-start;margin-top:12px">
                    <a class="btn" href="mailto:hello@preciousmoments.ph">Email the studio</a>
                    ${
                      booking.status === 'pending'
                        ? '<button class="btn btn-danger" type="button" data-cancel-booking="' + esc(booking.id) + '">Cancel request</button>'
                        : ''
                    }
                  </div>
                </section>`
              : ''
          }

          <section class="drawer-section">
            <h3>Timeline</h3>
            ${
              (booking.updates || []).length
                ? `<div class="timeline">${booking.updates
                    .map(
                      (update) => `
                      <div class="timeline-item">
                        <strong>${esc(update.author?.name || 'Studio')} · ${esc(statusLabel(update.status))}</strong>
                        <span>${formatDateTime(update.created_at)}</span>
                        <p>${esc(update.message)}</p>
                      </div>`
                    )
                    .join('')}</div>`
                : '<p class="form-note">No updates yet.</p>'
            }
          </section>
        </div>
      </div>
    </div>`;
}

function renderDrawer(booking, scroll = 0) {
  state.activeBooking = booking;
  drawerRoot.innerHTML = drawerTemplate(booking);
  syncBodyLock();
  const body = drawerRoot.querySelector('.drawer-body');
  if (body) body.scrollTop = scroll;
}

async function openBooking(id) {
  state.lastFocused = document.activeElement;
  state.cancelArmed = false;
  drawerRoot.innerHTML = `
    <div class="drawer-overlay open">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Booking details">
        <div class="drawer-head">
          <div><h2>Opening booking…</h2><p>Getting the latest update</p></div>
          <button class="drawer-close" type="button" data-drawer-close aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="load-screen"><span class="spinner" aria-hidden="true"></span> Loading the details...</div>
      </div>
    </div>`;
  syncBodyLock();
  try {
    const { booking } = await api(`/api/bookings/${encodeURIComponent(id)}`);
    renderDrawer(booking);
    drawerRoot.querySelector('[data-drawer-close]')?.focus();
  } catch (error) {
    drawerRoot.innerHTML = '';
    syncBodyLock();
    toast(error.message);
  }
}

function closeDrawer({ restoreFocus = true } = {}) {
  drawerRoot.innerHTML = '';
  state.activeBooking = null;
  state.cancelArmed = false;
  syncBodyLock();
  if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
}

function closeModal({ restoreFocus = true } = {}) {
  modalRoot.innerHTML = '';
  syncBodyLock();
  if (restoreFocus && state.lastModalFocus instanceof HTMLElement) state.lastModalFocus.focus();
}

function syncBodyLock() {
  const locked = drawerRoot.children.length > 0 || modalRoot.children.length > 0;
  document.body.classList.toggle('no-scroll', locked);
}

function refreshAfterBooking(booking) {
  const index = state.bookings.findIndex((item) => item.id === booking.id);
  if (index >= 0) state.bookings[index] = booking;
  else state.bookings.unshift(booking);
  renderChrome();
  updatePageMeta();
  renderView();
}

/* ---------- Forms in drawer ---------- */

async function submitDrawerForm(form) {
  const type = form.dataset.formType;
  const id = form.dataset.id;
  const errorBox = form.querySelector('[data-drawer-error]');
  const button = form.querySelector('button[type="submit"]');
  const label = button?.textContent;
  const setError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle('show', Boolean(message));
  };
  setError('');
  const data = new FormData(form);
  let payload;
  let endpoint = `/api/bookings/${encodeURIComponent(id)}`;
  if (type === 'payment') {
    endpoint += '/payment';
    payload = {
      payment_status: data.get('payment_status'),
      amount_paid: Number(data.get('amount_paid')),
      payment_method: data.get('payment_method'),
      payment_ref: data.get('payment_ref'),
    };
  } else if (type === 'staff-booking') {
    payload = {
      status: data.get('status') || '',
      message: data.get('message') || '',
    };
  } else {
    payload = {
      status: data.get('status'),
      staff_id: data.get('staff_id') || null,
      event_date: data.get('event_date'),
      event_time: data.get('event_time') || '',
      venue: data.get('venue'),
      message: data.get('message') || '',
    };
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Saving…';
  }
  try {
    const { booking } = await api(endpoint, { method: 'PATCH', body: JSON.stringify(payload) });
    const scroll = drawerRoot.querySelector('.drawer-body')?.scrollTop || 0;
    refreshAfterBooking(booking);
    renderDrawer(booking, scroll);
    toast(type === 'payment' ? 'Payment record updated.' : 'Booking updated.');
  } catch (error) {
    setError(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

async function cancelBooking(id) {
  try {
    const { booking } = await api(`/api/bookings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'cancel' }),
    });
    const scroll = drawerRoot.querySelector('.drawer-body')?.scrollTop || 0;
    refreshAfterBooking(booking);
    renderDrawer(booking, scroll);
    toast('Request cancelled.');
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- Event handling ---------- */

document.addEventListener('click', async (event) => {
  const target = event.target;

  if (target.closest('[data-reload]')) {
    window.location.reload();
    return;
  }

  const nav = target.closest('[data-nav]');
  if (nav) {
    event.preventDefault();
    closeDrawer({ restoreFocus: false });
    closeModal({ restoreFocus: false });
    go(nav.dataset.nav);
    return;
  }

  if (target.closest('[data-open-sidebar]')) {
    document.body.classList.add('sidebar-open');
    return;
  }
  if (target.closest('[data-close-sidebar]')) {
    document.body.classList.remove('sidebar-open');
    return;
  }
  if (target.closest('[data-logout]')) {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      window.location.replace('/login');
    }
    return;
  }

  const openBookingButton = target.closest('[data-open-booking]');
  if (openBookingButton) {
    event.preventDefault();
    await openBooking(openBookingButton.dataset.openBooking);
    return;
  }

  if (target.closest('[data-drawer-close]') || target.classList.contains('drawer-overlay')) {
    closeDrawer();
    return;
  }
  if (target.classList.contains('modal-overlay') || target.closest('[data-modal-close]')) {
    closeModal();
    return;
  }
  if (target.closest('[data-success-view]')) {
    closeModal({ restoreFocus: false });
    go('bookings');
    return;
  }

  const catalog = target.closest('[data-catalog]');
  if (catalog) {
    state.catalogFilter = catalog.dataset.catalog;
    document.querySelectorAll('[data-catalog]').forEach((button) => {
      button.classList.toggle('active', button.dataset.catalog === state.catalogFilter);
    });
    const body = document.getElementById('catalog-body');
    if (body) body.innerHTML = catalogBodyTemplate();
    return;
  }

  const add = target.closest('[data-add-service]');
  if (add) {
    addService(add.dataset.addService);
    return;
  }

  const remove = target.closest('[data-cart-remove]');
  if (remove) {
    state.cart.splice(Number(remove.dataset.cartRemove), 1);
    syncCart();
    return;
  }

  const step = target.closest('[data-cart-step]');
  if (step) {
    const index = Number(step.dataset.cartStep);
    const delta = Number(step.dataset.delta);
    const item = state.cart[index];
    if (item) {
      item.qty = Math.max(item.min_qty || 1, item.qty + delta);
      syncCart();
    }
    return;
  }

  if (target.closest('[data-cart-clear]')) {
    state.cart = [];
    syncCart();
    return;
  }

  const customerFilter = target.closest('[data-customer-filter]');
  if (customerFilter) {
    state.customerFilter = customerFilter.dataset.customerFilter;
    renderView();
    return;
  }

  const staffFilter = target.closest('[data-staff-filter]');
  if (staffFilter) {
    state.staffFilter = staffFilter.dataset.staffFilter;
    renderView();
    return;
  }

  const cancel = target.closest('[data-cancel-booking]');
  if (cancel) {
    if (cancel.dataset.armed !== 'true') {
      cancel.dataset.armed = 'true';
      cancel.textContent = 'Tap again to cancel';
      toast('Tap once more to cancel this request.');
      return;
    }
    cancel.disabled = true;
    await cancelBooking(cancel.dataset.cancelBooking);
    return;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;

  if (target.matches('[data-cart-width]') || target.matches('[data-cart-height]')) {
    const index = Number(target.dataset.cartWidth ?? target.dataset.cartHeight);
    const item = state.cart[index];
    if (!item) return;
    const value = Math.min(50, Math.max(0.5, Number(target.value) || 0.5));
    if (target.matches('[data-cart-width]')) item.width_ft = value;
    else item.height_ft = value;
    syncCart();
    return;
  }

  if (target.matches('[data-payment-status-select]')) {
    const form = target.closest('form');
    const total = Number(target.dataset.total) || 0;
    const amount = form?.querySelector('[name="amount_paid"]');
    if (!amount) return;
    if (target.value === 'unpaid') amount.value = '0';
    else if (target.value === 'deposit_paid') amount.value = String(Math.ceil(total / 2));
    else if (target.value === 'paid') amount.value = String(total);
    return;
  }

  if (target.matches('#admin-status-filter')) {
    state.adminStatus = target.value;
    updateAdminBookingsTable();
    return;
  }

  if (target.matches('#payment-filter')) {
    state.paymentFilter = target.value;
    renderView();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('#admin-search')) {
    state.adminSearch = event.target.value;
    updateAdminBookingsTable();
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'booking-form') {
    event.preventDefault();
    await submitBooking(form);
    return;
  }
  if (form.id === 'team-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-team-error]');
    const data = new FormData(form);
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const result = await api('/api/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone'),
          password: data.get('password'),
        }),
      });
      state.staff.push(result.user);
      toast('Crew account created.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Create crew account';
    }
    return;
  }
  if (form.id === 'report-form') {
    event.preventDefault();
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    if (!from || !to || from > to) {
      state.reportError = 'Choose a valid date range, with the start on or before the end.';
      renderView();
      return;
    }
    state.reportFrom = from;
    state.reportTo = to;
    state.report = null;
    await loadReport();
    return;
  }
  if (form.dataset.formType) {
    event.preventDefault();
    await submitDrawerForm(form);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (modalRoot.children.length) {
      closeModal();
      return;
    }
    if (drawerRoot.children.length) closeDrawer();
    return;
  }
  if (event.key !== 'Tab') return;
  const overlay = modalRoot.children.length
    ? modalRoot.querySelector('.modal')
    : drawerRoot.children.length
      ? drawerRoot.querySelector('.drawer')
      : null;
  if (!overlay) return;
  const focusables = [
    ...overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((node) => node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener('hashchange', () => {
  if (!state.user) return;
  navigate(parseView());
});

/* ---------- Boot ---------- */

async function init() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      window.location.replace('/login?next=/app');
      return;
    }
    state.user = user;
    const requests = [api('/api/services'), api('/api/bookings')];
    if (user.role === 'admin') requests.push(api('/api/staff'));
    const [catalog, bookingData, staffData] = await Promise.all(requests);
    state.services = catalog.services || [];
    state.categories = catalog.categories || [];
    state.bookings = bookingData.bookings || [];
    state.staff = staffData?.staff || [];
    const view = parseView();
    if (!window.location.hash) history.replaceState(null, '', `#${view}`);
    renderChrome();
    await navigate(view);
  } catch (error) {
    console.error(error);
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.close}</div>
        <h3>We could not open the dashboard</h3>
        <p>${esc(error.message)}</p>
        <button class="btn btn-primary" type="button" data-reload>Try again</button>
      </div>`;
  }
}

init();
