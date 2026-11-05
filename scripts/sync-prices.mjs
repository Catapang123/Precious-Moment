/**
 * Applies the current price catalog to an existing database.
 *
 *   npm run sync:prices              # local data/store.json
 *   npm run sync:prices -- --remote  # Supabase (requires the pricing migration)
 *
 * The sync updates rows by id, inserts new services, and deactivates services
 * that are no longer sold. It never deletes a row and never rewrites a booking,
 * so existing line items keep the name and price they were booked at.
 *
 * `.env` is loaded exactly as the server loads it, but never during tests. The
 * imports are dynamic because `server/config.js` reads `process.env` when it is
 * first evaluated; a static import would run before `.env` was loaded.
 *
 * Safety:
 *  - Supabase is never touched without `--remote`.
 *  - `--remote` with no Supabase credentials is an error, not a silent local
 *    sync, so a production update can never be mistaken for a local one.
 */
import fs from 'node:fs';

if (process.env.NODE_ENV !== 'test' && fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { STORE_MODE } = await import('../server/config.js');
const { SERVICES } = await import('../server/catalog.js');
const { createStore, syncCatalog } = await import('../server/store.js');

const allowRemote = process.argv.includes('--remote');

if (STORE_MODE === 'supabase' && !allowRemote) {
  console.error(
    'Supabase credentials are configured. Run with `--remote` to update production,\n' +
      'after applying supabase/migrate-pricing.sql. Nothing was changed.'
  );
  process.exit(1);
}

if (allowRemote && STORE_MODE !== 'supabase') {
  console.error(
    '--remote was passed, but no Supabase credentials are configured.\n' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Nothing was changed.'
  );
  process.exit(1);
}

console.log(`Store: ${STORE_MODE}`);
console.log(`Catalog: ${SERVICES.length} services`);

const store = await createStore();
const result = await syncCatalog(store);

console.log(`Updated: ${result.updated}`);
console.log(`Inserted: ${result.inserted}`);
console.log(`Retired (deactivated, not deleted): ${result.retired}`);
console.log('Bookings were not modified; existing line items keep their booked price.');
