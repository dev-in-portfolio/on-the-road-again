import type { Prospect } from './types/prospect';

export type RouteResolution = {
  items: Prospect[];
  missingIds: string[];
};

/** OTRA owns the complete itinerary; navigation export may split it into legs. */
export const MAX_ROUTE = Number.POSITIVE_INFINITY;
export const ROUTE_STORAGE_KEY = 'otra.currentRoute';

export function addRouteStop(routeIds: string[], id: string, maxStops = MAX_ROUTE): string[] | null {
  if (routeIds.includes(id)) return routeIds;
  if (routeIds.length >= maxStops) return null;
  return [...routeIds, id];
}

export function removeRouteStop(routeIds: string[], id: string): string[] {
  return routeIds.filter(routeId => routeId !== id);
}

export function moveRouteStop(routeIds: string[], index: number, direction: -1 | 1): string[] {
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= routeIds.length) return routeIds;
  const next = [...routeIds];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

// Resolve against the canonical active store, never a filtered search result.
// Missing IDs remain in the route until the user explicitly removes them.
export function resolveRoute(routeIds: string[], prospects: Prospect[]): RouteResolution {
  const byId = new Map(prospects.map(prospect => [prospect.id, prospect]));
  const items: Prospect[] = [];
  const missingIds: string[] = [];
  for (const id of routeIds) {
    const prospect = byId.get(id);
    if (prospect) items.push(prospect);
    else missingIds.push(id);
  }
  return { items, missingIds };
}

// Ordered route entries that preserve each ID's position in `routeIds`, so the
// UI can render resolved and missing stops interleaved with correct numbering.
export type RouteEntry =
  | { kind: 'resolved'; id: string; prospect: Prospect }
  | { kind: 'missing'; id: string };

export function routeEntries(routeIds: string[], prospects: Prospect[]): RouteEntry[] {
  const byId = new Map(prospects.map(prospect => [prospect.id, prospect]));
  return routeIds.map(id => {
    const prospect = byId.get(id);
    return prospect ? { kind: 'resolved', id, prospect } : { kind: 'missing', id };
  });
}

// --- Persistence -----------------------------------------------------------
// localStorage is device-local. Route membership is stored as a plain array of
// prospect IDs and must fail safely (return []) on malformed or non-array data
// so a bad write can never corrupt the app.

export function serializeRoute(ids: string[]): string {
  return JSON.stringify(ids);
}

export function parseRoute(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export interface RouteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadRouteIds(storage: RouteStorage): string[] {
  try {
    return parseRoute(storage.getItem(ROUTE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveRouteIds(storage: RouteStorage, ids: string[]): void {
  try {
    storage.setItem(ROUTE_STORAGE_KEY, serializeRoute(ids));
  } catch {
    // storage unavailable — route simply won't persist this session
  }
}
