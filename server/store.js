import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { DATA_DIR, SEED_DEMO, STORE_MODE, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './config.js';
import { buildSeed } from './seed.js';

const clone = (value) => structuredClone(value);

function createLocalStore() {
  const file = path.join(DATA_DIR, 'store.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let data;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`Could not read ${file}. Fix or remove the file before starting.`);
    }
  } else {
    data = { users: [], services: [], bookings: [], booking_updates: [] };
  }

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };

  return {
    mode: 'local',
    async list(table) {
      return clone(data[table] || []);
    },
    async get(table, id) {
      const row = (data[table] || []).find((item) => item.id === id);
      return row ? clone(row) : null;
    },
    async insert(table, row) {
      data[table] = data[table] || [];
      data[table].push(clone(row));
      save();
      return clone(row);
    },
    async insertMany(table, rows) {
      data[table] = data[table] || [];
      data[table].push(...clone(rows));
      save();
      return clone(rows);
    },
    async update(table, id, patch) {
      const rows = data[table] || [];
      const index = rows.findIndex((item) => item.id === id);
      if (index === -1) return null;
      rows[index] = { ...rows[index], ...clone(patch) };
      save();
      return clone(rows[index]);
    },
    async remove(table, id) {
      const rows = data[table] || [];
      data[table] = rows.filter((item) => item.id !== id);
      save();
    },
  };
}

const TABLES = {
  users: 'pm_users',
  services: 'pm_services',
  bookings: 'pm_bookings',
  booking_updates: 'pm_booking_updates',
};

function createSupabaseStore() {
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const table = (name) => TABLES[name] || name;

  const fail = (error, action) => {
    if (error) throw new Error(`Supabase ${action} failed: ${error.message}`);
  };

  return {
    mode: 'supabase',
    async list(name) {
      const { data, error } = await client.from(table(name)).select('*').limit(10000);
      fail(error, `select ${name}`);
      return data || [];
    },
    async get(name, id) {
      const { data, error } = await client.from(table(name)).select('*').eq('id', id).maybeSingle();
      fail(error, `select ${name}`);
      return data;
    },
    async insert(name, row) {
      const { data, error } = await client.from(table(name)).insert(row).select().single();
      fail(error, `insert ${name}`);
      return data;
    },
    async insertMany(name, rows) {
      const { data, error } = await client.from(table(name)).insert(rows).select();
      fail(error, `insert ${name}`);
      return data;
    },
    async update(name, id, patch) {
      const { data, error } = await client.from(table(name)).update(patch).eq('id', id).select().maybeSingle();
      fail(error, `update ${name}`);
      return data;
    },
    async remove(name, id) {
      const { error } = await client.from(table(name)).delete().eq('id', id);
      fail(error, `delete ${name}`);
    },
  };
}

async function seedIfNeeded(store) {
  const existingServices = await store.list('services');
  const existingUsers = await store.list('users');
  const seed = buildSeed();

  if (existingServices.length === 0) {
    await store.insertMany('services', seed.services);
  }

  if (SEED_DEMO && existingUsers.length === 0) {
    await store.insertMany('users', seed.users);
    await store.insertMany('bookings', seed.bookings);
    await store.insertMany('booking_updates', seed.booking_updates);
  }
}

export async function createStore() {
  const store = STORE_MODE === 'supabase' ? createSupabaseStore() : createLocalStore();
  await seedIfNeeded(store);
  return store;
}
