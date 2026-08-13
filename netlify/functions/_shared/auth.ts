import crypto from 'node:crypto';

const SESSION_COOKIE = 'otra_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function sameSecret(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('cookie') || '';
  const entry = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export function authConfigurationError(): Response | null {
  return env('OTRA_ACCESS_CODE') && env('OTRA_SESSION_SECRET')
    ? null
    : json({ error: 'Private access is not configured yet.' }, 503);
}

export function isAuthorized(req: Request): boolean {
  const secret = env('OTRA_SESSION_SECRET');
  const token = readCookie(req, SESSION_COOKIE);
  if (!secret || !token) return false;
  const [version, expiresAtText, signature] = token.split('.');
  const expiresAt = Number(expiresAtText);
  if (version !== 'v1' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !signature) return false;
  return sameSecret(signature, sign(`${version}.${expiresAtText}`, secret));
}

export function authorize(req: Request): Response | null {
  const configError = authConfigurationError();
  if (configError) return configError;
  return isAuthorized(req) ? null : json({ error: 'Private access required.' }, 401);
}

export function createSession(accessCode: unknown, req: Request): Response {
  const code = typeof accessCode === 'string' ? accessCode : '';
  const expectedCode = env('OTRA_ACCESS_CODE');
  const secret = env('OTRA_SESSION_SECRET');
  if (!expectedCode || !secret) return json({ error: 'Private access is not configured yet.' }, 503);
  if (!sameSecret(code, expectedCode)) return json({ error: 'Incorrect access code.' }, 401);

  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const token = `${payload}.${sign(payload, secret)}`;
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return json({ authenticated: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  });
}

export function clearSession(req: Request): Response {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return json({ authenticated: false }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  });
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
