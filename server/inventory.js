/**
 * Physical booth inventory and maintenance blocks.
 *
 * The catalog decides what a customer can buy; this module decides whether a
 * physical unit actually exists for the requested event window. It is separate
 * from the branch's five-simultaneous-service capacity: a booking must pass both
 * checks. Physical inventory is studio-wide, because the five Photobooth, one
 * Video Booth, one Mirror Booth, and two Studio Booth units are shared between
 * the two branches.
 *
 * Dates and times are compared in a fixed wall-clock frame (the studio's local
 * date + time), matching how bookings are stored. No timezone conversion is
 * applied, so a 2:00 PM booking and a 2:00 PM maintenance block overlap.
 */
const MINUTE = 60 * 1000;

export const BOOTH_TYPES = {
  photobooth: {
    label: 'Photobooth',
    short: 'Photobooth',
    unitLabels: ['PB-1', 'PB-2', 'PB-3', 'PB-4', 'PB-5'],
    serviceIds: [
      'photobooth-4r',
      'photobooth-4r-magnetic',
      'photobooth-strips',
      'photobooth-strips-magnetic',
    ],
  },
  video: {
    label: 'Video booth',
    short: 'Video',
    unitLabels: ['VB-1'],
    serviceIds: ['booth-360'],
  },
  mirror: {
    label: 'Mirror booth',
    short: 'Mirror',
    unitLabels: ['MB-1'],
    serviceIds: ['booth-mirror'],
  },
  studio: {
    label: 'Studio booth',
    short: 'Studio',
    unitLabels: ['SB-1', 'SB-2'],
    serviceIds: ['booth-studio'],
  },
};

export const BOOTH_KINDS = ['maintenance', 'damaged', 'blocked'];
export const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'confirmed', 'in_progress', 'ready']);

const SERVICE_TYPE = new Map(
  Object.entries(BOOTH_TYPES).flatMap(([type, info]) => info.serviceIds.map((id) => [id, type]))
);

const UNIT_TYPE = new Map(
  Object.entries(BOOTH_TYPES).flatMap(([type, info]) => info.unitLabels.map((label) => [label, type]))
);

let blocksWarningShown = false;

export function boothTypeForService(serviceId) {
  return SERVICE_TYPE.get(String(serviceId || '')) || null;
}

export function unitBelongsToType(unitLabel, type) {
  const info = BOOTH_TYPES[type];
  return Boolean(info && info.unitLabels.includes(String(unitLabel || '')));
}

export function allUnitLabels() {
  return Object.entries(BOOTH_TYPES).flatMap(([type, info]) =>
    info.unitLabels.map((label) => ({ label, type, type_label: info.label }))
  );
}

/**
 * Counts the physical units a set of priced booking lines needs, by booth type.
 * A line's `booth_type` snapshot is preferred so future catalog edits cannot
 * silently move historical bookings into another inventory pool.
 */
export function boothUnitsForItems(items = []) {
  const requested = Object.fromEntries(Object.keys(BOOTH_TYPES).map((type) => [type, 0]));
  for (const item of items || []) {
    const type =
      (item?.booth_type && BOOTH_TYPES[item.booth_type] ? item.booth_type : null) ||
      boothTypeForService(item?.service_id);
    if (!type) continue;
    requested[type] += Math.max(1, Number(item.qty) || 1);
  }
  return requested;
}

export function boothUnitsForServices(serviceIds = []) {
  return boothUnitsForItems(serviceIds.map((serviceId) => ({ service_id: serviceId, qty: 1 })));
}

function parseWallClock(date, time, fallbackTime = '00:00') {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = String(time || fallbackTime).slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const value = Date.parse(`${day}T${clock}:00Z`);
  return Number.isFinite(value) ? value : null;
}

export function eventWindow(date, time, hours = 3) {
  const start = parseWallClock(date, time || '09:00');
  if (start === null) return null;
  const duration = Math.max(1, Number(hours) || 3) * 60 * MINUTE;
  return { start, end: start + duration };
}

