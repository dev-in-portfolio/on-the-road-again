import {
  Prospect,
  CreateProspectInput,
  UpdateProspectInput,
  AutocompleteSuggestion,
  GeocodeSearchResponse,
  DuplicateResponse,
} from '../types/prospect';

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api/prospects`;
const GEOCODE_BASE = `${API_ORIGIN}/api/geocode`;
const AUTH_BASE = `${API_ORIGIN}/api/auth`;

export type AccessSession = { authenticated: boolean };

export async function getAccessSession(): Promise<AccessSession> {
  const res = await fetch(AUTH_BASE, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Unable to check private access.');
  return data as AccessSession;
}

export async function signIn(accessCode: string): Promise<AccessSession> {
  const res = await fetch(AUTH_BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessCode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Unable to unlock private access.');
  return data as AccessSession;
}

// --- Prospects CRUD ---

export async function fetchProspects(
  search?: string,
  includeArchived = false,
  signal?: AbortSignal,
): Promise<Prospect[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (includeArchived) params.set('archived', 'true');
  const qs = params.toString();
  const url = qs ? `${API_BASE}?${qs}` : API_BASE;

  const res = await fetch(url, { signal, credentials: 'include' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch prospects (Status ${res.status})`);
  }
  return res.json();
}

export async function createProspect(
  input: CreateProspectInput
): Promise<Prospect | DuplicateResponse> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = await res.json();

  if (res.status === 409 && data.code === 'DUPLICATE_DETECTED') {
    return data as DuplicateResponse;
  }

  if (!res.ok) {
    throw new Error(data.error || `Failed to create prospect (Status ${res.status})`);
  }

  return data as Prospect;
}

export async function updateProspect(
  input: UpdateProspectInput
): Promise<Prospect | DuplicateResponse> {
  const res = await fetch(API_BASE, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = await res.json();

  if (res.status === 409 && data.code === 'DUPLICATE_DETECTED') {
    return data as DuplicateResponse;
  }

  if (!res.ok) {
    throw new Error(data.error || `Failed to update prospect (Status ${res.status})`);
  }

  return data as Prospect;
}

export async function toggleDroppedOff(
  id: string,
  currentlyDroppedOff: boolean
): Promise<Prospect> {
  return updateProspect({
    id,
    dropped_off: !currentlyDroppedOff,
  }) as Promise<Prospect>;
}

export async function archiveProspect(id: string): Promise<Prospect> {
  return updateProspect({ id, archived: true }) as Promise<Prospect>;
}

export async function restoreProspect(id: string): Promise<Prospect> {
  return updateProspect({ id, archived: false }) as Promise<Prospect>;
}

export async function deleteProspect(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete prospect (Status ${res.status})`);
  }
}

// --- Geocoding ---

export async function geocodeAutocomplete(
  text: string,
  signal?: AbortSignal
): Promise<AutocompleteSuggestion[]> {
  const res = await fetch(
    `${GEOCODE_BASE}?action=autocomplete&text=${encodeURIComponent(text)}`,
    { signal, credentials: 'include' }
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Address search is temporarily unavailable.');
  }
  return res.json();
}

export async function geocodeSearch(
  text: string
): Promise<GeocodeSearchResponse> {
  const res = await fetch(
    `${GEOCODE_BASE}?action=search&text=${encodeURIComponent(text)}`,
    { credentials: 'include' }
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Address search is temporarily unavailable.');
  }
  return res.json();
}
