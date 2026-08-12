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
