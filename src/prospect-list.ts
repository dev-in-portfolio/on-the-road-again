import type { Prospect } from './types/prospect';

export type ListFilter = 'all' | 'not-dropped' | 'dropped' | 'route';
export type ListSort = 'nearby' | 'name';

// currentLocation is stored as [longitude, latitude].
export type Origin = [number, number];

// Filtering and sorting are display-only operations. They never touch route
// state, and route membership is consulted through the caller-supplied IDs.
export function filterProspects(
  prospects: Prospect[],
  filter: ListFilter,
  routeIds: readonly string[],
): Prospect[] {
  const routeSet = new Set(routeIds);
  return prospects.filter(prospect => {
    if (filter === 'not-dropped') return !prospect.dropped_off;
    if (filter === 'dropped') return prospect.dropped_off;
    if (filter === 'route') return routeSet.has(prospect.id);
    return true;
  });
}

export function distanceMiles(origin: Origin | null, prospect: Prospect): number {
  if (!origin || prospect.latitude == null || prospect.longitude == null) {
    return Number.POSITIVE_INFINITY;
  }
  const [originLon, originLat] = origin;
  const latitudeRadians = Math.PI / 180;
  const dLat = (prospect.latitude - originLat) * latitudeRadians;
  const dLon = (prospect.longitude - originLon) * latitudeRadians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(originLat * latitudeRadians) *
      Math.cos(prospect.latitude * latitudeRadians) *
      Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function sortProspects(
  prospects: Prospect[],
  sort: ListSort,
  origin: Origin | null,
): Prospect[] {
  return [...prospects].sort((a, b) => {
    if (sort === 'nearby' && origin) {
      const distanceA = distanceMiles(origin, a);
      const distanceB = distanceMiles(origin, b);
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    return a.restaurant_name.localeCompare(b.restaurant_name);
  });
}
