/**
 * End-to-end smoke test (`npm test`).
 *
 * Boots a real server on a free port with a throwaway DATA_DIR, then drives it
 * over HTTP exactly as a browser would: sign up, sign in, book, pay, edit,
 * cancel, two-factor, reports, and the permission boundaries between roles.
 *
 * Nothing outside the temp directory is touched, and Supabase is never used:
 * the run is fully offline except for a local stand-in geocoder.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { totpAt } from '../server/security.js';
import { addMissingCatalogServices } from '../server/store.js';

const port = 3300 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precious-moments-test-'));
const checks = [];

// Stand-in geocoder: the real one needs the network, the tests need the same
// response every run. Addresses mentioning a branch's town resolve to that branch.
const geocoderPort = port + 1;
const geocoder = http.createServer((req, res) => {
  const query = (new URL(req.url, 'http://127.0.0.1').searchParams.get('q') || '').toLowerCase();
  const hit = query.includes('bauan')
    ? { lat: '13.7923305', lon: '121.0103575' }
    : query.includes('batangas')
      ? { lat: '13.7606916', lon: '121.0573095' }
      : null;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(hit ? [hit] : []));
});
await new Promise((resolve) => geocoder.listen(geocoderPort, '127.0.0.1', resolve));

function pass(name) {
  checks.push(name);
  console.log(`  ✓ ${name}`);
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Test server exited before becoming ready.');
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not become ready.');
}

// A cookie jar that keeps both the session and a pending MFA challenge, so the
// full sign-in flow can be exercised without leaking one into the other.
function session() {
  const jar = new Map();
  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (jar.size) headers.Cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    const response = await fetch(`${base}${pathname}`, { ...options, headers, redirect: 'manual' });
    for (const value of response.headers.getSetCookie?.() || []) {
      const pair = value.split(';')[0];
      const index = pair.indexOf('=');
      const key = pair.slice(0, index);
      const cookieValue = pair.slice(index + 1);
      if (!key.startsWith('pm_')) continue;
      if (!cookieValue || /expires=thu, 01 jan 1970/i.test(value)) jar.delete(key);
      else jar.set(key, cookieValue);
    }
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body, headers: response.headers };
  };
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A real, standards-compliant PNG so the image endpoint is tested end to end. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function samplePng(width = 300, height = 300, rgb = [199, 43, 92]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Tiny MP4/WebM headers: enough to exercise the media route without a binary fixture. */
function sampleMp4() {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('mp42', 8, 'ascii');
  buffer.write('mp42', 16, 'ascii');
  buffer.write('isom', 20, 'ascii');
  return buffer;
}

function sampleWebm() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f]);
}

async function latestResetLink() {
  const pattern = /\[development password reset\] (\S+)/g;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const matches = [...serverLog.matchAll(pattern)];
    if (matches.length) return matches[matches.length - 1][1];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The development password-reset link was not written to the server log.');
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: 'test',
    SESSION_SECRET: 'smoke-test-only-secret-not-for-production',
    GEOCODER_URL: `http://127.0.0.1:${geocoderPort}/search`,
    GEOCODER_ENABLED: 'true',
    SEED_DEMO: 'true',
    MAX_SIMULTANEOUS_SERVICES: '5',
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  serverLog += chunk.toString();
});

