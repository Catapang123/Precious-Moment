/**
 * Marketing page (`/welcome`): the public face of the studio.
 *
 * Fetches the live catalog for the rate board, wires the mobile navigation, and
 * personalises the header links for a signed-in visitor. It never writes data,
 * so it can be cached and viewed signed out.
 */
import { api, getCurrentUser, priceGroupsHtml } from './api.js';
import { initScrollReveal } from './motion.js';

const board = document.getElementById('price-board');

// The measured Tarpaulin product replaces the old fixed-size tarp cards in the
// customer-facing rate board. Those records stay in the database for historical
// orders and remain editable from Pricing.
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

/** Draws the rate board. The markup itself lives in `api.js` so the dashboard
 * rate-card dialog and this page can never drift apart. */
function renderPrices(catalog) {
  if (!board) return;
  const visibleCatalog = {
    ...catalog,
    services: (catalog.services || []).filter((service) => !LEGACY_SIZED_TARPAULINS.has(service.id)),
  };
  const html = priceGroupsHtml(visibleCatalog);
  board.innerHTML = html || '<div class="price-error">The rate card is taking a moment. Please refresh.</div>';
}

async function loadCatalog() {
  if (!board) return;
  try {
    const catalog = await api('/api/services');
    renderPrices(catalog);
  } catch {
    board.innerHTML =
      '<div class="price-error">The rate card could not load. Refresh the page or email hello@preciousmoments.ph.</div>';
  }
}

/**
 * Mobile navigation: toggle, close on link tap, close on outside click, and
 * close on Escape. The header also gains a shadow once the page scrolls.
 */
function setupNavigation() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('site-nav');

  const closeNav = () => {
    nav?.classList.remove('open');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  toggle?.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNav));

  document.addEventListener('click', (event) => {
    if (!nav?.classList.contains('open')) return;
    if (!nav.contains(event.target) && !toggle.contains(event.target)) closeNav();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });

  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/**
 * Signed-in visitors get "My dashboard" instead of "Sign in", and every
 * booking link points straight at the booking form. Signed-out visitors keep
 * the default markup, so nothing flashes before the check resolves.
 */
async function personaliseLinks() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return;
  document.querySelectorAll('[data-auth-link]').forEach((link) => {
    link.textContent = 'My dashboard';
    link.href = '/app';
  });
  document.querySelectorAll('[data-book-link]').forEach((link) => {
    link.href = '/app#book';
  });
}

document.querySelectorAll('[data-year]').forEach((node) => {
  node.textContent = new Date().getFullYear();
});

setupNavigation();
loadCatalog();
personaliseLinks();

// The marketing page is long; its lower sections settle in as they are read.
initScrollReveal(
  [
    '.section-head',
    '.price-foot',
    '.story-photos',
    '.story-copy',
    '.process-head',
    '.steps > li',
    '.studio-copy',
    '.studio-mock',
    '.faq-copy',
    '.faq-list',
    '.cta-panel',
    '.footer-grid',
  ].join(', ')
);