export function blockWindow(block) {
  const start = parseWallClock(block?.start_date, block?.start_time || '00:00');
  const end = parseWallClock(block?.end_date, block?.end_time || '23:59');
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

export function overlaps(a, b) {
  return Boolean(a && b && a.start < b.end && b.start < a.end);
}

export function isActiveBlock(block) {
  return block?.active !== false;
}

/**
 * Loads maintenance blocks without making booking creation depend on the new
 * migration being present. Until `migrate-inventory.sql` is applied, physical
 * limits still work from bookings; only manual blocks are unavailable, and the
 * inventory screen explains that clearly.
 */
export async function readInventoryBlocks(store) {
  try {
    const rows = await store.list('inventory_blocks');
    return { blocks: rows, available: true, warning: '' };
  } catch (error) {
    const message = String(error?.message || error);
    const code = String(error?.code || '');
    const missingTable =
      code === '42P01' ||
      code === 'PGRST205' ||
      (/could not find the table|does not exist/i.test(message) && /pm_inventory_blocks/i.test(message));

    // A missing migration is expected on an existing database: bookings still
    // work from their own records, and only manual blocks are disabled. Every
    // other database failure must fail closed so a transient outage cannot
    // silently drop a maintenance block and overbook a physical unit.
    if (!missingTable) throw error;

    if (!blocksWarningShown) {
      console.warn(
        'Inventory blocks are unavailable. Run supabase/migrate-inventory.sql to enable maintenance blocks.',
        message
      );
      blocksWarningShown = true;
    }
    return {
      blocks: [],
      available: false,
      warning: 'Maintenance blocks need the inventory migration before they can be saved.',
    };
  }
}

/**
 * Counts active bookings and blocks that overlap a window. `bookings` may be
 * the whole booking history; branch filtering is intentionally not applied
 * because the physical units are shared studio-wide.
 */
export function inventoryUsage(bookings, blocks, { date, time, hours = 3, excludeId = null } = {}) {
  const window = eventWindow(date, time, hours);
  const usage = Object.fromEntries(
    Object.entries(BOOTH_TYPES).map(([type, info]) => [
      type,
      {
        type,
        label: info.label,
        unit_labels: info.unitLabels,
        total: info.unitLabels.length,
        reserved: 0,
        deployed: 0,
        maintenance: 0,
        blocked: 0,
        used: 0,
      },
    ])
  );
  if (!window) return { window: null, types: usage };

  for (const booking of bookings || []) {
    if (!booking || booking.id === excludeId) continue;
    if (booking.booking_type !== 'event') continue;
    if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) continue;
    const start = parseWallClock(
      String(booking.event_date || '').slice(0, 10),
      booking.event_time || '09:00'
    );
    if (start === null) continue;
    const end = start + Math.max(1, Number(booking.duration_hours) || 3) * 60 * MINUTE;
    if (!overlaps({ start, end }, window)) continue;
    const units = boothUnitsForItems(booking.items || []);
    for (const [type, count] of Object.entries(units)) {
      if (!count) continue;
      if (booking.status === 'pending') usage[type].reserved += count;
      else usage[type].deployed += count;
      usage[type].used += count;
    }
  }

  for (const block of blocks || []) {
    if (!isActiveBlock(block)) continue;
    if (!BOOTH_TYPES[block.booth_type]) continue;
    const span = blockWindow(block);
    if (!overlaps(span, window)) continue;
    if (block.kind === 'blocked') usage[block.booth_type].blocked += 1;
    else usage[block.booth_type].maintenance += 1;
    usage[block.booth_type].used += 1;
  }

  for (const row of Object.values(usage)) {
    row.available = Math.max(0, row.total - row.used);
    row.full = row.available === 0;
  }
  return { window, types: usage };
}

