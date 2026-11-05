/**
 * The studio's price catalog: the single source of truth for what is sold and
 * what it costs. Seeded into the database on first start, then served by
 * `/api/services` to the marketing page, the booking form, and the assistant.
 *
 * The 2026 sheet is the reference. Where the workbook also had a `Sheet2`
 * value that disagreed, the Price Rearrange value is used and the item carries
 * `needs_review` plus an entry in `PRICE_REVIEWS`, so the owner can confirm it
 * instead of the system silently guessing.
 *
 * Pricing modes:
 *  - `area`  — price is per square foot (or square inch for decals), with a
 *              minimum billable area and an optional one-off setup fee.
 *  - `fixed` — price is per unit, optionally with a hard minimum quantity and
 *              quantity price breaks in `tiers`.
 *
 * Money is stored in whole pesos. `line_total` is always computed on the server
 * (see `priceLine`) so a tampered request cannot invent a price.
 *
 * Quantity tiers are inclusive: `{ min: 1, max: 29 }` covers 1 through 29, and
 * `max: null` means "and above". A quantity that falls in a gap between two
 * published breaks is refused with a quote request rather than priced by
 * guessing — for example, key holders are published at 1–50 and 100+ only.
 */
export const CATEGORIES = [
  {
    name: 'Stickers and Decals',
    note: 'Pre-cut or print-only, from a single piece to a full sheet.',
  },
  {
    name: 'Souvenirs and Personalized Items',
    note: 'Keepsakes guests take home and keep on the fridge.',
  },
  {
    name: 'Photo Printing and Frames',
    note: 'Prints, sintra boards, and frames in the sizes clients ask for.',
  },
  {
    name: 'Invitations and Printing',
    note: 'Invitations, passes, button pins, and paper pads.',
  },
  {
    name: 'Business Cards and IDs',
    note: 'Cards, PVC IDs, vellum, laces, and lanyard packages.',
  },
  {
    name: 'Plates and Sintra',
    note: 'Temporary and motorcycle plates, standees, and boards.',
  },
  {
    name: 'T-shirt and Apparel Printing',
    note: 'Shirt prints by brand and size run.',
  },
  {
    name: 'Tarpaulin and Signage',
    note: 'Measured tarps and blackout, roll-ups, banners, and signboards.',
  },
  {
    name: 'Photography and Videography',
    note: 'Coverage, albums on the day, and photoman services.',
  },
  {
    name: 'Albums and Other Services',
    note: 'Albums, large prints, framing, SDE, and LED walls.',
  },
];

/** Kept out of the public catalog and rate card: client-specific pricing. */
export const CLIENT_CATEGORY = {
  name: 'Special Client Pricing',
  note: 'Client-specific tarpaulin and standee rates. Never applied to retail prices.',
};

/**
 * Where a product can be ordered. Existing products are classified by the way
 * the studio actually sells them; the owner can change every row from the
 * Pricing page. `unassigned` is deliberately hidden from both customer flows
 * until the owner configures it.
 */
const AVAILABILITY_BY_CATEGORY = {
  'Stickers and Decals': 'pickup',
  'Souvenirs and Personalized Items': 'both',
  'Photo Printing and Frames': 'pickup',
  'Invitations and Printing': 'pickup',
  'Business Cards and IDs': 'pickup',
  'Plates and Sintra': 'pickup',
  'T-shirt and Apparel Printing': 'pickup',
  'Tarpaulin and Signage': 'both',
  'Photography and Videography': 'event',
  'Albums and Other Services': 'pickup',
};

// A few rows do not follow their category: albums include event-only work, and
// a frame rental can be taken out or used at the event.
const AVAILABILITY_OVERRIDES = {
  sde: 'event',
  'led-wall': 'event',
  'frame-metal-rent': 'both',
};

let nextSort = 10;

/**
 * One catalog row with safe defaults. Keeping the defaults here means editing a
 * price later is a one-line change and no field is accidentally left undefined.
 */
function service(id, name, category, price, unit, extra = {}) {
  const row = {
    id,
    name,
    category,
    description: extra.description || `Priced ${unit}.`,
    price,
    unit,
    pricing_mode: 'fixed',
    min_area: null,
    min_qty: null,
    tiers: [],
    base_fee: 0,
    dimension_unit: 'ft',
    image_url: '',
    image_alt: '',
    image_updated_at: null,
    image_updated_by: null,
    image_width: null,
    image_height: null,
    catalog_visible: true,
    round_dimensions_up: false,
    min_dimension: null,
    max_dimension: null,
    capacity: false,
    popular: false,
    booking_availability:
      extra.booking_availability ||
      AVAILABILITY_OVERRIDES[id] ||
      AVAILABILITY_BY_CATEGORY[category] ||
      'unassigned',
    addon: false,
    needs_review: false,
    review_note: '',
    active: true,
    sort: nextSort,
    ...extra,
  };
  nextSort += 10;
  return row;
}

/** A price break. `max: null` means "and above". */
function tier(min, max, price, label) {
  return { min, max, price, label };
}

/* ---------- 1. Stickers and Decals ---------- */

