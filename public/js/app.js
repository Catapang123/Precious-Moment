/**
 * The signed-in dashboard (`/app`).
 *
 * One document serves three audiences, and the role decides which views exist:
 *
 *  - customer     — overview, new booking, my bookings, account
 *  - branch head  — branch overview, bookings, payments, team, alerts, account
 *  - owner        — everything above plus discounts, reports, and studio accounts
 *
 * Structure of this file, top to bottom:
 *  1. DOM roots, labels, icons, navigation, page copy, and `state`
 *  2. Small helpers (dates, money, names) and shared view fragments
 *  3. One render function per view, composed from template strings
 *  4. The booking flow (catalog, cart, availability, submit)
 *  5. Drawer and modal rendering, focus handling, and motion
 *  6. Event delegation for the whole dashboard, then `init()`
 *
 * There is no framework: every view is HTML built from `state` and inserted
 * into `#view`. Re-rendering the current view is the update mechanism, which is
 * why handlers are delegated from `document` rather than bound per element.
 *
 * All markup interpolates through `esc()` before reaching the DOM.
 */
import {
  api,
  errorInfo,
  esc,
  formatDate,
  formatDateTime,
  formatTime,
  getCurrentUser,
  initials,
  monthStartISO,
  peso,
  priceGroupsHtml,
  serviceTierSummary,
  statusLabel,
  suggestTerm,
  toast,
  todayISO,
} from './api.js';
import { animateStats } from './motion.js';

/* ---------- DOM roots and shared constants ---------- */

const viewRoot = document.getElementById('view');
const navRoot = document.querySelector('[data-sidebar-nav]');
const userChip = document.querySelector('[data-user-chip]');
const drawerRoot = document.getElementById('drawer-root');
const modalRoot = document.getElementById('modal-root');

// Statuses that still hold a booth slot and still owe money. Kept in step with
// ACTIVE_STATUSES in server/availability.js.
const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_progress', 'ready'];
const BOOKING_LABELS = {
  pending: 'Pending request',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const DEPLOYMENT_STATUSES = ['unassigned', 'scheduled', 'dispatched', 'on_site', 'collected'];
const DEPLOYMENT_LABELS = {
  unassigned: 'Unassigned',
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  on_site: 'On site',
  collected: 'Collected',
};
const BOOTH_UNIT_POOL = {
  photobooth: { label: 'Photobooth', units: ['PB-1', 'PB-2', 'PB-3', 'PB-4', 'PB-5'] },
  video: { label: 'Video booth', units: ['VB-1'] },
  mirror: { label: 'Mirror booth', units: ['MB-1'] },
  studio: { label: 'Studio booth', units: ['SB-1', 'SB-2'] },
};
const BOOTH_TYPE_BY_SERVICE = {
  'photobooth-4r': 'photobooth',
  'photobooth-4r-magnetic': 'photobooth',
  'photobooth-strips': 'photobooth',
  'photobooth-strips-magnetic': 'photobooth',
  'booth-360': 'video',
  'booth-mirror': 'mirror',
  'booth-studio': 'studio',
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
  inventory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4z"/><path d="M8 4h8l2 3H6l2-3zM9 12h6M9 16h4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 20h16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
};

// Sidebar per role. A key here must exist in PAGE_META and in `renderView`.
const NAV = {
  customer: [
    { key: 'overview', label: 'Overview', icon: 'home' },
    { key: 'book', label: 'New booking', icon: 'plus' },
    { key: 'bookings', label: 'My bookings', icon: 'calendar' },
    { key: 'account', label: 'Account & security', icon: 'staff' },
  ],
  staff: [
    { key: 'overview', label: 'Studio day', icon: 'home' },
    { key: 'schedule', label: 'My schedule', icon: 'schedule' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'account', label: 'Account & security', icon: 'staff' },
  ],
  admin: [
    { key: 'overview', label: 'Overview', icon: 'home' },
    { key: 'bookings', label: 'Bookings', icon: 'bookings' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'inventory', label: 'Inventory', icon: 'inventory' },
    { key: 'payments', label: 'Payments', icon: 'payments' },
    { key: 'discounts', label: 'Discounts', icon: 'spark' },
    { key: 'images', label: 'Product media', icon: 'camera' },
    { key: 'pricing', label: 'Pricing', icon: 'payments' },
    { key: 'reports', label: 'Reports', icon: 'reports' },
    { key: 'team', label: 'Team', icon: 'staff' },
    { key: 'alerts', label: 'Alerts', icon: 'mail' },
    { key: 'account', label: 'Account & security', icon: 'check' },
  ],
  branch_admin: [
    { key: 'overview', label: 'Overview', icon: 'home' },
    { key: 'bookings', label: 'Bookings', icon: 'bookings' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'inventory', label: 'Inventory', icon: 'inventory' },
    { key: 'payments', label: 'Payments', icon: 'payments' },
    { key: 'images', label: 'Product media', icon: 'camera' },
    { key: 'team', label: 'Team', icon: 'staff' },
    { key: 'alerts', label: 'Alerts', icon: 'mail' },
    { key: 'account', label: 'Account & security', icon: 'check' },
  ],
};

// Page title and subtitle per role and view, also used for the browser title.
const PAGE_META = {
  customer: {
    overview: { title: 'Your moments', subtitle: 'Bookings, payments, and studio updates in one place.' },
    book: { title: 'New booking', subtitle: 'Choose the pieces, send the date, and we take it from there.' },
    bookings: { title: 'My bookings', subtitle: 'Every request and every update, kept together.' },
    account: { title: 'Account & security', subtitle: 'Your sign-in, password, and two-factor settings.' },
  },
  staff: {
    overview: { title: 'Studio day', subtitle: 'Your assigned events and what needs a nudge.' },
    schedule: { title: 'My schedule', subtitle: 'Dates, crews, and the progress of each booking.' },
    calendar: { title: 'Calendar', subtitle: 'Setup, event, and pickup work in your branch scope.' },
    account: { title: 'Account & security', subtitle: 'Your sign-in, password, and two-factor settings.' },
  },
  admin: {
    overview: { title: 'Studio overview', subtitle: 'The whole day, from requests to recorded payments.' },
    bookings: { title: 'Bookings', subtitle: 'Coordinate dates, crews, and service progress.' },
    calendar: { title: 'Logistics calendar', subtitle: 'Setup, event, and pickup schedules with deployment status and assigned units.' },
    inventory: { title: 'Inventory', subtitle: 'Physical booth units, maintenance blocks, and overlapping commitments.' },
    payments: { title: 'Payments', subtitle: 'Keep a clear record of deposits and balances.' },
    discounts: { title: 'Discounts', subtitle: 'Assign a loyalty or courtesy discount to a customer.' },
    images: { title: 'Product media', subtitle: 'The shared catalog photos and preview videos customers see — upload, replace, or remove.' },
    pricing: { title: 'Pricing', subtitle: 'Retail rates, quantity breaks, and the client-only price list.' },
    reports: { title: 'Reports', subtitle: 'The numbers behind the moments.' },
    team: { title: 'Team', subtitle: 'Studio accounts and the crew records available for assignment.' },
    alerts: { title: 'Alerts', subtitle: 'New bookings routed to a branch land here.' },
    account: { title: 'Account & security', subtitle: 'Password and two-factor protection for your sign-in.' },
  },
  branch_admin: {
    overview: { title: 'Branch overview', subtitle: 'Your branch, from requests to recorded payments.' },
    bookings: { title: 'Branch bookings', subtitle: 'Only the bookings routed to your branch.' },
    calendar: { title: 'Branch logistics calendar', subtitle: 'Setup, event, and pickup schedules for your branch.' },
    inventory: { title: 'Studio inventory', subtitle: 'Shared physical units, maintenance blocks, and upcoming booth deployments.' },
    payments: { title: 'Branch payments', subtitle: 'Deposits and balances for your branch.' },
    images: { title: 'Product media', subtitle: 'Manage the shared catalog photos and preview videos for every product, at either branch.' },
    team: { title: 'Branch team', subtitle: 'Crew records available for this branch; they do not sign in.' },
    alerts: { title: 'Alerts', subtitle: 'New bookings that were routed to your branch.' },
    account: { title: 'Account & security', subtitle: 'Password and two-factor protection for your sign-in.' },
  },
};

/* ---------- Application state ---------- */

/**
 * The single mutable store for the dashboard. Everything the views read comes
 * from here: the signed-in user, the loaded collections, filters, and the
 * transient booking cart. Views never fetch on their own; `init`, `navigate`,
 * and the action handlers keep this object current and then re-render.
 */
const state = {
  user: null,
  bookings: [],
  services: [],
  categories: [],
  staff: [],
  branches: [],
  notifications: [],
  unread: 0,
  view: 'overview',
  activeBooking: null,
  cart: [],
  catalogFilter: 'all',
  catalogSearch: '',
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
  reportSection: 'summary',
  bookingType: 'event',
  typeNotice: '',
  newProductOpen: false,
  pickupBranchId: '',
  branchTouched: false,
  customerDiscount: null,
  availability: null,
  accounts: [],
  discounts: [],
  pricing: null,
  pricingError: '',
  images: null,
  imagesError: '',
  inventory: null,
  inventoryError: '',
  inventoryDate: todayISO(),
  inventoryTime: '09:00',
  inventoryHours: 3,
  inventoryLoading: false,
  calendar: null,
  calendarError: '',
  calendarMonth: todayISO().slice(0, 7),
  calendarBranch: '',
  calendarLoading: false,
  imageFilter: 'all',
  imageSearch: '',
  imageSelections: new Map(),
  chat: [],
  chatId: null,
  chatConversations: [],
  chatHistoryOpen: false,
  chatHistoryLoading: false,
  chatHistoryLoaded: false,
  chatHistoryError: '',
  chatLoadingConversation: false,
  // PRECIOUS: which language the panel speaks, whether a reply is pending, and
  // the last message to resend if a request failed.
  chatLang: 'en',
  chatTyping: false,
  chatRetry: '',
  // Interface state shared by the global banners and dialogs.
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingDraft: null,
  sessionEnded: false,
  mfaSetup: null,
  lastFocused: null,
  lastModalFocus: null,
  drawerOpening: false,
  cancellations: null,
};

/* ---------- Customer design and reference uploads ---------- */

const IMAGE_ERRORS = {
  format: 'Unsupported image format. Please upload JPG, PNG, or WEBP.',
  size: 'Image exceeds the 4 MB limit.',
  small: 'Image dimensions must be at least 300 × 300 pixels.',
  damaged: 'This image file is damaged or cannot be opened. Please select another image.',
  upload: 'Unable to upload the image. Please check your connection and try again.',
};
const KNOWN_IMAGE_ERRORS = new Set(Object.values(IMAGE_ERRORS));

const VIDEO_ERRORS = {
  format: 'Unsupported video format. Please upload MP4 or WEBM.',
  size: 'Video exceeds the 25 MB limit.',
  upload: 'Unable to upload the video. Please check your connection and try again.',
};

const DESIGN_MAX_BYTES = 10 * 1024 * 1024;
const DESIGN_MAX_FILES = 8;
const DESIGN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'psd', 'ai', 'svg']);
const DESIGN_STATUS_LABELS = {
  for_review: 'For review',
  in_progress: 'Design in progress',
  for_approval: 'For customer approval',
  approved: 'Approved for printing',
};
// Files chosen before the booking exists; uploaded right after it is created.
let designQueue = [];

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

function isAdminRole(role = state.user?.role) {
  return role === 'admin' || role === 'branch_admin';
}

function branchName(id) {
  const branch = state.branches.find((item) => item.id === id);
  return branch ? branch.name : 'Unassigned';
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

/* ---------- Shared view fragments: badges, rows, empty states ---------- */

function statusBadge(status, label = '') {
  const safe = String(status || '').replace(/[^a-z_]/g, '') || 'pending';
  return `<span class="status-badge status-${safe}">${esc(label || statusLabel(safe))}</span>`;
}

function deploymentBadge(status) {
  const safe = DEPLOYMENT_STATUSES.includes(status) ? status : 'unassigned';
  return `<span class="deployment-badge deployment-${safe.replace('_', '-')}">${esc(
    DEPLOYMENT_LABELS[safe]
  )}</span>`;
}

function itemSummary(item) {
  if (item.pricing_mode === 'area') {
    const unit = item.dimension_unit === 'in' ? 'in' : 'ft';
    const billed = billedDimensions(item);
    const original = `${item.width_ft}×${item.height_ft} ${unit}`;
    const final = `${billed.width}×${billed.height}`;
    const billedChanged = item.round_dimensions_up && final !== `${item.width_ft}×${item.height_ft}`;
    return `${item.name} · ${original}${billedChanged ? ` (billed ${final} ${unit})` : ''}`;
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
  const where =
    booking.booking_type === 'pickup'
      ? `Pickup at ${booking.branch?.name || 'the studio'}`
      : booking.venue;
  const subline = showCustomer && booking.customer
    ? `${booking.customer.name} · ${formatTime(booking.event_time) || 'Time to confirm'} · ${where}`
    : `${formatTime(booking.event_time) || 'Time to confirm'} · ${where}`;
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

/**
 * The empty state for a search that returned nothing. Unlike `emptyState`, it
 * names the query, offers a likely correction when the typo is obvious, and
 * always provides a one-click way out of the filters.
 */
function noResultsState({ title, text, suggestion = '', actions = '' }) {
  return `
    <div class="no-results">
      <div class="no-results-icon">${ICONS.search}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${
        suggestion
          ? `<p class="tiny">Did you mean <button class="link-button" type="button" data-use-suggestion="${esc(suggestion)}">${esc(suggestion)}</button>?</p>`
          : ''
      }
      ${actions ? `<div class="no-results-actions">${actions}</div>` : ''}
    </div>`;
}

/* ---------- Chrome ---------- */

function navBadge(key) {
  if (isAdminRole()) {
    if (key === 'bookings') return state.bookings.filter((booking) => booking.status === 'pending').length;
    if (key === 'payments') {
      return state.bookings.filter(
        (booking) => booking.payment_status === 'unpaid' && ACTIVE_STATUSES.includes(booking.status)
      ).length;
    }
    if (key === 'alerts') return state.unread;
  }
  if (state.user.role === 'staff' && key === 'schedule') {
    return state.bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status)).length;
  }
  if (state.user.role === 'customer' && key === 'bookings') return activeBookings().length;
  return 0;
}

/* ---------- Shell: sidebar, header, and routing ---------- */

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
    role === 'admin'
      ? 'Studio administration'
      : role === 'branch_admin'
        ? `${branchName(state.user.branch_id)} administration`
        : role === 'staff'
          ? 'Studio crew'
          : 'Customer account';

  userChip.innerHTML = `
    <span class="avatar">${esc(initials(state.user.name))}</span>
    <span class="user-chip-copy">
      <strong>${esc(state.user.name)}</strong>
      <span>${esc(role === 'branch_admin' ? branchName(state.user.branch_id) : state.user.role)}</span>
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
  document.querySelector('[data-open-sidebar]')?.setAttribute('aria-expanded', 'false');
  if (window.location.hash === `#${view}`) {
    navigate(view);
  } else {
    window.location.hash = view;
  }
}

let lastViewIndex = null;

function viewPosition(view) {
  return (NAV[state.user?.role] || []).findIndex((item) => item.key === view);
}

/**
 * Switches to a view: updates the hash, loads anything that view needs, then
 * renders. Called by `init`, by sidebar clicks, and by `hashchange`.
 */
async function navigate(view) {
  if (!state.user) return;
  const allowed = NAV[state.user.role].map((item) => item.key);
  state.view = allowed.includes(view) ? view : 'overview';
  const position = viewPosition(state.view);
  const direction = lastViewIndex === null || position >= lastViewIndex ? 1 : -1;
  lastViewIndex = position;
  updatePageMeta();
  renderChrome();
  if (state.view === 'pricing' && !state.pricing && !state.pricingError) {
    renderView();
    runViewTransition(direction);
    await loadPricing();
    return;
  }
  if (state.view === 'images' && !state.images && !state.imagesError) {
    renderView();
    runViewTransition(direction);
    await loadProductImages();
    return;
  }
  if (state.view === 'reports' && !state.report && !state.reportLoading) {
    renderView();
    runViewTransition(direction);
    await loadReport();
    return;
  }
  if (state.view === 'inventory' && !state.inventory && !state.inventoryError) {
    renderView();
    runViewTransition(direction);
    await loadInventory();
    return;
  }
  if (state.view === 'calendar') {
    renderView();
    runViewTransition(direction);
    const bounds = calendarBounds(state.calendarMonth);
    if (
      !state.calendar ||
      state.calendar.from !== bounds.from ||
      state.calendar.to !== bounds.to ||
      state.calendar.branch_id !== (state.calendarBranch || '')
    ) {
      await loadCalendar();
    }
    return;
  }
  renderView();
  runViewTransition(direction);
  window.scrollTo(0, 0);
}

/** Renders the current view for the current role. Unknown views fall back to
 * the overview, which is also what a hand-edited `#hash` gets. */
function renderView() {
  if (!state.user) return;
  const role = state.user.role;
  if (role === 'customer') {
    if (state.view === 'book') renderBookView();
    else if (state.view === 'bookings') renderCustomerBookings();
    else if (state.view === 'account') renderAccount();
    else renderCustomerOverview();
  } else if (role === 'staff') {
    if (state.view === 'schedule') renderStaffSchedule();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'account') renderAccount();
    else renderStaffOverview();
  } else if (isAdminRole(role)) {
    if (state.view === 'bookings') renderAdminBookings();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'inventory') renderAdminInventory();
    else if (state.view === 'payments') renderAdminPayments();
    else if (state.view === 'discounts') renderAdminDiscounts();
    else if (state.view === 'images') renderAdminImages();
    else if (state.view === 'pricing') renderAdminPricing();
    else if (state.view === 'reports') renderReports();
    else if (state.view === 'team') renderAdminTeam();
    else if (state.view === 'alerts') renderAlerts();
    else if (state.view === 'account') renderAccount();
    else renderAdminOverview();
  }
  primeRows();
  animateStats(viewRoot);
  // A restored draft can only be poured into the form once it exists.
  if (state.view === 'book') applyDraftFields();
}

/* ---------- Customer overview ---------- */

/* ---------- Customer views ---------- */

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
            <button class="quick-action" type="button" data-assistant-open>
              ${ICONS.mail}<span><strong>Ask PRECIOUS</strong><span>Your assistant, in English or Filipino</span></span>
            </button>
            <button class="quick-action" type="button" data-rate-card>
              ${ICONS.bookings}<span><strong>Browse the rate card</strong><span>Starting prices</span></span>
            </button>
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

/* ---------- Staff views: read-only day and schedule ---------- */

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

/* ---------- Owner and branch-head overview ---------- */

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
        ${
          state.user.role === 'admin'
            ? `<button class="btn btn-primary" type="button" data-nav="reports">${ICONS.reports} Generate report</button>`
            : `<button class="btn btn-primary" type="button" data-nav="alerts">${ICONS.mail} Alerts${state.unread ? ` · ${state.unread}` : ''}</button>`
        }
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
            ${
              state.user.role === 'admin'
                ? `<button class="quick-action" type="button" data-nav="reports">
                    ${ICONS.reports}<span><strong>Generate a report</strong><span>Revenue and workload</span></span>
                  </button>`
                : ''
            }
            <a class="quick-action" href="/#prices">
              ${ICONS.bookings}<span><strong>View public rates</strong><span>What customers see</span></span>
            </a>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- Booking flow ---------- */

/* ---------- Booking flow: catalog, cart, availability ---------- */

/** The price break that applies to a quantity, or null when it falls in a gap. */
function tierForQty(item, qty = item.qty) {
  const rows = item.tiers || [];
  if (!rows.length) return null;
  return (
    rows.find(
      (row) => qty >= Number(row.min) && (row.max === null || row.max === undefined || qty <= Number(row.max))
    ) || null
  );
}

/** The unit price the server will charge for this line and quantity. */
function unitPriceFor(item, qty = item.qty) {
  if (item.pricing_mode === 'area') return Number(item.price);
  const row = tierForQty(item, qty);
  return Number(row ? row.price : item.price);
}

/**
 * Line total for the cart, matching `priceLine` on the server: area work uses
 * width x height with the minimum billable area, fixed work uses the quantity
 * break, and either can carry a one-off setup fee.
 * Returns null when a tiered quantity sits between published breaks, so the
 * UI can ask for a quote instead of inventing a price.
 */
/** Rounds a customer-entered dimension the way the server bills it. */
function billedDimensions(item) {
  const width = Number(item.width_ft);
  const height = Number(item.height_ft);
  if (item.round_dimensions_up === true) {
    return {
      width: Number.isFinite(width) ? Math.ceil(Math.round(width * 1000) / 1000) : 0,
      height: Number.isFinite(height) ? Math.ceil(Math.round(height * 1000) / 1000) : 0,
    };
  }
  return { width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

function measurementProblem(item) {
  if (item.pricing_mode !== 'area') return '';
  const unit = item.dimension_unit === 'in' ? 'in' : 'ft';
  const min = Number(item.min_dimension) || 1;
  const max = Number(item.max_dimension) || (item.dimension_unit === 'in' ? 120 : 50);
  const rawWidth = String(item.width_ft ?? '');
  const rawHeight = String(item.height_ft ?? '');
  if (!rawWidth.trim() || !rawHeight.trim()) return 'Enter both measurements.';
  if (!/^\d+(?:\.\d+)?$/.test(rawWidth) || !/^\d+(?:\.\d+)?$/.test(rawHeight)) {
    return 'Use positive numbers only.';
  }
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'Measurements must be greater than zero.';
  }
  if (width < min || height < min) return `Each side must be at least ${min} ${unit}.`;
  if (width > max || height > max) return `Each side must be ${max} ${unit} or less.`;
  return '';
}

function billableArea(item) {
  const billed = billedDimensions(item);
  return Math.max(Number(item.min_area) || 0, billed.width * billed.height);
}

function cartMeasurementProblems() {
  return state.cart
    .map((item, index) => ({ item, index, problem: measurementProblem(item) }))
    .filter((entry) => entry.problem);
}

function cartTotal(item) {
  const baseFee = Number(item.base_fee) || 0;
  if (item.pricing_mode === 'area') {
    if (measurementProblem(item)) return null;
    return Math.round(billableArea(item) * Number(item.price) + baseFee);
  }
  const row = tierForQty(item, item.qty);
  if ((item.tiers || []).length && !row) return null;
  return Math.round(Number(item.qty) * Number(row ? row.price : item.price) + baseFee);
}

function cartGaps() {
  return state.cart.filter(
    (item) => item.pricing_mode !== 'area' && (item.tiers || []).length > 0 && !tierForQty(item, item.qty)
  );
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + (cartTotal(item) || 0), 0);
}

const AVAILABILITY_OPTIONS = [
  { value: 'pickup', label: 'Pickup only' },
  { value: 'event', label: 'Event booking only' },
  { value: 'both', label: 'Pickup and event' },
  { value: 'unassigned', label: 'Unassigned (hidden)' },
];

const AVAILABILITY_LABELS = Object.fromEntries(
  AVAILABILITY_OPTIONS.map((option) => [option.value, option.label])
);

/** A service is visible only when its admin setting matches the chosen flow. */
function serviceSupportsBookingType(service, type = state.bookingType) {
  const availability = service?.booking_availability || 'unassigned';
  return availability === 'both' || availability === type;
}

// Tarpaulin is now configured once as a measured product. The old fixed tarp
// sizes remain intact for existing orders and for the owner to retire, but they
// must not crowd the customer catalog with duplicate size cards.
const LEGACY_SIZED_TARPAULINS = new Set([
  'tarpaulin',
  'tarpaulin-2x4',
  'tarpaulin-2x5',
  'tarpaulin-2x6',
  'tarpaulin-8r',
  'tarpaulin-11r',
  'tarpaulin-16x20',
  'tarpaulin-20x30',
  'tarpaulin-a4',
]);

function availableServices(type = state.bookingType) {
  return (state.services || []).filter(
    (service) =>
      service.active !== false &&
      serviceSupportsBookingType(service, type) &&
      !LEGACY_SIZED_TARPAULINS.has(service.id)
  );
}

function catalogTabsTemplate() {
  const eligible = availableServices();
  const categories = (state.categories || []).filter((category) =>
    eligible.some((service) => service.category === category.name)
  );
  if (state.catalogFilter !== 'all' && !categories.some((category) => category.name === state.catalogFilter)) {
    state.catalogFilter = 'all';
  }
  return `
    <button class="chip ${state.catalogFilter === 'all' ? 'active' : ''}" type="button" data-catalog="all">All pieces</button>
    ${categories
      .map(
        (category) =>
          `<button class="chip ${state.catalogFilter === category.name ? 'active' : ''}" type="button" data-catalog="${esc(category.name)}">${esc(category.name)}</button>`
      )
      .join('')}`;
}

function renderTypeNotice() {
  const note = document.querySelector('[data-type-notice]');
  if (!note) return;
  note.hidden = !state.typeNotice;
  note.textContent = state.typeNotice;
}

