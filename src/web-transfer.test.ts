import assert from 'node:assert/strict';
import test from 'node:test';
import type { FieldState } from './field-state.ts';
import {
  WEB_TRANSFER_SCHEMA,
  buildAndroidTransferIntent,
  createWebTransferPayload,
  decodeWebTransferPayload,
  encodeWebTransferPayload,
  mergeWebTransfer,
  parseNativeTransferUrl,
  transferFingerprint,
} from './web-transfer.ts';

function state(overrides: Partial<FieldState> = {}): FieldState {
  return {
    routeIds: [],
    currentStopId: null,
    selectedProspectId: null,
    mapView: null,
    filters: { searchQuery: '', listFilter: 'all', listSort: 'nearby' },
    prospects: [],
    pendingOperations: [],
    schemaVersion: 1,
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

test('web transfer uses localStorage route as a fallback and keeps field context', () => {
  const payload = createWebTransferPayload(state({
    currentStopId: 'stop-2',
    selectedProspectId: 'stop-3',
    mapView: { center: [-80.84, 35.22], zoom: 12 },
    filters: { searchQuery: 'cafe', listFilter: 'route', listSort: 'name' },
  }), ['stop-1', 'stop-2']);

  assert.equal(payload.schemaVersion, WEB_TRANSFER_SCHEMA);
  assert.deepEqual(payload.routeIds, ['stop-1', 'stop-2']);
  assert.equal(payload.currentStopId, 'stop-2');
  assert.equal(payload.selectedProspectId, 'stop-3');
  assert.deepEqual(payload.mapView, { center: [-80.84, 35.22], zoom: 12 });
  assert.deepEqual(payload.filters, { searchQuery: 'cafe', listFilter: 'route', listSort: 'name' });
});

test('transfer payload round trips Unicode and offline operations', () => {
  const payload = createWebTransferPayload(state({
    routeIds: ['a', 'b'],
    pendingOperations: [{
      id: 'op-1',
      kind: 'CREATE_PROSPECT',
      payload: { restaurant_name: 'Café Luna ☕' },
      createdAt: '2026-08-17T12:00:00.000Z',
      attempts: 1,
    }],
  }), []);

  const encoded = encodeWebTransferPayload(payload);
  const decoded = decodeWebTransferPayload(encoded);
  assert.ok(decoded);
  assert.deepEqual(decoded.routeIds, ['a', 'b']);
  assert.deepEqual(decoded.pendingOperations[0]?.payload, { restaurant_name: 'Café Luna ☕' });
});

test('Android intent targets the installed OTRA package', () => {
  const encoded = encodeWebTransferPayload(createWebTransferPayload(state({ routeIds: ['route-1'] }), []));
  const intent = buildAndroidTransferIntent(encoded);
  assert.match(intent, /^intent:\/\/transfer\?payload=/);
  assert.match(intent, /scheme=otra/);
  assert.match(intent, /package=com\.darkstar\.otra/);

  const parsed = parseNativeTransferUrl(`otra://transfer?payload=${encodeURIComponent(encoded)}`);
  assert.ok(parsed);
  assert.deepEqual(parsed.payload.routeIds, ['route-1']);
  assert.equal(parsed.encoded, encoded);
});

test('invalid or unrelated native URLs are ignored', () => {
  assert.equal(parseNativeTransferUrl('https://example.com/transfer?payload=x'), null);
  assert.equal(parseNativeTransferUrl('otra://other?payload=x'), null);
  assert.equal(parseNativeTransferUrl('otra://transfer?payload=not-valid-base64'), null);
});

test('merge replaces device-local route context while preserving cached prospects and deduplicating pending work', () => {
  const current = state({
    routeIds: ['native-route'],
    prospects: [{ id: 'cached' } as FieldState['prospects'][number]],
    pendingOperations: [{
      id: 'shared-op', kind: 'DELETE_PROSPECT', prospectId: 'x', payload: { id: 'x' },
      createdAt: '2026-08-17T10:00:00.000Z', attempts: 0,
    }],
  });
  const transfer = createWebTransferPayload(state({
    routeIds: ['web-1', 'web-2'],
    currentStopId: 'web-1',
    selectedProspectId: 'web-2',
    pendingOperations: [
      { id: 'shared-op', kind: 'DELETE_PROSPECT', prospectId: 'x', payload: { id: 'x' }, createdAt: '2026-08-17T10:00:00.000Z', attempts: 0 },
      { id: 'web-op', kind: 'UPDATE_PROSPECT', prospectId: 'y', payload: { id: 'y' }, createdAt: '2026-08-17T11:00:00.000Z', attempts: 0 },
    ],
  }), []);

  const merged = mergeWebTransfer(current, transfer);
  assert.deepEqual(merged.routeIds, ['web-1', 'web-2']);
  assert.equal(merged.currentStopId, 'web-1');
  assert.equal(merged.selectedProspectId, 'web-2');
  assert.deepEqual(merged.prospects, current.prospects);
  assert.deepEqual(merged.pendingOperations.map(operation => operation.id), ['shared-op', 'web-op']);
});

test('transfer fingerprint is stable and changes with the payload', () => {
  assert.equal(transferFingerprint('abc'), transferFingerprint('abc'));
  assert.notEqual(transferFingerprint('abc'), transferFingerprint('abd'));
});