try {
  await waitForServer(child);
  pass('server starts with an isolated store');

  const publicSession = session();
  const health = await publicSession('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const ready = await publicSession('/api/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ok, true);
  const malformedCookie = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: 'pm_session=%E0%A4%A' },
  });
  assert.equal(malformedCookie.status, 401);
  pass('health, readiness, cache headers, and malformed-cookie handling are safe');

  const root = await publicSession('/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/shop');
  const shop = await publicSession('/shop/');
  assert.equal(shop.status, 200);
  assert.match(shop.body, /Precious Moments/);
  assert.match(shop.body, /\/shop\/assets\//);
  const shopAsset = shop.body.match(/\/shop\/assets\/[^"']+\.js/);
  assert.ok(shopAsset, 'the storefront references its compiled JavaScript bundle');
  const shopAssetResponse = await publicSession(shopAsset[0]);
  assert.equal(shopAssetResponse.status, 200);
  assert.match(shopAssetResponse.headers.get('content-type') || '', /javascript/);
  pass('the public catalog opens without a session and serves its compiled assets');

  const welcome = await publicSession('/welcome');
  assert.equal(welcome.status, 200);
  assert.match(welcome.body, /Keep the moment/);
  const loginPage = await publicSession('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.body, /Create my account/);
  assert.match(loginPage.body, /Crew records do not sign in/);
  assert.match(loginPage.body, /Forgot your password\?/);
  const forgotPage = await publicSession('/forgot-password');
  assert.equal(forgotPage.status, 200);
  assert.match(forgotPage.body, /Send reset link/);
  const resetPage = await publicSession('/reset-password');
  assert.equal(resetPage.status, 200);
  assert.match(resetPage.body, /Choose a new password/);
  pass('the welcome page and sign-up/sign-in interface render');
  pass('every role sees the forgot-password entry point and both recovery pages render');

  const catalog = await publicSession('/api/services');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.services.length >= 130);
  assert.equal(catalog.body.categories.length, 10);
  assert.ok(catalog.body.services.some((service) => service.id === 'tarpaulin'));
  assert.ok(catalog.body.services.some((service) => service.id === 'booth-360'));
  assert.equal(Number(catalog.body.services.find((service) => service.id === 'tarpaulin').price), 1200);
  assert.equal(catalog.body.services.find((service) => service.id === 'tarpaulin').booking_availability, 'pickup');
  assert.equal(catalog.body.services.find((service) => service.id === 'tarpaulin-custom').booking_availability, 'pickup');
  assert.equal(catalog.body.services.find((service) => service.id === 'blackout-custom').booking_availability, 'pickup');
  const magnet = catalog.body.services.find((service) => service.id === 'magnet');
  assert.equal(magnet.booking_availability, 'pickup');
  assert.deepEqual(
    magnet.tiers.map((row) => [row.min, row.max, Number(row.price)]),
    [
      [1, 29, 35],
      [30, null, 30],
    ]
  );
  const anonPricing = await publicSession('/api/pricing');
  assert.equal(anonPricing.status, 401);
  const publicKeys = new Set(Object.keys(catalog.body.services[0]));
  for (const internal of ['review_note', 'needs_review', 'image_updated_by', 'admin_edited', 'origin', 'created_at']) {
    assert.equal(publicKeys.has(internal), false, `public catalog leaked ${internal}`);
  }
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  pass('the 2026 catalog has ten public categories and quantity breaks');
  pass('the public catalog omits internal review and editor metadata');

  // A store seeded before Tarpaulin and Blackout became measured products must
  // receive them on the next startup, without rewriting prices it already has.
  const legacyStore = {
    rows: [{ id: 'tarpaulin', name: 'Tarpaulin – 2×3 ft', price: 1200, active: true }],
    async list(table) {
      assert.equal(table, 'services');
      return this.rows.map((row) => ({ ...row }));
    },
    async insertMany(table, rows) {
      assert.equal(table, 'services');
      this.rows.push(...rows);
    },
  };
  const addedByUpgrade = await addMissingCatalogServices(legacyStore);
  assert.ok(addedByUpgrade >= 2);
  assert.ok(legacyStore.rows.some((row) => row.id === 'tarpaulin-custom'));
  assert.ok(legacyStore.rows.some((row) => row.id === 'blackout-custom'));
  assert.equal(legacyStore.rows.find((row) => row.id === 'tarpaulin').price, 1200);
  pass('an existing catalog gains new products on startup without losing its prices');

  const measuredTarpaulin = catalog.body.services.find((service) => service.id === 'tarpaulin-custom');
  const blackout = catalog.body.services.find((service) => service.id === 'blackout-custom');
  assert.equal(Number(measuredTarpaulin.price), 20);
  assert.equal(measuredTarpaulin.pricing_mode, 'area');
  assert.equal(measuredTarpaulin.round_dimensions_up, true);
  assert.equal(Number(measuredTarpaulin.min_dimension), 1);
  assert.ok(measuredTarpaulin.image_url);
  assert.equal(Number(blackout.price), 30);
  assert.equal(blackout.pricing_mode, 'area');
  assert.equal(blackout.round_dimensions_up, true);
  assert.ok(blackout.image_url);
  pass('Tarpaulin and Blackout publish separate per-square-foot configurations');

  const anonymous = await publicSession('/api/bookings');
  assert.equal(anonymous.status, 401);
  pass('bookings require a session');

  // ---- Password policy
  const weakRegistration = await publicSession('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Weak User', email: `weak-${Date.now()}@example.com`, password: 'weakpass1' }),
  });
  assert.equal(weakRegistration.status, 400);
  assert.match(weakRegistration.body.error, /uppercase/i);
  pass('registration rejects a password without the full character set');

  const customer = session();
  const email = `smoke-${Date.now()}@example.com`;
  const registration = await customer('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Tester', email, phone: '0999 000 0000', password: 'Smoke@Test123' }),
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.role, 'customer');
  assert.equal(registration.body.user.mfa_enabled, false);
  pass('customer registration enforces a strong password and signs in');

  // ---- Measurement-based pricing, rounding, and validation
  const measuredBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(60),
      items: [
        { service_id: 'tarpaulin-custom', length_ft: 2.3, height_ft: 5, qty: 1 },
        { service_id: 'blackout-custom', length_ft: 2, height_ft: 5.7, qty: 1 },
      ],
    }),
  });
  assert.equal(measuredBooking.status, 201, measuredBooking.body.error);
  assert.equal(measuredBooking.body.booking.total, 660);
  const tarpLine = measuredBooking.body.booking.items.find((item) => item.service_id === 'tarpaulin-custom');
  const blackoutLine = measuredBooking.body.booking.items.find((item) => item.service_id === 'blackout-custom');
  assert.equal(tarpLine.original_width_ft, 2.3);
  assert.equal(tarpLine.original_height_ft, 5);
  assert.equal(tarpLine.billed_width_ft, 3);
  assert.equal(tarpLine.billed_height_ft, 5);
  assert.equal(tarpLine.area_sqft, 15);
  assert.equal(tarpLine.unit_price, 20);
  assert.equal(tarpLine.line_total, 300);
  assert.equal(blackoutLine.billed_height_ft, 6);
  assert.equal(blackoutLine.area_sqft, 12);
  assert.equal(blackoutLine.line_total, 360);
  pass('measured products round each side up and use their own rates');

  const tamperedMeasurement = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(60),
      items: [
        { service_id: 'tarpaulin-custom', length_ft: 2, height_ft: 5, unit_price: 1, line_total: 1, qty: 1 },
      ],
    }),
  });
  assert.equal(tamperedMeasurement.status, 201, tamperedMeasurement.body.error);
  assert.equal(tamperedMeasurement.body.booking.total, 200);
  pass('submitted prices are ignored and the server reprices measured lines');

  const tooShortMeasurement = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(60),
      items: [{ service_id: 'tarpaulin-custom', length_ft: 0.5, height_ft: 5 }],
    }),
  });
  assert.equal(tooShortMeasurement.status, 400);
  assert.match(tooShortMeasurement.body.error, /between 1 and 50/);
  const zeroMeasurement = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(60),
      items: [{ service_id: 'tarpaulin-custom', length_ft: 0, height_ft: 5 }],
    }),
  });
  assert.equal(zeroMeasurement.status, 400);
  assert.match(zeroMeasurement.body.error, /greater than zero/);
  pass('measured lines reject zero and below-minimum dimensions');

  const duplicate = await publicSession('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Tester', email, password: 'Smoke@Test123' }),
  });
  assert.equal(duplicate.status, 409);
  pass('duplicate email is rejected');

  // ---- Event booking
  const booking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: futureDate(30),
      event_time: '14:00',
      duration_hours: 3,
      venue: 'Smoke test garden',
      address: 'P. Burgos Street, Batangas City, Batangas',
      notes: 'Automated check.',
      items: [
        { service_id: 'photo', qty: 1 },
        { service_id: 'photobooth-strips', qty: 1 },
      ],
    }),
  });
  assert.equal(booking.status, 201);
  assert.equal(booking.body.booking.total, 8000);
  assert.equal(booking.body.booking.subtotal, 8000);
  assert.equal(booking.body.booking.booking_type, 'event');
  assert.equal(Number(booking.body.booking.duration_hours), 3);
  assert.equal(booking.body.booking.branch?.id, 'branch-batangas');
  assert.equal(booking.body.booking.needs_review, false);
  const bookingId = booking.body.booking.id;
  pass('an event booking stores its type, duration, price, and routed branch');

  const pickupOnlyEvent = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: futureDate(34),
      event_time: '10:00',
      duration_hours: 2,
      venue: 'Pickup-only product venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'tarpaulin', qty: 1 }],
    }),
  });
  assert.equal(pickupOnlyEvent.status, 400);
  assert.match(pickupOnlyEvent.body.error, /not available for event bookings/i);
  pass('pickup-only products cannot be added to event bookings');

  const noAddress = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: futureDate(31),
      event_time: '09:00',
      duration_hours: 3,
      venue: 'No address venue',
      address: '',
      items: [{ service_id: 'photobooth-strips', qty: 1 }],
    }),
  });
  assert.equal(noAddress.status, 400);
  pass('an event booking still requires a service address');

  // ---- Pickup booking
  const pickup = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-bauan',
      pickup_date: futureDate(12),
      pickup_time: '10:00',
      items: [{ service_id: 'tarpaulin', qty: 1 }],
    }),
  });
  assert.equal(pickup.status, 201);
  assert.equal(pickup.body.booking.booking_type, 'pickup');
  assert.equal(pickup.body.booking.branch_id, 'branch-bauan');
  assert.equal(pickup.body.booking.venue, 'Pickup — Bauan branch');
  assert.equal(pickup.body.booking.address, '');
  assert.equal(Number(pickup.body.booking.duration_hours), 0);
  assert.equal(pickup.body.booking.total, 1200);
  pass('a pickup booking uses only a chosen branch and pickup date');

  const pickupNoBranch = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      pickup_date: futureDate(12),
      items: [{ service_id: 'tarpaulin', qty: 1 }],
    }),
  });
  assert.equal(pickupNoBranch.status, 400);
  pass('a pickup booking requires an explicit branch');

  // Quantity breaks are calculated from the stored catalog, and a quantity that
  // falls between two published breaks is refused instead of guessed.
  const tierBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(41),
      items: [
        { service_id: 'magnet', qty: 30 },
        { service_id: 'tote', qty: 5 },
        { service_id: 'print-2r', qty: 14 },
      ],
    }),
  });
  assert.equal(tierBooking.status, 201, tierBooking.body.error);
  assert.equal(tierBooking.body.booking.total, 900 + 1000 + 42);
  pass('quantity breaks and print minimums are priced on the server');

  const gapBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(41),
      items: [{ service_id: 'key-holder', qty: 75 }],
    }),
  });
  assert.equal(gapBooking.status, 400);
  assert.match(gapBooking.body.error, /price breaks/);
  pass('a quantity between published price breaks asks for a quote');

  // Manual branch selection beats the geocoder, for both types.
  const manualBranch = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: futureDate(32),
      event_time: '11:00',
      duration_hours: 2,
      venue: 'Manual branch venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      branch_id: 'branch-bauan',
      items: [{ service_id: 'photobooth-strips', qty: 1 }],
    }),
  });
  assert.equal(manualBranch.status, 201);
  assert.equal(manualBranch.body.booking.branch_id, 'branch-bauan');
  pass('a manually chosen branch overrides the detected nearest branch');

  const reviewBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: futureDate(33),
      event_time: '09:00',
      duration_hours: 2,
      venue: 'Somewhere with no street',
      address: 'Behind the blue gate, no street name',
      items: [{ service_id: 'photobooth-strips', qty: 1 }],
    }),
  });
  assert.equal(reviewBooking.status, 201);
  assert.equal(reviewBooking.body.booking.branch, null);
  assert.equal(reviewBooking.body.booking.needs_review, true);
  pass('an address that cannot be located is flagged for review, not guessed');

  const customerPatch = await customer(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(customerPatch.status, 403);
  pass('customers cannot change booking status');

  // ---- Capacity: five simultaneous services per branch/window
  const capacityDate = futureDate(200);
  const capacityBookings = [];
  for (let index = 0; index < 5; index += 1) {
    const created = await customer('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        booking_type: 'event',
        event_date: capacityDate,
        event_time: '07:00',
        duration_hours: 5,
        branch_id: 'branch-batangas',
        venue: `Capacity venue ${index + 1}`,
        address: 'P. Burgos Street, Batangas City, Batangas',
        items: [{ service_id: 'photobooth-strips', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201, created.body.error);
    capacityBookings.push(created.body.booking);
  }
  pass('five simultaneous booths can be booked for the same window');

  // Fire the requests together, not one after another: without the booking
  // mutex every request could read the same free capacity before any write.
  const raceDate = futureDate(201);
  const race = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      customer('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          booking_type: 'event',
          event_date: raceDate,
          event_time: '07:00',
          duration_hours: 5,
          branch_id: 'branch-batangas',
          venue: `Race venue ${index + 1}`,
          address: 'P. Burgos Street, Batangas City, Batangas',
          items: [{ service_id: 'photobooth-strips', qty: 1 }],
        }),
      })
    )
  );
  const accepted = race.filter((result) => result.status === 201);
  assert.equal(accepted.length, 5, race.map((result) => result.status).join(','));
  assert.equal(race.filter((result) => result.status === 409).length, 1);
  assert.equal(new Set(accepted.map((result) => result.body.booking.ref)).size, 5);
  pass('parallel booking requests keep references unique and never overbook');

  const overflow = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: capacityDate,
      event_time: '08:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Overflow venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(overflow.status, 409);
  assert.match(overflow.body.error, /5 simultaneous services/);
  assert.match(overflow.body.error, /12:00 PM/);
  pass('a sixth overlapping service is refused with the next open start');

  const laterSlot = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: capacityDate,
      event_time: '12:00',
      duration_hours: 3,
      branch_id: 'branch-batangas',
      venue: 'Later venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(laterSlot.status, 201, laterSlot.body.error);
  pass('the next time window on the same day stays bookable');

  const printOnly = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: capacityDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Print delivery venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'photo-tent', qty: 1 }],
    }),
  });
  assert.equal(printOnly.status, 201, printOnly.body.error);
  pass('non-capacity event services do not consume a booth slot');

  const availability = await customer(
    `/api/availability?date=${capacityDate}&branch_id=branch-batangas&time=07:00&hours=2&services=photobooth-strips`
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.body.availability.full, true);
  assert.equal(availability.body.availability.capacity, 5);
  assert.equal(availability.body.availability.next_label, '12:00 PM');
  assert.equal(Object.keys(availability.body.booth_availability.types).length, 4);
  assert.ok(availability.body.booth_availability.window);
  pass('availability reports the full window, next open start, and physical booth state');

  // ---- Admin, crew records and studio accounts
  const badLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@precious.ph', password: 'wrong-password' }),
  });
  assert.equal(badLogin.status, 401);
  pass('wrong password is rejected');

  const admin = session();
  const adminLogin = await admin('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@precious.ph', password: 'Admin123!' }),
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.user.role, 'admin');
  pass('admin demo login works');

  // ---- Physical booth inventory: per-type limits, release, and blocks
  const videoDate = futureDate(260);
  const firstVideo = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: videoDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Video inventory venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(firstVideo.status, 201, firstVideo.body.error);
  const secondVideo = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: videoDate,
      event_time: '10:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Second video inventory venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(secondVideo.status, 409);
  assert.match(secondVideo.body.error, /Video booth|physical unit/i);
  pass('the single Video Booth cannot be booked twice in an overlapping window');

  const cancelVideo = await customer(`/api/bookings/${firstVideo.body.booking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'cancel', reason: 'change_of_plans' }),
  });
  assert.equal(cancelVideo.status, 200);
  const videoAfterCancel = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: videoDate,
      event_time: '10:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Video after cancellation',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(videoAfterCancel.status, 201, videoAfterCancel.body.error);
  const confirmedVideo = await admin(`/api/bookings/${videoAfterCancel.body.booking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(confirmedVideo.status, 200);
  const confirmedInventory = await admin(`/api/inventory?date=${videoDate}&time=10:00&hours=2`);
  assert.equal(confirmedInventory.status, 200);
  assert.equal(
    confirmedInventory.body.inventory.types.find((row) => row.type === 'video').deployed,
    1
  );
  const videoWhileConfirmed = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: videoDate,
      event_time: '10:30',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Video while confirmed',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(videoWhileConfirmed.status, 409);
  pass('cancelling releases a unit and confirmed bookings still count as deployed');

  const moveTargetDate = futureDate(268);
  const moveSourceDate = futureDate(269);
  const targetVideo = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: moveTargetDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Video move target',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(targetVideo.status, 201, targetVideo.body.error);
  const sourceVideo = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: moveSourceDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Video move source',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-360', qty: 1 }],
    }),
  });
  assert.equal(sourceVideo.status, 201, sourceVideo.body.error);
  const moveIntoCommitted = await admin(`/api/bookings/${sourceVideo.body.booking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ event_date: moveTargetDate }),
  });
  assert.equal(moveIntoCommitted.status, 409);
  pass('editing a booking into an occupied physical booth window is refused');

  const mirrorDate = futureDate(261);
  const firstMirror = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: mirrorDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Mirror inventory venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-mirror', qty: 1 }],
    }),
  });
  assert.equal(firstMirror.status, 201, firstMirror.body.error);
  const secondMirror = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: mirrorDate,
      event_time: '10:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Overlapping mirror venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-mirror', qty: 1 }],
    }),
  });
  assert.equal(secondMirror.status, 409);
  assert.match(secondMirror.body.error, /Mirror booth|physical unit/i);
  pass('the single Mirror Booth refuses a second overlapping booking');

  const studioDate = futureDate(262);
  const studioBookings = [];
  for (let index = 0; index < 2; index += 1) {
    const created = await customer('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        booking_type: 'event',
        event_date: studioDate,
        event_time: '09:00',
        duration_hours: 2,
        branch_id: 'branch-batangas',
        venue: `Studio inventory venue ${index + 1}`,
        address: 'P. Burgos Street, Batangas City, Batangas',
        items: [{ service_id: 'booth-studio', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201, created.body.error);
    studioBookings.push(created.body.booking);
  }
  const thirdStudio = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: studioDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Third studio inventory venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-studio', qty: 1 }],
    }),
  });
  assert.equal(thirdStudio.status, 409);
  assert.match(thirdStudio.body.error, /Studio booth|physical unit/i);
  pass('the two Studio Booth units allow exactly two overlapping bookings');

  const photoboothDate = futureDate(266);
  for (let index = 0; index < 5; index += 1) {
    const created = await customer('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        booking_type: 'event',
        event_date: photoboothDate,
        event_time: '09:00',
        duration_hours: 2,
        branch_id: 'branch-batangas',
        venue: `Photobooth inventory venue ${index + 1}`,
        address: 'P. Burgos Street, Batangas City, Batangas',
        items: [{ service_id: 'photobooth-4r', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201, created.body.error);
  }
  const sixthPhotobooth = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: photoboothDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Sixth photobooth inventory venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'photobooth-4r', qty: 1 }],
    }),
  });
  assert.equal(sixthPhotobooth.status, 409);
  pass('five Photobooth units can overlap and the sixth is refused');

  const raceBoothDate = futureDate(264);
  const boothRace = await Promise.all(
    Array.from({ length: 2 }, (_, index) =>
      customer('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          booking_type: 'event',
          event_date: raceBoothDate,
          event_time: '09:00',
          duration_hours: 2,
          branch_id: 'branch-batangas',
          venue: `Video booth race ${index + 1}`,
          address: 'P. Burgos Street, Batangas City, Batangas',
          items: [{ service_id: 'booth-360', qty: 1 }],
        }),
      })
    )
  );
  assert.equal(boothRace.filter((result) => result.status === 201).length, 1);
  assert.equal(boothRace.filter((result) => result.status === 409).length, 1);
  pass('simultaneous bookings cannot double-reserve the single Video Booth');

  const blockDate = futureDate(263);
  const inventoryBlock = await admin('/api/inventory/blocks', {
    method: 'POST',
    body: JSON.stringify({
      booth_type: 'mirror',
      unit_label: 'MB-1',
      kind: 'maintenance',
      start_date: blockDate,
      start_time: '09:00',
      end_date: blockDate,
      end_time: '12:00',
      reason: 'Mirror calibration',
    }),
  });
  assert.equal(inventoryBlock.status, 201, inventoryBlock.body.error);
  const blockedMirror = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: blockDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Blocked mirror venue',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-mirror', qty: 1 }],
    }),
  });
  assert.equal(blockedMirror.status, 409);
  assert.match(blockedMirror.body.error, /Mirror booth|physical unit/i);
  const outsideBlock = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: blockDate,
      event_time: '12:30',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Mirror after maintenance',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-mirror', qty: 1 }],
    }),
  });
  assert.equal(outsideBlock.status, 201, outsideBlock.body.error);
  const inventoryView = await admin(`/api/inventory?date=${blockDate}&time=09:00&hours=3`);
  assert.equal(inventoryView.status, 200);
  assert.equal(inventoryView.body.inventory.totals.units, 9);
  const mirrorInventory = inventoryView.body.inventory.types.find((row) => row.type === 'mirror');
  assert.equal(mirrorInventory.total, 1);
  assert.equal(mirrorInventory.maintenance, 1);
  assert.equal(mirrorInventory.available, 0);
  assert.ok(inventoryView.body.inventory.blocks.some((block) => block.unit_label === 'MB-1'));
  const badBlockUnit = await admin('/api/inventory/blocks', {
    method: 'POST',
    body: JSON.stringify({
      booth_type: 'video',
      unit_label: 'MB-1',
      kind: 'maintenance',
      start_date: blockDate,
      start_time: '09:00',
      end_date: blockDate,
      end_time: '10:00',
    }),
  });
  assert.equal(badBlockUnit.status, 400);
  const releasedBlock = await admin(`/api/inventory/blocks/${inventoryBlock.body.block.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  assert.equal(releasedBlock.status, 200);
  const mirrorAfterRelease = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'event',
      event_date: blockDate,
      event_time: '09:00',
      duration_hours: 2,
      branch_id: 'branch-batangas',
      venue: 'Mirror after release',
      address: 'P. Burgos Street, Batangas City, Batangas',
      items: [{ service_id: 'booth-mirror', qty: 1 }],
    }),
  });
  assert.equal(mirrorAfterRelease.status, 201, mirrorAfterRelease.body.error);
  pass('maintenance blocks remove a unit, show on the inventory dashboard, and release safely');

  const blockRaceDate = futureDate(267);
  const blockRace = await Promise.all(
    Array.from({ length: 2 }, () =>
      admin('/api/inventory/blocks', {
        method: 'POST',
        body: JSON.stringify({
          booth_type: 'mirror',
          unit_label: 'MB-1',
          kind: 'maintenance',
          start_date: blockRaceDate,
          start_time: '09:00',
          end_date: blockRaceDate,
          end_time: '12:00',
          reason: 'Parallel block test',
        }),
      })
    )
  );
  assert.equal(blockRace.filter((result) => result.status === 201).length, 1);
  assert.equal(blockRace.filter((result) => result.status === 409).length, 1);
  const createdRaceBlock = blockRace.find((result) => result.status === 201).body.block;
  const releaseRaceBlock = await admin(`/api/inventory/blocks/${createdRaceBlock.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  assert.equal(releaseRaceBlock.status, 200);
  pass('parallel maintenance blocks cannot double-block the same physical unit');

  // ---- Logistics: deployment status, physical units, setup/pickup schedules
  const logisticsBooking = videoAfterCancel.body.booking;
  const wrongLogisticsUnit = await admin(`/api/bookings/${logisticsBooking.id}/logistics`, {
    method: 'PATCH',
    body: JSON.stringify({ assigned_units: ['MB-1'] }),
  });
  assert.equal(wrongLogisticsUnit.status, 409);
  assert.match(wrongLogisticsUnit.body.error, /Mirror booth|does not request/i);

  const scheduledLogistics = await admin(`/api/bookings/${logisticsBooking.id}/logistics`, {
    method: 'PATCH',
    body: JSON.stringify({
      deployment_status: 'scheduled',
      assigned_units: ['VB-1'],
      setup_date: videoDate,
      setup_time: '08:30',
      pickup_schedule_date: videoDate,
      pickup_schedule_time: '13:00',
      logistics_notes: 'Loading bay access from the side street.',
    }),
  });
  assert.equal(scheduledLogistics.status, 200, scheduledLogistics.body.error);
  assert.equal(scheduledLogistics.body.booking.deployment_status, 'scheduled');
  assert.deepEqual(scheduledLogistics.body.booking.assigned_units, ['VB-1']);
  assert.equal(scheduledLogistics.body.booking.setup_time, '08:30');
  assert.equal(scheduledLogistics.body.booking.pickup_schedule_time, '13:00');

  const clearedScheduledUnits = await admin(`/api/bookings/${logisticsBooking.id}/logistics`, {
    method: 'PATCH',
    body: JSON.stringify({ assigned_units: [] }),
  });
  assert.equal(clearedScheduledUnits.status, 400);
  assert.match(clearedScheduledUnits.body.error, /Assign 1 video booth unit/i);

  const earlyPickup = await admin(`/api/bookings/${logisticsBooking.id}/logistics`, {
    method: 'PATCH',
    body: JSON.stringify({ pickup_schedule_date: videoDate, pickup_schedule_time: '09:00' }),
  });
  assert.equal(earlyPickup.status, 400);
  assert.match(earlyPickup.body.error, /before the event starts/i);
  const clearedScheduledBranch = await admin(`/api/bookings/${logisticsBooking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ branch_id: null }),
  });
  assert.equal(clearedScheduledBranch.status, 400);
  assert.match(clearedScheduledBranch.body.error, /Assign a branch/i);
  const movedBeforeSetup = await admin(`/api/bookings/${logisticsBooking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ event_time: '08:00' }),
  });
  assert.equal(movedBeforeSetup.status, 409);
  assert.match(movedBeforeSetup.body.error, /setup schedule/i);

  const adminCalendar = await admin(`/api/logistics?from=${videoDate}&to=${videoDate}`);
  assert.equal(adminCalendar.status, 200);
  const logisticsEntries = adminCalendar.body.entries.filter(
    (entry) => entry.booking_id === logisticsBooking.id
  );
  assert.ok(logisticsEntries.some((entry) => entry.type === 'setup'));
  assert.ok(logisticsEntries.some((entry) => entry.type === 'event'));
  assert.ok(logisticsEntries.some((entry) => entry.type === 'pickup'));
  assert.ok(logisticsEntries.every((entry) => entry.assigned_units.includes('VB-1')));
  assert.ok(adminCalendar.body.summary.assigned_units >= 1);
  const customerLogisticsRead = await customer(`/api/logistics?from=${videoDate}&to=${videoDate}`);
  assert.equal(customerLogisticsRead.status, 403);
  const customerLogisticsWrite = await customer(`/api/bookings/${logisticsBooking.id}/logistics`, {
    method: 'PATCH',
    body: JSON.stringify({ deployment_status: 'dispatched' }),
  });
  assert.equal(customerLogisticsWrite.status, 403);
  const assignedDayA = futureDate(271);
  const assignedDayB = futureDate(272);
  const assignedBookings = [];
  for (const [index, day] of [assignedDayA, assignedDayB].entries()) {
    const created = await customer('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        booking_type: 'event',
        event_date: day,
        event_time: '09:00',
        duration_hours: 2,
        branch_id: 'branch-batangas',
        venue: `Assigned unit venue ${index + 1}`,
        address: 'P. Burgos Street, Batangas City, Batangas',
        items: [{ service_id: 'photobooth-4r', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201, created.body.error);
    const assigned = await admin(`/api/bookings/${created.body.booking.id}/logistics`, {
      method: 'PATCH',
      body: JSON.stringify({ deployment_status: 'scheduled', assigned_units: ['PB-1'] }),
    });
    assert.equal(assigned.status, 200, assigned.body.error);
    assignedBookings.push(assigned.body.booking);
  }
  const movedAssignedUnit = await admin(`/api/bookings/${assignedBookings[1].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ event_date: assignedDayA }),
  });
  assert.equal(movedAssignedUnit.status, 409);
  assert.match(movedAssignedUnit.body.error, /PB-1 is already assigned/i);
  pass('moving a booking cannot duplicate a specific assigned unit in an overlapping window');

  pass('deployment statuses, assigned units, and setup/pickup schedules are validated and scoped');

  const logisticsAssistant = await admin('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: `Which units are assigned to deployments on ${videoDate}?` }),
  });
  assert.equal(logisticsAssistant.body.in_scope, true);
  assert.match(logisticsAssistant.body.answer, /VB-1/);
  const scheduleAssistant = await admin('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: `What is scheduled on ${videoDate}?` }),
  });
  assert.equal(scheduleAssistant.body.in_scope, true);
  assert.match(scheduleAssistant.body.answer, /Setup|Event|Pickup/);
  assert.match(scheduleAssistant.body.answer, /PM-\d+/);
  const inventoryAssistant = await admin('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'How many photobooth units are available?' }),
  });
  assert.equal(inventoryAssistant.body.in_scope, true);
  assert.match(inventoryAssistant.body.answer, /Photobooth/);
  const customerLogisticsAssistant = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'Which units are assigned to my booking?' }),
  });
  assert.equal(customerLogisticsAssistant.body.in_scope, true);
  assert.doesNotMatch(customerLogisticsAssistant.body.answer, /VB-1/);
  pass('PRECIOUS answers logistics, inventory, and schedule questions within role scope');

  const pricing = await admin('/api/pricing');
  assert.equal(pricing.status, 200);
  assert.equal(pricing.body.client_prices.length, 21);
  assert.ok(pricing.body.reviews.length >= 3);
  const customerPricing = await customer('/api/pricing');
  assert.equal(customerPricing.status, 403);
  pass('client-specific rates and review flags are owner-only');

  const editedPrice = await admin('/api/services/sticker-cut-3', {
    method: 'PATCH',
    body: JSON.stringify({ price: 40 }),
  });
  assert.equal(editedPrice.status, 200);
  assert.equal(Number(editedPrice.body.service.price), 40);
  const editedPriceBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(42),
      items: [{ service_id: 'sticker-cut-3', qty: 1 }],
    }),
  });
  assert.equal(editedPriceBooking.status, 201, editedPriceBooking.body.error);
  assert.equal(editedPriceBooking.body.booking.total, 40);
  await admin('/api/services/sticker-cut-3', {
    method: 'PATCH',
    body: JSON.stringify({ price: 36 }),
  });
  pass('an owner price edit applies to the next booking');

  const measuredBeforeEdit = await customer(`/api/bookings/${measuredBooking.body.booking.id}`);
  assert.equal(measuredBeforeEdit.status, 200);
  assert.equal(measuredBeforeEdit.body.booking.total, 660);
  const changedMeasuredRate = await admin('/api/services/tarpaulin-custom', {
    method: 'PATCH',
    body: JSON.stringify({ price: 25 }),
  });
  assert.equal(changedMeasuredRate.status, 200);
  assert.equal(Number(changedMeasuredRate.body.service.price), 25);
  const measuredAfterEdit = await customer(`/api/bookings/${measuredBooking.body.booking.id}`);
  const frozenTarp = measuredAfterEdit.body.booking.items.find((item) => item.service_id === 'tarpaulin-custom');
  assert.equal(frozenTarp.unit_price, 20);
  assert.equal(frozenTarp.area_sqft, 15);
  assert.equal(frozenTarp.line_total, 300);
  assert.equal(measuredAfterEdit.body.booking.total, 660);
  await admin('/api/services/tarpaulin-custom', {
    method: 'PATCH',
    body: JSON.stringify({ price: 20 }),
  });
  pass('confirmed measured orders keep their original rate and dimensions');

  const editedTiers = await admin('/api/services/magnet', {
    method: 'PATCH',
    body: JSON.stringify({
      tiers: [
        { min: 1, max: 29, price: 36, label: '1–29 pcs' },
        { min: 30, max: null, price: 31, label: '30+ pcs' },
      ],
    }),
  });
  assert.equal(editedTiers.status, 200);
  const editedTierBooking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(43),
      items: [{ service_id: 'magnet', qty: 30 }],
    }),
  });
  assert.equal(editedTierBooking.status, 201, editedTierBooking.body.error);
  assert.equal(editedTierBooking.body.booking.total, 930);
  const overlap = await admin('/api/services/magnet', {
    method: 'PATCH',
    body: JSON.stringify({
      tiers: [
        { min: 1, max: 50, price: 36 },
        { min: 40, max: null, price: 31 },
      ],
    }),
  });
  assert.equal(overlap.status, 400);
  assert.match(overlap.body.error, /overlap|open-ended/);
  await admin('/api/services/magnet', {
    method: 'PATCH',
    body: JSON.stringify({
      tiers: [
        { min: 1, max: 29, price: 35, label: '1–29 pcs' },
        { min: 30, max: null, price: 30, label: '30+ pcs' },
      ],
    }),
  });
  pass('quantity breaks are editable and overlapping breaks are rejected');

  const accounts = await admin('/api/accounts');
  assert.equal(accounts.status, 200);
  assert.equal(accounts.body.accounts.length, 3);
  assert.ok(accounts.body.accounts.every((account) => ['admin', 'branch_admin'].includes(account.role)));
  pass('only the owner and branch heads appear as studio accounts');

  const crewList = await admin('/api/staff');
  assert.equal(crewList.status, 200);
  const ana = crewList.body.staff.find((member) => member.email === 'ana@precious.ph');
  assert.ok(ana);
  pass('crew are listed as assignment records');

  const crewLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@precious.ph', password: 'Staff123!' }),
  });
  assert.equal(crewLogin.status, 403);
  assert.match(crewLogin.body.error, /Crew records do not sign in/);
  pass('crew records are refused at sign-in with a clear message');

  const newCrew = await admin('/api/staff', {
    method: 'POST',
    body: JSON.stringify({ name: 'New Crew', phone: '0999 111 2222', branch_id: 'branch-batangas' }),
  });
  assert.equal(newCrew.status, 201);
  assert.equal(newCrew.body.user.role, 'staff');
  assert.match(newCrew.body.user.email, /@crew\.preciousmoments\.local$/);
  pass('admin creates a crew record without issuing a password');

  const assigned = await admin(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed', staff_id: ana.id, message: 'Confirmed in smoke test.' }),
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.booking.status, 'confirmed');
  assert.equal(assigned.body.booking.staff.id, ana.id);
  pass('admin confirms and assigns crew');

  const branchHead = await admin('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Temporary Branch Head',
      email: `head-${Date.now()}@example.com`,
      role: 'branch_admin',
      branch_id: 'branch-batangas',
      password: 'NewHead@2026',
    }),
  });
  assert.equal(branchHead.status, 201);
  const headId = branchHead.body.account.id;
  const headEmail = branchHead.body.account.email;
  pass('the owner creates a branch head account');

  const headSession = session();
  const headLogin = await headSession('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: headEmail, password: 'NewHead@2026' }),
  });
  assert.equal(headLogin.status, 200);

  const deactivated = await admin(`/api/accounts/${headId}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  assert.equal(deactivated.status, 200);
  const blockedLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: headEmail, password: 'NewHead@2026' }),
  });
  assert.equal(blockedLogin.status, 403);
  assert.match(blockedLogin.body.error, /deactivated/i);
  pass('a deactivated account cannot sign in');

  await admin(`/api/accounts/${headId}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
  const reset = await admin(`/api/accounts/${headId}/reset`, {
    method: 'POST',
    body: JSON.stringify({ reset_mfa: true }),
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporary_password.length >= 10);
  const resetSession = session();
  const resetLogin = await resetSession('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: headEmail, password: reset.body.temporary_password }),
  });
  assert.equal(resetLogin.status, 200);
  assert.equal(resetLogin.body.user.must_change_password, true);
  const oldHeadSession = await headSession('/api/auth/me');
  assert.equal(oldHeadSession.status, 401);
  const temporaryBlocked = await resetSession('/api/bookings');
  assert.equal(temporaryBlocked.status, 403);
  assert.equal(temporaryBlocked.body.code, 'password_change_required');
  const temporaryChanged = await resetSession('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: reset.body.temporary_password,
      new_password: 'NewHead@2027!',
    }),
  });
  assert.equal(temporaryChanged.status, 200);
  const afterTemporaryChange = await resetSession('/api/bookings');
  assert.equal(afterTemporaryChange.status, 200);
  pass('reset revokes old sessions and forces a temporary password change');

  const branch1 = session();
  const branch1Login = await branch1('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'batangas@precious.ph', password: 'Branch123!' }),
  });
  assert.equal(branch1Login.status, 200);
  assert.equal(branch1Login.body.user.role, 'branch_admin');
  assert.equal(branch1Login.body.user.branch_id, 'branch-batangas');
  pass('branch 1 administrator signs in with their own account');

  // ---- Shared product images: permissions, validation, replacement, cache path
  const imageConsole = await branch1('/api/product-images');
  assert.equal(imageConsole.status, 200);
  assert.ok(imageConsole.body.stats.total >= 130);
  assert.ok(imageConsole.body.services.some((service) => service.id === 'tarpaulin-custom'));
  const originalCustomImage = imageConsole.body.services.find((service) => service.id === 'tarpaulin-custom').image_url;
  assert.ok(originalCustomImage);

  const customerImageUpload = await customer('/api/services/tarpaulin-custom/image', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: samplePng(),
  });
  assert.equal(customerImageUpload.status, 403);

  const invalidImageUpload = await branch1('/api/services/tarpaulin-custom/image', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('not an image'),
  });
  assert.equal(invalidImageUpload.status, 400);
  assert.equal(invalidImageUpload.body.error, 'Unsupported image format. Please upload JPG, PNG, or WEBP.');

  const uploadedImage = await branch1('/api/services/tarpaulin-custom/image?alt=Smoke-tested%20tarpaulin', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: samplePng(300, 300, [199, 43, 92]),
  });
  assert.equal(uploadedImage.status, 200, uploadedImage.body.error);
  assert.match(uploadedImage.body.service.image_url, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
  assert.equal(uploadedImage.body.service.image_width, 300);
  assert.equal(uploadedImage.body.service.image_height, 300);
  assert.equal(uploadedImage.body.service.image_alt, 'Smoke-tested tarpaulin');
  const uploadedPath = uploadedImage.body.service.image_url;

  const servedImage = await publicSession(uploadedPath);
  assert.equal(servedImage.status, 200);
  assert.match(servedImage.headers.get('content-type') || '', /image\/png/);

  const tooSmallReplacement = await branch1('/api/services/tarpaulin-custom/image', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: samplePng(100, 100),
  });
  assert.equal(tooSmallReplacement.status, 400);
  const afterFailedReplacement = await publicSession('/api/services');
  assert.equal(
    afterFailedReplacement.body.services.find((service) => service.id === 'tarpaulin-custom').image_url,
    uploadedPath
  );

  const adminReplacement = await admin('/api/services/tarpaulin-custom/image?alt=Owner%20replacement', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: samplePng(320, 300, [53, 27, 39]),
  });
  assert.equal(adminReplacement.status, 200, adminReplacement.body.error);
  assert.notEqual(adminReplacement.body.service.image_url, uploadedPath);
  const staleImage = await publicSession(uploadedPath);
  assert.equal(staleImage.status, 404);

  const removedImage = await branch1('/api/services/tarpaulin-custom/image', { method: 'DELETE' });
  assert.equal(removedImage.status, 200);
  assert.equal(removedImage.body.service.image_url, '');
  assert.equal(removedImage.body.service.catalog_visible, false);
  const hiddenCatalog = await publicSession('/api/services');
  assert.equal(hiddenCatalog.body.services.some((service) => service.id === 'tarpaulin-custom'), false);

  const restoredImage = await branch1('/api/services/tarpaulin-custom/image', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: samplePng(300, 300, [160, 55, 80]),
  });
  assert.equal(restoredImage.status, 200);
  assert.equal(restoredImage.body.service.catalog_visible, true);
  const restoredCatalog = await publicSession('/api/services');
  assert.equal(restoredCatalog.body.services.some((service) => service.id === 'tarpaulin-custom'), true);

  const imageAudit = await branch1('/api/product-images');
  assert.ok(imageAudit.body.recent_changes.length >= 3);
  assert.ok(imageAudit.body.recent_changes.every((log) => log.actor_role === 'admin' || log.actor_role === 'branch_admin'));
  pass('both admin roles manage shared images with validation, replacement, audit, and visibility rules');

  // ---- Booth preview videos: shared media, optional, and never allowed from a customer
  const customerVideoUpload = await customer('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: sampleMp4(),
  });
  assert.equal(customerVideoUpload.status, 403);

  const invalidVideoUpload = await branch1('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: Buffer.from('not a video'),
  });
  assert.equal(invalidVideoUpload.status, 400);
  assert.equal(invalidVideoUpload.body.error, 'Unsupported video format. Please upload MP4 or WEBM.');

  const oversizedVideoUpload = await branch1('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: Buffer.concat([sampleMp4(), Buffer.alloc(25 * 1024 * 1024)]),
  });
  assert.equal(oversizedVideoUpload.status, 400);
  assert.equal(oversizedVideoUpload.body.error, 'Video exceeds the 25 MB limit.');

  const unsupportedVideoType = await branch1('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not a video',
  });
  assert.equal(unsupportedVideoType.status, 415);

  const tooLargeVideoUpload = await branch1('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: Buffer.concat([sampleMp4(), Buffer.alloc(30 * 1024 * 1024)]),
  });
  assert.equal(tooLargeVideoUpload.status, 413);
  assert.equal(tooLargeVideoUpload.body.error, 'Video exceeds the 25 MB limit.');

  const uploadedVideo = await branch1('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: sampleMp4(),
  });
  assert.equal(uploadedVideo.status, 200, uploadedVideo.body.error);
  assert.match(uploadedVideo.body.service.video_url, /^\/uploads\/products\/videos\/[a-f0-9-]+\.mp4$/);
  assert.equal(uploadedVideo.body.service.video_mime, 'video/mp4');
  assert.equal(uploadedVideo.body.service.video_bytes, 32);
  const uploadedVideoPath = uploadedVideo.body.service.video_url;

  const servedVideo = await publicSession(uploadedVideoPath);
  assert.equal(servedVideo.status, 200);
  assert.match(servedVideo.headers.get('content-type') || '', /video\/mp4/);

  const publicBooth = await publicSession('/api/services');
  assert.equal(
    publicBooth.body.services.find((service) => service.id === 'booth-360').video_url,
    uploadedVideoPath
  );

  const replacedVideo = await admin('/api/services/booth-360/video', {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: sampleWebm(),
  });
  assert.equal(replacedVideo.status, 200, replacedVideo.body.error);
  assert.match(replacedVideo.body.service.video_url, /\.webm$/);
  assert.notEqual(replacedVideo.body.service.video_url, uploadedVideoPath);
  assert.equal((await publicSession(uploadedVideoPath)).status, 404);

  const videoConsole = await branch1('/api/product-images');
  assert.ok(videoConsole.body.stats.with_video >= 1);
  assert.ok(videoConsole.body.recent_changes.some((log) => String(log.action).startsWith('product_video.')));

  const removedVideo = await branch1('/api/services/booth-360/video', { method: 'DELETE' });
  assert.equal(removedVideo.status, 200);
  assert.equal(removedVideo.body.service.video_url, '');
  assert.equal(removedVideo.body.service.video_mime, '');
  assert.equal((await publicSession(replacedVideo.body.service.video_url)).status, 404);
  const afterVideoRemoval = await publicSession('/api/services');
  assert.equal(afterVideoRemoval.body.services.find((service) => service.id === 'booth-360').video_url || '', '');
  pass('branch heads upload, replace, and remove booth preview videos with audit and size/type checks');

  const branch2 = session();
  const branch2Login = await branch2('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'bauan@precious.ph', password: 'Branch123!' }),
  });
  assert.equal(branch2Login.status, 200);
  assert.equal(branch2Login.body.user.branch_id, 'branch-bauan');
  pass('branch 2 administrator signs in with their own account');

  const branchInventory = await branch1(`/api/inventory?date=${futureDate(260)}&time=09:00&hours=3`);
  assert.equal(branchInventory.status, 200);
  assert.equal(branchInventory.body.inventory.totals.units, 9);
  assert.ok(branchInventory.body.inventory.upcoming.every((item) => item.branch !== 'Bauan branch'));
  const branchBlockAttempt = await branch1('/api/inventory/blocks', {
    method: 'POST',
    body: JSON.stringify({
      booth_type: 'mirror',
      unit_label: 'MB-1',
      kind: 'maintenance',
      start_date: futureDate(270),
      start_time: '09:00',
      end_date: futureDate(270),
      end_time: '10:00',
    }),
  });
  assert.equal(branchBlockAttempt.status, 403);
  pass('branch heads see shared inventory counts, their own deployments, and cannot block units');

  const branchCalendar = await branch1(`/api/logistics?from=${videoDate}&to=${videoDate}`);
  assert.equal(branchCalendar.status, 200);
  assert.ok(branchCalendar.body.entries.some((entry) => entry.ref === logisticsBooking.ref));
  const otherBranchCalendar = await branch2(`/api/logistics?from=${videoDate}&to=${videoDate}`);
  assert.equal(otherBranchCalendar.status, 200);
  assert.ok(otherBranchCalendar.body.entries.every((entry) => entry.ref !== logisticsBooking.ref));
  pass('the logistics calendar is branch-scoped for branch heads');

  const branch1Bookings = await branch1('/api/bookings');
  assert.ok(branch1Bookings.body.bookings.length > 0);
  assert.ok(branch1Bookings.body.bookings.every((item) => item.branch_id === 'branch-batangas'));
  const branch2Bookings = await branch2('/api/bookings');
  assert.ok(branch2Bookings.body.bookings.every((item) => item.branch_id === 'branch-bauan'));
  assert.ok(branch2Bookings.body.bookings.some((item) => item.id === pickup.body.booking.id));
  pass('each branch head sees only their own branch');

  const crossRead = await branch1(`/api/bookings/${pickup.body.booking.id}`);
  assert.equal(crossRead.status, 403);
  const crossPayment = await branch1(`/api/bookings/${pickup.body.booking.id}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'paid' }),
  });
  assert.equal(crossPayment.status, 403);
  pass('the other branch cannot be reached by URL or payment request');

  const reviewHidden = await branch1(`/api/bookings/${reviewBooking.body.booking.id}`);
  assert.equal(reviewHidden.status, 403);
  pass('an unreviewed booking stays hidden from both branches');

  const branch1Crew = await branch1('/api/staff', {
    method: 'POST',
    body: JSON.stringify({ name: 'Should Join Batangas', branch_id: 'branch-bauan' }),
  });
  assert.equal(branch1Crew.status, 201);
  assert.equal(branch1Crew.body.user.branch_id, 'branch-batangas');
  const branch1CrewList = await branch1('/api/staff');
  assert.ok(branch1CrewList.body.staff.every((member) => member.branch_id === 'branch-batangas'));
  pass('branch heads create and list crew inside their own branch');

  const branch1Account = await branch1('/api/accounts');
  assert.equal(branch1Account.status, 403);
  pass('only the owner can manage studio accounts');

  const branchPayment = await branch1(`/api/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'deposit_paid', payment_method: 'GCash', payment_ref: 'BR-1' }),
  });
  assert.equal(branchPayment.status, 200);
  pass('a branch head can record a payment for their own branch');

  const crossStaff = await branch1(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ staff_id: 'user-migs' }),
  });
  assert.equal(crossStaff.status, 403);
  pass('a branch head cannot assign crew from the other branch');

  const resolved = await admin(`/api/bookings/${reviewBooking.body.booking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ branch_id: 'branch-bauan' }),
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.booking.needs_review, false);
  pass('the owner resolves a review booking');

  // ---- Discounts
  const discountedCustomer = session();
  const discountEmail = `discount-${Date.now()}@example.com`;
  await discountedCustomer('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Discount Tester', email: discountEmail, password: 'Discount@2026' }),
  });
  const forbiddenDiscount = await branch1('/api/discounts', {
    method: 'POST',
    body: JSON.stringify({ customer_email: discountEmail, type: 'percent', value: 10 }),
  });
  assert.equal(forbiddenDiscount.status, 403);
  pass('branch heads cannot create discounts');

  const discount = await admin('/api/discounts', {
    method: 'POST',
    body: JSON.stringify({ customer_email: discountEmail, type: 'percent', value: 10, note: 'Loyalty discount' }),
  });
  assert.equal(discount.status, 201);
  assert.match(discount.body.discount.label, /10%/);

  const mine = await discountedCustomer('/api/discounts/mine');
  assert.equal(mine.status, 200);
  assert.match(mine.body.discount.label, /10%/);
  pass('an assigned discount is visible to the customer');

  const discountedBooking = await discountedCustomer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      branch_id: 'branch-batangas',
      pickup_date: futureDate(40),
      items: [{ service_id: 'tarpaulin', qty: 1 }],
    }),
  });
  assert.equal(discountedBooking.status, 201);
  assert.equal(discountedBooking.body.booking.subtotal, 1200);
  assert.equal(discountedBooking.body.booking.discount_amount, 120);
  assert.equal(discountedBooking.body.booking.total, 1080);
  pass('the discount is applied server-side to the booking total');

  const deactivatedDiscount = await admin(`/api/discounts/${discount.body.discount.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  assert.equal(deactivatedDiscount.status, 200);
  const afterDiscount = await discountedCustomer('/api/discounts/mine');
  assert.equal(afterDiscount.body.discount, null);
  pass('the owner can revoke a discount');

  // ---- Assistant scope
  const assistant = await discountedCustomer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'How much is a tarpaulin?' }),
  });
  assert.equal(assistant.status, 200);
  assert.equal(assistant.body.in_scope, true);
  assert.match(assistant.body.answer, /Tarpaulin/);
  assert.match(assistant.body.answer, /₱1,200/);
  const assistantConversationId = assistant.body.conversation_id;
  assert.ok(assistantConversationId);
  assert.equal(assistant.body.history_saved, true);
  assert.equal(assistant.body.conversation.title, 'How much is a tarpaulin?');
  const outOfScope = await discountedCustomer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'Who is the president of France?' }),
  });
  assert.equal(outOfScope.status, 200);
  assert.equal(outOfScope.body.in_scope, false);
  assert.equal(outOfScope.body.answer, 'Out of scope. Please ask another question.');
  const statusAnswer = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'What is my booking status?' }),
  });
  assert.equal(statusAnswer.body.in_scope, true);
  assert.match(statusAnswer.body.answer, /PM-\d+/);
  pass('the assistant answers from system data and rejects everything else');

  // ---- PRECIOUS history is private to the signed-in customer
  const followUp = await discountedCustomer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Where are your branches?',
      conversation_id: assistantConversationId,
    }),
  });
  assert.equal(followUp.status, 200);
  assert.equal(followUp.body.conversation_id, assistantConversationId);
  assert.equal(followUp.body.history_saved, true);

  const myConversations = await discountedCustomer('/api/assistant/conversations');
  assert.equal(myConversations.status, 200);
  assert.equal(myConversations.body.available, true);
  assert.ok(myConversations.body.conversations.some((conversation) => conversation.id === assistantConversationId));
  const savedConversation = myConversations.body.conversations.find(
    (conversation) => conversation.id === assistantConversationId
  );
  assert.equal(savedConversation.message_count, 4);
  assert.equal(savedConversation.title, 'How much is a tarpaulin?');
  assert.ok(!('user_id' in savedConversation));

  const savedMessages = await discountedCustomer(`/api/assistant/conversations/${assistantConversationId}`);
  assert.equal(savedMessages.status, 200);
  assert.equal(savedMessages.body.conversation.id, assistantConversationId);
  assert.equal(savedMessages.body.messages.length, 4);
  assert.equal(savedMessages.body.messages[0].role, 'user');
  assert.equal(savedMessages.body.messages[1].role, 'assistant');
  assert.ok(savedMessages.body.messages.every((message) => !('user_id' in message)));

  const foreignRead = await customer(`/api/assistant/conversations/${assistantConversationId}`);
  assert.equal(foreignRead.status, 404);
  assert.equal(foreignRead.body.error, 'That conversation was not found.');
  const foreignWrite = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Show me the other customer chat.',
      conversation_id: assistantConversationId,
    }),
  });
  assert.equal(foreignWrite.status, 404);
  const afterForeignWrite = await discountedCustomer(`/api/assistant/conversations/${assistantConversationId}`);
  assert.equal(afterForeignWrite.body.messages.length, 4);
  const adminRead = await admin(`/api/assistant/conversations/${assistantConversationId}`);
  assert.equal(adminRead.status, 404);
  const foreignList = await customer('/api/assistant/conversations');
  assert.equal(foreignList.status, 200);
  assert.ok(!foreignList.body.conversations.some((conversation) => conversation.id === assistantConversationId));
  pass('assistant conversations and messages are readable only by their owner');

  // ---- PRECIOUS understands Filipino and Taglish
  const filipino = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'Magkano ang tarpaulin?' }),
  });
  assert.equal(filipino.status, 200);
  assert.equal(filipino.body.in_scope, true);
  assert.equal(filipino.body.language, 'fil');
  assert.match(filipino.body.answer, /Tarpaulin/);
  assert.match(filipino.body.answer, /rate sa file/);
  const taglish = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'Paano gumawa ng bagong booking?' }),
  });
  assert.equal(taglish.body.in_scope, true);
  assert.equal(taglish.body.language, 'fil');
  assert.match(taglish.body.answer, /New booking/);
  const filipinoOutOfScope = await customer('/api/assistant', {
    method: 'POST',
    body: JSON.stringify({ message: 'Sino ang presidente ng France?' }),
  });
  assert.equal(filipinoOutOfScope.body.in_scope, false);
  assert.equal(filipinoOutOfScope.body.language, 'fil');
  assert.match(filipinoOutOfScope.body.answer, /Pasensya na/);
  pass('PRECIOUS answers Filipino and Taglish, and declines politely in kind');

  // ---- Password change and MFA
  const mfaUser = session();
  const mfaEmail = `mfa-${Date.now()}@example.com`;
  await mfaUser('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'MFA Tester', email: mfaEmail, password: 'MfaStart@2026' }),
  });

  const wrongCurrent = await mfaUser('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: 'not-it', new_password: 'MfaNext@2026' }),
  });
  assert.equal(wrongCurrent.status, 403);
  const weakNew = await mfaUser('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: 'MfaStart@2026', new_password: 'weakpassword' }),
  });
  assert.equal(weakNew.status, 400);
  const changed = await mfaUser('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: 'MfaStart@2026', new_password: 'MfaNext@2026' }),
  });
  assert.equal(changed.status, 200);
  const oldLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: mfaEmail, password: 'MfaStart@2026' }),
  });
  assert.equal(oldLogin.status, 401);
  pass('password change requires the current password and the full policy');

  const setup = await mfaUser('/api/auth/mfa/setup', { method: 'POST', body: '{}' });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.secret.length, 32);
  const enabled = await mfaUser('/api/auth/mfa/enable', {
    method: 'POST',
    body: JSON.stringify({ code: totpAt(setup.body.secret) }),
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.mfa_enabled, true);

  const storedAfterMfa = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  const mfaRow = storedAfterMfa.users.find((user) => user.email === mfaEmail);
  assert.match(mfaRow.mfa_secret, /^enc:v1:/);
  assert.notEqual(mfaRow.mfa_secret, setup.body.secret);
  assert.equal(mfaRow.mfa_pending_secret, null);
  pass('two-factor secrets are encrypted at rest');

  const mfaLogin = session();
  const stepOne = await mfaLogin('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: mfaEmail, password: 'MfaNext@2026' }),
  });
  assert.equal(stepOne.status, 200);
  assert.equal(stepOne.body.mfa_required, true);
  const noSessionYet = await mfaLogin('/api/auth/me');
  assert.equal(noSessionYet.status, 401);
  const wrongCode = await mfaLogin('/api/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ code: '000000' }),
  });
  assert.equal(wrongCode.status, 401);
  const rightCode = await mfaLogin('/api/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ code: totpAt(setup.body.secret) }),
  });
  assert.equal(rightCode.status, 200);
  assert.equal(rightCode.body.user.email, mfaEmail);
  const mfaMe = await mfaLogin('/api/auth/me');
  assert.equal(mfaMe.status, 200);
  pass('two-factor is required at sign-in before a session is issued');

  const customerMfaReset = await admin(`/api/accounts/${rightCode.body.user.id}/mfa-reset`, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(customerMfaReset.status, 200);
  assert.equal(customerMfaReset.body.mfa_enabled, false);
  const oldMfaSession = await mfaLogin('/api/auth/me');
  assert.equal(oldMfaSession.status, 401);
  const afterMfaReset = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: mfaEmail, password: 'MfaNext@2026' }),
  });
  assert.equal(afterMfaReset.status, 200);
  assert.equal(afterMfaReset.body.mfa_required, undefined);
  pass('the owner can reset a customer MFA factor and revoke the old session');

  // ---- Unified self-service password recovery
  const unknownForgot = await publicSession('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: `nobody-${Date.now()}@example.com` }),
  });
  assert.equal(unknownForgot.status, 200);
  const adminForgot = await publicSession('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@precious.ph' }),
  });
  const branchForgot = await publicSession('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'batangas@precious.ph' }),
  });
  assert.equal(adminForgot.status, 200);
  assert.equal(branchForgot.status, 200);
  assert.equal(adminForgot.body.message, unknownForgot.body.message);
  assert.equal(branchForgot.body.message, unknownForgot.body.message);

  const recoverySession = session();
  const recoveryEmail = `recovery-${Date.now()}@example.com`;
  const oldRecoveryPassword = 'Recovery@Start1';
  const newRecoveryPassword = 'Recovery@Next2026';
  const recoveryRegistration = await recoverySession('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Recovery Tester', email: recoveryEmail, password: oldRecoveryPassword }),
  });
  assert.equal(recoveryRegistration.status, 201);
  const secondRecoverySession = session();
  const secondRecoveryLogin = await secondRecoverySession('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: recoveryEmail, password: oldRecoveryPassword }),
  });
  assert.equal(secondRecoveryLogin.status, 200);

  const recoveryForgot = await publicSession('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: recoveryEmail }),
  });
  assert.equal(recoveryForgot.status, 200);
  assert.equal(recoveryForgot.body.message, unknownForgot.body.message);
  const resetLink = await latestResetLink();
  const resetToken = new URL(resetLink).searchParams.get('token');
  assert.ok(resetToken && resetToken.length >= 40);

  const storedAfterRequest = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  const resetRow = storedAfterRequest.password_resets.find(
    (row) => row.user_id === recoveryRegistration.body.user.id
  );
  assert.ok(resetRow);
  assert.equal(resetRow.token, undefined);
  assert.notEqual(resetRow.token_hash, resetToken);
  assert.equal(resetRow.used_at, null);

  const validatedReset = await publicSession('/api/auth/reset-password/validate', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken }),
  });
  assert.equal(validatedReset.status, 200);
  assert.ok(validatedReset.body.expires_at);
  const weakReset = await publicSession('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'weakpassword', confirm_password: 'weakpassword' }),
  });
  assert.equal(weakReset.status, 400);
  assert.match(weakReset.body.error, /uppercase|lowercase|number|symbol|10 characters/i);
  const mismatchReset = await publicSession('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: newRecoveryPassword, confirm_password: 'Different@2026' }),
  });
  assert.equal(mismatchReset.status, 400);
  const completedReset = await publicSession('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: newRecoveryPassword, confirm_password: newRecoveryPassword }),
  });
  assert.equal(completedReset.status, 200, completedReset.body.error);
  const reusedReset = await publicSession('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'Recovery@Third2026', confirm_password: 'Recovery@Third2026' }),
  });
  assert.equal(reusedReset.status, 400);
  assert.match(reusedReset.body.error, /already been used/);

  const firstSessionAfterReset = await recoverySession('/api/auth/me');
  const secondSessionAfterReset = await secondRecoverySession('/api/auth/me');
  assert.equal(firstSessionAfterReset.status, 401);
  assert.equal(secondSessionAfterReset.status, 401);
  const oldRecoveryLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: recoveryEmail, password: oldRecoveryPassword }),
  });
  assert.equal(oldRecoveryLogin.status, 401);
  const newRecoveryLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: recoveryEmail, password: newRecoveryPassword }),
  });
  assert.equal(newRecoveryLogin.status, 200);

  const auditLogs = await admin('/api/audit-logs?limit=200');
  assert.equal(auditLogs.status, 200);
  assert.ok(auditLogs.body.logs.some((log) => log.action === 'password_reset.requested'));
  assert.ok(auditLogs.body.logs.some((log) => log.action === 'password_reset.completed'));
  pass('all roles can request recovery; tokens are hashed, single-use, and revoke sessions');

  // ---- Payments, reports, origin protection
  const paid = await admin(`/api/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'deposit_paid', payment_method: 'GCash', payment_ref: 'SMOKE-001' }),
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.booking.amount_paid, Math.ceil(8000 / 2));
  pass('admin records a deposit at 50%');

  const actionLogs = await admin('/api/audit-logs?limit=200');
  const auditedActions = new Set(actionLogs.body.logs.map((log) => log.action));
  for (const action of [
    'auth.login',
    'auth.login_failed',
    'booking.created',
    'payment.recorded',
    'account.created',
    'mfa.enabled',
    'account.mfa_reset',
  ]) {
    assert.ok(auditedActions.has(action), `missing audit action: ${action}`);
  }
  pass('sign-in, booking, payment, MFA, and account events are audited');

  const crossOrigin = await admin(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: { Origin: 'https://not-the-studio.example' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(crossOrigin.status, 403);
  pass('cross-origin mutations are blocked');

  const otherCustomer = session();
  await otherCustomer('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'jessa@example.com', password: 'Customer123!' }),
  });
  const otherRead = await otherCustomer(`/api/bookings/${bookingId}`);
  assert.equal(otherRead.status, 403);
  pass('customers cannot read another customer booking');

  const report = await admin(`/api/reports?from=${futureDate(0)}&to=${futureDate(260)}`);
  assert.equal(report.status, 200);
  assert.ok(report.body.report.summary.bookings >= 1);
  assert.ok(report.body.report.by_service.length >= 1);
  assert.ok(report.body.report.trend.length >= 1);
  assert.ok(report.body.report.by_branch.length >= 1);
  assert.ok(report.body.report.by_deployment.some((row) => row.count >= 1));
  assert.ok(report.body.report.logistics.assigned >= 1);
  pass('admin report builds from live records with trends and logistics');

  const csv = await admin(`/api/reports.csv?from=${futureDate(0)}&to=${futureDate(260)}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/);
  assert.match(csv.body, /Precious Moments operations report/);
  assert.match(csv.body, /Deployment status/);
  assert.match(csv.body, /VB-1/);
  const pdf = await admin(`/api/reports.pdf?from=${futureDate(0)}&to=${futureDate(260)}`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
  assert.match(pdf.body, /^%PDF-1\.4/);
  assert.match(pdf.body, /Precious Moments/);
  assert.match(pdf.body, /Deployment and schedule/);
  const emptyReport = await admin('/api/reports?from=2030-01-01&to=2030-01-31');
  assert.equal(emptyReport.status, 200);
  assert.equal(emptyReport.body.report.summary.bookings, 0);
  assert.ok(emptyReport.body.report.by_status.every((row) => row.count === 0));
  const oversizedCsv = await admin('/api/reports.csv?from=1900-01-01&to=2100-01-01');
  assert.equal(oversizedCsv.status, 400);
  pass('report status counts stay in-period and CSV exports are capped');
  pass('report downloads as CSV');

  const branchReport = await branch1('/api/reports');
  assert.equal(branchReport.status, 403);
  pass('reports are owner-only');

  const { assignBranch } = await import('../server/geo.js');
  const branches = [
    { id: 'a', lat: 13.7606916, lng: 121.0573095 },
    { id: 'b', lat: 13.7923305, lng: 121.0103575 },
  ];
  assert.equal(assignBranch(branches, { lat: 13.7607, lng: 121.0573 }).branch.id, 'a');
  assert.equal(assignBranch(branches, { lat: 13.7923, lng: 121.0104 }).branch.id, 'b');
  assert.equal(
    assignBranch(
      [
        { id: 'x', lat: 13.7606916, lng: 121.0573095 },
        { id: 'y', lat: 13.7607916, lng: 121.0574095 },
      ],
      { lat: 13.7607416, lng: 121.0573595 }
    ),
    null
  );
  pass('near-equal branches go to review instead of a coin flip');

  const logout = await customer('/api/auth/logout', { method: 'POST', body: '{}' });
  assert.equal(logout.status, 200);
  const afterLogout = await customer('/api/auth/me');
  assert.equal(afterLogout.status, 401);
  pass('logout clears the session');

  const rawLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jessa@example.com', password: 'Customer123!' }),
  });
  const rawCookie = (rawLogin.headers.getSetCookie?.() || [])
    .find((value) => value.startsWith('pm_session='))
    ?.split(';')[0];
  assert.ok(rawCookie);
  const rawLogout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: rawCookie },
  });
  assert.equal(rawLogout.status, 200);
  const reuseAfterLogout = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: rawCookie },
  });
  assert.equal(reuseAfterLogout.status, 401);
  pass('logout revokes the old cookie server-side');

  console.log(`\n${checks.length} checks passed.`);
} catch (error) {
  console.error(`\nSmoke test failed: ${error.message}`);
  if (serverLog) console.error('\nServer output:\n' + serverLog);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  geocoder.close();
  await new Promise((resolve) => setTimeout(resolve, 350));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