function renderBookView() {
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Build your booking</h2><p>Choose what you need, then tell us whether it is an event or a pickup.</p></div>
      <div class="page-actions">
        <button class="btn btn-danger" type="button" data-cart-clear ${state.cart.length ? '' : 'hidden'}>Clear selection</button>
        <a class="btn" href="/shop#catalog">View full rate card</a>
      </div>
    </div>
    <div class="book-grid">
      <div class="panel catalog-panel">
        <div class="catalog-filter-bar">
          <div class="search-field catalog-search">
            ${ICONS.search}
            <input type="search" id="catalog-search" placeholder="Search products…" value="${esc(state.catalogSearch)}" aria-label="Search products" />
          </div>
          <span class="tiny muted">${plural(availableServices().length, 'product')}</span>
        </div>
        <div class="catalog-tabs" id="catalog-tabs">${catalogTabsTemplate()}</div>
        <div id="catalog-body">${catalogBodyTemplate()}</div>
      </div>

      <aside class="panel cart-panel" aria-label="Booking summary">
        <div class="panel-head">
          <div><h3>Your booking</h3><p><span id="cart-count">${plural(state.cart.length, 'line')}</span> · estimate only</p></div>
        </div>
        <p class="cart-type-notice" data-type-notice ${state.typeNotice ? '' : 'hidden'}>${esc(state.typeNotice)}</p>
        <div class="cart-items" id="cart-lines">${cartLinesTemplate()}</div>
        <div class="cart-totals" id="cart-totals">${cartTotalsTemplate()}</div>
        <form class="cart-form" id="booking-form" novalidate>
          <div class="booking-type-switch" role="group" aria-label="Booking type">
            <button class="chip ${state.bookingType === 'event' ? 'active' : ''}" type="button" data-booking-type="event">Event booking</button>
            <button class="chip ${state.bookingType === 'pickup' ? 'active' : ''}" type="button" data-booking-type="pickup">Pickup booking</button>
          </div>
          <div id="booking-fields">${bookingFieldsTemplate()}</div>
          <div class="field">
            <label for="booking-notes">Notes <span class="field-hint">optional</span></label>
            <textarea class="textarea" id="booking-notes" name="notes" maxlength="2000" placeholder="Theme, sizes, call time, or anything we should know."></textarea>
          </div>
          <section class="design-upload" id="design-upload" aria-labelledby="design-upload-title">
            <div class="design-upload-head">
              <h4 id="design-upload-title">Upload Design / Reference Files</h4>
              <p>Upload your preferred design, sample pictures, or inspiration references to help us understand what you want. JPG, PNG, WEBP, PDF, PSD, AI, or SVG · up to 10 MB each · up to 8 files per booking.</p>
            </div>
            <div class="upload-dropzone" id="design-dropzone" role="button" tabindex="0" aria-describedby="design-upload-hint">
              <strong>Drag files here, paste an image, or browse</strong>
              <span id="design-upload-hint">Inspiration photos, layouts, and design sources. Files stay private to this booking.</span>
              <span class="btn btn-sm" aria-hidden="true">Browse files</span>
              <input type="file" id="design-file-input" accept=".jpg,.jpeg,.png,.webp,.pdf,.psd,.ai,.svg" multiple hidden />
            </div>
            <div class="upload-queue" id="design-queue" aria-live="polite"></div>
            <div class="field">
              <label for="design-notes">Additional Design Instructions <span class="field-hint">optional</span></label>
              <textarea class="textarea" id="design-notes" name="design_notes" maxlength="1000" placeholder="Preferred colors, text or names to include, event theme, layout notes, or changes to a reference."></textarea>
            </div>
          </section>
          <p class="availability-note" id="availability-note" hidden></p>
          <div class="form-error" id="booking-error" role="alert"></div>
          <button class="btn btn-primary button-block" type="submit" ${state.cart.length ? '' : 'disabled'}>Send booking request</button>
          <p class="cart-note">No payment is taken here. We check the calendar first and send the 50% reservation details after you request a date.</p>
        </form>
      </aside>
    </div>`;
  renderAvailabilityNote();
  renderTypeNotice();
  bindDesignUpload();
  if (state.bookingType === 'pickup') suggestPickupBranch();
}

function bookingFieldsTemplate() {
  if (state.bookingType === 'pickup') {
    return `
      <div class="field">
        <label for="pickup-branch">Pickup branch</label>
        <select class="select" id="pickup-branch" name="branch_id" required>
          <option value="">Choose a branch</option>
          ${state.branches
            .map(
              (branch) =>
                `<option value="${esc(branch.id)}" ${state.pickupBranchId === branch.id ? 'selected' : ''}>${esc(branch.name)}</option>`
            )
            .join('')}
        </select>
        <span class="field-hint" id="geo-note">${esc(state.geoNote || 'Choose either branch — your choice is kept even if we suggest another one.')}</span>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pickup-date">Pickup date</label>
          <input class="input" type="date" id="pickup-date" name="pickup_date" min="${todayISO()}" required />
        </div>
        <div class="field">
          <label for="pickup-time">Pickup time <span class="field-hint">optional</span></label>
          <input class="input" type="time" id="pickup-time" name="pickup_time" />
        </div>
      </div>
      <p class="booking-type-note">Pickup orders are normally ready in <strong>1–2 days</strong>. No event address or duration is needed.</p>`;
  }

  return `
    <div class="field-row">
      <div class="field">
        <label for="booking-date">Event date</label>
        <input class="input" type="date" id="booking-date" name="event_date" min="${todayISO()}" required />
      </div>
      <div class="field">
        <label for="booking-time">Start time</label>
        <input class="input" type="time" id="booking-time" name="event_time" required />
      </div>
    </div>
    <div class="field">
      <label for="booking-duration">Duration</label>
      <select class="select" id="booking-duration" name="duration_hours">
        ${[2, 3, 4, 5, 6, 8, 10, 12]
          .map((hours) => `<option value="${hours}" ${hours === 3 ? 'selected' : ''}>${hours} hours</option>`)
          .join('')}
      </select>
    </div>
    <div class="field">
      <label for="booking-venue">Event venue</label>
      <input class="input" type="text" id="booking-venue" name="venue" maxlength="160" placeholder="e.g. Casa Esperanza, function hall" required />
    </div>
    <div class="field">
      <label for="booking-address">Service address</label>
      <input class="input" type="text" id="booking-address" name="address" maxlength="240" placeholder="House or venue, street, barangay, city" required />
      <span class="field-hint">We match this to the nearest branch unless you choose one below.</span>
    </div>
    <div class="field">
      <label for="booking-branch">Assigned branch <span class="field-hint">optional</span></label>
      <select class="select" id="booking-branch" name="branch_id">
        <option value="">Nearest to the address</option>
        ${state.branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join('')}
      </select>
    </div>`;
}

function branchesWithDistance(lat, lng) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  return state.branches
    .filter((branch) => Number.isFinite(Number(branch.lat)) && Number.isFinite(Number(branch.lng)))
    .map((branch) => {
      const dLat = toRad(Number(branch.lat) - lat);
      const dLng = toRad(Number(branch.lng) - lng);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat)) * Math.cos(toRad(Number(branch.lat))) * Math.sin(dLng / 2) ** 2;
      return { branch, km: 2 * 6371 * Math.asin(Math.sqrt(h)) };
    })
    .sort((a, b) => a.km - b.km);
}

function suggestPickupBranch() {
  if (state.branchTouched || state.pickupBranchId) return;
  if (!navigator.geolocation || !state.branches.length) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (state.branchTouched || state.pickupBranchId || state.bookingType !== 'pickup') return;
      const [nearest] = branchesWithDistance(position.coords.latitude, position.coords.longitude);
      if (!nearest) return;
      state.pickupBranchId = nearest.branch.id;
      state.geoNote = `Suggested from your location: ${nearest.branch.name} (${Math.round(nearest.km)} km away). You can switch branches — your choice wins.`;
      const select = document.getElementById('pickup-branch');
      if (select) select.value = nearest.branch.id;
      const note = document.getElementById('geo-note');
      if (note) note.textContent = state.geoNote;
    },
    () => {
      // Permission denied or unavailable: the manual picker is already there.
    },
    { timeout: 6000, maximumAge: 300000 }
  );
}

/**
 * Asks the server whether the chosen date, time, and cart still fit, and stores
 * the answer in `state.availability`. Debounced by the change handler so typing
 * a date does not fire a request per keystroke.
 */
async function checkAvailability() {
  if (state.bookingType !== 'event') {
    state.availability = null;
    renderAvailabilityNote();
    return;
  }
  const date = document.getElementById('booking-date')?.value;
  const time = document.getElementById('booking-time')?.value;
  const hours = Number(document.getElementById('booking-duration')?.value) || 3;
  const branchId = document.getElementById('booking-branch')?.value || '';
  const services = state.cart
    .filter((item) => item.capacity === true || item.category === 'Photo & booth')
    .map((item) => item.service_id)
    .join(',');
  if (!date || !time || !branchId || !services) {
    state.availability = null;
    renderAvailabilityNote();
    return;
  }
  try {
    const query = new URLSearchParams({ date, branch_id: branchId, time, hours: String(hours), services });
    const { availability } = await api(`/api/availability?${query.toString()}`);
    state.availability = availability;
  } catch {
    state.availability = null;
  }
  renderAvailabilityNote();
}

function renderAvailabilityNote() {
  const note = document.getElementById('availability-note');
  if (!note) return;
  const availability = state.availability;
  if (state.bookingType !== 'event' || !availability) {
    note.hidden = true;
    note.textContent = '';
    note.classList.remove('full');
    return;
  }
  note.hidden = false;
  note.classList.toggle('full', availability.full);
  note.textContent = availability.full
    ? `That window is full: ${availability.used} of ${availability.capacity} simultaneous services are booked.${
        availability.next_label ? ` The next open start is ${availability.next_label}.` : ''
      }`
    : `${availability.remaining} of ${availability.capacity} simultaneous service slots are still open for that window.`;
}

function serviceImageUrl(service) {
  const url = String(service?.image_url || '');
  if (!url) return '';
  // Uploaded files already have a unique name. The version query is a second
  // guard for browsers or CDNs that keep a stale copy after a replacement.
  if (url.startsWith('/uploads/') && service.image_updated_at) {
    return `${url}?v=${encodeURIComponent(String(service.image_updated_at))}`;
  }
  return url;
}

function serviceVideoUrl(service) {
  const url = String(service?.video_url || '');
  if (!url) return '';
  if (url.startsWith('/uploads/') && service.video_updated_at) {
    return `${url}?v=${encodeURIComponent(String(service.video_updated_at))}`;
  }
  return url;
}

function productStarting(service) {
  if (service.pricing_mode === 'area') {
    return { amount: peso(service.price), suffix: `per sq ${service.dimension_unit === 'in' ? 'in' : 'ft'}` };
  }
  const tierPrices = (service.tiers || []).map((row) => Number(row.price)).filter(Number.isFinite);
  if (tierPrices.length) {
    return { amount: `from ${peso(Math.min(...tierPrices))}`, suffix: esc(service.unit) };
  }
  return { amount: peso(service.price), suffix: esc(service.unit) };
}

function productImageMarkup(service, className = '') {
  const image = serviceImageUrl(service);
  if (!image) {
    return `<span class="product-image-missing ${className}"><span>Image pending</span><small>Studio photo needed</small></span>`;
  }
  return `<img class="${className}" src="${esc(image)}" alt="${esc(service.image_alt || `${service.name} product`)}" loading="lazy" />`;
}

// Saved files can disappear when a host restarts with an ephemeral disk.
// Show the normal placeholder and tell an admin to re-upload instead of
// leaving the browser's broken-image icon in the catalog or image manager.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const source = img.getAttribute('src') || '';
    if (!source || source.startsWith('blob:') || source.startsWith('data:')) return;
    const card = img.closest('[data-image-card]');
    const productMedia = img.closest('[data-product-image], .measure-thumb, .price-image-thumb');
    if (!card && !productMedia && !source.startsWith('/uploads/products/')) return;

    const placeholder = document.createElement('span');
    placeholder.className = 'product-image-missing';
    placeholder.innerHTML = card
      ? '<span>Image file missing</span><small>Upload it again</small>'
      : '<span>Image pending</span><small>Studio photo needed</small>';

    if (card) {
      const status = card.querySelector('.image-status');
      if (status) {
        status.textContent = 'Image file missing';
        status.className = 'image-status image-status--missing';
      }
      if (img.closest('[data-image-local-preview]')) img.replaceWith(placeholder);
      imageMessage(card, 'The saved image file is missing from storage. Upload it again.');
      return;
    }

    if (productMedia) {
      productMedia.classList.add('product-card-media--missing');
      productMedia.removeAttribute('data-product-image');
      productMedia.querySelector('.product-card-zoom')?.remove();
    }
    img.replaceWith(placeholder);
  },
  true
);

function productCard(service) {
  const price = productStarting(service);
  const custom = service.pricing_mode === 'area';
  const image = serviceImageUrl(service);
  return `
    <article class="product-card" data-product-card="${esc(service.id)}">
      <button class="product-card-media ${image ? '' : 'product-card-media--missing'}" type="button" data-product-image="${esc(service.id)}" aria-label="${image ? `Enlarge ${esc(service.name)} image` : `${esc(service.name)} has no image yet`}">
        ${productImageMarkup(service)}
        ${image ? '<span class="product-card-zoom">Double-click to enlarge</span>' : ''}
      </button>
      <div class="product-card-body">
        <div class="product-card-kicker">
          <span>${esc(service.category)}</span>
          ${service.popular ? '<span class="price-popular">most booked</span>' : ''}
        </div>
        <h3>${esc(service.name)}</h3>
        <p class="product-card-desc">${esc(service.description || 'Made to order by the studio.')}</p>
        <div class="product-card-foot">
          <div class="product-price">
            <strong>${price.amount}</strong>
            <span>${price.suffix}${service.min_qty ? ` · min ${service.min_qty}` : ''}</span>
          </div>
          <div class="product-card-actions">
            <button class="btn btn-sm" type="button" data-product-details="${esc(service.id)}">View details</button>
            <button class="btn btn-primary btn-sm" type="button" data-select-service="${esc(service.id)}">${custom ? 'Choose size' : 'Select'}</button>
          </div>
        </div>
      </div>
    </article>`;
}

function catalogBodyTemplate() {
  const eligible = availableServices();
  const categoryFilter = state.catalogFilter;
  const search = String(state.catalogSearch || '').trim().toLowerCase();
  const categories = (state.categories || []).filter(
    (category) => categoryFilter === 'all' || category.name === categoryFilter
  );
  if (!state.services.length) {
    return '<div class="table-empty">The catalog is taking a moment. Refresh the page to try again.</div>';
  }
  if (!eligible.length) {
    const type = state.bookingType === 'pickup' ? 'pickup' : 'event';
    return `<div class="table-empty">No products or services are configured for ${type} bookings yet. Ask the studio to set their booking availability in Pricing.</div>`;
  }
  let found = 0;
  const markup = categories
    .map((category) => {
      const services = eligible.filter(
        (service) =>
          service.category === category.name &&
          (!search ||
            `${service.name} ${service.description} ${service.category}`.toLowerCase().includes(search))
      );
      if (!services.length) return '';
      found += services.length;
      return `
        <section class="catalog-group">
          <div class="catalog-group-head"><h3>${esc(category.name)}</h3><p>${esc(category.note)}</p><span class="tiny muted">${plural(services.length, 'product')}</span></div>
          <div class="product-grid">${services.map(productCard).join('')}</div>
        </section>`;
    })
    .join('');
  if (!found) {
    return noResultsState({
      title: 'No products match that search',
      text: 'Try a shorter product name, or choose another category above.',
    });
  }
  return markup;
}

function openProductLightbox(id) {
  const service = state.services.find((item) => item.id === id);
  if (!service || !service.image_url) return;
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay product-lightbox-overlay" data-modal-overlay>
      <div class="product-lightbox" role="dialog" aria-modal="true" aria-labelledby="lightbox-title">
        <button class="product-lightbox-close" type="button" data-modal-close aria-label="Close image preview">${ICONS.close}</button>
        <img src="${esc(serviceImageUrl(service))}" alt="${esc(service.image_alt || service.name)}" />
        <p id="lightbox-title">${esc(service.name)} <span>Double-click or press Escape to close</span></p>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-modal-close]')?.focus();
}

function openProductDetails(id) {
  const service = state.services.find((item) => item.id === id);
  if (!service) return;
  const price = productStarting(service);
  const custom = service.pricing_mode === 'area';
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <div class="product-detail-grid">
          <button class="product-detail-image" type="button" data-product-image="${esc(service.id)}" aria-label="Enlarge ${esc(service.name)} image">
            ${productImageMarkup(service)}
          </button>
          <div class="product-detail-copy">
            <p class="auth-eyebrow">${esc(service.category)}</p>
            <h2 id="product-detail-title">${esc(service.name)}</h2>
            <p>${esc(service.description || 'Made to order by the studio.')}</p>
            <div class="product-detail-price">
              <strong>${price.amount}</strong>
              <span>${price.suffix}</span>
            </div>
            ${
              custom
                ? `<p class="product-detail-note">This product is priced by measurement. Enter your own length and height and the price is calculated automatically. ${service.round_dimensions_up ? 'Decimal measurements round up to the next whole foot for the final print size.' : ''}</p>`
                : `<p class="product-detail-note">${esc(service.min_qty ? `Minimum order: ${service.min_qty}. ` : '')}Stock and finish are confirmed by the studio before production.</p>`
            }
            <button class="btn btn-primary button-block" type="button" data-select-service="${esc(service.id)}">${custom ? 'Choose measurement' : 'Select product'}</button>
          </div>
        </div>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-select-service]')?.focus();
}

function measurementQuote(service, widthValue, heightValue) {
  const unit = service.dimension_unit === 'in' ? 'in' : 'ft';
  const width = Number(widthValue);
  const height = Number(heightValue);
  const roundUp = service.round_dimensions_up === true;
  const billedWidth = roundUp ? Math.ceil(Math.round(width * 1000) / 1000) : width;
  const billedHeight = roundUp ? Math.ceil(Math.round(height * 1000) / 1000) : height;
  const area = Math.max(Number(service.min_area) || 0, billedWidth * billedHeight);
  return {
    width,
    height,
    billedWidth,
    billedHeight,
    area,
    total: Math.round(area * Number(service.price) + (Number(service.base_fee) || 0)),
    unit,
  };
}

function updateMeasurementPreview(service) {
  const lengthInput = document.getElementById('measure-length');
  const heightInput = document.getElementById('measure-height');
  if (!lengthInput || !heightInput) return;
  const candidate = {
    ...service,
    width_ft: lengthInput.value,
    height_ft: heightInput.value,
  };
  const problem = measurementProblem(candidate);
  const preview = measurementQuote(service, lengthInput.value, heightInput.value);
  const error = document.querySelector('[data-measure-error]');
  if (error) {
    error.textContent = problem;
    error.classList.toggle('show', Boolean(problem));
  }
  lengthInput.classList.toggle('invalid', Boolean(problem) && lengthInput.value !== '');
  heightInput.classList.toggle('invalid', Boolean(problem) && heightInput.value !== '');
  const area = document.querySelector('[data-measure-area]');
  const total = document.querySelector('[data-measure-total]');
  const billed = document.querySelector('[data-measure-billed]');
  if (area) area.textContent = `${Number.isFinite(preview.area) ? preview.area.toFixed(2).replace(/\.00$/, '') : '—'} sq ${preview.unit}`;
  if (total) total.textContent = problem ? '—' : peso(preview.total);
  if (billed) {
    billed.hidden = !service.round_dimensions_up;
    billed.textContent = service.round_dimensions_up
      ? `Final print size: ${preview.billedWidth} × ${preview.billedHeight} ${preview.unit}`
      : '';
  }
  const submit = document.querySelector('[data-measure-submit]');
  if (submit) submit.disabled = Boolean(problem);
}

function openMeasurement(service) {
  if (!service) return;
  if (!serviceSupportsBookingType(service)) {
    toast(`${service.name} is not available for ${state.bookingType} bookings.`, 'error');
    return;
  }
  const unit = service.dimension_unit === 'in' ? 'in' : 'ft';
  const min = Number(service.min_dimension) || 1;
  const max = Number(service.max_dimension) || (unit === 'in' ? 120 : 50);
  const defaultLength = Math.min(max, Math.max(min, unit === 'in' ? 20 : 2));
  const defaultHeight = Math.min(max, Math.max(min, unit === 'in' ? 30 : 5));
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal measure-modal" role="dialog" aria-modal="true" aria-labelledby="measure-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <div class="measure-head">
          <div class="measure-thumb">${productImageMarkup(service)}</div>
          <div>
            <p class="auth-eyebrow">${esc(service.category)}</p>
            <h2 id="measure-title">${esc(service.name)}</h2>
            <p class="modal-lead">Enter the finished size. The estimated price updates automatically.</p>
          </div>
        </div>
        <form data-measure-form data-id="${esc(service.id)}" novalidate>
          <div class="measure-row">
            <label class="field"><span>Length</span><div class="measure-input"><input class="input" id="measure-length" type="number" min="${min}" max="${max}" step="0.01" inputmode="decimal" value="${defaultLength}" aria-label="Length in ${unit}" /><span>${unit}.</span></div></label>
            <span class="measure-times">×</span>
            <label class="field"><span>Height / Width</span><div class="measure-input"><input class="input" id="measure-height" type="number" min="${min}" max="${max}" step="0.01" inputmode="decimal" value="${defaultHeight}" aria-label="Height in ${unit}" /><span>${unit}.</span></div></label>
          </div>
          <p class="measure-note">${
            service.round_dimensions_up
              ? `Please enter your desired ${esc(service.name.toLowerCase())} size. Sizes with decimal measurements will be rounded up to the next whole foot to determine the final print size. Your estimated price will be automatically calculated.`
              : `Enter a positive size in ${unit}. Each side must be at least ${min} ${unit} and no more than ${max} ${unit}.`
          }</p>
          <p class="measure-billed" data-measure-billed ${service.round_dimensions_up ? '' : 'hidden'}></p>
          <div class="measure-summary">
            <span>Total area <strong data-measure-area>—</strong></span>
            <span>Rate <strong>${peso(service.price)} / sq ${unit}</strong></span>
            <span class="measure-total">Estimated total <strong data-measure-total>—</strong></span>
          </div>
          <p class="form-error" data-measure-error role="alert"></p>
          <div class="modal-actions">
            <button class="btn" type="button" data-modal-close>Cancel</button>
            <button class="btn btn-primary" type="submit" data-measure-submit>Add to booking</button>
          </div>
          <p class="tiny muted">The studio recalculates this price on the server when your booking is submitted.</p>
        </form>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  updateMeasurementPreview(service);
  document.getElementById('measure-length')?.focus();
}

function addMeasuredService(service, width, height) {
  const problem = measurementProblem({ ...service, width_ft: width, height_ft: height });
  if (problem) throw new Error(problem);
  const line = {
    service_id: service.id,
    name: service.name,
    pricing_mode: 'area',
    price: Number(service.price),
    unit: service.unit,
    min_area: Number(service.min_area) || 0,
    min_qty: 1,
    tiers: [],
    base_fee: Number(service.base_fee) || 0,
    dimension_unit: service.dimension_unit || 'ft',
    round_dimensions_up: service.round_dimensions_up === true,
    min_dimension: Number(service.min_dimension) || 1,
    max_dimension: Number(service.max_dimension) || (service.dimension_unit === 'in' ? 120 : 50),
    capacity: service.capacity === true,
    qty: 1,
    width_ft: Number(width),
    height_ft: Number(height),
  };
  const existing = state.cart.find((item) => item.service_id === service.id && item.pricing_mode === 'area');
  if (existing) Object.assign(existing, line);
  else state.cart.push(line);
  syncCart();
  toast(existing ? `${service.name} size updated.` : `${service.name} added.`);
}

function selectService(id) {
  const service = state.services.find((item) => item.id === id);
  if (!service) return;
  if (!serviceSupportsBookingType(service)) {
    toast(`${service.name} is not available for ${state.bookingType} bookings.`, 'error');
    return;
  }
  if (service.pricing_mode === 'area') openMeasurement(service);
  else addService(service.id);
}

function cartLinesTemplate() {
  if (!state.cart.length) {
    return `<div class="cart-empty">Nothing chosen yet.<br />Add a print, keepsake, or service to see the estimate.</div>`;
  }
  return state.cart
    .map((item, index) => {
      const lineTotal = cartTotal(item);
      const isArea = item.pricing_mode === 'area';
      const unit = item.dimension_unit === 'in' ? 'in' : 'ft';
      const tiered = (item.tiers || []).length > 0;
      const tier = tiered ? tierForQty(item, item.qty) : null;
      const each = unitPriceFor(item, item.qty);
      const gap = tiered && !tier;
      const problem = measurementProblem(item);
      const billed = billedDimensions(item);
      const areaValue = billableArea(item);
      return `
        <div class="cart-line ${isArea ? 'cart-line--measure' : ''}" data-cart-index="${index}">
          <div class="cart-line-top">
            <div class="cart-line-name">
              ${esc(item.name)}
              <small>${
                isArea
                  ? `Custom size · ${peso(each)} per sq ${unit}${item.base_fee ? ` + ${peso(item.base_fee)} setup` : ''}`
                  : `${peso(each)} each${tier ? ` · ${esc(tier.label)}` : ''} · ${esc(item.unit)}`
              }</small>
            </div>
            <div class="cart-line-side">
              <span class="cart-line-total" data-cart-line-total>${lineTotal === null ? (isArea ? 'Check size' : 'Quote') : peso(lineTotal)}</span>
              <button class="cart-line-remove" type="button" data-cart-remove="${index}" aria-label="Remove ${esc(item.name)}">×</button>
            </div>
          </div>
          <div class="cart-line-controls">
            ${
              isArea
                ? `<div class="cart-measure-row">
                    <label class="cart-measure-field"><span>Length</span><input type="number" min="${Number(item.min_dimension) || 1}" max="${Number(item.max_dimension) || (unit === 'in' ? 120 : 50)}" step="0.01" inputmode="decimal" value="${esc(item.width_ft)}" data-cart-width="${index}" aria-label="Length in ${unit}" /></label>
                    <span class="cart-measure-x">×</span>
                    <label class="cart-measure-field"><span>Height</span><input type="number" min="${Number(item.min_dimension) || 1}" max="${Number(item.max_dimension) || (unit === 'in' ? 120 : 50)}" step="0.01" inputmode="decimal" value="${esc(item.height_ft)}" data-cart-height="${index}" aria-label="Height in ${unit}" /></label>
                    <span class="cart-measure-unit">${unit}.</span>
                  </div>
                  <div class="cart-measure-summary">
                    <span>Area <strong data-cart-area>${areaValue.toFixed(2).replace(/\.00$/, '')} sq ${unit}</strong></span>
                    <span>Rate <strong data-cart-rate>${peso(each)} / sq ${unit}</strong></span>
                    ${item.round_dimensions_up ? `<span data-cart-billed>Billed ${billed.width} × ${billed.height} ${unit}</span>` : ''}
                  </div>
                  <p class="cart-measure-error ${problem ? 'show' : ''}" data-cart-error>${esc(problem)}</p>
                  <p class="tiny muted">Each side has a ${Number(item.min_dimension) || 1} ${unit} minimum${item.round_dimensions_up ? '; decimals round up to the next whole foot for billing' : ''}.</p>`
                : `<div class="stepper">
                    <button type="button" data-cart-step="${index}" data-delta="-1" aria-label="Decrease quantity">−</button>
                    <span>${item.qty}</span>
                    <button type="button" data-cart-step="${index}" data-delta="1" aria-label="Increase quantity">+</button>
                  </div>
                  ${item.min_qty ? `<span class="tiny muted">min ${item.min_qty}</span>` : ''}
                  ${gap ? '<span class="tiny price-gap">This quantity is between price breaks — ask for a quote.</span>' : ''}`
            }
          </div>
        </div>`;
    })
    .join('');
}

function discountPreview(subtotal, discount = state.customerDiscount) {
  if (!discount) return 0;
  const value = Number(discount.value) || 0;
  const amount = discount.type === 'percent' ? Math.floor((subtotal * value) / 100) : Math.round(value);
  return Math.max(0, Math.min(subtotal, amount));
}

function cartTotalsTemplate() {
  const subtotal = cartSubtotal();
  const discountAmount = discountPreview(subtotal);
  const total = subtotal - discountAmount;
  const deposit = Math.ceil(total / 2);
  const gaps = cartGaps();
  const invalidMeasurements = cartMeasurementProblems();
  return `
    <div class="cart-total-row"><span>Subtotal</span><span>${invalidMeasurements.length ? 'Check measurements' : gaps.length ? 'Quote required' : peso(subtotal)}</span></div>
    ${
      discountAmount
        ? `<div class="cart-total-row discount"><span>${esc(state.customerDiscount.label)}</span><span>−${peso(discountAmount)}</span></div>`
        : ''
    }
    ${
      invalidMeasurements.length
        ? `<div class="cart-total-row measure-warning"><span>Measurements to fix</span><span>${plural(invalidMeasurements.length, 'line')}</span></div>`
        : gaps.length
        ? `<div class="cart-total-row"><span>Quantities between price breaks</span><span>${plural(gaps.length, 'line')}</span></div>`
        : `<div class="cart-total-row"><span>Reservation fee (50%)</span><span class="deposit">${peso(deposit)}</span></div>
           <div class="cart-total-row"><span>Balance after reservation</span><span>${peso(total - deposit)}</span></div>`
    }
    <div class="cart-total-row grand"><span>Estimated total</span><strong>${invalidMeasurements.length ? 'Complete sizes' : gaps.length ? 'Ask for a quote' : peso(total)}</strong></div>`;
}

/**
 * Re-renders the cart, totals, and availability note after any cart change.
 * Every mutation goes through here so the three can never disagree.
 */
function syncCart() {
  const lines = document.getElementById('cart-lines');
  const totals = document.getElementById('cart-totals');
  const count = document.getElementById('cart-count');
  if (!lines || !totals) return;
  lines.innerHTML = cartLinesTemplate();
  totals.innerHTML = cartTotalsTemplate();
  if (count) count.textContent = plural(state.cart.length, 'line');
  const submit = document.querySelector('#booking-form button[type="submit"]');
  if (submit) {
    submit.disabled =
      state.cart.length === 0 || !state.online || cartGaps().length > 0 || cartMeasurementProblems().length > 0;
  }
  const clear = document.querySelector('[data-cart-clear]');
  if (clear) clear.hidden = state.cart.length === 0;
  if (document.getElementById('booking-form')) checkAvailability();
}

/** Adds a catalog item to the cart, or bumps its quantity if already there. */
function addService(id) {
  const service = state.services.find((item) => item.id === id);
  if (!service) return;
  if (!serviceSupportsBookingType(service)) {
    toast(`${service.name} is not available for ${state.bookingType} bookings.`, 'error');
    return;
  }
  state.typeNotice = '';
  renderTypeNotice();
  const existing = state.cart.find(
    (item) => item.service_id === service.id && item.pricing_mode === 'fixed'
  );
  if (existing) {
    existing.qty += 1;
  } else {
    const firstTier = (service.tiers || [])[0];
    const item = {
      service_id: service.id,
      name: service.name,
      pricing_mode: service.pricing_mode,
      price: service.price,
      unit: service.unit,
      min_area: service.min_area || 0,
      min_qty: service.min_qty || 1,
      tiers: service.tiers || [],
      base_fee: service.base_fee || 0,
      dimension_unit: service.dimension_unit || 'ft',
      round_dimensions_up: service.round_dimensions_up === true,
      min_dimension: Number(service.min_dimension) || 1,
      max_dimension: Number(service.max_dimension) || (service.dimension_unit === 'in' ? 120 : 50),
      image_url: service.image_url || '',
      image_alt: service.image_alt || '',
      capacity: service.capacity === true,
      qty: service.min_qty || firstTier?.min || 1,
      width_ft: null,
      height_ft: null,
    };
    if (service.pricing_mode === 'area') {
      const inches = item.dimension_unit === 'in';
      item.width_ft = inches ? 10 : 2;
      item.height_ft = inches ? 10 : Math.max(2, Math.ceil((service.min_area || 2) / 2));
      item.qty = 1;
    }
    state.cart.push(item);
  }
  syncCart();
  toast(`${service.name} added.`);
}

function designFileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function designQueueRow(item) {
  const extension = designFileExtension(item.file.name);
  const preview = item.preview
    ? `<img class="upload-thumb" src="${item.preview}" alt="" />`
    : `<span class="upload-thumb">${esc((extension || 'file').toUpperCase())}</span>`;
  const status =
    item.status === 'error'
      ? `<span class="upload-status is-error">${esc(item.error || 'Upload failed.')}</span>`
      : item.status === 'uploading'
        ? `<span class="upload-status">Uploading ${item.progress}%</span>`
        : item.status === 'done'
          ? '<span class="upload-status">Uploaded</span>'
          : `<span class="upload-status">${formatBytes(item.file.size)}</span>`;
  return `
    <div class="upload-row" data-design-queued="${esc(item.id)}">
      ${preview}
      <div class="upload-meta">
        <strong>${esc(item.file.name)}</strong>
        <small>${esc(item.file.type || 'unknown type')} · ${formatBytes(item.file.size)}</small>
        <select data-design-kind="${esc(item.id)}" aria-label="What is ${esc(item.file.name)}?">
          <option value="reference" ${item.kind === 'reference' ? 'selected' : ''}>Reference / inspiration</option>
          <option value="final" ${item.kind === 'final' ? 'selected' : ''}>Final design to print</option>
        </select>
        ${status}
      </div>
      <button class="upload-remove" type="button" data-design-remove="${esc(item.id)}" aria-label="Remove ${esc(item.file.name)}">×</button>
      ${item.status === 'uploading' ? `<div class="upload-progress"><i style="width:${item.progress}%"></i></div>` : ''}
    </div>`;
}

function renderDesignQueue() {
  const box = document.getElementById('design-queue');
  if (!box) return;
  box.innerHTML = designQueue.map(designQueueRow).join('');
}

/** Queues files locally, rejecting bad types and oversized files up front. */
function addDesignFiles(fileList) {
  const incoming = Array.from(fileList || []);
  let skipped = 0;
  for (const file of incoming) {
    if (designQueue.length >= DESIGN_MAX_FILES) {
      skipped += 1;
      continue;
    }
    if (!DESIGN_EXTENSIONS.has(designFileExtension(file.name)) || Number(file.size) > DESIGN_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    const item = {
      id: `design-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      kind: 'reference',
      status: 'queued',
      progress: 0,
      error: '',
      preview: '',
    };
    if (String(file.type || '').startsWith('image/')) {
      try {
        item.preview = URL.createObjectURL(file);
      } catch {
        item.preview = '';
      }
    }
    designQueue.push(item);
  }
  if (skipped) {
    toast(
      `${skipped} file${skipped === 1 ? '' : 's'} skipped. Use JPG, PNG, WEBP, PDF, PSD, AI, or SVG up to 10 MB, with at most ${DESIGN_MAX_FILES} files.`,
      'error'
    );
  }
  renderDesignQueue();
}

