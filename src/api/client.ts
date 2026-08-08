import { Prospect, CreateProspectInput } from '../types/prospect';

const API_BASE = '/api/prospects';

export async function fetchProspects(includeArchived = false): Promise<Prospect[]> {
  const url = includeArchived ? `${API_BASE}?archived=true` : API_BASE;
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch prospects (Status ${res.status})`);
  }
  return res.json();
}

export async function createProspect(input: CreateProspectInput): Promise<Prospect> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create prospect (Status ${res.status})`);
  }

  return res.json();
}

export async function toggleDroppedOff(id: string, currentlyDroppedOff: boolean): Promise<Prospect> {
  const res = await fetch(API_BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      dropped_off: !currentlyDroppedOff,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update dropped off status (Status ${res.status})`);
  }

  return res.json();
}

export async function deleteProspect(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete prospect (Status ${res.status})`);
  }
}
