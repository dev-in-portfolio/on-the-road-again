const DEFAULT_NATIVE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost']);

export function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = req.headers.get('origin');
  const configured = (process.env.OTRA_CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (origin && new Set([...DEFAULT_NATIVE_ORIGINS, ...configured]).has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  return headers;
}

export function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(req)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function corsPreflight(req: Request): Response | null {
  return req.method.toUpperCase() === 'OPTIONS' ? withCors(req, new Response(null, { status: 204 })) : null;
}
