import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import { filterProspects, sortProspects, distanceMiles } from './prospect-list.ts';

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

describe('prospect list — filtering', () => {
  const store = [
    prospect('a', { restaurant_name: 'Alpha', dropped_off: false }),
    prospect('b', { restaurant_name: 'Bravo', dropped_off: true }),
    prospect('c', { restaurant_name: 'Charlie', dropped_off: false }),
  ];
  const routeIds = ['a'];

  it('all filter returns everything', () => {
    assert.deepEqual(filterProspects(store, 'all', routeIds).map(p => p.id), ['a', 'b', 'c']);
  });

  it('not-dropped hides dropped-off prospects', () => {
    assert.deepEqual(filterProspects(store, 'not-dropped', routeIds).map(p => p.id), ['a', 'c']);
  });

  it('dropped shows only dropped-off prospects', () => {
    assert.deepEqual(filterProspects(store, 'dropped', routeIds).map(p => p.id), ['b']);
  });

  it('route shows only prospects in the current route', () => {
    assert.deepEqual(filterProspects(store, 'route', routeIds).map(p => p.id), ['a']);
  });

  it('filtering never mutates the input array or the route ids', () => {
    const input = [...store];
    const ids = [...routeIds];
    filterProspects(input, 'route', ids);
    assert.deepEqual(input.map(p => p.id), ['a', 'b', 'c']);
    assert.deepEqual(ids, ['a']);
  });
});

describe('prospect list — sorting', () => {
  const store = [
    prospect('a', { restaurant_name: 'Zed', latitude: 35.1, longitude: -80.1 }),
    prospect('b', { restaurant_name: 'Aardvark', latitude: 35.9, longitude: -80.9 }),
    prospect('c', { restaurant_name: 'Middle', latitude: 35.5, longitude: -80.5 }),
  ];

  it('A–Z sorts by restaurant name', () => {
    assert.deepEqual(sortProspects(store, 'name', null).map(p => p.id), ['b', 'c', 'a']);
  });

  it('falls back to A–Z when no origin is available for nearby', () => {
    assert.deepEqual(sortProspects(store, 'nearby', null).map(p => p.id), ['b', 'c', 'a']);
  });

  it('nearby sorts by distance from the origin', () => {
    const origin: [number, number] = [-80.1, 35.1]; // [lon, lat] at Zed's position
    assert.deepEqual(sortProspects(store, 'nearby', origin).map(p => p.id), ['a', 'c', 'b']);
  });

  it('sorting does not mutate the input array', () => {
    const input = [...store];
    sortProspects(input, 'name', null);
    assert.deepEqual(input.map(p => p.id), ['a', 'b', 'c']);
  });
});

describe('prospect list — distance', () => {
  it('returns Infinity when origin or coordinates are missing', () => {
    assert.equal(distanceMiles(null, prospect('a')), Number.POSITIVE_INFINITY);
    assert.equal(distanceMiles([-80, 35], prospect('a', { latitude: null, longitude: null })), Number.POSITIVE_INFINITY);
  });

  it('returns zero at the origin and grows with distance', () => {
    const origin: [number, number] = [-80.0, 35.0];
    const here = prospect('here', { latitude: 35.0, longitude: -80.0 });
    const far = prospect('far', { latitude: 36.0, longitude: -81.0 });
    assert.equal(distanceMiles(origin, here), 0);
    assert.ok(distanceMiles(origin, far) > 50);
  });
});
