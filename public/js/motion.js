/**
 * Shared motion helpers for the static Precious Moments frontend.
 *
 * This file deliberately has no dependency on the dashboard state or on any
 * animation library. It centralises the two things CSS cannot do well:
 *  - counting a KPI from zero to its rendered value, and
 *  - revealing below-the-fold marketing content only when it enters view.
 *
 * Every helper is a no-op when the visitor prefers reduced motion. CSS owns the
 * actual transitions and keyframes, so the visual language stays in styles.css.
 */

const reduceQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function prefersReducedMotion() {
  return Boolean(reduceQuery?.matches);
}

const numberPattern = /-?\d[\d,]*(?:\.\d+)?/;

const formatters = new Map();

function formatNumber(value, decimals) {
  let formatter = formatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, formatter);
  }
  return formatter.format(value);
}

/**
 * Counts a single element up from zero while preserving any currency symbol or
 * suffix already in its text. The final text is restored exactly, so rounding
 * and locale formatting can never leave a value off by one.
 */
export function animateNumber(node, { duration = 760, delay = 0 } = {}) {
  if (!node || prefersReducedMotion() || document.hidden) return;
  if (node.dataset.motionCounted === 'true') return;

  const original = node.textContent.trim();
  const match = original.match(numberPattern);
  if (!match) return;

  const raw = match[0];
  const target = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(target) || target === 0) return;

  const prefix = original.slice(0, match.index);
  const suffix = original.slice(match.index + raw.length);
  const decimals = (raw.split('.')[1] || '').length;
  const start = performance.now() + delay;
  const total = Math.max(1, duration);

  node.dataset.motionCounted = 'true';
  node.textContent = `${prefix}${formatNumber(0, decimals)}${suffix}`;

  const tick = (now) => {
    // A re-render can detach the node while its frame loop is still pending.
    if (!node.isConnected) return;
    if (prefersReducedMotion()) {
      node.textContent = original;
      return;
    }
    const progress = Math.min(1, Math.max(0, (now - start) / total));
    const eased = 1 - Math.pow(1 - progress, 3);
    if (progress < 1) {
      node.textContent = `${prefix}${formatNumber(target * eased, decimals)}${suffix}`;
      requestAnimationFrame(tick);
    } else {
      node.textContent = original;
    }
  };

  if (delay) {
    setTimeout(() => requestAnimationFrame(tick), delay);
  } else {
    requestAnimationFrame(tick);
  }
}

/**
 * Animates the values in the current view after it has been painted. Only the
 * existing stats are touched; no metric, percentage, or data point is invented.
 */
export function animateStats(root = document) {
  if (!root || prefersReducedMotion() || document.hidden) return;
  const nodes = [...root.querySelectorAll('.stat-cell strong, .report-stat strong')];
  nodes.forEach((node, index) => {
    animateNumber(node, { delay: Math.min(index * 55, 260) });
  });
}

/**
 * Adds a small, reversible reveal to selected blocks as they scroll into view.
 * Elements already on screen are shown immediately rather than hidden first,
 * so a page never flashes empty on load.
 */
export function initScrollReveal(selector, { rootMargin = '0px 0px -8% 0px' } = {}) {
  const elements = [...document.querySelectorAll(selector)];
  if (!elements.length) return () => {};

  elements.forEach((element) => element.classList.add('motion-reveal'));

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-revealed'));
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-pending-reveal');
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin }
  );

  elements.forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) {
      element.classList.add('is-revealed');
      return;
    }
    element.classList.add('is-pending-reveal');
    observer.observe(element);
  });

  return () => {
    observer.disconnect();
    elements.forEach((element) => element.classList.remove('is-pending-reveal'));
  };
}
