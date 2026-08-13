import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseImportText } from './import-parser.ts';

describe('import parser', () => {
  it('parses pipe-delimited name/address pairs', () => {
    const rows = parseImportText('Lupie\'s Cafe | 2718 Monroe Rd, Charlotte, NC');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { name: "Lupie's Cafe", address: '2718 Monroe Rd, Charlotte, NC', status: 'pending' });
  });

  it('parses tab and comma delimiters', () => {
    assert.deepEqual(parseImportText('Alpha\t1 Main St').map(r => r.name), ['Alpha']);
    assert.deepEqual(parseImportText('Bravo, 2 Elm St').map(r => r.name), ['Bravo']);
  });

  it('joins extra delimiter segments into the address', () => {
    const rows = parseImportText('Place | 123 Fake St, Ste 4, Charlotte, NC');
    assert.equal(rows[0].address, '123 Fake St, Ste 4, Charlotte, NC');
  });

  it('skips blank lines and malformed lines', () => {
    const rows = parseImportText('\n\nName Only\n\nAlpha | 1 Main St\n\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Alpha');
  });

  it('skips a recognized header row', () => {
    const rows = parseImportText('Restaurant Name | Address\nAlpha | 1 Main St\nBeta | 2 Elm St');
    assert.deepEqual(rows.map(r => r.name), ['Alpha', 'Beta']);
  });

  it('collapses internal whitespace in the address', () => {
    const rows = parseImportText('Alpha | 1   Main    St');
    assert.equal(rows[0].address, '1 Main St');
  });
});