const stickers = [
  service('sticker', 'Ordinary white sticker – pre-cut', 'Stickers and Decals', 60, 'per piece'),
  service('sticker-white-print', 'Ordinary white sticker – print only', 'Stickers and Decals', 50, 'per piece'),
  service('sticker-vinyl-white-pre', 'Waterproof vinyl white – pre-cut', 'Stickers and Decals', 460, 'per piece'),
  service('sticker-vinyl-white-print', 'Waterproof vinyl white – print only', 'Stickers and Decals', 370, 'per piece', {
    needs_review: true,
    review_note: 'Sheet2 lists ₱300; Price Rearrange lists ₱370. Applied ₱370.',
  }),
  service('sticker-transparent-pre', 'Ordinary transparent – pre-cut', 'Stickers and Decals', 75, 'per piece'),
  service('sticker-transparent-print', 'Ordinary transparent – print only', 'Stickers and Decals', 60, 'per piece'),
  service('sticker-vinyl-transparent-pre', 'Transparent vinyl – pre-cut', 'Stickers and Decals', 550, 'per piece'),
  service('sticker-vinyl-transparent-print', 'Transparent vinyl – print only', 'Stickers and Decals', 440, 'per piece', {
    needs_review: true,
    review_note: 'Sheet2 lists ₱400; Price Rearrange lists ₱440. Applied ₱440.',
  }),
  service('sticker-photo-pre', 'Ordinary white photo sticker – pre-cut', 'Stickers and Decals', 65, 'per piece'),
  service('sticker-photo-print', 'Ordinary white photo sticker – print only', 'Stickers and Decals', 50, 'per piece'),
  service('sticker-3m', '3M sticker', 'Stickers and Decals', 250, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
    description: '3M material, billed per square foot.',
  }),
  service('decal', 'Decal (width × height × 5 + ₱50)', 'Stickers and Decals', 5, 'per sq in', {
    pricing_mode: 'area',
    min_area: 1,
    base_fee: 50,
    dimension_unit: 'in',
    description: '₱5 per square inch plus a ₱50 setup fee; enter the size in inches.',
  }),
  service('sticker-cut-3', 'Cut sticker 3×3 in', 'Stickers and Decals', 36, 'per piece'),
  service('sticker-cut-2-5', 'Cut sticker 2.5×2.5 in', 'Stickers and Decals', 64, 'per piece'),
  service('sticker-cut-2', 'Cut sticker 2×2 in', 'Stickers and Decals', 100, 'per piece'),
  service('sticker-cut-1-5', 'Cut sticker 1.5×1.5 in', 'Stickers and Decals', 144, 'per piece'),
];

/* ---------- 2. Souvenirs and Personalized Items ---------- */

const souvenirs = [
  service('magnet', 'Ref magnet', 'Souvenirs and Personalized Items', 35, 'per piece', {
    tiers: [tier(1, 29, 35, '1–29 pcs'), tier(30, null, 30, '30+ pcs')],
    description: '₱35 below 30 pieces; ₱30 each from 30 pieces.',
    needs_review: true,
    review_note: 'Sheet2 lists ₱25; Price Rearrange lists ₱30 for the 30-piece rate. Applied ₱35 / ₱30.',
    popular: true,
  }),
  service('mug', 'Regular mug – pre-order', 'Souvenirs and Personalized Items', 165, 'per mug', {
    tiers: [tier(1, 29, 165, '1–29 pcs'), tier(30, null, 95, '30+ pcs')],
    description: '₱165 pre-order; ₱95 each from 30 pieces.',
  }),
  service('mug-magic', 'Magic mug', 'Souvenirs and Personalized Items', 280, 'per mug'),
  service('key-holder', 'Key holder', 'Souvenirs and Personalized Items', 75, 'per piece', {
    tiers: [tier(1, 50, 75, '1–50 pcs'), tier(100, null, 50, '100+ pcs')],
    description: '₱75 for 50 pieces and below; ₱50 each from 100 pieces. Ask for a quote at 51–99 pieces.',
  }),
  service('mousepad', 'Mousepad', 'Souvenirs and Personalized Items', 300, 'per piece'),
  service('puzzle-a4', 'Puzzle – A4', 'Souvenirs and Personalized Items', 350, 'per piece'),
  service('puzzle-half-a4', 'Puzzle – half A4', 'Souvenirs and Personalized Items', 200, 'per piece'),
  service('mask-sublimated', 'Sublimated mask', 'Souvenirs and Personalized Items', 150, 'per piece'),
  service('mask-cutout', 'Mask cut-out', 'Souvenirs and Personalized Items', 75, 'per piece'),
  service('mask-sublimation-min', 'Sublimation mask (minimum 50 pcs)', 'Souvenirs and Personalized Items', 65, 'per piece', {
    min_qty: 50,
  }),
  service('fan-round', 'Round fan (minimum 30 pcs)', 'Souvenirs and Personalized Items', 45, 'per piece', {
    min_qty: 30,
  }),
  service('pen', 'Personalized pen', 'Souvenirs and Personalized Items', 35, 'per piece', {
    min_qty: 50,
    tiers: [tier(50, 99, 35, '50–99 pcs'), tier(100, null, 28, '100+ pcs')],
    description: '₱35 each at 50 pieces; ₱28 each from 100 pieces.',
  }),
  service('tote', 'Tote bag', 'Souvenirs and Personalized Items', 200, 'per piece', {
    tiers: [
      tier(1, 5, 200, '1–5 pcs'),
      tier(10, 15, 150, '10–15 pcs'),
      tier(30, null, 120, '30+ pcs'),
    ],
    description: '₱200 for 1–5, ₱150 for 10–15, ₱120 from 30. Ask for a quote at 6–9 or 16–29 pieces.',
  }),
  service('fan-folding', 'Folding fan', 'Souvenirs and Personalized Items', 85, 'per piece', {
    tiers: [tier(1, 49, 85, '1–49 pcs'), tier(50, null, 55, '50+ pcs')],
    description: 'Published below-minimum range is ₱75–₱85; the higher end is applied until confirmed.',
    needs_review: true,
    review_note: 'The sheet gives a ₱75–₱85 range below minimum. Applied ₱85; confirm the exact below-minimum rate.',
  }),
  service('plaque-acrylic', 'Acrylic plaque', 'Souvenirs and Personalized Items', 350, 'per piece'),
  service('clock', 'Clock', 'Souvenirs and Personalized Items', 300, 'per piece'),
  service('pillow-magic', 'Magic pillow (14×14 / 16×16)', 'Souvenirs and Personalized Items', 750, 'per piece'),
];

