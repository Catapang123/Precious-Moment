/**
 * The Express application: every HTTP route, middleware, and authorization rule.
 *
 * Request pipeline:
 *   security headers -> same-origin check -> cookie/session hydration -> routes.
 *
 * Authorization is enforced here, on the server, for every endpoint. The browser
 * may hide a button, but it can never grant itself a capability: each handler
 * re-checks the role and, for branch heads, the branch the record belongs to.
 *
 * Data access goes through the store interface only (`server/store.js`), so the
 * same routes work against the JSON file store and Supabase.
 */
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from './assistant.js';
import { capacityUnits, checkCapacity, toMinutes } from './availability.js';
import { CATEGORIES, CLIENT_CATEGORY, CLIENT_PRICES, PRICE_REVIEWS, priceLine } from './catalog.js';
import { locateBookingAddress } from './geo.js';
import { APP_ORIGIN, DATA_DIR, IS_PROD, PASSWORD_RESET_TTL_MINUTES, UPLOAD_DIR } from './config.js';
import { inspectProductImage, removeProductImage, saveProductImage } from './images.js';
import { sendPasswordResetEmail } from './mail.js';
import { BOOKING_STATUSES, buildReport, reportCsv } from './reports.js';
import {
  COOKIE_NAME,
  MFA_COOKIE_NAME,
  clearSessionCookie,
  createMfaChallenge,
  createSessionToken,
  hashPassword,
  hashOpaqueToken,
  loadSessionSecret,
  newTotpSecret,
  otpauthUrl,
  passwordProblem,
  readMfaChallenge,
  readSessionToken,
  sanitizeUser,
  setMfaCookie,
  setSessionCookie,
  verifyPassword,
  verifyTotp,
} from './security.js';

/* ---------- Paths and shared constants ---------- */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'paid', 'refunded'];
const STAFF_STATUSES = ['in_progress', 'ready', 'completed'];
const ACCOUNT_ROLES = ['admin', 'branch_admin'];
const LOGIN_ROLES = ['admin', 'branch_admin', 'customer'];
const BOOKING_AVAILABILITIES = ['pickup', 'event', 'both', 'unassigned'];
const SERVICE_CATEGORY_NAMES = CATEGORIES.map((category) => category.name);

const json = (res, status, body) => res.status(status).json(body);
const fail = (status, message) => Object.assign(new Error(message), { status });
const RESET_REQUEST_MESSAGE =
  'If an account matches that email, a password reset link is on its way. Check your inbox and spam folder.';

function requestIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 80);
}

/**
 * Appends an audit record. Audit failures are logged but never break the action
 * that was already completed; passwords and reset tokens are never passed here.
 */
