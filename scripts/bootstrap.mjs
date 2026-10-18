import crypto from 'node:crypto';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { createStore } = await import('../server/store.js');
const { hashPassword } = await import('../server/security.js');

const [emailArg, passwordArg, ...nameParts] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const password = String(passwordArg || '');
const name = nameParts.join(' ').trim() || 'Studio Admin';

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run setup -- admin@example.com "strong-password" "Full Name"');
  process.exit(1);
}
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('Use a password of at least 10 characters with a letter and a number.');
  process.exit(1);
}

const store = await createStore();
const users = await store.list('users');
if (users.some((user) => user.email.toLowerCase() === email)) {
  console.error(`An account with ${email} already exists.`);
  process.exit(1);
}

const user = {
  id: crypto.randomUUID(),
  name: name.slice(0, 80),
  email,
  phone: '',
  password_hash: hashPassword(password),
  role: 'admin',
  created_at: new Date().toISOString(),
};
await store.insert('users', user);
console.log(`Admin created in the ${store.mode} store: ${email}`);
