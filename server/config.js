import path from 'node:path';

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const STORE_MODE = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local';
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
