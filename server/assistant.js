/**
 * PRECIOUS — the in-app assistant.
 *
 * A deterministic answer engine, not a language model. It can only answer from
 * data the studio owns: the catalog, the branch list, the studio's policies,
 * and the signed-in user's own bookings. A question it does not recognise gets
 * a polite out-of-scope reply instead of a guess.
 *
 * That constraint is the feature: there is no external API call, so it cannot
 * invent a price, leak another customer's booking, or cost per message.
 *
 * Language: users write in English, Filipino, or Taglish. `languageOf` detects
 * the language from function words that are unambiguous (paano, magkano, ang,
 * ng, ...), and every answer carries both an English and a Filipino wording.
 * Taglish falls into the Filipino branch, which is how a Filipino speaker
 * expects it to read: Filipino framing around English technical nouns.
 */
import { MAX_UNITS } from './availability.js';

// The assistant only speaks from this system. Kept as exact strings because the
// smoke test asserts them, and because a stable refusal is easier to trust.
export const OUT_OF_SCOPE = 'Out of scope. Please ask another question.';
export const OUT_OF_SCOPE_FIL =
  'Pasensya na, hindi ko masagot iyon. Ang alam ko lang ay ang mga serbisyo at presyo, branches, steps sa pag-book, availability, bayad, at status ng iyong booking. May iba ka bang tanong?';

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const norm = (value) => String(value || '').toLowerCase();

/** Chooses the wording for the detected language. */
const pick = (lang, en, fil) => (lang === 'fil' ? fil : en);

function unique(list) {
  return [...new Set(list)];
}

/**
 * Language detection by function words.
 *
 * These markers are chosen because they almost never appear inside an English
 * sentence, so "How much is a tarpaulin?" stays English while "Magkano ang
 * tarpaulin?" and "Can you help me mag-create ng booking?" both read as
 * Filipino/Taglish and get the Filipino wording.
 */
const FILIPINO_MARKERS =
  /\b(paano|pano|magkano|magkanu|gumawa|gawin|gagawa|saan|kailan|ano|anong|yung|iyong|ang|ng|mga|po|ba|ako|ko|mo|ninyo|namin|salamat|oo|hindi|bakit|pwede|puwede|gusto|kukuha|kumuha|magbook|mag-book|i-book|ilagay|pindutin|pumunta|tingnan|ayaw|lumalabas|naglo-load|nagloload|gumagana|sirain|meron|wala|kung|para|dito|doon|din|rin|lang|naman|kasi|tapos|pag|kapag|bagong|bago|aking|iyo)\b/;

function languageOf(text) {
  return FILIPINO_MARKERS.test(text) ? 'fil' : 'en';
}

/** Minimum-order price for a service, matching the catalog's own tier rule. */
function serviceStartingPrice(service) {
  if (service.pricing_mode === 'area') {
    return Math.round(
      Number(service.price) * Number(service.min_area || 1) + Number(service.base_fee || 0)
    );
  }
  const qty = Number(service.min_qty || 1);
  const row = (service.tiers || []).find(
    (item) => qty >= Number(item.min) && (item.max === null || item.max === undefined || qty <= Number(item.max))
  );
  return Math.round(Number(row ? row.price : service.price) * qty + Number(service.base_fee || 0));
}

