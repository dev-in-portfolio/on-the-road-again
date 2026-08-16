import { Directory, Filesystem } from '@capacitor/filesystem';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { OTRA_PACKAGE_ID } from './app-release.ts';
import type { AndroidRelease } from './mobile-updates.ts';

type OtraUpdaterPlugin = {
  installApk(options: { fileName: string }): Promise<void>;
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
  try {
    await OtraUpdater.installApk({ fileName });
  } catch (error) {
    if (error instanceof Error && error.message.includes('unknown_apps_permission_required')) {
      await OtraUpdater.openInstallSettings();
    }
    throw error;
  }
}
