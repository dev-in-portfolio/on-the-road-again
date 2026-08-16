import type { Config } from '@netlify/functions';
import { authorize, json } from './_shared/auth.js';

type Channel = 'beta' | 'stable';

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export default async (req: Request) => {
  const authError = authorize(req);
  if (authError) return authError;
  const channel = (new URL(req.url).pathname.match(/\/([^/]+)\.json$/)?.[1] || 'stable') as Channel;
  if (channel !== 'beta' && channel !== 'stable') return json({ error: 'Unknown release channel.' }, 404);
  const prefix = channel === 'beta' ? 'OTRA_ANDROID_BETA' : 'OTRA_ANDROID_STABLE';
  const apk = env(`${prefix}_APK_URL`);
  const sha256 = env(`${prefix}_SHA256`);
  const version = env(`${prefix}_VERSION`);
  const build = Number(env(`${prefix}_BUILD`));
  if (!apk || !sha256 || !version || !Number.isSafeInteger(build) || build <= 0) {
    return json({ error: 'No release is published for this channel.' }, 404);
  }
  return json({
    version, build, minimumBuild: Number(env(`${prefix}_MINIMUM_BUILD`) || 0),
    critical: env(`${prefix}_CRITICAL`) === 'true', channel, apk,
    sha256, size: Number(env(`${prefix}_SIZE`) || 0) || null,
    releaseNotes: env(`${prefix}_RELEASE_NOTES`) || '', packageName: 'com.darkstar.otra',
  });
};

export const config: Config = { path: '/mobile/android/:channel.json' };
