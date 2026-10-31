import { MAX_UNITS } from './availability.js';

// The assistant only speaks from this system: the live catalog, the branch
// records, the studio's own policies, and the signed-in customer's bookings.
// Anything else gets the exact out-of-scope reply. There is no model call, so
// it cannot invent a price, a policy, or an answer.
export const OUT_OF_SCOPE = 'Out of scope. Please ask another question.';

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const norm = (value) => String(value || '').toLowerCase();

function unique(list) {
  return [...new Set(list)];
}

function serviceStartingPrice(service) {
  if (service.pricing_mode === 'area') {
    return Math.round(Number(service.price) * Number(service.min_area || 1));
  }
  return Math.round(Number(service.price) * Number(service.min_qty || 1));
}

// Deliberately small and explicit: a question only counts as "about the
// catalog" when it contains a word the studio actually sells.
const SERVICE_ALIASES = [
  { match: /tarpaulin|\btarp\b/, ids: ['tarpaulin'] },
  { match: /panaflex|signboard/, ids: ['panaflex-lit', 'panaflex-plain'] },
  { match: /t-?shirt|\bshirt\b|\btees?\b/, ids: ['shirt-dtf', 'shirt-vinyl'] },
  { match: /sticker/, ids: ['sticker'] },
  { match: /\bmug\b/, ids: ['mug'] },
  { match: /id picture|id photo|1x1|2x2/, ids: ['id-pictures'] },
  { match: /id lace|lanyard/, ids: ['id-lace'] },
  { match: /id print|id card|\bid\b/, ids: ['id-print'] },
  { match: /laminat/, ids: ['laminate'] },
  { match: /layout|resume|brochure/, ids: ['layout'] },
  { match: /invitation|invite/, ids: ['invitation'] },
  { match: /photocopy|black print|b&w/, ids: ['print-bw'] },
  { match: /color print|colored print/, ids: ['print-color'] },
  { match: /photo coverage|photographer/, ids: ['photo'] },
  { match: /video coverage|videographer|\bfilm\b/, ids: ['video'] },
  { match: /photo ?man/, ids: ['photo-man'] },
  { match: /360/, ids: ['booth-360'] },
  { match: /mirror booth|mirror/, ids: ['booth-mirror'] },
  { match: /studio booth/, ids: ['booth-studio'] },
  { match: /photo ?booth|booth/, ids: ['photobooth-4r', 'photobooth-4r-magnetic', 'photobooth-strips', 'photobooth-strips-magnetic'] },
  { match: /magnet|souvenir/, ids: ['magnet'] },
];

function mentionedServices(message, services) {
  const text = norm(message);
  const ids = [];
  for (const alias of SERVICE_ALIASES) {
    if (alias.match.test(text)) ids.push(...alias.ids);
  }
  const wanted = unique(ids);
  return services.filter((service) => wanted.includes(service.id));
}

function isPriceQuestion(message) {
  return /price|cost|how much|magkano|rate|fee|budget|quote/.test(norm(message));
}

function describeService(service) {
  const starting = serviceStartingPrice(service);
  const unit = service.pricing_mode === 'area' ? service.unit : service.unit;
  return `${service.name} — ${peso(service.price)} ${unit}; a minimum order starts at ${peso(starting)}.`;
}

async function bookingStatusAnswer(store, user) {
  const bookings = await store.list('bookings');
  const mine =
    user.role === 'customer'
      ? bookings.filter((booking) => booking.customer_id === user.id)
      : bookings.filter(
          (booking) =>
            booking.branch_id &&
            (user.role === 'admin' || booking.branch_id === user.branch_id) &&
            !['completed', 'cancelled'].includes(booking.status)
        );
  if (!mine.length) {
    return user.role === 'customer'
      ? 'You have no bookings yet. Open New booking in your dashboard to request a date.'
      : 'There are no active bookings in your scope right now.';
  }
  const active = mine
    .filter((booking) => !['completed', 'cancelled'].includes(booking.status))
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
    .slice(0, 3);
  const rows = (active.length ? active : mine.slice(0, 3)).map((booking) => {
    const kind = booking.booking_type === 'pickup' ? 'Pickup' : 'Event';
    const balance = Math.max(0, Number(booking.total || 0) - Number(booking.amount_paid || 0));
    return `${booking.ref} · ${kind} · ${String(booking.event_date).slice(0, 10)}${
      booking.event_time ? ` at ${booking.event_time}` : ''
    } · ${String(booking.status).replace('_', ' ')} · balance ${peso(balance)}`;
  });
  return `Here is what the system has for you:\n\n${rows.join('\n')}\n\nOpen My bookings (or Bookings) for the full timeline.`;
}

async function discountAnswer(store, user) {
  if (user.role !== 'customer') {
    return 'Discounts are assigned by the studio owner under Discounts. Only an active discount on a customer account is applied to a booking total.';
  }
  const discounts = await store.list('discounts');
  const active = discounts.find(
    (discount) => discount.customer_id === user.id && discount.active !== false
  );
  if (!active) return 'No discount is assigned to your account yet. The studio owner can add one.';
  const label =
    active.type === 'percent' ? `${Number(active.value)}% off` : `${peso(active.value)} off`;
  return `Your account has an active discount: ${label}${active.note ? ` (${active.note})` : ''}. It is applied automatically to a new booking total.`;
}

