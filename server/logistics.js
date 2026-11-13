/**
 * Logistics: deployment progress, physical-unit assignments, and the schedule
 * calendar. These helpers stay deliberately separate from the booking rules so
 * a deployment edit can never move an event date or bypass an availability
 * check. Physical units are still studio-wide; branches only scope visibility.
 */
import {
  ACTIVE_BOOKING_STATUSES,
  BOOTH_TYPES,
  blockWindow,
  boothUnitsForItems,
  eventWindow,
  isActiveBlock,
  overlaps,
} from './inventory.js';

export const DEPLOYMENT_STATUSES = [
  'unassigned',
  'scheduled',
  'dispatched',
  'on_site',
  'collected',
];

export const DEPLOYMENT_LABELS = {
  unassigned: 'Unassigned',
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  on_site: 'On site',
  collected: 'Collected',
};

export const SCHEDULE_TYPES = {
  setup: { label: 'Setup', icon: 'setup' },
  event: { label: 'Event', icon: 'event' },
  pickup: { label: 'Pickup', icon: 'pickup' },
};

const UNIT_TYPE = new Map(
  Object.entries(BOOTH_TYPES).flatMap(([type, info]) =>
    info.unitLabels.map((label) => [label, type])
  )
);

export function unitTypeForLabel(label) {
  return UNIT_TYPE.get(String(label || '').toUpperCase()) || null;
}

export function deploymentStatusOf(booking) {
  return DEPLOYMENT_STATUSES.includes(booking?.deployment_status)
    ? booking.deployment_status
    : 'unassigned';
}

export function assignedUnitsOf(booking) {
  let value = booking?.assigned_units;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = [];
    }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((unit) => String(unit || '').trim().toUpperCase()).filter(Boolean))];
}

function wallClock(date, time) {
  const day = String(date || '').slice(0, 10);
  const clock = String(time || '00:00').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const value = Date.parse(`${day}T${clock}:00Z`);
  return Number.isFinite(value) ? value : null;
}

export function eventTimeWindow(booking) {
  return eventWindow(
    booking?.event_date,
    booking?.event_time || '09:00',
    Number(booking?.duration_hours) || 3
  );
}

/**
 * Checks the units already chosen for one booking. The booking may leave units
 * unassigned, but it can never claim more units than its lines require, claim a
 * unit from another booth pool, reuse a label, or take a unit that another
 * overlapping booking/block already holds.
 */
export function assignedUnitConflicts(booking, bookings = [], blocks = []) {
  const units = assignedUnitsOf(booking);
  const window = eventTimeWindow(booking);
  const conflicts = [];
  const blocked = [];

  if (!window || !units.length) return { conflicts, blocked };

  for (const other of bookings || []) {
    if (!other || other.id === booking.id) continue;
    if (other.status === 'cancelled' || other.status === 'completed') continue;
    if (other.booking_type !== 'event') continue;
    const otherWindow = eventTimeWindow(other);
    if (!overlaps(window, otherWindow)) continue;
    const otherUnits = assignedUnitsOf(other);
    for (const unit of units) {
      if (otherUnits.includes(unit)) {
        conflicts.push({ unit, ref: other.ref || 'another booking' });
      }
    }
  }

  for (const block of blocks || []) {
    if (!isActiveBlock(block)) continue;
    const span = blockWindow(block);
    if (!overlaps(window, span)) continue;
    const blockUnit = String(block.unit_label || '').toUpperCase();
    if (units.includes(blockUnit)) blocked.push({ unit: blockUnit, kind: block.kind || 'maintenance' });
  }

  return { conflicts, blocked };
}

export function validateAssignedUnits(booking, bookings, blocks) {
  const units = assignedUnitsOf(booking);
  if (units.length > 20) return 'Choose no more than 20 physical units.';

  const required = boothUnitsForItems(booking.items || []);
  const counts = {};
  for (const unit of units) {
    const type = unitTypeForLabel(unit);
    if (!type) return `${unit} is not a recognised physical unit.`;
    if (!required[type]) {
      return `${unit} belongs to the ${BOOTH_TYPES[type].label} pool, but this booking does not request one.`;
    }
    counts[type] = (counts[type] || 0) + 1;
    if (counts[type] > required[type]) {
      return `This booking requests ${required[type]} ${BOOTH_TYPES[type].label.toLowerCase()} unit${
        required[type] === 1 ? '' : 's'
      }, so it cannot claim ${counts[type]}.`;
    }
  }

  const { conflicts, blocked } = assignedUnitConflicts(booking, bookings, blocks);
  if (conflicts.length) {
    return `${conflicts[0].unit} is already assigned to ${conflicts[0].ref} for an overlapping time. Choose another unit.`;
  }
  if (blocked.length) {
    return `${blocked[0].unit} is blocked for maintenance in this window. Choose another unit.`;
  }

  return '';
}