async function audit(store, req, { action, actorId = null, actorRole = 'guest', targetType = '', targetId = null, metadata = {} }) {
  try {
    await store.insert('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: actorId,
      actor_role: actorRole,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      ip: requestIp(req),
      user_agent: String(req.get('user-agent') || '').slice(0, 300),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Audit log failed (${action}):`, error.message);
  }
}

async function findResetToken(store, token, secret) {
  if (!token || String(token).length < 20) return null;
  const tokenHash = hashOpaqueToken(token, secret);
  const resets = await store.list('password_resets');
  return resets.find((reset) => reset.token_hash === tokenHash) || null;
}

/* ---------- Small helpers: validation, dates, booking shape ---------- */

function temporaryPassword() {
  const body = crypto
    .randomBytes(12)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 10);
  return `Pm${body}!7aA`;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isActiveUser(user) {
  return Boolean(user) && user.active !== false;
}

function bookingTypeOf(booking) {
  return booking?.booking_type === 'pickup' ? 'pickup' : 'event';
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

async function activeDiscountFor(store, customerId) {
  const discounts = await store.list('discounts');
  return (
    discounts
      .filter((discount) => discount.customer_id === customerId && discount.active !== false)
      .sort((a, b) =>
        String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
      )[0] || null
  );
}

function discountAmountFor(discount, subtotal) {
  if (!discount) return 0;
  const value = Number(discount.value) || 0;
  const amount = discount.type === 'percent' ? Math.floor((subtotal * value) / 100) : Math.round(value);
  return Math.max(0, Math.min(subtotal, amount));
}

function discountLabelFor(discount) {
  if (!discount) return '';
  const amount =
    discount.type === 'percent'
      ? `${Number(discount.value)}%`
      : `\u20b1${Number(discount.value).toLocaleString('en-PH')}`;
  return `${discount.note || 'Discount'} (${amount})`;
}

function serviceAvailability(service) {
  const value = String(service?.booking_availability || '');
  return BOOKING_AVAILABILITIES.includes(value) ? value : 'unassigned';
}

function serviceAvailableFor(service, bookingType) {
  const availability = serviceAvailability(service);
  return availability === 'both' || availability === bookingType;
}

function serviceNameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function serviceMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) {
    throw fail(400, `${label} must be a number between 0 and 1,000,000.`);
  }
  return Math.round(number * 100) / 100;
}

function serviceTiers(value) {
  if (!Array.isArray(value) || value.length > 12) {
    throw fail(400, 'Price breaks must be a list of up to 12 rows.');
  }
  const rows = value
    .map((row, index) => {
      const min = Number(row?.min);
      const max = row?.max === null || row?.max === undefined || row?.max === '' ? null : Number(row.max);
      if (!Number.isInteger(min) || min < 1) {
        throw fail(400, `Price break ${index + 1}: the minimum must be a whole number of at least 1.`);
      }
      if (max !== null && (!Number.isInteger(max) || max < min)) {
        throw fail(
          400,
          `Price break ${index + 1}: the maximum must be a whole number at least as large as the minimum.`
        );
      }
      return {
        min,
        max,
        price: serviceMoney(row?.price, `Price break ${index + 1} price`),
        label: String(
          row?.label || (max === null ? `${min}+ pcs` : `${min}\u2013${max} pcs`)
        ).slice(0, 80),
      };
    })
    .sort((a, b) => a.min - b.min);
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1].max === null) {
      throw fail(400, 'The open-ended price break must be last.');
    }
    if (rows[index].min <= rows[index - 1].max) {
      throw fail(400, 'Price breaks cannot overlap.');
    }
  }
  return rows;
}

function normaliseBooking(booking) {
  if (!booking) return null;
  return {
    ...booking,
    booking_type: bookingTypeOf(booking),
    duration_hours: Number(booking.duration_hours) || (bookingTypeOf(booking) === 'pickup' ? 0 : 3),
    subtotal: Number(booking.subtotal ?? booking.total ?? 0),
    discount_amount: Number(booking.discount_amount) || 0,
    discount_label: booking.discount_label || '',
    pickup_date: booking.pickup_date || (bookingTypeOf(booking) === 'pickup' ? booking.event_date : null),
    pickup_time: booking.pickup_time || '',
  };
}

/* ---------- Request guards: cookies, same-origin, permissions ---------- */

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function sameOrigin(req, res, next) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return json(res, 403, { error: 'Cross-site request blocked.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      return json(res, 403, { error: 'Invalid request origin.' });
    }
    if (host !== req.headers.host && origin !== APP_ORIGIN) {
      return json(res, 403, { error: 'Request origin not allowed.' });
    }
  }
  next();
}

/* ---------- Booking hydration and access rules ---------- */

function hydrateBooking(booking, users, updates, branches = []) {
  booking = normaliseBooking(booking);
  if (!booking) return null;
  const userMap = new Map(users.map((user) => [user.id, user]));
  const branch = branches.find((item) => item.id === booking.branch_id);
  const customer = userMap.get(booking.customer_id);
  const staff = userMap.get(booking.staff_id);
  const items = Array.isArray(booking.items)
    ? booking.items
    : (() => {
        try {
          return JSON.parse(booking.items || '[]');
        } catch {
          return [];
        }
      })();

  return {
    ...booking,
    items,
    needs_review: Boolean(booking.needs_review),
    branch: branch ? { id: branch.id, name: branch.name, address: branch.address || '' } : null,
    customer: customer
      ? { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone || '' }
      : null,
    staff: staff ? { id: staff.id, name: staff.name, email: staff.email } : null,
    updates: updates
      .filter((update) => update.booking_id === booking.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((update) => ({
        ...update,
        author: userMap.get(update.author_id)
          ? { name: userMap.get(update.author_id).name, role: userMap.get(update.author_id).role }
          : { name: 'Precious Moments', role: 'system' },
      })),
  };
}

function inOwnBranch(user, booking) {
  return Boolean(user.branch_id && booking.branch_id && user.branch_id === booking.branch_id);
}

function canViewBooking(user, booking) {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return booking.customer_id === user.id;
  if (user.role === 'branch_admin') return inOwnBranch(user, booking);
  // Crew see their branch's work; their own assignments stay visible either way.
  if (user.role === 'staff') return booking.staff_id === user.id || inOwnBranch(user, booking);
  return false;
}

// Staff still act only on their own assignments; branch admins act on their branch.
function canManageBooking(user, booking) {
  if (user.role === 'staff') return booking.staff_id === user.id;
  return canViewBooking(user, booking);
}

async function bookingAccess(store, id, user, { manage = false } = {}) {
  const booking = await store.get('bookings', id);
  if (!booking) throw fail(404, 'Booking not found.');
  const allowed = manage ? canManageBooking(user, booking) : canViewBooking(user, booking);
  if (!allowed) {
    throw fail(
      403,
      user.role === 'staff' ? 'This booking is not assigned to you.' : 'You do not have access to this booking.'
    );
  }
  return booking;
}

async function bookingLists(store) {
  const [users, updates, branches] = await Promise.all([
    store.list('users'),
    store.list('booking_updates'),
    store.list('branches'),
  ]);
  return { users, updates, branches };
}

function branchAdminsFor(users, branchId) {
  const admins = users.filter((user) => user.role === 'branch_admin' && user.branch_id === branchId);
  // Never drop a booking notification: with no branch admin yet, the owner gets it.
  return admins.length ? admins : users.filter((user) => user.role === 'admin');
}

/* ---------- Timeline entries and booking references ---------- */

async function addTimeline(store, bookingId, authorId, status, message) {
  await store.insert('booking_updates', {
    id: crypto.randomUUID(),
    booking_id: bookingId,
    author_id: authorId,
    status,
    message: String(message || '').slice(0, 500),
    created_at: new Date().toISOString(),
  });
}

async function nextBookingRef(store) {
  const bookings = await store.list('bookings');
  let highest = 1000;
  for (const booking of bookings) {
    const match = /^PM-(\d+)$/.exec(booking.ref || '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `PM-${highest + 1}`;
}

export function createApp(store) {
  const app = express();
  const sessionSecret = loadSessionSecret(DATA_DIR);
  const loginAttempts = new Map();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: https://images.unsplash.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "script-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    // Geolocation is used only to suggest the nearer pickup branch; the
    // customer's manual choice always wins.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(sameOrigin);

  app.use(async (req, res, next) => {
    try {
      req.cookies = parseCookies(req.headers.cookie || '');
      const session = readSessionToken(req.cookies[COOKIE_NAME], sessionSecret);
      if (!session) return next();
      const user = await store.get('users', session.sub);
      // Deactivating an account takes effect on the next request, not only at
      // the next sign-in. A password reset increments `session_version`, which
      // instantly revokes every older cookie without a session table.
      const sessionVersion = Number(session.sv) || 0;
      const userVersion = Number(user?.session_version) || 0;
      if (user && isActiveUser(user) && sessionVersion === userVersion) req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });

  const requireAuth = (req, res, next) => {
    if (!req.user) return json(res, 401, { error: 'Please sign in to continue.' });
    next();
  };
  const requireRole =
    (...roles) =>
    (req, res, next) => {
      if (!req.user) return json(res, 401, { error: 'Please sign in to continue.' });
      if (!roles.includes(req.user.role)) {
        return json(res, 403, { error: 'You do not have permission to do that.' });
      }
      next();
    };
  const rateLimitAuth = (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = loginAttempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
    if (entry.reset < now) {
      entry.count = 0;
      entry.reset = now + 15 * 60 * 1000;
    }
    entry.count += 1;
    loginAttempts.set(key, entry);
    if (entry.count > 20) {
      return json(res, 429, { error: 'Too many attempts. Please try again in a few minutes.' });
    }
    next();
  };

  // ---- Auth
  const issueSession = (res, user) => {
    setSessionCookie(res, createSessionToken(user, sessionSecret), IS_PROD);
  };

  // Crew are records, not logins: only the owner and the two branch heads get
  // into the studio side. A customer account signs in normally.
  const signInProblem = (user) => {
    if (!user) return 'Email or password is incorrect.';
    if (!LOGIN_ROLES.includes(user.role)) {
      return 'Crew records do not sign in. Use the studio owner or a branch head account.';
    }
    if (!isActiveUser(user)) {
      return 'This account has been deactivated. Ask the studio owner to reactivate it.';
    }
    return '';
  };

  /* ---------- Authentication: register, sign in, two-factor, password ---------- */

  app.post(
    '/api/auth/register',
    rateLimitAuth,
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = String(req.body?.phone || '').trim();
      const password = String(req.body?.password || '');

      if (name.length < 2 || name.length > 80) throw fail(400, 'Enter your full name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
        throw fail(400, 'Enter a valid email address.');
      }
      if (phone.length > 30) throw fail(400, 'Phone number is too long.');
      const weak = passwordProblem(password);
      if (weak) throw fail(400, weak);

      const users = await store.list('users');
      if (users.some((user) => user.email.toLowerCase() === email)) {
        throw fail(409, 'An account with that email already exists.');
      }

      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        phone,
        password_hash: hashPassword(password),
        role: 'customer',
        branch_id: null,
        active: true,
        mfa_enabled: false,
        mfa_secret: null,
        mfa_pending_secret: null,
        must_change_password: false,
        created_at: new Date().toISOString(),
      };
      try {
        await store.insert('users', user);
      } catch (error) {
        if (String(error.message).includes('duplicate')) {
          throw fail(409, 'An account with that email already exists.');
        }
        throw error;
      }

      issueSession(res, user);
      json(res, 201, { user: sanitizeUser(user) });
    })
  );

  app.post(
    '/api/auth/login',
    rateLimitAuth,
    wrap(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const users = await store.list('users');
      const user = users.find((item) => item.email.toLowerCase() === email);
      if (user && user.role === 'staff') {
        // Crew records have no password at all; say so plainly instead of
        // letting a crew member keep guessing at a login that cannot work.
        throw fail(403, signInProblem(user));
      }
      if (!user || !verifyPassword(password, user.password_hash)) {
        throw fail(401, 'Email or password is incorrect.');
      }
      const problem = signInProblem(user);
      if (problem) throw fail(403, problem);
      loginAttempts.delete(`${req.ip}:${req.path}`);

      if (user.mfa_enabled && user.mfa_secret) {
        setMfaCookie(res, createMfaChallenge(user, sessionSecret), IS_PROD);
        return json(res, 200, { mfa_required: true });
      }
      issueSession(res, user);
      json(res, 200, { user: sanitizeUser(user) });
    })
  );

  app.post(
    '/api/auth/mfa',
    rateLimitAuth,
    wrap(async (req, res) => {
      const challenge = readMfaChallenge(req.cookies[MFA_COOKIE_NAME], sessionSecret);
      if (!challenge) throw fail(401, 'Your sign-in expired. Enter your email and password again.');
      const user = await store.get('users', challenge.sub);
      if (!user || !isActiveUser(user) || !user.mfa_enabled || !user.mfa_secret) {
        res.clearCookie(MFA_COOKIE_NAME, { path: '/' });
        throw fail(401, 'Two-factor is not enabled for this account. Sign in again.');
      }
      if (!verifyTotp(user.mfa_secret, req.body?.code)) {
        throw fail(401, 'That code is not valid. Check your authenticator app and try again.');
      }
      res.clearCookie(MFA_COOKIE_NAME, { path: '/' });
      loginAttempts.delete(`${req.ip}:${req.path}`);
      issueSession(res, user);
      json(res, 200, { user: sanitizeUser(user) });
    })
  );

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    json(res, 200, { ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    json(res, 200, { user: sanitizeUser(req.user) });
  });

  /* ---------- Unified self-service password recovery ---------- */

  // The response is identical for a known email, an unknown email, an inactive
  // account, and a crew record. That prevents account enumeration by anyone
  // probing the endpoint. Delivery failures are logged server-side only.
  app.post(
    '/api/auth/forgot-password',
    rateLimitAuth,
    wrap(async (req, res) => {
      const rawEmail = String(req.body?.email || '').trim().toLowerCase();
      const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 160;
      const users = emailLooksValid ? await store.list('users') : [];
      const user = users.find(
        (item) =>
          String(item.email || '').toLowerCase() === rawEmail &&
          LOGIN_ROLES.includes(item.role) &&
          isActiveUser(item)
      );

      if (user) {
        const now = Date.now();
        const token = crypto.randomBytes(32).toString('base64url');
        const tokenHash = hashOpaqueToken(token, sessionSecret);
        const resetBase = String(APP_ORIGIN || '').replace(/\/$/, '');
        const resetUrl = `${resetBase}/reset-password?token=${encodeURIComponent(token)}`;

        // Only one link can be live at a time. Requesting another invalidates
        // the previous one, so an old forwarded email cannot be reused.
        const existingResets = await store.list('password_resets');
        for (const reset of existingResets) {
          if (reset.user_id === user.id && !reset.used_at) {
            await store.update('password_resets', reset.id, { used_at: new Date(now).toISOString() });
          }
        }
        await store.insert('password_resets', {
          id: crypto.randomUUID(),
          user_id: user.id,
          token_hash: tokenHash,
          requested_at: new Date(now).toISOString(),
          expires_at: new Date(now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString(),
          used_at: null,
          requested_by_ip: requestIp(req),
          used_by_ip: '',
          created_at: new Date(now).toISOString(),
        });

        await audit(store, req, {
          action: 'password_reset.requested',
          actorId: user.id,
          actorRole: user.role,
          targetType: 'user',
          targetId: user.id,
          metadata: { matched: true },
        });

        try {
          await sendPasswordResetEmail({
            to: user.email,
            name: user.name,
            resetUrl,
            expiresMinutes: PASSWORD_RESET_TTL_MINUTES,
          });
        } catch (error) {
          // Do not tell the caller whether delivery succeeded; that would leak
          // whether the address exists. Keep the generic response.
          console.error('Password reset email could not be sent:', error.message);
        }
      } else {
        await audit(store, req, {
          action: 'password_reset.requested',
          targetType: 'email',
          metadata: { matched: false },
        });
      }

      json(res, 200, { ok: true, message: RESET_REQUEST_MESSAGE });
    })
  );

  // Lets the reset page show a precise invalid/expired/used message before the
  // customer fills in a new password. It never reveals the account behind it.
  app.post(
    '/api/auth/reset-password/validate',
    rateLimitAuth,
    wrap(async (req, res) => {
      const token = String(req.body?.token || '');
      const reset = await findResetToken(store, token, sessionSecret);
      if (!reset) return json(res, 400, { error: 'This reset link is invalid. Request a new one.' });
      if (reset.used_at) {
        return json(res, 400, { error: 'This reset link has already been used. Request a new one.' });
      }
      if (new Date(reset.expires_at).getTime() < Date.now()) {
        return json(res, 400, { error: 'This reset link has expired. Request a new one.' });
      }
      json(res, 200, { ok: true, expires_at: reset.expires_at });
    })
  );

  app.post(
    '/api/auth/reset-password',
    rateLimitAuth,
    wrap(async (req, res) => {
      const token = String(req.body?.token || '');
      const password = String(req.body?.password || '');
      const confirmation = String(req.body?.confirm_password || '');
      const reset = await findResetToken(store, token, sessionSecret);

      if (!reset || reset.used_at) {
        await audit(store, req, {
          action: 'password_reset.failed',
          targetType: 'user',
          targetId: reset?.user_id || null,
          metadata: { reason: reset?.used_at ? 'already_used' : 'invalid_token' },
        });
        throw fail(400, reset?.used_at
          ? 'This reset link has already been used. Request a new one.'
          : 'This reset link is invalid. Request a new one.');
      }
      if (new Date(reset.expires_at).getTime() < Date.now()) {
        await audit(store, req, {
          action: 'password_reset.failed',
          targetType: 'user',
          targetId: reset.user_id,
          metadata: { reason: 'expired' },
        });
        throw fail(400, 'This reset link has expired. Request a new one.');
      }
      if (password !== confirmation) throw fail(400, 'The two new passwords do not match.');
      const weak = passwordProblem(password);
      if (weak) throw fail(400, weak);

      const user = await store.get('users', reset.user_id);
      if (!user || !isActiveUser(user) || !LOGIN_ROLES.includes(user.role)) {
        throw fail(400, 'This reset link is no longer valid. Request a new one.');
      }
      if (verifyPassword(password, user.password_hash)) {
        throw fail(400, 'Choose a password you have not used before.');
      }

      // Consume this token first, then bump the user's session version. Any
      // cookies issued before the reset stop matching immediately.
      const usedAt = new Date().toISOString();
      await store.update('password_resets', reset.id, { used_at: usedAt, used_by_ip: requestIp(req) });
      const allResets = await store.list('password_resets');
      for (const other of allResets) {
        if (other.user_id === user.id && other.id !== reset.id && !other.used_at) {
          await store.update('password_resets', other.id, { used_at: usedAt });
        }
      }
      await store.update('users', user.id, {
        password_hash: hashPassword(password),
        session_version: (Number(user.session_version) || 0) + 1,
        must_change_password: false,
      });
      clearSessionCookie(res);
      res.clearCookie(MFA_COOKIE_NAME, { path: '/' });

      await audit(store, req, {
        action: 'password_reset.completed',
        actorId: user.id,
        actorRole: user.role,
        targetType: 'user',
        targetId: user.id,
        metadata: { sessions_revoked: true },
      });
      json(res, 200, { ok: true, message: 'Your password has been changed. Sign in with the new password.' });
    })
  );

  app.get(
    '/api/audit-logs',
    requireRole('admin'),
    wrap(async (req, res) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const logs = await store.list('audit_logs');
      logs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      json(res, 200, { logs: logs.slice(0, limit) });
    })
  );

  app.post(
    '/api/auth/password',
    requireAuth,
    wrap(async (req, res) => {
      const current = String(req.body?.current_password || '');
      const next = String(req.body?.new_password || '');
      if (!verifyPassword(current, req.user.password_hash)) {
        throw fail(403, 'Your current password is incorrect.');
      }
      const weak = passwordProblem(next);
      if (weak) throw fail(400, weak);
      if (verifyPassword(next, req.user.password_hash)) {
        throw fail(400, 'Choose a password you have not used before.');
      }
      await store.update('users', req.user.id, {
        password_hash: hashPassword(next),
        must_change_password: false,
      });
      json(res, 200, { ok: true });
    })
  );

  app.post(
    '/api/auth/mfa/setup',
    requireAuth,
    wrap(async (req, res) => {
      const secret = newTotpSecret();
      await store.update('users', req.user.id, { mfa_pending_secret: secret });
      json(res, 200, {
        secret,
        otpauth: otpauthUrl(secret, req.user.email),
        account: req.user.email,
      });
    })
  );

  app.post(
    '/api/auth/mfa/enable',
    requireAuth,
    wrap(async (req, res) => {
      const secret = req.user.mfa_pending_secret;
      if (!secret) throw fail(400, 'Start the two-factor setup first.');
      if (!verifyTotp(secret, req.body?.code)) {
        throw fail(400, 'That code is not valid yet. Wait for the next code and try again.');
      }
      await store.update('users', req.user.id, {
        mfa_secret: secret,
        mfa_enabled: true,
        mfa_pending_secret: null,
      });
      json(res, 200, { ok: true, mfa_enabled: true });
    })
  );

  app.post(
    '/api/auth/mfa/disable',
    requireAuth,
    wrap(async (req, res) => {
      if (!verifyPassword(String(req.body?.password || ''), req.user.password_hash)) {
        throw fail(403, 'Enter your current password to turn off two-factor.');
      }
      await store.update('users', req.user.id, {
        mfa_secret: null,
        mfa_enabled: false,
        mfa_pending_secret: null,
      });
      json(res, 200, { ok: true, mfa_enabled: false });
    })
  );

  // ---- Public catalog
  /* ---------- Public catalog and health check ---------- */

  app.get(
    '/api/services',
    wrap(async (req, res) => {
      const bookingType = String(req.query.booking_type || '');
      if (bookingType && !['event', 'pickup'].includes(bookingType)) {
        throw fail(400, 'Choose event or pickup for the catalog.');
      }
      const services = await store.list('services');
      json(res, 200, {
        categories: CATEGORIES,
        booking_type: bookingType || null,
        services: services
          .filter((service) => service.active !== false && service.catalog_visible !== false)
          .filter((service) => !bookingType || serviceAvailableFor(service, bookingType))
          .sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      });
    })
  );

  /* ---------- Owner pricing console ---------- */

  // Retail prices and quantity breaks, plus the client-specific rates that are
  // deliberately kept out of the public catalog. Admin only: the client list is
  // commercially sensitive and is never served to customers or branch heads.
  app.get(
    '/api/pricing',
    requireRole('admin'),
    wrap(async (req, res) => {
      const services = await store.list('services');
      json(res, 200, {
        categories: CATEGORIES,
        client_category: CLIENT_CATEGORY,
        services: services.sort((a, b) => (a.sort || 0) - (b.sort || 0)),
        client_prices: CLIENT_PRICES,
        reviews: PRICE_REVIEWS,
      });
    })
  );

  // Creates a new, owner-managed product. Catalog sync never overwrites or
  // retires custom rows, so a product added here survives future deployments.
  app.post(
    '/api/services',
    requireRole('admin'),
    wrap(async (req, res) => {
      const services = await store.list('services');
      const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 80) {
        throw fail(400, 'Product name must be between 2 and 80 characters.');
      }
      if (services.some((row) => serviceNameKey(row.name) === serviceNameKey(name))) {
        throw fail(409, 'A product with that name already exists.');
      }
      const category = String(req.body?.category || '').trim();
      if (!SERVICE_CATEGORY_NAMES.includes(category)) throw fail(400, 'Choose a valid category.');
      const unit = String(req.body?.unit || '').trim();
      if (!unit || unit.length > 40) throw fail(400, 'Enter a unit of measurement up to 40 characters.');
      const pricingMode = String(req.body?.pricing_mode || 'fixed');
      if (!['fixed', 'area'].includes(pricingMode)) throw fail(400, 'Choose fixed or area pricing.');
      const availability = String(req.body?.booking_availability || 'unassigned');
      if (!BOOKING_AVAILABILITIES.includes(availability)) {
        throw fail(400, 'Choose pickup, event, both, or unassigned availability.');
      }
      const description = String(req.body?.description || '').slice(0, 500);
      const dimensionUnit = String(req.body?.dimension_unit || 'ft');
      if (!['ft', 'in'].includes(dimensionUnit)) throw fail(400, 'Choose feet or inches.');

      const optionalInteger = (value, label) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 10000) {
          throw fail(400, `${label} must be a whole number between 1 and 10,000.`);
        }
        return number;
      };
      const optionalArea = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 10000) {
          throw fail(400, 'Minimum area must be between 0 and 10,000.');
        }
        return number;
      };
      const optionalDimension = (value, label) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0 || number > 1000) {
          throw fail(400, `${label} must be a positive number up to 1,000.`);
        }
        return number;
      };

      const slug =
        name
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 42) || 'product';
      let id = `custom-${slug}`;
      let suffix = 2;
      while (services.some((row) => row.id === id)) id = `custom-${slug}-${suffix++}`;

      const now = new Date().toISOString();
      const row = {
        id,
        name,
        category,
        description,
        price: serviceMoney(req.body?.price, 'Price'),
        unit,
        pricing_mode: pricingMode,
        min_area: optionalArea(req.body?.min_area),
        min_qty: optionalInteger(req.body?.min_qty, 'Minimum quantity'),
        tiers: serviceTiers(req.body?.tiers || []),
        base_fee: serviceMoney(req.body?.base_fee || 0, 'Additional charge'),
        dimension_unit: dimensionUnit,
        round_dimensions_up: pricingMode === 'area' && Boolean(req.body?.round_dimensions_up),
        min_dimension: pricingMode === 'area' ? optionalDimension(req.body?.min_dimension, 'Minimum dimension') : null,
        max_dimension: pricingMode === 'area' ? optionalDimension(req.body?.max_dimension, 'Maximum dimension') : null,
        image_url: '',
        image_alt: '',
        image_updated_at: null,
        image_updated_by: null,
        image_width: null,
        image_height: null,
        // A new product is not published until an administrator uploads its
        // manually prepared product image.
        catalog_visible: false,
        capacity: Boolean(req.body?.capacity),
        popular: Boolean(req.body?.popular),
        booking_availability: availability,
        addon: Boolean(req.body?.addon),
        needs_review: Boolean(req.body?.needs_review),
        review_note: String(req.body?.review_note || '').slice(0, 300),
        active: req.body?.active === undefined ? true : Boolean(req.body.active),
        sort: Math.max(0, ...services.map((service) => Number(service.sort) || 0)) + 10,
        origin: 'custom',
        admin_edited: true,
        created_at: now,
        updated_at: now,
      };
      const service = await store.insert('services', row);
      json(res, 201, { service });
    })
  );

  // Edits a retail product. The id is intentionally not editable: booking line
  // items refer to it, and history must remain readable.
  app.patch(
    '/api/services/:id',
    requireRole('admin'),
    wrap(async (req, res) => {
      const service = await store.get('services', req.params.id);
      if (!service) throw fail(404, 'That service was not found.');

      const money = (value, label) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 1000000) {
          throw fail(400, `${label} must be a number between 0 and 1,000,000.`);
        }
        return Math.round(number * 100) / 100;
      };

      const patch = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80) {
          throw fail(400, 'Product name must be between 2 and 80 characters.');
        }
        const duplicate = (await store.list('services')).find(
          (row) => row.id !== service.id && serviceNameKey(row.name) === serviceNameKey(name)
        );
        if (duplicate) throw fail(409, 'A product with that name already exists.');
        patch.name = name;
      }
      if (req.body?.category !== undefined) {
        const category = String(req.body.category || '').trim();
        if (!SERVICE_CATEGORY_NAMES.includes(category)) throw fail(400, 'Choose a valid category.');
        patch.category = category;
      }
      if (req.body?.description !== undefined) {
        patch.description = String(req.body.description || '').slice(0, 500);
      }
      if (req.body?.unit !== undefined) {
        const unit = String(req.body.unit || '').trim();
        if (!unit || unit.length > 40) throw fail(400, 'Enter a unit of measurement up to 40 characters.');
        patch.unit = unit;
      }
      if (req.body?.pricing_mode !== undefined) {
        const pricingMode = String(req.body.pricing_mode);
        if (!['fixed', 'area'].includes(pricingMode)) throw fail(400, 'Choose fixed or area pricing.');
        patch.pricing_mode = pricingMode;
      }
      if (req.body?.dimension_unit !== undefined) {
        const dimensionUnit = String(req.body.dimension_unit);
        if (!['ft', 'in'].includes(dimensionUnit)) throw fail(400, 'Choose feet or inches.');
        patch.dimension_unit = dimensionUnit;
      }
      if (req.body?.round_dimensions_up !== undefined) {
        patch.round_dimensions_up = Boolean(req.body.round_dimensions_up);
      }
      for (const [key, label] of [
        ['min_dimension', 'Minimum dimension'],
        ['max_dimension', 'Maximum dimension'],
      ]) {
        if (req.body?.[key] === undefined) continue;
        if (req.body[key] === null || req.body[key] === '') patch[key] = null;
        else {
          const number = Number(req.body[key]);
          if (!Number.isFinite(number) || number <= 0 || number > 1000) {
            throw fail(400, `${label} must be a positive number up to 1,000.`);
          }
          patch[key] = number;
        }
      }
      if (req.body?.catalog_visible !== undefined) patch.catalog_visible = Boolean(req.body.catalog_visible);
      if (req.body?.image_alt !== undefined) {
        patch.image_alt = String(req.body.image_alt || '').slice(0, 180);
      }
      if (req.body?.booking_availability !== undefined) {
        const availability = String(req.body.booking_availability);
        if (!BOOKING_AVAILABILITIES.includes(availability)) {
          throw fail(400, 'Choose pickup, event, both, or unassigned availability.');
        }
        patch.booking_availability = availability;
      }
      if (req.body?.capacity !== undefined) patch.capacity = Boolean(req.body.capacity);
      if (req.body?.popular !== undefined) patch.popular = Boolean(req.body.popular);
      if (req.body?.addon !== undefined) patch.addon = Boolean(req.body.addon);
      if (req.body?.price !== undefined) patch.price = money(req.body.price, 'Price');
      if (req.body?.base_fee !== undefined) patch.base_fee = money(req.body.base_fee, 'Setup fee');
      if (req.body?.min_area !== undefined) {
        if (req.body.min_area === null || req.body.min_area === '') patch.min_area = null;
        else {
          const area = Number(req.body.min_area);
          if (!Number.isFinite(area) || area < 0 || area > 10000) {
            throw fail(400, 'Minimum area must be between 0 and 10,000.');
          }
          patch.min_area = area;
        }
      }
      if (req.body?.min_qty !== undefined) {
        if (req.body.min_qty === null || req.body.min_qty === '') patch.min_qty = null;
        else {
          const qty = Number(req.body.min_qty);
          if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
            throw fail(400, 'Minimum quantity must be a whole number between 1 and 10,000.');
          }
          patch.min_qty = qty;
        }
      }
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      if (req.body?.needs_review !== undefined) patch.needs_review = Boolean(req.body.needs_review);
      if (req.body?.review_note !== undefined) {
        patch.review_note = String(req.body.review_note || '').slice(0, 300);
      }
      if (req.body?.tiers !== undefined) {
        if (!Array.isArray(req.body.tiers) || req.body.tiers.length > 12) {
          throw fail(400, 'Price breaks must be a list of up to 12 rows.');
        }
        const rows = req.body.tiers
          .map((row, index) => {
            const min = Number(row?.min);
            const max = row?.max === null || row?.max === undefined || row?.max === '' ? null : Number(row.max);
            if (!Number.isInteger(min) || min < 1) {
              throw fail(400, `Price break ${index + 1}: the minimum must be a whole number of at least 1.`);
            }
            if (max !== null && (!Number.isInteger(max) || max < min)) {
              throw fail(
                400,
                `Price break ${index + 1}: the maximum must be a whole number at least as large as the minimum.`
              );
            }
            return {
              min,
              max,
              price: money(row?.price, `Price break ${index + 1} price`),
              label: String(
                row?.label || (max === null ? `${min}+ pcs` : `${min}\u2013${max} pcs`)
              ).slice(0, 80),
            };
          })
          .sort((a, b) => a.min - b.min);
        for (let index = 1; index < rows.length; index += 1) {
          if (rows[index - 1].max === null) {
            throw fail(400, 'The open-ended price break must be last.');
          }
          if (rows[index].min <= rows[index - 1].max) {
            throw fail(400, 'Price breaks cannot overlap.');
          }
        }
        patch.tiers = rows;
      }

      if (!Object.keys(patch).length) throw fail(400, 'Choose a product setting to update.');
      const nextMin = patch.min_dimension !== undefined ? patch.min_dimension : service.min_dimension;
      const nextMax = patch.max_dimension !== undefined ? patch.max_dimension : service.max_dimension;
      if (nextMin !== null && nextMin !== undefined && nextMax !== null && nextMax !== undefined && Number(nextMin) > Number(nextMax)) {
        throw fail(400, 'Minimum dimension cannot be larger than maximum dimension.');
      }
      // Existing catalog rows predate mandatory images. Publish-gating applies
      // when a product is being made visible again (for example after its image
      // was removed), while saving an already-live legacy row still works.
      if (patch.catalog_visible === true && service.catalog_visible !== true && !service.image_url) {
        throw fail(400, 'Upload and preview an approved product image before publishing this product.');
      }
      if (patch.active === true && service.active === false && !service.image_url) {
        throw fail(400, 'Upload an approved product image before reactivating this product.');
      }
      patch.admin_edited = true;
      patch.updated_at = new Date().toISOString();
      const updated = await store.update('services', service.id, patch);
      json(res, 200, { service: updated });
    })
  );

  /* ---------- Product image management (owner and branch heads) ---------- */

  app.get(
    '/api/product-images',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const [services, logs] = await Promise.all([store.list('services'), store.list('audit_logs')]);
      services.sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const missing = services.filter((service) => !service.image_url).length;
      json(res, 200, {
        categories: CATEGORIES,
        services,
        stats: {
          total: services.length,
          with_image: services.length - missing,
          missing,
          visible: services.filter((service) => service.active !== false && service.catalog_visible !== false).length,
        },
        recent_changes: logs
          .filter((log) => String(log.action || '').startsWith('product_image.'))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, 30),
      });
    })
  );

  app.post(
    '/api/services/:id/image',
    requireRole('admin', 'branch_admin'),
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/pjpeg'], limit: '4mb' }),
    wrap(async (req, res) => {
      const service = await store.get('services', req.params.id);
      if (!service) throw fail(404, 'That product was not found.');
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw fail(415, 'Upload a JPG, PNG, or WEBP image file.');
      }
      const image = inspectProductImage(req.body, req.get('content-type') || '');
      const alt = String(req.query.alt || service.image_alt || `${service.name} product image`).trim().slice(0, 180);
      const newPath = await saveProductImage(req.body, image);
      const previous = service.image_url;
      let updated;
      try {
        updated = await store.update('services', service.id, {
          image_url: newPath,
          image_alt: alt,
          image_width: image.width,
          image_height: image.height,
          image_updated_at: new Date().toISOString(),
          image_updated_by: req.user.id,
          catalog_visible: true,
          admin_edited: true,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        // Keep the old image in place if the database write fails.
        await removeProductImage(newPath);
        throw error;
      }
      if (previous && previous !== newPath) await removeProductImage(previous).catch(() => {});
      await audit(store, req, {
        action: previous ? 'product_image.replaced' : 'product_image.uploaded',
        actorId: req.user.id,
        actorRole: req.user.role,
        targetType: 'service',
        targetId: service.id,
        metadata: { product: service.name, previous_image: previous || '', new_image: newPath, width: image.width, height: image.height },
      });
      json(res, 200, { service: updated });
    })
  );

  app.delete(
    '/api/services/:id/image',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const service = await store.get('services', req.params.id);
      if (!service) throw fail(404, 'That product was not found.');
      if (!service.image_url) throw fail(400, 'This product does not have an image to remove.');
      const previous = service.image_url;
      const updated = await store.update('services', service.id, {
        image_url: '',
        image_alt: '',
        image_width: null,
        image_height: null,
        image_updated_at: new Date().toISOString(),
        image_updated_by: req.user.id,
        catalog_visible: false,
        admin_edited: true,
        updated_at: new Date().toISOString(),
      });
      await removeProductImage(previous).catch((error) => console.error('Old product image could not be deleted:', error.message));
      await audit(store, req, {
        action: 'product_image.removed',
        actorId: req.user.id,
        actorRole: req.user.role,
        targetType: 'service',
        targetId: service.id,
        metadata: { product: service.name, previous_image: previous },
      });
      json(res, 200, { service: updated });
    })
  );

  app.get('/api/health', (req, res) => {
    json(res, 200, { ok: true, store: store.mode, time: new Date().toISOString() });
  });

  // ---- Bookings
  app.get(
    '/api/bookings',
    requireAuth,
    wrap(async (req, res) => {
      const [bookings, { users, updates, branches }] = await Promise.all([
        store.list('bookings'),
        bookingLists(store),
      ]);
      const visible = bookings.filter((booking) => canViewBooking(req.user, booking));
      visible.sort((a, b) => b.created_at.localeCompare(a.created_at));
      json(res, 200, {
        bookings: visible.map((booking) => hydrateBooking(booking, users, updates, branches)),
      });
    })
  );

  app.get(
    '/api/bookings/:id',
    requireAuth,
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user);
      const { users, updates, branches } = await bookingLists(store);
      json(res, 200, { booking: hydrateBooking(booking, users, updates, branches) });
    })
  );

  /* ---------- Bookings: create, edit, cancel, record payments ---------- */

  app.post(
    '/api/bookings',
    requireRole('customer', 'admin'),
    wrap(async (req, res) => {
      const bookingType = String(req.body?.booking_type || '');
      if (!['event', 'pickup'].includes(bookingType)) {
        throw fail(400, 'Choose whether this is an event booking or a pickup booking.');
      }
      const notes = String(req.body?.notes || '').trim();
      const rawItems = req.body?.items;
      if (notes.length > 2000) throw fail(400, 'Notes are too long.');
      if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 25) {
        throw fail(400, 'Add at least one item to your booking.');
      }

      // Price against the stored catalog, not a hard-coded copy: an owner edit
      // from the Pricing page must apply to the next booking immediately.
      const catalogServices = await store.list('services');
      const items = [];
      for (const raw of rawItems) {
        const service = catalogServices.find(
          (row) => row.id === String(raw?.service_id || '') && row.active !== false
        );
        if (!service) throw fail(400, 'One of the selected services is no longer available.');
        if (!serviceAvailableFor(service, bookingType)) {
          throw fail(
            400,
            `${service.name} is not available for ${bookingType === 'pickup' ? 'pickup' : 'event'} bookings.`
          );
        }
        try {
          items.push(priceLine(service, raw));
        } catch (error) {
          throw fail(400, error.message);
        }
      }
      const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
      if (subtotal <= 0 || subtotal > 1000000) throw fail(400, 'That booking total is not valid.');

      const branches = await store.list('branches');
      let branchId = null;
      let needsReview = false;
      let eventDate = '';
      let eventTime = '';
      let pickupDate = null;
      let pickupTime = '';
      let durationHours = 0;
      let venue = '';
      let address = '';

      if (bookingType === 'pickup') {
        branchId = String(req.body?.branch_id || '');
        const branch = branches.find((item) => item.id === branchId);
        if (!branch) throw fail(400, 'Choose the branch where you will pick up.');
        pickupDate = String(req.body?.pickup_date || '');
        pickupTime = String(req.body?.pickup_time || '');
        if (!validDate(pickupDate)) throw fail(400, 'Choose a valid pickup date.');
        if (pickupDate < todayISO()) throw fail(400, 'The pickup date cannot be in the past.');
        if (pickupTime && !validTime(pickupTime)) throw fail(400, 'Choose a valid pickup time.');
        eventDate = pickupDate;
        eventTime = pickupTime;
        venue = `Pickup — ${branch.name}`;
        address = String(req.body?.address || '').trim().slice(0, 240);
      } else {
        eventDate = String(req.body?.event_date || '');
        eventTime = String(req.body?.event_time || '');
        durationHours = Number(req.body?.duration_hours) || 0;
        venue = String(req.body?.venue || '').trim();
        address = String(req.body?.address || '').trim();

        if (!validDate(eventDate)) throw fail(400, 'Choose a valid event date.');
        if (eventDate < todayISO()) throw fail(400, 'The event date cannot be in the past.');
        if (!validTime(eventTime)) throw fail(400, 'Choose the event start time.');
        if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 12) {
          throw fail(400, 'Choose an event duration between 1 and 12 hours.');
        }
        if (venue.length < 3 || venue.length > 160) throw fail(400, 'Enter the event venue.');
        if (address.length < 8 || address.length > 240) {
          throw fail(400, 'Enter the full event address, including the barangay and city.');
        }

        // A branch the customer chose wins over the geocoder. The address is
        // only used when they asked for the nearest branch.
        const chosen = String(req.body?.branch_id || '');
        if (chosen) {
          if (!branches.some((branch) => branch.id === chosen)) {
            throw fail(400, 'Choose a valid branch.');
          }
          branchId = chosen;
        } else {
          let assignment = { branchId: null, reason: 'address_not_found' };
          try {
            assignment = await locateBookingAddress(store, address);
          } catch (error) {
            console.error('Branch lookup failed:', error.message);
          }
          branchId = assignment.branchId || null;
        }
        needsReview = !branchId;

        const units = capacityUnits(items);
        if (branchId && units > 0) {
          const bookings = await store.list('bookings');
          const capacity = checkCapacity(bookings, {
            date: eventDate,
            branchId,
            start: toMinutes(eventTime),
            hours: durationHours,
            units,
          });
          if (capacity.full) {
            const next = capacity.next_label
              ? ` The next open start on that date is ${capacity.next_label}.`
              : ' Choose another date or fewer booths.';
            throw fail(
              409,
              `That time is full at ${capacity.capacity} simultaneous services.${next}`
            );
          }
        }
      }

      const discount = await activeDiscountFor(store, req.user.id);
      const discountAmount = discountAmountFor(discount, subtotal);
      const total = subtotal - discountAmount;

      const booking = {
        id: crypto.randomUUID(),
        ref: await nextBookingRef(store),
        customer_id: req.user.id,
        staff_id: null,
        branch_id: branchId,
        needs_review: needsReview,
        booking_type: bookingType,
        duration_hours: durationHours,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        event_date: eventDate,
        event_time: eventTime,
        venue,
        address,
        notes,
        status: 'pending',
        payment_status: 'unpaid',
        payment_method: '',
        payment_ref: '',
        amount_paid: 0,
        subtotal,
        discount_id: discount?.id || null,
        discount_label: discount ? discountLabelFor(discount) : '',
        discount_amount: discountAmount,
        total,
        paid_at: null,
        items,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        await store.insert('bookings', booking);
        await addTimeline(
          store,
          booking.id,
          req.user.id,
          'pending',
          needsReview
            ? 'Booking request submitted. The address needs a manual branch check.'
            : bookingType === 'pickup'
              ? 'Pickup request submitted.'
              : 'Booking request submitted and routed to a branch.'
        );
      } catch (error) {
        await store.remove('bookings', booking.id).catch(() => {});
        throw error;
      }

      const { users, updates } = await bookingLists(store);
      const branch = branches.find((item) => item.id === booking.branch_id);
      const recipients = branchId
        ? branchAdminsFor(users, branchId)
        : users.filter((user) => user.role === 'admin');
      const serviceNames = items.map((item) => item.name).join(', ');
      const when = [eventDate, eventTime].filter(Boolean).join(' ');
      const title = branch
        ? `${bookingType === 'pickup' ? 'New pickup' : 'New booking'} ${booking.ref} — ${branch.name}`
        : `Booking ${booking.ref} needs a branch`;
      const message = [
        `${req.user.name} requested ${serviceNames}.`,
        bookingType === 'pickup' ? `Pickup: ${when}.` : `Event: ${when} (${durationHours}h).`,
        bookingType === 'event' ? `Address: ${address}.` : '',
        discountAmount
          ? `Discount: ${booking.discount_label} — ₱${discountAmount.toLocaleString('en-PH')}.`
          : '',
        `Total ₱${total.toLocaleString('en-PH')}.`,
        `Contact: ${req.user.email}${req.user.phone ? ` / ${req.user.phone}` : ''}.`,
      ]
        .filter(Boolean)
        .join(' ');
      for (const recipient of recipients) {
        try {
          await store.insert('notifications', {
            id: crypto.randomUUID(),
            user_id: recipient.id,
            branch_id: branchId || null,
            booking_id: booking.id,
            title,
            message,
            read_at: null,
            created_at: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Could not record booking notification:', error.message);
        }
      }

      json(res, 201, { booking: hydrateBooking(booking, users, updates, branches) });
    })
  );

  app.patch(
    '/api/bookings/:id',
    requireAuth,
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user, { manage: true });
      const patch = {};
      const messages = [];

      if (req.user.role === 'customer') {
        if (req.body?.action !== 'cancel') throw fail(403, 'Customers can only cancel a pending request.');
        if (booking.status !== 'pending') throw fail(409, 'Only pending requests can be cancelled.');
        patch.status = 'cancelled';
        messages.push(['cancelled', 'Cancelled by the customer.']);
      } else if (req.user.role === 'staff') {
        if (['completed', 'cancelled'].includes(booking.status)) {
          throw fail(409, 'This booking is already closed.');
        }
        const status = String(req.body?.status || '');
        const message = String(req.body?.message || '').trim();
        if (!status && !message) throw fail(400, 'Add a progress note or choose a new status.');
        if (status) {
          if (!STAFF_STATUSES.includes(status)) throw fail(403, 'Staff can only update service progress.');
          if (status === 'in_progress' && !['confirmed', 'in_progress'].includes(booking.status)) {
            throw fail(409, 'This booking must be confirmed before work starts.');
          }
          if (status === 'ready' && !['in_progress', 'ready'].includes(booking.status)) {
            throw fail(409, 'Mark the booking in progress before marking it ready.');
          }
          patch.status = status;
          messages.push([status, `Service progress: ${status.replace('_', ' ')}.`]);
        }
        if (message.length > 500) throw fail(400, 'Progress notes are too long.');
        if (message) messages.push([status || booking.status, message]);
      } else {
        const body = req.body || {};
        if (body.staff_id !== undefined) {
          if (body.staff_id) {
            const staff = await store.get('users', String(body.staff_id));
            if (!staff || staff.role !== 'staff' || staff.active === false) {
              throw fail(400, 'Choose an active crew member.');
            }
            const crewBranch = req.user.role === 'branch_admin' ? req.user.branch_id : booking.branch_id;
            if (crewBranch && staff.branch_id !== crewBranch) {
              throw fail(403, 'That crew member belongs to another branch.');
            }
            if (staff.id !== booking.staff_id) {
              patch.staff_id = staff.id;
              messages.push([booking.status, `Assigned to ${staff.name}.`]);
            }
          } else if (booking.staff_id) {
            patch.staff_id = null;
            messages.push([booking.status, 'Staff assignment removed.']);
          }
        }
        if (body.branch_id !== undefined) {
          if (req.user.role !== 'admin') {
            throw fail(403, 'Only the studio owner can move a booking between branches.');
          }
          const value = body.branch_id ? String(body.branch_id) : null;
          if (value) {
            const branches = await store.list('branches');
            const target = branches.find((item) => item.id === value);
            if (!target) throw fail(400, 'Choose a valid branch.');
            if (booking.branch_id !== value) {
              patch.branch_id = value;
              patch.needs_review = false;
              messages.push([booking.status, `Assigned to ${target.name}.`]);
            }
          } else if (booking.branch_id) {
            patch.branch_id = null;
            patch.needs_review = true;
            messages.push([booking.status, 'Branch assignment cleared for review.']);
          }
        }
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!BOOKING_STATUSES.includes(status)) throw fail(400, 'Invalid booking status.');
          if (status !== booking.status) {
            patch.status = status;
            messages.push([status, `Status updated to ${status.replace('_', ' ')}.`]);
          }
        }
        if (body.event_date !== undefined) {
          const value = String(body.event_date);
          if (!validDate(value)) throw fail(400, 'Choose a valid event date.');
          patch.event_date = value;
        }
        if (body.event_time !== undefined) {
          const value = String(body.event_time || '');
          if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw fail(400, 'Choose a valid time.');
          patch.event_time = value;
        }
        if (body.venue !== undefined) {
          const value = String(body.venue).trim();
          if (value.length < 3 || value.length > 160) throw fail(400, 'Enter a valid venue.');
          patch.venue = value;
        }
        if (body.notes !== undefined) {
          const value = String(body.notes).trim();
          if (value.length > 2000) throw fail(400, 'Notes are too long.');
          patch.notes = value;
        }
        if (body.duration_hours !== undefined) {
          const value = Number(body.duration_hours);
          if (!Number.isFinite(value) || value < 1 || value > 12) {
            throw fail(400, 'Choose a duration between 1 and 12 hours.');
          }
          patch.duration_hours = value;
        }
        if (body.pickup_date !== undefined) {
          const value = String(body.pickup_date);
          if (!validDate(value)) throw fail(400, 'Choose a valid pickup date.');
          patch.pickup_date = value;
          patch.event_date = value;
        }
        if (body.pickup_time !== undefined) {
          const value = String(body.pickup_time || '');
          if (value && !validTime(value)) throw fail(400, 'Choose a valid pickup time.');
          patch.pickup_time = value;
          patch.event_time = value;
        }
        const message = String(body.message || '').trim();
        if (message.length > 500) throw fail(400, 'Message is too long.');
        if (message) messages.push([patch.status || booking.status, message]);
      }

      if (Object.keys(patch).length === 0 && messages.length === 0) {
        throw fail(400, 'Nothing to update.');
      }

      // A booking only occupies a slot while it is active. Re-check whenever the
      // date, time, duration, branch, or status changes.
      const next = normaliseBooking({ ...booking, ...patch });
      const touchesSchedule =
        patch.event_date !== undefined ||
        patch.event_time !== undefined ||
        patch.duration_hours !== undefined ||
        patch.branch_id !== undefined ||
        patch.status !== undefined;
      if (next.booking_type === 'event' && next.branch_id && touchesSchedule) {
        const units = capacityUnits(next.items);
        const start = toMinutes(next.event_time || '09:00');
        if (units > 0 && start !== null && !['completed', 'cancelled'].includes(next.status)) {
          const bookings = await store.list('bookings');
          const capacity = checkCapacity(bookings, {
            date: String(next.event_date).slice(0, 10),
            branchId: next.branch_id,
            start,
            hours: next.duration_hours,
            units,
            excludeId: booking.id,
          });
          if (capacity.full) {
            const nextSlot = capacity.next_label
              ? ` The next open start is ${capacity.next_label}.`
              : '';
            throw fail(
              409,
              `That time is full at ${capacity.capacity} simultaneous services.${nextSlot}`
            );
          }
        }
      }

      const updated = await store.update('bookings', booking.id, {
        ...patch,
        updated_at: new Date().toISOString(),
      });
      for (const [status, message] of messages) {
        await addTimeline(store, booking.id, req.user.id, status, message);
      }

      const { users, updates, branches } = await bookingLists(store);
      json(res, 200, { booking: hydrateBooking(updated, users, updates, branches) });
    })
  );

  app.patch(
    '/api/bookings/:id/payment',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user, { manage: true });
      const status = String(req.body?.payment_status || '');
      if (!PAYMENT_STATUSES.includes(status)) throw fail(400, 'Choose a valid payment status.');

      const method = String(req.body?.payment_method || '').trim();
      const reference = String(req.body?.payment_ref || '').trim();
      if (method.length > 40 || reference.length > 80) throw fail(400, 'Payment details are too long.');

      let amount = Number(req.body?.amount_paid);
      if (!Number.isFinite(amount)) amount = Number(booking.amount_paid || 0);
      if (status === 'unpaid') amount = 0;
      if (status === 'paid') amount = Number(booking.total);
      if (status === 'deposit_paid' && amount <= 0) amount = Math.ceil(Number(booking.total) / 2);
      if (status === 'refunded') amount = Number(booking.amount_paid || 0);
      if (amount < 0 || amount > Number(booking.total)) {
        throw fail(400, 'Amount paid cannot exceed the booking total.');
      }

      const paidAt =
        amount > Number(booking.amount_paid || 0) || (amount > 0 && !booking.paid_at)
          ? new Date().toISOString()
          : booking.paid_at;
      const updated = await store.update('bookings', booking.id, {
        payment_status: status,
        amount_paid: amount,
        payment_method: method,
        payment_ref: reference,
        paid_at: amount > 0 ? paidAt : null,
        updated_at: new Date().toISOString(),
      });

      const label = status.replace('_', ' ');
      await addTimeline(
        store,
        booking.id,
        req.user.id,
        booking.status,
        `Payment updated: ${label}${amount ? ` — ₱${amount.toLocaleString('en-PH')}` : ''}${
          method ? ` via ${method}` : ''
        }.`
      );

      const { users, updates, branches } = await bookingLists(store);
      json(res, 200, { booking: hydrateBooking(updated, users, updates, branches) });
    })
  );

  // ---- Availability for a branch and time window
  /* ---------- Availability and the in-app assistant ---------- */

  app.get(
    '/api/availability',
    requireAuth,
    wrap(async (req, res) => {
      const date = String(req.query.date || '');
      const branchId = String(req.query.branch_id || '');
      const time = String(req.query.time || '');
      const hours = Number(req.query.hours) || 3;
      const serviceIds = String(req.query.services || '')
        .split(',')
        .filter(Boolean);

      if (!validDate(date)) throw fail(400, 'Choose a valid date.');
      const start = toMinutes(time);
      if (start === null) throw fail(400, 'Choose a valid start time.');
      if (!Number.isFinite(hours) || hours < 1 || hours > 12) {
        throw fail(400, 'Choose a duration between 1 and 12 hours.');
      }
      if (!branchId) throw fail(400, 'Choose a branch to check availability.');
      const branches = await store.list('branches');
      if (!branches.some((branch) => branch.id === branchId)) throw fail(400, 'Choose a valid branch.');

      const catalogServices = await store.list('services');
      const services = serviceIds
        .map((id) => catalogServices.find((service) => service.id === id))
        .filter(Boolean);
      const units = capacityUnits(
        services.map((service) => ({
          service_id: service.id,
          qty: 1,
          category: service.category,
          capacity: service.capacity === true,
        }))
      );
      const bookings = await store.list('bookings');
      const availability = checkCapacity(bookings, { date, branchId, start, hours, units });
      json(res, 200, { availability });
    })
  );

  // ---- Grounded assistant
  app.post(
    '/api/assistant',
    requireAuth,
    wrap(async (req, res) => {
      const message = String(req.body?.message || '').trim();
      if (!message) throw fail(400, 'Type a question first.');
      const result = await answerQuestion(store, req.user, message);
      json(res, 200, result);
    })
  );

  // ---- Customer discounts
  /* ---------- Discounts ---------- */

  app.get(
    '/api/discounts/mine',
    requireAuth,
    wrap(async (req, res) => {
      if (req.user.role !== 'customer') return json(res, 200, { discount: null });
      const discount = await activeDiscountFor(store, req.user.id);
      json(res, 200, {
        discount: discount
          ? {
              id: discount.id,
              type: discount.type,
              value: Number(discount.value),
              note: discount.note || '',
              label: discountLabelFor(discount),
            }
          : null,
      });
    })
  );

  app.get(
    '/api/discounts',
    requireRole('admin'),
    wrap(async (req, res) => {
      const [discounts, users] = await Promise.all([store.list('discounts'), store.list('users')]);
      const userMap = new Map(users.map((user) => [user.id, user]));
      json(res, 200, {
        discounts: discounts
          .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
          .map((discount) => {
            const customer = userMap.get(discount.customer_id);
            return {
              ...discount,
              label: discountLabelFor(discount),
              customer: customer
                ? { id: customer.id, name: customer.name, email: customer.email }
                : null,
            };
          }),
      });
    })
  );

  app.post(
    '/api/discounts',
    requireRole('admin'),
    wrap(async (req, res) => {
      const type = String(req.body?.type || 'percent');
      const value = Number(req.body?.value);
      const note = String(req.body?.note || '').trim().slice(0, 80);
      if (!['percent', 'fixed'].includes(type)) throw fail(400, 'Choose a percentage or a fixed amount.');
      if (!Number.isFinite(value) || value <= 0) throw fail(400, 'Enter a discount greater than zero.');
      if (type === 'percent' && value > 100) throw fail(400, 'A percentage discount cannot exceed 100%.');
      if (type === 'fixed' && value > 1000000) throw fail(400, 'That fixed discount is too large.');

      const users = await store.list('users');
      const email = String(req.body?.customer_email || '').trim().toLowerCase();
      const customer = req.body?.customer_id
        ? users.find((user) => user.id === String(req.body.customer_id))
        : users.find((user) => user.email.toLowerCase() === email);
      if (!customer || customer.role !== 'customer') throw fail(400, 'Choose a customer account.');

      const discounts = await store.list('discounts');
      const existing = discounts.find(
        (discount) => discount.customer_id === customer.id && discount.active !== false
      );
      const now = new Date().toISOString();
      const customerSummary = { id: customer.id, name: customer.name, email: customer.email };
      if (existing) {
        const updated = await store.update('discounts', existing.id, {
          type,
          value,
          note,
          updated_at: now,
          created_by: req.user.id,
        });
        return json(res, 200, {
          discount: { ...updated, customer: customerSummary, label: discountLabelFor(updated) },
        });
      }

      const row = {
        id: crypto.randomUUID(),
        customer_id: customer.id,
        type,
        value,
        note,
        active: true,
        created_by: req.user.id,
        created_at: now,
        updated_at: now,
      };
      await store.insert('discounts', row);
      json(res, 201, { discount: { ...row, customer: customerSummary, label: discountLabelFor(row) } });
    })
  );

  app.patch(
    '/api/discounts/:id',
    requireRole('admin'),
    wrap(async (req, res) => {
      const discount = await store.get('discounts', req.params.id);
      if (!discount) throw fail(404, 'Discount not found.');
      const patch = {};
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      if (req.body?.note !== undefined) patch.note = String(req.body.note).trim().slice(0, 80);
      if (req.body?.value !== undefined) {
        const value = Number(req.body.value);
        const type = discount.type;
        if (!Number.isFinite(value) || value <= 0) throw fail(400, 'Enter a discount greater than zero.');
        if (type === 'percent' && value > 100) throw fail(400, 'A percentage discount cannot exceed 100%.');
        patch.value = value;
      }
      if (Object.keys(patch).length === 0) throw fail(400, 'Nothing to update.');
      patch.updated_at = new Date().toISOString();
      const updated = await store.update('discounts', discount.id, patch);
      json(res, 200, { discount: { ...updated, label: discountLabelFor(updated) } });
    })
  );

  // ---- Branches
  /* ---------- Branches and notifications ---------- */

  app.get(
    '/api/branches',
    requireAuth,
    wrap(async (req, res) => {
      const branches = await store.list('branches');
      json(res, 200, {
        branches: branches.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      });
    })
  );

  // ---- Notifications
  app.get(
    '/api/notifications',
    requireAuth,
    wrap(async (req, res) => {
      const rows = (await store.list('notifications'))
        .filter((row) => row.user_id === req.user.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 50);
      json(res, 200, { notifications: rows, unread: rows.filter((row) => !row.read_at).length });
    })
  );

  app.post(
    '/api/notifications/read',
    requireAuth,
    wrap(async (req, res) => {
      const unread = (await store.list('notifications'))
        .filter((row) => row.user_id === req.user.id && !row.read_at)
        .slice(0, 200);
      const now = new Date().toISOString();
      for (const row of unread) await store.update('notifications', row.id, { read_at: now });
      json(res, 200, { ok: true, read: unread.length });
    })
  );

  // ---- Studio accounts: the owner and the two branch heads
  /* ---------- Studio accounts (owner only) ---------- */

  app.get(
    '/api/accounts',
    requireRole('admin'),
    wrap(async (req, res) => {
      const users = await store.list('users');
      json(res, 200, {
        accounts: users
          .filter((user) => ACCOUNT_ROLES.includes(user.role))
          .map(sanitizeUser)
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      });
    })
  );

  app.post(
    '/api/accounts',
    requireRole('admin'),
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const role = String(req.body?.role || 'branch_admin');
      let branchId = String(req.body?.branch_id || '');

      if (name.length < 2 || name.length > 80) throw fail(400, 'Enter the full name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
        throw fail(400, 'Enter a valid email address.');
      }
      if (!ACCOUNT_ROLES.includes(role)) throw fail(400, 'Choose the owner or a branch head.');
      const weak = passwordProblem(password);
      if (weak) throw fail(400, weak);

      const branches = await store.list('branches');
      if (role === 'branch_admin') {
        if (!branchId || !branches.some((branch) => branch.id === branchId)) {
          throw fail(400, 'Choose the branch this head manages.');
        }
      } else {
        branchId = '';
      }

      const users = await store.list('users');
      if (users.some((user) => user.email.toLowerCase() === email)) {
        throw fail(409, 'An account with that email already exists.');
      }

      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        phone: '',
        branch_id: branchId || null,
        password_hash: hashPassword(password),
        role,
        active: true,
        mfa_enabled: false,
        mfa_secret: null,
        mfa_pending_secret: null,
        must_change_password: false,
        created_at: new Date().toISOString(),
      };
      await store.insert('users', user);
      json(res, 201, { account: sanitizeUser(user) });
    })
  );

  app.patch(
    '/api/accounts/:id',
    requireRole('admin'),
    wrap(async (req, res) => {
      const target = await store.get('users', req.params.id);
      if (!target || !ACCOUNT_ROLES.includes(target.role)) throw fail(404, 'Account not found.');
      if (target.id === req.user.id && req.body?.active === false) {
        throw fail(400, 'You cannot deactivate your own account.');
      }

      const patch = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 2 || name.length > 80) throw fail(400, 'Enter a valid name.');
        patch.name = name;
      }
      if (req.body?.branch_id !== undefined && target.role === 'branch_admin') {
        const branchId = String(req.body.branch_id || '');
        const branches = await store.list('branches');
        if (!branches.some((branch) => branch.id === branchId)) throw fail(400, 'Choose a valid branch.');
        patch.branch_id = branchId;
      }
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      if (Object.keys(patch).length === 0) throw fail(400, 'Nothing to update.');

      const updated = await store.update('users', target.id, patch);
      json(res, 200, { account: sanitizeUser(updated) });
    })
  );

  app.post(
    '/api/accounts/:id/reset',
    requireRole('admin'),
    wrap(async (req, res) => {
      const target = await store.get('users', req.params.id);
      if (!target || !ACCOUNT_ROLES.includes(target.role)) throw fail(404, 'Account not found.');
      const temporary = temporaryPassword();
      const patch = {
        password_hash: hashPassword(temporary),
        must_change_password: true,
        active: true,
      };
      if (req.body?.reset_mfa !== false) {
        patch.mfa_enabled = false;
        patch.mfa_secret = null;
        patch.mfa_pending_secret = null;
      }
      await store.update('users', target.id, patch);
      json(res, 200, { temporary_password: temporary, account: sanitizeUser(target) });
    })
  );

  // ---- Crew records (assignable people, no sign-in)
  /* ---------- Crew records (assignment only, never sign-ins) ---------- */

  app.get(
    '/api/staff',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const users = await store.list('users');
      const scope = req.user.role === 'branch_admin' ? req.user.branch_id : String(req.query.branch_id || '');
      json(res, 200, {
        staff: users
          .filter((user) => user.role === 'staff' && (!scope || user.branch_id === scope))
          .map(sanitizeUser),
      });
    })
  );

  app.post(
    '/api/staff',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim();
      const phone = String(req.body?.phone || '').trim();
      let email = String(req.body?.email || '').trim().toLowerCase();
      const branchId = req.user.role === 'branch_admin' ? req.user.branch_id : String(req.body?.branch_id || '');

      if (name.length < 2 || name.length > 80) throw fail(400, 'Enter the crew member\'s full name.');
      if (phone.length > 30) throw fail(400, 'Phone number is too long.');
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160)) {
        throw fail(400, 'Enter a valid email address, or leave it blank.');
      }
      if (!branchId) throw fail(400, 'Choose the branch this crew member belongs to.');
      const branches = await store.list('branches');
      if (!branches.some((branch) => branch.id === branchId)) throw fail(400, 'Choose a valid branch.');

      const users = await store.list('users');
      if (email && users.some((user) => user.email.toLowerCase() === email)) {
        throw fail(409, 'An account with that email already exists.');
      }
      if (!email) email = `crew-${crypto.randomUUID().slice(0, 12)}@crew.preciousmoments.local`;

      // A crew record is deliberately not an account: no password, no session.
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        phone,
        branch_id: branchId,
        password_hash: 'crew-record',
        role: 'staff',
        active: true,
        mfa_enabled: false,
        mfa_secret: null,
        mfa_pending_secret: null,
        must_change_password: false,
        created_at: new Date().toISOString(),
      };
      await store.insert('users', user);
      json(res, 201, { user: sanitizeUser(user) });
    })
  );

  app.patch(
    '/api/staff/:id',
    requireRole('admin', 'branch_admin'),
    wrap(async (req, res) => {
      const staff = await store.get('users', req.params.id);
      if (!staff || staff.role !== 'staff') throw fail(404, 'Crew member not found.');
      if (req.user.role === 'branch_admin' && staff.branch_id !== req.user.branch_id) {
        throw fail(403, 'That crew member belongs to another branch.');
      }
      const patch = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 2 || name.length > 80) throw fail(400, 'Enter a valid name.');
        patch.name = name;
      }
      if (req.body?.phone !== undefined) patch.phone = String(req.body.phone).trim().slice(0, 30);
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      if (Object.keys(patch).length === 0) throw fail(400, 'Nothing to update.');
      const updated = await store.update('users', staff.id, patch);
      json(res, 200, { user: sanitizeUser(updated) });
    })
  );

  /* ---------- Reports and CSV export ---------- */

  app.get(
    '/api/reports',
    requireRole('admin'),
    wrap(async (req, res) => {
      const now = new Date();
      const defaultFrom = `${todayISO().slice(0, 7)}-01`;
      const from = String(req.query.from || defaultFrom);
      const to = String(req.query.to || todayISO());
      if (!validDate(from) || !validDate(to) || from > to) {
        throw fail(400, 'Choose a valid report period.');
      }
      if ((new Date(to) - new Date(from)) / 86400000 > 366) {
        throw fail(400, 'Report periods can cover at most one year.');
      }
      const [bookings, users] = await Promise.all([store.list('bookings'), store.list('users')]);
      json(res, 200, { report: buildReport(bookings, users, from, to) });
    })
  );

  app.get(
    '/api/reports.csv',
    requireRole('admin'),
    wrap(async (req, res) => {
      const defaultFrom = `${todayISO().slice(0, 7)}-01`;
      const from = String(req.query.from || defaultFrom);
      const to = String(req.query.to || todayISO());
      if (!validDate(from) || !validDate(to) || from > to) {
        throw fail(400, 'Choose a valid report period.');
      }
      const [bookings, users] = await Promise.all([store.list('bookings'), store.list('users')]);
      const report = buildReport(bookings, users, from, to);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="precious-moments-${from}-to-${to}.csv"`);
      res.send(reportCsv(report));
    })
  );

  // ---- Pages and static assets
  // Uploaded product photos are served from their own directory with immutable
  // cache headers. Every upload gets a new filename, so replacing a photo can
  // never leave a stale cached image in the customer catalog.
  app.use(
    '/uploads/products',
    express.static(UPLOAD_DIR, {
      index: false,
      maxAge: IS_PROD ? '30d' : 0,
      immutable: IS_PROD,
      setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
    })
  );
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      extensions: ['html'],
      maxAge: IS_PROD ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  // The system opens on sign-up; the marketing page stays at /welcome.
  /* ---------- Page routes and the 404 fallback ---------- */

  app.get('/', (req, res) => {
    if (req.user) return res.redirect('/app');
    res.redirect('/login?mode=register');
  });
  app.get('/welcome', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/app');
    res.sendFile(path.join(PUBLIC_DIR, 'auth.html'));
  });
  app.get('/forgot-password', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'forgot-password.html')));
  app.get('/reset-password', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'reset-password.html')));
  app.get('/app', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    json(res, status, {
      error: status >= 500 ? 'Something went wrong. Please try again.' : error.message,
    });
  });

  return app;
}
