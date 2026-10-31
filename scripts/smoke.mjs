import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/security.js';

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
  pass('health endpoint responds');

  const root = await publicSession('/');
  assert.equal(root.status, 302);
  assert.match(root.headers.get('location') || '', /\/login\?mode=register/);
  pass('the system opens on sign-up');

  const welcome = await publicSession('/welcome');
  assert.equal(welcome.status, 200);
  assert.match(welcome.body, /Keep the moment/);
  const loginPage = await publicSession('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.body, /Create my account/);
  assert.match(loginPage.body, /Crew records do not sign in/);
  pass('the welcome page and sign-up/sign-in interface render');

  const catalog = await publicSession('/api/services');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.services.length >= 20);
  assert.ok(catalog.body.services.some((service) => service.id === 'tarpaulin'));
  assert.ok(catalog.body.services.some((service) => service.id === 'booth-360'));
  pass('service catalog includes print and booth offerings');

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
        { service_id: 'tarpaulin', width_ft: 2, height_ft: 3 },
        { service_id: 'photobooth-strips', qty: 1 },
      ],
    }),
  });
  assert.equal(booking.status, 201);
  assert.equal(booking.body.booking.total, 3650);
  assert.equal(booking.body.booking.subtotal, 3650);
  assert.equal(booking.body.booking.booking_type, 'event');
  assert.equal(Number(booking.body.booking.duration_hours), 3);
  assert.equal(booking.body.booking.branch?.id, 'branch-batangas');
  assert.equal(booking.body.booking.needs_review, false);
  const bookingId = booking.body.booking.id;
  pass('an event booking stores its type, duration, price, and routed branch');

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
      items: [{ service_id: 'tarpaulin', width_ft: 2, height_ft: 3 }],
    }),
  });
  assert.equal(pickup.status, 201);
  assert.equal(pickup.body.booking.booking_type, 'pickup');
  assert.equal(pickup.body.booking.branch_id, 'branch-bauan');
  assert.equal(pickup.body.booking.venue, 'Pickup — Bauan branch');
  assert.equal(pickup.body.booking.address, '');
  assert.equal(Number(pickup.body.booking.duration_hours), 0);
  assert.equal(pickup.body.booking.total, 150);
  pass('a pickup booking uses only a chosen branch and pickup date');

  const pickupNoBranch = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'pickup',
      pickup_date: futureDate(12),
      items: [{ service_id: 'tarpaulin', width_ft: 2, height_ft: 3 }],
    }),
  });
  assert.equal(pickupNoBranch.status, 400);
  pass('a pickup booking requires an explicit branch');

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
  assert.equal(laterSlot.status, 201);
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
      items: [{ service_id: 'tarpaulin', width_ft: 2, height_ft: 3 }],
    }),
  });
  assert.equal(printOnly.status, 201);
  pass('print-only work does not consume a booth slot');

  const availability = await customer(
    `/api/availability?date=${capacityDate}&branch_id=branch-batangas&time=07:00&hours=2&services=photobooth-strips`
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.body.availability.full, true);
  assert.equal(availability.body.availability.capacity, 5);
  assert.equal(availability.body.availability.next_label, '12:00 PM');
  pass('availability reports the full window and the next open start');

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
  const resetLogin = await session()('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: headEmail, password: reset.body.temporary_password }),
  });
  assert.equal(resetLogin.status, 200);
  assert.equal(resetLogin.body.user.must_change_password, true);
  pass('the owner resets a password and the temporary sign-in is flagged');

  const branch1 = session();
  const branch1Login = await branch1('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'batangas@precious.ph', password: 'Branch123!' }),
  });
  assert.equal(branch1Login.status, 200);
  assert.equal(branch1Login.body.user.role, 'branch_admin');
  assert.equal(branch1Login.body.user.branch_id, 'branch-batangas');
  pass('branch 1 administrator signs in with their own account');

  const branch2 = session();
  const branch2Login = await branch2('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'bauan@precious.ph', password: 'Branch123!' }),
  });
  assert.equal(branch2Login.status, 200);
  assert.equal(branch2Login.body.user.branch_id, 'branch-bauan');
  pass('branch 2 administrator signs in with their own account');

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
      items: [{ service_id: 'tarpaulin', width_ft: 2, height_ft: 3 }],
    }),
  });
  assert.equal(discountedBooking.status, 201);
  assert.equal(discountedBooking.body.booking.subtotal, 150);
  assert.equal(discountedBooking.body.booking.discount_amount, 15);
  assert.equal(discountedBooking.body.booking.total, 135);
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
  assert.match(assistant.body.answer, /₱25/);
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
  pass('two-factor can be enrolled with an authenticator app');

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

  // ---- Payments, reports, origin protection
  const paid = await admin(`/api/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'deposit_paid', payment_method: 'GCash', payment_ref: 'SMOKE-001' }),
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.booking.amount_paid, Math.ceil(3650 / 2));
  pass('admin records a deposit at 50%');

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

  const report = await admin(`/api/reports?from=2026-01-01&to=${futureDate(1)}`);
  assert.equal(report.status, 200);
  assert.ok(report.body.report.summary.bookings >= 1);
  assert.ok(report.body.report.by_service.length >= 1);
  pass('admin report builds from live records');

  const csv = await admin(`/api/reports.csv?from=2026-01-01&to=${futureDate(1)}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/);
  assert.match(csv.body, /Precious Moments operations report/);
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
