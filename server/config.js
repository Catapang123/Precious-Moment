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
// Without both Supabase values the app falls back to the JSON file store, which
// is what local development and the test suite use.
export const STORE_MODE = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local';
// Demo users/bookings are seeded only for the local store, never for Supabase.
export const SEED_DEMO = process.env.SEED_DEMO === 'true' || STORE_MODE === 'local';
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
// of pretending an email was delivered.
export const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
export const MAIL_FROM = process.env.MAIL_FROM || 'Precious Moments <no-reply@preciousmoments.ph>';

// Product uploads are kept outside source control. Set UPLOAD_DIR on a host
// with a persistent disk; the default is local development under public/.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'public/uploads/products');
