import type { Prospect } from './types/prospect';

// Map-independent prospect state transitions. These operate purely on the
// canonical prospect arrays and never touch route state, so marking a prospect
// Dropped Off (or archiving/deleting/restoring one) cannot affect the route.

export function upsertProspect(prospects: Prospect[], updated: Prospect): Prospect[] {
  return prospects.map(prospect => (prospect.id === updated.id ? updated : prospect));
}

export function removeProspectById(prospects: Prospect[], id: string): Prospect[] {
  return prospects.filter(prospect => prospect.id !== id);
}

export function prependProspect(prospects: Prospect[], prospect: Prospect): Prospect[] {
  return [prospect, ...prospects.filter(existing => existing.id !== prospect.id)];
}