export function checkBoothInventory(
  bookings,
  blocks,
  { date, time, hours = 3, items = [], excludeId = null } = {}
) {
  const usage = inventoryUsage(bookings, blocks, { date, time, hours, excludeId });
  if (!usage.window) {
    return { ok: false, message: 'Choose a valid event date and start time.', ...usage };
  }
  const requested = boothUnitsForItems(items);
  for (const [type, count] of Object.entries(requested)) {
    if (!count) continue;
    const row = usage.types[type];
    if (!row) continue;
    if (row.used + count > row.total) {
      const remaining = Math.max(0, row.total - row.used);
      const detail =
        row.total === 1
          ? `The ${row.label.toLowerCase()} has 1 physical unit`
          : `The ${row.label.toLowerCase()} has ${row.total} physical units`;
      return {
        ok: false,
        message: `${detail}, and ${row.used} ${row.used === 1 ? 'is' : 'are'} already committed for that time. ${remaining} ${remaining === 1 ? 'unit remains' : 'units remain'}. Choose another time or date.`,
        conflict: { type, requested: count, ...row },
        ...usage,
      };
    }
  }
  return { ok: true, requested, ...usage };
}

/**
 * A snapshot for the dashboard: the selected window, usage counts, active
 * blocks, and upcoming booth deployments. Branch heads get global inventory
 * counts but only their own branch's deployment details.
 */
export function buildInventorySnapshot({
  bookings,
  blocks,
  users,
  branches,
  date,
  time,
  hours,
  branchId = '',
}) {
  const usage = inventoryUsage(bookings, blocks, { date, time, hours });
  const userMap = new Map((users || []).map((user) => [user.id, user]));
  const branchMap = new Map((branches || []).map((branch) => [branch.id, branch]));

  const activeBlocks = (blocks || [])
    .filter(isActiveBlock)
    .filter((block) => String(block.end_date || '').slice(0, 10) >= String(date || '').slice(0, 10))
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.unit_label).localeCompare(String(b.unit_label)));

  const upcoming = (bookings || [])
    .filter((booking) => booking.booking_type === 'event')
    .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status))
    .filter((booking) => String(booking.event_date || '').slice(0, 10) >= String(date || '').slice(0, 10))
    .filter((booking) => !branchId || booking.branch_id === branchId)
    .map((booking) => {
      const units = boothUnitsForItems(booking.items || []);
      const boothLines = Object.entries(units)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, label: BOOTH_TYPES[type].label, units: count }));
      return {
        id: booking.id,
        ref: booking.ref,
        customer: userMap.get(booking.customer_id)?.name || 'Customer',
        event_date: booking.event_date,
        event_time: booking.event_time,
        duration_hours: booking.duration_hours,
        venue: booking.venue,
        address: booking.address,
        status: booking.status,
        branch: booking.branch_id ? branchMap.get(booking.branch_id)?.name || 'Branch' : 'Needs review',
        booths: boothLines,
      };
    })
    .filter((booking) => booking.booths.length)
    .sort((a, b) => `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`))
    .slice(0, 30);

  return {
    generated_at: new Date().toISOString(),
    window: {
      date,
      time,
      hours,
      start: usage.window?.start || null,
      end: usage.window?.end || null,
    },
    types: Object.values(usage.types),
    upcoming,
    blocks: activeBlocks.map((block) => ({
      id: block.id,
      booth_type: block.booth_type,
      booth_label: BOOTH_TYPES[block.booth_type]?.label || block.booth_type,
      unit_label: block.unit_label,
      kind: block.kind || 'maintenance',
      reason: block.reason || '',
      start_date: block.start_date,
      start_time: block.start_time,
      end_date: block.end_date,
      end_time: block.end_time,
      created_at: block.created_at,
    })),
    totals: Object.values(usage.types).reduce(
      (sum, row) => ({
        units: sum.units + row.total,
        available: sum.available + row.available,
        reserved: sum.reserved + row.reserved,
        deployed: sum.deployed + row.deployed,
        maintenance: sum.maintenance + row.maintenance,
        blocked: sum.blocked + row.blocked,
      }),
      { units: 0, available: 0, reserved: 0, deployed: 0, maintenance: 0, blocked: 0 }
    ),
  };
}

export { UNIT_TYPE };
