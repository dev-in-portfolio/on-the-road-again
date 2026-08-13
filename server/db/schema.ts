import { Client } from '@libsql/client/http';

export async function ensureSchema(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      restaurant_name TEXT NOT NULL,
      address_input TEXT NOT NULL,
      address_normalized TEXT,
      latitude REAL,
      longitude REAL,
      geocode_provider TEXT,
      geocode_reference TEXT,
      dropped_off INTEGER NOT NULL DEFAULT 0,
      dropped_off_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Idempotent secondary indexes for the queries the API actually runs.
  // - archived: filters the common `WHERE archived = 0` active-prospect list.
  // - created_at: supports `ORDER BY created_at DESC` used by every list/search.
  // dropped_off is intentionally NOT indexed: it is filtered client-side, never
  // in a SQL WHERE clause, so an index there would add write cost with no read
  // benefit. (A plain B-tree also cannot accelerate leading-wildcard LIKE, so
  // the search path does not rely on one.)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_prospects_archived ON prospects (archived);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_prospects_created_at ON prospects (created_at);`);
}
