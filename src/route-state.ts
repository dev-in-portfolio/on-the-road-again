import type { Prospect } from './types/prospect';

export type RouteResolution = {
  items: Prospect[];
  missingIds: string[];
};

export function addRouteStop(routeIds: string[], id: string, maxStops: number): string[] | null {
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
