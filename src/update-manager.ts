import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { OTRA_BUILD, OTRA_CHANNEL, OTRA_PACKAGE_ID, OTRA_VERSION } from './app-release.ts';
import { isAndroidUpdateAvailable, parseAndroidRelease, type AndroidRelease } from './mobile-updates.ts';

export const UPDATE_CHECK_KEY = 'otra.android.lastUpdateCheck';
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type InstalledAppInfo = { version: string; build: number; packageId: string };
export type UpdateCheckResult = { release: AndroidRelease | null; installed: InstalledAppInfo; checkedAt: number; error?: string };

export function shouldCheckForUpdate(lastChecked: number | null, now = Date.now(), force = false): boolean {
  return force || lastChecked == null || now - lastChecked >= UPDATE_CHECK_INTERVAL_MS;
}

export function getLastUpdateCheck(storage: Pick<Storage, 'getItem'> = localStorage): number | null {
  const value = Number(storage.getItem(UPDATE_CHECK_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function getUpdateUrl(): string {
  const origin = (((import.meta as ImportMeta & { env?: { VITE_API_ORIGIN?: string } }).env?.VITE_API_ORIGIN) || '').replace(/\/$/, '');
  return `${origin}/mobile/android/${OTRA_CHANNEL}.json`;
}

export async function getInstalledAppInfo(): Promise<InstalledAppInfo> {
  if (Capacitor.isNativePlatform()) {
    const info = await App.getInfo();
    const build = Number(info.build);
    return { version: info.version, build: Number.isSafeInteger(build) ? build : 0, packageId: info.id };
  }
  return { version: OTRA_VERSION, build: OTRA_BUILD, packageId: OTRA_PACKAGE_ID };
}

export async function checkForAndroidUpdate(options: {
  force?: boolean;
  now?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  fetchImpl?: typeof fetch;
} = {}): Promise<UpdateCheckResult> {
  const now = options.now ?? Date.now();
  const storage = options.storage ?? localStorage;
  const installed = await getInstalledAppInfo();
  const lastChecked = getLastUpdateCheck(storage);
  if (!shouldCheckForUpdate(lastChecked, now, options.force)) return { release: null, installed, checkedAt: lastChecked || now };
  storage.setItem(UPDATE_CHECK_KEY, String(now));
  try {
    const response = await (options.fetchImpl ?? fetch)(getUpdateUrl(), { credentials: 'include', cache: 'no-store' });
    if (response.status === 404) return { release: null, installed, checkedAt: now };
    if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
    const release = parseAndroidRelease(await response.json());
    if (!release) throw new Error('Update metadata was malformed.');
    if (release.packageName !== installed.packageId || release.packageName !== OTRA_PACKAGE_ID) throw new Error('Update package identity does not match OTRA.');
    return { release: isAndroidUpdateAvailable(installed.build, release) ? release : null, installed, checkedAt: now };
  } catch (error) {
    return { release: null, installed, checkedAt: now, error: error instanceof Error ? error.message : 'Update check unavailable.' };
  }
}
