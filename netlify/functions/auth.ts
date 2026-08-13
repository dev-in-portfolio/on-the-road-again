import type { Config } from '@netlify/functions';
import { authConfigurationError, clearSession, createSession, isAuthorized, json } from './_shared/auth.js';
import { rateLimit } from './_shared/rate-limit.js';

export default async (req: Request) => {
  const configError = authConfigurationError();
  if (configError) return configError;

  if (req.method === 'GET') return json({ authenticated: isAuthorized(req) });
  if (req.method === 'DELETE') return clearSession(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const limitError = rateLimit(req, 'auth', 8, 15 * 60 * 1000);
  if (limitError) return limitError;
  const body = await req.json().catch(() => null);
  return createSession(body && typeof body === 'object' ? (body as { accessCode?: unknown }).accessCode : null, req);
};

export const config: Config = { path: '/api/auth' };
