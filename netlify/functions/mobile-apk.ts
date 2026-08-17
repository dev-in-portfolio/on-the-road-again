import type { Config } from '@netlify/functions';
import { corsPreflight, withCors } from './_shared/cors.js';

type Channel = 'beta' | 'stable';

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handle(req: Request): Promise<Response> {
  const channel = (new URL(req.url).pathname.match(/\/([^/]+)\.apk$/)?.[1] || 'stable') as Channel;
  if (channel !== 'beta' && channel !== 'stable') return text('Unknown release channel.', 404);

  const prefix = channel === 'beta' ? 'OTRA_ANDROID_BETA' : 'OTRA_ANDROID_STABLE';
  const source = env(`${prefix}_ORIGIN_APK_URL`);
  if (!source || !/^https:\/\//i.test(source)) return text('No APK source is published for this channel.', 404);

  try {
    const upstream = await fetch(source, {
      redirect: 'follow',
      headers: { 'User-Agent': 'OTRA-Android-Updater/1.0' },
    });
    if (!upstream.ok || !upstream.body) return text(`APK upstream failed (${upstream.status}).`, 502);

    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.android.package-archive');
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Disposition', `attachment; filename="otra-${channel}.apk"`);
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return text('APK upstream request failed.', 502);
  }
}

export default async (req: Request) => corsPreflight(req) || withCors(req, await handle(req));

export const config: Config = { path: '/mobile/android/:channel.apk' };
