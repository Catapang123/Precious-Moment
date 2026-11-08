/**
 * Configuration: every environment-driven setting in one place.
 *
 * Read once at startup, then imported by the rest of the server. Keeping the
 * `process.env` reads here (instead of scattered through routes) means the
 * deployment story lives in a single file: `.env` locally, environment
 * variables on Render, and test-only values in the smoke runner.
 *
 * Deliberately has no logging: `SUPABASE_SERVICE_ROLE_KEY` is a secret and must
 * never be printed.
 */
import path from 'node:path';

// `production` turns on secure cookies and HSTS; anything else is development.
export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// Public product-image bucket. Production requires this because the Render free
// filesystem is ephemeral; local development falls back to UPLOAD_DIR.
export const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || '';
// Render terminates TLS in front of the app. Explicit trust keeps client IPs
// useful for rate limiting; direct/local deployments should leave this off.
export const TRUST_PROXY = process.env.TRUST_PROXY === '1' ? 1 : false;

// Without both Supabase values the app falls back to the JSON file store, which
// is what local development and the test suite use. Production is never allowed
// to take this path: see the validation below.
export const STORE_MODE = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local';

// Demo users/bookings are a local-development convenience only. They must never
// be seeded in production, even if a deployment accidentally leaves
// SEED_DEMO=true in its environment.
export const SEED_DEMO = !IS_PROD && (process.env.SEED_DEMO === 'true' || STORE_MODE === 'local');
export const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;

// Address to coordinates. Nominatim is free and keyless; swap GEOCODER_URL for a
// paid geocoder if the booking volume outgrows its fair-use policy.
export const GEOCODER_URL = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
export const GEOCODER_ENABLED = process.env.GEOCODER_ENABLED !== 'false';
// Branches closer than this to each other send a booking to manual review.
export const BRANCH_TIE_KM = Number(process.env.BRANCH_TIE_KM) || 0.25;

// How many booth/crew services one branch can run at the same time. This is a
// concurrency limit, not a daily limit: later time slots stay bookable.
export const MAX_SIMULTANEOUS_SERVICES = Number(process.env.MAX_SIMULTANEOUS_SERVICES) || 5;

// Password-reset links are single-use and time-limited. Thirty minutes is long
// enough to find the email, short enough that a forwarded link goes stale fast.
export const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30;

// Transactional email is sent through Resend's HTTPS API so the app does not
// need an SMTP package. Without a key, development logs the reset link instead
// of pretending an email was delivered. Production requires both values.
export const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
export const MAIL_FROM =
  process.env.MAIL_FROM || (IS_PROD ? '' : 'Precious Moments <no-reply@preciousmoments.ph>');

// Product uploads are kept outside source control. Set UPLOAD_DIR on a host
// with a persistent disk; the default is local development under public/.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'public/uploads/products');

/**
 * A production process must fail before it accepts a single request if its
 * critical dependencies are missing. This is deliberately a startup error, not
 * a per-request error: a half-configured deployment should never be marked
 * healthy or seed a local database with demo accounts.
 */
function validateProductionConfig() {
  if (!IS_PROD) return;
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!process.env.APP_ORIGIN) missing.push('APP_ORIGIN');
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!MAIL_FROM) missing.push('MAIL_FROM');
  if (!SUPABASE_STORAGE_BUCKET) missing.push('SUPABASE_STORAGE_BUCKET');
  if (missing.length) {
    throw new Error(
      `Production configuration is incomplete: ${missing.join(', ')}. ` +
        'Refusing to start with the local demo store or without account-recovery email.'
    );
  }

  let origin;
  try {
    origin = new URL(APP_ORIGIN);
  } catch {
    throw new Error('APP_ORIGIN must be a valid absolute URL.');
  }
  if (origin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use https:// in production.');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_ORIGIN must be an origin only, without a path, query, or hash.');
  }
  // Resend accepts both `user@example.com` and `Name <user@example.com>`.
  // Reject line breaks as well: MAIL_FROM is interpolated into an email header.
  const sender = String(MAIL_FROM).trim();
  const senderMatch = /^(?:[^<>\r\n]*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/.exec(sender);
  if (!senderMatch) {
    throw new Error('MAIL_FROM must be a valid sender address, optionally as "Name <email>".');
  }
}

validateProductionConfig();
