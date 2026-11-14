import React, { useEffect, useMemo, useRef, useState } from 'react';
import AnimatedList from './components/AnimatedList.jsx';
import CircularCarousel from './components/CircularCarousel.jsx';
import MagicBento from './components/MagicBento.jsx';
import SpecularButton from './components/SpecularButton.jsx';
import AuthModal from './AuthModal.jsx';
import CheckoutModal from './CheckoutModal.jsx';
import useDialogFocus from './useDialogFocus';
import { api } from './api';
import {
  availabilityLabel,
  availabilityShort,
  cartCompatibility,
  cartLineKey,
  estimateLine,
  formatDate,
  isBooth,
  loadCart,
  money,
  plural,
  priceForQty,
  saveCart,
  serviceImageUrl,
  serviceVideoUrl,
  supportsType,
  tierSummary,
  BOOTH_TYPES,
  LEGACY_SIZED_TARPAULINS,
} from './lib';
import './shop.css';

const AUTH_QUERY = new URLSearchParams(window.location.search);
const AUTH_MODE_QUERY = AUTH_QUERY.get('auth');
const AUTH_NEXT = (() => {
  const raw = AUTH_QUERY.get('next') || '';
  if (!raw) return '';
  try {
    const target = new URL(raw, window.location.origin);
    if (target.origin !== window.location.origin) return '';
    if (['/shop', '/shop/', '/login'].includes(target.pathname)) return '';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '';
  }
})();
const AUTH_EXPIRED = AUTH_QUERY.get('expired') === '1';

