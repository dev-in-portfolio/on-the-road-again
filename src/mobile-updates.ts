export type AndroidRelease = {
  version: string; build: number; minimumBuild: number; critical: boolean;
  channel: 'beta' | 'stable'; apk: string; sha256: string; size: number | null;
  releaseNotes: string; packageName: string;
};

export function parseAndroidRelease(value: unknown): AndroidRelease | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Partial<AndroidRelease>;
  const build = release.build;
  const minimumBuild = release.minimumBuild;
  if (typeof release.version !== 'string' || typeof build !== 'number' || !Number.isSafeInteger(build) || build <= 0
    || (release.channel !== 'beta' && release.channel !== 'stable') || typeof release.apk !== 'string'
    || !/^https:\/\//i.test(release.apk) || typeof release.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(release.sha256) || release.packageName !== 'com.darkstar.otra') return null;
  return {
    version: release.version, build, minimumBuild: typeof minimumBuild === 'number' && Number.isSafeInteger(minimumBuild) ? minimumBuild : 0,
    critical: release.critical === true, channel: release.channel, apk: release.apk, sha256: release.sha256.toLowerCase(),
    size: typeof release.size === 'number' && release.size > 0 ? release.size : null, releaseNotes: typeof release.releaseNotes === 'string' ? release.releaseNotes : '', packageName: release.packageName,
  };
}

export function isAndroidUpdateAvailable(installedBuild: number, release: AndroidRelease): boolean {
  return release.build > installedBuild;
}