function removeDesignFile(id) {
  const index = designQueue.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [removed] = designQueue.splice(index, 1);
  if (removed.preview) URL.revokeObjectURL(removed.preview);
  renderDesignQueue();
}

function clearDesignQueue() {
  for (const item of designQueue) if (item.preview) URL.revokeObjectURL(item.preview);
  designQueue = [];
  renderDesignQueue();
}

/** One raw-body upload. XHR rather than fetch because it reports real progress. */
function uploadDesignFile(bookingId, item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/bookings/${encodeURIComponent(bookingId)}/files`);
    xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
    xhr.setRequestHeader('X-File-Kind', item.kind === 'final' ? 'final' : 'reference');
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      item.progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
      renderDesignQueue();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        item.progress = 100;
        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        return;
      }
      let message = 'The upload failed. Please try again.';
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        // Non-JSON error body: keep the generic message.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new Error('The upload took too long. Try again on a stronger connection.'));
    xhr.send(item.file);
  });
}

/** Uploads every queued file after the booking exists; returns the failure count. */
async function uploadDesignQueue(bookingId) {
  const pending = designQueue.slice();
  let failed = 0;
  for (const item of pending) {
    if (item.status === 'done') continue;
    item.status = 'uploading';
    item.progress = 0;
    renderDesignQueue();
    try {
      await uploadDesignFile(bookingId, item);
      item.status = 'done';
    } catch (error) {
      item.status = 'error';
      item.error = error.message;
      failed += 1;
    }
    renderDesignQueue();
  }
  return failed;
}

/** Wires the dropzone, picker, paste handler, and per-file kind selector. */
function bindDesignUpload() {
  const zone = document.getElementById('design-dropzone');
  const input = document.getElementById('design-file-input');
  if (!zone || !input) return;
  if (!zone.dataset.bound) {
    zone.dataset.bound = '1';
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
      addDesignFiles(event.dataTransfer?.files);
    });
    input.addEventListener('change', () => {
      addDesignFiles(input.files);
      input.value = '';
    });
    // A pasted screenshot is a reference image too.
    document.addEventListener('paste', (event) => {
      if (!document.getElementById('design-dropzone')) return;
      const items = Array.from(event.clipboardData?.items || []);
      const files = items
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.getAsFile())
        .filter(Boolean);
      if (files.length) addDesignFiles(files);
    });
  }
  const queue = document.getElementById('design-queue');
  if (queue && !queue.dataset.bound) {
    queue.dataset.bound = '1';
    queue.addEventListener('change', (event) => {
      const select = event.target.closest('[data-design-kind]');
      if (!select) return;
      const item = designQueue.find((row) => row.id === select.dataset.designKind);
      if (item) item.kind = select.value === 'final' ? 'final' : 'reference';
    });
  }
  renderDesignQueue();
}

/**
 * Posts the booking, then shows the success dialog. The server recalculates
 * every price and re-checks capacity, so a failure here is shown inline and the
 * form is left filled in for a retry.
 */
async function submitBooking(form) {
  const errorBox = document.getElementById('booking-error');
  const setError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle('show', Boolean(message));
  };
  setError('');
  if (!state.cart.length) return setError('Add at least one piece before sending your request.');
  const incompatible = state.cart.find((item) => {
    const service = state.services.find((row) => row.id === item.service_id);
    return !service || !serviceSupportsBookingType(service, state.bookingType);
  });
  if (incompatible) {
    return setError(
      `${incompatible.name} is not available for ${state.bookingType} bookings. Remove it or switch the booking type.`
    );
  }
  const gaps = cartGaps();
  if (gaps.length) {
    return setError(
      `${gaps[0].name}: ${gaps[0].qty} pieces is between published price breaks. Choose another quantity or ask the studio for a quote.`
    );
  }
  const invalidMeasurements = cartMeasurementProblems();
  if (invalidMeasurements.length) {
    return setError(`Fix the ${invalidMeasurements.length === 1 ? 'measurement' : 'measurements'} in your booking summary before continuing.`);
  }
  // Field-level messages first: they point at the exact input to fix.
  const invalid = validateBookingForm(form);
  if (invalid) return setError(invalid);
  const data = new FormData(form);
  const type = state.bookingType;
  const payload = {
    booking_type: type,
    notes: String(data.get('notes') || '').trim(),
    design_notes: String(data.get('design_notes') || '').trim(),
    items: state.cart.map((item) => ({
      service_id: item.service_id,
      qty: item.qty,
      length_ft: item.width_ft,
      width_ft: item.width_ft,
      height_ft: item.height_ft,
    })),
  };

  if (type === 'pickup') {
    const branchId = String(data.get('branch_id') || '');
    const pickupDate = String(data.get('pickup_date') || '');
    if (!branchId) return setError('Choose the branch where you will pick up.');
    if (!pickupDate) return setError('Choose your pickup date.');
    if (pickupDate < todayISO()) return setError('The pickup date cannot be in the past.');
    payload.branch_id = branchId;
    payload.pickup_date = pickupDate;
    payload.pickup_time = String(data.get('pickup_time') || '');
  } else {
    const eventDate = String(data.get('event_date') || '');
    const eventTime = String(data.get('event_time') || '');
    const venue = String(data.get('venue') || '').trim();
    const address = String(data.get('address') || '').trim();
    if (!eventDate) return setError('Choose your event date.');
    if (eventDate < todayISO()) return setError('The event date cannot be in the past.');
    if (!eventTime) return setError('Choose the event start time.');
    if (venue.length < 3) return setError('Add the event venue.');
    if (address.length < 8) return setError('Add the full service address, including the barangay and city.');
    payload.event_date = eventDate;
    payload.event_time = eventTime;
    payload.duration_hours = Number(data.get('duration_hours')) || 3;
    payload.venue = venue;
    payload.address = address;
    payload.branch_id = String(data.get('branch_id') || '');
  }

  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Sending request…';
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    // The booking exists now, so the queued references have an owner to attach
    // to. A failed upload never loses the booking: the drawer can retry.
    let uploadFailures = 0;
    if (designQueue.length) {
      button.textContent = 'Uploading designs…';
      uploadFailures = await uploadDesignQueue(booking.id);
    }
    clearDesignQueue();
    state.bookings.unshift(booking);
    state.cart = [];
    state.availability = null;
    clearBookingDraft();
    renderChrome();
    renderView();
    showBookingSuccess(booking, uploadFailures);
  } catch (error) {
    setError(error.message);
    button.disabled = false;
    button.textContent = label;
  }
}

function showBookingSuccess(booking, uploadFailures = 0) {
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="success-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <div class="modal-icon">${ICONS.check}</div>
        <h2 id="success-title">Request received.</h2>
        <p>The studio will check the calendar and get back to you with availability and the reservation details.</p>
        <div class="modal-ref">${esc(booking.ref)} · ${peso(booking.total)}</div>
        ${
          booking.booking_type === 'pickup'
            ? `<p class="tiny">Pickup at <strong>${esc(booking.branch?.name || 'the studio')}</strong> · normally ready in 1–2 days.</p>`
            : booking.branch
              ? `<p class="tiny">Routed to <strong>${esc(booking.branch.name)}</strong>, ${booking.event_time ? `starting ${esc(formatTime(booking.event_time))}` : 'nearest to your service address'}.</p>`
              : '<p class="tiny">We are double-checking which branch covers your address and will be in touch.</p>'
        }
        ${
          Number(booking.discount_amount)
            ? `<p class="tiny">Discount applied: ${esc(booking.discount_label)} — you save ${peso(booking.discount_amount)}.</p>`
            : ''
        }
        ${
          uploadFailures
            ? `<p class="tiny" style="color:#b3261e">${uploadFailures} file${uploadFailures === 1 ? '' : 's'} could not be uploaded. Open the booking to retry the upload.</p>`
            : ''
        }
        <p class="tiny">You can follow the status and payment updates from your bookings page.</p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" data-success-view>View my bookings</button>
          <button class="btn" type="button" data-modal-close>Keep planning</button>
        </div>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-success-view]')?.focus();
}

/* ---------- Admin bookings ---------- */

/* ---------- Owner and branch-head management views ---------- */

function filteredAdminBookings() {
  const search = state.adminSearch.trim().toLowerCase();
  return [...state.bookings]
    .filter((booking) => {
      if (state.adminStatus === 'all') return true;
      if (state.adminStatus === 'review') return booking.needs_review;
      return booking.status === state.adminStatus;
    })
    .filter((booking) => {
      if (!search) return true;
      return [
        booking.ref,
        booking.customer?.name,
        booking.customer?.email,
        booking.venue,
        booking.address,
        booking.branch?.name,
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
    const term = state.adminSearch.trim();
    const hasFilter = Boolean(term) || state.adminStatus !== 'all';
    if (!hasFilter) {
      return emptyState({
        icon: 'calendar',
        title: 'No bookings yet',
        text: 'Requests appear here as soon as a customer sends one. Nothing is hidden and nothing failed to load.',
      });
    }
    // Only suggest a correction when a real value on file is close to the query.
    const candidates = [
      ...new Set(
        state.bookings
          .flatMap((booking) => [
            booking.ref,
            booking.customer?.name,
            booking.customer?.email,
            booking.venue,
            booking.branch?.name,
            ...(booking.items || []).map((item) => item.name),
          ])
          .filter(Boolean)
      ),
    ];
    const suggestion = term ? suggestTerm(term, candidates) : '';
    return noResultsState({
      title: term ? `No bookings match “${term}”` : 'No bookings in this status',
      text: term
        ? 'Search checks the reference, customer, venue, branch, and item names. Try a shorter word, or clear the search to see everything.'
        : 'No booking currently has that status. Switch back to all statuses to see the full list.',
      suggestion,
      actions: `<button class="btn" type="button" data-clear-search>${
        term ? 'Clear search' : 'Show all bookings'
      }</button>`,
    });
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Booking</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Branch</th>
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
            <td>
              ${booking.needs_review ? statusBadge('review', 'Needs branch') : `<span class="cell-main">${esc(booking.branch?.name || '—')}</span>`}
              <span class="cell-sub">${esc(booking.address || '')}</span>
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
  const crew = [...state.staff].sort((a, b) => a.name.localeCompare(b.name));
  const accounts = [...state.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const isOwner = state.user.role === 'admin';
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Who works in the studio</h2><p>Only the owner and the two branch heads sign in. Crew are assignment records — no passwords, no login pages.</p></div>
    </div>
    ${
      isOwner
        ? `<div class="panel">
            <div class="panel-head"><div><h3>Studio accounts</h3><p>Owner and branch heads. Deactivation takes effect on their next request.</p></div></div>
            <div class="account-list">
              ${accounts
                .map(
                  (account) => `
                  <div class="account-row">
                    <div class="account-who">
                      <span class="workload-avatar">${esc(initials(account.name))}</span>
                      <div>
                        <strong>${esc(account.name)}</strong>
                        <span>${esc(account.email)} · ${account.role === 'admin' ? 'Owner' : esc(branchName(account.branch_id))} · ${account.mfa_enabled ? '2FA on' : '2FA off'}</span>
                      </div>
                    </div>
                    <div class="account-actions">
                      ${statusBadge(account.active === false ? 'cancelled' : 'confirmed', account.active === false ? 'deactivated' : 'active')}
                      <button class="btn btn-sm" type="button" data-account-reset="${esc(account.id)}">Reset password</button>
                      <button class="btn btn-sm" type="button" data-account-toggle="${esc(account.id)}" data-active="${account.active === false ? 'false' : 'true'}">${account.active === false ? 'Activate' : 'Deactivate'}</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
            <div class="panel-body">
              <h3 class="form-title">Add a studio account</h3>
              <form id="account-form" class="form-grid" novalidate>
                <div class="field-row">
                  <div class="field">
                    <label for="account-name">Full name</label>
                    <input class="input" id="account-name" name="name" maxlength="80" autocomplete="name" required />
                  </div>
                  <div class="field">
                    <label for="account-email">Email</label>
                    <input class="input" id="account-email" name="email" type="email" maxlength="160" autocomplete="email" required />
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="account-role">Role</label>
                    <select class="select" id="account-role" name="role">
                      <option value="branch_admin">Branch head</option>
                      <option value="admin">Studio owner</option>
                    </select>
                  </div>
                  <div class="field" id="account-branch-field">
                    <label for="account-branch">Branch</label>
                    <select class="select" id="account-branch" name="branch_id">
                      <option value="">Choose a branch</option>
                      ${state.branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label for="account-password">Temporary password</label>
                  <input class="input" id="account-password" name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required />
                  <span class="field-hint">At least 10 characters with uppercase, lowercase, a number, and a symbol. They can change it after signing in.</span>
                </div>
                <div class="form-error" data-account-error role="alert"></div>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Create account</button></div>
              </form>
            </div>
          </div>`
        : ''
    }
    <div class="two-col" style="margin-top:18px">
      <div class="panel">
        <div class="panel-head"><div><h3>Add crew</h3><p>A photographer, printer, or booth attendant. Crew do not sign in.</p></div></div>
        <div class="panel-body">
          <form id="team-form" class="form-grid" novalidate>
            <div class="field">
              <label for="team-name">Full name</label>
              <input class="input" id="team-name" name="name" maxlength="80" autocomplete="name" required />
            </div>
            <div class="field-row">
              <div class="field">
                <label for="team-phone">Phone <span class="field-hint">optional</span></label>
                <input class="input" id="team-phone" name="phone" maxlength="30" autocomplete="tel" />
              </div>
              <div class="field">
                <label for="team-email">Email <span class="field-hint">optional</span></label>
                <input class="input" id="team-email" name="email" type="email" maxlength="160" autocomplete="email" />
              </div>
            </div>
            <div class="field">
              <label for="team-branch">Branch</label>
              ${
                state.user.role === 'admin'
                  ? `<select class="select" id="team-branch" name="branch_id" required>
                      <option value="">Choose a branch</option>
                      ${state.branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join('')}
                    </select>`
                  : `<input class="input" id="team-branch" type="text" value="${esc(branchName(state.user.branch_id))}" disabled />`
              }
            </div>
            <p class="booking-type-note">Crew records are for assignment only. They cannot sign in, so there is no password to share.</p>
            <div class="form-error" data-team-error role="alert"></div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">Create crew record</button>
            </div>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Crew</h3><p>${plural(crew.length, 'record')} available for assignment</p></div></div>
        ${
          crew.length
            ? `<div class="account-list">${crew
                .map(
                  (member) => `
                  <div class="account-row">
                    <div class="account-who">
                      <span class="workload-avatar">${esc(initials(member.name))}</span>
                      <div>
                        <strong>${esc(member.name)}</strong>
                        <span>${esc(branchName(member.branch_id))}${member.phone ? ` · ${esc(member.phone)}` : ''}${member.email && !member.email.endsWith('@crew.preciousmoments.local') ? ` · ${esc(member.email)}` : ''}</span>
                      </div>
                    </div>
                    <div class="account-actions">
                      ${statusBadge(member.active === false ? 'cancelled' : 'confirmed', member.active === false ? 'inactive' : 'active')}
                      <button class="btn btn-sm" type="button" data-crew-toggle="${esc(member.id)}" data-active="${member.active === false ? 'false' : 'true'}">${member.active === false ? 'Activate' : 'Deactivate'}</button>
                    </div>
                  </div>`
                )
                .join('')}</div>`
            : '<div class="empty-state"><p>No crew records yet. Add the first one on the left.</p></div>'
        }
      </div>
    </div>`;
}

/* ---------- Account security ---------- */

/* ---------- Account security, discounts, and the assistant log ---------- */

function renderAccount() {
  const user = state.user;
  const mfa = Boolean(user.mfa_enabled);
  const setup = state.mfaSetup;
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Account &amp; security</h2><p>The sign-in for ${esc(user.email)}.</p></div>
    </div>
    ${user.must_change_password ? '<div class="form-error show" style="margin-bottom:16px">Your password was reset by the studio. Choose a new one below.</div>' : ''}
    <div class="two-col">
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h3>Your profile</h3><p>Contact the studio if this needs to change</p></div></div>
          <div class="panel-body">
            <div class="detail-grid">
              <div><span>Name</span><strong>${esc(user.name)}</strong></div>
              <div><span>Email</span><strong>${esc(user.email)}</strong></div>
              <div><span>Role</span><strong>${esc(user.role === 'admin' ? 'Studio owner' : user.role === 'branch_admin' ? 'Branch head' : 'Customer')}</strong></div>
              <div><span>Branch</span><strong>${esc(user.role === 'admin' ? 'Both branches' : user.role === 'branch_admin' ? branchName(user.branch_id) : '—')}</strong></div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Change password</h3><p>At least 10 characters with uppercase, lowercase, a number, and a symbol.</p></div></div>
          <div class="panel-body">
            <form id="password-form" class="form-grid" novalidate>
              <div class="field"><label for="current-password">Current password</label><input class="input" type="password" id="current-password" name="current_password" autocomplete="current-password" required /></div>
              <div class="field"><label for="new-password">New password</label><input class="input" type="password" id="new-password" name="new_password" autocomplete="new-password" minlength="10" required /></div>
              <div class="field"><label for="confirm-password">Repeat new password</label><input class="input" type="password" id="confirm-password" name="confirm_password" autocomplete="new-password" minlength="10" required /></div>
              <div class="form-error" data-password-error role="alert"></div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">Update password</button></div>
            </form>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div><h3>Two-factor authentication</h3><p>${mfa ? 'On — a code is required at sign-in' : 'Off — add an authenticator app'}</p></div>
            ${statusBadge(mfa ? 'confirmed' : 'pending', mfa ? 'protected' : 'not set')}
          </div>
          <div class="panel-body">
            ${
              mfa
                ? `<p class="tiny">A 6-digit code from your authenticator app is required after your password.</p>
                  <form id="mfa-disable-form" class="form-grid" novalidate>
                    <div class="field"><label for="mfa-password">Current password</label><input class="input" type="password" id="mfa-password" name="password" autocomplete="current-password" required /></div>
                    <div class="form-error" data-mfa-error role="alert"></div>
                    <div class="form-actions"><button class="btn" type="submit">Turn off two-factor</button></div>
                  </form>`
                : `<p class="tiny">Use any authenticator app. The studio will never ask for the code by email or chat.</p>
                  ${
                    setup
                      ? `<div class="mfa-secret">
                          <span>Manual setup key</span>
                          <code>${esc(setup.secret.replace(/(.{4})/g, '$1 ').trim())}</code>
                          <p class="tiny">Or <a href="${esc(setup.otpauth)}">add it to your authenticator app</a>.</p>
                        </div>
                        <form id="mfa-enable-form" class="form-grid" novalidate>
                          <div class="field"><label for="mfa-code">Code from the app</label><input class="input" id="mfa-code" name="code" inputmode="numeric" maxlength="6" placeholder="000000" required /></div>
                          <div class="form-error" data-mfa-error role="alert"></div>
                          <div class="form-actions"><button class="btn btn-primary" type="submit">Turn on two-factor</button></div>
                        </form>`
                      : '<div class="form-actions"><button class="btn btn-primary" type="button" data-mfa-start>Set up two-factor</button></div>'
                  }`
            }
          </div>
        </div>
        ${
          user.role === 'admin'
            ? `<div class="panel"><div class="panel-head"><div><h3>Managing other accounts</h3><p>Create, deactivate, and reset the branch heads in Team.</p></div></div><div class="panel-body"><button class="btn" type="button" data-nav="team">Open Team → Accounts</button></div></div>`
            : ''
        }
      </div>
    </div>`;
}

/* ---------- Customer discounts ---------- */

function renderAdminDiscounts() {
  const discounts = state.discounts || [];
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Customer discounts</h2><p>Assign a percentage or a fixed amount to a customer. It is applied automatically to their next booking.</p></div>
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-head"><div><h3>Assign a discount</h3><p>Only the studio owner can create or remove these.</p></div></div>
        <div class="panel-body">
          <form id="discount-form" class="form-grid" novalidate>
            <div class="field">
              <label for="discount-email">Customer email</label>
              <input class="input" id="discount-email" name="customer_email" type="email" maxlength="160" placeholder="customer@example.com" required />
              <span class="field-hint">Use the email on their customer account.</span>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="discount-type">Type</label>
                <select class="select" id="discount-type" name="type">
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </div>
              <div class="field">
                <label for="discount-value">Value</label>
                <input class="input" id="discount-value" name="value" type="number" min="1" step="0.01" placeholder="10" required />
              </div>
            </div>
            <div class="field">
              <label for="discount-note">Reason <span class="field-hint">optional</span></label>
              <input class="input" id="discount-note" name="note" maxlength="80" placeholder="Loyalty discount" />
            </div>
            <div class="form-error" data-discount-error role="alert"></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Save discount</button></div>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Assigned discounts</h3><p>Active discounts apply to new bookings only.</p></div></div>
        ${
          discounts.length
            ? `<div class="account-list">${discounts
                .map(
                  (discount) => `
                  <div class="account-row">
                    <div class="account-who">
                      <span class="workload-avatar">${esc(initials(discount.customer?.name || '?'))}</span>
                      <div>
                        <strong>${esc(discount.customer?.name || 'Customer')}</strong>
                        <span>${esc(discount.customer?.email || '')} · ${esc(discount.label)}</span>
                      </div>
                    </div>
                    <div class="account-actions">
                      ${statusBadge(discount.active === false ? 'cancelled' : 'confirmed', discount.active === false ? 'inactive' : 'active')}
                      <button class="btn btn-sm" type="button" data-discount-toggle="${esc(discount.id)}" data-active="${discount.active === false ? 'false' : 'true'}">${discount.active === false ? 'Activate' : 'Deactivate'}</button>
                    </div>
                  </div>`
                )
                .join('')}</div>`
            : '<div class="empty-state"><p>No discounts assigned yet.</p></div>'
        }
      </div>
    </div>`;
}

/* ---------- Assistant ---------- */

/** The first thing PRECIOUS says, in both languages. */
const PRECIOUS_GREETING = {
  en: "Hi! I'm PRECIOUS, your AI assistant. Kumusta! I'm here to help you navigate the system, answer your questions, and assist you whenever you need help.",
  fil: "Kumusta! Ako si PRECIOUS, ang AI assistant mo. Nandito ako para tumulong sa pag-navigate ng system, sumagot sa mga tanong mo, at gabayan ka kapag kailangan mo ng tulong.",
};

/**
 * Suggested questions, chosen from the page the user is on. They are questions
 * the answer engine can actually answer, so tapping one never leads to a dead
 * end. Taglish is grouped with Filipino because that is how the answers read.
 */
const PRECIOUS_SUGGESTIONS = {
  en: {
    overview: ['How much is a photobooth?', 'Where are your branches?', 'How do I make a booking?'],
    book: ['How much is a tarpaulin?', 'How many booth services can run at once?', 'How do I pay the reservation fee?'],
    bookings: ['What is my booking status?', 'How long until my pickup is ready?', 'Can I move my date?'],
    payments: ['How much is the reservation fee?', 'Which payment methods do you accept?', 'Can I move my date?'],
    reports: ['How many booth units are available?', 'What is scheduled today?', 'How long does processing take?'],
    inventory: ['How many booth units are available?', 'Which units are assigned to deployments?', 'What is scheduled today?'],
    calendar: ['What is scheduled today?', 'Which units are assigned to deployments?', 'How many booth units are available?'],
    team: ['What are your opening hours?', 'Where are your branches?', 'How do I contact the studio?'],
    alerts: ['What is my booking status?', 'Can I move my date?', 'How do I contact the studio?'],
    schedule: ['What is my booking status?', 'How many services can run at once?', 'How long does processing take?'],
    account: ['How do I contact the studio?', 'Can I move my date?', 'What is the reservation fee?'],
    discounts: ['Do I have a discount?', 'How much is the reservation fee?', 'Where are your branches?'],
  },
  fil: {
    overview: ['Magkano ang photobooth?', 'Saan ang mga branch?', 'Paano gumawa ng booking?'],
    book: ['Magkano ang tarpaulin?', 'Ilang booth ang pwedeng sabay?', 'Paano magbayad ng reservation fee?'],
    bookings: ['Ano ang status ng booking ko?', 'Gaano katagal bago maging ready ang pickup?', 'Pwede bang ilipat ang date?'],
    payments: ['Magkano ang reservation fee?', 'Anong payment methods ang tinatanggap?', 'Pwede bang ilipat ang date?'],
    reports: ['Ilan ang available na booth units?', 'Ano ang naka-schedule ngayon?', 'Gaano katagal ang processing?'],
    inventory: ['Ilan ang available na booth units?', 'Anong units ang naka-assign?', 'Ano ang naka-schedule ngayon?'],
    calendar: ['Ano ang naka-schedule ngayon?', 'Anong units ang naka-assign?', 'Ilan ang available na booth units?'],
    team: ['Saan ang mga branch?', 'Ano ang opening hours?', 'Paano makipag-ugnayan sa studio?'],
    alerts: ['Ano ang status ng booking ko?', 'Pwede bang ilipat ang date?', 'Paano makipag-ugnayan sa studio?'],
    schedule: ['Ano ang status ng booking ko?', 'Ilang serbisyo ang pwedeng sabay?', 'Gaano katagal ang processing?'],
    account: ['Paano makipag-ugnayan sa studio?', 'Pwede bang ilipat ang date?', 'Magkano ang reservation fee?'],
    discounts: ['May discount ba ako?', 'Magkano ang reservation fee?', 'Saan ang mga branch?'],
  },
};

/** Removes the old tab-only transcript so it cannot reappear after this update. */
function clearLegacyAssistantHistory() {
  try {
    sessionStorage.removeItem('pm.precious.chat');
  } catch {
    // Storage may be unavailable in private mode; there is nothing to clean up.
  }
}

/** Renders the conversation, the greeting, and the typing indicator. */
function renderAssistantLog() {
  const log = document.querySelector('[data-assistant-log]');
  if (!log) return;
  if (!state.chat.length) {
    log.innerHTML = `
      <div class="assistant-greeting">
        <span class="assistant-orb" aria-hidden="true">P</span>
        <div><strong>PRECIOUS</strong><p>${esc(PRECIOUS_GREETING[state.chatLang])}</p></div>
      </div>`;
  } else {
    log.innerHTML = state.chat
      .map(
        (message) => `
        <div class="assistant-msg ${message.role}${message.error ? ' is-error' : ''}">${esc(message.text)}${
          message.error && state.chatRetry
            ? '<button class="assistant-retry" type="button" data-assistant-retry>Try again</button>'
            : ''
        }</div>`
      )
      .join('');
  }
  if (state.chatTyping) {
    log.insertAdjacentHTML(
      'beforeend',
      '<div class="assistant-msg studio assistant-typing" aria-label="PRECIOUS is typing"><i></i><i></i><i></i></div>'
    );
  }
  log.scrollTop = log.scrollHeight;
  renderAssistantSuggestions();
}

/** Suggestion chips for the current page, in the panel's current language. */
function renderAssistantSuggestions() {
  const box = document.querySelector('[data-assistant-suggestions]');
  if (!box) return;
  const table = PRECIOUS_SUGGESTIONS[state.chatLang] || PRECIOUS_SUGGESTIONS.en;
  const list = table[state.view] || table.overview;
  box.innerHTML = list
    .map(
      (question) =>
        `<button class="assistant-chip" type="button" data-assistant-suggest="${esc(question)}">${esc(question)}</button>`
    )
    .join('');
}

/** Renders the signed-in user's conversation drawer. Only server data is used. */
function renderAssistantHistory() {
  const panel = document.getElementById('assistant-panel');
  const box = document.querySelector('[data-assistant-history]');
  const list = document.querySelector('[data-assistant-history-list]');
  const toggle = document.querySelector('[data-assistant-history-toggle]');
  if (!box || !list) return;
  const open = Boolean(state.chatHistoryOpen);
  box.hidden = !open;
  panel?.classList.toggle('is-history', open);
  toggle?.setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (state.chatHistoryLoading) {
    list.innerHTML = '<p class="assistant-history-status" role="status">Loading conversations…</p>';
    return;
  }
  if (state.chatHistoryError) {
    list.innerHTML = `
      <div class="assistant-history-status" role="alert">
        <p>${esc(state.chatHistoryError)}</p>
        <button class="btn btn-sm" type="button" data-assistant-history-retry>Try again</button>
      </div>`;
    return;
  }
  if (!state.chatConversations.length) {
    list.innerHTML =
      '<p class="assistant-history-status">No previous conversations yet. Your chats will appear here after you send a question.</p>';
    return;
  }
  list.innerHTML = state.chatConversations
    .map(
      (conversation) => `
      <button class="assistant-conversation${conversation.id === state.chatId ? ' is-active' : ''}" type="button" data-assistant-conversation="${esc(conversation.id)}"${conversation.id === state.chatId ? ' aria-current="true"' : ''}>
        <strong>${esc(conversation.title || 'New conversation')}</strong>
        <span>${esc(conversation.preview || 'No messages yet')}</span>
        <time datetime="${esc(conversation.updated_at || '')}">${esc(formatDateTime(conversation.updated_at))}</time>
      </button>`
    )
    .join('');
}

async function loadAssistantConversations(force = false) {
  if (state.chatHistoryLoading) return;
  if (!force && state.chatHistoryLoaded) return;
  state.chatHistoryLoading = true;
  state.chatHistoryError = '';
  renderAssistantHistory();
  try {
    const data = await api('/api/assistant/conversations');
    state.chatConversations = Array.isArray(data.conversations) ? data.conversations : [];
    state.chatHistoryLoaded = true;
    if (data.available === false) {
      state.chatHistoryError = 'Chat history is not available yet. Ask the studio to finish the database setup.';
    }
  } catch (error) {
    state.chatHistoryError = errorInfo(error).message;
  } finally {
    state.chatHistoryLoading = false;
    renderAssistantHistory();
  }
}

function toggleAssistantHistory() {
  state.chatHistoryOpen = !state.chatHistoryOpen;
  if (state.chatHistoryOpen) document.getElementById('assistant-panel')?.classList.remove('is-min');
  renderAssistantHistory();
  if (state.chatHistoryOpen) loadAssistantConversations();
}

async function openAssistantConversation(id) {
  if (!id || state.chatLoadingConversation || state.chatTyping) return;
  state.chatLoadingConversation = true;
  try {
    const data = await api(`/api/assistant/conversations/${encodeURIComponent(id)}`);
    if (data.available === false || !data.conversation) {
      state.chatHistoryError =
        data.available === false
          ? 'Chat history is not available yet. Ask the studio to finish the database setup.'
          : 'That conversation could not be opened.';
      state.chatHistoryOpen = true;
      renderAssistantHistory();
      return;
    }
    state.chatId = data.conversation.id;
    state.chat = (data.messages || []).map((message) => ({
      role: message.role === 'assistant' ? 'studio' : 'user',
      text: String(message.content || ''),
    }));
    state.chatRetry = '';
    state.chatHistoryError = '';
    state.chatHistoryOpen = false;
    renderAssistantHistory();
    renderAssistantLog();
    document.getElementById('assistant-input')?.focus();
  } catch (error) {
    state.chatHistoryError = errorInfo(error).message;
    state.chatHistoryOpen = true;
    if (error.status === 404) {
      state.chatConversations = state.chatConversations.filter((conversation) => conversation.id !== id);
    }
    renderAssistantHistory();
  } finally {
    state.chatLoadingConversation = false;
  }
}

function startNewAssistantChat() {
  if (state.chatTyping) return;
  state.chatId = null;
  state.chat = [];
  state.chatRetry = '';
  state.chatHistoryOpen = false;
  renderAssistantHistory();
  renderAssistantLog();
  document.getElementById('assistant-input')?.focus();
}

/** Keeps an already-loaded drawer fresh after a successful reply. */
function rememberAssistantConversation(conversation, answer) {
  if (!conversation || !state.chatHistoryLoaded) return;
  const existing = state.chatConversations.find((item) => item.id === conversation.id);
  const updatedAt = conversation.updated_at || new Date().toISOString();
  const next = {
    id: conversation.id,
    title: conversation.title || existing?.title || 'New conversation',
    created_at: existing?.created_at || updatedAt,
    updated_at: updatedAt,
    preview: String(answer || '').slice(0, 120),
    message_count: (existing?.message_count || 0) + 2,
  };
  state.chatConversations = [
    next,
    ...state.chatConversations.filter((item) => item.id !== conversation.id),
  ].sort((first, second) => String(second.updated_at).localeCompare(String(first.updated_at)));
  renderAssistantHistory();
}

/**
 * Opens the in-app assistant panel without leaving the page. Focus moves to the
 * input so a keyboard user can type immediately; `closeAssistant` restores it.
 */
function openAssistant() {
  const panel = document.getElementById('assistant-panel');
  if (!panel) return;
  panel.classList.remove('is-min');
  if (!panel.hidden && !panel.classList.contains('is-closing')) {
    document.getElementById('assistant-input')?.focus();
    renderAssistantSuggestions();
    return;
  }
  delete panel.dataset.closing;
  panel.classList.remove('is-closing');
  panel.hidden = false;
  renderAssistantLog();
  renderAssistantHistory();
  requestAnimationFrame(() => panel.classList.add('is-open'));
  // Hidden tabs can suspend rAF; open anyway rather than leaving it half-shown.
  setTimeout(() => panel.classList.add('is-open'), 120);
  document.querySelector('[data-assistant-toggle]')?.setAttribute('aria-expanded', 'true');
  document.getElementById('assistant-input')?.focus();
}

/** Collapses the panel to its header; the conversation is kept. */
function minimizeAssistant() {
  const panel = document.getElementById('assistant-panel');
  if (!panel) return;
  panel.classList.toggle('is-min');
  if (panel.classList.contains('is-min')) {
    state.chatHistoryOpen = false;
    renderAssistantHistory();
  }
  if (!panel.classList.contains('is-min')) document.getElementById('assistant-input')?.focus();
}

/**
 * Switches the panel's own copy between English and Filipino. The answer engine
 * still replies in the language of each message, so a Taglish question gets a
 * Taglish answer even while the buttons read English.
 */
function toggleAssistantLang() {
  state.chatLang = state.chatLang === 'en' ? 'fil' : 'en';
  const button = document.querySelector('[data-assistant-lang]');
  if (button) {
    button.textContent = state.chatLang === 'en' ? 'EN' : 'FIL';
    button.setAttribute('aria-pressed', String(state.chatLang === 'fil'));
    button.setAttribute('aria-label', state.chatLang === 'en' ? 'Switch to Filipino' : 'Switch to English');
  }
  const input = document.getElementById('assistant-input');
  if (input) {
    input.placeholder =
      state.chatLang === 'en' ? 'Ask PRECIOUS anything…' : 'Magtanong kay PRECIOUS…';
  }
  renderAssistantLog();
}

/**
 * Sends one message and renders the answer.
 *
 * While waiting, a typing bubble stands in for the reply so the panel never
 * looks frozen. A failure becomes a message inside the conversation with a
 * retry link — the earlier messages stay, so nothing is lost.
 */
async function sendAssistant(message) {
  const text = String(message || '').trim();
  if (!text || state.chatTyping) return;
  const conversationId = state.chatId;
  state.chatRetry = '';
  state.chatHistoryOpen = false;
  renderAssistantHistory();
  state.chat.push({ role: 'user', text });
  state.chatTyping = true;
  renderAssistantLog();
  try {
    const data = await api('/api/assistant', {
      method: 'POST',
      body: JSON.stringify({
        message: text,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    });
    state.chat.push({ role: 'studio', text: data.answer });
    if (data.history_saved !== false && data.conversation_id) {
      state.chatId = data.conversation_id;
      state.chatHistoryError = '';
      rememberAssistantConversation(data.conversation, data.answer);
    } else if (data.history_saved === false) {
      state.chatHistoryLoaded = false;
      state.chatHistoryError = 'This chat could not be saved to your account. Please try again later.';
    }
  } catch (error) {
    const info = errorInfo(error);
    state.chat.push({ role: 'studio', text: `${info.title}. ${info.message}`, error: true });
    state.chatRetry = text;
  } finally {
    state.chatTyping = false;
    renderAssistantLog();
  }
}

/* ---------- Global interface states ---------- */

/**
 * One banner for connectivity, created on demand so every page that needs it
 * does not have to carry the markup.
 */
function showNetBanner(text, { online = false } = {}) {
  let node = document.querySelector('.net-banner');
  if (!node) {
    node = document.createElement('div');
    node.className = 'net-banner';
    node.setAttribute('role', 'status');
    node.innerHTML = '<span class="net-dot" aria-hidden="true"></span><span class="net-copy"></span>';
    document.body.appendChild(node);
  }
  node.querySelector('.net-copy').textContent = text;
  node.classList.toggle('is-online', online);
  requestAnimationFrame(() => node.classList.add('show'));
}

function hideNetBanner() {
  document.querySelector('.net-banner')?.classList.remove('show');
}

function showSlowNote() {
  let node = document.querySelector('.slow-note');
  if (!node) {
    node = document.createElement('div');
    node.className = 'slow-note';
    node.setAttribute('role', 'status');
    document.body.appendChild(node);
  }
  node.textContent =
    'Still working — your connection is slower than usual. Your input is safe; this will finish on its own.';
  node.classList.add('show');
  clearTimeout(showSlowNote._timer);
  showSlowNote._timer = setTimeout(() => node.classList.remove('show'), 9000);
}

/**
 * Reacts to the browser going offline or coming back, keeps the submit button
 * honest while disconnected, and never blocks reading what is already loaded.
 */
function setupConnectivity() {
  const paint = (announce) => {
    state.online = typeof navigator === 'undefined' ? true : navigator.onLine;
    document.body.classList.toggle('is-offline', !state.online);
    if (!state.online) {
      showNetBanner(
        "You're offline. What you already opened still works — sending a booking or loading new data waits for a connection."
      );
    } else if (announce) {
      showNetBanner('Back online. You can continue where you left off.', { online: true });
      setTimeout(hideNetBanner, 3200);
      toast('Back online.', 'success');
    } else {
      hideNetBanner();
    }
    const submit = document.querySelector('#booking-form button[type="submit"]');
    if (submit) submit.disabled = !state.online || !state.cart.length;
  };
  window.addEventListener('offline', () => paint(true));
  window.addEventListener('online', () => paint(true));
  paint(false);
}

/**
 * One dialog for the two states a page cannot recover from on its own: an ended
 * session and a missing permission. Both explain the cause and offer a way out.
 */
function openStateModal({ icon = 'spark', title, message, primaryLabel, primaryAction, secondaryLabel, secondaryAction }) {
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal state-modal" role="dialog" aria-modal="true" aria-labelledby="state-title">
        <div class="modal-icon">${ICONS[icon] || ICONS.spark}</div>
        <h2 id="state-title">${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" data-state-primary="${esc(primaryAction)}">${esc(primaryLabel)}</button>
          ${
            secondaryLabel
              ? `<button class="btn" type="button" data-state-secondary="${esc(secondaryAction)}">${esc(secondaryLabel)}</button>`
              : ''
          }
        </div>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-state-primary]')?.focus();
}

/** Wires the global 401/403/slow signals raised by `api()` in api.js. */
function setupSessionGuard() {
  window.addEventListener('pm:session-expired', () => {
    if (state.sessionEnded || !state.user) return;
    state.sessionEnded = true;
    saveBookingDraft();
    openStateModal({
      icon: 'logout',
      title: 'Your session ended',
      message:
        'You were signed out to protect your account. Your unfinished booking is saved on this device — sign in again and we will put it back.',
      primaryLabel: 'Sign in again',
      primaryAction: 'signin',
      secondaryLabel: 'Stay on this page',
      secondaryAction: 'dismiss',
    });
  });
  window.addEventListener('pm:forbidden', (event) => {
    openStateModal({
      icon: 'mail',
      title: 'This needs different access',
      message:
        event.detail?.message ||
        'Your account can use the rest of the dashboard, but not this part. Ask the studio owner to change your role if you need it.',
      primaryLabel: 'Go back',
      primaryAction: 'back',
      secondaryLabel: 'Back to overview',
      secondaryAction: 'overview',
    });
  });
  window.addEventListener('pm:slow', showSlowNote);
}

/* ---------- Unsaved booking drafts ---------- */

const DRAFT_KEY = 'pm.booking.draft';

function saveBookingDraft() {
  const form = document.getElementById('booking-form');
  if (!form || !state.cart.length) return;
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        cart: state.cart,
        fields: Object.fromEntries(new FormData(form).entries()),
        type: state.bookingType,
        at: Date.now(),
      })
    );
  } catch {
    // Nothing to save without storage; the in-memory cart still survives.
  }
}

function clearBookingDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** Puts a saved cart back, dropping any service retired since it was written. */
function restoreBookingDraft() {
  let draft = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    draft = null;
  }
  if (!draft || !Array.isArray(draft.cart) || !draft.cart.length) return false;
  const alive = new Set(state.services.map((service) => service.id));
  state.cart = draft.cart.filter((item) => alive.has(item.service_id));
  if (!state.cart.length) {
    clearBookingDraft();
    return false;
  }
  state.bookingType = draft.type === 'pickup' ? 'pickup' : 'event';
  state.pendingDraft = draft.fields || null;
  return true;
}

/** Fills the rendered form from a restored draft, once. */
function applyDraftFields() {
  if (!state.pendingDraft) return;
  const form = document.getElementById('booking-form');
  if (!form) return;
  for (const [name, value] of Object.entries(state.pendingDraft)) {
    const field = form.elements.namedItem(name);
    if (field && typeof value === 'string' && !field.value) field.value = value;
  }
  state.pendingDraft = null;
  toast('We restored your unfinished booking.', 'info');
}

let draftTimer;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveBookingDraft, 600);
}

/* ---------- Inline form validation ---------- */

/** Shows or clears the message directly under one field. */
function setFieldError(field, message) {
  const wrapper = field.closest('.field');
  if (!wrapper) return;
  let node = wrapper.querySelector('.field-error');
  if (!message) {
    field.classList.remove('invalid');
    field.removeAttribute('aria-invalid');
    if (node) node.remove();
    return;
  }
  field.classList.add('invalid');
  field.setAttribute('aria-invalid', 'true');
  if (!node) {
    node = document.createElement('span');
    node.className = 'field-error';
    wrapper.appendChild(node);
  }
  node.textContent = message;
}

function bookingFieldProblem(field) {
  const value = String(field.value || '').trim();
  switch (field.name) {
    case 'branch_id':
      // Required for a pickup; on an event the branch is optional (the studio
      // routes by address), so an empty select is valid there.
      if (state.bookingType !== 'pickup') return '';
      return value ? '' : 'Choose the branch where you will pick up.';
    case 'pickup_date':
      if (!value) return 'Choose your pickup date.';
      return value < todayISO() ? 'The pickup date cannot be in the past.' : '';
    case 'event_date':
      if (!value) return 'Choose your event date.';
      return value < todayISO() ? 'The event date cannot be in the past.' : '';
    case 'event_time':
      return value ? '' : 'Choose the event start time.';
    case 'venue':
      return value.length >= 3 ? '' : 'Add the event venue, even a short name.';
    case 'address':
      return value.length >= 8 ? '' : 'Add the full address: house or venue, street, barangay, city.';
    default:
      return '';
  }
}

/** Validates every field, shows each message, and returns the first problem. */
function validateBookingForm(form) {
  let first = null;
  let message = '';
  for (const field of form.querySelectorAll('input, select, textarea')) {
    if (!field.name) continue;
    const problem = bookingFieldProblem(field);
    setFieldError(field, problem);
    if (problem && !first) {
      first = field;
      message = problem;
    }
  }
  if (first) {
    first.focus();
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return message;
}

function clearFieldError(field) {
  if (field?.classList?.contains('invalid')) setFieldError(field, '');
}

function showTemporaryPassword(name, email, temporary) {
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="temp-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <h2 id="temp-title">Temporary password</h2>
        <p>Hand this to <strong>${esc(name)}</strong> (${esc(email)}) privately. It is shown once, and two-factor was reset for the account.</p>
        <div class="modal-ref"><code>${esc(temporary)}</code></div>
        <p class="tiny">They can change it under Account &amp; security after signing in.</p>
        <div class="modal-actions"><button class="btn btn-primary" type="button" data-modal-close>Done</button></div>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-modal-close]')?.focus();
}

/* ---------- Rate card dialog ---------- */

function rateCardSkeleton() {
  return `
    <div class="rate-skeleton" aria-hidden="true">
      ${'<span class="skeleton"></span>'.repeat(7)}
    </div>
    <p class="sr-only" role="status">Loading the rate card…</p>`;
}

/**
 * Fetches the live catalog for the rate-card dialog. Shows a skeleton while it
 * loads and an inline error with a retry button if it fails; the dialog stays
 * open either way so the customer is never left staring at nothing.
 */
async function loadRateCard() {
  const body = modalRoot.querySelector('[data-rate-body]');
  if (!body) return;
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = rateCardSkeleton();
  try {
    const catalog = await api('/api/services');
    if (!body.isConnected) return;
    body.innerHTML =
      priceGroupsHtml(catalog) || '<p class="price-error">No prices are published yet. Please check back soon.</p>';
  } catch {
    if (!body.isConnected) return;
    body.innerHTML = `
      <div class="price-error">
        <p>The rate card could not load. Check your connection and try again.</p>
        <button class="btn btn-sm" type="button" data-rate-retry>Try again</button>
      </div>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}

/** Opens the rate-card dialog and starts loading it. */
function openRateCard() {
  state.lastModalFocus = document.activeElement;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal modal--rate" role="dialog" aria-modal="true" aria-labelledby="rate-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <h2 id="rate-title">Rate card</h2>
        <p class="modal-lead">Starting prices for prints, coverage and booths. The final quote depends on your date and location.</p>
        <div class="rate-body" data-rate-body></div>
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector('[data-modal-close]')?.focus();
  loadRateCard();
}

async function markAlertsRead() {
  try {
    await api('/api/notifications/read', { method: 'POST', body: '{}' });
  } catch {
    // Badge stays until the next load; the list itself is already readable.
  }
  state.unread = 0;
  renderChrome();
}

function renderAlerts() {
  const list = state.notifications;
  const scope = state.user.role === 'admin' ? 'either branch' : branchName(state.user.branch_id);
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>${plural(list.length, 'alert')}</h2><p>New bookings routed to ${esc(scope)}.</p></div>
      <div class="page-actions"><button class="btn" type="button" data-refresh-alerts>${ICONS.refresh} Refresh</button></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div><h3>Booking notifications</h3><p>Customer, service, address, and event date for each new request</p></div>
      </div>
      ${
        list.length
          ? `<div class="activity-list">${list
              .map(
                (item) => `
                <div class="activity-item">
                  <span class="workload-avatar">${esc(initials(item.title))}</span>
                  <div class="activity-copy">
                    <p><strong>${esc(item.title)}</strong></p>
                    <span>${esc(item.message)}</span>
                    <small>${relativeTime(item.created_at)}${item.read_at ? '' : ' · unread'}</small>
                  </div>
                  ${item.booking_id ? `<button class="btn btn-sm" type="button" data-open-booking="${esc(item.booking_id)}">Open</button>` : ''}
                </div>`
              )
              .join('')}</div>`
          : emptyState({
              icon: 'mail',
              title: 'No alerts yet',
              text: 'A customer booking routed to your branch will appear here.',
            })
      }
    </div>`;
  if (state.unread) markAlertsRead();
}

function renderAdminBookings() {
  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Coordinate the calendar</h2><p>Confirm dates, assign a crew, and keep every status current.</p></div>
      <div class="page-actions">
        ${
          state.user.role === 'admin'
            ? `<button class="btn" type="button" data-nav="reports">${ICONS.reports} Reports</button>`
            : `<button class="btn" type="button" data-nav="alerts">${ICONS.mail} Alerts${state.unread ? ` · ${state.unread}` : ''}</button>`
        }
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
          <option value="review" ${state.adminStatus === 'review' ? 'selected' : ''}>Needs branch review</option>
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

/* ---------- Payments, reports, and alerts ---------- */

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

/* ---------- Logistics calendar ---------- */

function calendarBounds(month) {
  const value = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : todayISO().slice(0, 7);
  const [year, monthNumber] = value.split('-').map(Number);
  const from = `${value}-01`;
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function shiftCalendarMonth(month, amount) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

async function loadCalendar() {
  const month = state.calendarMonth;
  const bounds = calendarBounds(month);
  state.calendarLoading = true;
  state.calendarError = '';
  if (state.view === 'calendar') renderView();
  const params = new URLSearchParams({ from: bounds.from, to: bounds.to });
  if (state.user.role === 'admin' && state.calendarBranch) params.set('branch_id', state.calendarBranch);
  try {
    const data = await api(`/api/logistics?${params.toString()}`);
    if (month !== state.calendarMonth) return;
    state.calendar = data;
  } catch (error) {
    if (month !== state.calendarMonth) return;
    state.calendarError = error.message;
    state.calendar = null;
  } finally {
    if (month === state.calendarMonth) {
      state.calendarLoading = false;
      if (state.view === 'calendar') renderView();
    }
  }
}

function calendarEntryChip(entry) {
  const units = entry.assigned_units || [];
  const status = DEPLOYMENT_LABELS[entry.deployment_status] || 'Unassigned';
  return `<button class="calendar-entry cal-${esc(entry.type)}" type="button" data-open-booking="${esc(
    entry.booking_id
  )}" title="${esc(
    `${entry.customer} · ${entry.branch} · ${status}${units.length ? ` · ${units.join(', ')}` : ''}`
  )}">
    <span><strong>${esc(formatTime(entry.time) || 'TBC')}</strong> ${esc(entry.type_label)}</span>
    <small>${esc(entry.ref)}${units.length ? ` · ${esc(units.join(', '))}` : ''}</small>
  </button>`;
}

function renderCalendar() {
  if (state.calendarError) {
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.calendar}</div>
        <h3>Calendar could not load</h3>
        <p>${esc(state.calendarError)}</p>
        <div class="no-results-actions"><button class="btn btn-primary" type="button" data-calendar-retry>Try again</button></div>
      </div>`;
    return;
  }
  const bounds = calendarBounds(state.calendarMonth);
  const data = state.calendar;
  if (!data || data.from !== bounds.from || data.to !== bounds.to) {
    viewRoot.innerHTML = '<div class="view-skeleton" role="status" aria-live="polite">Building the logistics calendar…</div>';
    return;
  }

  const byDate = new Map();
  for (const entry of data.entries || []) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }
  const firstDay = new Date(`${bounds.from}T00:00:00Z`).getUTCDay();
  const daysInMonth = Number(bounds.to.slice(8, 10));
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return { date: `${state.calendarMonth}-${day}`, number: day, entries: byDate.get(`${state.calendarMonth}-${day}`) || [] };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(`${bounds.from}T00:00:00Z`).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const summary = data.summary || {};
  const branches = data.branches || state.branches;

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>${esc(monthLabel)} at a glance.</h2><p>Each setup, event, and pickup is built from live booking records. Assigned units and deployment status travel with the booking.</p></div>
      <div class="page-actions">
        ${
          state.user.role === 'admin'
            ? `<select class="select" id="calendar-branch" aria-label="Filter calendar by branch">
                <option value="">All branches</option>
                ${branches
                  .map(
                    (branch) =>
                      `<option value="${esc(branch.id)}" ${state.calendarBranch === branch.id ? 'selected' : ''}>${esc(branch.name)}</option>`
                  )
                  .join('')}
              </select>`
            : ''
        }
        <button class="btn" type="button" data-calendar-today>Today</button>
        <button class="btn btn-sm" type="button" data-calendar-prev aria-label="Previous month">${ICONS.chevron}</button>
        <button class="btn btn-sm" type="button" data-calendar-next aria-label="Next month">${ICONS.chevron}</button>
      </div>
    </div>
    <div class="stats-strip calendar-stats">
      <div class="stat-cell"><span>Bookings</span><strong>${summary.bookings || 0}</strong><small>With work in this month</small></div>
      <div class="stat-cell"><span>Setups</span><strong>${summary.setups || 0}</strong><small>Scheduled setup calls</small></div>
      <div class="stat-cell"><span>Events</span><strong>${summary.events || 0}</strong><small>Event windows</small></div>
      <div class="stat-cell"><span>Pickups</span><strong>${summary.pickups || 0}</strong><small>Collections and pickups</small></div>
      <div class="stat-cell"><span>Units committed</span><strong>${summary.assigned_units || 0}</strong><small>Distinct assigned units</small></div>
    </div>
    <div class="panel calendar-panel ${state.calendarLoading ? 'is-refreshing' : ''}">
      <div class="calendar-toolbar">
        <div class="calendar-legend">
          <span class="cal-key cal-key-setup">Setup</span>
          <span class="cal-key cal-key-event">Event</span>
          <span class="cal-key cal-key-pickup">Pickup</span>
          <span class="calendar-legend-note">${state.calendarLoading ? 'Refreshing live records…' : 'Live from bookings'}</span>
        </div>
        <span class="tiny muted">${esc(monthLabel)}</span>
      </div>
      <div class="calendar-weekdays" aria-hidden="true">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        .map((day) => `<span>${day}</span>`)
        .join('')}</div>
      <div class="calendar-grid">
        ${cells
          .map((cell) => {
            if (!cell) return '<div class="calendar-cell is-empty" aria-hidden="true"></div>';
            const shown = cell.entries.slice(0, 3);
            return `<div class="calendar-cell ${cell.date === todayISO() ? 'is-today' : ''}">
              <div class="calendar-cell-head"><strong>${Number(cell.number)}</strong>${cell.date === todayISO() ? '<span>Today</span>' : ''}</div>
              <div class="calendar-cell-entries">${shown.map(calendarEntryChip).join('')}${
                cell.entries.length > shown.length
                  ? `<span class="calendar-more">+${cell.entries.length - shown.length} more</span>`
                  : ''
              }</div>
            </div>`;
          })
          .join('')}
      </div>
      <div class="table-foot"><span>Click any schedule item to open its booking.</span><span>Deployment: unassigned → scheduled → dispatched → on site → collected</span></div>
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

