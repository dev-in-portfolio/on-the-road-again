import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { OTRA_PACKAGE_ID } from './app-release.ts';
import type { AndroidRelease } from './mobile-updates.ts';

type InstallApkResult = { status?: 'installer_opened' | 'permission_settings_opened' };
type OtraUpdaterPlugin = {
  installApk(options: { fileName: string }): Promise<InstallApkResult>;
  openInstallSettings(): Promise<void>;
};

const OtraUpdater = registerPlugin<OtraUpdaterPlugin>('OtraUpdater');

function toBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(result);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function assertSecureApkUrl(url: string): void {
  if (!/^https:\/\//i.test(url)) throw new Error('The update download must use HTTPS.');
}

export async function verifyApkBytes(release: AndroidRelease, bytes: ArrayBuffer): Promise<void> {
  if (release.packageName !== OTRA_PACKAGE_ID) throw new Error('The update package identity is not OTRA.');
  if (release.size != null && bytes.byteLength !== release.size) throw new Error('APK size does not match release metadata.');
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== release.sha256.toLowerCase()) throw new Error('APK SHA-256 verification failed. Installation was blocked.');
}

async function waitForReturnToApp(timeoutMs = 120_000): Promise<() => Promise<void>> {
  let resolveReturn!: () => void;
  let sawInactive = false;
  const returned = new Promise<void>(resolve => { resolveReturn = resolve; });
  const listener = await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) sawInactive = true;
    else if (sawInactive) resolveReturn();
  });

  const wait = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        returned,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Install permission was not completed. Return to OTRA and tap Update again.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      await listener.remove();
    }
  };
  return wait;
}

async function installCachedApk(fileName: string): Promise<void> {
  // Register for the activity transition before asking native Android to open
  // settings so a fast settings round-trip cannot be missed.
  const waitForReturn = await waitForReturnToApp();
  let first: InstallApkResult;
  try {
    first = await OtraUpdater.installApk({ fileName });
  } catch (error) {
    // Compatibility path for pre-1.0.5 native bridges that reject rather than
    // returning a structured permission state.
    if (error instanceof Error && error.message.includes('unknown_apps_permission_required')) {
      await OtraUpdater.openInstallSettings();
      await waitForReturn();
      const retry = await OtraUpdater.installApk({ fileName });
      if (retry.status === 'permission_settings_opened') throw new Error('Allow installs from this source, then return to OTRA.');
      return;
    }
    throw error;
  }

  if (first.status !== 'permission_settings_opened') return;
  await waitForReturn();
  const retry = await OtraUpdater.installApk({ fileName });
  if (retry.status === 'permission_settings_opened') {
    throw new Error('Allow installs from this source, then return to OTRA.');
  }
}

export async function downloadVerifyAndInstall(release: AndroidRelease, installedBuild: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('APK installation is available in the Android app only.');
  if (release.packageName !== OTRA_PACKAGE_ID) throw new Error('The update package identity is not OTRA.');
  if (release.build <= installedBuild) throw new Error('The downloaded release is not newer than the installed app.');
  assertSecureApkUrl(release.apk);
  const response = await fetchImpl(release.apk, { cache: 'no-store' });
  if (!response.ok) throw new Error(`APK download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  await verifyApkBytes(release, bytes);
  const fileName = `otra-${release.version}-${release.build}.apk`;
  try { await Filesystem.deleteFile({ directory: Directory.Cache, path: fileName }); } catch { /* stale file is optional */ }
  await Filesystem.writeFile({ directory: Directory.Cache, path: fileName, data: toBase64(new Uint8Array(bytes)), recursive: true });
  await installCachedApk(fileName);
}
