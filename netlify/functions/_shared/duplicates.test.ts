import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeForComparison, nameFingerprint, isDuplicate } from './duplicates.ts';

describe('duplicate normalization', () => {
  it('lowercases and strips punctuation and collapses whitespace', () => {
    assert.equal(normalizeForComparison("Lupie's Cafe"), 'lupies cafe');
    assert.equal(normalizeForComparison('  A&B   Diner!  '), 'ab diner');
    assert.equal(normalizeForComparison('Café — Éclair'), 'caf clair');
  });

  it('keeps distinct names distinct', () => {
    assert.notEqual(normalizeForComparison('Lupies Cafe'), normalizeForComparison('Lupie Cafe'));
  });
});

describe('duplicate fingerprint (SQL narrowing)', () => {
  it('produces a case-insensitive alphanumeric fingerprint', () => {
    assert.equal(nameFingerprint('lupies cafe'), 'lupiescafe');
    assert.equal(nameFingerprint('a b c'), 'abc');
    assert.equal(nameFingerprint(''), '');
  });

  it('is a superset: names that normalize equally share a fingerprint', () => {
    const variants = ["Lupie's Cafe", 'LUPIES CAFE', 'lupies   cafe', "Lupies' Cafe!"];
    const fingerprints = new Set(variants.map(v => nameFingerprint(normalizeForComparison(v))));
    assert.equal(fingerprints.size, 1);
    assert.equal([...fingerprints][0], 'lupiescafe');
  });
});

describe('duplicate decision', () => {
  const candidate = (overrides: Partial<{
    name: string;
    addressInput: string;
    addressNormalized: string;
    lat: number | null;
    lng: number | null;
  }> = {}) => ({
    normalizedName: normalizeForComparison(overrides.name ?? ''),
    normalizedAddressInput: normalizeForComparison(overrides.addressInput ?? ''),
    normalizedAddressNormalized: normalizeForComparison(overrides.addressNormalized ?? ''),
    hasCoordinates: (overrides.lat ?? null) !== null && (overrides.lng ?? null) !== null,
  });

  it('warns on same name and same address', () => {
    assert.equal(isDuplicate(
      candidate({ name: "Lupie's Cafe", addressInput: '2718 Monroe Rd' }),
      normalizeForComparison('Lupies Cafe'),
      normalizeForComparison('2718 Monroe Rd'),
    ), true);
  });

  it('warns on same name with coordinates even when the address differs', () => {
    assert.equal(isDuplicate(
      candidate({ name: 'Lupies Cafe', addressInput: '999 Other St', lat: 35, lng: -80 }),
      normalizeForComparison('Lupies Cafe'),
      normalizeForComparison('2718 Monroe Rd'),
    ), true);
  });

  it('does not warn on same name without coordinates at a different address', () => {
    assert.equal(isDuplicate(
      candidate({ name: 'Lupies Cafe', addressInput: '999 Other St', lat: null, lng: null }),
      normalizeForComparison('Lupies Cafe'),
      normalizeForComparison('2718 Monroe Rd'),
    ), false);
  });

  it('does not warn on a different name', () => {
    assert.equal(isDuplicate(
      candidate({ name: 'The Garrison', addressInput: '314 Main St', lat: 35, lng: -80 }),
      normalizeForComparison('Lupies Cafe'),
      normalizeForComparison('2718 Monroe Rd'),
    ), false);
  });
});
