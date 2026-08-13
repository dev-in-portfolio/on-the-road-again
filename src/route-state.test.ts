import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import {
  addRouteStop,
  moveRouteStop,
  removeRouteStop,
  resolveRoute,
  routeEntries,
  MAX_ROUTE,
  serializeRoute,
  parseRoute,
  loadRouteIds,
  saveRouteIds,
  ROUTE_STORAGE_KEY,
  type RouteStorage,
} from './route-state.ts';

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

describe('route state — membership operations', () => {
  it('adds a stop to the end of the route', () => {
    assert.deepEqual(addRouteStop(['a'], 'b', MAX_ROUTE), ['a', 'b']);
  });

  it('does not add a duplicate stop (no-op)', () => {
    assert.deepEqual(addRouteStop(['a', 'b'], 'a', MAX_ROUTE), ['a', 'b']);
  });

  it('rejects an add when the route is at the maximum', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    assert.equal(addRouteStop(full, 'j', MAX_ROUTE), null);
  });

  it('allows filling exactly up to the maximum', () => {
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    assert.deepEqual(addRouteStop(eight, 'i', MAX_ROUTE), [...eight, 'i']);
  });

  it('removes a stop by id and leaves the rest in order', () => {
    assert.deepEqual(removeRouteStop(['a', 'b', 'c'], 'b'), ['a', 'c']);
  });

  it('removing a missing id is a no-op', () => {
    assert.deepEqual(removeRouteStop(['a', 'b'], 'z'), ['a', 'b']);
  });

  it('reorders a stop up and down without dropping others', () => {
    assert.deepEqual(moveRouteStop(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
    assert.deepEqual(moveRouteStop(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  });

  it('reordering past either edge is a no-op', () => {
    assert.deepEqual(moveRouteStop(['a', 'b'], 0, -1), ['a', 'b']);
    assert.deepEqual(moveRouteStop(['a', 'b'], 1, 1), ['a', 'b']);
  });

  it('clearing is an empty route', () => {
    assert.deepEqual(resolveRoute([], [prospect('a')]).items, []);
  });
});

describe('route state — canonical resolution', () => {
  it('preserves route ordering even when the store is in a different order', () => {
    const store = [prospect('c'), prospect('a'), prospect('b')];
    const route = ['b', 'a', 'c'];
    const { items, missingIds } = resolveRoute(route, store);
    assert.deepEqual(items.map(p => p.id), ['b', 'a', 'c']);
    assert.deepEqual(missingIds, []);
  });

  it('retains missing record ids separately without corrupting known stops', () => {
    const store = [prospect('a'), prospect('c')];
    const route = ['a', 'gone', 'c'];
    const { items, missingIds } = resolveRoute(route, store);
    assert.deepEqual(items.map(p => p.id), ['a', 'c']);
    assert.deepEqual(missingIds, ['gone']);
  });

  it('resolves against the canonical store, not a filtered search subset', () => {
    const canonical = [prospect('a'), prospect('b'), prospect('c')];
    const route = ['a', 'b', 'c'];
    const filteredView = canonical.filter(p => p.id === 'b');
    // The route is still resolvable in full from the canonical store...
    assert.deepEqual(resolveRoute(route, canonical).items.map(p => p.id), ['a', 'b', 'c']);
    // ...while the displayed search result is only a subset.
    assert.deepEqual(filteredView.map(p => p.id), ['b']);
  });
});

describe('route state — persistence', () => {
  it('serializes and reloads preserving order', () => {
    const ids = ['a', 'b', 'c'];
    assert.deepEqual(parseRoute(serializeRoute(ids)), ids);
  });

  it('returns an empty route for null, empty, or malformed data', () => {
    assert.deepEqual(parseRoute(null), []);
    assert.deepEqual(parseRoute(undefined), []);
    assert.deepEqual(parseRoute(''), []);
    assert.deepEqual(parseRoute('not json'), []);
    assert.deepEqual(parseRoute('{"nope": true}'), []);
    assert.deepEqual(parseRoute('123'), []);
  });

  it('filters non-string entries from a stored array', () => {
    assert.deepEqual(parseRoute('["a", 1, null, "b", {}]'), ['a', 'b']);
  });

  it('loads from a storage object and fails safely when storage throws', () => {
    const storage: RouteStorage = {
      getItem: () => '["a", "b"]',
      setItem: () => {},
    };
    assert.deepEqual(loadRouteIds(storage), ['a', 'b']);

    const broken: RouteStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => {},
    };
    assert.deepEqual(loadRouteIds(broken), []);
  });

  it('saves under the route storage key and survives a failing setItem', () => {
    let stored: string | null = null;
    const storage: RouteStorage = {
      getItem: () => stored,
      setItem: (_k, v) => { stored = v; },
    };
    saveRouteIds(storage, ['x', 'y']);
    assert.equal(stored, JSON.stringify(['x', 'y']));
    assert.equal(ROUTE_STORAGE_KEY, 'otra.currentRoute');

    const throwing: RouteStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    assert.doesNotThrow(() => saveRouteIds(throwing, ['x']));
  });
});

describe('route state — interleaved entries', () => {
  it('represents an archived/missing stop at its correct position', () => {
    const store = [prospect('a'), prospect('c')];
    const route = ['a', 'b', 'c'];
    const entries = routeEntries(route, store);
    assert.deepEqual(entries.map(e => e.kind), ['resolved', 'missing', 'resolved']);
    assert.deepEqual(entries.map(e => e.id), ['a', 'b', 'c']);
    // Position 2 (index 1) is the unavailable stop.
    assert.equal(entries[1].kind, 'missing');
  });

  it('removing only the missing stop leaves the remaining order intact', () => {
    const store = [prospect('a'), prospect('c')];
    let route = ['a', 'b', 'c'];
    route = removeRouteStop(route, 'b');
    assert.deepEqual(route, ['a', 'c']);
    assert.deepEqual(routeEntries(route, store).map(e => e.kind), ['resolved', 'resolved']);
  });

  it('represents a route made entirely of unavailable IDs (still removable)', () => {
    const store: Prospect[] = [];
    const route = ['x', 'y', 'z'];
    const entries = routeEntries(route, store);
    assert.deepEqual(entries.map(e => e.kind), ['missing', 'missing', 'missing']);
    assert.deepEqual(removeRouteStop(route, 'y'), ['x', 'z']);
  });
});
