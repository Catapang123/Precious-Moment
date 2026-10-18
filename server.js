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
