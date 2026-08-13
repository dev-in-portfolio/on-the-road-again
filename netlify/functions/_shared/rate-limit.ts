type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// In-memory limits reset on a cold start, but still stop accidental rapid use
// and opportunistic bursts without adding a database dependency.
export function rateLimit(req: Request, scope: string, maxRequests: number, windowMs: number): Response | null {
  const now = Date.now();
  const key = `${scope}:${clientKey(req)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= maxRequests) return null;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return new Response(JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}