export function allUnitOptions() {
  return Object.entries(BOOTH_TYPES).flatMap(([type, info]) =>
    info.unitLabels.map((label) => ({ label, type, type_label: info.label }))
  );
}

function dateInRange(value, from, to) {
  const day = String(value || '').slice(0, 10);
  return Boolean(day && day >= from && day <= to);
}

function scheduleEntry(booking, type, date, time, view) {
  if (!dateInRange(date, view.from, view.to)) return null;
  const copy = SCHEDULE_TYPES[type];
  return {
    id: `${booking.id}:${type}`,
    booking_id: booking.id,
    ref: booking.ref,
    date: String(date).slice(0, 10),
    time: String(time || '').slice(0, 5),
    duration_hours: type === 'event' ? Number(booking.duration_hours) || 3 : 0,
    type,
    type_label: copy.label,
    title: booking.booking_type === 'pickup' ? `Pickup · ${booking.ref}` : `${copy.label} · ${booking.ref}`,
    customer: view.users.get(booking.customer_id)?.name || 'Customer',
    branch: booking.branch_id ? view.branches.get(booking.branch_id)?.name || 'Branch' : 'Needs review',
    branch_id: booking.branch_id || null,
    venue: booking.venue || '',
    booking_status: booking.status,
    deployment_status: deploymentStatusOf(booking),
    assigned_units: assignedUnitsOf(booking),
  };
}

/**
 * Builds one calendar entry for each real schedule moment: setup, the event
 * itself, and collection. A pickup booking only contributes its pickup entry.
 * Visibility is checked by the caller with the same rules as booking reads.
 */
export function buildCalendar(bookings, users, branches, { from, to }) {
  const view = {
    from,
    to,
    users: new Map((users || []).map((user) => [user.id, user])),
    branches: new Map((branches || []).map((branch) => [branch.id, branch])),
  };
  const entries = [];
  for (const booking of bookings || []) {
    if (!booking || booking.status === 'cancelled') continue;
    if (booking.booking_type === 'pickup') {
      const entry = scheduleEntry(booking, 'pickup', booking.event_date, booking.event_time, view);
      if (entry) entries.push(entry);
      continue;
    }
    if (booking.setup_date) {
      const entry = scheduleEntry(booking, 'setup', booking.setup_date, booking.setup_time, view);
      if (entry) entries.push(entry);
    }
    const event = scheduleEntry(booking, 'event', booking.event_date, booking.event_time, view);
    if (event) entries.push(event);
    if (booking.pickup_schedule_date) {
      const pickup = scheduleEntry(
        booking,
        'pickup',
        booking.pickup_schedule_date,
        booking.pickup_schedule_time,
        view
      );
      if (pickup) entries.push(pickup);
    }
  }
  entries.sort(
    (a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.ref.localeCompare(b.ref)
  );

  const active = new Set(ACTIVE_BOOKING_STATUSES);
  const relevant = (bookings || []).filter(
    (booking) =>
      booking &&
      booking.status !== 'cancelled' &&
      (dateInRange(booking.event_date, from, to) ||
        dateInRange(booking.setup_date, from, to) ||
        dateInRange(booking.pickup_schedule_date, from, to))
  );
  return {
    from,
    to,
    entries,
    summary: {
      bookings: new Set(entries.map((entry) => entry.booking_id)).size,
      setups: entries.filter((entry) => entry.type === 'setup').length,
      events: entries.filter((entry) => entry.type === 'event').length,
      pickups: entries.filter((entry) => entry.type === 'pickup').length,
      assigned_units: new Set(entries.flatMap((entry) => entry.assigned_units)).size,
      active_bookings: relevant.filter((booking) => active.has(booking.status)).length,
    },
  };
}