// Deliberately small and explicit: a question only counts as "about the
// catalog" when it contains a word the studio actually sells.
const SERVICE_ALIASES = [
  {
    match: /tarpaulin|\btarp\b/,
    ids: [
      'tarpaulin',
      'tarpaulin-2x4',
      'tarpaulin-2x5',
      'tarpaulin-2x6',
      'tarpaulin-8r',
      'tarpaulin-11r',
      'tarpaulin-16x20',
      'tarpaulin-20x30',
      'tarpaulin-a4',
    ],
  },
  { match: /panaflex|signboard/, ids: ['panaflex-plain', 'panaflex-lit'] },
  {
    match: /t-?shirt|\bshirt\b|\btees?\b/,
    ids: [
      'shirt-az-yalex-bc-sl',
      'shirt-az-yalex-bc-xl',
      'shirt-gilldan-sl',
      'shirt-gilldan-xl',
      'shirt-bc-xs-l',
      'shirt-bc-xl-3xl',
      'shirt-yalex-xs-l',
      'shirt-yalex-xl-3xl',
      'shirt-print-8x10',
      'shirt-print-3x3',
    ],
  },
  {
    match: /sticker/,
    ids: [
      'sticker',
      'sticker-white-print',
      'sticker-vinyl-white-print',
      'sticker-vinyl-transparent-print',
      'sticker-3m',
      'decal',
    ],
  },
  { match: /\bmug\b/, ids: ['mug', 'mug-magic'] },
  { match: /id picture|id photo|1x1|2x2/, ids: ['id-pictures'] },
  { match: /id lace|lanyard/, ids: ['id-lace', 'id-lanyard-50', 'id-pvc-lanyard'] },
  { match: /id print|id card|\bid\b|pvc/, ids: ['id-print', 'id-pvc-lanyard'] },
  { match: /laminat/, ids: ['laminate', 'id-photopaper-laminate'] },
  { match: /layout|resume|brochure/, ids: ['layout'] },
  { match: /invitation|invite|button pin/, ids: ['invitation', 'invite-3r', 'invite-5r', 'button-pins'] },
  { match: /photocopy|black print|b&w/, ids: ['print-bw'] },
  { match: /color print|colored print/, ids: ['print-color'] },
  { match: /photo coverage|photographer|litrato ng event/, ids: ['photo', 'photo-album', 'photo-service'] },
  { match: /video coverage|videographer|\bfilm\b/, ids: ['video', 'video-service'] },
  { match: /photo ?man/, ids: ['photo-man', 'photo-man-magnetic'] },
  { match: /360/, ids: ['booth-360'] },
  { match: /mirror booth|mirror/, ids: ['booth-mirror'] },
  { match: /studio booth/, ids: ['booth-studio'] },
  {
    match: /photo ?booth|booth/,
    ids: ['photobooth-4r', 'photobooth-4r-magnetic', 'photobooth-strips', 'photobooth-strips-magnetic'],
  },
  { match: /magnet|souvenir/, ids: ['magnet', 'key-holder', 'tote', 'pen', 'fan-round', 'fan-folding'] },
  { match: /key ?holder/, ids: ['key-holder'] },
  { match: /tote|\bbag\b/, ids: ['tote'] },
  { match: /\bprints?\b|photo print|picture print/, ids: ['print-2r', 'print-3r', 'print-4r', 'print-5r', 'print-8r', 'print-11r', 'print-12r'] },
  { match: /sintra/, ids: ['sintra-8r', 'sintra-11r', 'sintra-16x20', 'sintra-20x30'] },
  { match: /\bframe\b/, ids: ['frame-11r', 'frame-16x20', 'frame-20x30', 'frame-24x36', 'frame-metal-rent', 'frame-metal-sale', 'frame-wooden'] },
  { match: /album/, ids: ['album-storybook', 'album-traditional'] },
  { match: /\bplate\b/, ids: ['plate-temp-thai-acrylic', 'plate-temp-thai-sintra', 'plate-moto-sintra', 'plate-moto-acrylic', 'plate-car-sintra-fb', 'plate-car-sintra-1', 'plate-car-acrylic-fb', 'plate-car-acrylic-1'] },
  { match: /puzzle/, ids: ['puzzle-a4', 'puzzle-half-a4'] },
  { match: /mask/, ids: ['mask-sublimated', 'mask-cutout', 'mask-sublimation-min'] },
  { match: /\bfan\b/, ids: ['fan-round', 'fan-folding'] },
  { match: /\bpen\b/, ids: ['pen'] },
  { match: /calling card|business card/, ids: ['calling-card-photo', 'calling-card-matte', 'calling-card-back'] },
  { match: /\bsde\b|same-day edit/, ids: ['sde'] },
  { match: /led wall/, ids: ['led-wall'] },
  { match: /standee/, ids: ['standee-sintra', 'stand-sintra-2x3'] },
];

/**
 * Catalog entries named in a message, matched through SERVICE_ALIASES. Returns
 * service records rather than ids so the caller can quote live prices.
 */
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
  return /price|cost|how much|magkano|magkanu|rate|fee|budget|quote|presyo|bayad/.test(norm(message));
}

/** One sentence per service: tier prices plus the smallest order possible. */
function describeService(service, lang) {
  const starting = serviceStartingPrice(service);
  const breaks = (service.tiers || [])
    .map((row) => `${row.label || (row.max === null ? `${row.min}+` : `${row.min}\u2013${row.max}`)} ${peso(row.price)}`)
    .join(' · ');
  const priceText = breaks
    ? `${breaks} ${service.unit}`
    : `${peso(service.price)} ${service.unit}`;
  if (lang === 'fil') {
    return `${service.name} — ${priceText}; ang pinakamaliit na order ay nagsisimula sa ${peso(starting)}.`;
  }
  return `${service.name} — ${priceText}; a minimum order starts at ${peso(starting)}.`;
}

