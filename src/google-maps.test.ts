import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import { buildGoogleMapsDirectionsUrl, buildRouteGoogleMapsUrl } from './google-maps.ts';

const stop = (latitude: number, longitude: number) => ({ latitude, longitude });

const prospect = (id: string, overrides: Partial<Prospect> = {}): Prospect => ({
  id,
  restaurant_name: id,
  address_input: `${id} address`,
  address_normalized: null,
  latitude: 35,
  longitude: -80,
  geocode_provider: null,
  geocode_reference: null,
  dropped_off: false,
  dropped_off_at: null,
  archived: false,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('buildGoogleMapsDirectionsUrl', () => {
  it('sends a single stop as the destination', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl([stop(35.2271, -80.8431)], null));

    assert.equal(url.searchParams.get('destination'), '35.2271,-80.8431');
    assert.equal(url.searchParams.has('waypoints'), false);
    assert.equal(url.searchParams.has('origin'), false);
  });

  it('preserves every stop and its selected order', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl([
      stop(35.10, -80.10),
      stop(35.20, -80.20),
      stop(35.30, -80.30),
      stop(35.40, -80.40),
    ], null));

    assert.equal(url.searchParams.get('waypoints'), '35.1,-80.1|35.2,-80.2|35.3,-80.3');
    assert.equal(url.searchParams.get('destination'), '35.4,-80.4');
    assert.equal(url.searchParams.has('dir_action'), false);
  });

  it('does not force navigation (no dir_action parameter)', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl([stop(35.1, -80.1), stop(35.2, -80.2)], null));
    assert.equal(url.searchParams.has('dir_action'), false);
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
  });

  it('converts a cached [longitude, latitude] origin for Google Maps', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl(
      [stop(35.2271, -80.8431)],
      [-80.9000, 35.2000],
    ));

    assert.equal(url.searchParams.get('origin'), '35.2,-80.9');
  });

  it('omits origin when none is cached (Google Maps supplies current location)', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl([stop(35.1, -80.1)], null));
    assert.equal(url.searchParams.has('origin'), false);
  });

  it('throws when no stops are provided', () => {
    assert.throws(() => buildGoogleMapsDirectionsUrl([], null));
  });
});

describe('buildRouteGoogleMapsUrl', () => {
  it('fails safely on an empty route', () => {
    const result = buildRouteGoogleMapsUrl({ items: [], missingIds: [] }, null);
    assert.deepEqual(result, { error: 'Select at least one restaurant first.' });
  });

  it('fails safely when a route stop is missing from the canonical store', () => {
    const result = buildRouteGoogleMapsUrl(
      { items: [prospect('a')], missingIds: ['gone'] },
      null,
    );
    assert.equal(typeof result, 'object');
    if (typeof result === 'object') {
      assert.match(result.error, /unavailable/);
    }
  });

  it('fails safely when a stop has no mapped coordinates', () => {
    const result = buildRouteGoogleMapsUrl(
      { items: [prospect('a', { latitude: null, longitude: null })], missingIds: [] },
      null,
    );
    assert.equal(typeof result, 'object');
    if (typeof result === 'object') {
      assert.match(result.error, /valid mapped address/);
    }
  });

  it('builds a complete ordered URL from a resolved route', () => {
    const items = [
      prospect('a', { latitude: 35.1, longitude: -80.1 }),
      prospect('b', { latitude: 35.2, longitude: -80.2 }),
      prospect('c', { latitude: 35.3, longitude: -80.3 }),
    ];
    const result = buildRouteGoogleMapsUrl({ items, missingIds: [] }, null);
    assert.equal(typeof result, 'string');
    const url = new URL(result as string);
    assert.equal(url.searchParams.get('waypoints'), '35.1,-80.1|35.2,-80.2');
    assert.equal(url.searchParams.get('destination'), '35.3,-80.3');
  });
});
