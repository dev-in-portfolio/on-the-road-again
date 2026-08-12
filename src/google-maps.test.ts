import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGoogleMapsDirectionsUrl } from './google-maps.ts';

const stop = (latitude: number, longitude: number) => ({ latitude, longitude });

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

  it('converts a cached [longitude, latitude] origin for Google Maps', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl(
      [stop(35.2271, -80.8431)],
      [-80.9000, 35.2000],
    ));

    assert.equal(url.searchParams.get('origin'), '35.2,-80.9');
  });
});