/** Shape-of-the-content placeholder, used instead of a spinner while a report builds. */
function reportSkeleton() {
  return `
    <div class="view-skeleton">
      <div class="view-skeleton-grid">
        ${'<span class="skeleton skeleton-card"></span>'.repeat(4)}
      </div>
      <span class="skeleton skeleton-block"></span>
    </div>
    <p class="sr-only" role="status">Building your report from live records…</p>`;
}

/* ---------- Owner pricing console ---------- */

async function loadPricing() {
  state.pricingError = '';
  try {
    state.pricing = await api('/api/pricing');
  } catch (error) {
    state.pricingError = error.message;
  }
  renderView();
}

/* ---------- Shared product-image management ---------- */

async function loadProductImages() {
  state.imagesError = '';
  try {
    state.images = await api('/api/product-images');
  } catch (error) {
    state.imagesError = error.message;
  }
  renderView();
}

function imageStatus(service) {
  if (!service.image_url) return { key: 'missing', label: 'Image needed' };
  if (service.active === false) return { key: 'inactive', label: 'Inactive' };
  if (service.catalog_visible === false) return { key: 'hidden', label: 'Hidden' };
  return { key: 'published', label: 'Published' };
}

function renderAdminImages() {
  if (state.imagesError) {
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.camera}</div>
        <h3>Product media could not load</h3>
        <p>${esc(state.imagesError)}</p>
        <div class="no-results-actions"><button class="btn btn-primary" type="button" data-images-retry>Try again</button></div>
      </div>`;
    return;
  }
  if (!state.images) {
    viewRoot.innerHTML = '<div class="view-skeleton" role="status" aria-live="polite">Loading the shared product catalog…</div>';
    return;
  }
  const data = state.images;
  const services = data.services || [];
  const search = state.imageSearch.trim().toLowerCase();
  const filtered = services.filter((service) => {
    const status = imageStatus(service).key;
    const matchesFilter =
      state.imageFilter === 'all' ||
      (state.imageFilter === 'missing' && status === 'missing') ||
      (state.imageFilter === 'published' && status === 'published') ||
      (state.imageFilter === 'hidden' && (status === 'hidden' || status === 'inactive'));
    return (
      matchesFilter &&
      (!search || `${service.name} ${service.category} ${service.image_alt}`.toLowerCase().includes(search))
    );
  });
  const categories = (data.categories || []).filter((category) =>
    filtered.some((service) => service.category === category.name)
  );
  const recent = data.recent_changes || [];
  const stats = data.stats || {};

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>The shared catalog, picture and motion</h2><p>Main Admin and Branch Admin changes apply to every customer screen. Add a short booth preview video so customers can see the experience before they book.</p></div>
      <div class="page-actions"><a class="btn" href="/shop#catalog" target="_blank" rel="noopener">View public catalog</a></div>
    </div>
    <div class="stats-strip">
      <div class="stat-cell"><span>All products</span><strong>${stats.total || services.length}</strong><small>Across every category</small></div>
      <div class="stat-cell"><span>With an image</span><strong>${stats.with_image || 0}</strong><small>${stats.with_video || 0} booth ${stats.with_video === 1 ? 'video' : 'videos'} live</small></div>
      <div class="stat-cell"><span>Image needed</span><strong class="${stats.missing ? 'rose' : ''}">${stats.missing || 0}</strong><small>Upload before publishing</small></div>
      <div class="stat-cell"><span>Visible to customers</span><strong>${stats.visible || 0}</strong><small>Active and catalog-visible</small></div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <div class="search-field">
          ${ICONS.search}
          <input type="search" id="image-search" placeholder="Search products or categories…" value="${esc(state.imageSearch)}" aria-label="Search product images" />
        </div>
        <select class="filter-select" id="image-filter" aria-label="Filter images">
          <option value="all" ${state.imageFilter === 'all' ? 'selected' : ''}>All images</option>
          <option value="missing" ${state.imageFilter === 'missing' ? 'selected' : ''}>Image needed</option>
          <option value="published" ${state.imageFilter === 'published' ? 'selected' : ''}>Published</option>
          <option value="hidden" ${state.imageFilter === 'hidden' ? 'selected' : ''}>Hidden or inactive</option>
        </select>
        <div class="toolbar-right"><span class="tiny muted">${plural(filtered.length, 'product')} shown</span></div>
      </div>
      ${
        filtered.length
          ? categories
              .map((category) => {
                const items = filtered.filter((service) => service.category === category.name);
                return `<section class="image-admin-group">
                  <div class="catalog-group-head"><h3>${esc(category.name)}</h3><p>${esc(category.note)}</p><span class="tiny muted">${plural(items.length, 'product')}</span></div>
                  <div class="image-admin-grid">${items.map(imageAdminCard).join('')}</div>
                </section>`;
              })
              .join('')
          : noResultsState({
              title: 'No products match this filter',
              text: 'Clear the search or choose another image status.',
            })
      }
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><div><h3>Recent media changes</h3><p>Who changed which catalog image or booth video, and when</p></div></div>
      ${
        recent.length
          ? `<div class="activity-list">${recent
              .map(
                (log) => `<div class="activity-item">
                  <span class="workload-avatar">${esc(initials(log.actor_role === 'branch_admin' ? 'Branch admin' : 'Main admin'))}</span>
                  <div class="activity-copy">
                    <p><strong>${esc(log.metadata?.product || log.target_id || 'Product')}</strong></p>
                    <span>${esc(String(log.action || '').replace(/^product_(image|video)\./, '').replaceAll('_', ' '))} · ${esc(log.actor_role || 'administrator')}</span>
                    <small>${relativeTime(log.created_at)}</small>
                  </div>
                </div>`
              )
              .join('')}</div>`
          : '<div class="table-empty">No media changes recorded yet.</div>'
      }
    </div>`;
}

