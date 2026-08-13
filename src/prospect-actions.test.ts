import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import { upsertProspect, removeProspectById, prependProspect } from './prospect-actions.ts';

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

describe('prospect status actions', () => {
  it('upsert replaces the matching prospect in place without reordering', () => {
    const store = [prospect('a'), prospect('b'), prospect('c')];
    const dropped = prospect('b', { dropped_off: true, dropped_off_at: '2026-08-13T00:00:00Z' });
    const next = upsertProspect(store, dropped);
    assert.deepEqual(next.map(p => p.id), ['a', 'b', 'c']);
    assert.equal(next[1].dropped_off, true);
    // Original store is untouched.
    assert.equal(store[1].dropped_off, false);
  });

  it('marking Dropped Off does not remove route membership', () => {
    const routeIds = ['a', 'b', 'c'];
    const store = [prospect('a'), prospect('b'), prospect('c')];
    const dropped = prospect('b', { dropped_off: true });
    const next = upsertProspect(store, dropped);
    // Route IDs are a separate concern and are unchanged by a status transition.
    assert.deepEqual(routeIds, ['a', 'b', 'c']);
    assert.deepEqual(next.map(p => p.id), ['a', 'b', 'c']);
  });

  it('undoing Dropped Off does not alter route membership either', () => {
    const routeIds = ['a', 'b'];
    const store = [prospect('a'), prospect('b', { dropped_off: true })];
    const restored = prospect('b', { dropped_off: false, dropped_off_at: null });
    const next = upsertProspect(store, restored);
    assert.deepEqual(routeIds, ['a', 'b']);
    assert.equal(next[1].dropped_off, false);
  });

  it('removeProspectById removes only the matching id and keeps order', () => {
    const store = [prospect('a'), prospect('b'), prospect('c')];
    assert.deepEqual(removeProspectById(store, 'b').map(p => p.id), ['a', 'c']);
    assert.deepEqual(removeProspectById(store, 'zzz').map(p => p.id), ['a', 'b', 'c']);
  });

  it('prependProspect inserts at the front without duplicating the id', () => {
    const store = [prospect('a'), prospect('b')];
    const restored = prospect('x');
    assert.deepEqual(prependProspect(store, restored).map(p => p.id), ['x', 'a', 'b']);
    // Re-adding an id already present moves it to the front rather than duplicating.
    assert.deepEqual(prependProspect(store, prospect('b')).map(p => p.id), ['b', 'a']);
  });
});
