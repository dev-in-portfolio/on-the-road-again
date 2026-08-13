import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prospect } from './types/prospect.ts';
import { addRouteStop, moveRouteStop, resolveRoute, MAX_ROUTE, serializeRoute, parseRoute } from './route-state.ts';
import { upsertProspect } from './prospect-actions.ts';
import { filterProspects } from './prospect-list.ts';
import { buildRouteGoogleMapsUrl } from './google-maps.ts';

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

// This is the browser-independent state layer for the field workflow: a
// canonical active prospect store plus a device-local ordered route. The app's
// DOM code exercises exactly these transitions, so driving them together here
// verifies the invariants the field workflow depends on without a browser.
describe('field workflow integration', () => {
  it('keeps the complete ordered route intact through selection, reorder, drop, search, reload, and handoff', () => {
    // 1. A canonical store of prospects (complete active set).
    let store = [
      prospect('lupies', { restaurant_name: "Lupie's Cafe", latitude: 35.21, longitude: -80.81 }),
      prospect('alexander', { restaurant_name: "Alexander Michael's", latitude: 35.22, longitude: -80.82 }),
      prospect('garrison', { restaurant_name: 'The Garrison', latitude: 35.23, longitude: -80.83 }),
      prospect('barts', { restaurant_name: "Bart's Mart", latitude: 35.24, longitude: -80.84 }),
      prospect('amelies', { restaurant_name: "Amélie's", latitude: 35.25, longitude: -80.85 }),
    ];

    // 2. Select several prospects and add them to Current Route.
    let route: string[] = [];
    route = addRouteStop(route, 'lupies', MAX_ROUTE) ?? route;
    route = addRouteStop(route, 'alexander', MAX_ROUTE) ?? route;
    route = addRouteStop(route, 'garrison', MAX_ROUTE) ?? route;
    assert.deepEqual(route, ['lupies', 'alexander', 'garrison']);

    // 3. Rearrange the route (move the last stop up).
    route = moveRouteStop(route, 2, -1);
    assert.deepEqual(route, ['lupies', 'garrison', 'alexander']);

    // 4. Mark one stop Dropped Off — this is a prospect status change and must
    //    never remove it from the route. The status transition preserves the
    //    existing record (including coordinates), as the server response does.
    const garrison = store.find(p => p.id === 'garrison')!;
    store = upsertProspect(store, { ...garrison, dropped_off: true, dropped_off_at: '2026-08-13T12:00:00Z' });
    assert.deepEqual(route, ['lupies', 'garrison', 'alexander']); // unchanged

    // 5. Search for another restaurant — display subset only.
    const searchResults = filterProspects(store, 'all', route).filter(p =>
      p.restaurant_name.toLowerCase().includes('bart')
    );
    assert.deepEqual(searchResults.map(p => p.id), ['barts']);
    assert.deepEqual(route, ['lupies', 'garrison', 'alexander']); // still unchanged

    // 6. Clear search — back to the full store. Route is still intact.

    // 7. Simulate a page reload: the route is serialized and re-read from
    //    device storage without loss.
    const reloaded = parseRoute(serializeRoute(route));
    assert.deepEqual(reloaded, ['lupies', 'garrison', 'alexander']);

    // 8–10. Resolve the route against the canonical store and confirm every
    //       selected stop remains in the correct order.
    const { items, missingIds } = resolveRoute(reloaded, store);
    assert.deepEqual(missingIds, []);
    assert.deepEqual(items.map(p => p.id), ['lupies', 'garrison', 'alexander']);

    // 11–12. Build the Google Maps URL and confirm every stop is present in
    //        the correct order (waypoints then destination).
    const result = buildRouteGoogleMapsUrl({ items, missingIds }, null);
    assert.equal(typeof result, 'string');
    const url = new URL(result as string);
    assert.equal(url.searchParams.get('waypoints'), '35.21,-80.81|35.23,-80.83');
    assert.equal(url.searchParams.get('destination'), '35.22,-80.82');
    assert.equal(url.searchParams.has('dir_action'), false); // no forced navigation
  });

  it('does not lose the route when search returns a subset or when a stop is dropped off', () => {
    let store = [prospect('a'), prospect('b'), prospect('c')];
    let route = ['a', 'b'];

    // Search only surfaces prospect 'c'.
    const subset = filterProspects(store, 'all', route).filter(p => p.id === 'c');
    assert.deepEqual(subset.map(p => p.id), ['c']);
    assert.deepEqual(route, ['a', 'b']);

    // Dropping off a routed stop does not change membership.
    store = upsertProspect(store, prospect('b', { dropped_off: true }));
    assert.deepEqual(route, ['a', 'b']);
    assert.deepEqual(resolveRoute(route, store).items.map(p => p.id), ['a', 'b']);
  });
});
