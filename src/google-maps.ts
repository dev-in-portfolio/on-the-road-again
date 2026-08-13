import type { RouteResolution } from './route-state';

export type GoogleMapsStop = {
  latitude: number;
  longitude: number;
};

export function buildGoogleMapsDirectionsUrl(
  stops: GoogleMapsStop[],
  origin: [number, number] | null,
): string {
  if (stops.length === 0) throw new Error('At least one stop is required.');

  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: `${destination.latitude},${destination.longitude}`,
  });

  // currentLocation is stored as [longitude, latitude]. When it has not already
  // been resolved, omit origin so Google Maps uses the device's current location.
  if (origin) params.set('origin', `${origin[1]},${origin[0]}`);
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(stop => `${stop.latitude},${stop.longitude}`).join('|'));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export type GoogleMapsRouteResult = string | { error: string };

// Turn a resolved route (ordered items + any missing IDs) into a Google Maps
// directions URL, failing safely when the route is empty, references missing
// prospects, or contains a stop without a valid mapped coordinate.
export function buildRouteGoogleMapsUrl(
  resolution: RouteResolution,
  origin: [number, number] | null,
): GoogleMapsRouteResult {
  const { items, missingIds } = resolution;
  if (items.length === 0) return { error: 'Select at least one restaurant first.' };
  if (missingIds.length) {
    return { error: 'One or more route stops are unavailable. Remove them from Current Route before sending.' };
  }

  const invalid = items.filter(prospect => prospect.latitude == null || prospect.longitude == null);
  if (invalid.length > 0) {
    return { error: `${invalid[0].restaurant_name} needs a valid mapped address before this route can be sent.` };
  }

  const url = buildGoogleMapsDirectionsUrl(
    items.map(prospect => ({
      latitude: prospect.latitude!,
      longitude: prospect.longitude!,
    })),
    origin,
  );

  if (url.length > 2000) {
    return { error: 'Route URL is too long. This is unexpected with coordinate-based stops.' };
  }
  return url;
}
