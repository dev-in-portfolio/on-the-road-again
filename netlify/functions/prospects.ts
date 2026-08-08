import type { Context } from '@netlify/functions';
import { getDb } from '../../server/db/client.js';
import { ensureSchema } from '../../server/db/schema.js';
import { Prospect } from '../../src/types/prospect.js';
import crypto from 'node:crypto';

// Helper to convert DB row to Prospect JSON model
function mapRowToProspect(row: Record<string, unknown>): Prospect {
  return {
    id: String(row.id),
    restaurant_name: String(row.restaurant_name),
    address_input: String(row.address_input),
    address_normalized: row.address_normalized ? String(row.address_normalized) : null,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    geocode_provider: row.geocode_provider ? String(row.geocode_provider) : null,
    geocode_reference: row.geocode_reference ? String(row.geocode_reference) : null,
    dropped_off: Number(row.dropped_off) === 1,
    dropped_off_at: row.dropped_off_at ? String(row.dropped_off_at) : null,
    archived: Number(row.archived) === 1,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export default async (req: Request, _context: Context) => {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  try {
    const db = getDb();
    await ensureSchema(db);

    // --- GET /api/prospects ---
    if (method === 'GET') {
      const includeArchived = url.searchParams.get('archived') === 'true';
      const query = includeArchived
        ? 'SELECT * FROM prospects ORDER BY created_at DESC'
        : 'SELECT * FROM prospects WHERE archived = 0 ORDER BY created_at DESC';

      const result = await db.execute(query);
      const prospects = result.rows.map((row) => mapRowToProspect(row as Record<string, unknown>));

      return new Response(JSON.stringify(prospects), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- POST /api/prospects ---
    if (method === 'POST') {
      const body = await req.json().catch(() => null);

      if (!body || typeof body !== 'object') {
        return new Response(JSON.stringify({ error: 'Invalid JSON request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const restaurant_name = typeof body.restaurant_name === 'string' ? body.restaurant_name.trim() : '';
      const address_input = typeof body.address_input === 'string' ? body.address_input.trim() : '';

      if (!restaurant_name || !address_input) {
        return new Response(
          JSON.stringify({ error: 'Both restaurant_name and address_input are required.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.execute({
        sql: `
          INSERT INTO prospects (
            id, restaurant_name, address_input, address_normalized,
            latitude, longitude, geocode_provider, geocode_reference,
            dropped_off, dropped_off_at, archived, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)
        `,
        args: [
          id,
          restaurant_name,
          address_input,
          body.address_normalized || null,
          body.latitude !== undefined ? body.latitude : null,
          body.longitude !== undefined ? body.longitude : null,
          body.geocode_provider || null,
          body.geocode_reference || null,
          now,
          now,
        ],
      });

      const fetchResult = await db.execute({
        sql: 'SELECT * FROM prospects WHERE id = ?',
        args: [id],
      });

      if (fetchResult.rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Failed to retrieve created prospect' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const newProspect = mapRowToProspect(fetchResult.rows[0] as Record<string, unknown>);

      return new Response(JSON.stringify(newProspect), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- PATCH /api/prospects ---
    if (method === 'PATCH') {
      const body = await req.json().catch(() => null);

      if (!body || typeof body !== 'object' || !body.id) {
        return new Response(JSON.stringify({ error: 'Prospect id is required for update.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { id } = body;
      const existing = await db.execute({
        sql: 'SELECT * FROM prospects WHERE id = ?',
        args: [id],
      });

      if (existing.rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Prospect not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const current = mapRowToProspect(existing.rows[0] as Record<string, unknown>);
      const now = new Date().toISOString();

      let newDroppedOff = current.dropped_off;
      let newDroppedOffAt = current.dropped_off_at;

      if (typeof body.dropped_off === 'boolean') {
        newDroppedOff = body.dropped_off;
        if (newDroppedOff) {
          newDroppedOffAt = body.dropped_off_at || now;
        } else {
          newDroppedOffAt = null;
        }
      }

      const updatedName = typeof body.restaurant_name === 'string' ? body.restaurant_name.trim() : current.restaurant_name;
      const updatedAddress = typeof body.address_input === 'string' ? body.address_input.trim() : current.address_input;
      const updatedNormalized = body.address_normalized !== undefined ? body.address_normalized : current.address_normalized;
      const updatedLat = body.latitude !== undefined ? body.latitude : current.latitude;
      const updatedLng = body.longitude !== undefined ? body.longitude : current.longitude;
      const updatedGeoProvider = body.geocode_provider !== undefined ? body.geocode_provider : current.geocode_provider;
      const updatedGeoRef = body.geocode_reference !== undefined ? body.geocode_reference : current.geocode_reference;
      const updatedArchived = typeof body.archived === 'boolean' ? (body.archived ? 1 : 0) : (current.archived ? 1 : 0);

      await db.execute({
        sql: `
          UPDATE prospects SET
            restaurant_name = ?,
            address_input = ?,
            address_normalized = ?,
            latitude = ?,
            longitude = ?,
            geocode_provider = ?,
            geocode_reference = ?,
            dropped_off = ?,
            dropped_off_at = ?,
            archived = ?,
            updated_at = ?
          WHERE id = ?
        `,
        args: [
          updatedName,
          updatedAddress,
          updatedNormalized,
          updatedLat,
          updatedLng,
          updatedGeoProvider,
          updatedGeoRef,
          newDroppedOff ? 1 : 0,
          newDroppedOffAt,
          updatedArchived,
          now,
          id,
        ],
      });

      const updatedFetch = await db.execute({
        sql: 'SELECT * FROM prospects WHERE id = ?',
        args: [id],
      });

      const updatedProspect = mapRowToProspect(updatedFetch.rows[0] as Record<string, unknown>);

      return new Response(JSON.stringify(updatedProspect), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- DELETE /api/prospects?id=xyz ---
    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'Missing prospect id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await db.execute({
        sql: 'DELETE FROM prospects WHERE id = ?',
        args: [id],
      });

      return new Response(JSON.stringify({ success: true, deleted_id: id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('API Function Error:', message);

    return new Response(
      JSON.stringify({ error: 'Server database error. Please try again later.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
