import { Client } from '@libsql/client';

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
}
