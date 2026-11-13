export const CART_KEY = 'pm_shop_cart_v2';

// The old fixed tarp sizes remain in the database for old bookings, but the
// live catalog now sells the measured Tarpaulin product instead.
export const LEGACY_SIZED_TARPAULINS = new Set([
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

export const BOOTH_TYPES = {
  photobooth: { label: 'Photobooth', units: 5 },
  video: { label: 'Video booth', units: 1 },
  mirror: { label: 'Mirror booth', units: 1 },
  studio: { label: 'Studio booth', units: 2 },
};

export const BOOTH_SERVICE_GROUPS = {
  photobooth: [
    'photobooth-4r',
    'photobooth-4r-magnetic',
    'photobooth-strips',
    'photobooth-strips-magnetic',
  ],
  video: ['booth-360'],
  mirror: ['booth-mirror'],
  studio: ['booth-studio'],
};

export const BOOTH_SERVICE_IDS = new Set(
  Object.values(BOOTH_SERVICE_GROUPS).flat()
);

const numberFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

const numberFormatterPrecise = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? numberFormatter.format(number) : numberFormatterPrecise.format(number);
}

export function number(value) {
  return Number(value) || 0;
}

export function todayISO() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function tomorrowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatDate(value, options = {}) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-PH', {
    weekday: options.weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: options.year ? 'numeric' : undefined,
  });
}

export function isBooth(service) {
  return BOOTH_SERVICE_IDS.has(service?.id);
}

export function boothTypeFor(serviceId) {
  for (const [type, ids] of Object.entries(BOOTH_SERVICE_GROUPS)) {
    if (ids.includes(serviceId)) return type;
  }
  return null;
}

export function tierFor(service, qty) {
  const tiers = service?.tiers || [];
  if (!tiers.length) return null;
  return (
    tiers.find(
      (row) =>
        qty >= number(row.min) &&
        (row.max === null || row.max === undefined || qty <= number(row.max))
    ) || null
  );
}

export function priceForQty(service, qty) {
  const tier = tierFor(service, qty);
  return number(tier ? tier.price : service?.price);
}

export function startingPrice(service) {
  if (!service) return 0;
  if (service.pricing_mode === 'area') {
    return Math.round(number(service.price) * number(service.min_area || 1) + number(service.base_fee));
  }
  const qty = Math.max(1, number(service.min_qty) || 1);
  return Math.round(priceForQty(service, qty) * qty + number(service.base_fee));
}

export function tierSummary(service) {
  return (service?.tiers || [])
    .map((row) => `${row.label || `${row.min}${row.max ? `–${row.max}` : '+'} pcs`} ${money(row.price)}`)
    .join(' · ');
}

/**
 * Client-side estimate only. The server recalculates every line in
 * `priceLine()`; this function exists to give immediate, understandable
 * numbers in the cart and product preview.
 */
export function estimateLine(service, { qty, width, height } = {}) {
  if (!service) return { total: 0, error: 'Product not found.' };
  const baseFee = number(service.base_fee);
  if (service.pricing_mode === 'area') {
    const widthValue = Number(width);
    const heightValue = Number(height);
    const min = number(service.min_dimension) || 1;
    const max = number(service.max_dimension) || (service.dimension_unit === 'in' ? 120 : 50);
    if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue) || widthValue <= 0 || heightValue <= 0) {
      return { total: 0, error: 'Enter a length and height greater than zero.' };
    }
    if (widthValue < min || heightValue < min || widthValue > max || heightValue > max) {
      return {
        total: 0,
        error: `Dimensions must be between ${min} and ${max} ${service.dimension_unit === 'in' ? 'in' : 'ft'}.`,
      };
    }
    const roundUp = service.round_dimensions_up === true;
    const billedWidth = roundUp ? Math.ceil(Math.round(widthValue * 1000) / 1000) : widthValue;
    const billedHeight = roundUp ? Math.ceil(Math.round(heightValue * 1000) / 1000) : heightValue;
    const area = Math.max(number(service.min_area) || 0, billedWidth * billedHeight);
    return {
      total: Math.round(area * number(service.price) + baseFee),
      unitPrice: number(service.price),
      area: Number(area.toFixed(2)),
      billedWidth,
      billedHeight,
      widthValue,
      heightValue,
      error: '',
    };
  }

  const minimum = Math.max(1, number(service.min_qty) || 1);
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < minimum) {
    return { total: 0, error: `Quantity must be at least ${minimum}.` };
  }
  const tier = tierFor(service, quantity);
  if ((service.tiers || []).length && !tier) {
    return {
      total: 0,
      error: `That quantity is between published price breaks. Ask the studio for a quote.`,
    };
  }
  const unitPrice = number(tier ? tier.price : service.price);
  return {
    total: Math.round(quantity * unitPrice + baseFee),
    unitPrice,
    qty: quantity,
    tierLabel: tier?.label || '',
    error: '',
  };
}

export function serviceImageUrl(service) {
  const url = String(service?.image_url || '');
  if (!url) return '';
  if (url.startsWith('/uploads/') && service.image_updated_at) {
    return `${url}?v=${encodeURIComponent(String(service.image_updated_at))}`;
  }
  return url;
}

export function availabilityLabel(value) {
  if (value === 'pickup') return 'Pickup at the branch';
  if (value === 'event') return 'Event deployment';
  if (value === 'both') return 'Pickup or event';
  return 'Ask the studio';
}

export function availabilityShort(value) {
  if (value === 'pickup') return 'Pickup';
  if (value === 'event') return 'Event';
  if (value === 'both') return 'Pickup or event';
  return 'Ask';
}

export function supportsType(service, type) {
  const availability = service?.booking_availability || 'unassigned';
  return availability === 'both' || availability === type;
}

/**
 * Which checkout type(s) a cart can use. A cart containing a pickup-only item
 * and an event-only item cannot be checked out as one booking.
 */
export function cartCompatibility(lines) {
  if (!lines.length) return { pickup: false, event: false, ok: false, reason: 'Your cart is empty.' };
  const values = new Set(lines.map((line) => line.booking_availability || 'unassigned'));
  if (values.has('unassigned')) {
    return {
      pickup: false,
      event: false,
      ok: false,
      reason: 'One item needs a studio confirmation before it can be booked. Remove it or ask the studio.',
    };
  }
  const hasPickupOnly = values.has('pickup');
  const hasEventOnly = values.has('event');
  if (hasPickupOnly && hasEventOnly) {
    return {
      pickup: false,
      event: false,
      ok: false,
      reason: 'Pickup-only items and event-only items cannot share one booking. Remove one group and check out separately.',
    };
  }
  if (hasPickupOnly) return { pickup: true, event: false, ok: true, reason: '' };
  if (hasEventOnly) return { pickup: false, event: true, ok: true, reason: '' };
  return { pickup: true, event: true, ok: true, reason: '' };
}

export function cartLineKey(serviceId, width = '', height = '') {
  return `${serviceId}|${width === '' ? '' : Number(width)}|${height === '' ? '' : Number(height)}`;
}

export function loadCart() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line) =>
        line &&
        typeof line.service_id === 'string' &&
        Number.isFinite(Number(line.qty)) &&
        Number(line.qty) > 0
    );
  } catch {
    return [];
  }
}

export function saveCart(lines) {
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    // A private browser can refuse localStorage. The in-memory cart still works.
  }
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
