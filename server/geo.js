import { GEOCODER_ENABLED, GEOCODER_URL, BRANCH_TIE_KM } from './config.js';

const EARTH_KM = 6371;

export function distanceKm(a, b) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// Nearest branch for a coordinate pair. Two branches within BRANCH_TIE_KM of each
// other are treated as a tie: the booking goes to manual review instead of a guess.
export function assignBranch(branches, point) {
  if (!point || !Array.isArray(branches) || branches.length === 0) return null;
  const ranked = branches
    .filter((branch) => Number.isFinite(Number(branch.lat)) && Number.isFinite(Number(branch.lng)))
    .map((branch) => ({ branch, km: distanceKm(point, { lat: Number(branch.lat), lng: Number(branch.lng) }) }))
    .sort((a, b) => a.km - b.km);
  if (!ranked.length) return null;
  const [first, second] = ranked;
  if (second && second.km - first.km < BRANCH_TIE_KM) return null;
  return { branch: first.branch, km: first.km };
}

let lastRequestAt = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nominatim allows one request per second and needs an identifying User-Agent.
async function geocodeAddress(address) {
  if (!GEOCODER_ENABLED || !String(address || '').trim()) return null;
  const gap = Date.now() - lastRequestAt;
  if (gap < 1100) await wait(1100 - gap);
  lastRequestAt = Date.now();
  try {
    const url = new URL(GEOCODER_URL);
    url.searchParams.set('q', String(address).slice(0, 200));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'ph');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PreciousMoments/1.0 (booking branch routing)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const results = await response.json();
    const hit = Array.isArray(results) ? results[0] : null;
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function locateBookingAddress(store, address) {
  const branches = await store.list('branches');
  const point = await geocodeAddress(address);
  if (!point) return { branchId: null, reason: 'address_not_found' };
  const match = assignBranch(branches, point);
  if (!match) return { branchId: null, reason: branches.length > 1 ? 'branches_too_close' : 'no_branches' };
  return { branchId: match.branch.id, reason: 'nearest', km: Math.round(match.km * 10) / 10 };
}

export { geocodeAddress };
