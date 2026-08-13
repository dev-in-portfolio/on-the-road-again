import type { Context } from '@netlify/functions';
import { geocodeAutocomplete, geocodeSearch, isHighPrecisionResult } from '../../server/geocode/client.js';
import { authorize } from './_shared/auth.js';
import { rateLimit } from './_shared/rate-limit.js';

export default async (req: Request, _context: Context) => {
  const authError = authorize(req);
  if (authError) return authError;
  const limitError = rateLimit(req, 'geocode', 90, 60 * 1000);
  if (limitError) return limitError;
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';

  try {
    // GET /api/geocode?action=autocomplete&text=...
    if (method === 'GET' && action === 'autocomplete') {
      const text = url.searchParams.get('text');
      if (!text || text.trim().length < 2) {
        return new Response(
          JSON.stringify({ error: 'Please enter at least 2 characters to search.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const suggestions = await geocodeAutocomplete(text.trim());

      return new Response(JSON.stringify(suggestions), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // GET /api/geocode?action=search&text=...
    if (method === 'GET' && action === 'search') {
      const text = url.searchParams.get('text');
      if (!text || text.trim().length < 2) {
        return new Response(
          JSON.stringify({ error: 'Please enter a valid address to search.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const results = await geocodeSearch(text.trim());

      if (results.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No results found for this address.', results: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const best = results[0];
      const isPrecise = isHighPrecisionResult(best.resultType);

      return new Response(JSON.stringify({ results, isPrecise, best }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Missing or invalid action. Use ?action=autocomplete or ?action=search' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Geocoding service error';

    if (message.includes('GEOAPIFY_API_KEY is not configured')) {
      return new Response(
        JSON.stringify({ error: message }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.error('Geocode Function Error:', message);
    return new Response(
      JSON.stringify({ error: 'Address search is temporarily unavailable. Try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
