import path from 'node:path';

export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const STORE_MODE = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local';
export const SEED_DEMO = process.env.SEED_DEMO === 'true' || STORE_MODE === 'local';
export const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