/**
 * The user's own bookings: customers see only theirs, staff see their branch,
 * and the owner sees everything. Access is decided here, not by the caller.
 */
async function bookingStatusAnswer(store, user, lang) {
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
      ? pick(
          lang,
          'You have no bookings yet. Open New booking in your dashboard to request a date.',
          'Wala ka pang booking. Buksan ang New booking sa dashboard mo para makapag-request ng date.'
        )
      : pick(
          lang,
          'There are no active bookings in your scope right now.',
          'Walang active na booking sa scope mo ngayon.'
        );
  }
  const active = mine
    .filter((booking) => !['completed', 'cancelled'].includes(booking.status))
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
    .slice(0, 3);
  const rows = (active.length ? active : mine.slice(0, 3)).map((booking) => {
    const kind =
      booking.booking_type === 'pickup'
        ? pick(lang, 'Pickup', 'Pickup')
        : pick(lang, 'Event', 'Event');
    const balance = Math.max(0, Number(booking.total || 0) - Number(booking.amount_paid || 0));
    return `${booking.ref} · ${kind} · ${String(booking.event_date).slice(0, 10)}${
      booking.event_time ? ` at ${booking.event_time}` : ''
    } · ${String(booking.status).replace('_', ' ')} · ${pick(lang, 'balance', 'balanse')} ${peso(balance)}`;
  });
  return pick(
    lang,
    `Here is what the system has for you:\n\n${rows.join('\n')}\n\nOpen My bookings (or Bookings) for the full timeline.`,
    `Ito ang nasa system para sa iyo:\n\n${rows.join('\n')}\n\nBuksan ang My bookings (o Bookings) para sa buong timeline.`
  );
}

async function discountAnswer(store, user, lang) {
  if (user.role !== 'customer') {
    return pick(
      lang,
      'Discounts are assigned by the studio owner under Discounts. Only an active discount on a customer account is applied to a booking total.',
      'Ang discounts ay ibinibigay ng studio owner sa ilalim ng Discounts. Ang active na discount lang sa account ng customer ang naia-apply sa total ng booking.'
    );
  }
  const discounts = await store.list('discounts');
  const active = discounts.find(
    (discount) => discount.customer_id === user.id && discount.active !== false
  );
  if (!active) {
    return pick(
      lang,
      'No discount is assigned to your account yet. The studio owner can add one.',
      'Wala pang discount na naka-assign sa account mo. Pwede itong idagdag ng studio owner.'
    );
  }
  const label =
    active.type === 'percent' ? `${Number(active.value)}% off` : `${peso(active.value)} off`;
  return pick(
    lang,
    `Your account has an active discount: ${label}${active.note ? ` (${active.note})` : ''}. It is applied automatically to a new booking total.`,
    `May active na discount ang account mo: ${label}${active.note ? ` (${active.note})` : ''}. Awtomatiko itong naia-apply sa total ng bagong booking.`
  );
}

function branchAnswer(branches, lang) {
  if (!branches.length) {
    return pick(
      lang,
      'The branch list is being set up. Please try again shortly.',
      'Inaayos pa ang listahan ng branches. Subukan muli mamaya.'
    );
  }
  const rows = branches.map(
    (branch) =>
      `${branch.name} — ${branch.address || pick(lang, 'address on file', 'address sa file')}${
        branch.phone ? ` · ${branch.phone}` : ''
      }`
  );
  return pick(
    lang,
    `We have ${branches.length} branches:\n\n${rows.join('\n')}\n\nOpen Monday to Saturday, 9:00 AM to 6:00 PM. Pickup bookings can choose either branch; an event is assigned to the branch that covers the venue, unless you pick one.`,
    `May ${branches.length} kaming branches:\n\n${rows.join('\n')}\n\nBukas Lunes hanggang Sabado, 9:00 AM hanggang 6:00 PM. Ang pickup ay pwedeng pumili ng alinmang branch; ang event ay naka-assign sa branch na sumasakop sa venue, maliban kung pumili ka.`
  );
}