function branchAnswer(branches) {
  if (!branches.length) return 'The branch list is being set up. Please try again shortly.';
  const rows = branches.map(
    (branch) =>
      `${branch.name} — ${branch.address || 'address on file'}${
        branch.phone ? ` · ${branch.phone}` : ''
      }`
  );
  return `We have ${branches.length} branches:\n\n${rows.join('\n')}\n\nOpen Monday to Saturday, 9:00 AM to 6:00 PM. Pickup bookings can choose either branch; an event is assigned to the branch that covers the venue, unless you pick one.`;
}

function policyAnswer(topic) {
  if (topic === 'payment') {
    return 'A 50% reservation fee locks a date; the balance is settled before or on the event day. We accept cash, GCash, and bank transfer, and every recorded payment appears on the booking with its reference.';
  }
  if (topic === 'processing') {
    return 'Small prints, IDs, and photocopies are usually same-day. Tarps, shirts, signboards, and invitations need 2–5 working days depending on quantity and material. A pickup booking is ready in 1–2 days unless the studio tells you otherwise.';
  }
  if (topic === 'capacity') {
    return `A branch can run up to ${MAX_UNITS} booth or crew services at the same time. A day is not limited to ${MAX_UNITS} bookings: once one time window is full, the next open window is still bookable. The booking form checks this before it submits.`;
  }
  if (topic === 'cancel') {
    return 'A pending request can be cancelled from My bookings. For a confirmed date, message the studio as early as possible; one move to another open date is free when made at least 7 days before the event.';
  }
  if (topic === 'travel') {
    return 'Photo, video, and booth crews travel. Out-of-town bookings include a travel fee that the studio confirms before the date is reserved.';
  }
  return '';
}

function greetingAnswer() {
  return 'Hello. I can answer questions about our services and prices, the Batangas and Bauan branches, booking steps, availability, payments, pickup processing, and your own booking status. What would you like to know?';
}

export async function answerQuestion(store, user, rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return { answer: OUT_OF_SCOPE, in_scope: false };
  if (message.length > 500) return { answer: OUT_OF_SCOPE, in_scope: false };
  const text = norm(message);

  const [services, branches] = await Promise.all([store.list('services'), store.list('branches')]);
  const activeServices = services.filter((service) => service.active !== false);
  const matches = mentionedServices(text, activeServices);

  if (/status|my booking|my order|reference|where is my|when is my|schedule|appointment/.test(text)) {
    return { answer: await bookingStatusAnswer(store, user), in_scope: true };
  }
  if (/discount|loyalty|voucher|promo/.test(text)) {
    return { answer: await discountAnswer(store, user), in_scope: true };
  }
  if (/branch|location|address|where are you|map|bauan|batangas|opening hours|open\b|hours/.test(text)) {
    return { answer: branchAnswer(branches), in_scope: true };
  }
  if (/deposit|payment|pay\b|gcash|bank transfer|reservation fee|balance|receipt|refund/.test(text)) {
    return { answer: policyAnswer('payment'), in_scope: true };
  }
  if (/how long|ready|processing|lead time|turnaround|pickup/.test(text)) {
    return { answer: policyAnswer('processing'), in_scope: true };
  }
  if (/how many|capacity|simultaneous|available|availability|slot|full|double book|overlap/.test(text)) {
    return { answer: policyAnswer('capacity'), in_scope: true };
  }
  if (/cancel|resched|move my|change my date/.test(text)) {
    return { answer: policyAnswer('cancel'), in_scope: true };
  }
  if (/out of town|outside|travel fee|deliver/.test(text)) {
    return { answer: policyAnswer('travel'), in_scope: true };
  }
  if (matches.length) {
    const intro = isPriceQuestion(text) ? 'Here are the rates on file:' : 'Here is what we offer:';
    const rows = matches.slice(0, 6).map(describeService);
    return { answer: `${intro}\n\n${rows.join('\n')}\n\nRates are starting prices; custom sizes and out-of-town events get a clear quote before confirmation.`, in_scope: true };
  }
  if (/how.*(book|order|reserve)|book a|start a booking|steps|how does this work/.test(text)) {
    return {
      answer:
        'Open New booking, choose Event or Pickup, add the pieces you need, then send the date. The studio checks the calendar and confirms availability; the 50% reservation details follow. You can follow every status and payment from My bookings.',
      in_scope: true,
    };
  }
  if (/contact|email|phone|call|reach you|message you/.test(text)) {
    return {
      answer: 'The studio email is hello@preciousmoments.ph. Branch addresses are listed under the branches question, and the studio is open Monday to Saturday, 9:00 AM to 6:00 PM.',
      in_scope: true,
    };
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b|what can you (do|answer)|^help\b/.test(text)) {
    return { answer: greetingAnswer(), in_scope: true };
  }

  return { answer: OUT_OF_SCOPE, in_scope: false };
}
