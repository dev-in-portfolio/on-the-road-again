import type { Prospect } from './types/prospect';

/** Structured, device-local field state. IndexedDB keeps this separate from
 * small preferences and survives browser/WebView restarts and APK updates. */
export type PendingOperation = {
  id: string;
  kind: 'UPDATE_PROSPECT' | 'CREATE_PROSPECT' | 'DELETE_PROSPECT';
  prospectId?: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
};

export type FieldState = {
  routeIds: string[];
  currentStopId: string | null;
  selectedProspectId: string | null;
  mapView: { center: [number, number]; zoom: number } | null;
  filters: { searchQuery: string; listFilter: string; listSort: string };
  prospects: Prospect[];
  pendingOperations: PendingOperation[];
  schemaVersion: number;
  updatedAt: string;
};

export const FIELD_STATE_SCHEMA = 1;
const DB_NAME = 'otra-field-state';
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'current';
let memoryState: FieldState | null = null;

export function emptyFieldState(): FieldState {
  return {
    routeIds: [], currentStopId: null, selectedProspectId: null, mapView: null,
    filters: { searchQuery: '', listFilter: 'all', listSort: 'nearby' },
    prospects: [], pendingOperations: [], schemaVersion: FIELD_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
  };
}

function validState(value: unknown): value is FieldState {
  return !!value && typeof value === 'object' && Array.isArray((value as FieldState).routeIds)
    && Array.isArray((value as FieldState).pendingOperations)
    && Array.isArray((value as FieldState).prospects);
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, FIELD_STATE_SCHEMA);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadFieldState(): Promise<FieldState> {
  if (memoryState) return structuredClone(memoryState);
  const db = await openDb();
  if (!db) return emptyFieldState();
  return new Promise(resolve => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    request.onsuccess = () => {
      const value = request.result;
      memoryState = validState(value) ? value : emptyFieldState();
      resolve(structuredClone(memoryState));
    };
    request.onerror = () => resolve(emptyFieldState());
  });
}

export async function saveFieldState(state: FieldState): Promise<void> {
  const next = { ...state, schemaVersion: FIELD_STATE_SCHEMA, updatedAt: new Date().toISOString() };
  memoryState = structuredClone(next);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(next, SNAPSHOT_KEY);
    request.onsuccess = request.onerror = () => resolve();
  });
}

export async function updateFieldState(mutator: (state: FieldState) => FieldState): Promise<FieldState> {
  const next = mutator(await loadFieldState());
  await saveFieldState(next);
  return next;
}

