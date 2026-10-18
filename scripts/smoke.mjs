import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 3300 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precious-moments-test-'));
const checks = [];

function pass(name) {
  checks.push(name);
  console.log(`  ✓ ${name}`);
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error('Test server exited before becoming ready.');
    }
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

function session() {
  let cookie = '';
  return async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${base}${pathname}`, { ...options, headers, redirect: 'manual' });
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const value of setCookies) {
      const pair = value.split(';')[0];
      if (pair.startsWith('pm_session=')) cookie = pair;
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

  const home = await publicSession('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Keep the moment/);
  const loginPage = await publicSession('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.body, /Welcome back/);
  pass('public pages render');

  const catalog = await publicSession('/api/services');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.services.length >= 20);
  assert.ok(catalog.body.services.some((service) => service.id === 'tarpaulin'));
  assert.ok(catalog.body.services.some((service) => service.id === 'booth-360'));
  pass('service catalog includes print and booth offerings');

  const anonymous = await publicSession('/api/bookings');
  assert.equal(anonymous.status, 401);
  pass('bookings require a session');

  const customer = session();
  const email = `smoke-${Date.now()}@example.com`;
  const registration = await customer('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Tester',
      email,
      phone: '0999 000 0000',
      password: 'SmokeTest123',
    }),
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.role, 'customer');
  pass('customer registration signs in');

  const duplicate = await publicSession('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Tester',
      email,
      password: 'SmokeTest123',
    }),
  });
  assert.equal(duplicate.status, 409);
  pass('duplicate email is rejected');

  const me = await customer('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'customer');
  pass('session resolves the current user');

  const booking = await customer('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      event_date: futureDate(30),
      event_time: '14:00',
      venue: 'Smoke test garden',
      notes: 'Automated check.',
      items: [
        { service_id: 'tarpaulin', width_ft: 2, height_ft: 3 },
        { service_id: 'photobooth-strips', qty: 1 },
      ],
    }),
  });
  assert.equal(booking.status, 201);
  assert.equal(booking.body.booking.total, 3650);
  assert.equal(booking.body.booking.payment_status, 'unpaid');
  assert.match(booking.body.booking.ref, /^PM-\d+$/);
  const bookingId = booking.body.booking.id;
  pass('customer creates a booking with server-side pricing');

  const customerPatch = await customer(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(customerPatch.status, 403);
  pass('customers cannot change booking status');

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

  const staffList = await admin('/api/staff');
  assert.equal(staffList.status, 200);
  const ana = staffList.body.staff.find((member) => member.email === 'ana@precious.ph');
  assert.ok(ana);
  pass('admin can list crew');

  const newStaff = await admin('/api/staff', {
    method: 'POST',
    body: JSON.stringify({
      name: 'New Crew',
      email: `crew-${Date.now()}@example.com`,
      phone: '0999 111 2222',
      password: 'NewCrew123',
    }),
  });
  assert.equal(newStaff.status, 201);
  assert.equal(newStaff.body.user.role, 'staff');
  pass('admin can create a crew account');

  const confirmed = await admin(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed', staff_id: ana.id, message: 'Confirmed in smoke test.' }),
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.booking.status, 'confirmed');
  assert.equal(confirmed.body.booking.staff.id, ana.id);
  pass('admin confirms and assigns a booking');

  const paid = await admin(`/api/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({
      payment_status: 'deposit_paid',
      payment_method: 'GCash',
      payment_ref: 'SMOKE-001',
    }),
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.booking.payment_status, 'deposit_paid');
  assert.equal(paid.body.booking.amount_paid, 1825);
  pass('admin records a deposit at 50%');

  const crossOrigin = await admin(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: { Origin: 'https://not-the-studio.example' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(crossOrigin.status, 403);
  pass('cross-origin mutations are blocked');

  const anaSession = session();
  const anaLogin = await anaSession('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@precious.ph', password: 'Staff123!' }),
  });
  assert.equal(anaLogin.status, 200);
  const anaBookings = await anaSession('/api/bookings');
  assert.ok(anaBookings.body.bookings.some((item) => item.id === bookingId));
  pass('assigned staff can see the booking');

  const staffProgress = await anaSession(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress', message: 'Smoke test progress.' }),
  });
  assert.equal(staffProgress.status, 200);
  assert.equal(staffProgress.body.booking.status, 'in_progress');
  pass('staff can update service progress');

  const staffPayment = await anaSession(`/api/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'paid' }),
  });
  assert.equal(staffPayment.status, 403);
  pass('staff cannot change payments');

  const migs = session();
  await migs('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'migs@precious.ph', password: 'Staff123!' }),
  });
  const migsBookings = await migs('/api/bookings');
  assert.ok(!migsBookings.body.bookings.some((item) => item.id === bookingId));
  pass('other staff cannot see unassigned bookings');

  const jessa = session();
  await jessa('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'jessa@example.com', password: 'Customer123!' }),
  });
  const otherCustomer = await jessa(`/api/bookings/${bookingId}`);
  assert.equal(otherCustomer.status, 403);
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
  assert.match(csv.body, new RegExp(booking.body.booking.ref));
  pass('report downloads as CSV');

  const staffReport = await anaSession('/api/reports');
  assert.equal(staffReport.status, 403);
  pass('reports are admin-only');

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
  await new Promise((resolve) => setTimeout(resolve, 350));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
