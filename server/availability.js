import { findService } from './catalog.js';
import { MAX_SIMULTANEOUS_SERVICES } from './config.js';

// Only work that puts a crew or a booth on site competes for capacity.
// Tarpaulin, shirts, mugs and other print jobs are production work and are
// queued by the studio, so they do not consume a simultaneous service slot.
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'in_progress', 'ready']);
const DAY_START_MINUTES = 7 * 60;
const DAY_END_MINUTES = 23 * 60;
const STEP_MINUTES = 30;

export const MAX_UNITS = MAX_SIMULTANEOUS_SERVICES;

function toMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function slotLabel(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function isCapacityService(item) {
  if (!item) return false;
  const service = findService(item.service_id);
  const category = item.category || service?.category;
  return category === 'Photo & booth';
}

export function capacityUnits(items = []) {
  return items.reduce((sum, item) => {
    if (!isCapacityService(item)) return sum;
    return sum + Math.max(1, Number(item.qty) || 1);
  }, 0);
}

export function bookingWindow(booking) {
  if (!booking || booking.booking_type === 'pickup') return null;
  const start = toMinutes(booking.event_time || '09:00');
  if (start === null) return null;
  const hours = Number(booking.duration_hours) || 3;
  return { start, end: Math.min(DAY_END_MINUTES, start + Math.round(hours * 60)) };
}

export function usedUnits(bookings, { date, branchId, start, end, excludeId = null }) {
  let used = 0;
  for (const booking of bookings) {
    if (booking.id === excludeId) continue;
    if (!ACTIVE_STATUSES.has(booking.status)) continue;
    if (String(booking.event_date || '').slice(0, 10) !== date) continue;
    if (booking.branch_id && branchId && booking.branch_id !== branchId) continue;
    const window = bookingWindow(booking);
    if (!window) continue;
    if (window.start < end && start < window.end) used += capacityUnits(booking.items || []);
  }
  return used;
}

export function nextAvailableStart(bookings, { date, branchId, hours = 3, units = 1, excludeId = null }) {
  const duration = Math.round(hours * 60);
  if (!date || units <= 0 || units > MAX_UNITS || duration <= 0) return null;
  for (let start = DAY_START_MINUTES; start + duration <= DAY_END_MINUTES; start += STEP_MINUTES) {
    const used = usedUnits(bookings, { date, branchId, start, end: start + duration, excludeId });
    if (used + units <= MAX_UNITS) return start;
  }
  // A slot can still fit late in the day if it runs to closing time exactly.
  const lastStart = DAY_END_MINUTES - duration;
  if (lastStart >= DAY_START_MINUTES) {
    const used = usedUnits(bookings, {
      date,
      branchId,
      start: lastStart,
      end: DAY_END_MINUTES,
      excludeId,
    });
    if (used + units <= MAX_UNITS) return lastStart;
  }
  return null;
}

export function checkCapacity(bookings, { date, branchId, start, hours, units, excludeId = null }) {
  const duration = Math.round((Number(hours) || 3) * 60);
  const end = Math.min(DAY_END_MINUTES, start + duration);
  const used = usedUnits(bookings, { date, branchId, start, end, excludeId });
  const result = {
    capacity: MAX_UNITS,
    units,
    used,
    remaining: Math.max(0, MAX_UNITS - used),
    full: used + units > MAX_UNITS,
    next_start: null,
    next_label: '',
  };
  if (result.full) {
    const next = nextAvailableStart(bookings, {
      date,
      branchId,
      hours: duration / 60,
      units,
      excludeId,
    });
    result.next_start = next;
    result.next_label = next === null ? '' : slotLabel(next);
  }
  return result;
}

export { toMinutes };