function policyAnswer(topic, lang) {
  const answers = {
    payment: {
      en: 'A 50% reservation fee locks a date; the balance is settled before or on the event day. We accept cash, GCash, and bank transfer, and every recorded payment appears on the booking with its reference.',
      fil: 'Kailangan ng 50% reservation fee para ma-lock ang date; ang balanse ay binabayaran bago o sa araw ng event. Tumatanggap kami ng cash, GCash, at bank transfer, at makikita sa booking ang bawat bayad kasama ang reference nito.',
    },
    processing: {
      en: 'Small prints, IDs, and photocopies are usually same-day. Tarps, shirts, signboards, and invitations need 2–5 working days depending on quantity and material. A pickup booking is ready in 1–2 days unless the studio tells you otherwise.',
      fil: 'Ang maliliit na print, ID, at photocopy ay kadalasang same-day. Ang tarps, shirts, signboards, at invitations ay 2–5 working days depende sa dami at material. Ang pickup booking ay ready sa 1–2 araw maliban kung may ibang sabi ang studio.',
    },
    capacity: {
      en: `A branch can run up to ${MAX_UNITS} booth or crew services at the same time. A day is not limited to ${MAX_UNITS} bookings: once one time window is full, the next open window is still bookable. The booking form checks this before it submits.`,
      fil: `Hanggang ${MAX_UNITS} booth o crew services ang pwedeng sabay-sabay sa isang branch. Hindi limitado ang isang araw sa ${MAX_UNITS} bookings: kapag puno ang isang time window, pwedeng mag-book sa susunod na bakanteng window. Sinusuri ito ng booking form bago mag-submit.`,
    },
    cancel: {
      en: 'A pending request can be cancelled from My bookings. For a confirmed date, message the studio as early as possible; one move to another open date is free when made at least 7 days before the event.',
      fil: 'Pwedeng i-cancel ang pending request sa My bookings. Para sa confirmed date, i-message agad ang studio; libre ang isang beses na paglipat ng date kung 7 araw pa bago ang event.',
    },
    travel: {
      en: 'Photo, video, and booth crews travel. Out-of-town bookings include a travel fee that the studio confirms before the date is reserved.',
      fil: 'Nagta-travel ang photo, video, at booth crews. Ang out-of-town booking ay may travel fee na kino-confirm ng studio bago ma-reserve ang date.',
    },
  };
  const entry = answers[topic];
  return entry ? pick(lang, entry.en, entry.fil) : '';
}

function greetingAnswer(lang) {
  return pick(
    lang,
    'Hello. I can answer questions about our services and prices, the Batangas and Bauan branches, booking steps, availability, payments, pickup processing, and your own booking status. What would you like to know?',
    'Kumusta! Ako si PRECIOUS. Pwede mo akong tanungin tungkol sa services at presyo, Batangas at Bauan branches, steps sa pag-book, availability, bayad, pickup time, at status ng sarili mong booking. Ano ang gusto mong malaman?'
  );
}

function troubleshootAnswer(lang) {
  return pick(
    lang,
    "That part of the page doesn't seem to be loading. Try refreshing first — if it still doesn't respond, check your internet connection and try again. If it keeps happening, tell the studio which page you were on so they can look into it.",
    'Mukhang hindi naglo-load ang page o feature na iyon. Subukan munang i-refresh ang page. Kung hindi pa rin gumagana, tingnan kung may internet connection, tapos subukan ulit. Kung may error pa rin, sabihin sa studio kung anong page ang ginagamit mo para masuri nila ito.'
  );
}

/**
 * Main entry point. Returns `{ answer, in_scope, language }`.
 *
 * Order matters: identity-specific questions (status, discount) are answered
 * before the general policy topics, so "when is my booking?" is never mistaken
 * for a question about opening hours. Input is limited to 500 characters to
 * keep a pasted essay from being scanned word by word.
 */