/* ---------- 3. Photo Printing and Frames ---------- */

const photoPrints = [
  service('print-2r', '2R photo print', 'Photo Printing and Frames', 3, 'per piece', { min_qty: 14 }),
  service('print-3r', '3R photo print', 'Photo Printing and Frames', 6, 'per piece', { min_qty: 12 }),
  service('print-4r', '4R photo print', 'Photo Printing and Frames', 12, 'per piece', { min_qty: 4 }),
  service('print-5r', '5R photo print', 'Photo Printing and Frames', 18, 'per piece', { min_qty: 2 }),
  service('print-8r', '8R ordinary print', 'Photo Printing and Frames', 100, 'per piece', { min_qty: 1 }),
  service('print-11r', '11R print', 'Photo Printing and Frames', 150, 'per piece', { min_qty: 1 }),
  service('frame-11r', '11R frame with picture', 'Photo Printing and Frames', 1000, 'per piece'),
  service('print-16x20', '16×20 print', 'Photo Printing and Frames', 400, 'per piece'),
  service('sintra-8r', '8R sintra', 'Photo Printing and Frames', 350, 'per piece'),
  service('sintra-11r', '11R sintra', 'Photo Printing and Frames', 450, 'per piece'),
  service('sintra-16x20', 'Sintra 16×20', 'Plates and Sintra', 850, 'per piece'),
  service('sintra-20x30', 'Sintra 20×30', 'Plates and Sintra', 1000, 'per piece'),
  service('frame-16x20', '16×20 frame only', 'Photo Printing and Frames', 1800, 'per piece'),
  service('frame-20x30', '20×30 frame only', 'Photo Printing and Frames', 2600, 'per piece'),
  service('frame-24x36', '24×36 frame only', 'Photo Printing and Frames', 3500, 'per piece'),
  service('frame-11x14', '11×14 picture with frame', 'Photo Printing and Frames', 1200, 'per piece'),
];

/* ---------- 4. Invitations and Printing ---------- */

