import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { buildReport, reportCsv } = await import('../server/reports.js');
const { STORE_MODE, SUPABASE_URL } = await import('../server/config.js');

function iso(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function previousMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: iso(first), to: iso(last) };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

const defaults = previousMonth();
const from = process.argv[2] || defaults.from;
const to = process.argv[3] || defaults.to;
if (!validDate(from) || !validDate(to) || from > to) {
  console.error(`Usage: npm run report -- [YYYY-MM-DD YYYY-MM-DD]\nInvalid range: ${from} to ${to}`);
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.warn(
    `No SUPABASE_URL set — reading the ${STORE_MODE} store. Scheduled runs should use Supabase credentials.`
  );
}

const { createStore } = await import('../server/store.js');
const store = await createStore();
const [bookings, users] = await Promise.all([store.list('bookings'), store.list('users')]);
const report = buildReport(bookings, users, from, to);

const outputDir = path.resolve('reports');
fs.mkdirSync(outputDir, { recursive: true });
const file = path.join(outputDir, `precious-moments-${from}-to-${to}.csv`);
fs.writeFileSync(file, reportCsv(report));

console.log(`Report written to ${file}`);
console.log(
  `  ${report.summary.bookings} bookings created · ₱${report.summary.revenue_collected.toLocaleString('en-PH')} recorded · ₱${report.summary.outstanding.toLocaleString('en-PH')} outstanding`
);
