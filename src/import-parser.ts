import type { Prospect } from './types/prospect';

export type ImportRow = {
  name: string;
  address: string;
  status: 'pending' | 'geocoding' | 'ready' | 'duplicate' | 'needs_review' | 'error' | 'imported';
  normalized?: string;
  lat?: number;
  lon?: number;
  placeId?: string;
  errorMsg?: string;
  duplicates?: Prospect[];
};

// Parse pasted "name | address" lines (also accepts tab or comma delimiters)
// into pending import rows. Skips a recognized header row and blank lines.
export function parseImportText(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows: ImportRow[] = [];
  let headerSkipped = false;
  for (const line of lines) {
    // Try common delimiters: | , tab
    let parts: string[] | null = null;
    if (line.includes('|')) parts = line.split('|');
    else if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(',')) {
      // Only use comma if | and tab not found, and there are exactly 2+ parts
      const csvParts = line.split(',');
      if (csvParts.length >= 2) parts = csvParts;
    }
    if (!parts || parts.length < 2) continue;

    const name = parts[0].trim();
    const address = parts.slice(1).join(' ').trim().replace(/\s+/g, ' ');
    if (!name || !address) continue;

    // Skip header row
    if (!headerSkipped && rows.length === 0 &&
        /^(restaurant|business|name|商户|店名)/i.test(name) &&
        /^(address|addr|地址|street)/i.test(address)) {
      headerSkipped = true;
      continue;
    }
    headerSkipped = true;

    rows.push({ name, address, status: 'pending' });
  }
  return rows;
}
