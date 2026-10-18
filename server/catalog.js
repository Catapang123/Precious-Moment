export const CATEGORIES = [
  {
    name: 'Print & signage',
    note: 'Big, bold, and built to last — from one shirt to a whole venue.',
  },
  {
    name: 'Paper & keepsakes',
    note: 'The little things guests take home and keep on the fridge.',
  },
  {
    name: 'Photo & booth',
    note: 'Crews, cameras, and booths that keep the dance floor full.',
  },
];

export const SERVICES = [
  {
    id: 'tarpaulin',
    name: 'Tarpaulin printing',
    category: 'Print & signage',
    description: 'Full-color tarpaulin, 2×3 ft up to any size you need.',
    price: 25,
    unit: 'per sq ft',
    pricing_mode: 'area',
    min_area: 6,
    popular: true,
    sort: 10,
  },
  {
    id: 'panaflex-plain',
    name: 'Panaflex signboard',
    category: 'Print & signage',
    description: 'Durable outdoor signboard, without lights.',
    price: 350,
    unit: 'per sq ft',
    pricing_mode: 'area',
    min_area: 4,
    sort: 20,
  },
  {
    id: 'panaflex-lit',
    name: 'Panaflex signboard, lit',
    category: 'Print & signage',
    description: 'Illuminated signboard for storefronts and events.',
    price: 650,
    unit: 'per sq ft',
    pricing_mode: 'area',
    min_area: 4,
    sort: 30,
  },
  {
    id: 'shirt-vinyl',
    name: 'T-shirt printing, vinyl',
    category: 'Print & signage',
    description: 'Crisp vinyl print for teams, families, and events.',
    price: 280,
    unit: 'per shirt',
    pricing_mode: 'fixed',
    sort: 40,
  },
  {
    id: 'shirt-dtf',
    name: 'T-shirt printing, DTF',
    category: 'Print & signage',
    description: 'Full-color DTF transfer with a soft finish.',
    price: 220,
    unit: 'per shirt',
    pricing_mode: 'fixed',
    sort: 50,
  },
  {
    id: 'sticker',
    name: 'Sticker printing',
    category: 'Print & signage',
    description: 'Custom-cut stickers on A4 sheets, glossy or matte.',
    price: 50,
    unit: 'per sheet',
    pricing_mode: 'fixed',
    sort: 60,
  },
  {
    id: 'mug',
    name: 'Mug printing',
    category: 'Print & signage',
    description: 'A favorite photo or design, wrapped around a mug.',
    price: 150,
    unit: 'per mug',
    pricing_mode: 'fixed',
    sort: 70,
  },
  {
    id: 'id-print',
    name: 'ID printing & making',
    category: 'Print & signage',
    description: 'PVC ID cards printed and finished, ready to wear.',
    price: 150,
    unit: 'per card',
    pricing_mode: 'fixed',
    sort: 80,
  },
  {
    id: 'id-pictures',
    name: 'ID pictures',
    category: 'Paper & keepsakes',
    description: '1×1 or 2×2 sets, printed on the spot.',
    price: 100,
    unit: 'per set of 8',
    pricing_mode: 'fixed',
    sort: 90,
  },
  {
    id: 'laminate',
    name: 'Lamination',
    category: 'Paper & keepsakes',
    description: 'A4 or ID-size lamination for documents that last.',
    price: 30,
    unit: 'per piece',
    pricing_mode: 'fixed',
    sort: 100,
  },
  {
    id: 'id-lace',
    name: 'ID lace',
    category: 'Paper & keepsakes',
    description: 'Plain or custom-printed lanyards for any event.',
    price: 35,
    unit: 'per piece',
    pricing_mode: 'fixed',
    sort: 110,
  },
  {
    id: 'layout',
    name: 'Graphic layout',
    category: 'Paper & keepsakes',
    description: 'Resumes, birthday layouts, templates, brochures, and more.',
    price: 350,
    unit: 'per layout',
    pricing_mode: 'fixed',
    sort: 120,
  },
  {
    id: 'print-bw',
    name: 'Print & photocopy, black',
    category: 'Paper & keepsakes',
    description: 'Short, long, or A4 — priced per page.',
    price: 2,
    unit: 'per page',
    pricing_mode: 'fixed',
    sort: 130,
  },
  {
    id: 'print-color',
    name: 'Print & photocopy, color',
    category: 'Paper & keepsakes',
    description: 'Short, long, or A4 full-color printing.',
    price: 5,
    unit: 'per page',
    pricing_mode: 'fixed',
    sort: 140,
  },
  {
    id: 'magnet',
    name: 'Ref magnet souvenir',
    category: 'Paper & keepsakes',
    description: 'A small keepsake with your photo or monogram.',
    price: 35,
    unit: 'per piece',
    pricing_mode: 'fixed',
    sort: 150,
  },
  {
    id: 'invitation',
    name: 'Invitation printing',
    category: 'Paper & keepsakes',
    description: 'Printed invites, designed to match your day.',
    price: 80,
    unit: 'per piece',
    pricing_mode: 'fixed',
    min_qty: 20,
    sort: 160,
  },
  {
    id: 'photo',
    name: 'Photo coverage',
    category: 'Photo & booth',
    description: 'A photographer for the moments you cannot pose twice.',
    price: 3500,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 170,
  },
  {
    id: 'video',
    name: 'Video coverage',
    category: 'Photo & booth',
    description: 'Event coverage edited into a film you will replay.',
    price: 6000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 180,
  },
  {
    id: 'photobooth-4r',
    name: 'Photobooth, regular 4R',
    category: 'Photo & booth',
    description: 'Classic 4R prints, unlimited shots, with props.',
    price: 3000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 190,
  },
  {
    id: 'photobooth-4r-magnetic',
    name: 'Photobooth, magnetic 4R',
    category: 'Photo & booth',
    description: 'A 4R print that sticks around on the fridge.',
    price: 3500,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 200,
  },
  {
    id: 'photobooth-strips',
    name: 'Photobooth, regular strips',
    category: 'Photo & booth',
    description: 'The classic photobooth strip, cut and shared.',
    price: 3500,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    popular: true,
    sort: 210,
  },
  {
    id: 'photobooth-strips-magnetic',
    name: 'Photobooth, magnetic strips',
    category: 'Photo & booth',
    description: 'All the fun of a strip, with a magnetic back.',
    price: 4000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 220,
  },
  {
    id: 'booth-360',
    name: '360 video booth',
    category: 'Photo & booth',
    description: 'A slow-motion spin your guests will want to share.',
    price: 8000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 230,
  },
  {
    id: 'booth-mirror',
    name: 'Mirror booth',
    category: 'Photo & booth',
    description: 'A full-length mirror booth with instant prints.',
    price: 9000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 240,
  },
  {
    id: 'booth-studio',
    name: 'Studio booth',
    category: 'Photo & booth',
    description: 'A clean studio setup with lighting and prints.',
    price: 7000,
    unit: 'per 3 hours',
    pricing_mode: 'fixed',
    sort: 250,
  },
  {
    id: 'photo-man',
    name: 'Photo man',
    category: 'Photo & booth',
    description: 'An extra pair of hands for candid event photos.',
    price: 2500,
    unit: 'per 4 hours',
    pricing_mode: 'fixed',
    sort: 260,
  },
];

