// Duplicate detection is split into a SQL narrowing step (a case-insensitive
// alphanumeric subsequence fingerprint) and an authoritative JavaScript
// normalization match. These helpers are pure so the matching semantics stay
// testable without a database.

export function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Case-insensitive alphanumeric fingerprint used to narrow candidates in SQL.
// It is deliberately a superset matcher: two names that normalize to the same
// string always share the same fingerprint, so narrowing on it never misses a
// duplicate that the authoritative match below would otherwise find.
export function nameFingerprint(normName: string): string {
  return normName.replace(/[^a-z0-9]/g, '');
}

export interface DuplicateCandidate {
  normalizedName: string;
  normalizedAddressInput: string;
  normalizedAddressNormalized: string;
  hasCoordinates: boolean;
}

export function isDuplicate(
  candidate: DuplicateCandidate,
  normName: string,
  normAddress: string,
): boolean {
  const nameMatch = candidate.normalizedName === normName;
  const addrMatch =
    candidate.normalizedAddressInput === normAddress ||
    candidate.normalizedAddressNormalized === normAddress;
  if (nameMatch && addrMatch) return true;
  // Same name with known coordinates is surfaced as a possible duplicate even
  // when the address differs, so a same-name restaurant at a separate location
  // still only WARNs (the user may Save Anyway).
  return nameMatch && candidate.hasCoordinates;
}