function imageAdminCard(service) {
  const status = imageStatus(service);
  const selected = state.imageSelections.get(service.id);
  return `
    <article class="image-admin-card" data-image-card="${esc(service.id)}" data-search="${esc(`${service.name} ${service.category} ${service.image_alt || ''}`.toLowerCase())}">
      <div class="image-admin-preview" data-image-local-preview>
        ${selected ? `<img src="${esc(selected.url)}" alt="Preview of the selected ${esc(service.name)} image" />` : productImageMarkup(service)}
        <span class="image-status image-status--${status.key}">${status.label}</span>
      </div>
      <div class="image-admin-body">
        <div class="image-admin-title"><strong>${esc(service.name)}</strong><span>${esc(service.category)}</span></div>
        <p class="tiny muted">${service.image_url ? `Current image · ${service.image_width || '?'} × ${service.image_height || '?'} px` : 'No approved image yet. Upload a real product photo or an accurate reference image.'}</p>
        <label class="field image-alt-field"><span>Accessible description</span><input class="input" data-image-alt maxlength="180" value="${esc(service.image_alt || '')}" placeholder="e.g. Printed tarpaulin with metal grommets" /></label>
        <div class="image-admin-actions">
          <label class="btn btn-sm image-picker">
            ${service.image_url ? 'Replace image' : 'Choose image'}
            <input type="file" accept="image/jpeg,image/png,image/webp" data-image-input="${esc(service.id)}" hidden />
          </label>
          <button class="btn btn-sm btn-primary" type="button" data-image-save="${esc(service.id)}" ${selected ? '' : 'disabled'}>Save image</button>
          ${service.image_url ? `<button class="btn btn-sm btn-danger" type="button" data-image-remove="${esc(service.id)}">Remove</button>` : ''}
        </div>
        <p class="tiny muted">JPG, PNG, or WEBP · 300 × 300 px minimum · 4 MB maximum. Preview before saving.</p>
        <p class="form-error" data-image-message role="alert"></p>
        <div class="image-admin-video">
          <div class="image-admin-video-head">
            <strong>Preview video</strong>
            ${service.video_url ? '<span class="tiny muted">Customers can play this from the product details.</span>' : '<span class="tiny muted">Optional; a short booth demo helps customers picture the experience.</span>'}
          </div>
          ${
            service.video_url
              ? `<video class="image-admin-video-player" controls preload="none" aria-label="${esc(service.name)} preview video"${service.image_url ? ` poster="${esc(serviceImageUrl(service))}"` : ''} src="${esc(serviceVideoUrl(service))}"></video>`
              : '<div class="image-admin-video-empty">No preview video yet.</div>'
          }
          <div class="image-admin-actions">
            <label class="btn btn-sm image-picker">
              ${service.video_url ? 'Replace video' : 'Upload video'}
              <input type="file" accept="video/mp4,video/webm,.mp4,.webm" data-video-input="${esc(service.id)}" hidden />
            </label>
            ${service.video_url ? `<button class="btn btn-sm btn-danger" type="button" data-video-remove="${esc(service.id)}">Remove video</button>` : ''}
            <span class="tiny muted" data-video-status></span>
          </div>
          <p class="tiny muted">MP4 or WEBM · 25 MB maximum · a short booth walkthrough works best. The upload replaces the current video only after it succeeds.</p>
          <p class="form-error" data-video-message role="alert"></p>
        </div>
      </div>
    </article>`;
}

function imageMessage(card, message) {
  const box = card?.querySelector('[data-image-message]');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('show', Boolean(message));
}

function clearImageSelection(id) {
  const selected = state.imageSelections.get(id);
  if (selected?.url) URL.revokeObjectURL(selected.url);
  state.imageSelections.delete(id);
}

/** Restores the card to the saved image and disables Save after a rejected file. */
function resetImagePreview(card, id) {
  clearImageSelection(id);
  const service = (state.images?.services || []).find((row) => row.id === id);
  const preview = card.querySelector('[data-image-local-preview]');
  if (service && preview) {
    const status = imageStatus(service);
    preview.innerHTML = `${productImageMarkup(service)}<span class="image-status image-status--${status.key}">${status.label}</span>`;
  }
  const save = card.querySelector('[data-image-save]');
  if (save) save.disabled = true;
}

function previewImageSelection(input) {
  const id = input.dataset.imageInput;
  const card = input.closest('[data-image-card]');
  const file = input.files?.[0];
  if (!id || !card || !file) return;

  imageMessage(card, '');
  const reject = (message) => {
    input.value = '';
    resetImagePreview(card, id);
    imageMessage(card, message);
  };

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    reject(IMAGE_ERRORS.format);
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    reject(IMAGE_ERRORS.size);
    return;
  }

  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalWidth < 300 || probe.naturalHeight < 300) {
      URL.revokeObjectURL(url);
      reject(IMAGE_ERRORS.small);
      return;
    }
    clearImageSelection(id);
    state.imageSelections.set(id, { file, url });
    const preview = card.querySelector('[data-image-local-preview]');
    if (preview) {
      const status = preview.querySelector('.image-status')?.outerHTML || '';
      preview.innerHTML = `<img src="${esc(url)}" alt="Preview of the selected image" />${status}<span class="image-preview-label">Preview — not saved yet</span>`;
    }
    const save = card.querySelector('[data-image-save]');
    if (save) save.disabled = false;
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    reject(IMAGE_ERRORS.damaged);
  };
  probe.src = url;
}

async function saveProductImageFile(id, button) {
  const selected = state.imageSelections.get(id);
  const card = document.querySelector(`[data-image-card="${id}"]`);
  if (!selected || !card) {
    imageMessage(card, 'Choose an image to preview before saving.');
    return;
  }
  const alt = card.querySelector('[data-image-alt]')?.value.trim() || '';
  imageMessage(card, '');
  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    const { service } = await api(`/api/services/${encodeURIComponent(id)}/image?alt=${encodeURIComponent(alt)}`, {
      method: 'POST',
      headers: { 'Content-Type': selected.file.type },
      body: selected.file,
    });
    replaceServiceInState(service);
    clearImageSelection(id);
    toast(`${service.name} image saved. The customer catalog is updated.`);
    await loadProductImages();
  } catch (error) {
    console.error('Product image upload failed:', error);
    const message =
      error?.status === 413
        ? IMAGE_ERRORS.size
        : KNOWN_IMAGE_ERRORS.has(error?.message)
          ? error.message
          : IMAGE_ERRORS.upload;
    imageMessage(card, message);
    button.disabled = false;
    button.textContent = 'Save image';
  }
}


async function removeProductImageFile(id, button) {
  const card = document.querySelector(`[data-image-card="${id}"]`);
  if (!card) return;
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = 'Tap again to remove';
    toast('Removing the image also hides this product from the customer catalog. Tap once more.', 'warning');
    return;
  }
  button.disabled = true;
  button.textContent = 'Removing…';
  try {
    const { service } = await api(`/api/services/${encodeURIComponent(id)}/image`, { method: 'DELETE' });
    replaceServiceInState(service);
    clearImageSelection(id);
    toast(`${service.name} image removed and the product hidden.`);
    await loadProductImages();
  } catch (error) {
    imageMessage(card, error.message);
    button.disabled = false;
    button.textContent = 'Remove';
    delete button.dataset.armed;
  }
}

function videoMessage(card, message) {
  const box = card?.querySelector('[data-video-message]');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('show', Boolean(message));
}

async function uploadProductVideo(input) {
  const id = input.dataset.videoInput;
  const card = input.closest('[data-image-card]');
  const file = input.files?.[0];
  if (!id || !card || !file) return;

  videoMessage(card, '');
  const reject = (message) => {
    input.value = '';
    videoMessage(card, message);
  };
  const lowerName = file.name.toLowerCase();
  const inferredType = lowerName.endsWith('.mp4') ? 'video/mp4' : lowerName.endsWith('.webm') ? 'video/webm' : '';
  const type = ['video/mp4', 'video/webm'].includes(file.type) ? file.type : inferredType;
  if (!['video/mp4', 'video/webm'].includes(type)) {
    reject(VIDEO_ERRORS.format);
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    reject(VIDEO_ERRORS.size);
    return;
  }

  const status = card.querySelector('[data-video-status]');
  input.disabled = true;
  if (status) status.textContent = 'Uploading…';
  try {
    const { service } = await api(`/api/services/${encodeURIComponent(id)}/video`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: file,
    });
    replaceServiceInState(service);
    toast(`${service.name} preview video saved.`);
    await loadProductImages();
  } catch (error) {
    console.error('Product video upload failed:', error);
    const message =
      error?.status === 413
        ? VIDEO_ERRORS.size
        : [400, 415, 503].includes(error?.status) && error.message
          ? error.message
          : VIDEO_ERRORS.upload;
    videoMessage(card, message);
    input.disabled = false;
    input.value = '';
    if (status) status.textContent = '';
  }
}

async function removeProductVideoFile(id, button) {
  const card = document.querySelector(`[data-image-card="${id}"]`);
  if (!card) return;
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = 'Tap again to remove';
    toast('Removing the preview video leaves the product published. Tap once more.', 'warning');
    return;
  }
  button.disabled = true;
  button.textContent = 'Removing…';
  try {
    const { service } = await api(`/api/services/${encodeURIComponent(id)}/video`, { method: 'DELETE' });
    replaceServiceInState(service);
    toast(`${service.name} preview video removed.`);
    await loadProductImages();
  } catch (error) {
    videoMessage(card, error.message);
    button.disabled = false;
    button.textContent = 'Remove video';
    delete button.dataset.armed;
  }
}

function applyImageSearch() {
  const query = String(document.getElementById('image-search')?.value || '').trim().toLowerCase();
  state.imageSearch = query;
  document.querySelectorAll('[data-image-card]').forEach((card) => {
    card.hidden = Boolean(query) && !String(card.dataset.search || '').includes(query);
  });
  document.querySelectorAll('.image-admin-group').forEach((group) => {
    group.hidden = ![...group.querySelectorAll('[data-image-card]')].some((card) => !card.hidden);
  });
}

function updateCartLine(index) {
  const item = state.cart[index];
  const node = document.querySelector(`.cart-line[data-cart-index="${index}"]`);
  if (!item || !node) return;
  const problem = measurementProblem(item);
  const total = cartTotal(item);
  const lineTotal = node.querySelector('[data-cart-line-total]');
  if (lineTotal) lineTotal.textContent = total === null ? 'Check size' : peso(total);
  const area = node.querySelector('[data-cart-area]');
  if (area) {
    area.textContent = problem
      ? '—'
      : `${billableArea(item).toFixed(2).replace(/\.00$/, '')} sq ${item.dimension_unit === 'in' ? 'in' : 'ft'}`;
  }
  const billed = node.querySelector('[data-cart-billed]');
  if (billed) {
    const dimensions = billedDimensions(item);
    billed.textContent = problem
      ? ''
      : `Billed ${dimensions.width} × ${dimensions.height} ${item.dimension_unit === 'in' ? 'in' : 'ft'}`;
  }
  const error = node.querySelector('[data-cart-error]');
  if (error) {
    error.textContent = problem;
    error.classList.toggle('show', Boolean(problem));
  }
  node.querySelectorAll('[data-cart-width], [data-cart-height]').forEach((input) => {
    input.classList.toggle('invalid', Boolean(problem));
  });
  const totals = document.getElementById('cart-totals');
  if (totals) totals.innerHTML = cartTotalsTemplate();
  const submit = document.querySelector('#booking-form button[type="submit"]');
  if (submit) {
    submit.disabled =
      state.cart.length === 0 || !state.online || cartGaps().length > 0 || cartMeasurementProblems().length > 0;
  }
}

function categoryOptions(selected) {
  const categories = state.pricing?.categories || state.categories || [];
  return categories
    .map(
      (category) =>
        `<option value="${esc(category.name)}" ${category.name === selected ? 'selected' : ''}>${esc(category.name)}</option>`
    )
    .join('');
}

