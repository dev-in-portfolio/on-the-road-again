import { createClient, Client } from '@libsql/client';

let dbInstance: Client | null = null;

export function getDb(): Client {
  if (dbInstance) {
    return dbInstance;
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error('Server configuration error: TURSO_DATABASE_URL is not set.');
  }

  dbInstance = createClient({
    url,
    authToken: authToken || undefined,
  });

  return dbInstance;
}
