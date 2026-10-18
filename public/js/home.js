import { api, esc, getCurrentUser, peso } from './api.js';

const board = document.getElementById('price-board');

function renderPrices(catalog) {
  if (!board) return;
  const categories = catalog.categories || [];
  const services = catalog.services || [];

  if (!services.length) {
    board.innerHTML = '<div class="price-error">The rate card is taking a moment. Please refresh.</div>';
    return;
  }

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
                </div>
                <span class="price-value">
                  <strong>${peso(service.price)}</strong>
                  <span>${esc(service.unit)}${service.min_qty ? ` · min ${service.min_qty}` : ''}</span>
                </span>
              </li>`
              )
              .join('')}
          </ul>
        </section>`;
    })
    .join('');

  board.innerHTML = `<div class="price-groups">${groups}</div>`;
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