export async function answerQuestion(store, user, rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return { answer: OUT_OF_SCOPE, in_scope: false, language: 'en' };
  if (message.length > 500) return { answer: OUT_OF_SCOPE, in_scope: false, language: 'en' };
  const text = norm(message);
  const lang = languageOf(text);

  const [services, branches] = await Promise.all([store.list('services'), store.list('branches')]);
  const activeServices = services.filter((service) => service.active !== false);
  const matches = mentionedServices(text, activeServices);

  // Status first: "where is my booking" must never be read as "where are you".
  if (
    /status|my booking|my order|reference|where is my|when is my|schedule|appointment|booking ko|order ko|nasaan|saan na|kailan (ang )?(booking|order|appointment)/.test(
      text
    )
  ) {
    return { answer: await bookingStatusAnswer(store, user, lang), in_scope: true, language: lang };
  }
  if (/discount|loyalty|voucher|promo|diskwento/.test(text)) {
    return { answer: await discountAnswer(store, user, lang), in_scope: true, language: lang };
  }
  // Broken-interface reports get a troubleshooting answer before anything that
  // could match a stray word like "open" or "booth".
  if (
    /not loading|won'?t load|doesn'?t work|isn'?t working|error|stuck|blank|hindi (lumalabas|naglo-load|nagloload|gumagana)|walang (lumalabas|nangyayari)|ayaw (mag|ma|i-)|nag-eerror|sira|pinipindot/.test(
      text
    )
  ) {
    return { answer: troubleshootAnswer(lang), in_scope: true, language: lang };
  }
  if (
    /branch|location|address|where are you|map|bauan|batangas|opening hours|open\b|hours|saan (ang|kayo)|saan kayo/.test(
      text
    )
  ) {
    return { answer: branchAnswer(branches, lang), in_scope: true, language: lang };
  }
  if (
    /deposit|payment|pay\b|gcash|bank transfer|reservation fee|balance|receipt|refund|bayad|magkano ang (deposit|down)/.test(
      text
    )
  ) {
    return { answer: policyAnswer('payment', lang), in_scope: true, language: lang };
  }
  if (/how long|ready|processing|lead time|turnaround|pickup|gaano katagal|kailan (ready|matatapos)/.test(text)) {
    return { answer: policyAnswer('processing', lang), in_scope: true, language: lang };
  }
  if (
    /how many|capacity|simultaneous|available|availability|slot|full|double book|overlap|ilang|bakante|puno/.test(
      text
    )
  ) {
    return { answer: policyAnswer('capacity', lang), in_scope: true, language: lang };
  }
  if (/cancel|resched|move my|change my date|i-cancel|ipagpaliban|palitan ang date|ilipat/.test(text)) {
    return { answer: policyAnswer('cancel', lang), in_scope: true, language: lang };
  }
  if (/out of town|outside|travel fee|deliver|labas ng bayan|delivery/.test(text)) {
    return { answer: policyAnswer('travel', lang), in_scope: true, language: lang };
  }
  if (matches.length) {
    const intro = isPriceQuestion(text)
      ? pick(lang, 'Here are the rates on file:', 'Ito ang mga rate sa file:')
      : pick(lang, 'Here is what we offer:', 'Ito ang mga offer namin:');
    const rows = matches.slice(0, 6).map((service) => describeService(service, lang));
    return {
      answer: `${intro}\n\n${rows.join('\n')}\n\n${pick(
        lang,
        'Rates are starting prices; custom sizes and out-of-town events get a clear quote before confirmation.',
        'Starting prices ang mga rate; ang custom sizes at out-of-town events ay may malinaw na quote bago ma-confirm.'
      )}`,
      in_scope: true,
      language: lang,
    };
  }
  if (
    /how.*(book|order|reserve)|book a|start a booking|steps|how does this work|paano.*(book|booking|order|reserve|event|pickup|gumawa|mag-?create)|gumawa ng (bagong )?(booking|event)|mag-?book/.test(
      text
    )
  ) {
    return {
      answer: pick(
        lang,
        'Open New booking, choose Event or Pickup, add the pieces you need, then send the date. The studio checks the calendar and confirms availability; the 50% reservation details follow. You can follow every status and payment from My bookings.',
        'Buksan ang New booking, pumili ng Event o Pickup, idagdag ang mga kailangan, tapos ipadala ang date. Titingnan ng studio ang calendar at iko-confirm ang availability; susunod ang 50% reservation details. Makikita mo ang bawat status at bayad sa My bookings.'
      ),
      in_scope: true,
      language: lang,
    };
  }
  if (/contact|email|phone|call|reach you|message you|makipag-ugnayan|numero/.test(text)) {
    return {
      answer: pick(
        lang,
        'The studio email is hello@preciousmoments.ph. Branch addresses are listed under the branches question, and the studio is open Monday to Saturday, 9:00 AM to 6:00 PM.',
        'Ang email ng studio ay hello@preciousmoments.ph. Nasa branches question ang addresses, at bukas kami Lunes hanggang Sabado, 9:00 AM hanggang 6:00 PM.'
      ),
      in_scope: true,
      language: lang,
    };
  }
  if (
    /^(hi|hello|hey|good (morning|afternoon|evening))\b|what can you (do|answer)|^help\b|^(kumusta|kamusta|magandang (umaga|hapon|gabi))\b|ano ang (kaya|pwedeng) (mong )?gawin/.test(
      text
    )
  ) {
    return { answer: greetingAnswer(lang), in_scope: true, language: lang };
  }

  return {
    answer: lang === 'fil' ? OUT_OF_SCOPE_FIL : OUT_OF_SCOPE,
    in_scope: false,
    language: lang,
  };
}
