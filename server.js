/**
 * Precious Moments — server entry point.
 *
 * Responsibilities, in order:
 *  1. Load `.env` (skipped under NODE_ENV=test so the test run controls config).
 *  2. Refuse to start in production without Supabase, then build the store.
 *  3. Mount the Express app and listen on PORT.
 *  4. Close cleanly on SIGINT/SIGTERM so the port is released immediately.
 *
 * Routes live in `server/app.js`; persistence in `server/store.js`. This file
 * only wires them together.
 */
import fs from 'node:fs';

if (process.env.NODE_ENV !== 'test' && fs.existsSync('.env')) process.loadEnvFile('.env');

const { createStore } = await import('./server/store.js');
const { createApp } = await import('./server/app.js');
const { PORT, STORE_MODE } = await import('./server/config.js');

try {
  if (process.env.NODE_ENV === 'production' && STORE_MODE !== 'supabase') {
    throw new Error('Supabase is required in production. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const store = await createStore();
  const app = createApp(store);
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Precious Moments running at http://localhost:${PORT} (${STORE_MODE} store)`);
  });

  // Give in-flight requests up to five seconds to finish, then exit anyway so a
  // hung connection cannot keep the process alive forever.
  const shutdown = (signal) => {
    console.log(`\n${signal} received. Closing server.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  console.error('Could not start Precious Moments:', error.message);
  process.exit(1);
}
