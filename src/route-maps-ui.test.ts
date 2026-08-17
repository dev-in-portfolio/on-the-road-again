import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GOOGLE_MAPS_MAX_ROUTE_STOPS,
  buildSingleStopGoogleMapsUrl,
  isBulkGoogleMapsRouteSupported,
} from './route-maps-ui.ts';

describe('buildSingleStopGoogleMapsUrl', () => {
  it('builds a single-destination driving URL', () => {
    const url = new URL(buildSingleStopGoogleMapsUrl('123 Main St, Charlotte, NC'));

    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
    assert.equal(url.searchParams.get('destination'), '123 Main St, Charlotte, NC');
    assert.equal(url.searchParams.has('origin'), false);
    assert.equal(url.searchParams.has('waypoints'), false);
    assert.equal(url.searchParams.has('dir_action'), false);
  });

  it('trims the destination', () => {
    const url = new URL(buildSingleStopGoogleMapsUrl('  4412 Mickleton Rd  '));
    assert.equal(url.searchParams.get('destination'), '4412 Mickleton Rd');
  });

  it('rejects a blank destination', () => {
    assert.throws(() => buildSingleStopGoogleMapsUrl('   '), /destination is required/i);
  });
});

describe('isBulkGoogleMapsRouteSupported', () => {
  it('allows up to nine waypoints plus the destination', () => {
    assert.equal(GOOGLE_MAPS_MAX_ROUTE_STOPS, 10);
    assert.equal(isBulkGoogleMapsRouteSupported(1), true);
    assert.equal(isBulkGoogleMapsRouteSupported(10), true);
  });

  it('requires per-stop handoff above the bulk limit', () => {
    assert.equal(isBulkGoogleMapsRouteSupported(11), false);
    assert.equal(isBulkGoogleMapsRouteSupported(25), false);
    assert.equal(isBulkGoogleMapsRouteSupported(0), false);
  });
});