function availabilityOptions(selected) {
  const value = selected || 'unassigned';
  return AVAILABILITY_OPTIONS.map(
    (option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${option.label}</option>`
  ).join('');
}

/** One editable price-break row inside a product form. */
function tierRowEditor(row = {}) {
  return `
    <div class="price-tier-row" data-tier-row>
      <input class="input" type="number" min="1" step="1" value="${row.min ?? ''}" data-tier-min aria-label="Minimum quantity" placeholder="Min" />
      <span class="tiny muted">to</span>
      <input class="input" type="number" min="1" step="1" value="${row.max ?? ''}" data-tier-max aria-label="Maximum quantity" placeholder="∞" />
      <input class="input" type="number" min="0" step="0.01" value="${row.price ?? ''}" data-tier-price aria-label="Price per unit" placeholder="Price" />
      <input class="input" type="text" maxlength="80" value="${esc(row.label || '')}" data-tier-label aria-label="Price-break label" placeholder="Label" />
      <button class="btn btn-sm" type="button" data-remove-tier aria-label="Remove price break">×</button>
    </div>`;
}

function priceTierRows(service) {
  return (service.tiers || []).map((row) => tierRowEditor(row)).join('');
}

/** Shared fields for the edit card and the new-product form. */
function serviceEditorFields(service) {
  const value = (key, fallback = '') => (service[key] === null || service[key] === undefined ? fallback : service[key]);
  const checked = (key) => (service[key] === true ? 'checked' : '');
  return `
    <div class="price-field-grid">
      <label class="field"><span class="tiny muted">Product name</span><input class="input" data-field="name" maxlength="80" value="${esc(value('name'))}" required /></label>
      <label class="field"><span class="tiny muted">Category</span><select class="select" data-field="category">${categoryOptions(service.category)}</select></label>
    </div>
    <label class="field"><span class="tiny muted">Description</span><textarea class="textarea" data-field="description" maxlength="500" rows="2">${esc(value('description'))}</textarea></label>
    <div class="price-field-grid">
      <label class="field"><span class="tiny muted">Price (₱)</span><input class="input" type="number" min="0" step="0.01" data-field="price" value="${value('price')}" required /></label>
      <label class="field"><span class="tiny muted">Unit</span><input class="input" data-field="unit" maxlength="40" value="${esc(value('unit', 'per piece'))}" required /></label>
      <label class="field"><span class="tiny muted">Pricing type</span><select class="select" data-field="pricing_mode"><option value="fixed" ${value('pricing_mode', 'fixed') === 'fixed' ? 'selected' : ''}>Fixed</option><option value="area" ${value('pricing_mode') === 'area' ? 'selected' : ''}>Per area</option></select></label>
      <label class="field"><span class="tiny muted">Dimension unit</span><select class="select" data-field="dimension_unit"><option value="ft" ${value('dimension_unit', 'ft') === 'ft' ? 'selected' : ''}>Feet</option><option value="in" ${value('dimension_unit') === 'in' ? 'selected' : ''}>Inches</option></select></label>
      <label class="field"><span class="tiny muted">Minimum order qty</span><input class="input" type="number" min="1" step="1" data-field="min_qty" value="${value('min_qty')}" /></label>
      <label class="field"><span class="tiny muted">Minimum area</span><input class="input" type="number" min="0" step="0.01" data-field="min_area" value="${value('min_area')}" /></label>
      <label class="field"><span class="tiny muted">Minimum dimension (${value('dimension_unit', 'ft')})</span><input class="input" type="number" min="0.01" step="0.01" data-field="min_dimension" value="${value('min_dimension')}" /></label>
      <label class="field"><span class="tiny muted">Maximum dimension (${value('dimension_unit', 'ft')})</span><input class="input" type="number" min="0.01" step="0.01" data-field="max_dimension" value="${value('max_dimension')}" /></label>
      <label class="field"><span class="tiny muted">Additional charge (₱)</span><input class="input" type="number" min="0" step="0.01" data-field="base_fee" value="${value('base_fee', 0)}" /></label>
      <label class="field"><span class="tiny muted">Booking availability</span><select class="select" data-field="booking_availability">${availabilityOptions(service.booking_availability)}</select></label>
    </div>
    <div class="price-toggle-row">
      <label><input type="checkbox" data-field="active" ${service.active !== false ? 'checked' : ''} /> Active</label>
      <label><input type="checkbox" data-field="addon" ${checked('addon')} /> Add-on</label>
      <label><input type="checkbox" data-field="capacity" ${checked('capacity')} /> Uses capacity slot</label>
      <label><input type="checkbox" data-field="popular" ${checked('popular')} /> Popular</label>
      <label><input type="checkbox" data-field="needs_review" ${checked('needs_review')} /> Needs review</label>
      <label><input type="checkbox" data-field="round_dimensions_up" ${checked('round_dimensions_up')} /> Round measurements up</label>
      <label><input type="checkbox" data-field="catalog_visible" ${service.catalog_visible !== false ? 'checked' : ''} /> Visible in customer catalog</label>
    </div>
    <label class="field"><span class="tiny muted">Review note</span><input class="input" data-field="review_note" maxlength="300" value="${esc(value('review_note'))}" /></label>
    <div class="price-tier-editor">
      <div class="price-tier-head">
        <div><strong>Quantity price breaks</strong><span class="tiny muted">Optional. Leave empty for one fixed price.</span></div>
        <button class="btn btn-sm" type="button" data-add-tier>+ Add break</button>
      </div>
      <div class="price-tier-list" data-tier-list>${priceTierRows(service)}</div>
    </div>`;
}

function priceServiceForm(service) {
  return `
    <form class="price-edit" data-price-form data-id="${esc(service.id)}">
      <details ${service.needs_review ? 'open' : ''}>
        <summary class="price-edit-head">
          <div>
            <strong>${esc(service.name)}</strong>
            <span class="tiny muted">${esc(service.unit)}${service.min_qty ? ` · min ${service.min_qty}` : ''} · ${esc(AVAILABILITY_LABELS[service.booking_availability] || AVAILABILITY_LABELS.unassigned)}</span>
          </div>
          <span class="price-card-status">${
            service.active === false
              ? 'Disabled'
              : !service.image_url
                ? 'Image needed'
                : service.catalog_visible === false
                  ? 'Hidden'
                  : service.needs_review
                    ? 'Needs review'
                    : 'Active'
          }</span>
        </summary>
        <div class="price-edit-body">
          <div class="price-image-note ${service.image_url ? 'has-image' : ''}">
            <span class="price-image-thumb">${productImageMarkup(service)}</span>
            <div>
              <strong>${service.image_url ? 'Product image ready' : 'Image required before publishing'}</strong>
              <span>${service.image_url ? `Updated ${service.image_updated_at ? formatDateTime(service.image_updated_at) : 'by an administrator'}` : 'Upload a real photo or an accurate reference image in Product media.'}</span>
            </div>
            <button class="btn btn-sm" type="button" data-nav="images">Manage image</button>
          </div>
          ${serviceEditorFields(service)}
          <div class="price-edit-actions">
            <span class="tiny muted">Updated ${service.updated_at ? formatDateTime(service.updated_at) : '—'}</span>
            <button class="btn btn-sm" type="submit">Save product</button>
          </div>
          <p class="form-error" data-price-message role="alert"></p>
        </div>
      </details>
    </form>`;
}

function newServiceForm() {
  const blank = {
    name: '',
    category: state.pricing?.categories?.[0]?.name || '',
    description: '',
    price: '',
    unit: 'per piece',
    pricing_mode: 'fixed',
    min_area: null,
    min_qty: null,
    tiers: [],
    base_fee: 0,
    dimension_unit: 'ft',
    round_dimensions_up: false,
    min_dimension: null,
    max_dimension: null,
    catalog_visible: false,
    booking_availability: 'unassigned',
    active: true,
    addon: false,
    capacity: false,
    popular: false,
    needs_review: false,
    review_note: '',
  };
  return `
    <form id="new-service-form" class="price-edit price-new" novalidate>
      ${serviceEditorFields(blank)}
      <div class="price-edit-actions">
        <span class="tiny muted">New products are saved to the database immediately.</span>
        <button class="btn btn-primary" type="submit">Create product</button>
      </div>
      <p class="form-error" data-new-service-message role="alert"></p>
    </form>`;
}

/**
 * The owner's product and price console. Every row is editable in place; the
 * client-specific rates stay read-only here and never enter a booking total.
 */
function renderAdminPricing() {
  if (state.pricingError) {
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.payments}</div>
        <h3>The price list could not load</h3>
        <p>${esc(state.pricingError)}</p>
        <div class="no-results-actions"><button class="btn btn-primary" type="button" data-pricing-retry>Try again</button></div>
      </div>`;
    return;
  }
  if (!state.pricing) {
    viewRoot.innerHTML = '<div class="view-skeleton" role="status" aria-live="polite">Loading the studio price list…</div>';
    return;
  }
  const data = state.pricing;
  const services = data.services || [];
  const activeServices = services.filter((service) => service.active !== false);
  const missingImages = services.filter((service) => !service.image_url).length;
  const clients = data.client_prices || [];
  const flagged = services.filter((service) => service.needs_review);
  const openIds = new Set(flagged.map((service) => service.id));
  const reviews = (data.reviews || []).filter((review) => !review.service_id || openIds.has(review.service_id));
  const counts = { pickup: 0, event: 0, both: 0, unassigned: 0 };
  services.filter((service) => service.active !== false).forEach((service) => {
    const availability = service.booking_availability || 'unassigned';
    counts[availability] = (counts[availability] || 0) + 1;
  });

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Products, prices, and availability</h2><p>Changes here are read by the catalog, booking form, assistant, checkout, and rate card. Existing bookings keep the price they were booked at.</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" type="button" data-new-service>${state.newProductOpen ? 'Close form' : '+ Add product'}</button>
        <button class="btn" type="button" data-nav="images">Product media${missingImages ? ` · ${missingImages} needed` : ''}</button>
        <a class="btn" href="/shop#catalog" target="_blank" rel="noopener">View public rate card</a>
      </div>
    </div>
    <div class="stats-strip">
      <div class="stat-cell"><span>All products</span><strong>${services.length}</strong><small>${activeServices.length} active · ${missingImages} image needed</small></div>
      <div class="stat-cell"><span>Pickup</span><strong>${counts.pickup + counts.both}</strong><small>${counts.pickup} pickup-only · ${counts.both} both</small></div>
      <div class="stat-cell"><span>Event booking</span><strong>${counts.event + counts.both}</strong><small>${counts.event} event-only · ${counts.both} both</small></div>
      <div class="stat-cell"><span>Unassigned</span><strong class="${counts.unassigned ? 'rose' : ''}">${counts.unassigned}</strong><small>Hidden until configured</small></div>
      <div class="stat-cell"><span>Client rates</span><strong>${clients.length}</strong><small>Admin only</small></div>
    </div>

    ${
      state.newProductOpen
        ? `<div class="panel" style="margin-bottom:20px">
            <div class="panel-head"><div><h3>Add a product or service</h3><p>It is saved to the database immediately. A duplicate name is refused.</p></div></div>
            ${newServiceForm()}
          </div>`
        : ''
    }

    <div class="panel">
      <div class="panel-head"><div><h3>Needs owner confirmation</h3><p>Conflicting workbook values, ranges, and services not on the 2026 sheet. Each row shows what the system applied.</p></div></div>
      ${
        reviews.length
          ? `<div class="review-list">${reviews
              .map(
                (review) => `
                <div class="review-row">
                  <div><strong>${esc(review.product)}</strong><span>${esc(review.issue)}</span></div>
                  <span class="tiny">Applied: ${esc(review.applied)}</span>
                </div>`
              )
              .join('')}</div>`
          : '<div class="table-empty">Nothing is waiting for confirmation.</div>'
      }
      <p class="tiny muted">Uncheck “Needs review” on a product once you have confirmed its price. Existing bookings keep their recorded price.</p>
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><div><h3>All products and services</h3><p>Open a product to edit its name, category, price, unit, minimum, price breaks, additional charge, availability, or status.</p></div><span class="tiny muted">${plural(services.length, 'product')}</span></div>
      ${(data.categories || [])
        .map((category) => {
          const items = services.filter((service) => service.category === category.name);
          if (!items.length) return '';
          return `<section class="pricing-group">
            <div class="catalog-group-head"><h3>${esc(category.name)}</h3><p>${esc(category.note)}</p><span class="tiny muted">${plural(items.length, 'product')}</span></div>
            <div class="price-edit-grid">${items.map(priceServiceForm).join('')}</div>
          </section>`;
        })
        .join('')}
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><div><h3>${esc(data.client_category?.name || 'Special Client Pricing')}</h3><p>${esc(data.client_category?.note || '')}</p></div><span class="tiny muted">${plural(clients.length, 'client rate')}</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Client</th><th>Rate</th><th>Unit</th></tr></thead>
        <tbody>${clients
          .map(
            (row) => `<tr><td><span class="cell-main">${esc(row.client)}</span></td><td><span class="cell-money">${peso(row.price)}</span></td><td>${esc(row.unit)}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>
      <div class="table-foot"><span>Client rates never overwrite retail prices.</span><span>Admin only</span></div>
    </div>`;
}

/** Reads every editable product field, including the optional price breaks. */
function serviceFormPayload(form) {
  const read = (name) => form.querySelector(`[data-field="${name}"]`);
  const numberOrNull = (name) => {
    const field = read(name);
    if (!field || field.value.trim() === '') return null;
    return Number(field.value);
  };
  const tiers = [...form.querySelectorAll('[data-tier-row]')]
    .map((row) => {
      const minText = row.querySelector('[data-tier-min]')?.value.trim() || '';
      const maxText = row.querySelector('[data-tier-max]')?.value.trim() || '';
      const priceText = row.querySelector('[data-tier-price]')?.value.trim() || '';
      const label = row.querySelector('[data-tier-label]')?.value.trim() || '';
      if (!minText && !priceText && !label) return null;
      return {
        min: Number(minText),
        max: maxText === '' ? null : Number(maxText),
        price: Number(priceText),
        label,
      };
    })
    .filter(Boolean);
  return {
    name: read('name')?.value.trim() || '',
    category: read('category')?.value || '',
    description: read('description')?.value.trim() || '',
    price: Number(read('price')?.value || 0),
    unit: read('unit')?.value.trim() || '',
    pricing_mode: read('pricing_mode')?.value || 'fixed',
    min_area: numberOrNull('min_area'),
    min_qty: numberOrNull('min_qty'),
    tiers,
    base_fee: Number(read('base_fee')?.value || 0),
    dimension_unit: read('dimension_unit')?.value || 'ft',
    round_dimensions_up: Boolean(read('round_dimensions_up')?.checked),
    min_dimension: numberOrNull('min_dimension'),
    max_dimension: numberOrNull('max_dimension'),
    catalog_visible: Boolean(read('catalog_visible')?.checked),
    booking_availability: read('booking_availability')?.value || 'unassigned',
    active: Boolean(read('active')?.checked),
    addon: Boolean(read('addon')?.checked),
    capacity: Boolean(read('capacity')?.checked),
    popular: Boolean(read('popular')?.checked),
    needs_review: Boolean(read('needs_review')?.checked),
    review_note: read('review_note')?.value.trim() || '',
  };
}

function replaceServiceInState(service) {
  if (state.pricing) {
    const exists = state.pricing.services.some((row) => row.id === service.id);
    state.pricing.services = exists
      ? state.pricing.services.map((row) => (row.id === service.id ? service : row))
      : [...state.pricing.services, service];
    state.pricing.services.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }
  // `state.services` mirrors the public catalog. A hidden or inactive product
  // remains available in the image/pricing consoles but drops out of this list.
  const publiclyVisible = service.active !== false && service.catalog_visible !== false;
  const exists = state.services.some((row) => row.id === service.id);
  if (publiclyVisible) {
    state.services = exists
      ? state.services.map((row) => (row.id === service.id ? service : row))
      : [...state.services, service];
  } else {
    state.services = state.services.filter((row) => row.id !== service.id);
  }
  state.services.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (state.images) {
    const imageExists = state.images.services.some((row) => row.id === service.id);
    state.images.services = imageExists
      ? state.images.services.map((row) => (row.id === service.id ? service : row))
      : [...state.images.services, service];
  }
}

/** Saves one existing product; the server re-validates every field. */
async function saveServicePrice(form) {
  const id = form.dataset.id;
  const button = form.querySelector('button[type="submit"]');
  const message = form.querySelector('[data-price-message]');
  message.textContent = '';
  message.classList.remove('show');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { service } = await api(`/api/services/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(serviceFormPayload(form)),
    });
    replaceServiceInState(service);
    toast(`${service.name} updated.`);
    renderView();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('show');
    button.disabled = false;
    button.textContent = 'Save product';
  }
}

async function saveNewService(form) {
  const button = form.querySelector('button[type="submit"]');
  const message = form.querySelector('[data-new-service-message]');
  message.textContent = '';
  message.classList.remove('show');
  button.disabled = true;
  button.textContent = 'Creating…';
  try {
    const { service } = await api('/api/services', {
      method: 'POST',
      body: JSON.stringify(serviceFormPayload(form)),
    });
    replaceServiceInState(service);
    state.newProductOpen = false;
    toast(`${service.name} created. Upload its product image before it appears in the customer catalog.`);
    renderView();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('show');
    button.disabled = false;
    button.textContent = 'Create product';
  }
}

const REPORT_SECTIONS = [
  { key: 'summary', label: 'Summary', note: 'Headline numbers', icon: 'reports' },
  { key: 'trends', label: 'Trends', note: 'Real-data graphs', icon: 'reports' },
  { key: 'logistics', label: 'Logistics', note: 'Deployments and schedules', icon: 'inventory' },
  { key: 'services', label: 'Services', note: 'Units and value', icon: 'bookings' },
  { key: 'payments', label: 'Payment mix', note: 'Amounts recorded', icon: 'payments' },
  { key: 'status', label: 'Status mix', note: 'Booking statuses', icon: 'check' },
  { key: 'workload', label: 'Crew workload', note: 'Active and done', icon: 'staff' },
  { key: 'bookings', label: 'Bookings', note: 'Created in period', icon: 'calendar' },
  { key: 'cancellations', label: 'Cancellations', note: 'Reasons and filters', icon: 'spark' },
];

function reportTrendChart(report) {
  const trend = report.trend || [];
  if (!trend.length) return '<p class="tiny muted">No weeks in this period.</p>';
  const width = 860;
  const height = 260;
  const left = 54;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const maxRevenue = Math.max(1, ...trend.map((row) => Number(row.revenue) || 0));
  const maxBookings = Math.max(1, ...trend.map((row) => Number(row.bookings) || 0));
  const slot = plotW / trend.length;
  const barW = Math.max(3, Math.min(22, slot * 0.34));
  const labelEvery = Math.max(1, Math.ceil(trend.length / 9));
  const bookingLine = trend
    .map((row, index) => {
      const x = left + index * slot + slot / 2;
      const y = top + plotH - (Number(row.bookings) / maxBookings) * plotH * 0.72;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `
    <div class="analytics-chart">
      <div class="analytics-chart-legend">
        <span><i class="chart-key chart-key-revenue"></i> Payments recorded</span>
        <span><i class="chart-key chart-key-bookings"></i> Bookings created</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly payments and bookings from live records">
        ${[0, 0.25, 0.5, 0.75, 1]
          .map((step) => {
            const y = top + plotH - step * plotH;
            return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline" />`;
          })
          .join('')}
        ${trend
          .map((row, index) => {
            const x = left + index * slot + slot / 2 - barW / 2;
            const barH = (Number(row.revenue) / maxRevenue) * plotH;
            const label =
              index % labelEvery === 0 || index === trend.length - 1
                ? `<text x="${x + barW / 2}" y="${height - 15}" text-anchor="middle" class="chart-label">${esc(
                    row.week_start.slice(5)
                  )}</text>`
                : '';
            return `<rect x="${x}" y="${top + plotH - barH}" width="${barW}" height="${barH}" rx="3" class="chart-revenue-bar"><title>${esc(
              row.week_start
            )}: ${peso(row.revenue)} · ${plural(row.bookings, 'booking')}</title></rect>${label}`;
          })
          .join('')}
        <polyline points="${bookingLine}" class="chart-bookings-line" />
        ${trend
          .map((row, index) => {
            const x = left + index * slot + slot / 2;
            const y = top + plotH - (Number(row.bookings) / maxBookings) * plotH * 0.72;
            return `<circle cx="${x}" cy="${y}" r="2.8" class="chart-bookings-dot"><title>${esc(
              row.week_start
            )}: ${plural(row.bookings, 'booking')}</title></circle>`;
          })
          .join('')}
      </svg>
      <div class="analytics-chart-foot"><span>Week starting</span><span>Peak week ${peso(maxRevenue)}</span></div>
    </div>`;
}

function reportTrendSection(report) {
  const logistics = report.logistics || {};
  const branches = report.by_branch || [];
  return `
    <div class="report-summary">
      <div class="report-stat"><span>Payments in period</span><strong>${peso(report.summary.revenue_collected)}</strong></div>
      <div class="report-stat"><span>Average booking</span><strong>${peso(report.summary.average_booking)}</strong></div>
      <div class="report-stat"><span>Events scheduled</span><strong>${logistics.events_in_period || 0}</strong></div>
      <div class="report-stat"><span>Assigned deployments</span><strong>${logistics.assigned || 0}</strong></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h3>Real-data trend</h3><p>Payments and bookings by week, built from live records</p></div></div>
      <div class="panel-body">${reportTrendChart(report)}</div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-head"><div><h3>Branch performance</h3><p>Bookings created in this period and their value</p></div></div>
      <div class="panel-body">
        ${branches.length ? `<table class="report-table"><thead><tr><th>Branch</th><th>Bookings</th><th>Completed</th><th>Value</th></tr></thead><tbody>${branches
          .map(
            (row) => `<tr><td>${esc(row.name)}</td><td>${row.bookings}</td><td>${row.completed}</td><td class="money">${peso(row.value)}</td></tr>`
          )
          .join('')}</tbody></table>` : '<p class="tiny muted">No bookings were created in this period.</p>'}
      </div>
    </div>`;
}

function reportLogisticsSection(report) {
  const stats = report.logistics || {};
  const max = Math.max(1, ...(report.by_deployment || []).map((row) => row.count));
  const scheduled = (report.created_bookings || []).filter(
    (row) => row.setup_date || row.pickup_schedule_date || (row.assigned_units || []).length
  );
  return `
    <div class="report-summary">
      <div class="report-stat"><span>Events in period</span><strong>${stats.events_in_period || 0}</strong></div>
      <div class="report-stat"><span>With assigned units</span><strong>${stats.assigned || 0}</strong></div>
      <div class="report-stat"><span>Unassigned deployments</span><strong>${stats.unassigned || 0}</strong></div>
      <div class="report-stat"><span>Setup / pickup scheduled</span><strong>${stats.setups || 0} / ${stats.pickups || 0}</strong></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h3>Deployment pipeline</h3><p>Events in the report period by physical deployment status</p></div></div>
      <div class="panel-body">${reportBars(
        report.by_deployment || [],
        'count',
        'label',
        max
      )}</div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-head"><div><h3>Setups, pickups, and units</h3><p>Bookings created in the period with logistics recorded</p></div><span class="tiny muted">${plural(scheduled.length, 'record')}</span></div>
      ${scheduled.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Reference</th><th>Event</th><th>Deployment</th><th>Assigned units</th><th>Setup</th><th>Pickup</th></tr></thead><tbody>${scheduled
            .map(
              (row) => `<tr><td><span class="cell-main">${esc(row.ref)}</span><span class="cell-sub">${esc(row.branch)}</span></td><td>${formatDate(row.event_date, 'short')}</td><td>${deploymentBadge(row.deployment_status)}</td><td>${(row.assigned_units || []).length ? esc(row.assigned_units.join(', ')) : '—'}</td><td>${row.setup_date ? `${formatDate(row.setup_date, 'short')} ${esc(row.setup_time || '')}` : '—'}</td><td>${row.pickup_schedule_date ? `${formatDate(row.pickup_schedule_date, 'short')} ${esc(row.pickup_schedule_time || '')}` : '—'}</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="table-empty">No assigned units or setup/pickup schedules in this period yet.</div>'}
    </div>`;
}

function reportControlsTemplate(report) {
  return `
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
      <div class="form-error ${state.reportError ? 'show' : ''}" role="alert" style="flex-basis:100%">
        ${esc(state.reportError)}
        ${state.reportError ? '<button class="btn btn-sm" type="button" data-report-retry>Try again</button>' : ''}
      </div>
    </form>`;
}

function reportSectionHtml(key, report, statusMax, methodMax) {
  if (!report) return '';

  if (key === 'trends') return reportTrendSection(report);
  if (key === 'logistics') return reportLogisticsSection(report);

  if (key === 'summary') {
    return `
      <div class="report-summary">
        <div class="report-stat"><span>Bookings created</span><strong>${report.summary.bookings}</strong></div>
        <div class="report-stat"><span>Completed</span><strong>${report.summary.completed}</strong></div>
        <div class="report-stat"><span>Payments recorded</span><strong>${peso(report.summary.revenue_collected)}</strong></div>
        <div class="report-stat"><span>Outstanding balance</span><strong>${peso(report.summary.outstanding)}</strong></div>
      </div>`;
  }

  if (key === 'services') {
    return `
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
      </div>`;
  }

  if (key === 'payments') {
    return `
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
      </div>`;
  }

  if (key === 'status') {
    return `
      <div class="panel">
        <div class="panel-head"><div><h3>Status mix</h3><p>Studio-wide booking statuses</p></div></div>
        <div class="panel-body">
          ${reportBars(report.by_status, 'count', 'status', statusMax)}
        </div>
      </div>`;
  }

  if (key === 'workload') {
    return `
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
      </div>`;
  }

  if (key === 'bookings') {
    return `
      <div class="panel">
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
      </div>`;
  }

  return '';
}

function exportReportPng() {
  const report = state.report;
  if (!report) {
    toast('Generate a report before exporting it.', 'warning');
    return;
  }
  const canvas = document.createElement('canvas');
  const width = 1400;
  const height = 1000;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    toast('PNG export is not available in this browser.', 'error');
    return;
  }
  ctx.fillStyle = '#fff8f4';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#c72b5c';
  ctx.font = '700 20px Georgia, serif';
  ctx.fillText('PRECIOUS MOMENTS', 60, 66);
  ctx.fillStyle = '#2a1420';
  ctx.font = '400 34px Georgia, serif';
  ctx.fillText('Operational report', 60, 112);
  ctx.fillStyle = '#725e68';
  ctx.font = '400 15px Arial, sans-serif';
  ctx.fillText(`${report.period.from} to ${report.period.to} · generated from live records`, 60, 140);

  const cards = [
    ['Bookings', report.summary.bookings],
    ['Completed', report.summary.completed],
    ['Payments', peso(report.summary.revenue_collected)],
    ['Outstanding', peso(report.summary.outstanding)],
  ];
  cards.forEach(([label, value], index) => {
    const x = 60 + index * 325;
    ctx.fillStyle = '#f8e9ee';
    ctx.fillRect(x, 175, 295, 92);
    ctx.fillStyle = '#725e68';
    ctx.font = '700 12px Arial, sans-serif';
    ctx.fillText(String(label).toUpperCase(), x + 18, 198);
    ctx.fillStyle = '#2a1420';
    ctx.font = '400 26px Georgia, serif';
    ctx.fillText(String(value), x + 18, 242);
  });

  ctx.fillStyle = '#2a1420';
  ctx.font = '700 18px Georgia, serif';
  ctx.fillText('Payments and bookings by week', 60, 320);
  const trend = report.trend || [];
  const chartX = 60;
  const chartY = 345;
  const chartW = 1280;
  const chartH = 245;
  ctx.fillStyle = '#fbf2f4';
  ctx.fillRect(chartX, chartY, chartW, chartH);
  const maxRevenue = Math.max(1, ...trend.map((row) => Number(row.revenue) || 0));
  const maxBookings = Math.max(1, ...trend.map((row) => Number(row.bookings) || 0));
  const slot = trend.length ? chartW / trend.length : chartW;
  trend.forEach((row, index) => {
    const x = chartX + index * slot + Math.max(2, slot * 0.15);
    const barWidth = Math.max(3, slot * 0.55);
    const revenueHeight = (Number(row.revenue) / maxRevenue) * (chartH - 50);
    const bookingHeight = (Number(row.bookings) / maxBookings) * (chartH - 50);
    ctx.fillStyle = '#c72b5c';
    ctx.fillRect(x, chartY + chartH - 25 - revenueHeight, barWidth / 2, revenueHeight);
    ctx.fillStyle = '#e3a8ba';
    ctx.fillRect(x + barWidth / 2 + 1, chartY + chartH - 25 - bookingHeight, barWidth / 2, bookingHeight);
    if (index % Math.max(1, Math.ceil(trend.length / 10)) === 0 || index === trend.length - 1) {
      ctx.fillStyle = '#725e68';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText(row.week_start.slice(5), x, chartY + chartH - 7);
    }
  });
  ctx.fillStyle = '#725e68';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('Payments (rose) and bookings (blush) per week', chartX + 16, chartY + 24);

  const logistics = report.logistics || {};
  const sections = [
    ['LOGISTICS', `${logistics.events_in_period || 0} events · ${logistics.assigned || 0} with units · ${logistics.unassigned || 0} unassigned`],
    ['SCHEDULE', `${logistics.setups || 0} setups · ${logistics.pickups || 0} pickups · ${logistics.units_committed || 0} units committed`],
    ['DEPLOYMENT MIX', (report.by_deployment || []).map((row) => `${row.label}: ${row.count}`).join(' · ')],
    ['BRANCHES', (report.by_branch || []).map((row) => `${row.name}: ${row.bookings} bookings`).join(' · ')],
  ];
  sections.forEach(([label, value], index) => {
    const y = 660 + index * 62;
    ctx.fillStyle = '#725e68';
    ctx.font = '700 12px Arial, sans-serif';
    ctx.fillText(label, 60, y);
    ctx.fillStyle = '#2a1420';
    ctx.font = '400 16px Arial, sans-serif';
    const clipped = String(value);
    ctx.fillText(clipped.length > 115 ? `${clipped.slice(0, 112)}…` : clipped, 60, y + 24);
  });
  ctx.strokeStyle = '#ead8de';
  ctx.beginPath();
  ctx.moveTo(60, 930);
  ctx.lineTo(1340, 930);
  ctx.stroke();
  ctx.fillStyle = '#9b858f';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('Precious Moments · CSV, PDF, and PNG exports all use this same live report.', 60, 958);

  canvas.toBlob((blob) => {
    if (!blob) {
      toast('Could not create the PNG export.', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `precious-moments-${report.period.from}-to-${report.period.to}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

function renderReports() {
  const csvHref = `/api/reports.csv?from=${encodeURIComponent(state.reportFrom)}&to=${encodeURIComponent(state.reportTo)}`;
  const pdfHref = `/api/reports.pdf?from=${encodeURIComponent(state.reportFrom)}&to=${encodeURIComponent(state.reportTo)}`;
  const report = state.report;
  const statusMax = report ? Math.max(1, ...report.by_status.map((item) => item.count)) : 1;
  const methodMax = report ? Math.max(1, ...report.by_method.map((item) => item.amount)) : 1;
  const active = REPORT_SECTIONS.some((section) => section.key === state.reportSection)
    ? state.reportSection
    : 'summary';

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Operational reports</h2><p>Generated from the live booking and payment records. Pick a period, then export it for your files.</p></div>
      <div class="page-actions">
        <div class="report-section-picker">
          <label for="report-section">Report section</label>
          <select class="select" id="report-section">
            ${REPORT_SECTIONS.map(
              (section) => `<option value="${section.key}" ${active === section.key ? 'selected' : ''}>${esc(section.label)}</option>`
            ).join('')}
          </select>
        </div>
        <button class="btn" type="button" data-export-png ${state.report ? '' : 'disabled'}>${ICONS.download} PNG</button>
        <a class="btn ${state.report ? '' : 'is-disabled'}" href="${esc(pdfHref)}" ${state.report ? '' : 'aria-disabled="true" tabindex="-1"'}>${ICONS.download} PDF</a>
        <a class="btn" href="${esc(csvHref)}" download>${ICONS.download} CSV</a>
      </div>
    </div>
    <section class="report-content" aria-label="Report content">
      <div class="panel">
        ${reportControlsTemplate(report)}
        ${
          state.reportLoading && !report
            ? reportSkeleton()
            : report && active !== 'cancellations'
              ? `<div class="report-generated">${reportSectionHtml(active, report, statusMax, methodMax)}</div>`
              : !report && active !== 'cancellations'
                ? `<div class="empty-state">
                    <div class="empty-state-icon">${ICONS.reports}</div>
                    <h3>Choose a period</h3>
                    <p>Generate a report to see bookings, payments, and crew workload for the dates you choose.</p>
                  </div>`
                : ''
        }
      </div>
      ${active === 'cancellations' ? cancellationsPanelTemplate() : ''}
    </section>`;
}


/* ---------- Cancellation reporting ---------- */

function cancellationsPanelTemplate() {
  const data = state.cancellations;
  return `
    <div class="panel" style="margin-top:20px" data-cancellations-panel>
      <div class="panel-head">
        <div><h3>Cancellations</h3><p>Why bookings were cancelled between ${formatDate(state.reportFrom, 'short')} and ${formatDate(state.reportTo, 'short')}.</p></div>
        <div class="page-actions"><button class="btn btn-sm" type="button" data-cancellations-load>${data ? 'Refresh' : 'Load cancellations'}</button></div>
      </div>
      <div class="panel-body" data-cancellations-body>
        ${data ? cancellationReportBody(data) : '<p class="tiny muted">Load the cancellation log for the same period as the report above.</p>'}
      </div>
    </div>`;
}

function cancellationReportBody(data) {
  const { summary, cancellations, scope } = data;
  const topReasons = (summary.by_reason || []).slice(0, 5);
  return `
    <div class="report-summary" style="margin-bottom:16px">
      <div class="report-stat"><span>Cancellations</span><strong>${summary.total}</strong></div>
      <div class="report-stat"><span>Customer-initiated</span><strong>${summary.customer_initiated}</strong></div>
      <div class="report-stat"><span>Branch-initiated</span><strong>${summary.branch_initiated}</strong></div>
      <div class="report-stat"><span>Most common reason</span><strong style="font-size:.8rem">${esc(topReasons[0]?.label || '—')}</strong></div>
    </div>
    <form class="report-controls" data-cancellation-filters>
      ${
        scope.branches.length
          ? `<div class="field"><label for="cancel-branch">Branch</label><select class="select" id="cancel-branch" name="branch"><option value="">All branches</option>${scope.branches
              .map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`)
              .join('')}</select></div>`
          : ''
      }
      <div class="field"><label for="cancel-reason-filter">Reason</label><select class="select" id="cancel-reason-filter" name="reason"><option value="">All reasons</option>${scope.reasons
        .map((reason) => `<option value="${esc(reason.code)}">${esc(reason.label)}</option>`)
        .join('')}</select></div>
      <div class="field"><label for="cancel-by">Initiated by</label><select class="select" id="cancel-by" name="by"><option value="">Anyone</option><option value="customer">Customer</option><option value="branch">Branch</option></select></div>
      <button class="btn" type="button" data-cancellations-load>Apply filters</button>
    </form>
    ${
      cancellations.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Reference</th><th>Customer</th><th>Branch</th><th>Reason</th><th>Initiated by</th><th>Cancelled</th></tr></thead>
            <tbody>${cancellations
              .map(
                (row) => `<tr>
                  <td><span class="cell-main">${esc(row.booking_ref)}</span></td>
                  <td>${esc(row.customer_name)}</td>
                  <td>${esc(row.branch_name)}</td>
                  <td>${esc(row.reason_label)}${
                    row.details ? `<br><span class="tiny muted">${esc(row.details)}</span>` : ''
                  }</td>
                  <td>${row.cancelled_by_role === 'customer' ? 'Customer' : 'Branch'} · ${esc(row.cancelled_by_name)}</td>
                  <td>${formatDateTime(row.created_at)}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : '<div class="table-empty">No cancellations match these filters.</div>'
    }
    ${
      topReasons.length > 1
        ? `<h4 style="margin-top:18px;font-size:.8rem">Most common reasons</h4>
           <div class="bar-list">${topReasons
             .map(
               (reason) => `<div class="bar-item"><span>${esc(reason.label)}</span><div class="bar-track"><i style="width:${Math.round(
                 (reason.count / Math.max(1, summary.total)) * 100
               )}%"></i></div><strong>${reason.count}</strong></div>`
             )
             .join('')}</div>`
        : ''
    }`;
}

async function loadCancellations() {
  const panel = document.querySelector('[data-cancellations-panel]');
  const filters = panel?.querySelector('[data-cancellation-filters]');
  const params = new URLSearchParams({ from: state.reportFrom, to: state.reportTo });
  if (filters) {
    const data = new FormData(filters);
    if (data.get('branch')) params.set('branch', data.get('branch'));
    if (data.get('reason')) params.set('reason', data.get('reason'));
    if (data.get('by')) params.set('by', data.get('by'));
  }
  const button = panel?.querySelector('[data-cancellations-load]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading…';
  }
  try {
    state.cancellations = await api(`/api/cancellations?${params.toString()}`);
    renderView();
  } catch (error) {
    toast(error.message, 'error');
    if (button) {
      button.disabled = false;
      button.textContent = 'Load cancellations';
    }
  }
}

/* ---------- Drawer ---------- */

/* ---------- Drawer and modal templates ---------- */

/** One stored file. Images preview inline; PDFs and design sources open. */
function designFileRow(file, booking) {
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mime);
  const canDelete =
    state.user.role === 'admin' ||
    state.user.role === 'branch_admin' ||
    (state.user.role === 'customer' && booking?.status === 'pending');
  return `
    <div class="design-file" data-design-file="${esc(file.id)}">
      ${
        isImage
          ? `<img src="${file.url}" alt="${esc(file.name)}" loading="lazy" />`
          : `<span class="design-file-icon">${esc(String(file.extension || 'file').toUpperCase())}</span>`
      }
      <div class="design-file-meta">
        <strong>${esc(file.name)}<span class="design-kind-badge">${file.kind === 'final' ? 'Final design' : 'Reference'}</span></strong>
        <small>${formatBytes(file.bytes)} · ${formatDateTime(file.created_at)}${file.uploaded_by?.name ? ` · ${esc(file.uploaded_by.name)}` : ''}</small>
      </div>
      <div class="design-file-actions">
        ${isImage ? '' : `<a class="btn btn-sm" href="${file.url}" target="_blank" rel="noopener">Open</a>`}
        <a class="btn btn-sm" href="${file.url}?download=1">Download</a>
        ${
          canDelete
            ? `<button class="btn btn-sm btn-danger" type="button" data-design-delete="${esc(file.id)}" data-booking="${esc(file.booking_id || booking?.id || '')}">Remove</button>`
            : ''
        }
      </div>
    </div>`;
}

/** Fills the drawer's file list after the booking detail is already on screen. */
async function loadDesignFiles(bookingId) {
  const box = drawerRoot.querySelector(`[data-design-files-list="${bookingId}"]`);
  if (!box) return;
  try {
    const { files } = await api(`/api/bookings/${encodeURIComponent(bookingId)}/files`);
    const booking = state.activeBooking;
    box.innerHTML = files.length
      ? files.map((file) => designFileRow({ ...file, booking_id: bookingId }, booking)).join('')
      : '<p class="design-empty">No design or reference files yet.</p>';
  } catch (error) {
    box.innerHTML = `<p class="design-empty">${esc(error.message)}</p>`;
  }
}

function drawerItemsTemplate(booking) {
  return (booking.items || [])
    .map(
      (item) => {
        const unit = item.dimension_unit === 'in' ? 'in' : 'ft';
        const billed =
          item.pricing_mode === 'area' &&
          item.billed_width_ft !== undefined &&
          (Number(item.billed_width_ft) !== Number(item.width_ft) ||
            Number(item.billed_height_ft) !== Number(item.height_ft))
            ? ` · billed ${Number(item.billed_width_ft)} × ${Number(item.billed_height_ft)} ${unit}`
            : '';
        return `
      <div class="drawer-item">
        <span>${esc(item.name)}<small>${
          item.pricing_mode === 'area'
            ? `${Number(item.width_ft)} × ${Number(item.height_ft)} ${unit}${billed} · ${Number(item.area_sqft)} sq ${unit} · ${peso(item.unit_price)} / sq ${unit}${item.base_fee ? ` + ${peso(item.base_fee)} setup` : ''}`
            : `${item.qty} × ${peso(item.unit_price)}${item.tier_label ? ` (${esc(item.tier_label)})` : ''} · ${esc(item.unit)}`
        }</small></span>
        <strong>${peso(item.line_total)}</strong>
      </div>`;
      }
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
  const adminLike = isAdminRole(role);
  const due = Math.max(0, Number(booking.total) - Number(booking.amount_paid || 0));
  const paidPercent = booking.total ? Math.min(100, Math.round((Number(booking.amount_paid || 0) / Number(booking.total)) * 100)) : 0;
  const showContact = role !== 'customer';
  const methods = PAYMENT_METHODS.includes(booking.payment_method)
    ? PAYMENT_METHODS
    : [...PAYMENT_METHODS, booking.payment_method].filter(Boolean);
  const staffOptions = [
    ['', 'Unassigned'],
    ...state.staff
      .filter((member) => !booking.branch_id || member.branch_id === booking.branch_id)
      .map((member) => [member.id, `${member.name}${member.id === booking.staff_id ? ' (assigned)' : ''}`]),
  ];
  const canStaffUpdate =
    role === 'staff' && booking.staff_id === state.user.id && !['completed', 'cancelled'].includes(booking.status);
  const staffStatuses =
    booking.status === 'confirmed'
      ? [['in_progress', 'In progress']]
      : booking.status === 'in_progress'
        ? [['ready', 'Ready'], ['completed', 'Completed']]
        : booking.status === 'ready'
          ? [['completed', 'Completed']]
          : [];
  const contact = booking.customer || {};
  const itemBoothType = (item) =>
    BOOTH_UNIT_POOL[item.booth_type] ? item.booth_type : BOOTH_TYPE_BY_SERVICE[item.service_id];
  const logisticsTypes = [
    ...new Set((booking.items || []).map(itemBoothType).filter((type) => BOOTH_UNIT_POOL[type])),
  ];
  const unitSelections = booking.assigned_units || [];
  const unitGroups = logisticsTypes
    .map(
      (type) => `<div class="logistics-unit-group"><span>${esc(BOOTH_UNIT_POOL[type].label)}</span><div class="logistics-unit-options">${BOOTH_UNIT_POOL[type].units
        .map(
          (unit) => `<label class="logistics-unit ${unitSelections.includes(unit) ? 'is-selected' : ''}"><input type="checkbox" name="assigned_units" value="${esc(unit)}" ${unitSelections.includes(unit) ? 'checked' : ''} /><span>${esc(unit)}</span></label>`
        )
        .join('')}</div></div>`
    )
    .join('');
  const requiredUnits = logisticsTypes.map((type) => {
    const count = (booking.items || [])
      .filter((item) => itemBoothType(item) === type)
      .reduce((sum, item) => sum + Math.max(1, Number(item.qty) || 1), 0);
    return `${count} ${BOOTH_UNIT_POOL[type].label.toLowerCase()}`;
  });

  return `
    <div class="drawer-overlay">
      <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header class="drawer-head">
          <div>
            <h2 id="drawer-title">${esc(booking.ref)}</h2>
            <p>${booking.booking_type === 'pickup' ? 'Pickup' : 'Event'} · ${formatDate(booking.event_date, 'weekday')} · ${esc(formatTime(booking.event_time) || 'Time to confirm')} · ${peso(booking.total)}</p>
            <div>${statusBadge(booking.status)} ${statusBadge(booking.payment_status)}${
              role === 'customer' ? '' : ` ${deploymentBadge(booking.deployment_status)}`
            }</div>
          </div>
          <button class="drawer-close" type="button" data-drawer-close aria-label="Close booking details">${ICONS.close}</button>
        </header>
        <div class="drawer-body">
          <section class="drawer-section">
            <h3>${booking.booking_type === 'pickup' ? 'Pickup details' : 'The event'}</h3>
            <div class="detail-grid">
              <div><span>${booking.booking_type === 'pickup' ? 'Pickup date' : 'Event date'}</span><strong>${formatDate(booking.event_date)}</strong></div>
              <div><span>${booking.booking_type === 'pickup' ? 'Pickup time' : 'Start time'}</span><strong>${esc(formatTime(booking.event_time) || 'To confirm')}</strong></div>
              ${booking.booking_type === 'pickup' ? '' : `<div><span>Duration</span><strong>${Number(booking.duration_hours) || 3} hours</strong></div>`}
              ${booking.booking_type === 'pickup' ? '<div><span>Ready</span><strong>1–2 days after the request</strong></div>' : `<div><span>Venue</span><strong>${esc(booking.venue)}</strong></div>`}
              <div><span>Branch</span><strong>${esc(booking.needs_review ? 'Needs branch review' : booking.branch?.name || '—')}</strong></div>
              ${showContact && booking.booking_type !== 'pickup' ? `<div><span>Service address</span><strong>${esc(booking.address || '—')}</strong></div>` : ''}
              <div><span>Booking reference</span><strong>${esc(booking.ref)}</strong></div>
              ${showContact ? `<div><span>Customer</span><strong>${esc(contact.name || '—')}</strong></div><div><span>Contact</span><strong>${esc(contact.phone || contact.email || '—')}</strong></div>` : ''}
            </div>
            ${
              showContact && role === 'admin' && contact.mfa_enabled
                ? `<div class="drawer-note">
                    <span>Two-factor recovery</span>
                    <p>${esc(contact.name || 'This customer')} has two-factor enabled. If they lost their authenticator, clear it here — their password stays the same and they will be signed out.</p>
                    <button class="btn btn-sm" type="button" data-customer-mfa-reset="${esc(contact.id)}">Reset 2FA</button>
                  </div>`
                : ''
            }
            ${booking.notes ? `<div class="drawer-note"><span>Client notes</span><p>${esc(booking.notes)}</p></div>` : ''}
          </section>

          <section class="drawer-section">
            <h3>Pieces &amp; services</h3>
            <div class="drawer-items">${drawerItemsTemplate(booking)}</div>
            ${
              Number(booking.discount_amount)
                ? `<div class="drawer-total"><span>Subtotal</span><strong>${peso(booking.subtotal)}</strong></div>
                   <div class="drawer-total"><span>${esc(booking.discount_label || 'Discount')}</span><strong>−${peso(booking.discount_amount)}</strong></div>`
                : ''
            }
            <div class="drawer-total"><span>Booking total</span><strong>${peso(booking.total)}</strong></div>
          </section>

          ${
            role === 'customer'
              ? ''
              : `<section class="drawer-section" data-logistics-section>
                  <h3>Logistics &amp; deployment</h3>
                  ${adminLike
                    ? `<form data-form-type="logistics" data-id="${esc(booking.id)}">
                        <div class="drawer-form">
                          <div class="field">
                            <label for="logistics-status">Deployment status</label>
                            <select class="select" id="logistics-status" name="deployment_status">
                              ${optionsHtml(Object.entries(DEPLOYMENT_LABELS), booking.deployment_status || 'unassigned')}
                            </select>
                          </div>
                          <div class="field">
                            <label>Assigned branch</label>
                            <input class="input" type="text" value="${esc(booking.branch?.name || 'Needs review')}" readonly />
                          </div>
                          ${
                            logisticsTypes.length
                              ? `<div class="field field-full"><label>Physical units <span class="field-hint">${esc(
                                  requiredUnits.join(' · ')
                                )} requested</span></label><div class="logistics-units">${unitGroups}</div><p class="form-note">Only units for the booth types in this booking can be selected. Overlapping bookings and maintenance blocks are refused.</p></div>`
                              : '<p class="form-note field-full">This booking has no physical booth line, so no unit assignment is needed.</p>'
                          }
                          ${booking.booking_type === 'event'
                            ? `<div class="field">
                                <label for="logistics-setup-date">Setup date</label>
                                <input class="input" id="logistics-setup-date" name="setup_date" type="date" value="${esc(booking.setup_date ? String(booking.setup_date).slice(0, 10) : '')}" />
                              </div>
                              <div class="field">
                                <label for="logistics-setup-time">Setup time</label>
                                <input class="input" id="logistics-setup-time" name="setup_time" type="time" value="${esc(booking.setup_time || '')}" />
                              </div>
                              <div class="field">
                                <label for="logistics-pickup-date">Pickup schedule date</label>
                                <input class="input" id="logistics-pickup-date" name="pickup_schedule_date" type="date" value="${esc(booking.pickup_schedule_date ? String(booking.pickup_schedule_date).slice(0, 10) : '')}" />
                              </div>
                              <div class="field">
                                <label for="logistics-pickup-time">Pickup schedule time</label>
                                <input class="input" id="logistics-pickup-time" name="pickup_schedule_time" type="time" value="${esc(booking.pickup_schedule_time || '')}" />
                              </div>`
                            : ''}
                          <div class="field field-full">
                            <label for="logistics-notes">Logistics notes <span class="field-hint">optional</span></label>
                            <textarea class="textarea" id="logistics-notes" name="logistics_notes" maxlength="1000" placeholder="Gate access, crew lead, loading bay, unit condition…">${esc(booking.logistics_notes || '')}</textarea>
                          </div>
                          <div class="form-error field-full" data-drawer-error></div>
                          <div class="drawer-form-actions"><button class="btn btn-primary" type="submit">Save logistics</button></div>
                        </div>
                      </form>`
                    : `<div class="detail-grid">
                        <div><span>Deployment</span><strong>${esc(DEPLOYMENT_LABELS[booking.deployment_status] || 'Unassigned')}</strong></div>
                        <div><span>Assigned units</span><strong>${esc((booking.assigned_units || []).join(', ') || 'None yet')}</strong></div>
                        <div><span>Setup</span><strong>${booking.setup_date ? `${formatDate(booking.setup_date, 'short')} ${esc(booking.setup_time || '')}` : 'Not scheduled'}</strong></div>
                        <div><span>Pickup</span><strong>${booking.pickup_schedule_date ? `${formatDate(booking.pickup_schedule_date, 'short')} ${esc(booking.pickup_schedule_time || '')}` : 'Not scheduled'}</strong></div>
                      </div>`}
                  ${booking.logistics_notes ? `<div class="drawer-note"><span>Logistics notes</span><p>${esc(booking.logistics_notes)}</p></div>` : ''}
                </section>`
          }

          <section class="drawer-section" data-design-files-section>
            <h3>Design &amp; reference files</h3>
            <p class="form-note">References guide the design. They are not automatically treated as the final print file.</p>
            <div class="design-files-list" data-design-files-list="${esc(booking.id)}">Loading…</div>
            ${
              booking.design_notes
                ? `<div class="drawer-note"><span>Additional design instructions</span><p>${esc(booking.design_notes)}</p></div>`
                : ''
            }
            ${
              role === 'customer' && ['pending', 'confirmed'].includes(booking.status)
                ? `<div class="design-add">
                    <input type="file" data-drawer-design-input accept=".jpg,.jpeg,.png,.webp,.pdf,.psd,.ai,.svg" aria-label="Choose a design file" />
                    <select data-drawer-design-kind aria-label="File type">
                      <option value="reference">Reference / inspiration</option>
                      <option value="final">Final design to print</option>
                    </select>
                    <button class="btn btn-sm" type="button" data-drawer-design-upload="${esc(booking.id)}">Upload file</button>
                  </div>`
                : ''
            }
            ${
              adminLike
                ? `<form data-form-type="design" data-id="${esc(booking.id)}">
                    <div class="drawer-form" style="margin-top:14px">
                      <div class="field field-full">
                        <label for="design-status">Design status</label>
                        <select class="select" id="design-status" name="design_status">
                          ${optionsHtml(Object.entries(DESIGN_STATUS_LABELS), booking.design_status || 'for_review')}
                        </select>
                      </div>
                      <p class="form-note">This only records design progress. The booking status and the files stay as they are.</p>
                      <div class="form-error field-full" data-drawer-error></div>
                      <div class="drawer-form-actions"><button class="btn btn-primary" type="submit">Save design status</button></div>
                    </div>
                  </form>`
                : ''
            }
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
              adminLike
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
            adminLike
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
                      ${
                        role === 'admin'
                          ? `<div class="field">
                              <label for="admin-branch">Branch</label>
                              <select class="select" id="admin-branch" name="branch_id">
                                ${optionsHtml(
                                  [['', 'Needs review — no branch'], ...state.branches.map((branch) => [branch.id, branch.name])],
                                  booking.branch_id || ''
                                )}
                              </select>
                            </div>`
                          : ''
                      }
                      ${
                        booking.booking_type === 'pickup'
                          ? `<div class="field">
                              <label for="admin-date">Pickup date</label>
                              <input class="input" id="admin-date" name="pickup_date" type="date" value="${esc(booking.pickup_date || booking.event_date)}" />
                            </div>
                            <div class="field">
                              <label for="admin-time">Pickup time</label>
                              <input class="input" id="admin-time" name="pickup_time" type="time" value="${esc(booking.pickup_time || '')}" />
                            </div>`
                          : `<div class="field">
                              <label for="admin-date">Event date</label>
                              <input class="input" id="admin-date" name="event_date" type="date" value="${esc(booking.event_date)}" />
                            </div>
                            <div class="field">
                              <label for="admin-time">Start time</label>
                              <input class="input" id="admin-time" name="event_time" type="time" value="${esc(booking.event_time || '')}" />
                            </div>
                            <div class="field">
                              <label for="admin-duration">Duration (hours)</label>
                              <input class="input" id="admin-duration" name="duration_hours" type="number" min="1" max="12" step="0.5" value="${Number(booking.duration_hours) || 3}" />
                            </div>
                            <div class="field field-full">
                              <label for="admin-venue">Venue</label>
                              <input class="input" id="admin-venue" name="venue" type="text" maxlength="160" value="${esc(booking.venue)}" />
                            </div>`
                      }
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

          ${
            booking.cancellation
              ? `<section class="drawer-section">
                  <h3>Cancellation</h3>
                  <div class="detail-grid">
                    <div><span>Reason</span><strong>${esc(booking.cancellation.reason_label)}</strong></div>
                    <div><span>Cancelled by</span><strong>${booking.cancellation.cancelled_by_role === 'customer' ? 'Customer' : 'Branch'}</strong></div>
                    <div><span>When</span><strong>${formatDateTime(booking.cancellation.created_at)}</strong></div>
                    <div><span>Status change</span><strong>${esc(statusLabel(booking.cancellation.previous_status))} → cancelled</strong></div>
                  </div>
                  ${booking.cancellation.details ? `<div class="drawer-note"><span>Additional explanation</span><p>${esc(booking.cancellation.details)}</p></div>` : ''}
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

/* ---------- Motion helpers ---------- */

/* ---------- Motion: layers, view transitions, and row staggering ---------- */

// Users who ask their system to reduce motion get the same content with no
// entrance animation; nothing is hidden behind an animation that never runs.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Layers are injected closed, then opened on the next frame so the CSS
// transition actually runs. Re-rendering an open layer skips the entrance.
function revealLayer(root, { animate = true, fresh = false } = {}) {
  const overlay = root.firstElementChild;
  if (!overlay) return null;
  if (fresh) overlay.classList.add('is-fresh');
  if (animate && !reduceMotion.matches) {
    requestAnimationFrame(() => overlay.classList.add('open'));
    // Hidden tabs can throttle rAF; never leave a layer stuck closed.
    setTimeout(() => overlay.classList.add('open'), 120);
  } else {
    overlay.classList.add('open');
  }
  return overlay;
}

function unmountLayer(root) {
  const overlay = root.firstElementChild;
  if (!overlay) return;
  const finish = () => {
    if (root.firstElementChild === overlay) root.innerHTML = '';
    syncBodyLock();
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  overlay.addEventListener('transitionend', (event) => {
    if (event.target === overlay) finish();
  }, { once: true });
  setTimeout(finish, 380);
}

function runViewTransition(direction = 1) {
  if (reduceMotion.matches) return;
  viewRoot.classList.remove('view-enter', 'from-back');
  void viewRoot.offsetWidth;
  viewRoot.classList.toggle('from-back', direction < 0);
  viewRoot.classList.add('view-enter');
  clearTimeout(runViewTransition.timer);
  runViewTransition.timer = setTimeout(() => viewRoot.classList.remove('view-enter', 'from-back'), 620);

  // The page title changes immediately with the route; a short settle keeps
  // the header from feeling like it was swapped in a single frame.
  const meta = document.querySelector('.topbar-left');
  if (meta) {
    meta.classList.remove('meta-enter');
    void meta.offsetWidth;
    meta.classList.add('meta-enter');
    clearTimeout(runViewTransition.metaTimer);
    runViewTransition.metaTimer = setTimeout(() => meta.classList.remove('meta-enter'), 420);
  }
}

// Stagger the first rows of each collection so a fresh view settles in order.
function primeRows() {
  const groups = viewRoot.querySelectorAll(
    '.data-table tbody, .booking-list, .account-list, .activity-list, .catalog-group, .report-table tbody, .bar-list, .workload-list, .report-summary'
  );
  groups.forEach((group) => {
    const rows = Array.from(group.children).slice(0, 12);
    if (rows.length < 2) return;
    group.classList.add('stagger-in');
    rows.forEach((row, index) => row.style.setProperty('--row', String(index)));
  });
  clearTimeout(primeRows.timer);
  primeRows.timer = setTimeout(() => {
    viewRoot.querySelectorAll('.stagger-in').forEach((group) => group.classList.remove('stagger-in'));
  }, 900);
}

function closeAssistant() {
  const panel = document.getElementById('assistant-panel');
  if (!panel || panel.hidden || panel.dataset.closing === '1') return;
  state.chatHistoryOpen = false;
  renderAssistantHistory();
  panel.dataset.closing = '1';
  panel.classList.remove('is-open');
  panel.classList.add('is-closing');
  document.querySelector('[data-assistant-toggle]')?.setAttribute('aria-expanded', 'false');
  const finish = () => {
    if (panel.dataset.closing !== '1') return;
    panel.hidden = true;
    panel.classList.remove('is-closing');
    delete panel.dataset.closing;
  };
  if (reduceMotion.matches) finish();
  else setTimeout(finish, 240);
}

/* ---------- Opening and closing records ---------- */

function renderDrawer(booking, scroll = 0) {
  const wasOpen = Boolean(drawerRoot.firstElementChild);
  // The loading skeleton is already mounted, so the first real render still
  // counts as an entrance and gets the section cascade.
  const fresh = !wasOpen || state.drawerOpening;
  state.drawerOpening = false;
  state.activeBooking = booking;
  drawerRoot.innerHTML = drawerTemplate(booking);
  revealLayer(drawerRoot, { animate: !wasOpen, fresh });
  syncBodyLock();
  const body = drawerRoot.querySelector('.drawer-body');
  if (body) body.scrollTop = scroll;
  const filesBox = drawerRoot.querySelector('[data-design-files-list]');
  if (filesBox) loadDesignFiles(filesBox.dataset.designFilesList);
}

/**
 * Opens a booking in the drawer. The list row already holds enough data to draw
 * immediately; the fetch refreshes it so the timeline and payments are current.
 */
async function openBooking(id) {
  state.lastFocused = document.activeElement;    state.drawerOpening = true;
  drawerRoot.innerHTML = `
    <div class="drawer-overlay">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Booking details">
        <div class="drawer-head">
          <div><h2>Opening booking…</h2><p>Getting the latest update</p></div>
          <button class="drawer-close" type="button" data-drawer-close aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="load-screen"><span class="spinner" aria-hidden="true"></span> Loading the details...</div>
      </div>
    </div>`;
  revealLayer(drawerRoot);
  syncBodyLock();
  try {
    const { booking } = await api(`/api/bookings/${encodeURIComponent(id)}`);
    renderDrawer(booking);
    drawerRoot.querySelector('[data-drawer-close]')?.focus();
  } catch (error) {
    unmountLayer(drawerRoot);
    toast(error.message, 'error');
  }
}

function closeDrawer({ restoreFocus = true } = {}) {
  state.activeBooking = null;
  unmountLayer(drawerRoot);
  if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
}

function closeModal({ restoreFocus = true } = {}) {
  unmountLayer(modalRoot);
  if (restoreFocus && state.lastModalFocus instanceof HTMLElement) state.lastModalFocus.focus();
}

function syncBodyLock() {
  const locked = drawerRoot.children.length > 0 || modalRoot.children.length > 0;
  document.body.classList.toggle('no-scroll', locked);
}

/**
 * Replaces one booking in `state` and re-renders, keeping the drawer's scroll
 * position. Used after an edit, a payment, or a cancellation.
 */
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
  // Choosing "cancelled" here cannot save directly: the reason dialog opens
  // instead and writes the status only after confirmation.
  if (type === 'admin-booking' && data.get('status') === 'cancelled' && state.activeBooking) {
    openCancellationModal(state.activeBooking, { actor: 'branch' });
    return;
  }
  let payload;
  let endpoint = `/api/bookings/${encodeURIComponent(id)}`;
  if (type === 'design') {
    endpoint += '/design';
    payload = { design_status: data.get('design_status') };
  } else if (type === 'logistics') {
    endpoint += '/logistics';
    payload = {
      deployment_status: data.get('deployment_status'),
      assigned_units: data.getAll('assigned_units'),
      setup_date: data.get('setup_date') || null,
      setup_time: data.get('setup_time') || '',
      pickup_schedule_date: data.get('pickup_schedule_date') || null,
      pickup_schedule_time: data.get('pickup_schedule_time') || '',
      logistics_notes: data.get('logistics_notes') || '',
    };
  } else if (type === 'payment') {
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
      message: data.get('message') || '',
    };
    // Pickup and event forms carry different schedule fields; only send the
    // ones this booking actually has.
    if (data.get('event_date') !== null) payload.event_date = data.get('event_date');
    if (data.get('event_time') !== null) payload.event_time = data.get('event_time') || '';
    if (data.get('duration_hours') !== null) payload.duration_hours = Number(data.get('duration_hours'));
    if (data.get('pickup_date') !== null) payload.pickup_date = data.get('pickup_date');
    if (data.get('pickup_time') !== null) payload.pickup_time = data.get('pickup_time') || '';
    if (data.get('venue') !== null) payload.venue = data.get('venue');
    // Only the owner's form carries a branch field; others must not touch it.
    if (form.querySelector('[name="branch_id"]')) payload.branch_id = data.get('branch_id') || null;
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
          toast(
        type === 'payment'
          ? 'Payment record updated.'
          : type === 'logistics'
            ? 'Deployment and schedule saved.'
            : 'Booking updated.'
      );
  } catch (error) {
    setError(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

/* ---------- Cancellation with a required reason ---------- */

// Holds the in-progress cancellation while the modal moves from the reason form
// to the confirmation step. Never submitted without a validated reason.
let cancellationDraft = null;

function cancellationSummary(booking) {
  const services = (booking.items || []).map((item) => item.name).join(', ') || 'Services to be confirmed';
  return `
    <div class="detail-grid cancel-summary">
      <div><span>Booking reference</span><strong>${esc(booking.ref)}</strong></div>
      <div><span>Customer</span><strong>${esc(booking.customer?.name || state.user.name || '—')}</strong></div>
      <div><span>Service</span><strong>${esc(services)}</strong></div>
      <div><span>Scheduled</span><strong>${formatDate(booking.event_date)}${booking.event_time ? ` · ${esc(formatTime(booking.event_time))}` : ''}</strong></div>
    </div>`;
}

async function openCancellationModal(booking, { actor = 'customer' } = {}) {
  let reasons = [];
  try {
    ({ reasons } = await api('/api/cancellation-reasons'));
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  cancellationDraft = {
    booking,
    actor,
    reasons,
    reason: '',
    details: '',
    step: 'form',
    error: '',
  };
  state.lastModalFocus = document.activeElement;
  renderCancellationModal();
}

function renderCancellationModal() {
  const draft = cancellationDraft;
  if (!draft) return;
  const { booking, actor, reasons, step } = draft;
  const selected = reasons.find((item) => item.code === draft.reason);
  const requiresDetails = selected?.requires_details === true;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
        <button class="modal-close" type="button" data-modal-close aria-label="Close">${ICONS.close}</button>
        <p class="auth-eyebrow">${actor === 'customer' ? 'Cancel your booking' : 'Cancel a customer booking'}</p>
        <h2 id="cancel-title">${step === 'review' ? 'Confirm cancellation' : 'Why is this booking being cancelled?'}</h2>
        ${cancellationSummary(booking)}
        ${
          step === 'review'
            ? `<div class="cancel-review">
                <p><strong>${esc(booking.ref)}</strong> will be marked as <strong>cancelled</strong>. The booking record, its timeline, and any uploaded designs stay available.</p>
                <div class="drawer-note"><span>Reason</span><p>${esc(selected?.label || '')}${draft.details ? ` — ${esc(draft.details)}` : ''}</p></div>
                <p class="form-note">${
                  actor === 'customer'
                    ? "This cannot be undone from your account. Any payment already recorded is handled separately under the studio's refund policy."
                    : 'The customer will be notified in the app. Payments already recorded are unaffected.'
                }</p>
                <div class="form-error ${draft.error ? 'show' : ''}" role="alert">${esc(draft.error)}</div>
                <div class="modal-actions">
                  <button class="btn" type="button" data-cancel-back>Go back</button>
                  <button class="btn btn-danger" type="button" data-cancel-confirm>Confirm cancellation</button>
                </div>
              </div>`
            : `<form id="cancellation-form" novalidate>
                <div class="field">
                  <label for="cancel-reason">Cancellation reason</label>
                  <select class="select" id="cancel-reason" name="reason" required>
                    <option value="">Choose a reason</option>
                    ${reasons
                      .map(
                        (item) =>
                          `<option value="${esc(item.code)}" ${item.code === draft.reason ? 'selected' : ''}>${esc(item.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="cancel-details">Additional explanation ${requiresDetails ? '' : '<span class="field-hint">optional</span>'}</label>
                  <textarea class="textarea" id="cancel-details" name="details" maxlength="1000" placeholder="${
                    requiresDetails ? 'Explain why this booking is being cancelled (required).' : 'Anything else the studio should know.'
                  }">${esc(draft.details)}</textarea>
                </div>
                <p class="form-note">A reason is required. ${
                  actor === 'customer'
                    ? 'The studio keeps the booking record and its history.'
                    : 'The customer is told which reason the branch gave.'
                }</p>
                <div class="form-error ${draft.error ? 'show' : ''}" role="alert">${esc(draft.error)}</div>
                <div class="modal-actions">
                  <button class="btn" type="button" data-modal-close>Go back</button>
                  <button class="btn btn-danger" type="submit">Continue</button>
                </div>
              </form>`
        }
      </div>
    </div>`;
  revealLayer(modalRoot);
  syncBodyLock();
  modalRoot.querySelector(step === 'review' ? '[data-cancel-confirm]' : '#cancel-reason')?.focus();

  const form = modalRoot.querySelector('#cancellation-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const reason = String(data.get('reason') || '');
    const details = String(data.get('details') || '').trim();
    const entry = draft.reasons.find((item) => item.code === reason);
    if (!entry) {
      draft.error = 'Choose a cancellation reason.';
      return renderCancellationModal();
    }
    if (entry.requires_details && details.length < 5) {
      draft.error = 'Explain the reason for cancelling — at least a short sentence.';
      return renderCancellationModal();
    }
    draft.reason = reason;
    draft.details = details;
    draft.step = 'review';
    draft.error = '';
    renderCancellationModal();
  });
  modalRoot.querySelector('#cancel-reason')?.addEventListener('change', (event) => {
    draft.reason = event.target.value;
    draft.step = 'form';
    draft.error = '';
    renderCancellationModal();
  });
}

async function confirmCancellation() {
  const draft = cancellationDraft;
  if (!draft) return;
  const button = modalRoot.querySelector('[data-cancel-confirm]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Cancelling…';
  }
  const body =
    draft.actor === 'customer'
      ? { action: 'cancel', reason: draft.reason, reason_details: draft.details }
      : { status: 'cancelled', reason: draft.reason, reason_details: draft.details };
  try {
    const { booking } = await api(`/api/bookings/${encodeURIComponent(draft.booking.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const scroll = drawerRoot.querySelector('.drawer-body')?.scrollTop || 0;
    const wasCustomer = draft.actor === 'customer';
    cancellationDraft = null;
    closeModal({ restoreFocus: false });
    refreshAfterBooking(booking);
    if (drawerRoot.firstElementChild) renderDrawer(booking, scroll);
    toast(
      wasCustomer ? 'Your booking has been successfully cancelled.' : `Booking ${booking.ref} has been cancelled.`
    );
  } catch (error) {
    draft.error = error.message;
    renderCancellationModal();
  }
}

/* ---------- Physical booth inventory ---------- */

const INVENTORY_KIND_LABELS = {
  maintenance: 'Maintenance',
  damaged: 'Damaged',
  blocked: 'Manually blocked',
};

async function loadInventory() {
  state.inventoryLoading = true;
  state.inventoryError = '';
  renderView();
  try {
    const query = new URLSearchParams({
      date: state.inventoryDate,
      time: state.inventoryTime,
      hours: String(state.inventoryHours),
    });
    state.inventory = await api(`/api/inventory?${query.toString()}`);
  } catch (error) {
    state.inventoryError = error.message;
  } finally {
    state.inventoryLoading = false;
    renderView();
  }
}

function inventoryWindowLabel(inventory) {
  if (!inventory?.window) return '';
  return `${formatDate(inventory.window.date, 'weekday')} · ${formatTime(inventory.window.time)} · ${plural(
    Number(inventory.window.hours) || 1,
    'hour'
  )}`;
}

function inventoryTypeCard(row) {
  const used = Number(row.used) || 0;
  const total = Number(row.total) || 1;
  const percent = Math.min(100, Math.round((used / total) * 100));
  return `
    <article class="inventory-card ${row.available ? '' : 'inventory-card--tight'}">
      <div class="inventory-card-head">
        <div><span class="inventory-type">${esc(row.label)}</span><strong>${row.available}<small> / ${row.total} available</small></strong></div>
        <span class="inventory-state ${row.available ? 'is-open' : 'is-full'}">${row.available ? 'Bookable' : 'Fully booked'}</span>
      </div>
      <div class="inventory-meter" role="img" aria-label="${used} of ${total} units committed"><span style="width:${percent}%"></span></div>
      <div class="inventory-breakdown">
        <span><strong>${row.reserved}</strong> reserved</span>
        <span><strong>${row.deployed}</strong> deployed</span>
        <span><strong>${row.maintenance + row.blocked}</strong> maintenance</span>
        <span><strong>${row.available}</strong> open</span>
      </div>
      <p class="inventory-unit-labels">${(row.unit_labels || []).map((label) => `<span>${esc(label)}</span>`).join('')}</p>
    </article>`;
}

function inventoryDeploymentRow(booking) {
  const date = dateParts(booking.event_date);
  return `
    <article class="inventory-deployment">
      <div class="inventory-deployment-date"><strong>${date.day}</strong><span>${date.month}</span></div>
      <div class="inventory-deployment-copy">
        <div class="inventory-deployment-top"><strong>${esc(booking.ref)} · ${esc(booking.customer)}</strong>${statusBadge(booking.status)}</div>
        <span>${esc(booking.venue)} · ${esc(booking.branch)}</span>
        <div class="inventory-deployment-meta"><span>${esc(formatTime(booking.event_time))} · ${plural(Number(booking.duration_hours) || 1, 'hour')}</span>${booking.booths
          .map((booth) => `<span class="inventory-booth-chip">${esc(booth.label)} · ${booth.units}</span>`)
          .join('')}</div>
      </div>
      <button class="btn btn-sm" type="button" data-open-booking="${esc(booking.id)}">Open ${ICONS.chevron}</button>
    </article>`;
}

function inventoryBlockRow(block, canManage) {
  return `
    <div class="inventory-block-row">
      <div>
        <strong>${esc(block.unit_label)} · ${esc(block.booth_label)}</strong>
        <span>${esc(INVENTORY_KIND_LABELS[block.kind] || block.kind)} · ${esc(formatDate(block.start_date, 'weekday'))} ${esc(formatTime(block.start_time))} – ${esc(formatDate(block.end_date, 'weekday'))} ${esc(formatTime(block.end_time))}</span>
        ${block.reason ? `<small>${esc(block.reason)}</small>` : ''}
      </div>
      ${canManage ? `<button class="btn btn-sm" type="button" data-release-block="${esc(block.id)}">Release</button>` : ''}
    </div>`;
}

function renderAdminInventory() {
  if (state.inventoryError) {
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.inventory}</div>
        <h3>Inventory could not load</h3>
        <p>${esc(state.inventoryError)}</p>
        <div class="no-results-actions"><button class="btn btn-primary" type="button" data-inventory-retry>Try again</button></div>
      </div>`;
    return;
  }
  if (!state.inventory) {
    viewRoot.innerHTML = '<div class="view-skeleton" role="status" aria-live="polite">Checking the physical booth floor…</div>';
    return;
  }

  const data = state.inventory.inventory || {};
  const types = data.types || [];
  const totals = data.totals || {};
  const upcoming = data.upcoming || [];
  const blocks = data.blocks || [];
  const canManage = state.user.role === 'admin';
  const unitOptions = types
    .map(
      (row) => `<optgroup label="${esc(row.label)}">${(row.unit_labels || [])
        .map((label) => `<option value="${esc(label)}" data-unit-type="${esc(row.type)}">${esc(label)} · ${esc(row.label)}</option>`)
        .join('')}</optgroup>`
    )
    .join('');

  viewRoot.innerHTML = `
    <div class="page-intro">
      <div><h2>Every booth, one floor plan.</h2><p>Physical units are shared studio-wide. A request only passes when its event window fits both the branch capacity and the actual booth type.</p></div>
      <div class="page-actions"><button class="btn" type="button" data-inventory-refresh>${ICONS.refresh} Refresh</button></div>
    </div>
    <div class="stats-strip inventory-stats">
      <div class="stat-cell"><span>Total units</span><strong>${totals.units || 0}</strong><small>Photobooth 5 · Video 1 · Mirror 1 · Studio 2</small></div>
      <div class="stat-cell"><span>Available</span><strong class="${totals.available ? 'rose' : ''}">${totals.available || 0}</strong><small>Open in this window</small></div>
      <div class="stat-cell"><span>Reserved</span><strong>${totals.reserved || 0}</strong><small>Pending requests holding a unit</small></div>
      <div class="stat-cell"><span>Deployed</span><strong>${totals.deployed || 0}</strong><small>Confirmed or in progress</small></div>
      <div class="stat-cell"><span>Maintenance</span><strong>${totals.maintenance || 0}</strong><small>Damaged or under repair</small></div>
      <div class="stat-cell"><span>Blocked</span><strong>${totals.blocked || 0}</strong><small>Manually held units</small></div>
    </div>

    <form class="panel inventory-window" id="inventory-window-form">
      <div class="inventory-window-head"><div><h3>Window to inspect</h3><p>${esc(inventoryWindowLabel(data))}</p></div><span class="tiny muted">${state.inventoryLoading ? 'Refreshing…' : 'Live from bookings and blocks'}</span></div>
      <div class="inventory-window-fields">
        <label class="field"><span>Date</span><input class="input" id="inventory-date" type="date" value="${esc(state.inventoryDate)}" required /></label>
        <label class="field"><span>Start</span><input class="input" id="inventory-time" type="time" value="${esc(state.inventoryTime)}" required /></label>
        <label class="field"><span>Hours</span><input class="input" id="inventory-hours" type="number" min="1" max="12" step="0.5" value="${esc(state.inventoryHours)}" required /></label>
        <button class="btn btn-primary" type="submit">Check window</button>
      </div>
    </form>

    <div class="inventory-grid">${types.map(inventoryTypeCard).join('')}</div>

    <div class="two-col inventory-lower">
      <div class="panel">
        <div class="panel-head"><div><h3>Upcoming booth deployments</h3><p>Reservations from this date onward, with the physical pool they need</p></div><span class="tiny muted">${plural(upcoming.length, 'deployment')}</span></div>
        ${upcoming.length ? `<div class="inventory-deployments">${upcoming.map(inventoryDeploymentRow).join('')}</div>` : emptyState({ icon: 'calendar', title: 'No booth deployments yet', text: 'Upcoming event bookings that include a physical booth will appear here.' })}
      </div>

      <div class="panel">
        <div class="panel-head"><div><h3>Maintenance & blocked units</h3><p>A block removes that unit from every booking check in its window.</p></div></div>
        ${state.inventory.blocks_available === false ? `<div class="form-error show" role="alert">${esc(state.inventory.warning || 'Maintenance blocks are not available yet.')} Run <code>supabase/migrate-inventory.sql</code> to enable them.</div>` : ''}
        ${canManage ? `
          <form class="inventory-block-form" id="inventory-block-form">
            <div class="inventory-block-grid">
              <label class="field"><span>Booth type</span><select class="select" name="booth_type" id="inventory-block-type" required>${types.map((row) => `<option value="${esc(row.type)}">${esc(row.label)}</option>`).join('')}</select></label>
              <label class="field"><span>Unit</span><select class="select" name="unit_label" id="inventory-block-unit" required>${unitOptions}</select></label>
              <label class="field"><span>Reason</span><select class="select" name="kind" required><option value="maintenance">Maintenance</option><option value="damaged">Damaged</option><option value="blocked">Manually blocked</option></select></label>
              <label class="field"><span>Start date</span><input class="input" name="start_date" type="date" value="${esc(state.inventoryDate)}" required /></label>
              <label class="field"><span>Start time</span><input class="input" name="start_time" type="time" value="09:00" required /></label>
              <label class="field"><span>End date</span><input class="input" name="end_date" type="date" value="${esc(state.inventoryDate)}" required /></label>
              <label class="field"><span>End time</span><input class="input" name="end_time" type="time" value="12:00" required /></label>
              <label class="field inventory-block-reason"><span>Note <small>optional</small></span><input class="input" name="reason" maxlength="300" placeholder="e.g. bulb replacement" /></label>
            </div>
            <div class="form-error" data-inventory-form-error role="alert"></div>
            <button class="btn btn-primary" type="submit">Block this unit</button>
          </form>` : `<p class="tiny muted inventory-readonly-note">Branch heads can view the shared floor and upcoming deployments. Only the studio owner can add or release maintenance blocks.</p>`}
        <div class="inventory-block-list">${blocks.length ? blocks.map((block) => inventoryBlockRow(block, canManage)).join('') : '<p class="tiny muted">No units are blocked from this date onward.</p>'}</div>
      </div>
    </div>`;
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
    document.querySelector('[data-open-sidebar]')?.setAttribute('aria-expanded', 'true');
    return;
  }
  if (target.closest('[data-close-sidebar]')) {
    document.body.classList.remove('sidebar-open');
    document.querySelector('[data-open-sidebar]')?.setAttribute('aria-expanded', 'false');
    return;
  }
  if (target.closest('[data-logout]')) {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      window.location.replace('/shop');
    }
    return;
  }

  if (target.closest('[data-refresh-alerts]')) {
    target.closest('[data-refresh-alerts]').disabled = true;
    try {
      const { notifications, unread } = await api('/api/notifications');
      state.notifications = notifications || [];
      state.unread = unread || 0;
      renderChrome();
      renderView();
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  if (target.closest('[data-inventory-retry]')) {
    state.inventory = null;
    state.inventoryError = '';
    loadInventory();
    return;
  }
  if (target.closest('[data-inventory-refresh]')) {
    target.closest('[data-inventory-refresh]').disabled = true;
    loadInventory();
    return;
  }
  if (target.closest('[data-export-png]')) {
    exportReportPng();
    return;
  }
  if (target.closest('[data-calendar-retry]')) {
    state.calendarError = '';
    state.calendar = null;
    loadCalendar();
    return;
  }
  if (target.closest('[data-calendar-prev]')) {
    state.calendarMonth = shiftCalendarMonth(state.calendarMonth, -1);
    state.calendar = null;
    loadCalendar();
    return;
  }
  if (target.closest('[data-calendar-next]')) {
    state.calendarMonth = shiftCalendarMonth(state.calendarMonth, 1);
    state.calendar = null;
    loadCalendar();
    return;
  }
  if (target.closest('[data-calendar-today]')) {
    state.calendarMonth = todayISO().slice(0, 7);
    state.calendar = null;
    loadCalendar();
    return;
  }
  const releaseBlock = target.closest('[data-release-block]');
  if (releaseBlock) {
    if (!window.confirm('Release this inventory block? The unit will become bookable again for its window.')) {
      return;
    }
    releaseBlock.disabled = true;
    try {
      await api(`/api/inventory/blocks/${encodeURIComponent(releaseBlock.dataset.releaseBlock)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
      toast('Inventory block released.');
      await loadInventory();
    } catch (error) {
      toast(error.message, 'error');
      releaseBlock.disabled = false;
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

  if (target.closest('[data-new-service]')) {
    state.newProductOpen = !state.newProductOpen;
    renderView();
    return;
  }

  const detailsButton = target.closest('[data-product-details]');
  if (detailsButton) {
    openProductDetails(detailsButton.dataset.productDetails);
    return;
  }

  const selectButton = target.closest('[data-select-service]');
  if (selectButton) {
    const id = selectButton.dataset.selectService;
    if (modalRoot.children.length) closeModal({ restoreFocus: false });
    selectService(id);
    return;
  }

  const mediaButton = target.closest('.product-card-media[data-product-image]');
  if (mediaButton) {
    openProductLightbox(mediaButton.dataset.productImage);
    return;
  }

  const imageSaveButton = target.closest('[data-image-save]');
  if (imageSaveButton) {
    await saveProductImageFile(imageSaveButton.dataset.imageSave, imageSaveButton);
    return;
  }

  const imageRemoveButton = target.closest('[data-image-remove]');
  if (imageRemoveButton) {
    await removeProductImageFile(imageRemoveButton.dataset.imageRemove, imageRemoveButton);
    return;
  }

  const videoRemoveButton = target.closest('[data-video-remove]');
  if (videoRemoveButton) {
    await removeProductVideoFile(videoRemoveButton.dataset.videoRemove, videoRemoveButton);
    return;
  }

  if (target.closest('[data-images-retry]')) {
    state.images = null;
    state.imagesError = '';
    loadProductImages();
    return;
  }

  const addTier = target.closest('[data-add-tier]');
  if (addTier) {
    const list = addTier.closest('form')?.querySelector('[data-tier-list]');
    if (list) list.insertAdjacentHTML('beforeend', tierRowEditor());
    return;
  }

  const removeTier = target.closest('[data-remove-tier]');
  if (removeTier) {
    removeTier.closest('[data-tier-row]')?.remove();
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

  const typeButton = target.closest('[data-booking-type]');
  if (typeButton) {
    const nextType = typeButton.dataset.bookingType === 'pickup' ? 'pickup' : 'event';
    if (nextType === state.bookingType) return;
    const removed = state.cart.filter((item) => {
      const service = state.services.find((row) => row.id === item.service_id);
      return !service || !serviceSupportsBookingType(service, nextType);
    });
    state.cart = state.cart.filter((item) => {
      const service = state.services.find((row) => row.id === item.service_id);
      return service && serviceSupportsBookingType(service, nextType);
    });
    state.bookingType = nextType;
    state.availability = null;
    state.typeNotice = removed.length
      ? `Removed ${removed.map((item) => item.name).join(', ')} because ${
          removed.length === 1 ? 'it is' : 'they are'
        } not available for ${nextType === 'pickup' ? 'pickup' : 'event'} bookings.`
      : '';
    document.querySelectorAll('[data-booking-type]').forEach((button) => {
      button.classList.toggle('active', button.dataset.bookingType === state.bookingType);
    });
    const tabs = document.getElementById('catalog-tabs');
    if (tabs) tabs.innerHTML = catalogTabsTemplate();
    const catalog = document.getElementById('catalog-body');
    if (catalog) catalog.innerHTML = catalogBodyTemplate();
    const fields = document.getElementById('booking-fields');
    if (fields) fields.innerHTML = bookingFieldsTemplate();
    syncCart();
    renderAvailabilityNote();
    renderTypeNotice();
    if (removed.length) {
      toast(`${removed.length === 1 ? 'One item was' : `${removed.length} items were`} removed for this booking type.`, 'warning');
    }
    if (state.bookingType === 'pickup') suggestPickupBranch();
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

  const queueRemove = target.closest('[data-design-remove]');
  if (queueRemove) {
    removeDesignFile(queueRemove.dataset.designRemove);
    return;
  }

  const designDelete = target.closest('[data-design-delete]');
  if (designDelete) {
    const bookingId = designDelete.dataset.booking;
    if (!bookingId) return;
    if (!window.confirm('Remove this file from the booking?')) return;
    designDelete.disabled = true;
    try {
      await api(
        `/api/bookings/${encodeURIComponent(bookingId)}/files/${encodeURIComponent(designDelete.dataset.designDelete)}`,
        { method: 'DELETE' }
      );
      toast('File removed.');
      await loadDesignFiles(bookingId);
      const refreshed = await api(`/api/bookings/${encodeURIComponent(bookingId)}`);
      refreshAfterBooking(refreshed.booking);
    } catch (error) {
      toast(error.message, 'error');
      designDelete.disabled = false;
    }
    return;
  }

  const drawerUpload = target.closest('[data-drawer-design-upload]');
  if (drawerUpload) {
    const section = drawerUpload.closest('[data-design-files-section]');
    const input = section?.querySelector('[data-drawer-design-input]');
    const kindSelect = section?.querySelector('[data-drawer-design-kind]');
    const file = input?.files?.[0];
    const bookingId = drawerUpload.dataset.drawerDesignUpload;
    if (!file) {
      toast('Choose a file first.', 'error');
      return;
    }
    const label = drawerUpload.textContent;
    drawerUpload.disabled = true;
    drawerUpload.textContent = 'Uploading…';
    try {
      await uploadDesignFile(bookingId, {
        file,
        kind: kindSelect?.value === 'final' ? 'final' : 'reference',
      });
      toast('Design file uploaded.');
      input.value = '';
      await loadDesignFiles(bookingId);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      drawerUpload.disabled = false;
      drawerUpload.textContent = label;
    }
    return;
  }

  const cancel = target.closest('[data-cancel-booking]');
  if (cancel) {
    const booking =
      state.activeBooking || state.bookings.find((item) => item.id === cancel.dataset.cancelBooking);
    if (booking) openCancellationModal(booking, { actor: 'customer' });
    return;
  }

  if (target.closest('[data-cancel-back]')) {
    if (cancellationDraft) {
      cancellationDraft.step = 'form';
      cancellationDraft.error = '';
      renderCancellationModal();
    }
    return;
  }

  if (target.closest('[data-cancel-confirm]')) {
    await confirmCancellation();
    return;
  }

  if (target.closest('[data-cancellations-load]')) {
    await loadCancellations();
    return;
  }

  const accountToggle = target.closest('[data-account-toggle]');
  if (accountToggle) {
    const id = accountToggle.dataset.accountToggle;
    const active = accountToggle.dataset.active !== 'true';
    accountToggle.disabled = true;
    try {
      const { account } = await api(`/api/accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      state.accounts = state.accounts.map((item) => (item.id === account.id ? account : item));
      toast(active ? 'Account activated.' : 'Account deactivated.');
      renderView();
    } catch (error) {
      toast(error.message, 'error');
      accountToggle.disabled = false;
    }
    return;
  }

  const customerMfaReset = target.closest('[data-customer-mfa-reset]');
  if (customerMfaReset) {
    if (customerMfaReset.dataset.armed !== 'true') {
      customerMfaReset.dataset.armed = 'true';
      customerMfaReset.textContent = 'Tap again to reset 2FA';
      toast('This signs the customer out and turns off two-factor. Tap once more.', 'warning');
      return;
    }
    customerMfaReset.disabled = true;
    customerMfaReset.textContent = 'Resetting…';
    try {
      const id = customerMfaReset.dataset.customerMfaReset;
      await api(`/api/accounts/${encodeURIComponent(id)}/mfa-reset`, { method: 'POST', body: '{}' });
      const current = state.activeBooking;
      const updated = current
        ? { ...current, customer: { ...current.customer, mfa_enabled: false } }
        : null;
      state.bookings = state.bookings.map((booking) =>
        booking.customer?.id === id
          ? { ...booking, customer: { ...booking.customer, mfa_enabled: false } }
          : booking
      );
      if (updated) renderDrawer(updated);
      toast('Two-factor reset. Their next sign-in asks for the password only.', 'success');
    } catch (error) {
      toast(error.message, 'error');
      customerMfaReset.disabled = false;
      customerMfaReset.textContent = 'Reset 2FA';
      delete customerMfaReset.dataset.armed;
    }
    return;
  }

  const accountReset = target.closest('[data-account-reset]');
  if (accountReset) {
    if (accountReset.dataset.armed !== 'true') {
      accountReset.dataset.armed = 'true';
      accountReset.textContent = 'Tap again to reset';
      toast('Resetting signs them out and clears two-factor. Tap once more.', 'warning');
      return;
    }
    accountReset.disabled = true;
    accountReset.textContent = 'Resetting…';
    try {
      const result = await api(`/api/accounts/${encodeURIComponent(accountReset.dataset.accountReset)}/reset`, {
        method: 'POST',
        body: JSON.stringify({ reset_mfa: true }),
      });
      const account = result.account;
      state.accounts = state.accounts.map((item) =>
        item.id === account.id
          ? { ...item, must_change_password: true, mfa_enabled: false, active: true }
          : item
      );
      showTemporaryPassword(account.name, account.email, result.temporary_password);
    } catch (error) {
      toast(error.message, 'error');
      accountReset.disabled = false;
      accountReset.textContent = 'Reset password';
      delete accountReset.dataset.armed;
    }
    return;
  }

  const crewToggle = target.closest('[data-crew-toggle]');
  if (crewToggle) {
    const active = crewToggle.dataset.active !== 'true';
    crewToggle.disabled = true;
    try {
      const { user } = await api(`/api/staff/${encodeURIComponent(crewToggle.dataset.crewToggle)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      state.staff = state.staff.map((item) => (item.id === user.id ? user : item));
      toast(active ? 'Crew member reactivated.' : 'Crew member deactivated.');
      renderView();
    } catch (error) {
      toast(error.message, 'error');
      crewToggle.disabled = false;
    }
    return;
  }

  const discountToggle = target.closest('[data-discount-toggle]');
  if (discountToggle) {
    const active = discountToggle.dataset.active !== 'true';
    discountToggle.disabled = true;
    try {
      const { discount } = await api(`/api/discounts/${encodeURIComponent(discountToggle.dataset.discountToggle)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      state.discounts = state.discounts.map((item) =>
        item.id === discount.id ? { ...item, ...discount } : item
      );
      toast(active ? 'Discount activated.' : 'Discount deactivated.');
      renderView();
    } catch (error) {
      toast(error.message, 'error');
      discountToggle.disabled = false;
    }
    return;
  }

  if (target.closest('[data-mfa-start]')) {
    const button = target.closest('[data-mfa-start]');
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      state.mfaSetup = await api('/api/auth/mfa/setup', { method: 'POST', body: '{}' });
      renderView();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Set up two-factor';
    }
    return;
  }

  if (target.closest('[data-assistant-open]')) {
    openAssistant();
    return;
  }
  if (target.closest('[data-rate-card]')) {
    openRateCard();
    return;
  }
  if (target.closest('[data-rate-retry]')) {
    loadRateCard();
    return;
  }
  if (target.closest('[data-assistant-toggle]')) {
    const panel = document.getElementById('assistant-panel');
    if (!panel) return;
    if (panel.hidden) openAssistant();
    else closeAssistant();
    return;
  }
  if (target.closest('[data-assistant-close]')) {
    closeAssistant();
    return;
  }
  if (target.closest('[data-assistant-minimize]')) {
    minimizeAssistant();
    return;
  }
  if (target.closest('[data-assistant-lang]')) {
    toggleAssistantLang();
    return;
  }
  if (target.closest('[data-assistant-history-toggle]')) {
    toggleAssistantHistory();
    return;
  }
  if (target.closest('[data-assistant-history-retry]')) {
    loadAssistantConversations(true);
    return;
  }
  if (target.closest('[data-assistant-new]')) {
    startNewAssistantChat();
    return;
  }
  if (target.closest('[data-assistant-conversation]')) {
    openAssistantConversation(target.closest('[data-assistant-conversation]').dataset.assistantConversation || '');
    return;
  }
  if (target.closest('[data-assistant-suggest]')) {
    const question = target.closest('[data-assistant-suggest]').dataset.assistantSuggest || '';
    sendAssistant(question);
    return;
  }
  if (target.closest('[data-assistant-retry]')) {
    const retry = state.chatRetry;
    state.chatRetry = '';
    sendAssistant(retry);
    return;
  }
  if (target.closest('[data-state-primary]')) {
    const action = target.closest('[data-state-primary]').dataset.statePrimary;
    if (action === 'signin') {
      window.location.href = `/shop?auth=signin&next=${encodeURIComponent(`/app#${state.view}`)}&expired=1`;
      return;
    }
    if (action === 'back') {
      closeModal();
      if (window.history.length > 1) window.history.back();
      else navigate('overview');
      return;
    }
    closeModal();
    return;
  }
  if (target.closest('[data-state-secondary]')) {
    const action = target.closest('[data-state-secondary]').dataset.stateSecondary;
    closeModal();
    if (action === 'overview') navigate('overview');
    return;
  }
  if (target.closest('[data-clear-search]')) {
    state.adminSearch = '';
    state.adminStatus = 'all';
    renderView();
    return;
  }
  if (target.closest('[data-use-suggestion]')) {
    state.adminSearch = target.closest('[data-use-suggestion]').dataset.useSuggestion || '';
    renderView();
    return;
  }
  if (target.closest('[data-report-retry]')) {
    loadReport();
    return;
  }
  if (target.closest('[data-pricing-retry]')) {
    state.pricing = null;
    state.pricingError = '';
    loadPricing();
    return;
  }
});

document.addEventListener('dblclick', (event) => {
  const image = event.target.closest('[data-product-image]');
  if (!image) return;
  event.preventDefault();
  openProductLightbox(image.dataset.productImage);
});

document.addEventListener('change', async (event) => {
  const target = event.target;

  if (target.matches('[data-cart-width]') || target.matches('[data-cart-height]')) {
    const index = Number(target.dataset.cartWidth ?? target.dataset.cartHeight);
    const item = state.cart[index];
    if (!item) return;
    if (target.matches('[data-cart-width]')) item.width_ft = target.value;
    else item.height_ft = target.value;
    updateCartLine(index);
    return;
  }

  if (target.matches('[data-image-input]')) {
    previewImageSelection(target);
    return;
  }

  if (target.matches('[data-video-input]')) {
    await uploadProductVideo(target);
    return;
  }

  if (target.matches('#inventory-block-type')) {
    const unit = document.getElementById('inventory-block-unit');
    if (!unit) return;
    const options = [...unit.options].filter((option) => option.dataset.unitType === target.value);
    for (const option of unit.options) option.hidden = option.dataset.unitType !== target.value;
    if (options[0]) unit.value = options[0].value;
    return;
  }

  if (target.matches('#report-section')) {
    const fromInput = document.getElementById('report-from');
    const toInput = document.getElementById('report-to');
    if (fromInput?.value) state.reportFrom = fromInput.value;
    if (toInput?.value) state.reportTo = toInput.value;
    state.reportSection = target.value;
    renderView();
    return;
  }

  if (target.matches('#calendar-branch')) {
    state.calendarBranch = target.value;
    state.calendar = null;
    loadCalendar();
    return;
  }

  if (target.matches('#image-filter')) {
    state.imageFilter = target.value;
    renderView();
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

  if (target.matches('#pickup-branch')) {
    state.pickupBranchId = target.value;
    state.branchTouched = true;
    const note = document.getElementById('geo-note');
    if (note && target.value) {
      note.textContent = `You chose ${branchName(target.value)}. Your selection is kept.`;
    }
    return;
  }

  if (
    target.matches('#booking-date') ||
    target.matches('#booking-time') ||
    target.matches('#booking-duration') ||
    target.matches('#booking-branch')
  ) {
    checkAvailability();
    return;
  }

  if (target.matches('#account-role')) {
    const field = document.getElementById('account-branch-field');
    const select = document.getElementById('account-branch');
    if (field) field.hidden = target.value === 'admin';
    if (select) select.required = target.value !== 'admin';
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
  if (event.target.matches('#catalog-search')) {
    state.catalogSearch = event.target.value;
    const body = document.getElementById('catalog-body');
    if (body) body.innerHTML = catalogBodyTemplate();
    return;
  }
  if (event.target.matches('#image-search')) {
    applyImageSearch();
    return;
  }
  if (event.target.matches('#measure-length, #measure-height')) {
    const form = event.target.closest('[data-measure-form]');
    const service = state.services.find((item) => item.id === form?.dataset.id);
    if (service) updateMeasurementPreview(service);
    return;
  }
  if (event.target.matches('[data-cart-width], [data-cart-height]')) {
    const index = Number(event.target.dataset.cartWidth ?? event.target.dataset.cartHeight);
    const item = state.cart[index];
    if (!item) return;
    if (event.target.matches('[data-cart-width]')) item.width_ft = event.target.value;
    else item.height_ft = event.target.value;
    updateCartLine(index);
    return;
  }
  if (event.target.matches('#admin-search')) {
    state.adminSearch = event.target.value;
    updateAdminBookingsTable();
  }
  // Typing in the booking form clears the field's error and keeps a draft, so
  // an expired session or accidental navigation does not lose the work.
  if (event.target.closest('#booking-form')) {
    clearFieldError(event.target);
    scheduleDraftSave();
  }
});

// Validate a booking field when the user leaves it, not while they type.
document.addEventListener('focusout', (event) => {
  const field = event.target.closest?.('#booking-form input, #booking-form select, #booking-form textarea');
  if (!field || !field.name) return;
  setFieldError(field, bookingFieldProblem(field));
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'inventory-window-form') {
    event.preventDefault();
    state.inventoryDate = document.getElementById('inventory-date')?.value || todayISO();
    state.inventoryTime = document.getElementById('inventory-time')?.value || '09:00';
    state.inventoryHours = Number(document.getElementById('inventory-hours')?.value) || 3;
    await loadInventory();
    return;
  }
  if (form.id === 'inventory-block-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-inventory-form-error]');
    const data = new FormData(form);
    errorBox.textContent = '';
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Blocking…';
    try {
      await api('/api/inventory/blocks', {
        method: 'POST',
        body: JSON.stringify({
          booth_type: data.get('booth_type'),
          unit_label: data.get('unit_label'),
          kind: data.get('kind'),
          start_date: data.get('start_date'),
          start_time: data.get('start_time'),
          end_date: data.get('end_date'),
          end_time: data.get('end_time'),
          reason: data.get('reason'),
        }),
      });
      toast('Unit blocked from new bookings.');
      await loadInventory();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Block this unit';
    }
    return;
  }
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
          email: data.get('email') || '',
          phone: data.get('phone'),
          branch_id: data.get('branch_id') || '',
        }),
      });
      state.staff.push(result.user);
      toast('Crew record created — no sign-in was issued.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Create crew record';
    }
    return;
  }
  if (form.id === 'account-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-account-error]');
    const data = new FormData(form);
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const result = await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          role: data.get('role'),
          branch_id: data.get('branch_id') || '',
          password: data.get('password'),
        }),
      });
      state.accounts.push(result.account);
      toast('Studio account created.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Create account';
    }
    return;
  }
  if (form.id === 'discount-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-discount-error]');
    const data = new FormData(form);
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const { discount } = await api('/api/discounts', {
        method: 'POST',
        body: JSON.stringify({
          customer_email: data.get('customer_email'),
          type: data.get('type'),
          value: Number(data.get('value')),
          note: data.get('note'),
        }),
      });
      const index = state.discounts.findIndex((item) => item.id === discount.id);
      if (index >= 0) state.discounts[index] = { ...state.discounts[index], ...discount };
      else state.discounts.unshift(discount);
      toast('Discount saved.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Save discount';
    }
    return;
  }
  if (form.id === 'password-form') {
    event.preventDefault();
    const wasTemporary = Boolean(state.user.must_change_password);
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-password-error]');
    const data = new FormData(form);
    const setError = (message) => {
      errorBox.textContent = message;
      errorBox.classList.toggle('show', Boolean(message));
    };
    setError('');
    if (data.get('new_password') !== data.get('confirm_password')) {
      return setError('The two new passwords do not match.');
    }
    button.disabled = true;
    button.textContent = 'Updating…';
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: data.get('current_password'),
          new_password: data.get('new_password'),
        }),
      });
      state.user.must_change_password = false;
      toast('Password updated.');
      form.reset();
      if (wasTemporary) {
        // The first bootstrap deliberately skipped data loading while the
        // temporary-password gate was active. Reload once to enter the normal
        // dashboard with a fresh, fully authorized session.
        window.location.assign('/app');
        return;
      }
      renderView();
    } catch (error) {
      setError(error.message);
      button.disabled = false;
      button.textContent = 'Update password';
    }
    return;
  }
  if (form.id === 'mfa-enable-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-mfa-error]');
    const code = String(new FormData(form).get('code') || '').replace(/\s+/g, '');
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Turning on…';
    try {
      await api('/api/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
      state.user.mfa_enabled = true;
      state.mfaSetup = null;
      toast('Two-factor is on. You will need the app at the next sign-in.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Turn on two-factor';
    }
    return;
  }
  if (form.id === 'mfa-disable-form') {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-mfa-error]');
    const data = new FormData(form);
    errorBox.classList.remove('show');
    button.disabled = true;
    button.textContent = 'Turning off…';
    try {
      await api('/api/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: data.get('password') }),
      });
      state.user.mfa_enabled = false;
      state.mfaSetup = null;
      toast('Two-factor turned off.');
      renderView();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.add('show');
      button.disabled = false;
      button.textContent = 'Turn off two-factor';
    }
    return;
  }
  if (form.id === 'assistant-form') {
    event.preventDefault();
    const input = document.getElementById('assistant-input');
    const message = input?.value || '';
    if (input) input.value = '';
    await sendAssistant(message);
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
  if (form.id === 'new-service-form') {
    event.preventDefault();
    await saveNewService(form);
    return;
  }
  if (form.matches('[data-measure-form]')) {
    event.preventDefault();
    const service = state.services.find((item) => item.id === form.dataset.id);
    const errorBox = form.querySelector('[data-measure-error]');
    if (!service) return;
    const width = document.getElementById('measure-length')?.value;
    const height = document.getElementById('measure-height')?.value;
    const problem = measurementProblem({ ...service, width_ft: width, height_ft: height });
    if (problem) {
      if (errorBox) {
        errorBox.textContent = problem;
        errorBox.classList.add('show');
      }
      return;
    }
    try {
      addMeasuredService(service, width, height);
      closeModal({ restoreFocus: false });
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.classList.add('show');
      }
    }
    return;
  }
  if (form.matches('[data-price-form]')) {
    event.preventDefault();
    await saveServicePrice(form);
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

/**
 * Boots the dashboard: confirms the session, loads every collection the role is
 * allowed to see in one parallel batch, then renders the view named in the hash.
 * A failure here replaces the page with a retry message rather than a blank
 * screen, and a signed-out visitor is sent back to the shop sign-in.
 */
async function init() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      window.location.replace('/shop?auth=signin&next=/app');
      return;
    }
    state.user = user;
    // A reset password is deliberately not a usable dashboard session. Render
    // only the password-change surface until the server issues a normal cookie.
    if (user.must_change_password) {
      state.services = [];
      state.categories = [];
      state.bookings = [];
      state.branches = [];
      state.customerDiscount = null;
      state.accounts = [];
      state.discounts = [];
      state.staff = [];
      state.notifications = [];
      state.unread = 0;
      clearLegacyAssistantHistory();
      setupConnectivity();
      setupSessionGuard();
      if (!window.location.hash) history.replaceState(null, '', '#account');
      renderChrome();
      await navigate('account');
      toast('Choose a new password before using the dashboard.');
      return;
    }
    const requests = [
      api('/api/services'),
      api('/api/bookings'),
      api('/api/branches'),
      user.role === 'customer' ? api('/api/discounts/mine') : Promise.resolve({ discount: null }),
      user.role === 'admin' ? api('/api/accounts') : Promise.resolve({ accounts: [] }),
      user.role === 'admin' ? api('/api/discounts') : Promise.resolve({ discounts: [] }),
    ];
    if (isAdminRole(user.role)) requests.push(api('/api/staff'), api('/api/notifications'));
    const [catalog, bookingData, branchData, discountData, accountData, allDiscounts, staffData, alertData] =
      await Promise.all(requests);
    state.services = catalog.services || [];
    state.categories = catalog.categories || [];
    state.bookings = bookingData.bookings || [];
    state.branches = branchData.branches || [];
    state.customerDiscount = discountData?.discount || null;
    state.accounts = accountData?.accounts || [];
    state.discounts = allDiscounts?.discounts || [];
    state.staff = staffData?.staff || [];
    state.notifications = alertData?.notifications || [];
    state.unread = alertData?.unread || 0;
    // Global state wiring: the assistant transcript lives on the server, while
    // this tab keeps only the current conversation in memory.
    clearLegacyAssistantHistory();
    setupConnectivity();
    setupSessionGuard();
    if (user.role === 'customer') restoreBookingDraft();
    if (user.must_change_password) {
      toast('Your password was reset. Choose a new one in Account & security.');
    }
    const view = parseView();
    if (!window.location.hash) history.replaceState(null, '', `#${view}`);
    renderChrome();
    await navigate(view);
  } catch (error) {
    // The console keeps the technical detail for developers; the page shows the
    // plain-language cause and a way forward.
    console.error(error);
    const info = errorInfo(error);
    viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.close}</div>
        <h3>${esc(info.title)}</h3>
        <p>${esc(info.message)}</p>
        <div class="no-results-actions">
          <button class="btn btn-primary" type="button" data-reload>${esc(info.action)}</button>
          ${info.kind === 'unauthorized' ? '<a class="btn" href="/shop?auth=signin&next=/app">Sign in</a>' : ''}
        </div>
      </div>`;
  }
}

init();
