import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import { addRouteStop, moveRouteStop, resolveRoute } from './route-state.ts';

const prospect = (id: string): Prospect => ({
  id, restaurant_name: id, address_input: `${id} address`, address_normalized: null,
  latitude: 35, longitude: -80, geocode_provider: null, geocode_reference: null,
  dropped_off: false, dropped_off_at: null, archived: false, created_at: '', updated_at: '',
});

describe('route state', () => {
  it('keeps the route intact when displayed search results are a subset', () => {
    const canonical = [prospect('a'), prospect('b'), prospect('c')];
    const route = ['a', 'b', 'c'];
    const filteredView = [canonical[1]];

    assert.deepEqual(route, ['a', 'b', 'c']);
    assert.deepEqual(resolveRoute(route, canonical).items.map(item => item.id), ['a', 'b', 'c']);
    assert.deepEqual(filteredView.map(item => item.id), ['b']);
  });

  it('moves a route stop and preserves the updated visible order', () => {
    assert.deepEqual(moveRouteStop(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  });

  it('does not add duplicate stops or exceed the limit', () => {
    assert.deepEqual(addRouteStop(['a'], 'a', 9), ['a']);
    assert.equal(addRouteStop(['a', 'b'], 'c', 2), null);
  });
});
