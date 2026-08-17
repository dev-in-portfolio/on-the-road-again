import type { Context } from '@netlify/functions';
import crypto from 'node:crypto';
import { getDb } from '../../server/db/client.js';
import { authorize } from './_shared/auth.js';
import { rateLimit } from './_shared/rate-limit.js';
import { corsPreflight, withCors } from './_shared/cors.js';

type ClosureObservation = {
  id: string;
  prospect_id: string;
  weekday: number;
  minute_of_day: number;
  observed_at: string;
  note: string | null;
  created_at: string;
};

const seededClosures = [
  { key: 'kits-trackside-crafts', pattern: 'Kit%Trackside%Crafts' },
  { key: 'margauxs-wine-pizza-market', pattern: 'Margaux%Wine%Pizza%Market' },
  { key: 'the-garrison', pattern: 'The Garrison' },
] as const;

async function ensureClosureSchema() {
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS closure_observations (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      minute_of_day INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_closure_observations_prospect ON closure_observations (prospect_id);`);

  // Field observations captured from the 2026-08-17 route screenshots.
  // Deterministic IDs make this safe to run on every cold start.
  for (const seed of seededClosures) {
    const matches = await db.execute({
      sql: 'SELECT id FROM prospects WHERE LOWER(restaurant_name) LIKE LOWER(?) LIMIT 1',
      args: [seed.pattern],
    });
    if (!matches.rows.length) continue;
    const prospectId = String(matches.rows[0].id);
    await db.execute({
      sql: `INSERT OR IGNORE INTO closure_observations (id, prospect_id, weekday, minute_of_day, observed_at, note, created_at)
            VALUES (?, ?, 1, 780, ?, ?, ?)`,
      args: [
        `seed-20260817-${seed.key}`,
        prospectId,
        '2026-08-17T13:08:00-04:00',
        'Field observation: closed Monday around 1 PM',
        '2026-08-17T17:08:00.000Z',
      ],
    });
  }
}

function mapRow(row: Record<string, unknown>): ClosureObservation {
  return {
    id: String(row.id),
    prospect_id: String(row.prospect_id),
    weekday: Number(row.weekday),
    minute_of_day: Number(row.minute_of_day),
    observed_at: String(row.observed_at),
    note: row.note == null ? null : String(row.note),
    created_at: String(row.created_at),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handle(req: Request, _context: Context): Promise<Response> {
  const authError = authorize(req);
  if (authError) return authError;
  const limitError = rateLimit(req, 'closures', req.method === 'GET' ? 180 : 60, 60 * 1000);
  if (limitError) return limitError;

  const db = getDb();
  await ensureClosureSchema();
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  if (method === 'GET') {
    const prospectId = url.searchParams.get('prospect_id');
    const result = prospectId
      ? await db.execute({ sql: 'SELECT * FROM closure_observations WHERE prospect_id = ? ORDER BY observed_at DESC', args: [prospectId] })
      : await db.execute('SELECT * FROM closure_observations ORDER BY observed_at DESC');
    return json(result.rows.map(row => mapRow(row as Record<string, unknown>)));
  }

  if (method === 'POST') {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const prospectId = typeof body?.prospect_id === 'string' ? body.prospect_id : '';
    const weekday = Number(body?.weekday);
    const minuteOfDay = Number(body?.minute_of_day);
    const observedAt = typeof body?.observed_at === 'string' ? body.observed_at : '';
    if (!prospectId || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439 || !observedAt) {
      return json({ error: 'Valid prospect_id, weekday, minute_of_day, and observed_at are required.' }, 400);
    }
    const prospect = await db.execute({ sql: 'SELECT id FROM prospects WHERE id = ? LIMIT 1', args: [prospectId] });
    if (!prospect.rows.length) return json({ error: 'Prospect not found.' }, 404);

    const observation: ClosureObservation = {
      id: crypto.randomUUID(),
      prospect_id: prospectId,
      weekday,
      minute_of_day: minuteOfDay,
      observed_at: observedAt,
      note: typeof body?.note === 'string' ? body.note.slice(0, 240) : null,
      created_at: new Date().toISOString(),
    };
    await db.execute({
      sql: `INSERT INTO closure_observations (id, prospect_id, weekday, minute_of_day, observed_at, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [observation.id, observation.prospect_id, observation.weekday, observation.minute_of_day, observation.observed_at, observation.note, observation.created_at],
    });
    return json(observation, 201);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!id) return json({ error: 'Observation id is required.' }, 400);
    const result = await db.execute({ sql: 'DELETE FROM closure_observations WHERE id = ?', args: [id] });
    return result.rowsAffected ? json({ success: true }) : json({ error: 'Observation not found.' }, 404);
  }

  return json({ error: 'Method not allowed.' }, 405);
}

export default async (req: Request, context: Context) => corsPreflight(req) || withCors(req, await handle(req, context));
