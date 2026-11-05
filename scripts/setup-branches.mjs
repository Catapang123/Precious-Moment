/**
 * Creates or resets the two branch-head accounts (and optionally the owner).
 *
 *   npm run setup:branches                    # both branch heads
 *   npm run setup:branches -- --reset-owner   # also reset the studio owner
 *
 * Passwords are generated here, hashed with the app's own scrypt function, and
 * written to a git-ignored credentials file — never printed to the terminal or
 * committed. Branch ids match SEED_BRANCHES so routing keeps working.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { createStore } = await import('../server/store.js');
const { hashPassword } = await import('../server/security.js');
const { DATA_DIR, STORE_MODE } = await import('../server/config.js');
const { SEED_BRANCHES } = await import('../server/seed.js');

const makePassword = () => `${crypto.randomBytes(9).toString('base64url')}aA1!`;

const accounts = [
  {
    id: 'user-branch-admin-batangas',
    name: 'Batangas Branch Admin',
    email: (process.env.BRANCH1_ADMIN_EMAIL || 'batangas@precious.ph').toLowerCase(),
    branch_id: 'branch-batangas',
  },
  {
    id: 'user-branch-admin-bauan',
    name: 'Bauan Branch Admin',
    email: (process.env.BRANCH2_ADMIN_EMAIL || 'bauan@precious.ph').toLowerCase(),
    branch_id: 'branch-bauan',
  },
];

const store = await createStore();
const branches = await store.list('branches');

if (branches.length < SEED_BRANCHES.length) {
  for (const branch of SEED_BRANCHES) {
    if (!branches.some((item) => item.id === branch.id)) await store.insert('branches', branch);
  }
}

const users = await store.list('users');
const written = [];

for (const account of accounts) {
  const password = makePassword();
  const existing = users.find((user) => user.email.toLowerCase() === account.email);
  const row = {
    name: account.name,
    email: account.email,
    role: 'branch_admin',
    branch_id: account.branch_id,
    password_hash: hashPassword(password),
  };
  if (existing) {
    await store.update('users', existing.id, row);
  } else {
    await store.insert('users', { ...row, id: account.id, phone: '', created_at: new Date().toISOString() });
  }
  const branch = branches.find((item) => item.id === account.branch_id) || SEED_BRANCHES.find((item) => item.id === account.branch_id);
  written.push({ label: branch?.name || account.branch_id, email: account.email, password });
}

// Anyone stored without a real scrypt hash could never sign in; treat the stored
// value as the password they intended and hash it properly.
for (const user of await store.list('users')) {
  if (/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(String(user.password_hash || ''))) continue;
  if (!user.password_hash) continue;
  await store.update('users', user.id, { password_hash: hashPassword(String(user.password_hash)) });
  console.log(`Converted a plaintext password hash for ${user.email}.`);
}

if (process.argv.includes('--reset-owner')) {
  const ownerEmail = (process.env.OWNER_EMAIL || 'admin@precious.ph').toLowerCase();
  const current = await store.list('users');
  const owner =
    current.find((user) => user.email.toLowerCase() === ownerEmail) ||
    current.find((user) => user.role === 'admin');
  if (!owner) throw new Error(`No owner account found for ${ownerEmail}.`);
  const password = makePassword();
  await store.update('users', owner.id, { password_hash: hashPassword(password) });
  written.push({ label: 'Studio owner (both branches)', email: owner.email, password });
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const file = path.join(DATA_DIR, 'branch-admins.txt');
const body = [
  'Precious Moments — administrator sign-ins',
  `Generated ${new Date().toISOString()} (${STORE_MODE} store)`,
  '',
  ...written.flatMap((entry) => [`${entry.label}`, `  email:    ${entry.email}`, `  password: ${entry.password}`, '']),
  'Sign in at /login. Change these in the database when the studio takes over.',
  '',
].join('\n');
fs.writeFileSync(file, body, { mode: 0o600 });

console.log(`Wrote ${written.length} administrator sign-in(s) to ${file}`);
console.log(`Emails: ${written.map((entry) => entry.email).join(', ')}`);
