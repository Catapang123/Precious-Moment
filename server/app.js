import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, findService, priceLine } from './catalog.js';
import { APP_ORIGIN, DATA_DIR, IS_PROD } from './config.js';
import { BOOKING_STATUSES, buildReport, reportCsv } from './reports.js';
import {
  COOKIE_NAME,
  SESSION_MS,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  loadSessionSecret,
  readSessionToken,
  sanitizeUser,
  setSessionCookie,
  verifyPassword,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'paid', 'refunded'];
const STAFF_STATUSES = ['in_progress', 'ready', 'completed'];

const json = (res, status, body) => res.status(status).json(body);
const fail = (status, message) => Object.assign(new Error(message), { status });

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

function hydrateBooking(booking, users, updates) {
  if (!booking) return null;
  const userMap = new Map(users.map((user) => [user.id, user]));
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

async function bookingAccess(store, id, user) {
  const booking = await store.get('bookings', id);
  if (!booking) throw fail(404, 'Booking not found.');
  if (user.role === 'customer' && booking.customer_id !== user.id) {
    throw fail(403, 'You do not have access to this booking.');
  }
  if (user.role === 'staff' && booking.staff_id !== user.id) {
    throw fail(403, 'This booking is not assigned to you.');
  }
  return booking;
}

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
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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
      if (user) req.user = user;
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
      if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw fail(400, 'Use a password of at least 8 characters with a letter and a number.');
      }

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

      setSessionCookie(res, createSessionToken(user, sessionSecret), IS_PROD);
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
      if (!user || !verifyPassword(password, user.password_hash)) {
        throw fail(401, 'Email or password is incorrect.');
      }
      loginAttempts.delete(`${req.ip}:${req.path}`);
      setSessionCookie(res, createSessionToken(user, sessionSecret), IS_PROD);
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

  // ---- Public catalog
  app.get(
    '/api/services',
    wrap(async (req, res) => {
      const services = await store.list('services');
      json(res, 200, {
        categories: CATEGORIES,
        services: services
          .filter((service) => service.active !== false)
          .sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      });
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
      const [bookings, users, updates] = await Promise.all([
        store.list('bookings'),
        store.list('users'),
        store.list('booking_updates'),
      ]);
      const visible = bookings.filter((booking) => {
        if (req.user.role === 'customer') return booking.customer_id === req.user.id;
        if (req.user.role === 'staff') return booking.staff_id === req.user.id;
        return true;
      });
      visible.sort((a, b) => b.created_at.localeCompare(a.created_at));
      json(res, 200, {
        bookings: visible.map((booking) => hydrateBooking(booking, users, updates)),
      });
    })
  );

  app.get(
    '/api/bookings/:id',
    requireAuth,
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user);
      const [users, updates] = await Promise.all([store.list('users'), store.list('booking_updates')]);
      json(res, 200, { booking: hydrateBooking(booking, users, updates) });
    })
  );

  app.post(
    '/api/bookings',
    requireRole('customer', 'admin'),
    wrap(async (req, res) => {
      const eventDate = String(req.body?.event_date || '');
      const eventTime = String(req.body?.event_time || '');
      const venue = String(req.body?.venue || '').trim();
      const notes = String(req.body?.notes || '').trim();
      const rawItems = req.body?.items;

      if (!validDate(eventDate)) throw fail(400, 'Choose a valid event date.');
      if (eventDate < todayISO()) throw fail(400, 'The event date cannot be in the past.');
      if (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) {
        throw fail(400, 'Choose a valid event time.');
      }
      if (venue.length < 3 || venue.length > 160) throw fail(400, 'Enter the event venue or pickup note.');
      if (notes.length > 2000) throw fail(400, 'Notes are too long.');
      if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 25) {
        throw fail(400, 'Add at least one item to your booking.');
      }

      const items = [];
      for (const raw of rawItems) {
        const service = findService(String(raw?.service_id || ''));
        if (!service) throw fail(400, 'One of the selected services is no longer available.');
        try {
          items.push(priceLine(service, raw));
        } catch (error) {
          throw fail(400, error.message);
        }
      }
      const total = items.reduce((sum, item) => sum + item.line_total, 0);
      if (total <= 0 || total > 1000000) throw fail(400, 'That booking total is not valid.');

      const booking = {
        id: crypto.randomUUID(),
        ref: await nextBookingRef(store),
        customer_id: req.user.id,
        staff_id: null,
        event_date: eventDate,
        event_time: eventTime,
        venue,
        notes,
        status: 'pending',
        payment_status: 'unpaid',
        payment_method: '',
        payment_ref: '',
        amount_paid: 0,
        total,
        paid_at: null,
        items,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        await store.insert('bookings', booking);
        await addTimeline(store, booking.id, req.user.id, 'pending', 'Booking request submitted.');
      } catch (error) {
        await store.remove('bookings', booking.id).catch(() => {});
        throw error;
      }

      const [users, updates] = await Promise.all([store.list('users'), store.list('booking_updates')]);
      json(res, 201, { booking: hydrateBooking(booking, users, updates) });
    })
  );

  app.patch(
    '/api/bookings/:id',
    requireAuth,
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user);
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
            if (!staff || staff.role !== 'staff') throw fail(400, 'Choose a valid staff member.');
            if (staff.id !== booking.staff_id) {
              patch.staff_id = staff.id;
              messages.push([booking.status, `Assigned to ${staff.name}.`]);
            }
          } else if (booking.staff_id) {
            patch.staff_id = null;
            messages.push([booking.status, 'Staff assignment removed.']);
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
        const message = String(body.message || '').trim();
        if (message.length > 500) throw fail(400, 'Message is too long.');
        if (message) messages.push([patch.status || booking.status, message]);
      }

      if (Object.keys(patch).length === 0 && messages.length === 0) {
        throw fail(400, 'Nothing to update.');
      }

      const updated = await store.update('bookings', booking.id, {
        ...patch,
        updated_at: new Date().toISOString(),
      });
      for (const [status, message] of messages) {
        await addTimeline(store, booking.id, req.user.id, status, message);
      }

      const [users, updates] = await Promise.all([store.list('users'), store.list('booking_updates')]);
      json(res, 200, { booking: hydrateBooking(updated, users, updates) });
    })
  );

  app.patch(
    '/api/bookings/:id/payment',
    requireRole('admin'),
    wrap(async (req, res) => {
      const booking = await bookingAccess(store, req.params.id, req.user);
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

      const [users, updates] = await Promise.all([store.list('users'), store.list('booking_updates')]);
      json(res, 200, { booking: hydrateBooking(updated, users, updates) });
    })
  );

  // ---- Team and reports
  app.get(
    '/api/staff',
    requireRole('admin'),
    wrap(async (req, res) => {
      const users = await store.list('users');
      json(res, 200, {
        staff: users.filter((user) => user.role === 'staff').map(sanitizeUser),
      });
    })
  );

  app.post(
    '/api/staff',
    requireRole('admin'),
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = String(req.body?.phone || '').trim();
      const password = String(req.body?.password || '');

      if (name.length < 2 || name.length > 80) throw fail(400, 'Enter the crew member\'s full name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
        throw fail(400, 'Enter a valid email address.');
      }
      if (phone.length > 30) throw fail(400, 'Phone number is too long.');
      if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw fail(400, 'Use a password of at least 8 characters with a letter and a number.');
      }

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
        role: 'staff',
        created_at: new Date().toISOString(),
      };
      await store.insert('users', user);
      json(res, 201, { user: sanitizeUser(user) });
    })
  );

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
  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      maxAge: IS_PROD ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'auth.html')));
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
