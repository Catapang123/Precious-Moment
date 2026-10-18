import { SERVICES, priceLine } from './catalog.js';
import { hashPassword } from './security.js';

const iso = (date) => date.toISOString();
const day = (offset) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};
const at = (offset, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return iso(date);
};
const line = (id, input) => priceLine(SERVICES.find((s) => s.id === id), input);

export function buildSeed() {
  const users = [
    {
      id: 'user-admin',
      name: 'Bea Villanueva',
      email: 'admin@precious.ph',
      password_hash: hashPassword('Admin123!'),
      role: 'admin',
      phone: '0917 555 0100',
      created_at: at(-420, 9),
    },
    {
      id: 'user-ana',
      name: 'Ana Reyes',
      email: 'ana@precious.ph',
      password_hash: hashPassword('Staff123!'),
      role: 'staff',
      phone: '0917 555 0101',
      created_at: at(-390, 9),
    },
    {
      id: 'user-migs',
      name: 'Migs Cruz',
      email: 'migs@precious.ph',
      password_hash: hashPassword('Staff123!'),
      role: 'staff',
      phone: '0917 555 0102',
      created_at: at(-300, 9),
    },
    {
      id: 'user-maria',
      name: 'Maria Santos',
      email: 'maria@example.com',
      password_hash: hashPassword('Customer123!'),
      role: 'customer',
      phone: '0918 555 0142',
      created_at: at(-120, 14),
    },
    {
      id: 'user-jessa',
      name: 'Jessa Lim',
      email: 'jessa@example.com',
      password_hash: hashPassword('Customer123!'),
      role: 'customer',
      phone: '0918 555 0155',
      created_at: at(-90, 11),
    },
    {
      id: 'user-carlo',
      name: 'Carlo Mendoza',
      email: 'carlo@example.com',
      password_hash: hashPassword('Customer123!'),
      role: 'customer',
      phone: '0918 555 0163',
      created_at: at(-60, 16),
    },
  ];

  const services = SERVICES.map((service) => ({
    ...service,
    min_area: service.min_area ?? null,
    min_qty: service.min_qty ?? null,
    popular: service.popular ?? false,
    active: true,
    created_at: at(-500, 8),
  }));

  const bookings = [
    {
      id: 'booking-1021',
      ref: 'PM-1021',
      customer_id: 'user-maria',
      staff_id: null,
      event_date: day(6),
      event_time: '14:00',
      venue: 'Santos residence, garden pavilion',
      notes: 'Birthday lunch for 40 guests. Please match the pink and cream theme.',
      status: 'pending',
      payment_status: 'unpaid',
      payment_method: '',
      payment_ref: '',
      amount_paid: 0,
      total: 4100,
      paid_at: null,
      items: [line('photobooth-strips', { qty: 1 }), line('tarpaulin', { width_ft: 4, height_ft: 6 })],
      created_at: at(-2, 9),
      updated_at: at(-2, 9),
    },
    {
      id: 'booking-1022',
      ref: 'PM-1022',
      customer_id: 'user-maria',
      staff_id: 'user-ana',
      event_date: day(20),
      event_time: '15:00',
      venue: 'Casa Esperanza, function hall',
      notes: 'Golden anniversary. Family portraits after the program.',
      status: 'confirmed',
      payment_status: 'deposit_paid',
      payment_method: 'GCash',
      payment_ref: 'GC-884201',
      amount_paid: 4750,
      total: 9500,
      paid_at: at(-5, 13),
      items: [line('photo', { qty: 1 }), line('video', { qty: 1 })],
      created_at: at(-9, 10),
      updated_at: at(-5, 13),
    },
    {
      id: 'booking-1023',
      ref: 'PM-1023',
      customer_id: 'user-jessa',
      staff_id: 'user-migs',
      event_date: day(-3),
      event_time: '17:00',
      venue: 'The Glasshouse, rooftop',
      notes: 'Graduation party. Magnetic prints, please.',
      status: 'completed',
      payment_status: 'paid',
      payment_method: 'Bank transfer',
      payment_ref: 'BPI-091823',
      amount_paid: 4100,
      total: 4100,
      paid_at: at(-1, 18),
      items: [line('photobooth-4r-magnetic', { qty: 1 }), line('mug', { qty: 4 })],
      created_at: at(-24, 14),
      updated_at: at(-1, 18),
    },
    {
      id: 'booking-1024',
      ref: 'PM-1024',
      customer_id: 'user-carlo',
      staff_id: 'user-ana',
      event_date: day(12),
      event_time: '09:00',
      venue: 'Mendoza home studio',
      notes: 'Signboard for the front gate. Please call before delivery.',
      status: 'confirmed',
      payment_status: 'paid',
      payment_method: 'Cash',
      payment_ref: 'CASH-1024',
      amount_paid: 7450,
      total: 7450,
      paid_at: at(-3, 11),
      items: [
        line('panaflex-lit', { width_ft: 2, height_ft: 2 }),
        line('tarpaulin', { width_ft: 6, height_ft: 3 }),
        line('shirt-dtf', { qty: 20 }),
      ],
      created_at: at(-12, 15),
      updated_at: at(-3, 11),
    },
    {
      id: 'booking-1025',
      ref: 'PM-1025',
      customer_id: 'user-maria',
      staff_id: 'user-ana',
      event_date: day(-35),
      event_time: '13:00',
      venue: 'St. Clare parish hall',
      notes: 'Baptism. A short coverage and ref magnets for the ninongs.',
      status: 'completed',
      payment_status: 'paid',
      payment_method: 'GCash',
      payment_ref: 'GC-771904',
      amount_paid: 4200,
      total: 4200,
      paid_at: at(-30, 16),
      items: [line('photo', { qty: 1 }), line('magnet', { qty: 20 })],
      created_at: at(-55, 10),
      updated_at: at(-30, 16),
    },
    {
      id: 'booking-1026',
      ref: 'PM-1026',
      customer_id: 'user-jessa',
      staff_id: null,
      event_date: day(8),
      event_time: '18:00',
      venue: 'Lim family compound',
      notes: 'Debut after-party. 360 booth with attendant.',
      status: 'pending',
      payment_status: 'unpaid',
      payment_method: '',
      payment_ref: '',
      amount_paid: 0,
      total: 8000,
      paid_at: null,
      items: [line('booth-360', { qty: 1 })],
      created_at: at(-1, 20),
      updated_at: at(-1, 20),
    },
    {
      id: 'booking-1027',
      ref: 'PM-1027',
      customer_id: 'user-carlo',
      staff_id: 'user-migs',
      event_date: day(45),
      event_time: '16:00',
      venue: 'Villa Amara, garden',
      notes: 'Wedding reception. Mirror booth plus 50 invitations.',
      status: 'confirmed',
      payment_status: 'deposit_paid',
      payment_method: 'GCash',
      payment_ref: 'GC-902144',
      amount_paid: 6500,
      total: 13000,
      paid_at: at(-4, 12),
      items: [line('booth-mirror', { qty: 1 }), line('invitation', { qty: 50 })],
      created_at: at(-14, 9),
      updated_at: at(-4, 12),
    },
    {
      id: 'booking-1028',
      ref: 'PM-1028',
      customer_id: 'user-maria',
      staff_id: 'user-migs',
      event_date: day(2),
      event_time: '11:00',
      venue: 'Precious Moments studio',
      notes: 'Family reunion shirts and a welcome tarp. Pickup at the studio.',
      status: 'in_progress',
      payment_status: 'deposit_paid',
      payment_method: 'Cash',
      payment_ref: 'CASH-1028',
      amount_paid: 1800,
      total: 3600,
      paid_at: at(-1, 10),
      items: [
        line('tarpaulin', { width_ft: 8, height_ft: 4 }),
        line('shirt-vinyl', { qty: 10 }),
      ],
      created_at: at(-6, 17),
      updated_at: at(-1, 10),
    },
  ];

  const updates = [];
  const addUpdate = (bookingId, authorId, status, message, createdAt) => {
    updates.push({
      id: `update-${updates.length + 1}`,
      booking_id: bookingId,
      author_id: authorId,
      status,
      message,
      created_at: createdAt,
    });
  };

  addUpdate('booking-1021', 'user-maria', 'pending', 'Booking request submitted.', at(-2, 9));
  addUpdate('booking-1022', 'user-maria', 'pending', 'Booking request submitted.', at(-9, 10));
  addUpdate('booking-1022', 'user-admin', 'confirmed', 'Date reserved. Deposit received via GCash.', at(-5, 13));
  addUpdate('booking-1023', 'user-jessa', 'pending', 'Booking request submitted.', at(-24, 14));
  addUpdate('booking-1023', 'user-admin', 'confirmed', 'Confirmed and assigned to Migs.', at(-20, 11));
  addUpdate('booking-1023', 'user-migs', 'in_progress', 'On site and set up before guests arrive.', at(-3, 16));
  addUpdate('booking-1023', 'user-migs', 'completed', 'Booth closed, prints packed, balance settled.', at(-1, 18));
  addUpdate('booking-1024', 'user-carlo', 'pending', 'Booking request submitted.', at(-12, 15));
  addUpdate('booking-1024', 'user-admin', 'confirmed', 'Full payment received. Assigned to Ana.', at(-3, 11));
  addUpdate('booking-1025', 'user-maria', 'pending', 'Booking request submitted.', at(-55, 10));
  addUpdate('booking-1025', 'user-admin', 'completed', 'Coverage delivered; thank you, Maria.', at(-30, 16));
  addUpdate('booking-1026', 'user-jessa', 'pending', 'Booking request submitted.', at(-1, 20));
  addUpdate('booking-1027', 'user-carlo', 'pending', 'Booking request submitted.', at(-14, 9));
  addUpdate('booking-1027', 'user-admin', 'confirmed', 'Date reserved. Deposit received.', at(-4, 12));
  addUpdate('booking-1028', 'user-maria', 'pending', 'Booking request submitted.', at(-6, 17));
  addUpdate('booking-1028', 'user-admin', 'confirmed', 'Confirmed. Assigned to Migs.', at(-3, 9));
  addUpdate('booking-1028', 'user-migs', 'in_progress', 'Tarpaulin printed. Shirt vinyl in progress.', at(-1, 10));

  return { users, services, bookings, booking_updates: updates };
}