const invitations = [
  service('invite-3r', '3R invitation', 'Invitations and Printing', 15, 'per piece', {
    tiers: [tier(1, 29, 15, '1–29 pcs'), tier(30, null, 12, '30+ pcs')],
    description: '₱15 each below 30 pieces; ₱12 each from 30 pieces.',
  }),
  service('invitation', '4R invitation', 'Invitations and Printing', 20, 'per piece', {
    tiers: [tier(1, 29, 20, '1–29 pcs'), tier(30, null, 15, '30+ pcs')],
    description: '₱20 each below 30 pieces; ₱15 each from 30 pieces.',
  }),
  service('invite-5r', '5R invitation', 'Invitations and Printing', 30, 'per piece', {
    tiers: [tier(1, 29, 30, '1–29 pcs'), tier(30, null, 18, '30+ pcs')],
    description: '₱30 each below 30 pieces; ₱18 each from 30 pieces.',
  }),
  service('button-pins', 'Button pins (minimum 50 pcs)', 'Invitations and Printing', 35, 'per piece', {
    min_qty: 50,
  }),
  service('invite-3fold', '3-fold invitation die-cut cover only', 'Invitations and Printing', 46, 'per piece'),
  service('invite-passport-30', 'Passport invitation with ticket (30+ pcs)', 'Invitations and Printing', 65, 'per piece', {
    min_qty: 30,
  }),
  service('invite-passport-50', 'Passport invitation with ticket (50+ pcs)', 'Invitations and Printing', 55, 'per piece', {
    min_qty: 50,
  }),
  service('bond-pads', '1/4 bond paper pads (minimum 10 pads)', 'Invitations and Printing', 50, 'per pad', {
    min_qty: 10,
  }),
  // Existing studio services that are not on the 2026 sheet: retained so no
  // feature disappears, flagged so the owner can price or retire them.
  service('layout', 'Graphic layout', 'Invitations and Printing', 350, 'per layout', {
    description: 'Resumes, birthday layouts, templates, and brochures.',
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('print-bw', 'Print & photocopy, black', 'Invitations and Printing', 2, 'per page', {
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('print-color', 'Print & photocopy, color', 'Invitations and Printing', 5, 'per page', {
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
];

/* ---------- 5. Business Cards and IDs ---------- */

const ids = [
  service('calling-card-photo', 'Calling card – photopaper die-cut', 'Business Cards and IDs', 350, 'per pack', {
    description: 'Photopaper die-cut calling cards.',
  }),
  service('calling-card-matte', 'Calling card – matte die-cut', 'Business Cards and IDs', 400, 'per pack', {
    description: 'Matte die-cut calling cards.',
  }),
  service('calling-card-back', 'Back-to-back printing (add-on)', 'Business Cards and IDs', 100, 'per order', {
    addon: true,
    description: 'Add to a calling-card order. The sheet lists a +₱100 charge.',
    needs_review: true,
    review_note: 'The sheet gives “+₱100” without a unit; applied per calling-card order. Confirm whether it is per pack.',
  }),
  service('id-print', 'PVC ID', 'Business Cards and IDs', 100, 'per card'),
  service('id-vellum', 'Vellum', 'Business Cards and IDs', 250, 'per piece'),
  service('id-photopaper-laminate', 'Photopaper with laminate', 'Business Cards and IDs', 70, 'per piece'),
  service('id-vellum-print', 'Vellum printing', 'Business Cards and IDs', 60, 'per piece'),
  service('id-lace', 'ID lace', 'Business Cards and IDs', 280, 'per piece'),
  service('id-lanyard-50', 'Lanyard only (50 pcs)', 'Business Cards and IDs', 100, 'per piece', {
    min_qty: 50,
    needs_review: true,
    review_note: 'The sheet lists “Lanyard only – 50 pcs ₱100” without saying whether ₱100 is per piece or per 50 pieces. Applied ₱100 per piece, minimum 50.',
  }),
  service('id-pvc-lanyard', 'PVC with lanyard package', 'Business Cards and IDs', 380, 'per set'),
  service('id-pictures', 'ID pictures (1×1 or 2×2)', 'Business Cards and IDs', 100, 'per set of 8', {
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
];

/* ---------- 6. Plates and Sintra ---------- */

const plates = [
  service('plate-temp-thai-acrylic', 'Temporary plate – Thai acrylic', 'Plates and Sintra', 500, 'per piece'),
  service('plate-temp-thai-sintra', 'Temporary plate – Thai sintra', 'Plates and Sintra', 400, 'per piece'),
  service('plate-moto-sintra', 'Motorcycle plate – regular sintra', 'Plates and Sintra', 300, 'per piece'),
  service('plate-moto-acrylic', 'Motorcycle plate – regular acrylic', 'Plates and Sintra', 350, 'per piece'),
  service('plate-car-sintra-fb', 'Car temporary plate – sintra, front and back', 'Plates and Sintra', 700, 'per set'),
  service('plate-car-sintra-1', 'Car temporary plate – sintra, one piece', 'Plates and Sintra', 500, 'per piece'),
  service('plate-car-acrylic-fb', 'Car temporary plate – acrylic, front and back', 'Plates and Sintra', 1000, 'per set'),
  service('plate-car-acrylic-1', 'Car temporary plate – acrylic, one piece', 'Plates and Sintra', 700, 'per piece'),
  service('standee-sintra', 'Sintra standee', 'Plates and Sintra', 220, 'per piece'),
  service('stand-sintra-2x3', 'Sintra stand 2×3', 'Plates and Sintra', 1300, 'per piece'),
];

/* ---------- 7. T-shirt and Apparel Printing ---------- */

const shirts = [
  service('shirt-print-8x10', '8×10 T-shirt print', 'T-shirt and Apparel Printing', 150, 'per print'),
  service('shirt-print-3x3', '3×3 logo size print', 'T-shirt and Apparel Printing', 50, 'per print'),
  service('shirt-az-yalex-bc-sl', 'A–Z / Yalex / Blue Corner shirt – S to L', 'T-shirt and Apparel Printing', 150, 'per shirt'),
  service('shirt-az-yalex-bc-xl', 'A–Z / Yalex / Blue Corner shirt – XL', 'T-shirt and Apparel Printing', 160, 'per shirt'),
  service('shirt-gilldan-sl', 'Gilldan shirt – S to L', 'T-shirt and Apparel Printing', 180, 'per shirt'),
  service('shirt-gilldan-xl', 'Gilldan shirt – XL', 'T-shirt and Apparel Printing', 190, 'per shirt'),
  service('shirt-bc-xs-l', 'Blue Corner shirt – XS to L', 'T-shirt and Apparel Printing', 210, 'per shirt', {
    needs_review: true,
    review_note: 'Blue Corner also appears in the ₱150 S–L line. Both lines have been kept; confirm which applies.',
  }),
  service('shirt-bc-xl-3xl', 'Blue Corner shirt – XL to XXXL', 'T-shirt and Apparel Printing', 220, 'per shirt'),
  service('shirt-yalex-xs-l', 'Yalex shirt – XS to L', 'T-shirt and Apparel Printing', 180, 'per shirt', {
    needs_review: true,
    review_note: 'Yalex also appears in the ₱150 S–L line. Both lines have been kept; confirm which applies.',
  }),
  service('shirt-yalex-xl-3xl', 'Yalex shirt – XL to XXXL', 'T-shirt and Apparel Printing', 190, 'per shirt'),
];

/* ---------- 8. Tarpaulin and Signage ---------- */

const signage = [
  service('tarpaulin-custom', 'Tarpaulin', 'Tarpaulin and Signage', 20, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
    min_dimension: 1,
    max_dimension: 50,
    round_dimensions_up: true,
    popular: true,
    booking_availability: 'both',
    image_url: '/assets/products/tarpaulin-reference.svg',
    image_alt: 'Reference illustration of a printed tarpaulin with metal grommets',
    description:
      'Custom tarpaulin printed at ₱20 per square foot. Enter your own length and height; decimal measurements are rounded up to the next whole foot for billing.',
  }),
  service('blackout-custom', 'Blackout', 'Tarpaulin and Signage', 30, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
    min_dimension: 1,
    max_dimension: 50,
    round_dimensions_up: true,
    booking_availability: 'both',
    image_url: '/assets/products/blackout-reference.svg',
    image_alt: 'Reference illustration of a blackout backdrop with metal grommets',
    description:
      'Blackout material at ₱30 per square foot. Enter your own length and height; decimal measurements are rounded up to the next whole foot for billing.',
  }),
  service('tarpaulin', 'Tarpaulin – 2×3 ft', 'Tarpaulin and Signage', 1200, 'per piece', { popular: true }),
  service('tarpaulin-2x4', 'Tarpaulin – 2×4 ft', 'Tarpaulin and Signage', 1600, 'per piece'),
  service('tarpaulin-2x5', 'Tarpaulin – 2×5 ft', 'Tarpaulin and Signage', 2200, 'per piece'),
  service('tarpaulin-2x6', 'Tarpaulin – 2×6 ft', 'Tarpaulin and Signage', 2640, 'per piece'),
  service('tarpaulin-8r', 'Tarpaulin – 8R', 'Tarpaulin and Signage', 350, 'per piece'),
  service('tarpaulin-11r', 'Tarpaulin – 11R', 'Tarpaulin and Signage', 750, 'per piece'),
  service('tarpaulin-16x20', 'Tarpaulin – 16×20', 'Tarpaulin and Signage', 850, 'per piece'),
  service('tarpaulin-20x30', 'Tarpaulin – 20×30', 'Tarpaulin and Signage', 1000, 'per piece'),
  service('tarpaulin-a4', 'Tarpaulin – A4', 'Tarpaulin and Signage', 450, 'per piece'),
  service('rollup-2x6', 'Roll-up – 2×6 ft', 'Tarpaulin and Signage', 1800, 'per piece'),
  service('rollup-3x7', 'Roll-up – 3×7 ft', 'Tarpaulin and Signage', 2270, 'per piece'),
  service('x-banner', 'X-banner', 'Tarpaulin and Signage', 600, 'per piece'),
  service('x-banner-print', 'X-banner with print', 'Tarpaulin and Signage', 800, 'per piece'),
  service('signage-round', 'Round signage', 'Tarpaulin and Signage', 1000, 'per piece'),
  service('panaflex-plain', 'Panaflex', 'Tarpaulin and Signage', 150, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
    description: 'Durable outdoor panaflex, billed per square foot.',
  }),
  service('frosted-sticker', 'Frosted sticker', 'Tarpaulin and Signage', 140, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
  }),
  service('panaflex-lit', 'Panaflex signboard, lit', 'Tarpaulin and Signage', 650, 'per sq ft', {
    pricing_mode: 'area',
    min_area: 1,
    needs_review: true,
    review_note: 'Only plain Panaflex (₱150/sq ft) is on the 2026 sheet; the lit rate is retained pending confirmation.',
  }),
];

/* ---------- 9. Photography and Videography ---------- */

const photography = [
  service('photo', 'Photo coverage only', 'Photography and Videography', 4500, 'per booking', {
    capacity: true,
  }),
  service('photo-album', 'Photo coverage with traditional album', 'Photography and Videography', 8500, 'per booking', {
    capacity: true,
  }),
  service('photo-prenup', 'Prenup / pre-debut shoot', 'Photography and Videography', 4500, 'per booking', {
    capacity: true,
  }),
  service('photo-tent', 'Additional tent', 'Photography and Videography', 500, 'per booking'),
  service('photo-service', 'Photo service', 'Photography and Videography', 5000, 'per booking', {
    capacity: true,
  }),
  service('photo-usb', 'Additional USB', 'Photography and Videography', 500, 'per piece', {
    addon: true,
    description: 'Add-on to a photo or video coverage booking.',
  }),
  service('video', 'Video coverage', 'Photography and Videography', 9500, 'per booking', {
    capacity: true,
  }),
  service('video-service', 'Video service', 'Photography and Videography', 10000, 'per booking', {
    capacity: true,
  }),
  service('photo-man', 'Photoman – regular (3 hours)', 'Photography and Videography', 7500, 'per 3 hours', {
    capacity: true,
  }),
  service('photo-man-magnetic', 'Photoman – magnetic', 'Photography and Videography', 10500, 'per 3 hours', {
    capacity: true,
  }),
  // Booth packages are part of the studio's existing service but were not on
  // the 2026 sheet. They stay bookable at the current prices so no workflow is
  // removed, and they are flagged for the owner.
  service('photobooth-4r', 'Photobooth, regular 4R', 'Photography and Videography', 3000, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('photobooth-4r-magnetic', 'Photobooth, magnetic 4R', 'Photography and Videography', 3500, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('photobooth-strips', 'Photobooth, regular strips', 'Photography and Videography', 3500, 'per 3 hours', {
    capacity: true,
    popular: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('photobooth-strips-magnetic', 'Photobooth, magnetic strips', 'Photography and Videography', 4000, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('booth-360', '360 video booth', 'Photography and Videography', 8000, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('booth-mirror', 'Mirror booth', 'Photography and Videography', 9000, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
  service('booth-studio', 'Studio booth', 'Photography and Videography', 7000, 'per 3 hours', {
    capacity: true,
    needs_review: true,
    review_note: 'Not in the 2026 sheet; existing studio price retained pending confirmation.',
  }),
];

/* ---------- 10. Albums and Other Services ---------- */

const albums = [
  service('album-storybook', 'Storybook album', 'Albums and Other Services', 8500, 'per album'),
  service('album-traditional', 'Traditional album', 'Albums and Other Services', 7500, 'per album'),
  service('passport', 'Passport only', 'Albums and Other Services', 60, 'per piece'),
  service('print-12r', '12R photo printing', 'Albums and Other Services', 200, 'per piece', {
    description: 'Includes the client sheet’s “Ma’am’s price” at the same ₱200 rate.',
  }),
  service('laminate', 'Regular laminate', 'Albums and Other Services', 75, 'per piece'),
  service('sde', 'Same-day edit (SDE)', 'Albums and Other Services', 35000, 'per booking', { capacity: true }),
  service('led-wall', 'LED wall', 'Albums and Other Services', 15000, 'per booking', { capacity: true }),
  service('frame-metal-rent', 'Metal photo frame rental', 'Albums and Other Services', 350, 'per piece', {
    description: 'Published range is ₱300–₱350; the higher end is applied until confirmed.',
    needs_review: true,
    review_note: 'The sheet gives a ₱300–₱350 rental range. Applied ₱350; confirm the exact rate.',
  }),
  service('frame-metal-sale', 'Metal frame (sale)', 'Albums and Other Services', 1000, 'per piece'),
  service('frame-wooden', 'Wooden frame (pre-order)', 'Albums and Other Services', 1200, 'per piece'),
];

export const SERVICES = [
  ...stickers,
  ...souvenirs,
  ...photoPrints,
  ...invitations,
  ...ids,
  ...plates,
  ...shirts,
  ...signage,
  ...photography,
  ...albums,
];

/**
 * Client-specific tarpaulin and standee rates. These are deliberately not part
 * of `SERVICES`: they must never appear in the public catalog, the rate card,
 * or the booking form, and they must never overwrite a retail price.
 *
 * `price` is per square foot for the tarp lines, matching how client tarpaulin
 * is quoted; the two fixed sizes at the end are per piece.
 */
export const CLIENT_PRICES = [
  { client: 'Red Ribbon', price: 14, unit: 'per sq ft' },
  { client: 'Goldilocks', price: 12, unit: 'per sq ft' },
  { client: "D'Mariners", price: 15, unit: 'per sq ft' },
  { client: 'Tia Bells', price: 14, unit: 'per sq ft' },
  { client: 'Walter Admin', price: 12, unit: 'per sq ft' },
  { client: 'Chowking', price: 10, unit: 'per sq ft' },
  { client: 'Felix', price: 12, unit: 'per sq ft' },
  { client: 'Jopel', price: 12, unit: 'per sq ft' },
  { client: 'DMCI – Vicky and Lovely', price: 13, unit: 'per sq ft' },
  { client: 'Archers / Malu', price: 12, unit: 'per sq ft' },
  { client: 'Jayser', price: 13, unit: 'per sq ft' },
  { client: 'SM', price: 14, unit: 'per sq ft' },
  { client: 'Joice Photography', price: 14, unit: 'per sq ft' },
  { client: 'Lucky', price: 13, unit: 'per sq ft' },
  { client: 'Bersteph', price: 12, unit: 'per sq ft' },
  { client: 'Picture-Picture', price: 12, unit: 'per sq ft' },
  { client: 'Josephine Macatangay Valencia', price: 12, unit: 'per sq ft' },
  { client: 'Rene Magpantay', price: 12, unit: 'per sq ft' },
  { client: 'Princeton', price: 15, unit: 'per sq ft' },
  { client: "Alodiah's", price: 85, unit: 'per 2×3 ft tarp' },
  { client: 'Gemma Ilaga', price: 800, unit: 'per 2×3 ft standee' },
];

/**
 * Things the owner should confirm before they are treated as final. Conflict
 * rows name both workbook values; range and gap rows explain why the system
 * refuses to price an order rather than guessing.
 */
export const PRICE_REVIEWS = [
  {
    product: 'Ref magnet',
    issue: 'Sheet2 lists ₱25; Price Rearrange lists ₱30 for the 30-piece rate. The sheet also has a ₱35 below-minimum rate.',
    applied: '₱35 below 30 pcs; ₱30 from 30 pcs',
    service_id: 'magnet',
  },
  {
    product: 'Waterproof vinyl white – print only',
    issue: 'Sheet2 lists ₱300; Price Rearrange lists ₱370.',
    applied: '₱370',
    service_id: 'sticker-vinyl-white-print',
  },
  {
    product: 'Transparent vinyl – print only',
    issue: 'Sheet2 lists ₱400; Price Rearrange lists ₱440.',
    applied: '₱440',
    service_id: 'sticker-vinyl-transparent-print',
  },
  {
    product: 'Key holder',
    issue: 'Prices are published for 50 pcs and below (₱75) and 100 pcs and above (₱50). 51–99 pieces has no published rate.',
    applied: 'Order is refused at 51–99 pcs with a quote request',
    service_id: 'key-holder',
  },
  {
    product: 'Tote bag',
    issue: 'Prices are published for 1–5 (₱200), 10–15 (₱150), and 30+ (₱120). 6–9 and 16–29 pieces have no published rate.',
    applied: 'Those gaps are refused with a quote request',
    service_id: 'tote',
  },
  {
    product: 'Folding fan',
    issue: 'The below-minimum rate is a range (₱75–₱85); the 50+ rate is ₱55.',
    applied: '₱85 below 50 pcs; ₱55 from 50 pcs',
    service_id: 'fan-folding',
  },
  {
    product: 'Metal photo frame rental',
    issue: 'The rent is a range (₱300–₱350).',
    applied: '₱350',
    service_id: 'frame-metal-rent',
  },
  {
    product: 'Blue Corner and Yalex shirts',
    issue: 'Both appear in a ₱150 / ₱160 line and a separate ₱210 / ₱220 or ₱180 / ₱190 line.',
    applied: 'Each published line is kept as its own product',
    service_id: 'shirt-bc-xs-l',
  },
  {
    product: 'Back-to-back calling-card printing',
    issue: 'The sheet lists “+₱100” without a unit.',
    applied: '₱100 per calling-card order',
    service_id: 'calling-card-back',
  },
  {
    product: 'Lanyard only (50 pcs)',
    issue: 'The sheet lists “Lanyard only – 50 pcs ₱100” without stating whether ₱100 is per piece or per 50 pieces.',
    applied: '₱100 per piece, minimum 50 pieces',
    service_id: 'id-lanyard-50',
  },
  {
    product: 'Special client tarpaulin rates',
    issue: 'The client sheet gives a “Tarp price” column without a unit. The ₱10–₱15 values read as bulk per-square-foot rates, while the two fixed 2×3 ft lines are per piece.',
    applied: 'Per sq ft for the tarp lines; per piece for the two fixed sizes',
    service_id: null,
  },
  {
    product: 'Existing services not on the 2026 sheet',
    issue: 'Photobooths, 360/mirror/studio booths, panaflex lit, graphic layout, photocopying, and ID pictures are still studio services but have no 2026 rate.',
    applied: 'Existing prices retained and marked for review',
    service_id: null,
  },
];

/** Looks up a catalog entry by its stable id (the id stored on booking items). */
export function findService(id, services = SERVICES) {
  return services.find((service) => service.id === id);
}

/** The applicable price break for a quantity, or null when the quantity is in a gap. */
export function tierFor(service, qty) {
  const tiers = service?.tiers || [];
  if (!tiers.length) return null;
  return (
    tiers.find((row) => qty >= Number(row.min) && (row.max === null || row.max === undefined || qty <= Number(row.max))) ||
    null
  );
}

/** The best advertised per-unit rate, used for “from ₱…” labels. */
export function bestPrice(service) {
  const prices = (service?.tiers || []).map((row) => Number(row.price));
  return prices.length ? Math.min(...prices) : Number(service?.price || 0);
}

/** The unit price actually charged for a quantity. */
export function priceFor(service, qty) {
  const breakRow = tierFor(service, qty);
  return Number(breakRow ? breakRow.price : service?.price || 0);
}

/**
 * The smallest order possible for a service, used for "starts at" labels.
 * Area work multiplies by the minimum billable area; fixed work by the hard
 * minimum quantity (or one piece when there is no minimum).
 */
export function startingPrice(service) {
  if (!service) return 0;
  if (service.pricing_mode === 'area') {
    return Math.round(Number(service.price) * Number(service.min_area || 1) + Number(service.base_fee || 0));
  }
  const qty = Number(service.min_qty || 1);
  return Math.round(priceFor(service, qty) * qty + Number(service.base_fee || 0));
}

/** Human-readable tier summary, e.g. "1–29 pcs ₱35 · 30+ pcs ₱30". */
export function tierSummary(service) {
  const rows = service?.tiers || [];
  if (!rows.length) return '';
  return rows
    .map((row) => `${row.label || `${row.min}${row.max ? `–${row.max}` : '+'} pcs`} ₱${Number(row.price).toLocaleString('en-PH')}`)
    .join(' · ');
}

/**
 * Validates one requested line item and returns it with a server-computed
 * total. Throws a user-facing Error for unknown services, impossible
 * dimensions, quantities outside the allowed range, or quantities in a
 * published price gap.
 */
export function priceLine(service, input) {
  if (!service) throw new Error('Unknown service');
  if (service.active === false || service.catalog_visible === false) {
    throw new Error(`${service.name} is not available.`);
  }
  const baseFee = Number(service.base_fee) || 0;
  const capacity = service.capacity === true;

  if (service.pricing_mode === 'area') {
    const unit = service.dimension_unit === 'in' ? 'in' : 'ft';
    const widthInput = input.length_ft ?? input.width_ft;
    const heightInput = input.height_ft;
    const width = Number(widthInput);
    const height = Number(heightInput);
    if (
      widthInput === '' ||
      heightInput === '' ||
      !/^\d+(?:\.\d+)?$/.test(String(widthInput)) ||
      !/^\d+(?:\.\d+)?$/.test(String(heightInput)) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(`${service.name}: enter a length and height greater than zero.`);
    }
    // `null` means "use the default". Number(null) is 0, so check the raw value
    // before coercing; otherwise legacy area products get a 0 ft limit.
    const hasMin = service.min_dimension !== null && service.min_dimension !== undefined && service.min_dimension !== '';
    const hasMax = service.max_dimension !== null && service.max_dimension !== undefined && service.max_dimension !== '';
    const min = hasMin && Number.isFinite(Number(service.min_dimension)) ? Number(service.min_dimension) : 1;
    const max =
      hasMax && Number.isFinite(Number(service.max_dimension))
        ? Number(service.max_dimension)
        : unit === 'in'
          ? 120
          : 50;
    if (width < min || height < min || width > max || height > max) {
      throw new Error(`${service.name}: dimensions must be between ${min} and ${max} ${unit}.`);
    }
    // Round the *printed* size, not the submitted number. The original values
    // are kept so the customer and studio can see exactly what was requested.
    const roundUp = service.round_dimensions_up === true;
    // Normalise to thousandths before rounding so floating-point noise such as
    // 2.0000000001 cannot add an extra foot to the bill.
    const billedWidth = roundUp ? Math.ceil(Math.round(width * 1000) / 1000) : width;
    const billedHeight = roundUp ? Math.ceil(Math.round(height * 1000) / 1000) : height;
    const originalArea = width * height;
    const area = Math.max(Number(service.min_area) || 0, billedWidth * billedHeight);
    const lineTotal = Math.round(area * Number(service.price) + baseFee);
    return {
      service_id: service.id,
      name: service.name,
      category: service.category,
      pricing_mode: 'area',
      unit: service.unit,
      unit_price: Number(service.price),
      qty: 1,
      width_ft: width,
      height_ft: height,
      length_ft: width,
      original_width_ft: width,
      original_height_ft: height,
      billed_width_ft: billedWidth,
      billed_height_ft: billedHeight,
      original_area_sqft: Number(originalArea.toFixed(2)),
      round_dimensions_up: roundUp,
      min_dimension: min,
      max_dimension: max,
      dimension_unit: unit,
      area_sqft: Number(area.toFixed(2)),
      base_fee: baseFee,
      tier_label: '',
      capacity,
      line_total: lineTotal,
      notes: String(input.notes || '').slice(0, 200),
    };
  }

  const minQty = Number(service.min_qty) || 1;
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < minQty || qty > 10000) {
    throw new Error(`${service.name}: quantity must be at least ${minQty}.`);
  }
  const breakRow = tierFor(service, qty);
  if ((service.tiers || []).length && !breakRow) {
    const breaks = tierSummary(service);
    throw new Error(`${service.name}: ${qty} pcs is between published price breaks (${breaks}). Ask the studio for a quote.`);
  }
  const unitPrice = Number(breakRow ? breakRow.price : service.price);
  return {
    service_id: service.id,
    name: service.name,
    category: service.category,
    pricing_mode: 'fixed',
    unit: service.unit,
    unit_price: unitPrice,
    qty,
    width_ft: null,
    height_ft: null,
    dimension_unit: service.dimension_unit || 'ft',
    area_sqft: null,
    base_fee: baseFee,
    tier_label: breakRow?.label || '',
    capacity,
    line_total: Math.round(qty * unitPrice + baseFee),
    notes: String(input.notes || '').slice(0, 200),
  };
}
