/**
 * Persistence layer.
 *
 * Exposes one small async interface (`list`, `get`, `insert`, `insertMany`,
 * `update`, `remove`) over two interchangeable backends:
 *
 *  - `local`    — a single JSON file under DATA_DIR; used for development, the
 *                 smoke tests, and any deployment without Supabase credentials.
 *  - `supabase` — the production Postgres database via the service-role key.
 *
 * Routes never talk to either backend directly, so switching between them is a
 * configuration change rather than a code change. Records are cloned on the way
 * out so callers cannot mutate the in-memory copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { SERVICES } from './catalog.js';
import { DATA_DIR, SEED_DEMO, STORE_MODE, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './config.js';
import { buildSeed } from './seed.js';

const clone = (value) => structuredClone(value);

/**
 * JSON-file store. Every write rewrites the whole file through a temp file and
 * a rename, so an interrupted save cannot leave a half-written `store.json`.
 * Intended for one process at a time: it is a development convenience, not a
 * multi-user database.
 */
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
    data = {
      users: [],
      services: [],
      bookings: [],
      booking_updates: [],
      booking_files: [],
      booking_cancellations: [],
      branches: [],
      notifications: [],
      discounts: [],
      password_resets: [],
      audit_logs: [],
    };
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

// The Supabase schema prefixes every table with `pm_` to coexist with other
// projects in the same database. The local store uses the unprefixed names.
const TABLES = {
  users: 'pm_users',
  services: 'pm_services',
  bookings: 'pm_bookings',
  booking_updates: 'pm_booking_updates',
  booking_files: 'pm_booking_files',
  booking_cancellations: 'pm_booking_cancellations',
  branches: 'pm_branches',
  notifications: 'pm_notifications',
  discounts: 'pm_discounts',
  password_resets: 'pm_password_resets',
  audit_logs: 'pm_audit_logs',
};

/**
 * Production store backed by Supabase Postgres. Uses the service-role key, so
 * this module must stay server-side only — it is never imported by the browser.
 */
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
      // Supabase/PostgREST caps a single response. Walking ordered pages keeps
      // large booking histories complete instead of silently stopping at
      // 10,000 rows; ordering makes the page boundaries deterministic.
      const pageSize = 1000;
      const rows = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from(table(name))
          .select('*')
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);
        fail(error, `select ${name}`);
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < pageSize) break;
      }
      return rows;
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

/**
 * Applies the current catalog to an existing database without deleting rows or
 * touching bookings.
 *
 * - a service that exists is updated in place (same id, so old booking items
 *   keep their snapshot and their link);
 * - a new service is inserted;
 * - a service no longer in the catalog is deactivated, never deleted, so its
 *   history remains readable.
 *
 * This is intentionally not run on every boot: the owner may edit a price from
 * the admin Pricing page, and a restart must not silently revert that edit.
 * Run it with `npm run sync:prices` when the catalog source changes.
 */
export async function syncCatalog(store) {
  const existing = await store.list('services');
  const byId = new Map(existing.map((row) => [row.id, row]));
  const now = new Date().toISOString();
  let updated = 0;
  let inserted = 0;
  let retired = 0;
  let preserved = 0;

  for (const service of SERVICES) {
    const row = byId.get(service.id);
    if (!row) {
      await store.insert('services', {
        ...service,
        origin: 'catalog',
        admin_edited: false,
        active: service.active !== false,
        created_at: now,
        updated_at: now,
      });
      inserted += 1;
      continue;
    }

    // An owner edit is authoritative. A later catalog sync must not silently
    // put the old workbook price back, so leave the row alone.
    if (row.admin_edited === true) {
      const patch = {};
      if (!row.origin) patch.origin = 'catalog';
      if (!row.updated_at) patch.updated_at = row.created_at || now;
      if (Object.keys(patch).length) await store.update('services', row.id, patch);
      preserved += 1;
      continue;
    }

    await store.update('services', service.id, {
      ...service,
      origin: row.origin === 'custom' ? 'custom' : 'catalog',
      admin_edited: false,
      active: service.active !== false,
      created_at: row.created_at || now,
      updated_at: now,
    });
    updated += 1;
  }

  const currentIds = new Set(SERVICES.map((service) => service.id));
  for (const row of existing) {
    if (
      !currentIds.has(row.id) &&
      row.active !== false &&
      row.origin !== 'custom' &&
      row.admin_edited !== true
    ) {
      await store.update('services', row.id, { active: false, updated_at: now });
      retired += 1;
    }
  }
  return { updated, inserted, retired, preserved };
}

/**
 * Adds catalog products a database has never seen, without touching rows it
 * already has.
 *
 * A store seeded before Tarpaulin and Blackout became measured products still
 * holds only the old fixed sizes. Seeding alone never fixes that because the
 * services table is no longer empty, so every startup fills in missing ids.
 * Existing prices, images, and owner edits are left exactly as they are.
 */
export async function addMissingCatalogServices(store) {
  const existing = await store.list('services');
  const known = new Set(existing.map((row) => row.id));
  const now = new Date().toISOString();
  const missing = SERVICES.filter((service) => !known.has(service.id)).map((service) => ({
    ...service,
    origin: 'catalog',
    admin_edited: false,
    active: service.active !== false,
    created_at: now,
    updated_at: now,
  }));
  if (!missing.length) return 0;
  try {
    await store.insertMany('services', missing);
  } catch (error) {
    // An older Supabase project may not have the image/measurement columns yet.
    // Keep the rest of the site running and point at the additive migration
    // instead of failing every request because two catalog rows are missing.
    console.warn(
      `Could not add ${missing.length} new catalog products: ${error.message}\n` +
        'Apply supabase/migrate-catalog-images-auth.sql in Supabase, then restart the app.'
    );
    return 0;
  }
  return missing.length;
}

/**
 * Seeds what a fresh database needs to be usable: the price catalog and the
 * two branches. Demo accounts and bookings are added only when SEED_DEMO is on
 * (the local store), so a production database never receives sample customers.
 */
async function seedIfNeeded(store) {
  const existingServices = await store.list('services');
  const existingUsers = await store.list('users');
  const seed = buildSeed();

  if (existingServices.length === 0) {
    await store.insertMany('services', seed.services);
  } else {
    // An older database still needs products released after it was seeded.
    await addMissingCatalogServices(store);
  }

  const existingBranches = await store.list('branches');
  if (existingBranches.length === 0) {
    await store.insertMany('branches', seed.branches);
  }

  if (SEED_DEMO && existingUsers.length === 0) {
    await store.insertMany('users', seed.users);
    await store.insertMany('bookings', seed.bookings);
    await store.insertMany('booking_updates', seed.booking_updates);
    await store.insertMany('discounts', seed.discounts);
  }
}

/** Picks the backend from configuration, seeds it, and returns the store. */
export async function createStore() {
  const store = STORE_MODE === 'supabase' ? createSupabaseStore() : createLocalStore();
  await seedIfNeeded(store);
  return store;
}
