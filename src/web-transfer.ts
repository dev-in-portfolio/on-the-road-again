import type { FieldState, PendingOperation } from './field-state';

export const WEB_TRANSFER_SCHEMA = 1 as const;
export const WEB_TRANSFER_MAX_ENCODED_LENGTH = 60_000;

export type WebTransferPayload = {
  schemaVersion: typeof WEB_TRANSFER_SCHEMA;
  routeIds: string[];
  currentStopId: string | null;
  selectedProspectId: string | null;
  mapView: { center: [number, number]; zoom: number } | null;
  filters: { searchQuery: string; listFilter: string; listSort: string };
  pendingOperations: PendingOperation[];
  exportedAt: string;
};

const OPERATION_KINDS = new Set<PendingOperation['kind']>([
  'UPDATE_PROSPECT',
  'CREATE_PROSPECT',
  'DELETE_PROSPECT',
]);

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sanitizeMapView(value: unknown): WebTransferPayload['mapView'] {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { center?: unknown; zoom?: unknown };
  if (!Array.isArray(candidate.center) || candidate.center.length !== 2) return null;
  const [longitude, latitude] = candidate.center;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return null;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return null;
  if (typeof candidate.zoom !== 'number' || !Number.isFinite(candidate.zoom)) return null;
  return { center: [longitude, latitude], zoom: candidate.zoom };
}

function sanitizeFilters(value: unknown): WebTransferPayload['filters'] {
  if (!value || typeof value !== 'object') {
    return { searchQuery: '', listFilter: 'all', listSort: 'nearby' };
  }
  const candidate = value as Record<string, unknown>;
  return {
    searchQuery: typeof candidate.searchQuery === 'string' ? candidate.searchQuery : '',
    listFilter: typeof candidate.listFilter === 'string' ? candidate.listFilter : 'all',
    listSort: typeof candidate.listSort === 'string' ? candidate.listSort : 'nearby',
  };
}

function sanitizePendingOperations(value: unknown): PendingOperation[] {
  if (!Array.isArray(value)) return [];
  const operations: PendingOperation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id) continue;
    if (typeof candidate.kind !== 'string' || !OPERATION_KINDS.has(candidate.kind as PendingOperation['kind'])) continue;
    if (typeof candidate.createdAt !== 'string') continue;
    const attempts = typeof candidate.attempts === 'number' && Number.isFinite(candidate.attempts)
      ? Math.max(0, Math.trunc(candidate.attempts))
      : 0;
    operations.push({
      id: candidate.id,
      kind: candidate.kind as PendingOperation['kind'],
      prospectId: nullableString(candidate.prospectId) || undefined,
      payload: candidate.payload,
      createdAt: candidate.createdAt,
      attempts,
    });
  }
  return operations;
}

function sanitizePayload(value: unknown): WebTransferPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== WEB_TRANSFER_SCHEMA) return null;
  return {
    schemaVersion: WEB_TRANSFER_SCHEMA,
    routeIds: uniqueStrings(candidate.routeIds),
    currentStopId: nullableString(candidate.currentStopId),
    selectedProspectId: nullableString(candidate.selectedProspectId),
    mapView: sanitizeMapView(candidate.mapView),
    filters: sanitizeFilters(candidate.filters),
    pendingOperations: sanitizePendingOperations(candidate.pendingOperations),
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date(0).toISOString(),
  };
}

export function createWebTransferPayload(state: FieldState, fallbackRouteIds: string[]): WebTransferPayload {
  return {
    schemaVersion: WEB_TRANSFER_SCHEMA,
    routeIds: uniqueStrings(state.routeIds.length ? state.routeIds : fallbackRouteIds),
    currentStopId: state.currentStopId,
    selectedProspectId: state.selectedProspectId,
    mapView: state.mapView,
    filters: { ...state.filters },
    pendingOperations: state.pendingOperations.map(operation => ({ ...operation })),
    exportedAt: new Date().toISOString(),
  };
}

export function encodeWebTransferPayload(payload: WebTransferPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeWebTransferPayload(encoded: string): WebTransferPayload | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return sanitizePayload(parsed);
  } catch {
    return null;
  }
}

export function buildAndroidTransferIntent(encoded: string): string {
  return `intent://transfer?payload=${encodeURIComponent(encoded)}#Intent;scheme=otra;package=com.darkstar.otra;end`;
}

export function parseNativeTransferUrl(url: string): { encoded: string; payload: WebTransferPayload } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'otra:' || parsed.hostname !== 'transfer') return null;
    const encoded = parsed.searchParams.get('payload');
    if (!encoded) return null;
    const payload = decodeWebTransferPayload(encoded);
    return payload ? { encoded, payload } : null;
  } catch {
    return null;
  }
}

export function mergeWebTransfer(current: FieldState, transfer: WebTransferPayload): FieldState {
  const pendingById = new Map(current.pendingOperations.map(operation => [operation.id, operation]));
  for (const operation of transfer.pendingOperations) {
    if (!pendingById.has(operation.id)) pendingById.set(operation.id, operation);
  }
  return {
    ...current,
    routeIds: [...transfer.routeIds],
    currentStopId: transfer.currentStopId,
    selectedProspectId: transfer.selectedProspectId,
    mapView: transfer.mapView,
    filters: { ...transfer.filters },
    pendingOperations: [...pendingById.values()],
  };
}

export function transferFingerprint(encoded: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
