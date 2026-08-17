import type { ClosureObservation } from '../closure-windows.ts';

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
const CLOSURES_BASE = `${API_ORIGIN}/api/closures`;

export async function fetchClosureObservations(): Promise<ClosureObservation[]> {
  const response = await fetch(CLOSURES_BASE, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch closure observations (${response.status}).`);
  }
  return response.json();
}

export async function markProspectClosed(prospectId: string, date = new Date()): Promise<ClosureObservation> {
  const response = await fetch(CLOSURES_BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prospect_id: prospectId,
      weekday: date.getDay(),
      minute_of_day: date.getHours() * 60 + date.getMinutes(),
      observed_at: date.toISOString(),
      note: 'Marked closed from route',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Failed to mark closed (${response.status}).`);
  return data as ClosureObservation;
}