function Icon({ name, size = 20 }) {
  const paths = {
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    bag: <><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>,
    check: <><path d="m5 12 4 4 10-11" /></>,
    chevron: <><path d="m8 10 4 4 4-4" /></>,
    close: <><path d="M6 6l12 12M18 6 6 18" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 5 5" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" /></>,
    pin: <><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="10" r="2.4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    minus: <><path d="M5 12h14" /></>,
    play: <><path d="M8 5v14l11-7-11-7Z" fill="currentColor" stroke="none" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6M14 11v6" /></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M9 12h9" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
}

const LOCAL_PREVIEW = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

function stableImageUrl(service) {
  const source = serviceImageUrl(service);
  if (!source) return '';
  // Hosted uploads live in Supabase. Legacy local /uploads paths are kept for
  // local development, where they are served from disk, but would 404 on Render.
  if (source.startsWith('/uploads/') && !LOCAL_PREVIEW) return '';
  return source;
}

const HOW_STEPS = [
  {
    number: '01',
    icon: 'bag',
    title: 'Browse & build your cart',
    copy: 'Explore the live collection without an account. Your cart stays saved on this device.'
  },
  {
    number: '02',
    icon: 'calendar',
    title: 'Send the date',
    copy: 'Create an account only when you’re ready. Tell us the event or pickup details and send one request.'
  },
  {
    number: '03',
    icon: 'check',
    title: 'The studio confirms',
    copy: 'We check the calendar, physical booth units, and final pricing, then send the 50% reservation details.'
  }
];

function ProcessBento() {
  const items = HOW_STEPS.map((step) => ({
    id: step.number,
    content: (
      <div className="how-bento-card">
        <div className="how-bento-top">
          <span className="how-bento-number">{step.number}</span>
          <span className="how-bento-icon"><Icon name={step.icon} size={19} /></span>
        </div>
        <h3>{step.title}</h3>
        <p>{step.copy}</p>
        <span className="how-bento-line" aria-hidden="true" />
      </div>
    )
  }));
  return (
    <MagicBento
      items={items}
      columns={3}
      rowHeight={236}
      gap={14}
      radius={22}
      theme="dark"
      glowColor="#f0559b"
      enableBorderGlow
      enableSpotlight
      spotlightRadius={240}
      intro
      textAutoHide={false}
      clickEffect={false}
      className="how-bento"
      style={{
        '--mb-surface': 'linear-gradient(160deg, #1a0e16 0%, #120910 100%)',
        '--mb-edge': 'rgba(255, 170, 206, 0.14)',
        '--mb-highlight': 'rgba(255, 255, 255, 0.06)',
        '--mb-ink': 'var(--ink)',
        '--mb-muted': 'var(--ink-soft)',
        '--mb-focus': 'var(--rose)',
        '--mb-glow-alpha': 0.7,
        '--mb-spot-alpha': 0.06
      }}
    />
  );
}

function ProductImage({ service, className = '', eager = false }) {
  const [failed, setFailed] = useState(false);
  const source = serviceImageUrl(service);
  useEffect(() => setFailed(false), [source]);

  if (!source || failed) {
    return (
      <div className={`shop-image-missing ${className}`} aria-hidden="true">
        <span className="shop-image-missing-mark">PM</span>
        <span>Studio photo coming soon</span>
        <small>Upload from the studio image manager</small>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={source}
      alt={service.image_alt || `${service.name} product photo`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function AvailabilityBadge({ value, compact = false }) {
  return (
    <span className={`availability availability--${value || 'unassigned'} ${compact ? 'availability--compact' : ''}`}>
      <span aria-hidden="true" />
      {compact ? availabilityShort(value) : availabilityLabel(value)}
    </span>
  );
}

function ProductCard({ service, onOpen, onQuickAdd, added, index = 0 }) {
  const area = service.pricing_mode === 'area';
  const minimum = Math.max(1, Number(service.min_qty) || 1);
  const needsOptions = area || minimum > 1 || (service.tiers || []).length > 0;
  const price = area ? Number(service.price) : priceForQty(service, minimum);
  const from = area || (service.tiers || []).length > 0 || minimum > 1;
  return (
    <article className="shop-card" style={{ '--card-index': Math.min(index, 8) }}>
      <button
        className="shop-card-media"
        type="button"
        onClick={() => onOpen(service)}
        aria-label={`View ${service.name}${service.video_url ? ', includes preview video' : ''}`}
      >
        <ProductImage service={service} />
        {service.video_url ? <span className="shop-card-play" aria-hidden="true"><Icon name="play" size={18} /></span> : null}
        <span className="shop-card-scrim" aria-hidden="true" />
        <span className="shop-card-hint">Quick view <Icon name="arrow" size={14} /></span>
        {service.popular ? <span className="shop-badge shop-badge--popular">Most booked</span> : null}
        {isBooth(service) ? <span className="shop-badge shop-badge--booth">Booth</span> : null}
      </button>
      <div className="shop-card-body">
        <div className="shop-card-topline">
          <span>{service.category}</span>
          <AvailabilityBadge value={service.booking_availability} compact />
        </div>
        <h3>{service.name}</h3>
        <p>{service.description || 'Made to order by the Precious Moments studio.'}</p>
        <div className="shop-card-bottom">
          <div className="shop-price">
            {from ? <small>from</small> : null}
            <strong>{money(price)}</strong>
            <span>{area ? `per sq ${service.dimension_unit === 'in' ? 'in' : 'ft'}` : service.unit || 'per booking'}</span>
            {minimum > 1 ? <span>· min {minimum}</span> : null}
          </div>
          <div className="shop-card-actions">
            <button className="shop-button shop-button--ghost shop-button--small" type="button" onClick={() => onOpen(service)}>
              Details
            </button>
            <button
              className={`shop-button shop-button--primary shop-button--small ${added ? 'is-added' : ''}`}
              type="button"
              onClick={() => onQuickAdd(service)}
            >
              {added ? <><Icon name="check" size={14} /> Added</> : needsOptions ? 'Choose options' : <><Icon name="plus" size={14} /> Add</>}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductModal({ service, onClose, onAdd }) {
  const area = service.pricing_mode === 'area';
  const minimum = Math.max(1, Number(service.min_qty) || 1);
  const [qty, setQty] = useState(minimum);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const dialog = useRef(null);
  useDialogFocus(true, dialog, onClose);

  useEffect(() => {
    setQty(minimum);
    setWidth('');
    setHeight('');
    setAttempted(false);
    setVideoFailed(false);
    // Intentionally keyed by the product, not the parent's inline close
    // callback, so opening the modal does not reset a half-entered size.
  }, [service, minimum]);

  const estimate = estimateLine(service, { qty, width, height });
  const tierText = tierSummary(service);
  const showError = Boolean(estimate.error) && (attempted || (area && (width !== '' || height !== '')));
  const videoSource = serviceVideoUrl(service);
  const showVideo = Boolean(videoSource) && !videoFailed;

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (estimate.error) return;
    onAdd(service, {
      qty: area ? 1 : Number(qty),
      width: area ? Number(width) : '',
      height: area ? Number(height) : '',
      estimate: estimate.total,
    });
  }

  return (
    <div className="shop-overlay shop-overlay--center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-title" ref={dialog}>
        <button className="icon-button product-modal-close" type="button" onClick={onClose} aria-label="Close product details">×</button>
        <div className="product-modal-media">
          {showVideo ? (
            <video
              className="product-modal-video"
              controls
              playsInline
              preload="metadata"
              poster={serviceImageUrl(service) || undefined}
              aria-label={`${service.name} preview video`}
              onError={() => setVideoFailed(true)}
            >
              <source src={videoSource} type={service.video_mime || undefined} />
            </video>
          ) : (
            <ProductImage service={service} eager />
          )}
          <div className="product-modal-media-note">
            <Icon name={showVideo ? 'play' : 'camera'} size={17} />
            <span>
              {showVideo
                ? 'Studio preview video'
                : service.image_url
                  ? 'Actual studio product photo'
                  : 'The studio will upload an actual product photo here.'}
            </span>
          </div>
        </div>
        <div className="product-modal-copy">
          <div className="product-modal-meta">
            <span>{service.category}</span>
            <AvailabilityBadge value={service.booking_availability} />
          </div>
          <h2 id="product-title">{service.name}</h2>
          <p className="product-modal-description">{service.description || 'Made to order by the Precious Moments studio.'}</p>
          <div className="product-price-line">
            <strong>{money(area ? Number(service.price) : priceForQty(service, minimum))}</strong>
            <span>{area ? `per sq ${service.dimension_unit === 'in' ? 'in' : 'ft'}` : service.unit || 'per booking'}</span>
            {minimum > 1 ? <span>· minimum {minimum}</span> : null}
          </div>
          {tierText ? <p className="shop-hint">{tierText}</p> : null}

          <form className="product-form" onSubmit={submit}>
            {area ? (
              <div className="product-measure">
                <label className="shop-field">
                  <span>Length ({service.dimension_unit === 'in' ? 'in' : 'ft'})</span>
                  <input className="shop-input" inputMode="decimal" type="number" min="0.01" step="0.01" value={width} onChange={(event) => setWidth(event.target.value)} placeholder="2.3" />
                </label>
                <span className="measure-times" aria-hidden="true">×</span>
                <label className="shop-field">
                  <span>Height ({service.dimension_unit === 'in' ? 'in' : 'ft'})</span>
                  <input className="shop-input" inputMode="decimal" type="number" min="0.01" step="0.01" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="5" />
                </label>
              </div>
            ) : (
              <div className="product-quantity-row">
                <span>Quantity</span>
                <div className="quantity-control">
                  <button type="button" onClick={() => setQty((value) => Math.max(minimum, value - 1))} aria-label="Decrease quantity"><Icon name="minus" size={15} /></button>
                  <input
                    className="quantity-input"
                    type="number"
                    min={minimum}
                    max="10000"
                    value={qty}
                    onChange={(event) => setQty(Math.max(minimum, Math.min(10000, Number(event.target.value) || minimum)))}
                    aria-label="Quantity"
                  />
                  <button type="button" onClick={() => setQty((value) => Math.min(10000, value + 1))} aria-label="Increase quantity"><Icon name="plus" size={15} /></button>
                </div>
              </div>
            )}

            {area ? (
              <p className="shop-hint">
                Billed area: {estimate.area ? `${estimate.area} sq ${service.dimension_unit === 'in' ? 'in' : 'ft'}` : 'enter both sides'}.
                {service.round_dimensions_up ? ' Each side is rounded up to the next whole foot.' : ''}
              </p>
            ) : null}
            {showError ? <p className="shop-error" role="alert">{estimate.error}</p> : null}

            <div className="product-form-footer">
              <div>
                <small>Estimated total</small>
                <strong>{estimate.error ? '—' : money(estimate.total)}</strong>
              </div>
              <button className="shop-button shop-button--primary" type="submit" disabled={Boolean(estimate.error)}>
                <Icon name="bag" size={17} /> Add to cart
              </button>
            </div>
          </form>
          <p className="product-assurance"><Icon name="check" size={15} /> No payment is taken now. The studio confirms availability and the final total.</p>
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ open, cart, user, onClose, onQuantity, onRemove, onCheckout, compatibility, suggestions = [], onSuggest }) {
  const total = cart.reduce((sum, line) => sum + Number(line.estimate || 0), 0);
  const count = cart.reduce((sum, line) => sum + (line.pricing_mode === 'area' ? 1 : Number(line.qty) || 0), 0);
  const dialog = useRef(null);
  useDialogFocus(open, dialog, onClose);

  if (!open) return null;

  return (
    <div className="shop-overlay shop-overlay--drawer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" ref={dialog}>
        <header className="cart-head">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 id="cart-title">Cart <span>{plural(count, 'item')}</span></h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close cart">×</button>
        </header>

        {cart.length ? (
          <>
            <div className="cart-lines">
              {cart.map((line) => (
                <article className="cart-line" key={line.key}>
                  <div className="cart-line-media">
                    <ProductImage service={line} />
                  </div>
                  <div className="cart-line-copy">
                    <strong>{line.name}</strong>
                    <span>{line.category}</span>
                    {line.pricing_mode === 'area' ? (
                      <small>{line.length_ft} × {line.height_ft} {line.dimension_unit || 'ft'} · billed area</small>
                    ) : (
                      <div className="cart-line-qty">
                        <button type="button" onClick={() => onQuantity(line, Number(line.qty) - 1)} aria-label={`Decrease ${line.name} quantity`}><Icon name="minus" size={13} /></button>
                        <span>{line.qty}</span>
                        <button type="button" onClick={() => onQuantity(line, Number(line.qty) + 1)} aria-label={`Increase ${line.name} quantity`}><Icon name="plus" size={13} /></button>
                      </div>
                    )}
                  </div>
                  <div className="cart-line-end">
                    <strong>{money(line.estimate)}</strong>
                    <button type="button" className="cart-remove" onClick={() => onRemove(line)} aria-label={`Remove ${line.name}`}><Icon name="trash" size={15} /></button>
                  </div>
                </article>
              ))}
              {suggestions.length ? (
                <section className="cart-suggestions" aria-labelledby="cart-suggestions-title">
                  <div className="cart-suggestions-head">
                    <p className="eyebrow" id="cart-suggestions-title">A little more to love</p>
                    <span>Opens details without losing your cart</span>
                  </div>
                  <AnimatedList
                    items={suggestions}
                    onItemSelect={(item) => onSuggest?.(item.service)}
                    ariaLabel="Suggestions to add to your cart"
                    animation="fade"
                    animateOnce
                    selectOnHover={false}
                    showGradients={false}
                    displayScrollbar={false}
                    frame={false}
                    theme="dark"
                    accentColor="#f0559b"
                    radius={12}
                    gap={6}
                    width="100%"
                    maxHeight={300}
                    stagger={0.04}
                    className="cart-suggestions-list"
                    style={{
                      '--al-tile': 'rgba(255, 255, 255, 0.035)',
                      '--al-tile-edge': 'rgba(255, 170, 206, 0.12)',
                      '--al-tile-highlight': 'rgba(255, 255, 255, 0.05)',
                      '--al-tile-shadow': 'none',
                      '--al-well': 'rgba(255, 255, 255, 0.04)',
                      '--al-ink': 'var(--ink)',
                      '--al-muted': 'var(--ink-faint)',
                      '--al-ring': 'var(--rose)',
                      '--al-ring-fill': 'rgba(240, 85, 155, 0.08)',
                      '--al-hover': 'brightness(1.18)',
                      '--al-active': 'brightness(1.08)',
                      '--al-press': 'brightness(0.9)'
                    }}
                  />
                </section>
              ) : null}
            </div>
            <div className="cart-foot">
              {!compatibility.ok ? <p className="shop-error shop-error--panel">{compatibility.reason}</p> : null}
              <div className="cart-total"><span>Estimated total</span><strong>{money(total)}</strong></div>
              <p className="shop-hint">Final pricing, discounts, and availability are confirmed by the studio.</p>
              {!user ? (
                <p className="shop-hint cart-account-hint">
                  Checkout needs an account. You’ll create one or sign in before the booking form.
                </p>
              ) : null}
              <button className="shop-button shop-button--primary shop-button--block" type="button" onClick={onCheckout} disabled={!compatibility.ok}>
                Continue to checkout <Icon name="arrow" size={17} />
              </button>
              <button className="text-button cart-continue" type="button" onClick={onClose}>Continue browsing</button>
            </div>
          </>
        ) : (
          <div className="cart-empty">
            <span className="cart-empty-mark" aria-hidden="true">PM</span>
            <h3>A little room for something lovely.</h3>
            <p>Browse prints, keepsakes, and booths, then add the pieces you want to book.</p>
            <button className="shop-button shop-button--primary" type="button" onClick={onClose}>Explore the collection</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function SuccessModal({ booking, onClose }) {
  const dialog = useRef(null);
  useDialogFocus(Boolean(booking), dialog, onClose);
  if (!booking) return null;
  return (
    <div className="shop-overlay shop-overlay--center">
      <div className="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title" ref={dialog}>
        <span className="success-mark" aria-hidden="true"><Icon name="check" size={30} /></span>
        <p className="eyebrow">Request received</p>
        <h2 id="success-title">Your moment is in our hands.</h2>
        <p>
          Booking <strong>{booking.ref}</strong> is waiting for the studio to confirm the date. We’ll keep every update,
          payment, and design detail in your dashboard.
        </p>
                  <div className="success-summary">
          <div><span>Booking</span><strong>{booking.ref}</strong></div>
          <div><span>Type</span><strong>{booking.booking_type === 'pickup' ? 'Pickup' : 'Event'}</strong></div>
          <div><span>Date</span><strong>{formatDate(booking.event_date || booking.pickup_date, { weekday: true, year: true })}</strong></div>
          <div><span>Estimated total</span><strong>{money(booking.total)}</strong></div>
        </div>
        <p className="shop-hint">No payment has been taken. The studio will send the reservation details after confirming the calendar.</p>
        <div className="success-actions">
          <a className="shop-button shop-button--primary" href="/app#bookings">View my bookings <Icon name="arrow" size={16} /></a>
          <button className="shop-button" type="button" onClick={onClose}>Keep browsing</button>
        </div>
      </div>
    </div>
  );
}

function Header({ user, cartCount, onCart, onSignIn, onRegister, onLogout, onMenu }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const accountRef = useRef(null);
  const accountButtonRef = useRef(null);
  const firstName = user?.name?.split(' ')[0] || 'Account';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const onPointerDown = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);

  return (
    <header className={`shop-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="shop-container shop-nav">
        <a className="shop-brand" href="/shop" aria-label="Precious Moments shop home">
          <span className="brand-seal">PM</span>
          <span className="brand-words">
            <span className="brand-name">Precious Moments</span>
            <span className="brand-sub">print, photo &amp; booth</span>
          </span>
        </a>
        <nav className="shop-links" aria-label="Shop">
          <a href="#catalog">The collection</a>
          <a href="#booths">Booths</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="shop-nav-actions">
          {user ? (
            <div className="account-menu" ref={accountRef}>
              <button
                className="shop-account"
                type="button"
                ref={accountButtonRef}
                aria-expanded={accountOpen}
                aria-haspopup="true"
                aria-controls="shop-account-popover"
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span className="account-avatar">{firstName.slice(0, 1).toUpperCase()}</span>
                <span>{firstName}</span>
                <Icon name="chevron" size={14} />
              </button>
              {accountOpen ? (
                <div className="account-popover" id="shop-account-popover">
                  <a href="/app#bookings" onClick={() => setAccountOpen(false)}>My bookings</a>
                  {user.role === 'admin' || user.role === 'branch_admin' ? <a href="/app" onClick={() => setAccountOpen(false)}>Studio dashboard</a> : null}
                  <button type="button" onClick={() => { setAccountOpen(false); onLogout(); }}><Icon name="logout" size={15} /> Sign out</button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <button className="text-button shop-signin" type="button" onClick={onSignIn}>Sign in</button>
              <button className="shop-button shop-button--small shop-button--outline" type="button" onClick={onRegister}>Create account</button>
            </>
          )}
          <button className="shop-cart-button" type="button" onClick={onCart} aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>
            <Icon name="bag" size={20} />
            <span>Cart</span>
            {cartCount ? <b key={cartCount} className="cart-count">{cartCount}</b> : null}
          </button>
          <button className="shop-menu-button" type="button" onClick={onMenu} aria-label="Open menu" aria-haspopup="dialog" aria-controls="shop-mobile-nav"><Icon name="menu" size={22} /></button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="shop-footer">
      <div className="shop-container shop-footer-grid">
        <div>
          <a className="shop-brand" href="/shop">
            <span className="brand-seal">PM</span>
            <span className="brand-words"><span className="brand-name">Precious Moments</span><span className="brand-sub">print, photo &amp; booth</span></span>
          </a>
          <p>Made-to-keep prints, keepsakes, photo coverage, and booths in Batangas.</p>
        </div>
        <div><span>Explore</span><a href="#catalog">The collection</a><a href="#booths">Booths</a><a href="#how">How it works</a></div>
        <div><span>Studio</span><a href="/shop#how">How it works</a><a href="/app">My dashboard</a><a href="/shop?auth=signin">Studio sign-in</a></div>
        <div><span>Visit</span><p>Batangas City · Bauan<br />Monday–Saturday, 9:00 AM–6:00 PM</p><p className="shop-footer-note">Prices in PHP. Final totals confirmed by the studio.</p></div>
      </div>
      <div className="shop-container shop-footer-bottom">
        <span>© {new Date().getFullYear()} Precious Moments</span>
        <span>Prints · Photo · Booths</span>
      </div>
    </footer>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState({ services: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [cart, setCart] = useState(loadCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [product, setProduct] = useState(null);
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authReason, setAuthReason] = useState('');
  const [authRedirect, setAuthRedirect] = useState(AUTH_NEXT);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [success, setSuccess] = useState(null);
  const [toast, setToast] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [added, setAdded] = useState('');
  const toastTimer = useRef(null);
  const addedTimer = useRef(null);
  const mobileNavRef = useRef(null);

  useDialogFocus(Boolean(mobileOpen), mobileNavRef, () => setMobileOpen(false));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const [catalogData, me] = await Promise.all([
          api('/api/services'),
          api('/api/auth/me').catch((error) => (error.status === 401 ? { user: null } : Promise.reject(error))),
        ]);
        if (cancelled) return;
        setCatalog({ services: catalogData.services || [], categories: catalogData.categories || [] });
        setUser(me.user || null);
        if (me.user) {
          if (AUTH_NEXT && AUTH_NEXT !== '/shop' && AUTH_NEXT !== '/shop/') {
            window.location.replace(AUTH_NEXT);
            return;
          }
          return;
        }
        if (AUTH_MODE_QUERY === 'signin' || AUTH_MODE_QUERY === 'register') {
          setAuthMode(AUTH_MODE_QUERY);
          setAuthReason(
            AUTH_EXPIRED
              ? 'Your session ended to keep your account safe. Sign in again and we will take you back to where you were.'
              : ''
          );
          setAuthOpen(true);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'The collection could not load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => saveCart(cart), [cart]);

  const overlayOpen = Boolean(cartOpen || product || authOpen || checkoutOpen || success || mobileOpen);
  useEffect(() => {
    document.body.classList.toggle('shop-no-scroll', overlayOpen);
  }, [overlayOpen]);
  useEffect(() => () => document.body.classList.remove('shop-no-scroll'), []);

  useEffect(() => {
    const nodes = [...document.querySelectorAll('[data-reveal]')];
    if (!nodes.length) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-revealed'));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('is-pending');
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    nodes.forEach((node) => {
      if (node.getBoundingClientRect().top < window.innerHeight * 0.92) {
        node.classList.add('is-revealed');
        return;
      }
      node.classList.add('is-pending');
      observer.observe(node);
    });
    return () => {
      observer.disconnect();
      nodes.forEach((node) => node.classList.remove('is-pending'));
    };
  }, []);

  useEffect(() => {
    if (!user || !pendingCheckout) return;
    setPendingCheckout(false);
    setCartOpen(false);
    setCheckoutOpen(true);
  }, [user, pendingCheckout]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (addedTimer.current) window.clearTimeout(addedTimer.current);
    };
  }, []);

  function showToast(message, tone = 'success') {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }

  const services = useMemo(
    () =>
      (catalog.services || []).filter(
        (service) => service.active !== false && service.catalog_visible !== false && !LEGACY_SIZED_TARPAULINS.has(service.id)
      ),
    [catalog.services]
  );

  const categoryNames = useMemo(
    () => (catalog.categories || []).map((category) => category.name).filter((name) => services.some((service) => service.category === name)),
    [catalog.categories, services]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return services
      .filter((service) => {
        if (filter === 'booths') return isBooth(service);
        if (filter !== 'all' && service.category !== filter) return false;
        return true;
      })
      .filter((service) => {
        if (!term) return true;
        return `${service.name} ${service.category} ${service.description}`.toLowerCase().includes(term);
      })
      .sort((a, b) => Number(b.popular) - Number(a.popular) || Number(a.sort || 0) - Number(b.sort || 0));
  }, [services, filter, query]);

  const compatibility = useMemo(() => cartCompatibility(cart), [cart]);
  const cartCount = cart.reduce((sum, line) => sum + (line.pricing_mode === 'area' ? 1 : Number(line.qty) || 0), 0);
  const cartTotal = cart.reduce((sum, line) => sum + Number(line.estimate || 0), 0);

  const reelItems = useMemo(() => {
    const candidates = [...services]
      .sort((a, b) => Number(b.popular) - Number(a.popular) || Number(a.sort || 0) - Number(b.sort || 0))
      .map((service) => ({
        id: service.id,
        src: stableImageUrl(service),
        alt: service.image_alt || `${service.name} from the Precious Moments studio`,
        title: service.name,
        subtitle: service.category,
        service
      }))
      .filter((item) => item.src);
    const picks = [];
    const categories = new Set();
    for (const item of candidates) {
      if (picks.length >= 8) break;
      if (categories.has(item.subtitle)) continue;
      categories.add(item.subtitle);
      picks.push(item);
    }
    if (picks.length < 4) {
      const used = new Set(picks.map((item) => item.id));
      for (const item of candidates) {
        if (picks.length >= 8) break;
        if (used.has(item.id)) continue;
        used.add(item.id);
        picks.push(item);
      }
    }
    return picks;
  }, [services]);

  const cartSuggestions = useMemo(() => {
    if (!cart.length || !compatibility.ok) return [];
    const inCart = new Set(cart.map((line) => line.service_id));
    const only = compatibility.event && !compatibility.pickup ? 'event' : compatibility.pickup && !compatibility.event ? 'pickup' : '';
    return [...services]
      .filter((service) => !inCart.has(service.id) && service.booking_availability !== 'unassigned')
      .filter((service) => !only || supportsType(service, only))
      .sort((a, b) => Number(b.popular) - Number(a.popular) || Number(a.sort || 0) - Number(b.sort || 0))
      .slice(0, 4)
      .map((service) => {
        const image = stableImageUrl(service);
        const qty = Math.max(1, Number(service.min_qty) || 1);
        return {
          id: service.id,
          title: service.name,
          description: service.category,
          meta: service.pricing_mode === 'area' ? `${money(service.price)}/${service.dimension_unit || 'ft'}` : money(priceForQty(service, qty)),
          ...(image ? { image } : { icon: <Icon name="spark" size={16} /> }),
          service
        };
      });
  }, [cart, compatibility, services]);

  function lineFromService(service, { qty, width, height, estimate }) {
    return {
      key: cartLineKey(service.id, width, height),
      service_id: service.id,
      name: service.name,
      category: service.category,
      unit: service.unit,
      pricing_mode: service.pricing_mode,
      price: Number(service.price),
      image_url: service.image_url || '',
      image_alt: service.image_alt || '',
      image_updated_at: service.image_updated_at || null,
      booking_availability: service.booking_availability,
      dimension_unit: service.dimension_unit || 'ft',
      min_qty: Number(service.min_qty) || 1,
      tiers: service.tiers || [],
      base_fee: Number(service.base_fee) || 0,
      qty: service.pricing_mode === 'area' ? 1 : Number(qty),
      length_ft: service.pricing_mode === 'area' ? Number(width) : '',
      height_ft: service.pricing_mode === 'area' ? Number(height) : '',
      estimate: Number(estimate),
    };
  }

  function addLine(service, { qty = 1, width = '', height = '', estimate }) {
    const key = cartLineKey(service.id, width, height);
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing && service.pricing_mode !== 'area') {
        const nextQty = Math.min(10000, Number(existing.qty) + Number(qty));
        const nextEstimate = estimateLine(service, { qty: nextQty, width: existing.length_ft, height: existing.height_ft });
        if (nextEstimate.error) return current;
        return current.map((line) => (line.key === key ? { ...line, qty: nextQty, estimate: nextEstimate.total } : line));
      }
      if (existing) return current;
      return [...current, lineFromService(service, { qty, width, height, estimate })];
    });
    setAdded(service.id);
    if (addedTimer.current) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setAdded(''), 1300);
    showToast(`${service.name} added to your cart.`);
  }

  function quickAdd(service) {
    if (service.pricing_mode === 'area' || (service.tiers || []).length || Number(service.min_qty) > 1) {
      setProduct(service);
      return;
    }
    const estimate = estimateLine(service, { qty: 1 });
    if (estimate.error) {
      setProduct(service);
      return;
    }
    addLine(service, { qty: 1, estimate: estimate.total });
  }

  function updateQuantity(line, nextQty) {
    if (line.pricing_mode === 'area') return;
    const service = services.find((row) => row.id === line.service_id);
    if (!service) return;
    const qty = Math.max(Math.max(1, Number(service.min_qty) || 1), Math.min(10000, Number(nextQty) || 1));
    const estimate = estimateLine(service, { qty });
    if (estimate.error) {
      showToast(estimate.error, 'error');
      return;
    }
    setCart((current) => current.map((item) => (item.key === line.key ? { ...item, qty, estimate: estimate.total } : item)));
  }

  function removeLine(line) {
    setCart((current) => current.filter((item) => item.key !== line.key));
    showToast(`${line.name} removed.`, 'neutral');
  }

  function beginCheckout() {
    if (!cart.length) return;
    if (!compatibility.ok) {
      setCartOpen(true);
      showToast(compatibility.reason, 'error');
      return;
    }
    if (!user) {
      setPendingCheckout(true);
      setAuthRedirect('');
      setAuthMode('register');
      setAuthReason('Your cart is saved. Create an account to continue, or sign in if you already have one.');
      setAuthOpen(true);
      return;
    }
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  function openAuth(mode, reason = '') {
    setAuthRedirect('');
    setAuthMode(mode);
    setAuthReason(reason);
    setAuthOpen(true);
  }

  function requireCheckoutAuth() {
    setCheckoutOpen(false);
    setCartOpen(false);
    setUser(null);
    setPendingCheckout(true);
    setAuthRedirect('');
    setAuthMode('signin');
    setAuthReason('Your session expired. Sign in again to finish your booking. Your cart is saved.');
    setAuthOpen(true);
  }

  function handleAuthenticated(nextUser) {
    setUser(nextUser);
    setAuthOpen(false);
    showToast(`Welcome, ${nextUser.name?.split(' ')[0] || 'friend'}.`);
    if (nextUser.role === 'admin' || nextUser.role === 'branch_admin') {
      window.location.assign(authRedirect || '/app');
      return;
    }
    if (authRedirect) {
      window.location.assign(authRedirect);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // The local session is over even if the network request failed.
    }
    setUser(null);
    showToast('Signed out.');
  }

  function closeCheckout() {
    setCheckoutOpen(false);
    const focusCart = () => document.querySelector('.shop-cart-button')?.focus({ preventScroll: true });
    window.requestAnimationFrame(focusCart);
    window.setTimeout(focusCart, 120);
  }

  function bookingSuccess(booking) {
    setCheckoutOpen(false);
    setCart([]);
    setSuccess(booking);
    setCartOpen(false);
  }

  function jumpTo(filterName) {
    setFilter(filterName);
    setMobileOpen(false);
    window.requestAnimationFrame(() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return (
    <div className="shop-shell">
      <a className="skip-link" href="#catalog">Skip to the collection</a>
      <Header
        user={user}
        cartCount={cartCount}
        onCart={() => setCartOpen(true)}
        onSignIn={() => openAuth('signin')}
        onRegister={() => openAuth('register')}
        onLogout={logout}
        onMenu={() => setMobileOpen(true)}
      />

      {mobileOpen ? (
        <div className="shop-overlay shop-overlay--drawer" onMouseDown={(event) => event.target === event.currentTarget && setMobileOpen(false)}>
          <div className="mobile-nav" id="shop-mobile-nav" role="dialog" aria-modal="true" aria-label="Menu" ref={mobileNavRef}>
            <div className="mobile-nav-head">
              <span className="brand-seal">PM</span>
              <button className="icon-button" type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu">×</button>
            </div>
            <nav>
              <button type="button" onClick={() => jumpTo('all')}>The collection <Icon name="arrow" size={16} /></button>
              <button type="button" onClick={() => jumpTo('booths')}>Booths <Icon name="arrow" size={16} /></button>
              <a href="#how" onClick={() => setMobileOpen(false)}>How it works <Icon name="arrow" size={16} /></a>
            </nav>
            <div className="mobile-nav-actions">
              {user ? (
                <>
                  <a className="shop-button shop-button--primary" href="/app#bookings">My bookings</a>
                  <button className="shop-button" type="button" onClick={() => { setMobileOpen(false); logout(); }}>Sign out</button>
                </>
              ) : (
                <>
                  <button className="shop-button shop-button--primary" type="button" onClick={() => { setMobileOpen(false); openAuth('register'); }}>Create an account</button>
                  <button className="shop-button" type="button" onClick={() => { setMobileOpen(false); openAuth('signin'); }}>Sign in</button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <main>
        <section className="shop-hero">
          <div className="shop-container hero-grid">
            <div className="hero-copy">
              <p className="eyebrow"><span className="live-dot" /> Batangas · now booking 2026 &amp; 2027</p>
              <h1>Prints, booths, and keepsakes for the <em>moments you keep.</em></h1>
              <p className="hero-lede">
                Browse the live collection, add what you love to your cart, and send one booking request.
                No account needed to explore — we’ll only ask when you’re ready to confirm.
              </p>
              <div className="hero-actions">
                <SpecularButton
                  size="md"
                  radius={999}
                  tint="#f0559b"
                  tintOpacity={0.22}
                  textColor="#fff7fb"
                  lineColor="#ffc0d8"
                  baseColor="#7a344f"
                  intensity={1.15}
                  idleIntensity={0.4}
                  shineSize={16}
                  shineFade={46}
                  thickness={1.5}
                  glow={1}
                  proximity={260}
                  className="hero-specular"
                  onClick={() => jumpTo('all')}
                >
                  Explore the collection <Icon name="arrow" size={18} />
                </SpecularButton>
                <button className="shop-button shop-button--large" type="button" onClick={() => jumpTo('booths')}>
                  <Icon name="camera" size={18} /> Meet the booths
                </button>
              </div>
              <div className="hero-proof">
                <span><strong>{loading ? '…' : services.length}</strong> made-to-order pieces</span>
                <span><strong>2</strong> Batangas branches</span>
                <span><strong>1–2</strong> day pickup</span>
              </div>
            </div>
            <div className="hero-board" aria-label="Booth inventory and booking information">
              <div className="hero-board-head">
                <span>Studio floor</span>
                <span className="hero-board-status"><span /> Ready for dates</span>
              </div>
              <div className="hero-booth-grid">
                {Object.entries(BOOTH_TYPES).map(([key, booth]) => (
                  <div className="hero-booth" key={key}>
                    <span className="hero-booth-icon"><Icon name="camera" size={18} /></span>
                    <div><strong>{booth.label}</strong><span>{booth.units} {booth.units === 1 ? 'unit' : 'units'}</span></div>
                  </div>
                ))}
              </div>
              <div className="hero-board-note">
                <Icon name="calendar" size={17} />
                <p><strong>Dates are confirmed by the studio.</strong> Your request is checked against the live calendar and physical booth units before it is accepted.</p>
              </div>
              <div className="hero-board-seal" aria-hidden="true"><span>PM</span><small>made to keep</small></div>
            </div>
          </div>
        </section>

        <section className="shop-trust">
          <div className="shop-container trust-row">
            <span><Icon name="check" size={16} /> No account needed to browse</span>
            <span><Icon name="bag" size={16} /> Cart saved on this device</span>
            <span><Icon name="camera" size={16} /> Real studio product photos</span>
            <span><Icon name="clock" size={16} /> Pickup ready in 1–2 days</span>
          </div>
        </section>

        {!loading && reelItems.length >= 3 ? (
          <section className="shop-reel" aria-labelledby="reel-title">
            <div className="shop-container">
              <div className="reel-head" data-reveal>
                <div>
                  <p className="eyebrow">A look around the studio</p>
                  <h2 id="reel-title">Pieces with a <em>little more heart.</em></h2>
                </div>
                <p className="reel-note">Real prints, keepsakes, and booth setups from Batangas. Drag the ring or open a piece to see its details.</p>
              </div>
              <div className="reel-stage">
                <CircularCarousel
                  items={reelItems}
                  preset="cylinder"
                  intro="rise"
                  cardWidth={210}
                  aspectRatio={0.78}
                  gap={22}
                  autoplay={product ? 'off' : 'drift'}
                  speed={8}
                  direction="left"
                  pauseOnHover
                  captions
                  cornerRadius={16}
                  fadeColor="#080508"
                  onItemClick={(item) => {
                    if (item?.service) setProduct(item.service);
                  }}
                />
              </div>
            </div>
          </section>
        ) : null}

        <section className="shop-catalog" id="catalog">
          <div className="shop-container">
            <div className="catalog-head" data-reveal>
              <div>
                <p className="eyebrow">The collection</p>
                <h2>Find your <em>something lovely.</em></h2>
                <p>Browse the live catalog. Prices and availability are read directly from the studio system.</p>
              </div>
              <div className="catalog-search">
                <Icon name="search" size={19} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search prints, booths, keepsakes…"
                  aria-label="Search the collection"
                />
                {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={15} /></button> : null}
              </div>
            </div>

            <div className="catalog-tabs" role="group" aria-label="Filter by category">
              <button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All pieces <span>{services.length}</span></button>
              <button type="button" aria-pressed={filter === 'booths'} className={filter === 'booths' ? 'active' : ''} onClick={() => setFilter('booths')} id="booths">Booths <span>{services.filter(isBooth).length}</span></button>
              {categoryNames.map((category) => (
                <button type="button" key={category} aria-pressed={filter === category} className={filter === category ? 'active' : ''} onClick={() => setFilter(category)}>
                  {category} <span>{services.filter((service) => service.category === category).length}</span>
                </button>
              ))}
            </div>

            <div className="catalog-resultbar" aria-live="polite">
              <span>{loading ? 'Opening the collection…' : `${plural(filtered.length, 'piece')}${query ? ` for “${query}”` : ''}`}</span>
              {!loading ? <span className="catalog-sort"><Icon name="spark" size={15} /> Studio favourites first</span> : null}
            </div>

            {loading ? (
              <div className="shop-grid" aria-label="Loading products" aria-busy="true">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div className="shop-card skeleton-card" key={index}>
                    <span className="skeleton skeleton-media" />
                    <div className="skeleton-copy"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line skeleton-line--short" /><span className="skeleton skeleton-line" /></div>
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="catalog-empty">
                <span className="empty-mark">!</span>
                <h3>The collection is taking a moment.</h3>
                <p>{loadError}</p>
                <button className="shop-button shop-button--primary" type="button" onClick={() => window.location.reload()}>Try again</button>
              </div>
            ) : filtered.length ? (
              <div className="shop-grid">
                {filtered.map((service, index) => (
                  <ProductCard
                    key={service.id}
                    service={service}
                    onOpen={setProduct}
                    onQuickAdd={quickAdd}
                    added={added === service.id}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="catalog-empty">
                <span className="empty-mark">PM</span>
                <h3>Nothing matches that just yet.</h3>
                <p>Try a different word or clear the category filter. The whole collection is still here.</p>
                <button className="shop-button shop-button--primary" type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Show everything</button>
              </div>
            )}
          </div>
        </section>

        <section className="shop-how" id="how">
          <div className="shop-container">
            <div className="how-head" data-reveal><p className="eyebrow">A simple, careful process</p><h2>From “I love that” to <em>“it’s ours.”</em></h2></div>
            <ProcessBento />
          </div>
        </section>
      </main>

      <Footer />

      <button className={`floating-cart ${cartCount ? 'has-items' : ''}`} type="button" onClick={() => setCartOpen(true)} aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>
        <Icon name="bag" size={20} />
        <span>{cartCount ? plural(cartCount, 'item') : 'Your cart'}</span>
        {cartCount ? <strong>{money(cartTotal)}</strong> : null}
      </button>

      <CartDrawer
        open={cartOpen}
        cart={cart}
        user={user}
        onClose={() => setCartOpen(false)}
        onQuantity={updateQuantity}
        onRemove={removeLine}
        onCheckout={beginCheckout}
        compatibility={compatibility}
        suggestions={cartSuggestions}
        onSuggest={setProduct}
      />

      {product ? (
        <ProductModal
          service={product}
          onClose={() => setProduct(null)}
          onAdd={(service, selection) => {
            addLine(service, selection);
            setProduct(null);
          }}
        />
      ) : null}

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        reason={authReason}
        onClose={() => {
          setAuthOpen(false);
          setPendingCheckout(false);
          setAuthRedirect('');
          const url = new URL(window.location.href);
          if (url.searchParams.has('auth') || url.searchParams.has('expired')) {
            url.searchParams.delete('auth');
            url.searchParams.delete('expired');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
          }
        }}
        onSuccess={handleAuthenticated}
      />

      <CheckoutModal
        open={checkoutOpen}
        cart={cart}
        user={user}
        onClose={closeCheckout}
        onRequireAuth={requireCheckoutAuth}
        onSuccess={bookingSuccess}
      />

      <SuccessModal booking={success} onClose={() => setSuccess(null)} />

      {toast ? (
        <div key={toast.message} className={`shop-toast shop-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.tone === 'error' ? '!' : '✓'}</span>
          <p>{toast.message}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><Icon name="close" size={14} /></button>
          <i className="shop-toast-progress" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