export function findService(id) {
  return SERVICES.find((service) => service.id === id);
}

export function startingPrice(service) {
  if (service.pricing_mode === 'area') return Math.round(service.price * service.min_area);
  return Math.round(service.price * (service.min_qty || 1));
}

export function priceLine(service, input) {
  if (!service) throw new Error('Unknown service');
  if (service.pricing_mode === 'area') {
    const width = Number(input.width_ft);
    const height = Number(input.height_ft);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`${service.name}: enter a width and height.`);
    }
    if (width < 0.5 || height < 0.5 || width > 50 || height > 50) {
      throw new Error(`${service.name}: dimensions must be between 0.5 and 50 ft.`);
    }
    const area = Math.max(service.min_area, width * height);
    const lineTotal = Math.round(area * service.price);
    return {
      service_id: service.id,
      name: service.name,
      pricing_mode: 'area',
      unit: service.unit,
      unit_price: service.price,
      qty: 1,
      width_ft: width,
      height_ft: height,
      area_sqft: Number(area.toFixed(2)),
      line_total: lineTotal,
      notes: String(input.notes || '').slice(0, 200),
    };
  }

  const minQty = service.min_qty || 1;
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < minQty || qty > 10000) {
    throw new Error(`${service.name}: quantity must be at least ${minQty}.`);
  }
  return {
    service_id: service.id,
    name: service.name,
    pricing_mode: 'fixed',
    unit: service.unit,
    unit_price: service.price,
    qty,
    width_ft: null,
    height_ft: null,
    area_sqft: null,
    line_total: Math.round(qty * service.price),
    notes: String(input.notes || '').slice(0, 200),
  };
}
